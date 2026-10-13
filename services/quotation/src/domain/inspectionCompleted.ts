import { DomainEvent, InspectionCompletedPayload } from '../types/quotation';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONDITIONS = new Set(['working', 'damaged', 'broken']);

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
    payload?.quote_id,
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
    typeof payload.actual_condition !== 'string' ||
    !CONDITIONS.has(payload.actual_condition.toLowerCase()) ||
    (payload.result !== 'RESALE' && payload.result !== 'RECYCLE') ||
    typeof payload.justification !== 'string' ||
    !payload.justification.trim() ||
    payload.justification.trim().length > 2000 ||
    typeof payload.completed_at !== 'string' ||
    !Number.isFinite(Date.parse(payload.completed_at))
  ) {
    throw new Error('El payload de InspectionCompleted está incompleto o contiene valores inválidos.');
  }
}

export interface AdjustedPrice {
  adjustment: number;
  finalPrice: number;
}

const DEFAULT_CONDITION_ADJUSTMENTS: Record<string, number> = {
  working: 0,
  damaged: -40,
  broken: -80,
};

export function calculateAdjustedPrice(
  basePrice: number,
  adjustments: Record<string, number | string>,
  actualCondition: string
): AdjustedPrice {
  const adjustment = Number(
    adjustments[actualCondition.toLowerCase()] ??
    DEFAULT_CONDITION_ADJUSTMENTS[actualCondition.toLowerCase()]
  );
  if (!Number.isFinite(basePrice) || basePrice < 0 || !Number.isFinite(adjustment)) {
    throw new Error('La regla de valoración contiene precios inválidos.');
  }
  return {
    adjustment,
    finalPrice: Math.max(0, basePrice + adjustment),
  };
}

export function buildAdjustmentJustification(
  declaredCondition: string,
  actualCondition: string
): string {
  return `La condición declarada (${declaredCondition}) difiere de la condición real verificada (${actualCondition}).`;
}
