import { pool } from '../config/db';
import { DeviceType } from '../types/catalog';

export class DeviceTypeModel {
  static async getDeviceTypes(tenantId: string, includeInactive = false): Promise<DeviceType[]> {
    const query = includeInactive
      ? 'SELECT * FROM device_types WHERE tenant_id = $1 ORDER BY name ASC'
      : "SELECT * FROM device_types WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY name ASC";
    const res = await pool.query(query, [tenantId]);
    return res.rows;
  }

  static async getDeviceTypeById(tenantId: string, id: string): Promise<DeviceType | null> {
    const res = await pool.query(
      'SELECT * FROM device_types WHERE id = $1 AND tenant_id = $2',
      [id, tenantId]
    );
    return res.rows[0] || null;
  }

  static async createDeviceType(data: {
    tenant_id: string;
    code: string;
    name: string;
    description?: string;
    accepts_quotes?: boolean;
  }): Promise<DeviceType> {
    const { tenant_id, code, name, description, accepts_quotes = true } = data;
    const res = await pool.query(
      `INSERT INTO device_types (tenant_id, code, name, description, accepts_quotes, status)
       VALUES ($1, UPPER($2), $3, $4, $5, 'ACTIVE')
       RETURNING *`,
      [tenant_id, code, name, description || null, accepts_quotes]
    );
    return res.rows[0];
  }

  static async updateDeviceType(
    id: string,
    tenantId: string,
    data: {
      name?: string;
      description?: string;
      accepts_quotes?: boolean;
      status?: 'ACTIVE' | 'INACTIVE';
    }
  ): Promise<DeviceType | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.accepts_quotes !== undefined) {
      fields.push(`accepts_quotes = $${idx++}`);
      values.push(data.accepts_quotes);
    }
    if (data.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(data.status);
      if (data.status === 'INACTIVE') {
        fields.push(`inactivated_at = NOW()`);
      } else {
        fields.push(`inactivated_at = NULL`);
      }
    }

    if (fields.length === 0) return this.getDeviceTypeById(tenantId, id);

    values.push(id, tenantId);
    const query = `
      UPDATE device_types
      SET ${fields.join(', ')}
      WHERE id = $${idx++} AND tenant_id = $${idx}
      RETURNING *
    `;

    const res = await pool.query(query, values);
    return res.rows[0] || null;
  }

  static async inactivateDeviceType(id: string, tenantId: string): Promise<DeviceType | null> {
    const res = await pool.query(
      `UPDATE device_types
       SET status = 'INACTIVE', inactivated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, tenantId]
    );
    return res.rows[0] || null;
  }
}
