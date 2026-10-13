import { pool } from '../config/db';
import { DeviceType } from '../types/catalog';

export class DeviceTypeModel {
  static async bootstrapDefaults(tenantId: string): Promise<void> {
    const client = await pool.connect();
    const defaults = [
      { code: 'REFRIGERATOR', name: 'Refrigerador', description: 'Refrigerador doméstico', brands: ['Samsung', 'LG', 'Whirlpool', 'Midea'] },
      { code: 'WASHING_MACHINE', name: 'Lavadora', description: 'Lavadora doméstica', brands: ['Samsung', 'LG', 'Whirlpool'] },
      { code: 'TV', name: 'Televisor', description: 'Televisor / Smart TV', brands: ['Samsung', 'LG', 'Sony', 'TCL'] },
      { code: 'LAPTOP', name: 'Laptop', description: 'Notebook / Laptop', brands: ['Apple', 'Dell', 'Lenovo', 'HP', 'ASUS'] },
      { code: 'SMARTPHONE', name: 'Smartphone', description: 'Celular / Smartphone', brands: ['Apple', 'Samsung', 'Xiaomi', 'Motorola'] },
      { code: 'MICROWAVE', name: 'Horno de Microondas', description: 'Horno microondas doméstico', brands: ['Whirlpool', 'LG', 'Samsung', 'Panasonic'] },
    ];
    try {
      await client.query('BEGIN');
      for (const item of defaults) {
        const typeResult = await client.query<{ id: string }>(
          `INSERT INTO device_types (tenant_id, code, name, description)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code
           RETURNING id`,
          [tenantId, item.code, item.name, item.description]
        );
        const deviceTypeId = typeResult.rows[0].id;
        for (const brand of item.brands) {
          await client.query(
            `INSERT INTO device_brands (tenant_id, device_type_id, name)
             VALUES ($1, $2, $3) ON CONFLICT (tenant_id, device_type_id, name) DO NOTHING`,
            [tenantId, deviceTypeId, brand]
          );
        }
        await client.query(
          `INSERT INTO evaluation_rules
             (tenant_id, device_type_id, version, checklist, resale_criteria, recycle_criteria)
           VALUES ($1, $2, 1,
             '[{"id":"power_on","label":"¿El equipo enciende?","type":"boolean","required":true},
               {"id":"cosmetic_condition","label":"Estado estético (1-10)","type":"number","required":true}]'::jsonb,
             '{"min_cosmetic_score":6,"must_power_on":true}'::jsonb,
             '{"accept_damaged":true,"recycle_components":true}'::jsonb)
           ON CONFLICT (device_type_id) WHERE is_active DO NOTHING`,
          [tenantId, deviceTypeId]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

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
