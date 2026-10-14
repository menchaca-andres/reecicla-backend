import { pool } from '../config/db';
import { ClientTenantSummary, User } from '../types/auth';

export class UserModel {
  static async findActiveClientTenantsByEmail(email: string): Promise<ClientTenantSummary[]> {
    const { rows } = await pool.query<ClientTenantSummary>(
      `SELECT DISTINCT t.name, t.slug
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE LOWER(u.email) = LOWER($1)
         AND u.role = 'CLIENT'
         AND u.is_active = TRUE
         AND t.status = 'ACTIVE'
       ORDER BY t.name`,
      [email.trim()]
    );
    return rows;
  }

  static async createUser(
    dto: { tenant_id: string; email: string; name?: string; phone?: string; role: string },
    passwordHash: string
  ): Promise<User> {
    const query = `
      INSERT INTO users (tenant_id, email, password_hash, name, phone, role)
      VALUES ($1, LOWER($2), $3, $4, $5, $6)
      RETURNING id, tenant_id, email, password_hash, name, phone, role, is_active, created_at, updated_at;
    `;
    const values = [
      dto.tenant_id,
      dto.email,
      passwordHash,
      dto.name || '',
      dto.phone || null,
      dto.role,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async findByEmailAndTenant(email: string, tenantId: string): Promise<User | null> {
    const query = `
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER($1) AND tenant_id = $2 AND is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [email, tenantId]);
    return rows[0] ?? null;
  }

  static async findAnyByEmailAndTenant(email: string, tenantId: string): Promise<User | null> {
    const query = `
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER($1) AND tenant_id = $2;
    `;
    const { rows } = await pool.query(query, [email, tenantId]);
    return rows[0] ?? null;
  }

  static async findById(id: string, tenantId: string): Promise<User | null> {
    const query = `
      SELECT *
      FROM users
      WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [id, tenantId]);
    return rows[0] ?? null;
  }

  static async updateClientProfile(
    id: string,
    tenantId: string,
    profile: { name: string; phone: string; pickup_address: string }
  ): Promise<User | null> {
    const { rows } = await pool.query<User>(
      `UPDATE users
       SET name = $3, phone = NULLIF($4, ''), pickup_address = NULLIF($5, '')
       WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE
       RETURNING id, tenant_id, email, password_hash, name, phone, pickup_address,
                 role, is_active, created_at, updated_at`,
      [id, tenantId, profile.name, profile.phone, profile.pickup_address]
    );
    return rows[0] ?? null;
  }
}
