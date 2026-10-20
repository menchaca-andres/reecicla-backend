/**
 * Un evento de pago que viola una regla de negocio (orden inexistente, monto
 * distinto o estado que no admite el pago) nunca va a poder aplicarse:
 * reencolarlo solo genera reintentos infinitos. Se descarta y se registra.
 */
export class PaymentEventRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentEventRejectedError';
  }
}

export type PaymentEventErrorAction = 'discard' | 'retry';

/** Decide si un error al procesar un evento de pago es permanente o transitorio. */
export function classifyPaymentEventError(error: unknown): PaymentEventErrorAction {
  return error instanceof PaymentEventRejectedError ? 'discard' : 'retry';
}
