import { PaymentMethod } from '../types/payment';

export interface PayoutConfirmation {
  reference: string | null;
  paidAt: Date;
}

export interface PayoutAdapter {
  confirm(method: PaymentMethod, reference?: string): Promise<PayoutConfirmation>;
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
