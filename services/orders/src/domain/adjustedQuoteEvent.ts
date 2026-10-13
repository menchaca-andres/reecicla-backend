import { AdjustedQuoteEventPayload, DomainEvent } from '../types/orders';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPES = ['AdjustedQuoteCreated', 'AdjustedQuoteAccepted', 'AdjustedQuoteRejected'];

export function validateAdjustedQuoteEvent(
  event: DomainEvent<AdjustedQuoteEventPayload>
): void {
  const payload = event.payload;
  const ids = [
    event.event_id,
    event.correlation_id,
    event.tenant_id,
    payload?.order_id,
    payload?.quote_id,
    payload?.parent_quote_id,
  ];
  if (
    !EVENT_TYPES.includes(event.event_type) ||
    ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
    event.correlation_id !== payload?.order_id
  ) {
    throw new Error('Evento de cotización ajustada inválido.');
  }
  if (
    typeof payload.adjusted_price !== 'number' ||
    !Number.isFinite(payload.adjusted_price) ||
    payload.adjusted_price < 0 ||
    !/^[A-Z]{3}$/.test(payload.currency)
  ) {
    throw new Error('El payload de cotización ajustada está incompleto o es inválido.');
  }
  if (
    event.event_type !== 'AdjustedQuoteCreated' &&
    (typeof payload.responded_at !== 'string' || !Number.isFinite(Date.parse(payload.responded_at)))
  ) {
    throw new Error('La respuesta de cotización ajustada no tiene una fecha válida.');
  }
  if (
    payload.responded_by_user_id !== undefined &&
    payload.responded_by_user_id !== null &&
    !UUID_PATTERN.test(payload.responded_by_user_id)
  ) {
    throw new Error('El usuario de respuesta de cotización ajustada no es válido.');
  }
}
