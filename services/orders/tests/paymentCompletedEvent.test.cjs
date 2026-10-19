const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validatePaymentCompletedEvent } = require('../dist/domain/paymentCompletedEvent');

const event = {
  event_id: '9f95a05d-c6fc-45dd-9d89-df5f8191e14e',
  correlation_id: 'bf39014a-6f18-4ff7-a8a7-8ff8ab94277d',
  tenant_id: 'cba8f143-2cec-45a1-b4ba-55ca2c41d41c',
  event_type: 'PaymentCompleted',
  timestamp: '2026-01-01T12:00:00.000Z',
  payload: {
    payment_id: '79fbec1c-9dcb-48df-9862-a25cc1e1ad47',
    order_id: 'bf39014a-6f18-4ff7-a8a7-8ff8ab94277d',
    amount: 125.5,
    currency: 'BOB',
    method: 'BANK_TRANSFER',
    reference: 'TRX-123',
    paid_by_user_id: 'aa0ba5e1-a118-4565-8e3b-b4c53b14b532',
    paid_at: '2026-01-01T12:00:00.000Z',
  },
};

test('accepts a valid PaymentCompleted event', () => {
  assert.doesNotThrow(() => validatePaymentCompletedEvent(event));
});

test('rejects malformed payment identifiers, amount, or correlation', () => {
  assert.throws(() => validatePaymentCompletedEvent(null), /debe ser un objeto/);
  assert.throws(
    () => validatePaymentCompletedEvent({ ...event, correlation_id: 'wrong' }),
    /datos inválidos/
  );
  assert.throws(
    () => validatePaymentCompletedEvent({ ...event, payload: { ...event.payload, amount: '125.50' } }),
    /datos inválidos/
  );
  assert.throws(
    () => validatePaymentCompletedEvent({ ...event, payload: { ...event.payload, payment_id: 'not-a-uuid' } }),
    /datos inválidos/
  );
});

test('accepts canonical UUIDs that use a nonstandard version or variant', () => {
  const legacyUuidEvent = {
    ...event,
    tenant_id: '11111111-1111-0111-0111-111111111111',
  };
  assert.doesNotThrow(() => validatePaymentCompletedEvent(legacyUuidEvent));
});
