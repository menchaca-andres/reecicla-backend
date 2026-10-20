// Requiere REPORTING DB con 01-reporting-migration.sql aplicado:
//   RUN_REPORTING_INTEGRATION=1 DATABASE_URL=postgres://...:5438/reecicla_reporting_db npm test
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { after, test } = require('node:test');

const RUN = process.env.RUN_REPORTING_INTEGRATION === '1';
const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();

after(async () => {
  if (!RUN) return;
  const { pool } = require('../dist/config/db');
  for (const table of ['report_quotes', 'report_orders', 'report_payments', 'report_dispositions', 'processed_events']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_ID, OTHER_TENANT_ID]]);
  }
  await pool.end();
});

function event(tenantId, payload) {
  return { event_id: randomUUID(), correlation_id: randomUUID(), tenant_id: tenantId, event_type: 'Test', payload };
}

async function apply(routingKey, evt) {
  const { ReportModel } = require('../dist/models/reportModel');
  const { toProjection } = require('../dist/domain/projections');
  return ReportModel.applyEvent(evt, toProjection(routingKey, evt));
}

function quotePayload(quoteId, status, changedAt, finalPrice = 100) {
  return {
    quote_id: quoteId,
    quote_type: 'INITIAL',
    status,
    device_type_name: 'Refrigerador',
    final_price: finalPrice,
    currency: 'BOB',
    quote_created_at: '2026-10-05T10:00:00Z',
    changed_at: changedAt,
  };
}

test('projects events idempotently and ignores stale out-of-order updates', { skip: !RUN }, async () => {
  const { pool } = require('../dist/config/db');
  const quoteId = randomUUID();

  const created = event(TENANT_ID, quotePayload(quoteId, 'PENDING', '2026-10-05T10:00:00Z'));
  assert.equal(await apply('quote.status.changed', created), true);
  assert.equal(await apply('quote.status.changed', created), false, 'el mismo event_id no se proyecta dos veces');

  await apply('quote.status.changed', event(TENANT_ID, quotePayload(quoteId, 'ACCEPTED', '2026-10-06T10:00:00Z')));
  // Llega tarde un evento anterior (EXPIRED del día 5 a las 11:00): no debe pisar ACCEPTED.
  await apply('quote.status.changed', event(TENANT_ID, quotePayload(quoteId, 'EXPIRED', '2026-10-05T11:00:00Z')));

  const { rows } = await pool.query(
    'SELECT status FROM report_quotes WHERE tenant_id = $1 AND quote_id = $2',
    [TENANT_ID, quoteId]
  );
  assert.equal(rows[0].status, 'ACCEPTED');
});

test('aggregates the full flow per tenant without leaking other tenants', { skip: !RUN }, async () => {
  const { ReportModel } = require('../dist/models/reportModel');
  const { buildReportSummary } = require('../dist/domain/reportSummary');
  const { resolveReportPeriod } = require('../dist/domain/reportPeriod');
  const orderId = randomUUID();

  await apply('order.status.changed', event(TENANT_ID, {
    order_id: orderId, order_number: 'ORD-T1', previous_status: null, status: 'ACCEPTED',
    device_type_name: 'Refrigerador', quoted_price: 100, final_price: null, currency: 'BOB',
    order_created_at: '2026-10-06T10:00:00Z', changed_at: '2026-10-06T10:00:00Z',
  }));
  await apply('order.status.changed', event(TENANT_ID, {
    order_id: orderId, order_number: 'ORD-T1', previous_status: 'DISPOSED', status: 'CLOSED',
    device_type_name: 'Refrigerador', quoted_price: 100, final_price: 90, currency: 'BOB',
    order_created_at: '2026-10-06T10:00:00Z', changed_at: '2026-10-10T10:00:00Z',
  }));
  await apply('payment.failed', event(TENANT_ID, {
    payment_id: randomUUID(), order_id: orderId, amount: 90, currency: 'BOB',
    method: 'BANK_TRANSFER', failure_reason: 'Cuenta inválida', failed_at: '2026-10-08T10:00:00Z',
  }));
  await apply('payment.completed', event(TENANT_ID, {
    payment_id: randomUUID(), order_id: orderId, amount: 90, currency: 'BOB',
    method: 'BANK_TRANSFER', reference: null, paid_by_user_id: randomUUID(), paid_at: '2026-10-09T10:00:00Z',
  }));
  await apply('disposition.completed', event(TENANT_ID, {
    disposition_id: randomUUID(), order_id: orderId, type: 'RESALE', reference: 'EBAY-1',
    completed_by_user_id: randomUUID(), completed_at: '2026-10-10T10:00:00Z',
  }));
  // Datos de otro negocio en el mismo periodo.
  await apply('quote.status.changed', event(OTHER_TENANT_ID, quotePayload(randomUUID(), 'ACCEPTED', '2026-10-06T10:00:00Z', 9999)));

  const period = resolveReportPeriod({ from: '2026-10-01', to: '2026-10-31' });
  const summary = buildReportSummary(TENANT_ID, period, await ReportModel.getAggregates(TENANT_ID, period));

  assert.equal(summary.quotes.total, 1);
  assert.equal(summary.quotes.by_status.ACCEPTED, 1);
  assert.deepEqual(summary.quotes.accepted_amount, { BOB: 100 });
  assert.equal(summary.orders.created_in_period, 1);
  assert.deepEqual(summary.orders.current_by_status, { CLOSED: 1 });
  assert.equal(summary.payments.completed, 1);
  assert.equal(summary.payments.failed, 1);
  assert.deepEqual(summary.payments.completed_amount, { BOB: 90 });
  assert.equal(summary.dispositions.by_type.RESALE, 1);
  assert.ok(summary.last_event_at);

  const outside = resolveReportPeriod({ from: '2026-11-01', to: '2026-11-30' });
  const empty = buildReportSummary(TENANT_ID, outside, await ReportModel.getAggregates(TENANT_ID, outside));
  assert.equal(empty.quotes.total, 0);
  assert.equal(empty.payments.completed, 0);
  assert.deepEqual(empty.orders.current_by_status, { CLOSED: 1 }, 'el estado actual no depende del periodo');
});
