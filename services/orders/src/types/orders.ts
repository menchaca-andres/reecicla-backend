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

export interface GuestOrderTracking {
  order_number: string;
  quote_id: string;
  device_type_name: string;
  brand: string | null;
  model: string | null;
  device_year: number | null;
  declared_condition: string;
  quoted_price: number | string;
  currency: string;
  status: string;
  customer_name: string;
  customer_phone: string | null;
  accepted_at: string;
  tracking_code: string | null;
  box_status: string | null;
  shipped_at: string | null;
  status_history: Array<{
    previous_status: string | null;
    new_status: string;
    reason: string | null;
    created_at: string;
  }>;
  notifications: OrderNotification[];
}

export interface OrderNotification {
  notification_type: string;
  channel: 'EMAIL';
  sent_at: string;
}

export interface DomainEvent<T> {
  event_id: string;
  correlation_id: string;
  tenant_id: string;
  event_type: string;
  timestamp: string;
  payload: T;
}

export interface DeviceReceivedPayload {
  order_id: string;
  quote_id?: string;
  device_type_id: string;
  device_type_name: string;
  received_at: string;
  received_by_user_id: string;
}

export interface InspectionCompletedPayload {
  inspection_id: string;
  order_id: string;
  quote_id: string | null;
  actual_condition: string;
  result: 'RESALE' | 'RECYCLE';
  justification: string;
  completed_by_user_id: string;
  completed_at: string;
}

export interface AdjustedQuoteEventPayload {
  order_id: string;
  quote_id: string;
  parent_quote_id: string;
  adjusted_price: number;
  currency: string;
  responded_by_user_id?: string | null;
  responded_at?: string;
}

export interface PaymentCompletedPayload {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  method: 'BANK_TRANSFER' | 'CHECK';
  reference: string | null;
  paid_by_user_id: string;
  paid_at: string;
}

export interface PaymentFailedPayload {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  method: 'BANK_TRANSFER' | 'CHECK';
  failure_reason: string;
  failed_at: string;
}

export type AdjustmentResolution = 'RETURN' | 'RECYCLE';

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
