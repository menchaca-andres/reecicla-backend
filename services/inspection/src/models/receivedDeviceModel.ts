import { pool } from '../config/db';
import { DeviceReceivedPayload, DomainEvent, ReceivedDevice } from '../types/inspection';
import { validateDeviceReceivedEvent } from '../domain/deviceReceived';

export class ReceivedDeviceModel {
  /** Registra el equipo recibido. Un evento repetido no duplica efectos. */
  static async registerFromEvent(event: DomainEvent<DeviceReceivedPayload>): Promise<void> {
    validateDeviceReceivedEvent(event);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const processed = await client.query(
        `INSERT INTO processed_events (event_id, event_type, tenant_id, correlation_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.event_id, event.event_type, event.tenant_id, event.correlation_id]
      );
      if (processed.rowCount === 0) {
        await client.query('COMMIT');
        return;
      }

      const payload = event.payload;
      await client.query(
        `INSERT INTO received_devices (
           tenant_id, order_id, quote_id, device_type_id, device_type_name, received_at, received_by_user
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, order_id) DO NOTHING`,
        [
          event.tenant_id,
          payload.order_id,
          payload.quote_id ?? null,
          payload.device_type_id,
          payload.device_type_name,
          payload.received_at,
          payload.received_by_user_id ?? null,
        ]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async findByOrder(tenantId: string, orderId: string): Promise<ReceivedDevice | null> {
    const { rows } = await pool.query(
      `SELECT tenant_id, order_id, quote_id, device_type_id, device_type_name, received_at, received_by_user
       FROM received_devices
       WHERE tenant_id = $1 AND order_id = $2`,
      [tenantId, orderId]
    );
    return rows[0] ?? null;
  }

  /** Equipos recibidos que todavía no tienen inspección. */
  static async listPending(tenantId: string): Promise<ReceivedDevice[]> {
    const { rows } = await pool.query(
      `SELECT r.tenant_id, r.order_id, r.quote_id, r.device_type_id, r.device_type_name, r.received_at, r.received_by_user
       FROM received_devices r
       LEFT JOIN inspections i ON i.tenant_id = r.tenant_id AND i.order_id = r.order_id
       WHERE r.tenant_id = $1 AND i.id IS NULL
       ORDER BY r.received_at`,
      [tenantId]
    );
    return rows;
  }
}
