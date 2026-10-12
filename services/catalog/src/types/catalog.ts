export type UserRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CATALOG_ADMIN' | 'INSPECTOR' | 'CLIENT';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  scope?: 'tenant' | 'platform';
}

export type DeviceTypeStatus = 'ACTIVE' | 'INACTIVE';

export interface DeviceType {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description?: string;
  status: DeviceTypeStatus;
  accepts_quotes: boolean;
  last_received_at?: string;
  created_at: string;
  updated_at: string;
  inactivated_at?: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  type: 'boolean' | 'number' | 'text' | 'select';
  options?: string[];
  required: boolean;
}

export interface EvaluationRule {
  id: string;
  tenant_id: string;
  device_type_id: string;
  version: number;
  checklist: ChecklistItem[];
  resale_criteria: Record<string, any>;
  recycle_criteria: Record<string, any>;
  is_active: boolean;
  effective_from: string;
  effective_until?: string | null;
  created_at: string;
  updated_at: string;
  device_type_name?: string;
  device_type_code?: string;
}
