const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  InvalidReportingEventError,
  REPORTING_ROUTING_KEYS,
  toProjection,
  validateEnvelope,
} = require('../dist/domain/projections');

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333';
const DISPOSITION_ID = '44444444-4444-4444-8444-444444444444';

function envelope(payload, eventType = 'Test') {
  return {
    event_id: '55555555-5555-4555-8555-555555555555',
    correlation_id: ORDER_ID,
    tenant_id: TENANT_ID,
    event_type: eventType,
    payload,
  };
}

test('listens to the five routing keys of the business report', () => {
  assert.deepEqual([...REPORTING_ROUTING_KEYS].sort(), [
    'disposition.completed',
    'order.status.changed',
    'payment.completed',
    'payment.failed',
    'quote.status.changed',
  ]);
});

test('projects quote.status.changed into a quote row', () => {
  const projection = toProjection('quote.status.changed', envelope({
    quote_id: QUOTE_ID,
    quote_type: 'INITIAL',
    previous_status: 'PENDING',
    status: 'ACCEPTED',
    device_type_id: null,
    device_type_name: 'Refrigerador',
    final_price: '850.50',
    currency: 'bob',
    quote_created_at: '2026-10-01T10:00:00Z',
    changed_at: '2026-10-02T10:00:00Z',
  }));
  assert.equal(projection.kind, 'quote');
  assert.equal(projection.data.tenantId, TENANT_ID);
  assert.equal(projection.data.status, 'ACCEPTED');
  assert.equal(projection.data.finalPrice, 850.5);
  assert.equal(projection.data.currency, 'BOB');
  assert.equal(projection.data.changedAt, '2026-10-02T10:00:00.000Z');
});

test('rejects quote events with unknown status', () => {
  assert.throws(
    () => toProjection('quote.status.changed', envelope({
      quote_id: QUOTE_ID,
      quote_type: 'INITIAL',
      status: 'LOST',
      final_price: 10,
      quote_created_at: '2026-10-01T10:00:00Z',
      changed_at: '2026-10-01T10:00:00Z',
    })),
    InvalidReportingEventError
  );
});

test('projects order.status.changed keeping prices optional', () => {
  const projection = toProjection('order.status.changed', envelope({
    order_id: ORDER_ID,
    order_number: 'ORD-00000001',
    previous_status: null,
    status: 'accepted',
    device_type_id: '66666666-6666-4666-8666-666666666666',
    device_type_name: 'Lavadora',
    quoted_price: 500,
    final_price: null,
    currency: 'BOB',
    order_created_at: '2026-10-03T10:00:00Z',
    changed_at: '2026-10-03T10:00:01Z',
  }));
  assert.equal(projection.kind, 'order');
  assert.equal(projection.data.status, 'ACCEPTED');
  assert.equal(projection.data.finalPrice, null);
  assert.equal(projection.data.quotedPrice, 500);
});

test('projects completed and failed payments with their own timestamps', () => {
  const completed = toProjection('payment.completed', envelope({
    payment_id: PAYMENT_ID,
    order_id: ORDER_ID,
    amount: 300,
    currency: 'BOB',
    method: 'BANK_TRANSFER',
    reference: null,
    paid_by_user_id: ORDER_ID,
    paid_at: '2026-10-05T12:00:00Z',
  }));
  assert.equal(completed.data.status, 'COMPLETED');
  assert.equal(completed.data.occurredAt, '2026-10-05T12:00:00.000Z');
  assert.equal(completed.data.failureReason, null);

  const failed = toProjection('payment.failed', envelope({
    payment_id: PAYMENT_ID,
    order_id: ORDER_ID,
    amount: 300,
    currency: 'BOB',
    method: 'CHECK',
    failure_reason: 'Banco rechazó la transferencia',
    failed_at: '2026-10-05T13:00:00Z',
  }));
  assert.equal(failed.data.status, 'FAILED');
  assert.equal(failed.data.method, 'CHECK');
  assert.equal(failed.data.failureReason, 'Banco rechazó la transferencia');
});

test('rejects payments with negative amounts', () => {
  assert.throws(
    () => toProjection('payment.completed', envelope({
      payment_id: PAYMENT_ID,
      order_id: ORDER_ID,
      amount: -1,
      method: 'CHECK',
      paid_at: '2026-10-05T12:00:00Z',
    })),
    /monto válido/
  );
});

test('projects disposition.completed for RESALE, RECYCLE and RETURN only', () => {
  const projection = toProjection('disposition.completed', envelope({
    disposition_id: DISPOSITION_ID,
    order_id: ORDER_ID,
    type: 'RECYCLE',
    reference: 'CERT-1',
    completed_at: '2026-10-06T09:00:00Z',
  }));
  assert.equal(projection.kind, 'disposition');
  assert.equal(projection.data.type, 'RECYCLE');

  const returned = toProjection('disposition.completed', envelope({
    disposition_id: DISPOSITION_ID,
    order_id: ORDER_ID,
    type: 'RETURN',
    completed_at: '2026-10-06T09:00:00Z',
  }));
  assert.equal(returned.data.type, 'RETURN');

  assert.throws(
    () => toProjection('disposition.completed', envelope({
      disposition_id: DISPOSITION_ID,
      order_id: ORDER_ID,
      type: 'DONATE',
      completed_at: '2026-10-06T09:00:00Z',
    })),
    InvalidReportingEventError
  );
});

test('rejects unsupported routing keys and malformed envelopes', () => {
  assert.throws(() => toProjection('auth.user.registered', envelope({})), /no soportada/);
  assert.throws(() => validateEnvelope({ event_id: 'x', tenant_id: TENANT_ID, event_type: 'A', payload: {} }), /event_id/);
  assert.throws(() => validateEnvelope({ ...envelope({}), tenant_id: undefined }), /tenant_id/);
  assert.throws(() => validateEnvelope({ ...envelope({}), payload: null }), /payload/);
});
