import { DomainEvent, PaymentFailedPayload } from '../types/orders';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validatePaymentFailedEvent(
  value: unknown
): asserts value is DomainEvent<PaymentFailedPayload> {
  if (!value || typeof value !== 'object') {
    throw new Error('El evento PaymentFailed debe ser un objeto.');
  }
  const event = value as Partial<DomainEvent<PaymentFailedPayload>>;
  const payload = event.payload;
  if (
    event.event_type !== 'PaymentFailed' ||
    typeof event.event_id !== 'string' ||
    !UUID_PATTERN.test(event.event_id) ||
    typeof event.tenant_id !== 'string' ||
    !UUID_PATTERN.test(event.tenant_id) ||
    !payload ||
    typeof payload.payment_id !== 'string' ||
    !UUID_PATTERN.test(payload.payment_id) ||
    typeof payload.order_id !== 'string' ||
    !UUID_PATTERN.test(payload.order_id) ||
    event.correlation_id !== payload.order_id ||
    typeof payload.amount !== 'number' ||
    !Number.isFinite(payload.amount) ||
    payload.amount <= 0 ||
    typeof payload.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(payload.currency) ||
    !['BANK_TRANSFER', 'CHECK'].includes(payload.method) ||
    typeof payload.failure_reason !== 'string' ||
    !payload.failure_reason.trim() ||
    payload.failure_reason.length > 500 ||
    typeof payload.failed_at !== 'string' ||
    !Number.isFinite(Date.parse(payload.failed_at))
  ) {
    throw new Error('El evento PaymentFailed contiene datos inválidos.');
  }
}
