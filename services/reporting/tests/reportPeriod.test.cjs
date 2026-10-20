const assert = require('node:assert/strict');
const { test } = require('node:test');
const { InvalidReportPeriodError, resolveReportPeriod } = require('../dist/domain/reportPeriod');

const NOW = new Date('2026-10-19T15:30:00Z');

test('defaults to the last 30 days including today', () => {
  const period = resolveReportPeriod({}, NOW);
  assert.equal(period.from, '2026-09-20');
  assert.equal(period.to, '2026-10-19');
  assert.equal(period.toExclusive.toISOString(), '2026-10-20T00:00:00.000Z');
});

test('accepts an explicit inclusive range', () => {
  const period = resolveReportPeriod({ from: '2026-10-01', to: '2026-10-01' }, NOW);
  assert.equal(period.fromDate.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(period.toExclusive.toISOString(), '2026-10-02T00:00:00.000Z');
});

test('uses 30 days before "to" when only "to" is sent', () => {
  const period = resolveReportPeriod({ to: '2026-03-31' }, NOW);
  assert.equal(period.from, '2026-03-02');
});

test('rejects bad formats and impossible dates', () => {
  assert.throws(() => resolveReportPeriod({ from: '01/10/2026' }, NOW), InvalidReportPeriodError);
  assert.throws(() => resolveReportPeriod({ from: '2026-02-31' }, NOW), /no es una fecha válida/);
  assert.throws(() => resolveReportPeriod({ from: ['2026-01-01', '2026-01-02'] }, NOW), /una sola vez/);
});

test('rejects from after to and ranges longer than a year', () => {
  assert.throws(() => resolveReportPeriod({ from: '2026-10-10', to: '2026-10-01' }, NOW), /posterior/);
  assert.throws(() => resolveReportPeriod({ from: '2024-01-01', to: '2026-01-01' }, NOW), /366 días/);
  assert.doesNotThrow(() => resolveReportPeriod({ from: '2025-10-19', to: '2026-10-19' }, NOW));
});
