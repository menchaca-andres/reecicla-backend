import { pool } from '../config/db';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export class TenantModel {
  static async findBySlug(slug: string): Promise<Tenant | null> {
    const query = `
      SELECT id, name, slug, status, created_at, updated_at
      FROM tenants
      WHERE slug = $1 AND status = 'ACTIVE';
    `;
    const { rows } = await pool.query(query, [slug]);
    return rows[0] ?? null;
  }
}
