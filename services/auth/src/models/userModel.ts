import { pool } from '../config/db';
import { User, RegisterDTO } from '../types/auth';

export class UserModel {
  static async createUser(dto: RegisterDTO, passwordHash: string): Promise<User> {
    const query = `
      INSERT INTO users (tenant_id, email, password_hash, name, phone)
      VALUES ($1, LOWER($2), $3, $4, $5)
      RETURNING id, tenant_id, email, password_hash, name, phone, is_active, created_at, updated_at;
    `;
    const values = [dto.tenant_id, dto.email, passwordHash, dto.name || null, dto.phone || null];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async findByEmailAndTenant(email: string, tenantId: string): Promise<User | null> {
    const query = `
      SELECT * FROM users
      WHERE LOWER(email) = LOWER($1) AND tenant_id = $2 AND is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [email, tenantId]);
    return rows[0] || null;
  }

  static async findById(id: string): Promise<User | null> {
    const query = `
      SELECT * FROM users WHERE id = $1 AND is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }
}
