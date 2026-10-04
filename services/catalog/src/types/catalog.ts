export type UserRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'CATALOG_ADMIN' | 'INSPECTOR' | 'CLIENT';

export interface AuthPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
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
