export interface PricingRule {
  id: string;
  tenant_id: string;
  device_type: string;
  rule_key: string;
  rule_value: Record<string, any>;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DefinePricingRuleDTO {
  tenant_id: string;
  device_type: string;
  rule_key: string;
  rule_value: Record<string, any>;
}

export interface Quote {
  id: string;
  tenant_id: string;
  user_id: string;
  device_type: string;
  brand?: string;
  model?: string;
  year?: number;
  condition: string;
  base_price: number;
  adjustment: number;
  final_price: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateQuoteDTO {
  tenant_id: string;
  user_id: string;
  device_type: string;
  brand?: string;
  model?: string;
  year?: number;
  condition: string;
}

export interface AuthPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}
