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
           quoted_price, currency, status, customer_name, customer_email, customer_phone,
           pickup_address, accepted_at
         ) VALUES (
           $1, 'ORD-' || LPAD(nextval('order_number_seq')::text, 8, '0'),
           $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACCEPTED', $12, $13, $14, $15::jsonb, $16
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
          payload.customer_phone,
          payload.pickup_address ? JSON.stringify({ address: payload.pickup_address }) : null,
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
      `SELECT o.*,
              b.tracking_code,
              b.status AS box_status,
              b.shipped_at,
              COALESCE(
                json_agg(json_build_object(
                  'previous_status', h.previous_status,
                  'new_status', h.new_status,
                  'reason', h.reason,
                  'created_at', h.created_at
                ) ORDER BY h.created_at) FILTER (WHERE h.id IS NOT NULL), '[]'
              ) AS status_history
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT tracking_code, status, shipped_at
         FROM box_requests
         WHERE order_id = o.id AND tenant_id = o.tenant_id
         ORDER BY requested_at DESC
         LIMIT 1
       ) b ON true
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 AND o.user_id = $2
       GROUP BY o.id, b.tracking_code, b.status, b.shipped_at
       ORDER BY o.created_at DESC`,
      [tenantId, userId]
    );
    return rows;
  }

  static async listAllForTenant(tenantId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await pool.query(
      `SELECT o.*,
              b.tracking_code,
              b.status AS box_status,
              b.shipped_at,
              COALESCE(
                json_agg(json_build_object(
                  'previous_status', h.previous_status,
                  'new_status', h.new_status,
                  'reason', h.reason,
                  'created_at', h.created_at
                ) ORDER BY h.created_at) FILTER (WHERE h.id IS NOT NULL), '[]'
              ) AS status_history
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT tracking_code, status, shipped_at
         FROM box_requests
         WHERE order_id = o.id AND tenant_id = o.tenant_id
         ORDER BY requested_at DESC
         LIMIT 1
       ) b ON true
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1
       GROUP BY o.id, b.tracking_code, b.status, b.shipped_at
       ORDER BY o.created_at DESC`,
      [tenantId]
    );
    return rows;
  }

  static async findForUser(orderId: string, tenantId: string, userId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await pool.query(
      `SELECT o.*,
              b.tracking_code,
              b.status AS box_status,
              b.shipped_at,
              COALESCE(
                json_agg(json_build_object(
                  'previous_status', h.previous_status,
                  'new_status', h.new_status,
                  'reason', h.reason,
                  'created_at', h.created_at
                ) ORDER BY h.created_at) FILTER (WHERE h.id IS NOT NULL), '[]'
              ) AS status_history
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT tracking_code, status, shipped_at
         FROM box_requests
         WHERE order_id = o.id AND tenant_id = o.tenant_id
         ORDER BY requested_at DESC
         LIMIT 1
       ) b ON true
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2 AND o.user_id = $3
       GROUP BY o.id, b.tracking_code, b.status, b.shipped_at`,
      [orderId, tenantId, userId]
    );
    return rows[0] ?? null;
  }

  static async dispatchOrder(
    tenantId: string,
    orderId: string,
    operatorUserId: string,
    trackingCode: string,
    labelUrl?: string,
    newStatus: 'BOX_SHIPPED' | 'IN_TRANSIT' = 'BOX_SHIPPED'
  ): Promise<Record<string, unknown>> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        `SELECT id, status FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [orderId, tenantId]
      );
      if (orderRes.rowCount === 0) {
        throw new Error('Orden no encontrada.');
      }
      const order = orderRes.rows[0];

      await client.query(
        `UPDATE box_requests
         SET tracking_code = $1,
             label_url = COALESCE($2, label_url),
             status = 'SHIPPED',
             shipped_at = NOW(),
             updated_at = NOW()
         WHERE order_id = $3 AND tenant_id = $4`,
        [trackingCode, labelUrl || null, orderId, tenantId]
      );

      await client.query(
        `UPDATE orders
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [newStatus, orderId, tenantId]
      );

      await client.query(
        `INSERT INTO order_status_history (tenant_id, order_id, previous_status, new_status, changed_by_user, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tenantId,
          orderId,
          order.status,
          newStatus,
          operatorUserId,
          `Guía de envío registrada: ${trackingCode}`,
        ]
      );

      await client.query('COMMIT');
      return { id: orderId, status: newStatus, tracking_code: trackingCode };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

}