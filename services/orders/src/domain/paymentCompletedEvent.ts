import { DomainEvent, PaymentCompletedPayload } from '../types/orders';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validatePaymentCompletedEvent(
  value: unknown
): asserts value is DomainEvent<PaymentCompletedPayload> {
  if (!value || typeof value !== 'object') {
    throw new Error('El evento PaymentCompleted debe ser un objeto.');
  }
  const event = value as Partial<DomainEvent<PaymentCompletedPayload>>;
  const payload = event.payload;
  if (
    event.event_type !== 'PaymentCompleted' ||
    !event.event_id ||
    !UUID_PATTERN.test(event.event_id) ||
    !event.tenant_id ||
    !UUID_PATTERN.test(event.tenant_id) ||
    !payload ||
    !payload.payment_id ||
    !UUID_PATTERN.test(payload.payment_id) ||
    !payload.order_id ||
    !UUID_PATTERN.test(payload.order_id) ||
    event.correlation_id !== payload.order_id ||
    typeof payload.amount !== 'number' ||
    !Number.isFinite(payload.amount) ||
    payload.amount <= 0 ||
    typeof payload.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(payload.currency) ||
    !['BANK_TRANSFER', 'CHECK'].includes(payload.method) ||
    (payload.reference !== null && typeof payload.reference !== 'string') ||
    !payload.paid_by_user_id ||
    !UUID_PATTERN.test(payload.paid_by_user_id) ||
    typeof payload.paid_at !== 'string' ||
    !Number.isFinite(Date.parse(payload.paid_at))
  ) {
    throw new Error('El evento PaymentCompleted contiene datos inválidos.');
  }
}
