const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildReportSummary, reportSummaryToCsv } = require('../dist/domain/reportSummary');
const { resolveReportPeriod } = require('../dist/domain/reportPeriod');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const PERIOD = resolveReportPeriod({ from: '2026-10-01', to: '2026-10-31' });
const NOW = new Date('2026-10-19T12:00:00Z');

function empty() {
  return { quotes: [], ordersInPeriod: [], ordersCurrent: [], payments: [], dispositions: [], lastEventAt: null };
}

test('returns zeros instead of failing when there is no data', () => {
  const summary = buildReportSummary(TENANT_ID, PERIOD, empty(), NOW);
  assert.equal(summary.quotes.total, 0);
  assert.equal(summary.quotes.acceptance_rate, 0);
  assert.deepEqual(summary.quotes.by_status, { ANONYMOUS: 0, PENDING: 0, ACCEPTED: 0, REJECTED: 0, EXPIRED: 0 });
  assert.deepEqual(summary.dispositions.by_type, { RESALE: 0, RECYCLE: 0, RETURN: 0 });
  assert.equal(summary.orders.created_in_period, 0);
  assert.equal(summary.payments.completed, 0);
  assert.equal(summary.last_event_at, null);
  assert.deepEqual(summary.period, { from: '2026-10-01', to: '2026-10-31' });
});

test('computes quote totals, acceptance rate and amounts over initial quotes only', () => {
  const summary = buildReportSummary(TENANT_ID, PERIOD, {
    ...empty(),
    quotes: [
      { quote_type: 'INITIAL', status: 'ACCEPTED', currency: 'BOB', device_type_name: 'Refrigerador', count: '3', amount: '1500' },
      { quote_type: 'INITIAL', status: 'REJECTED', currency: 'BOB', device_type_name: 'Refrigerador', count: 1, amount: 400 },
      { quote_type: 'INITIAL', status: 'PENDING', currency: 'BOB', device_type_name: 'Lavadora', count: 4, amount: 800.555 },
      { quote_type: 'ADJUSTED', status: 'ACCEPTED', currency: 'BOB', device_type_name: 'Refrigerador', count: 2, amount: 900 },
    ],
  }, NOW);

  assert.equal(summary.quotes.total, 10);
  assert.equal(summary.quotes.by_type.INITIAL, 8);
  assert.equal(summary.quotes.by_type.ADJUSTED, 2);
  assert.equal(summary.quotes.by_status.ACCEPTED, 5);
  assert.equal(summary.quotes.acceptance_rate, 37.5);
  assert.deepEqual(summary.quotes.quoted_amount, { BOB: 2700.56 });
  assert.deepEqual(summary.quotes.accepted_amount, { BOB: 1500 });
  // Empate en total: primero el que tiene más aceptadas.
  assert.deepEqual(summary.quotes.by_device_type, [
    { device_type_name: 'Refrigerador', total: 4, accepted: 3 },
    { device_type_name: 'Lavadora', total: 4, accepted: 0 },
  ]);
});

test('aggregates orders, payments by method and dispositions', () => {
  const summary = buildReportSummary(TENANT_ID, PERIOD, {
    ...empty(),
    ordersInPeriod: [{ status: 'ACCEPTED', count: 2 }, { status: 'CLOSED', count: '1' }],
    ordersCurrent: [{ status: 'ACCEPTED', count: 5 }, { status: 'CLOSED', count: 7 }],
    payments: [
      { method: 'BANK_TRANSFER', status: 'COMPLETED', currency: 'BOB', count: 2, amount: 600 },
      { method: 'BANK_TRANSFER', status: 'FAILED', currency: 'BOB', count: 1, amount: 300 },
      { method: 'CHECK', status: 'COMPLETED', currency: 'BOB', count: 1, amount: 250.5 },
    ],
    dispositions: [{ type: 'RESALE', count: 2 }, { type: 'RECYCLE', count: 3 }, { type: 'RETURN', count: 1 }],
    lastEventAt: '2026-10-18T10:00:00Z',
  }, NOW);

  assert.equal(summary.orders.created_in_period, 3);
  assert.deepEqual(summary.orders.current_by_status, { ACCEPTED: 5, CLOSED: 7 });
  assert.equal(summary.payments.completed, 3);
  assert.equal(summary.payments.failed, 1);
  assert.deepEqual(summary.payments.completed_amount, { BOB: 850.5 });
  assert.deepEqual(summary.payments.by_method.BANK_TRANSFER, { completed: 2, failed: 1, amount: { BOB: 600 } });
  assert.equal(summary.dispositions.total, 6);
  assert.equal(summary.dispositions.by_type.RETURN, 1);
  assert.equal(summary.last_event_at, '2026-10-18T10:00:00.000Z');
});

test('exports the summary as CSV with header, escaping and formula protection', () => {
  const summary = buildReportSummary(TENANT_ID, PERIOD, {
    ...empty(),
    quotes: [
      { quote_type: 'INITIAL', status: 'ACCEPTED', currency: 'BOB', device_type_name: '=HYPERLINK("x")', count: 1, amount: 10 },
      { quote_type: 'INITIAL', status: 'PENDING', currency: 'BOB', device_type_name: 'Cocina, 4 hornallas', count: 1, amount: 5 },
    ],
  }, NOW);
  const csv = reportSummaryToCsv(summary);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'seccion,metrica,valor');
  assert.ok(lines.includes('cotizaciones,total,2'));
  assert.ok(lines.includes('cotizaciones,tasa_aceptacion_%,50'));
  assert.ok(lines.includes('cotizaciones,monto_cotizado (BOB),15.00'));
  assert.ok(lines.includes('cotizaciones_por_tipo,"\'=HYPERLINK(""x"")",1 (1 aceptadas)'));
  assert.ok(lines.includes('cotizaciones_por_tipo,"Cocina, 4 hornallas",1 (0 aceptadas)'));
  assert.ok(lines.includes('destino,RETURN,0'));
});
