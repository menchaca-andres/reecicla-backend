const assert = require('node:assert/strict');
const { test } = require('node:test');
const { originalPriceWasConfirmed } = require('../dist/domain/inspectionPayment');

test('confirms the originally accepted quote only for an unchanged resale condition', () => {
  assert.equal(originalPriceWasConfirmed('Working', ' working ', 'RESALE'), true);
  assert.equal(originalPriceWasConfirmed('Working', 'Damaged', 'RESALE'), false);
  assert.equal(originalPriceWasConfirmed('Working', 'Working', 'RECYCLE'), false);
  assert.equal(originalPriceWasConfirmed(null, 'Working', 'RESALE'), false);
});
