export interface PricingRule {
  id: string;
  tenant_id: string;
  device_type: string;
  device_type_id: string;
  brand_id?: string | null;
  brand_name?: string | null;
  model?: string | null;
  min_year?: number | null;
  max_year?: number | null;
  version: number;
  rule_key: string;
  rule_value: Record<string, any>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PricingRuleRecord {
  id: string;
  tenant_id: string;
  device_type_id: string;
  device_type_code: string | null;
  brand_id?: string | null;
  brand_name?: string | null;
  model?: string | null;
  min_year?: number | null;
  max_year?: number | null;
  version: number;
  base_price: number | string;
  currency: string;
  condition_adjust: Record<string, number>;
  is_active: boolean;
  effective_from: Date;
  effective_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface DefinePricingRuleDTO {
  tenant_id: string;
  device_type: string;
  device_type_id?: string;
  device_type_code?: string;
  brand_id?: string;
  brand_name?: string;
  model?: string;
  min_year?: number;
  max_year?: number;
  rule_key: string;
  rule_value: Record<string, any>;
}

export interface Quote {
  id: string;
  tenant_id: string;
  user_id: string | null;
  pricing_rule_id: string;
  device_type_id: string;
  device_type_name: string;
  device_type: string;
  brand?: string;
  model?: string;
  year?: number;
  condition: string;
  base_price: number;
  adjustment: number;
  final_price: number;
  currency: string;
  quote_type: string;
  parent_quote_id?: string | null;
  adjustment_reason?: string | null;
  adjusted_quote?: Quote | null;
  adjustment_audit?: {
    outcome: 'ADJUSTED' | 'UNCHANGED';
    declared_condition: string;
    actual_condition: string;
    justification: string;
  } | null;
  valid_until: Date;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface InspectionCompletedPayload {
  inspection_id: string;
  order_id: string;
  quote_id: string;
  actual_condition: string;
  result: 'RESALE' | 'RECYCLE';
  justification: string;
  completed_by_user_id: string;
  completed_at: string;
}

export interface AdjustedQuoteDecisionPayload {
  order_id: string;
  quote_id: string;
  parent_quote_id: string;
  adjusted_price: number;
  currency: string;
  responded_by_user_id: string | null;
  responded_at: string;
}

export interface AdjustedQuoteCreatedPayload {
  order_id: string;
  quote_id: string;
  parent_quote_id: string;
  adjusted_price: number;
  currency: string;
}

export interface DomainEvent<T> {
  event_id: string;
  correlation_id: string;
  tenant_id: string;
  event_type: string;
  timestamp: string;
  payload: T;
}

export interface CreateQuoteDTO {
  tenant_id: string;
  user_id?: string | null;
  quota_reservation_id?: string;
  device_type: string;
  device_type_id?: string;
  device_type_name?: string;
  pricing_rule_id?: string;
  currency?: string;
  brand?: string;
  model?: string;
  year?: number;
  condition: string;
}

export interface AuthPayload {
  userId: string;
  tenantId: string;
  email: string;
  name?: string;
  role: string;
}
