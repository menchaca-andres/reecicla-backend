const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { validateQuoteAcceptedEvent } = require('../dist/domain/quoteAccepted');

function createEvent() {
  return {
    event_id: randomUUID(),
    correlation_id: randomUUID(),
    tenant_id: '00000000-0000-0000-0000-000000000001',
    event_type: 'QuoteAccepted',
    timestamp: new Date().toISOString(),
    payload: {
      quote_id: randomUUID(),
      user_id: randomUUID(),
      device_type_id: randomUUID(),
      device_type_name: 'Refrigerador',
      brand: 'Marca de prueba',
      model: 'Modelo de prueba',
      year: 2022,
      condition: 'working',
      quoted_price: 150,
      currency: 'BOB',
      customer_name: 'Cliente de prueba',
      customer_email: 'orders-test@example.invalid',
      customer_phone: '555-0100',
      pickup_address: 'Dirección de prueba',
      accepted_at: new Date().toISOString(),
    },
  };
}

test('valida un evento QuoteAccepted completo', () => {
  assert.doesNotThrow(() => validateQuoteAcceptedEvent(createEvent()));
});

test('valida una aceptación de invitado sin usuario asociado', () => {
  const event = createEvent();
  event.payload.user_id = null;
  assert.doesNotThrow(() => validateQuoteAcceptedEvent(event));

  event.payload.user_id = 'invalid-user-id';
  assert.throws(() => validateQuoteAcceptedEvent(event), /usuario.*no es válido/);
});

test('rechaza un evento con un tipo desconocido', () => {
  const event = createEvent();
  event.event_type = 'QuoteRejected';
  assert.throws(() => validateQuoteAcceptedEvent(event), /Evento QuoteAccepted inválido/);
});

test('rechaza precio y año fuera de rango', () => {
  const event = createEvent();
  event.payload.quoted_price = -1;
  assert.throws(() => validateQuoteAcceptedEvent(event), /payload.*inválidos/);

  const yearEvent = createEvent();
  yearEvent.payload.year = 2201;
  assert.throws(() => validateQuoteAcceptedEvent(yearEvent), /payload.*inválidos/);
});

test('rechaza tokens de seguimiento mal formados sin consultar la base', async () => {
  const { OrderModel } = require('../dist/models/orderModel');
  assert.equal(await OrderModel.getByTrackingToken('invalid-token'), null);
});

test('crea una orden y un solo estado inicial frente a eventos duplicados', { skip: process.env.RUN_ORDERS_INTEGRATION !== '1' }, async () => {
  const { pool } = require('../dist/config/db');
  const { OrderModel } = require('../dist/models/orderModel');
  const originalFetch = global.fetch;
  let trackingUrl;
  global.fetch = async (_url, options) => {
    trackingUrl = JSON.parse(options.body).tracking_url;
    return { ok: true, status: 202, json: async () => ({ message: 'sent' }) };
  };
  const event = createEvent();
  event.payload.user_id = null;
  const duplicateEvent = { ...event, event_id: randomUUID(), correlation_id: randomUUID() };

  try {
    await OrderModel.createFromAcceptedQuote(event);
    await OrderModel.createFromAcceptedQuote(event);
    await OrderModel.createFromAcceptedQuote(duplicateEvent);

    const orderResult = await pool.query(
      'SELECT * FROM orders WHERE tenant_id = $1 AND quote_id = $2',
      [event.tenant_id, event.payload.quote_id]
    );
    assert.equal(orderResult.rowCount, 1);
    assert.equal(orderResult.rows[0].brand, event.payload.brand);
    assert.equal(orderResult.rows[0].model, event.payload.model);
    assert.equal(orderResult.rows[0].device_year, event.payload.year);
    assert.equal(orderResult.rows[0].declared_condition, event.payload.condition);
    assert.equal(orderResult.rows[0].user_id, null);
    assert.equal(orderResult.rows[0].customer_phone, event.payload.customer_phone);
    assert.equal(orderResult.rows[0].pickup_address.address, event.payload.pickup_address);

    const token = trackingUrl.match(/\/seguimiento\/([0-9a-f]{64})$/)?.[1];
    assert.ok(token);
    const trackedOrder = await OrderModel.getByTrackingToken(token);
    assert.equal(trackedOrder.order_number, orderResult.rows[0].order_number);
    assert.equal(trackedOrder.status, 'ACCEPTED');
    assert.equal(trackedOrder.status_history.length, 1);
    assert.equal('tracking_token_hash' in trackedOrder, false);
    const invalidToken = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    assert.equal(await OrderModel.getByTrackingToken(invalidToken), null);

    const historyResult = await pool.query(
      'SELECT * FROM order_status_history WHERE tenant_id = $1 AND order_id = $2',
      [event.tenant_id, orderResult.rows[0].id]
    );
    assert.equal(historyResult.rowCount, 1);
    assert.equal(historyResult.rows[0].new_status, 'ACCEPTED');
  } finally {
    await pool.query(
      `DELETE FROM order_status_history WHERE tenant_id = $1 AND order_id IN
       (SELECT id FROM orders WHERE tenant_id = $1 AND quote_id = $2)`,
      [event.tenant_id, event.payload.quote_id]
    );
    await pool.query('DELETE FROM orders WHERE tenant_id = $1 AND quote_id = $2', [event.tenant_id, event.payload.quote_id]);
    await pool.query('DELETE FROM processed_events WHERE event_id = ANY($1::uuid[])', [[event.event_id, duplicateEvent.event_id]]);
    global.fetch = originalFetch;
    await pool.end();
  }
});