import { PaymentMethod } from '../types/payment';

export interface PayoutConfirmation {
  reference: string | null;
  paidAt: Date;
}

export interface PayoutAdapter {
  confirm(method: PaymentMethod, reference?: string): Promise<PayoutConfirmation>;
}

export type PayoutAttemptResult =
  | { status: 'COMPLETED'; confirmation: PayoutConfirmation }
  | { status: 'FAILED'; failureReason: string };

export async function attemptPayout(
  adapter: PayoutAdapter,
  method: PaymentMethod,
  reference?: string
): Promise<PayoutAttemptResult> {
  try {
    return {
      status: 'COMPLETED',
      confirmation: await adapter.confirm(method, reference),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.trim() : '';
    return {
      status: 'FAILED',
      failureReason: (message || 'El proveedor de pago rechazó la operación.').slice(0, 500),
    };
  }
}

export class SimulatedPayoutAdapter implements PayoutAdapter {
  async confirm(method: PaymentMethod, reference?: string): Promise<PayoutConfirmation> {
    const normalizedReference = reference?.trim();
    if (method === 'CHECK' && !normalizedReference) {
      throw new Error('La referencia o número de cheque es obligatorio.');
    }
    return {
      reference: normalizedReference || null,
      paidAt: new Date(),
    };
  }
}
