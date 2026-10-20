import { pool } from '../config/db';
import type { PageResult, PaginationRequest } from '../utils/pagination';
import type { EvaluationRule, ChecklistItem } from '../types/catalog';

export class EvaluationRuleModel {
  static async getActiveRule(tenantId: string, deviceTypeId: string): Promise<EvaluationRule | null> {
    const query = `
      SELECT er.*, dt.name AS device_type_name, dt.code AS device_type_code
      FROM evaluation_rules er
      JOIN device_types dt ON dt.id = er.device_type_id
      WHERE er.tenant_id = $1 AND er.device_type_id = $2 AND er.is_active = TRUE
      LIMIT 1
    `;
    const result = await pool.query(query, [tenantId, deviceTypeId]);
    return result.rows[0] || null;
  }

  static getRuleHistory(tenantId: string, deviceTypeId: string): Promise<EvaluationRule[]>;
  static getRuleHistory(
    tenantId: string,
    deviceTypeId: string,
    pagination: PaginationRequest
  ): Promise<PageResult<EvaluationRule>>;
  static async getRuleHistory(
    tenantId: string,
    deviceTypeId: string,
    pagination?: PaginationRequest
  ): Promise<EvaluationRule[] | PageResult<EvaluationRule>> {
    const query = `
      SELECT er.*, dt.name AS device_type_name, dt.code AS device_type_code
      FROM evaluation_rules er
      JOIN device_types dt ON dt.id = er.device_type_id
      WHERE er.tenant_id = $1 AND er.device_type_id = $2
      ORDER BY er.version DESC, er.id DESC
      ${pagination ? 'LIMIT $3 OFFSET $4' : ''}
    `;
    const result = await pool.query(
      query,
      pagination
        ? [tenantId, deviceTypeId, pagination.limit, pagination.offset]
        : [tenantId, deviceTypeId]
    );
    if (!pagination) return result.rows;
    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM evaluation_rules WHERE tenant_id = $1 AND device_type_id = $2',
      [tenantId, deviceTypeId]
    );
    return { items: result.rows, total_items: Number(count.rows[0].count) };
  }

  static async getRuleById(tenantId: string, id: string): Promise<EvaluationRule | null> {
    const query = `
      SELECT er.*, dt.name AS device_type_name, dt.code AS device_type_code
      FROM evaluation_rules er
      JOIN device_types dt ON dt.id = er.device_type_id
      WHERE er.tenant_id = $1 AND er.id = $2
    `;
    const result = await pool.query(query, [tenantId, id]);
    return result.rows[0] || null;
  }

  static async createRuleVersion(
    tenantId: string,
    deviceTypeId: string,
    checklist: ChecklistItem[],
    resaleCriteria: Record<string, any> = {},
    recycleCriteria: Record<string, any> = {}
  ): Promise<EvaluationRule> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const maxRes = await client.query(
        'SELECT COALESCE(MAX(version), 0) AS max_v FROM evaluation_rules WHERE tenant_id = $1 AND device_type_id = $2',
        [tenantId, deviceTypeId]
      );
      const nextVersion = parseInt(maxRes.rows[0].max_v, 10) + 1;

      await client.query(
        `UPDATE evaluation_rules
         SET is_active = FALSE, effective_until = NOW(), updated_at = NOW()
         WHERE tenant_id = $1 AND device_type_id = $2 AND is_active = TRUE`,
        [tenantId, deviceTypeId]
      );

      const insertQuery = `
        INSERT INTO evaluation_rules (tenant_id, device_type_id, version, checklist, resale_criteria, recycle_criteria, is_active, effective_from)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, TRUE, NOW())
        RETURNING *
      `;
      const insertRes = await client.query(insertQuery, [
        tenantId,
        deviceTypeId,
        nextVersion,
        JSON.stringify(checklist),
        JSON.stringify(resaleCriteria),
        JSON.stringify(recycleCriteria),
      ]);

      await client.query('COMMIT');
      return insertRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
