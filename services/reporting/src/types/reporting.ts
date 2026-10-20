export interface AuthPayload {
  userId: string;
  tenantId: string;
  email: string;
  name?: string;
  role: string;
}

export interface DomainEvent<T> {
  event_id: string;
  correlation_id: string;
  tenant_id: string;
  event_type: string;
  timestamp?: string;
  payload: T;
}

export type QuoteType = 'INITIAL' | 'ADJUSTED';
export type QuoteStatus = 'ANONYMOUS' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export type PaymentStatus = 'COMPLETED' | 'FAILED';
export type DispositionType = 'RESALE' | 'RECYCLE' | 'RETURN';

// Proyecciones: lo que el consumidor escribe en REPORTING DB.
export interface QuoteProjection {
  tenantId: string;
  quoteId: string;
  quoteType: QuoteType;
  status: QuoteStatus;
  deviceTypeId: string | null;
  deviceTypeName: string | null;
  finalPrice: number;
  currency: string;
  quoteCreatedAt: string;
  changedAt: string;
}

export interface OrderProjection {
  tenantId: string;
  orderId: string;
  orderNumber: string | null;
  status: string;
  deviceTypeId: string | null;
  deviceTypeName: string | null;
  quotedPrice: number | null;
  finalPrice: number | null;
  currency: string;
  orderCreatedAt: string;
  changedAt: string;
}

export interface PaymentProjection {
  tenantId: string;
  paymentId: string;
  orderId: string;
  method: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  failureReason: string | null;
  occurredAt: string;
}

export interface DispositionProjection {
  tenantId: string;
  dispositionId: string;
  orderId: string;
  type: DispositionType;
  completedAt: string;
}

export type Projection =
  | { kind: 'quote'; data: QuoteProjection }
  | { kind: 'order'; data: OrderProjection }
  | { kind: 'payment'; data: PaymentProjection }
  | { kind: 'disposition'; data: DispositionProjection };

// Periodo del reporte: [from, toExclusive).
export interface ReportPeriod {
  from: string;
  to: string;
  fromDate: Date;
  toExclusive: Date;
}

export type AmountsByCurrency = Record<string, number>;

export interface ReportSummary {
  tenant_id: string;
  period: { from: string; to: string };
  generated_at: string;
  last_event_at: string | null;
  quotes: {
    total: number;
    by_status: Record<QuoteStatus, number>;
    by_type: Record<QuoteType, number>;
    acceptance_rate: number;
    quoted_amount: AmountsByCurrency;
    accepted_amount: AmountsByCurrency;
    by_device_type: Array<{ device_type_name: string; total: number; accepted: number }>;
  };
  orders: {
    created_in_period: number;
    by_status_in_period: Record<string, number>;
    current_by_status: Record<string, number>;
  };
  payments: {
    completed: number;
    failed: number;
    completed_amount: AmountsByCurrency;
    by_method: Record<string, { completed: number; failed: number; amount: AmountsByCurrency }>;
  };
  dispositions: {
    total: number;
    by_type: Record<DispositionType, number>;
  };
}
