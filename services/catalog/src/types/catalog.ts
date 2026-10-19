export type UserRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CATALOG_ADMIN' | 'INSPECTOR' | 'CLIENT';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  email?: string;
  name?: string;
  scope?: 'tenant' | 'platform';
}

export interface DeviceReceivedPayload {
  order_id: string;
  device_type_id: string;
  device_type_name: string;
  received_at: string;
  received_by_user_id: string;
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

export interface CatalogAuditLog {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  entity_code?: string;
  action: string;
  last_received_at?: string | null;
  reason: string;
  executed_by: string;
  details?: Record<string, any>;
  created_at: string;
}

export interface InactivityCandidate {
  id: string;
  code: string;
  name: string;
  last_received_at: string | null;
  months_inactive: number;
  has_active_dependencies: boolean;
  can_deactivate: boolean;
  dependency_details?: string;
  reason: string;
}

export interface InactivityEvaluationSummary {
  tenant_id: string;
  evaluated_count: number;
  cutoff_months: number;
  cutoff_date: string;
  eligible_to_deactivate: InactivityCandidate[];
  blocked_by_dependencies: InactivityCandidate[];
  active_recent: Array<{ id: string; code: string; name: string; last_received_at?: string | null; reason: string }>;
}

export interface InactivityMaintenanceResult {
  message: string;
  total_deactivated: number;
  total_blocked: number;
  deactivated: InactivityCandidate[];
  blocked: InactivityCandidate[];
  audit_logs: CatalogAuditLog[];
  notification_sent: boolean;
  executed_by: string;
  executed_at: string;
}

