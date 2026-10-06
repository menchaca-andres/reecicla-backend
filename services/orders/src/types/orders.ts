export interface AuthPayload {
  userId: string;
  tenantId: string;
  email: string;
  name?: string;
  role: string;
}

export interface QuoteAcceptedPayload {
  quote_id: string;
  user_id: string;
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