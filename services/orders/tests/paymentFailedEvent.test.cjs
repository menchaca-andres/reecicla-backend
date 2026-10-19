const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validatePaymentFailedEvent } = require('../dist/domain/paymentFailedEvent');

const event = {
  event_id: '9f95a05d-c6fc-45dd-9d89-df5f8191e14e',
  correlation_id: 'bf39014a-6f18-4ff7-a8a7-8ff8ab94277d',
  tenant_id: 'cba8f143-2cec-45a1-b4ba-55ca2c41d41c',
  event_type: 'PaymentFailed',
  timestamp: '2026-10-18T12:00:00.000Z',
  payload: {
    payment_id: '79fbec1c-9dcb-48df-9862-a25cc1e1ad47',
    order_id: 'bf39014a-6f18-4ff7-a8a7-8ff8ab94277d',
    amount: 125.5,
    currency: 'BOB',
    method: 'BANK_TRANSFER',
    failure_reason: 'Transferencia rechazada por el proveedor.',
    failed_at: '2026-10-18T12:00:00.000Z',
  },
};

test('accepts a valid PaymentFailed event', () => {
  assert.doesNotThrow(() => validatePaymentFailedEvent(event));
});

test('rejects failure events without a valid reason or matching order correlation', () => {
  assert.throws(
    () => validatePaymentFailedEvent({ ...event, correlation_id: 'wrong' }),
    /datos inválidos/
  );
  assert.throws(
    () => validatePaymentFailedEvent({
      ...event,
      payload: { ...event.payload, failure_reason: '   ' },
    }),
    /datos inválidos/
  );
});
