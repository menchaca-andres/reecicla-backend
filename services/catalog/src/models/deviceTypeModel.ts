import { pool } from '../config/db';
import {
  DeviceType,
  CatalogAuditLog,
  InactivityCandidate,
  InactivityEvaluationSummary,
  InactivityMaintenanceResult,
} from '../types/catalog';
import { publishEvent } from '../messaging/eventBus';

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

  private static async fetchActiveDependencies(
    tenantId: string,
    deviceTypeIds: string[]
  ): Promise<Record<string, { pending_orders: number; physical_stock: number; has_active_dependencies: boolean; details: string }>> {
    const ordersServiceUrl = process.env.ORDERS_SERVICE_URL || 'http://orders-service:3004';
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN || 'super_secret_internal_token_reecicla_2026';

    try {
      const url = `${ordersServiceUrl}/api/orders/internal/active-dependencies?tenant_id=${encodeURIComponent(tenantId)}&device_type_ids=${encodeURIComponent(deviceTypeIds.join(','))}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-internal-service-token': internalToken,
          'x-tenant-id': tenantId,
        },
      });

      if (!response.ok) {
        console.warn(`[Catalog] orders-service respondió con status ${response.status} al verificar dependencias.`);
        return {};
      }

      const data = await response.json() as { dependencies?: Record<string, any> };
      return data.dependencies || {};
    } catch (error) {
      console.error('[Catalog] Error al contactar orders-service para verificar dependencias activas:', error);
      return {};
    }
  }

  private static async notifyAdminsOfMaintenance(
    tenantId: string,
    summary: {
      totalDeactivated: number;
      totalBlocked: number;
      deactivatedItems: Array<{ code: string; name: string; last_received_at?: string; reason: string }>;
      blockedItems: Array<{ code: string; name: string; alert: string }>;
      executedBy: string;
      executedAt: string;
    }
  ): Promise<boolean> {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN || 'super_secret_internal_token_reecicla_2026';

    try {
      const url = `${authServiceUrl}/api/auth/internal/notify-catalog-maintenance`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-service-token': internalToken,
        },
        body: JSON.stringify({ tenant_id: tenantId, summary }),
      });
      return response.ok;
    } catch (error) {
      console.error('[Catalog] Error al notificar a los administradores vía auth-service:', error);
      return false;
    }
  }

  static async evaluateInactivity(
    tenantId: string,
    cutoffMonths = 12
  ): Promise<InactivityEvaluationSummary> {
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setMonth(cutoffDate.getMonth() - cutoffMonths);

    const typesRes = await pool.query<DeviceType>(
      `SELECT * FROM device_types WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY name ASC`,
      [tenantId]
    );

    const activeTypes = typesRes.rows;
    const potentialInactive: Array<{
      type: DeviceType;
      monthsInactive: number;
      lastReceivedDate: string | null;
      reason: string;
    }> = [];
    const activeRecent: Array<{ id: string; code: string; name: string; last_received_at?: string | null; reason: string }> = [];

    for (const dt of activeTypes) {
      const lastRec = dt.last_received_at ? new Date(dt.last_received_at) : null;
      const created = new Date(dt.created_at);

      if (lastRec) {
        const diffMs = now.getTime() - lastRec.getTime();
        const months = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375));
        if (lastRec <= cutoffDate) {
          potentialInactive.push({
            type: dt,
            monthsInactive: months,
            lastReceivedDate: dt.last_received_at || null,
            reason: `Sin recepciones durante ${months} meses (última recepción registrada: ${lastRec.toLocaleDateString()})`,
          });
        } else {
          activeRecent.push({
            id: dt.id,
            code: dt.code,
            name: dt.name,
            last_received_at: dt.last_received_at,
            reason: `Recepción reciente registrada hace ${months} mes(es)`,
          });
        }
      } else {
        // Sin recepciones registradas. Se evalúa el tiempo desde su creación en catálogo.
        const diffMs = now.getTime() - created.getTime();
        const months = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375));
        if (created <= cutoffDate) {
          potentialInactive.push({
            type: dt,
            monthsInactive: months,
            lastReceivedDate: null,
            reason: `Sin ninguna recepción registrada desde su creación en catálogo hace ${months} meses`,
          });
        } else {
          activeRecent.push({
            id: dt.id,
            code: dt.code,
            name: dt.name,
            last_received_at: null,
            reason: `Creado recientemente (hace ${months} mes(es)) sin recepciones aún`,
          });
        }
      }
    }

    // CA03: Verificar dependencias activas (stock físico disponible u órdenes en proceso)
    const eligibleToDeactivate: InactivityCandidate[] = [];
    const blockedByDependencies: InactivityCandidate[] = [];

    if (potentialInactive.length > 0) {
      const candidateIds = potentialInactive.map((p) => p.type.id);
      const dependencies = await this.fetchActiveDependencies(tenantId, candidateIds);

      for (const item of potentialInactive) {
        const dep = dependencies[item.type.id];
        if (dep && dep.has_active_dependencies) {
          blockedByDependencies.push({
            id: item.type.id,
            code: item.type.code,
            name: item.type.name,
            last_received_at: item.lastReceivedDate,
            months_inactive: item.monthsInactive,
            has_active_dependencies: true,
            can_deactivate: false,
            dependency_details: dep.details,
            reason: `No se puede desactivar: ${dep.details}. Debe mantenerse activo hasta que el stock llegue a cero y se concluyan los pedidos (CA03).`,
          });
        } else {
          eligibleToDeactivate.push({
            id: item.type.id,
            code: item.type.code,
            name: item.type.name,
            last_received_at: item.lastReceivedDate,
            months_inactive: item.monthsInactive,
            has_active_dependencies: false,
            can_deactivate: true,
            reason: item.reason,
          });
        }
      }
    }

    return {
      tenant_id: tenantId,
      evaluated_count: activeTypes.length,
      cutoff_months: cutoffMonths,
      cutoff_date: cutoffDate.toISOString(),
      eligible_to_deactivate: eligibleToDeactivate,
      blocked_by_dependencies: blockedByDependencies,
      active_recent: activeRecent,
    };
  }

  static async executeInactivityDeactivation(
    tenantId: string,
    executedBy = 'SYSTEM_JOB',
    cutoffMonths = 12
  ): Promise<InactivityMaintenanceResult> {
    const evaluation = await this.evaluateInactivity(tenantId, cutoffMonths);
    const executionTimestamp = new Date().toISOString();

    if (evaluation.eligible_to_deactivate.length === 0) {
      return {
        message: 'Evaluación completada. No se encontraron tipos de equipo elegibles para desactivar.',
        total_deactivated: 0,
        total_blocked: evaluation.blocked_by_dependencies.length,
        deactivated: [],
        blocked: evaluation.blocked_by_dependencies,
        audit_logs: [],
        notification_sent: false,
        executed_by: executedBy,
        executed_at: executionTimestamp,
      };
    }

    const client = await pool.connect();
    const auditLogs: CatalogAuditLog[] = [];
    const deactivatedList: InactivityCandidate[] = [];

    try {
      await client.query('BEGIN');

      for (const candidate of evaluation.eligible_to_deactivate) {
        const updRes = await client.query<DeviceType>(
          `UPDATE device_types
           SET status = 'INACTIVE',
               accepts_quotes = false,
               inactivated_at = NOW(),
               updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2 AND status = 'ACTIVE'
           RETURNING *`,
          [candidate.id, tenantId]
        );

        if (updRes.rowCount && updRes.rowCount > 0) {
          deactivatedList.push(candidate);
          const auditRes = await client.query<CatalogAuditLog>(
            `INSERT INTO catalog_audit_logs (
               tenant_id, entity_type, entity_id, entity_name, entity_code,
               action, last_received_at, reason, executed_by, details
             ) VALUES ($1, 'device_types', $2, $3, $4, 'DEACTIVATED_INACTIVITY', $5, $6, $7, $8::jsonb)
             RETURNING *`,
            [
              tenantId,
              candidate.id,
              candidate.name,
              candidate.code,
              candidate.last_received_at ? new Date(candidate.last_received_at) : null,
              candidate.reason,
              executedBy,
              JSON.stringify({
                months_inactive: candidate.months_inactive,
                cutoff_months: cutoffMonths,
                execution_type: executedBy === 'SYSTEM_JOB' || executedBy.startsWith('SYSTEM') ? 'AUTOMATIC' : 'ASSISTED',
              }),
            ]
          );
          auditLogs.push(auditRes.rows[0]);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Publicar evento en RabbitMQ (TE-02)
    try {
      await publishEvent('catalog.inactivity.deactivated', {
        event_type: 'DeviceTypesInactivatedDueToInactivity',
        tenant_id: tenantId,
        payload: {
          tenant_id: tenantId,
          total_deactivated: deactivatedList.length,
          deactivated_ids: deactivatedList.map((d) => d.id),
          executed_by: executedBy,
          executed_at: executionTimestamp,
        },
      });
    } catch (eventErr) {
      console.error('[Catalog] Error publicando evento de inactivación por inactividad:', eventErr);
    }

    // CA04: Notificación resumen a administradores
    const notificationSummary = {
      totalDeactivated: deactivatedList.length,
      totalBlocked: evaluation.blocked_by_dependencies.length,
      deactivatedItems: deactivatedList.map((d) => ({
        code: d.code,
        name: d.name,
        last_received_at: d.last_received_at || undefined,
        reason: d.reason,
      })),
      blockedItems: evaluation.blocked_by_dependencies.map((b) => ({
        code: b.code,
        name: b.name,
        alert: b.dependency_details || b.reason,
      })),
      executedBy,
      executedAt: executionTimestamp,
    };

    const notificationSent = await this.notifyAdminsOfMaintenance(tenantId, notificationSummary);

    return {
      message: `Mantenimiento completado. Se desactivaron ${deactivatedList.length} tipo(s) de equipo sin recepciones en ${cutoffMonths} meses.`,
      total_deactivated: deactivatedList.length,
      total_blocked: evaluation.blocked_by_dependencies.length,
      deactivated: deactivatedList,
      blocked: evaluation.blocked_by_dependencies,
      audit_logs: auditLogs,
      notification_sent: notificationSent,
      executed_by: executedBy,
      executed_at: executionTimestamp,
    };
  }

  static async getAuditLogs(tenantId: string, limit = 50): Promise<CatalogAuditLog[]> {
    const res = await pool.query<CatalogAuditLog>(
      `SELECT * FROM catalog_audit_logs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit]
    );
    return res.rows;
  }
}

