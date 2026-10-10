import { pool } from '../config/db';
import { CreateTenantDTO, UserResponse } from '../types/auth';

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
}

export class TenantModel {
  static async findActiveBySlug(slug: string): Promise<TenantSummary | undefined> {
    const { rows } = await pool.query<TenantSummary>(
      `SELECT id, name, slug, status, created_at
       FROM tenants WHERE slug = $1 AND status = 'ACTIVE'`,
      [slug]
    );
    return rows[0];
  }

  static async list(): Promise<TenantSummary[]> {
    const { rows } = await pool.query<TenantSummary>(
      'SELECT id, name, slug, status, created_at FROM tenants ORDER BY name'
    );
    return rows;
  }

  static async createWithAdmin(dto: CreateTenantDTO, passwordHash: string): Promise<{ tenant: TenantSummary; admin: UserResponse }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenantResult = await client.query<TenantSummary>(
        `INSERT INTO tenants (name, slug) VALUES ($1, $2)
         RETURNING id, name, slug, status, created_at`,
        [dto.name.trim(), dto.slug]
      );
      const tenant = tenantResult.rows[0];
      const adminResult = await client.query<UserResponse>(
        `INSERT INTO users (tenant_id, email, password_hash, name, phone, role)
         VALUES ($1, lower($2), $3, $4, $5, 'TENANT_ADMIN')
         RETURNING id, tenant_id, email, name, phone, role, created_at`,
        [tenant.id, dto.email.trim(), passwordHash, dto.admin_name?.trim() ?? '', dto.phone?.trim() || null]
      );
      await client.query('COMMIT');
      return { tenant, admin: adminResult.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
