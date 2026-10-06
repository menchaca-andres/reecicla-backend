import { pool } from '../config/db';
import { DomainEvent, QuoteAcceptedPayload } from '../types/orders';
import { validateQuoteAcceptedEvent } from '../domain/quoteAccepted';

export class OrderModel {
  static async createFromAcceptedQuote(event: DomainEvent<QuoteAcceptedPayload>): Promise<void> {
    validateQuoteAcceptedEvent(event);

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
      const orderResult = await client.query(
        `INSERT INTO orders (
           tenant_id, order_number, user_id, quote_id, device_type_id,
           device_type_name, brand, model, device_year, declared_condition,
           quoted_price, currency, status, customer_name, customer_email, accepted_at
         ) VALUES (
           $1, 'ORD-' || LPAD(nextval('order_number_seq')::text, 8, '0'),
           $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACCEPTED', $12, $13, $14
         )
         ON CONFLICT (tenant_id, quote_id) DO NOTHING
         RETURNING id, tenant_id, status`,
        [
          event.tenant_id,
          payload.user_id,
          payload.quote_id,
          payload.device_type_id,
          payload.device_type_name,
          payload.brand,
          payload.model,
          payload.year,
          payload.condition,
          payload.quoted_price,
          payload.currency,
          payload.customer_name,
          payload.customer_email,
          payload.accepted_at,
        ]
      );

      if (orderResult.rows[0]) {
        await client.query(
          `INSERT INTO order_status_history (tenant_id, order_id, previous_status, new_status, changed_by_user, reason)
           VALUES ($1, $2, NULL, 'ACCEPTED', $3, 'Orden creada al aceptar la cotización')`,
          [event.tenant_id, orderResult.rows[0].id, payload.user_id]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async listForUser(tenantId: string, userId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await pool.query(
      `SELECT o.*, COALESCE(
         json_agg(json_build_object(
           'previous_status', h.previous_status,
           'new_status', h.new_status,
           'reason', h.reason,
           'created_at', h.created_at
         ) ORDER BY h.created_at) FILTER (WHERE h.id IS NOT NULL), '[]'
       ) AS status_history
       FROM orders o
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 AND o.user_id = $2
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [tenantId, userId]
    );
    return rows;
  }

  static async findForUser(orderId: string, tenantId: string, userId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await pool.query(
      `SELECT o.*, COALESCE(
         json_agg(json_build_object(
           'previous_status', h.previous_status,
           'new_status', h.new_status,
           'reason', h.reason,
           'created_at', h.created_at
         ) ORDER BY h.created_at) FILTER (WHERE h.id IS NOT NULL), '[]'
       ) AS status_history
       FROM orders o
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2 AND o.user_id = $3
       GROUP BY o.id`,
      [orderId, tenantId, userId]
    );
    return rows[0] ?? null;
  }
}