export type PaymentMethod = 'BANK_TRANSFER' | 'CHECK';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  email: string;
  name?: string;
  role: string;
}

export interface AuthorizedOrder {
  id: string;
  tenant_id: string;
  user_id: string | null;
  order_number: string;
  amount: number | string;
  currency: string;
  status: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  order_id: string;
  amount: number | string;
  currency: string;
  method: PaymentMethod;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  reference: string | null;
  failure_reason?: string | null;
  paid_by_user_id: string;
  paid_by_user_name?: string | null;
  paid_at: string | null;
  created_at: string;
  internal_receipt_path?: string | null;
  internal_receipt_mime_type?: string | null;
  internal_receipt_sha256?: string | null;
  external_receipt_path?: string | null;
  external_receipt_mime_type?: string | null;
  external_receipt_sha256?: string | null;
}

export interface PaymentCompletedPayload {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  paid_by_user_id: string;
  paid_at: string;
}

export interface PaymentFailedPayload {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  failure_reason: string;
  failed_at: string;
}

export interface DomainEvent<T> {
  event_id: string;
  correlation_id: string;
  tenant_id: string;
  event_type: string;
  timestamp: string;
  payload: T;
}
