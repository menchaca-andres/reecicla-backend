import { pool } from '../config/db';
import type { PageResult, PaginationRequest } from '../utils/pagination';

export interface Device {
  id: string;
  tenant_id: string;
  device_type_id: string;
  brand_id: string;
  model: string;
  year: number | null;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: Date;
  updated_at: Date;
  device_type_name?: string;
  device_type_code?: string;
  brand_name?: string;
}

export class DeviceModel {
  static getDevices(
    tenantId: string,
    deviceTypeId?: string,
    brandId?: string,
    includeInactive?: boolean
  ): Promise<Device[]>;
  static getDevices(
    tenantId: string,
    deviceTypeId: string | undefined,
    brandId: string | undefined,
    includeInactive: boolean,
    pagination: PaginationRequest
  ): Promise<PageResult<Device>>;
  static async getDevices(
    tenantId: string,
    deviceTypeId?: string,
    brandId?: string,
    includeInactive = false,
    pagination?: PaginationRequest
  ): Promise<Device[] | PageResult<Device>> {
    let query = `
      SELECT
        d.*,
        dt.name  AS device_type_name,
        dt.code  AS device_type_code,
        db.name  AS brand_name
      FROM devices d
      JOIN device_types  dt ON dt.id = d.device_type_id
      JOIN device_brands db ON db.id = d.brand_id
      WHERE d.tenant_id = $1
    `;
    const params: any[] = [tenantId];

    if (deviceTypeId) {
      params.push(deviceTypeId);
      query += ` AND d.device_type_id = $${params.length}`;
    }

    if (brandId) {
      params.push(brandId);
      query += ` AND d.brand_id = $${params.length}`;
    }

    if (!includeInactive) {
      query += ` AND d.status = 'ACTIVE'`;
    }

    query += ` ORDER BY ${pagination ? 'd.created_at DESC, d.id DESC' : 'dt.name ASC, db.name ASC, d.model ASC'}`;

    const countConditions: string[] = ['d.tenant_id = $1'];
    const countParams: string[] = [tenantId];
    if (deviceTypeId) {
      countParams.push(deviceTypeId);
      countConditions.push(`d.device_type_id = $${countParams.length}`);
    }
    if (brandId) {
      countParams.push(brandId);
      countConditions.push(`d.brand_id = $${countParams.length}`);
    }
    if (!includeInactive) countConditions.push("d.status = 'ACTIVE'");
    const countSql = `SELECT COUNT(*) AS count FROM devices d WHERE ${countConditions.join(' AND ')}`;
    const paginatedQuery = pagination
      ? `${query} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
      : query;
    const res = await pool.query(paginatedQuery, pagination
      ? [...params, pagination.limit, pagination.offset]
      : params);
    if (!pagination) return res.rows;
    const count = await pool.query<{ count: string }>(countSql, countParams);
    return { items: res.rows, total_items: Number(count.rows[0].count) };
  }

  static async getById(id: string, tenantId: string): Promise<Device | null> {
    const res = await pool.query(
      `SELECT
         d.*,
         dt.name  AS device_type_name,
         dt.code  AS device_type_code,
         db.name  AS brand_name
       FROM devices d
       JOIN device_types  dt ON dt.id = d.device_type_id
       JOIN device_brands db ON db.id = d.brand_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, tenantId]
    );
    return res.rows[0] || null;
  }

  static async createDevice(data: {
    tenant_id: string;
    device_type_id: string;
    brand_id: string;
    model: string;
    year?: number | null;
    description?: string | null;
  }): Promise<Device> {
    const res = await pool.query(
      `INSERT INTO devices (tenant_id, device_type_id, brand_id, model, year, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.tenant_id,
        data.device_type_id,
        data.brand_id,
        data.model.trim(),
        data.year || null,
        data.description?.trim() || null,
      ]
    );
    return this.getById(res.rows[0].id, data.tenant_id) as Promise<Device>;
  }

  static async updateDevice(
    id: string,
    tenantId: string,
    data: { model?: string; year?: number | null; description?: string | null; brand_id?: string }
  ): Promise<Device | null> {
    const fields: string[] = [];
    const params: any[] = [];

    if (data.model !== undefined) {
      params.push(data.model.trim());
      fields.push(`model = $${params.length}`);
    }
    if (data.year !== undefined) {
      params.push(data.year);
      fields.push(`year = $${params.length}`);
    }
    if (data.description !== undefined) {
      params.push(data.description?.trim() || null);
      fields.push(`description = $${params.length}`);
    }
    if (data.brand_id !== undefined) {
      params.push(data.brand_id);
      fields.push(`brand_id = $${params.length}`);
    }

    if (fields.length === 0) return null;

    params.push(id, tenantId);
    const res = await pool.query(
      `UPDATE devices SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING *`,
      params
    );
    if (!res.rows[0]) return null;
    return this.getById(id, tenantId);
  }

  static async setStatus(
    id: string,
    tenantId: string,
    status: 'ACTIVE' | 'INACTIVE'
  ): Promise<Device | null> {
    const res = await pool.query(
      `UPDATE devices SET status = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [status, id, tenantId]
    );
    if (!res.rows[0]) return null;
    return this.getById(id, tenantId);
  }
}
