import {
  DispositionType,
  DomainEvent,
  PaymentStatus,
  Projection,
  QuoteStatus,
  QuoteType,
} from '../types/reporting';

// Routing keys que alimentan el read model (documento oficial, sección 5.2).
export const REPORTING_ROUTING_KEYS = [
  'quote.status.changed',
  'order.status.changed',
  'payment.completed',
  'payment.failed',
  'disposition.completed',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUOTE_TYPES: QuoteType[] = ['INITIAL', 'ADJUSTED'];
const QUOTE_STATUSES: QuoteStatus[] = ['ANONYMOUS', 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
const DISPOSITION_TYPES: DispositionType[] = ['RESALE', 'RECYCLE', 'RETURN'];

export class InvalidReportingEventError extends Error {}

type Payload = Record<string, unknown>;

function fail(message: string): never {
  throw new InvalidReportingEventError(message);
}

function uuid(payload: Payload, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || !UUID_RE.test(value)) fail(`${field} debe ser un UUID.`);
  return value;
}

function optionalUuid(payload: Payload, field: string): string | null {
  const value = payload[field];
  if (value === null || value === undefined) return null;
  return uuid(payload, field);
}

function text(payload: Payload, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} es obligatorio.`);
  return value.trim();
}

function optionalText(payload: Payload, field: string): string | null {
  const value = payload[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') fail(`${field} debe ser texto.`);
  return value.trim() || null;
}

function amount(payload: Payload, field: string): number {
  const value = Number(payload[field]);
  if (payload[field] === null || payload[field] === undefined || !Number.isFinite(value) || value < 0) {
    fail(`${field} debe ser un monto válido.`);
  }
  return value;
}

function optionalAmount(payload: Payload, field: string): number | null {
  if (payload[field] === null || payload[field] === undefined) return null;
  return amount(payload, field);
}

function timestamp(payload: Payload, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${field} debe ser una fecha válida.`);
  return new Date(value).toISOString();
}

function currency(payload: Payload): string {
  const value = optionalText(payload, 'currency');
  return value ? value.toUpperCase().slice(0, 3) : 'BOB';
}

function oneOf<T extends string>(payload: Payload, field: string, allowed: readonly T[]): T {
  const value = text(payload, field) as T;
  if (!allowed.includes(value)) fail(`${field} no es válido: ${value}.`);
  return value;
}

export function validateEnvelope(event: Partial<DomainEvent<unknown>>): asserts event is DomainEvent<Payload> {
  if (!event || typeof event !== 'object') fail('Evento vacío.');
  if (typeof event.event_id !== 'string' || !UUID_RE.test(event.event_id)) fail('event_id debe ser un UUID.');
  if (typeof event.tenant_id !== 'string' || !UUID_RE.test(event.tenant_id)) fail('tenant_id debe ser un UUID.');
  if (typeof event.event_type !== 'string' || !event.event_type) fail('event_type es obligatorio.');
  if (!event.payload || typeof event.payload !== 'object') fail('payload es obligatorio.');
}

/**
 * Traduce un evento del broker a la fila que debe proyectarse en REPORTING DB.
 * Lanza InvalidReportingEventError si el evento no cumple el contrato.
 */
export function toProjection(routingKey: string, event: DomainEvent<Payload>): Projection {
  const p = event.payload;
  const tenantId = event.tenant_id;

  switch (routingKey) {
    case 'quote.status.changed':
      return {
        kind: 'quote',
        data: {
          tenantId,
          quoteId: uuid(p, 'quote_id'),
          quoteType: oneOf(p, 'quote_type', QUOTE_TYPES),
          status: oneOf(p, 'status', QUOTE_STATUSES),
          deviceTypeId: optionalUuid(p, 'device_type_id'),
          deviceTypeName: optionalText(p, 'device_type_name'),
          finalPrice: amount(p, 'final_price'),
          currency: currency(p),
          quoteCreatedAt: timestamp(p, 'quote_created_at'),
          changedAt: timestamp(p, 'changed_at'),
        },
      };
    case 'order.status.changed':
      return {
        kind: 'order',
        data: {
          tenantId,
          orderId: uuid(p, 'order_id'),
          orderNumber: optionalText(p, 'order_number'),
          status: text(p, 'status').toUpperCase(),
          deviceTypeId: optionalUuid(p, 'device_type_id'),
          deviceTypeName: optionalText(p, 'device_type_name'),
          quotedPrice: optionalAmount(p, 'quoted_price'),
          finalPrice: optionalAmount(p, 'final_price'),
          currency: currency(p),
          orderCreatedAt: timestamp(p, 'order_created_at'),
          changedAt: timestamp(p, 'changed_at'),
        },
      };
    case 'payment.completed':
    case 'payment.failed': {
      const status: PaymentStatus = routingKey === 'payment.completed' ? 'COMPLETED' : 'FAILED';
      return {
        kind: 'payment',
        data: {
          tenantId,
          paymentId: uuid(p, 'payment_id'),
          orderId: uuid(p, 'order_id'),
          method: text(p, 'method').toUpperCase(),
          status,
          amount: amount(p, 'amount'),
          currency: currency(p),
          failureReason: status === 'FAILED' ? optionalText(p, 'failure_reason') : null,
          occurredAt: timestamp(p, status === 'COMPLETED' ? 'paid_at' : 'failed_at'),
        },
      };
    }
    case 'disposition.completed':
      return {
        kind: 'disposition',
        data: {
          tenantId,
          dispositionId: uuid(p, 'disposition_id'),
          orderId: uuid(p, 'order_id'),
          type: oneOf(p, 'type', DISPOSITION_TYPES),
          completedAt: timestamp(p, 'completed_at'),
        },
      };
    default:
      fail(`Routing key no soportada por Reporting: ${routingKey}.`);
  }
}
