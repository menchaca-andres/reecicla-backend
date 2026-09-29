export interface User {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  name?: string;
  phone?: string;
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
}

export interface UserResponse {
  id: string;
  tenant_id: string;
  email: string;
  name?: string;
  phone?: string;
  created_at: Date;
}
