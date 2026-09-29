import { pool } from '../config/db';
import { User, RegisterDTO } from '../types/auth';

export class UserModel {
  static async createUser(dto: RegisterDTO, passwordHash: string): Promise<User> {
    const roleName = dto.role || 'CLIENT';
    
    // Lookup role_id from roles table
    const roleRes = await pool.query('SELECT id, name FROM roles WHERE name = $1', [roleName]);
    const roleId = roleRes.rows[0]?.id || null;

    const query = `
      INSERT INTO users (tenant_id, email, password_hash, name, phone, role_id, role)
      VALUES ($1, LOWER($2), $3, $4, $5, $6, $7)
      RETURNING id, tenant_id, email, password_hash, name, phone, role, is_active, created_at, updated_at;
    `;
    const values = [dto.tenant_id, dto.email, passwordHash, dto.name || null, dto.phone || null, roleId, roleName];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async findByEmailAndTenant(email: string, tenantId: string): Promise<User | null> {
    const query = `
      SELECT u.*, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE LOWER(u.email) = LOWER($1) AND u.tenant_id = $2 AND u.is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [email, tenantId]);
    if (!rows[0]) return null;
    const user = rows[0];
    user.role = user.role_name || user.role || 'CLIENT';
    return user;
  }

  static async findById(id: string): Promise<User | null> {
    const query = `
      SELECT u.*, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1 AND u.is_active = TRUE;
    `;
    const { rows } = await pool.query(query, [id]);
    if (!rows[0]) return null;
    const user = rows[0];
    user.role = user.role_name || user.role || 'CLIENT';
    return user;
  }
}
