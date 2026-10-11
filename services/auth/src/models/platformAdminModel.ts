import { pool } from '../config/db';
import { PlatformAdminResponse } from '../types/auth';

interface PlatformAdminRecord extends PlatformAdminResponse {
  password_hash: string;
  is_active: boolean;
}

export class PlatformAdminModel {
  static async findActiveByEmail(email: string): Promise<PlatformAdminRecord | null> {
    const { rows } = await pool.query<PlatformAdminRecord>(
      `SELECT id, email, password_hash, name, is_active, 'SUPER_ADMIN' AS role
       FROM platform_admins
       WHERE lower(email) = lower($1) AND is_active = TRUE`,
      [email.trim()]
    );
    return rows[0] ?? null;
  }

  static async findActiveById(id: string): Promise<PlatformAdminRecord | null> {
    const { rows } = await pool.query<PlatformAdminRecord>(
      `SELECT id, email, password_hash, name, is_active, 'SUPER_ADMIN' AS role
       FROM platform_admins
       WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    return rows[0] ?? null;
  }

  static toResponse(admin: PlatformAdminRecord): PlatformAdminResponse {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: 'SUPER_ADMIN',
    };
  }
}
