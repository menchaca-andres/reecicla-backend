import { DomainEvent, InspectionCompletedPayload } from '../types/orders';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateInspectionCompletedEvent(
  event: DomainEvent<InspectionCompletedPayload>
): void {
  const payload = event.payload;
  const ids = [
    event.event_id,
    event.correlation_id,
    event.tenant_id,
    payload?.inspection_id,
    payload?.order_id,
    payload?.completed_by_user_id,
  ];
  if (
    event.event_type !== 'InspectionCompleted' ||
    ids.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
    event.correlation_id !== payload?.order_id
  ) {
    throw new Error('Evento InspectionCompleted inválido.');
  }
  if (
    payload.result !== 'RESALE' && payload.result !== 'RECYCLE' ||
    typeof payload.justification !== 'string' ||
    !payload.justification.trim() ||
    payload.justification.trim().length > 2000 ||
    typeof payload.completed_at !== 'string' ||
    !Number.isFinite(Date.parse(payload.completed_at))
  ) {
    throw new Error('El payload de InspectionCompleted está incompleto o contiene valores inválidos.');
  }
}
