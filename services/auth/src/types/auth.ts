export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTenantDTO {
  name: string;
  slug: string;
  email: string;
  password: string;
  admin_name?: string;
  phone?: string;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  name: string;
  phone?: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type UserRole =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'CATALOG_ADMIN'
  | 'INSPECTOR'
  | 'CLIENT';

export interface RegisterDTO {
  tenant_id: string;
  email: string;
  password: string;
  name?: string;
  phone?: string;
}

export interface CreateAdminDTO {
  tenant_id: string;
  email: string;
  password: string;
  name?: string;
  phone?: string;
  role?: UserRole; // permite crear TENANT_ADMIN, CATALOG_ADMIN, INSPECTOR
}

export interface LoginDTO {
  tenant_id: string;
  email: string;
  password: string;
}

export interface AuthPayload {
  userId: string;
  tenantId: string;
  email: string;
  name?: string;
  role: UserRole;
}

export interface UserResponse {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  created_at: Date;
}
