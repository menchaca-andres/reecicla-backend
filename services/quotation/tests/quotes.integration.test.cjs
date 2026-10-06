const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, before, test } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

const eventBus = require('../dist/messaging/eventBus');
const publishedEvents = [];
const publishListeners = new Set();

eventBus.publishEvent = async (routingKey, options) => {
  const event = { ...options, timestamp: new Date().toISOString() };
  const published = { routingKey, event };
  publishedEvents.push(published);
  publishListeners.forEach((listener) => listener(published));
  return event;
};

const quotationRoutes = require('../dist/routes/quotationRoutes').default;
const { pool } = require('../dist/config/db');
const jwtSecret = process.env.JWT_SECRET || 'default_jwt_secret_reecicla';
const runIntegration = process.env.RUN_QUOTATION_INTEGRATION === '1';
let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/quotation', quotationRoutes);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/quotation`;
});

after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

function authToken(userId, tenantId) {
  return jwt.sign({
    userId,
    tenantId,
    email: `${userId}@example.invalid`,
    name: 'Quotation integration test',
    role: 'CUSTOMER',
  }, jwtSecret, { expiresIn: '5m' });
}

async function request(path, userId, tenantId, method = 'GET') {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${authToken(userId, tenantId)}` },
  });
}

async function withScenario(run) {
  const scenario = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    quoteIds: [],
    ruleIds: [],
    rulesByTenant: new Map(),
  };

  try {
    await run(scenario);
  } finally {
    if (scenario.quoteIds.length) {
      await pool.query(
        `DELETE FROM quote_event_outbox WHERE payload->>'quote_id' = ANY($1::text[])`,
        [scenario.quoteIds]
      );
      await pool.query('DELETE FROM quotes WHERE id = ANY($1::uuid[])', [scenario.quoteIds]);
    }
    if (scenario.ruleIds.length) {
      await pool.query('DELETE FROM pricing_rules WHERE id = ANY($1::uuid[])', [scenario.ruleIds]);
    }
  }
}

async function createQuote(scenario, { tenantId = scenario.tenantId, userId = randomUUID(), expired = false } = {}) {
  let pricingRuleId = scenario.rulesByTenant.get(tenantId);
  if (!pricingRuleId) {
    pricingRuleId = randomUUID();
    await pool.query(
      `INSERT INTO pricing_rules (id, tenant_id, device_type_id, version, base_price, currency)
       VALUES ($1, $2, $3, 1, 125, 'BOB')`,
      [pricingRuleId, tenantId, randomUUID()]
    );
    scenario.rulesByTenant.set(tenantId, pricingRuleId);
    scenario.ruleIds.push(pricingRuleId);
  }

  const quoteId = randomUUID();
  await pool.query(
    `INSERT INTO quotes (
       id, tenant_id, user_id, pricing_rule_id, device_type_id, device_type_name,
       condition, base_price, final_price, currency, valid_until, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'Equipo de prueba', 'working', 125, 125, 'BOB',
       CASE WHEN $6 THEN NOW() - INTERVAL '1 day' ELSE NOW() + INTERVAL '30 days' END,
       CASE WHEN $6 THEN NOW() - INTERVAL '2 days' ELSE NOW() END
     )`,
    [quoteId, tenantId, userId, pricingRuleId, randomUUID(), expired]
  );
  scenario.quoteIds.push(quoteId);
  return { id: quoteId, tenantId, userId };
}

function waitForPublishedEvent(eventId) {
  const alreadyPublished = publishedEvents.find(({ event }) => event.event_id === eventId);
  if (alreadyPublished) return Promise.resolve(alreadyPublished);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      publishListeners.delete(onPublished);
      reject(new Error(`No se despacho el evento ${eventId}.`));
    }, 5000);
    const onPublished = (published) => {
      if (published.event.event_id !== eventId) return;
      clearTimeout(timeout);
      publishListeners.delete(onPublished);
      resolve(published);
    };
    publishListeners.add(onPublished);
  });
}

test('lista solo las cotizaciones del usuario autenticado', { skip: !runIntegration }, async () => {
  await withScenario(async (scenario) => {
    const ownQuote = await createQuote(scenario, { userId: scenario.userId });
    await createQuote(scenario, { userId: randomUUID() });
    await createQuote(scenario, { tenantId: randomUUID() });

    const response = await request('/quotes/user', scenario.userId, scenario.tenantId);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.quotes.map((quote) => quote.id), [ownQuote.id]);
    assert.equal(body.quotes[0].status, 'PENDING');
    assert.equal(body.quotes[0].is_expired, false);
    assert.ok(body.quotes[0].valid_until);
  });
});

test('permite el detalle propio y oculta cotizaciones de otro usuario o tenant', { skip: !runIntegration }, async () => {
  await withScenario(async (scenario) => {
    const ownQuote = await createQuote(scenario, { userId: scenario.userId });
    const otherUserQuote = await createQuote(scenario, { userId: randomUUID() });
    const otherTenantQuote = await createQuote(scenario, { tenantId: randomUUID() });

    const ownResponse = await request(`/quotes/${ownQuote.id}`, scenario.userId, scenario.tenantId);
    assert.equal(ownResponse.status, 200);
    assert.equal((await ownResponse.json()).quote.id, ownQuote.id);

    const otherUserResponse = await request(`/quotes/${otherUserQuote.id}`, scenario.userId, scenario.tenantId);
    assert.equal(otherUserResponse.status, 404);
    const otherTenantResponse = await request(`/quotes/${otherTenantQuote.id}`, scenario.userId, scenario.tenantId);
    assert.equal(otherTenantResponse.status, 404);
  });
});

test('acepta una cotizacion vigente y despacha QuoteAccepted desde el outbox', { skip: !runIntegration }, async () => {
  await withScenario(async (scenario) => {
    const quote = await createQuote(scenario, { userId: scenario.userId });
    const response = await request(`/quotes/${quote.id}/accept`, scenario.userId, scenario.tenantId, 'POST');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).quote.status, 'ACCEPTED');

    const outboxResult = await pool.query(
      `SELECT event_id, correlation_id, tenant_id, event_type, payload
       FROM quote_event_outbox WHERE payload->>'quote_id' = $1`,
      [quote.id]
    );
    assert.equal(outboxResult.rowCount, 1);
    const outboxEvent = outboxResult.rows[0];
    assert.equal(outboxEvent.event_type, 'QuoteAccepted');
    assert.equal(outboxEvent.tenant_id, scenario.tenantId);
    assert.equal(outboxEvent.payload.quote_id, quote.id);

    const published = await waitForPublishedEvent(outboxEvent.event_id);
    assert.equal(published.routingKey, 'quote.accepted');
    assert.equal(published.event.event_id, outboxEvent.event_id);
    assert.equal(published.event.correlation_id, outboxEvent.correlation_id);
    assert.equal(published.event.tenant_id, scenario.tenantId);
    assert.equal(published.event.event_type, 'QuoteAccepted');
    assert.equal(published.event.payload.quote_id, quote.id);
    assert.ok(published.event.timestamp);
  });
});

test('marca EXPIRED y rechaza la aceptacion de una cotizacion vencida', { skip: !runIntegration }, async () => {
  await withScenario(async (scenario) => {
    const quote = await createQuote(scenario, { userId: scenario.userId, expired: true });
    const response = await request(`/quotes/${quote.id}/accept`, scenario.userId, scenario.tenantId, 'POST');
    assert.equal(response.status, 422);

    const result = await pool.query('SELECT status FROM quotes WHERE id = $1', [quote.id]);
    assert.equal(result.rows[0].status, 'EXPIRED');
  });
});

test('rechaza explicitamente una cotizacion vigente', { skip: !runIntegration }, async () => {
  await withScenario(async (scenario) => {
    const quote = await createQuote(scenario, { userId: scenario.userId });
    const response = await request(`/quotes/${quote.id}/reject`, scenario.userId, scenario.tenantId, 'POST');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).quote.status, 'REJECTED');

    const result = await pool.query('SELECT status FROM quotes WHERE id = $1', [quote.id]);
    assert.equal(result.rows[0].status, 'REJECTED');
  });
});