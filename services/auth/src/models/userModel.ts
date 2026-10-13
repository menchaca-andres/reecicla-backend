import { pool } from '../config/db';
import { User } from '../types/auth';

export class UserModel {
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

  static async findById(id: string): Promise<User | null> {
    const query = `
      SELECT *
      FROM users
      WHERE id = $1 AND is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] ?? null;
  }
}
