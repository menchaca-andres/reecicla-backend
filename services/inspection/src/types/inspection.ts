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
  timestamp: string;
  payload: T;
}

// Publicado por Orders (HU-014).
export interface DeviceReceivedPayload {
  order_id: string;
  device_type_id: string;
  device_type_name: string;
  received_at: string;
  received_by_user_id: string;
}

// Publicado por Inspection al registrar la checklist (HU-015).
export interface InspectionRegisteredPayload {
  inspection_id: string;
  order_id: string;
  device_type_id: string;
  evaluation_rule_id: string;
  evaluation_rule_version: number;
  actual_condition: string;
  inspected_by_user_id: string;
  inspected_at: string;
}

export type InspectionResult = 'RESALE' | 'RECYCLE';

export interface InspectionCompletedPayload {
  inspection_id: string;
  order_id: string;
  result: InspectionResult;
  justification: string;
  completed_by_user_id: string;
  completed_at: string;
}

export type ChecklistItemType = 'boolean' | 'number' | 'text' | 'select';

// Mismo contrato que Catalog (HU-008).
export interface ChecklistItem {
  id: string;
  label: string;
  type: ChecklistItemType;
  options?: string[];
  required: boolean;
}

export interface EvaluationRule {
  id: string;
  tenant_id: string;
  device_type_id: string;
  version: number;
  checklist: ChecklistItem[];
  is_active: boolean;
}

export type ItemValue = boolean | number | string;
export type ItemResult = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';

export interface ValidatedItem {
  criterion_key: string;
  criterion_label: string;
  criterion_type: ChecklistItemType;
  value: ItemValue;
  result: ItemResult | null;
  observation: string | null;
  evidence_refs: string[];
}

export interface ValidatedInspection {
  actual_condition: string;
  observations: string | null;
  evidence_refs: string[];
  items: ValidatedItem[];
}

export interface ReceivedDevice {
  tenant_id: string;
  order_id: string;
  device_type_id: string;
  device_type_name: string;
  received_at: Date;
  received_by_user: string | null;
}

export type InspectionStatus = 'REGISTERED' | 'COMPLETED';

export interface InspectionItem {
  id: string;
  inspection_id: string;
  criterion_key: string;
  criterion_label: string;
  criterion_type: ChecklistItemType;
  value: ItemValue;
  result: ItemResult | null;
  observation: string | null;
  evidence_refs: string[];
  created_at: Date;
}

export interface Inspection {
  id: string;
  tenant_id: string;
  order_id: string;
  device_type_id: string;
  device_type_name?: string;
  evaluation_rule_id: string;
  evaluation_rule_version: number;
  status: InspectionStatus;
  result: InspectionResult | null;
  result_justification: string | null;
  completed_by_user: string | null;
  completed_at: Date | null;
  actual_condition: string;
  observations: string | null;
  evidence_refs: string[];
  inspected_by_user: string;
  inspected_at: Date;
  created_at: Date;
  updated_at: Date;
  items?: InspectionItem[];
}
