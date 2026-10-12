import { pool } from '../config/db';
import { DomainError } from '../domain/errors';
import {
  Inspection,
  InspectionItem,
  InspectionRegisteredPayload,
  ValidatedInspection,
} from '../types/inspection';

export interface CreateInspectionInput {
  tenantId: string;
  orderId: string;
  deviceTypeId: string;
  evaluationRuleId: string;
  evaluationRuleVersion: number;
  inspectorUserId: string;
  data: ValidatedInspection;
}

const INSPECTION_COLUMNS = `
  i.id, i.tenant_id, i.order_id, i.device_type_id, r.device_type_name,
  i.evaluation_rule_id, i.evaluation_rule_version, i.status, i.result,
  i.actual_condition, i.observations, i.evidence_refs, i.inspected_by_user,
  i.inspected_at, i.created_at, i.updated_at`;

export class InspectionModel {
  /** Guarda inspección, ítems y evento InspectionRegistered en una sola transacción. */
  static async create(input: CreateInspectionInput): Promise<Inspection> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inserted = await client.query(
        `INSERT INTO inspections (
           tenant_id, order_id, device_type_id, evaluation_rule_id, evaluation_rule_version,
           actual_condition, observations, evidence_refs, inspected_by_user
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (tenant_id, order_id) DO NOTHING
         RETURNING id, inspected_at`,
        [
          input.tenantId,
          input.orderId,
          input.deviceTypeId,
          input.evaluationRuleId,
          input.evaluationRuleVersion,
          input.data.actual_condition,
          input.data.observations,
          JSON.stringify(input.data.evidence_refs),
          input.inspectorUserId,
        ]
      );
      if (!inserted.rows[0]) {
        throw new DomainError(409, 'La orden ya tiene una inspección registrada.');
      }
      const inspectionId: string = inserted.rows[0].id;
      const inspectedAt: Date = inserted.rows[0].inspected_at;

      for (const item of input.data.items) {
        await client.query(
          `INSERT INTO inspection_items (
             inspection_id, criterion_key, criterion_label, criterion_type,
             value, result, observation, evidence_refs
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb)`,
          [
            inspectionId,
            item.criterion_key,
            item.criterion_label,
            item.criterion_type,
            JSON.stringify(item.value),
            item.result,
            item.observation,
            JSON.stringify(item.evidence_refs),
          ]
        );
      }

      const payload: InspectionRegisteredPayload = {
        inspection_id: inspectionId,
        order_id: input.orderId,
        device_type_id: input.deviceTypeId,
        evaluation_rule_id: input.evaluationRuleId,
        evaluation_rule_version: input.evaluationRuleVersion,
        actual_condition: input.data.actual_condition,
        inspected_by_user_id: input.inspectorUserId,
        inspected_at: inspectedAt.toISOString(),
      };
      // correlation_id = order_id: mantiene la traza iniciada por Orders.
      await client.query(
        `INSERT INTO domain_event_outbox (
           tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
         ) VALUES ($1, $2, $3, 'InspectionRegistered', 'inspection.registered', $4::jsonb)
         ON CONFLICT (aggregate_id, event_type) DO NOTHING`,
        [input.tenantId, inspectionId, input.orderId, JSON.stringify(payload)]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const created = await InspectionModel.findByOrder(input.tenantId, input.orderId);
    if (!created) throw new Error('La inspección no pudo recuperarse tras guardarla.');
    return created;
  }

  static async findByOrder(tenantId: string, orderId: string): Promise<Inspection | null> {
    const { rows } = await pool.query(
      `SELECT ${INSPECTION_COLUMNS}
       FROM inspections i
       JOIN received_devices r ON r.tenant_id = i.tenant_id AND r.order_id = i.order_id
       WHERE i.tenant_id = $1 AND i.order_id = $2`,
      [tenantId, orderId]
    );
    const inspection: Inspection | undefined = rows[0];
    if (!inspection) return null;

    const items = await pool.query<InspectionItem>(
      `SELECT id, inspection_id, criterion_key, criterion_label, criterion_type,
              value, result, observation, evidence_refs, created_at
       FROM inspection_items
       WHERE inspection_id = $1
       ORDER BY created_at, criterion_key`,
      [inspection.id]
    );
    inspection.items = items.rows;
    return inspection;
  }

  static async listForTenant(tenantId: string): Promise<Inspection[]> {
    const { rows } = await pool.query(
      `SELECT ${INSPECTION_COLUMNS}
       FROM inspections i
       JOIN received_devices r ON r.tenant_id = i.tenant_id AND r.order_id = i.order_id
       WHERE i.tenant_id = $1
       ORDER BY i.inspected_at DESC`,
      [tenantId]
    );
    return rows;
  }
}
