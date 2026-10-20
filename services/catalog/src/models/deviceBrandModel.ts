import { pool } from '../config/db';
import type { PageResult, PaginationRequest } from '../utils/pagination';

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
  static getBrands(
    tenantId: string,
    deviceTypeId?: string,
    includeInactive?: boolean
  ): Promise<DeviceBrand[]>;
  static getBrands(
    tenantId: string,
    deviceTypeId: string | undefined,
    includeInactive: boolean,
    pagination: PaginationRequest
  ): Promise<PageResult<DeviceBrand>>;
  static async getBrands(
    tenantId: string,
    deviceTypeId?: string,
    includeInactive = false,
    pagination?: PaginationRequest
  ): Promise<DeviceBrand[] | PageResult<DeviceBrand>> {
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

    query += ` ORDER BY ${pagination ? 'b.created_at DESC, b.id DESC' : 'b.name ASC'}`;

    const countParams = [tenantId];
    if (deviceTypeId) {
      countParams.push(deviceTypeId);
    }
    const paginatedQuery = pagination
      ? `${query} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
      : query;
    const res = await pool.query(paginatedQuery, pagination
      ? [...params, pagination.limit, pagination.offset]
      : params);
    if (!pagination) return res.rows;
    const countSql = `SELECT COUNT(*) AS count FROM device_brands b
      WHERE b.tenant_id = $1
      ${deviceTypeId ? 'AND b.device_type_id = $2' : ''}
      ${includeInactive ? '' : "AND b.status = 'ACTIVE'"}`;
    const count = await pool.query<{ count: string }>(countSql, countParams);
    return { items: res.rows, total_items: Number(count.rows[0].count) };
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
