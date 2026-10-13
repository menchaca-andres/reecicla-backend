import { pool } from '../config/db';

export interface DeviceBrand {
  id: string;
  tenant_id: string;
  device_type_id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
}

export class DeviceBrandModel {
  static async getBrands(
    tenantId: string,
    deviceTypeId?: string,
    includeInactive = false
  ): Promise<DeviceBrand[]> {
    let query = `
      SELECT b.*
      FROM device_brands b
      WHERE b.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (deviceTypeId) {
      params.push(deviceTypeId);
      query += ` AND b.device_type_id = $${params.length}`;
    }

    if (!includeInactive) {
      query += ` AND b.status = 'ACTIVE'`;
    }

    query += ` ORDER BY b.name ASC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  static async createBrand(
    tenantId: string,
    deviceTypeId: string,
    name: string
  ): Promise<DeviceBrand> {
    const res = await pool.query(
      `INSERT INTO device_brands (tenant_id, device_type_id, name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [tenantId, deviceTypeId, name]
    );
    return res.rows[0];
  }

  static async updateBrand(
    id: string,
    tenantId: string,
    name: string
  ): Promise<DeviceBrand | null> {
    const res = await pool.query(
      `UPDATE device_brands
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [name, id, tenantId]
    );
    return res.rows[0] || null;
  }

  static async setBrandStatus(
    id: string,
    tenantId: string,
    status: 'ACTIVE' | 'INACTIVE'
  ): Promise<DeviceBrand | null> {
    const res = await pool.query(
      `UPDATE device_brands
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [status, id, tenantId]
    );
    return res.rows[0] || null;
  }
}
