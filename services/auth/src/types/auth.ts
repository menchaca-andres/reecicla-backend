export interface User {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  name?: string;
  phone?: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RegisterDTO {
  tenant_id: string;
  email: string;
  password: string;
  name?: string;
  phone?: string;
  role?: string;
}

export interface CreateAdminDTO {
  tenant_id: string;
  email: string;
  password: string;
  name?: string;
  phone?: string;
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
  role: string;
}

export interface UserResponse {
  id: string;
  tenant_id: string;
  email: string;
  name?: string;
  phone?: string;
  role: string;
  created_at: Date;
}
