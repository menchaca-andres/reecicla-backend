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
  user_id: string;
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
  valid_until: Date;
  is_expired?: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateQuoteDTO {
  tenant_id: string;
  user_id: string;
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
