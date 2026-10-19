const assert = require('node:assert/strict');
const { test } = require('node:test');
const { SimulatedPayoutAdapter } = require('../dist/domain/payoutAdapter');

test('confirms transfer with an optional reference and records its time', async () => {
  const adapter = new SimulatedPayoutAdapter();
  const confirmation = await adapter.confirm('BANK_TRANSFER');
  assert.equal(confirmation.reference, null);
  assert.ok(confirmation.paidAt instanceof Date);
});

test('requires a cheque reference', async () => {
  const adapter = new SimulatedPayoutAdapter();
  await assert.rejects(adapter.confirm('CHECK'), /referencia o número de cheque es obligatorio/);
  const confirmation = await adapter.confirm('CHECK', 'CHQ-123');
  assert.equal(confirmation.reference, 'CHQ-123');
});
