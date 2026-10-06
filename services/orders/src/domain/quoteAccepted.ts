import { DomainEvent, QuoteAcceptedPayload } from '../types/orders';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateQuoteAcceptedEvent(event: DomainEvent<QuoteAcceptedPayload>): void {
  const payload = event.payload;
  const ids = [event.event_id, event.correlation_id, event.tenant_id, payload.quote_id, payload.user_id, payload.device_type_id];
  if (event.event_type !== 'QuoteAccepted' || ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('Evento QuoteAccepted inválido.');
  }
  if (
    !payload.device_type_name || !payload.condition || !payload.customer_name || !payload.customer_email ||
    !/^[A-Z]{3}$/.test(payload.currency) || !Number.isFinite(Number(payload.quoted_price)) ||
    Number(payload.quoted_price) < 0 ||
    (payload.year !== null && payload.year !== undefined && (!Number.isInteger(payload.year) || payload.year < 1800 || payload.year > 2200))
  ) {
    throw new Error('El payload de QuoteAccepted está incompleto o contiene valores inválidos.');
  }
}