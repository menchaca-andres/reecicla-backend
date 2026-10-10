export interface AuthPayload {
  userId: string;
  tenantId: string;
  email: string;
  name?: string;
  role: string;
}

export interface QuoteAcceptedPayload {
  quote_id: string;
  user_id: string | null;
  device_type_id: string;
  device_type_name: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  condition: string;
  quoted_price: number;
  currency: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  pickup_address: string | null;
  accepted_at: string;
}

export interface DomainEvent<T> {
  event_id: string;
  correlation_id: string;
  tenant_id: string;
  event_type: string;
  timestamp: string;
  payload: T;
}

export type BoxRequestStatus = 'REQUESTED' | 'SHIPPED' | 'DELIVERED' | 'LOST' | 'CANCELLED';

export interface BoxRequest {
  id: string;
  tenant_id: string;
  order_id: string;
  tracking_code: string | null;
  label_url: string | null;
  status: BoxRequestStatus;
  requested_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateBoxRequestInput {
  street: string;
  city: string;
  state?: string;
  zip_code?: string;
  country?: string;
  notes?: string;
}