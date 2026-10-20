const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  PaymentEventRejectedError,
  classifyPaymentEventError,
} = require('../dist/domain/paymentEventRejection');

test('discards payment events that violate a business rule instead of requeueing them', () => {
  const error = new PaymentEventRejectedError('La orden ya no está pendiente de pago.');
  assert.equal(error.name, 'PaymentEventRejectedError');
  assert.equal(classifyPaymentEventError(error), 'discard');
});

test('retries transient errors such as database failures or concurrent state changes', () => {
  assert.equal(classifyPaymentEventError(new Error('connect ECONNREFUSED 172.19.0.5:5432')), 'retry');
  assert.equal(classifyPaymentEventError(new Error('La orden cambió de estado mientras se procesaba el pago.')), 'retry');
  assert.equal(classifyPaymentEventError('unknown'), 'retry');
});
