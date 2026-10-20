import { PoolClient } from 'pg';
import { pool } from '../config/db';
import { ReportAggregates } from '../domain/reportSummary';
import { DomainEvent, Projection, ReportPeriod } from '../types/reporting';

export class ReportModel {
  /**
   * Proyecta un evento en una transacción. Devuelve false si el evento ya se
   * había procesado (redelivery del broker o publicación repetida del outbox).
   */
  static async applyEvent(event: DomainEvent<unknown>, projection: Projection): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const processed = await client.query(
        `INSERT INTO processed_events (event_id, event_type, tenant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.event_id, event.event_type, event.tenant_id]
      );
      if (processed.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await ReportModel.project(client, projection);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private static async project(client: PoolClient, projection: Projection): Promise<void> {
    switch (projection.kind) {
      case 'quote': {
        const q = projection.data;
        // El WHERE descarta eventos más viejos que el estado ya proyectado.
        await client.query(
          `INSERT INTO report_quotes (
             tenant_id, quote_id, quote_type, status, device_type_id, device_type_name,
             final_price, currency, quote_created_at, last_changed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (tenant_id, quote_id) DO UPDATE SET
             quote_type = EXCLUDED.quote_type,
             status = EXCLUDED.status,
             device_type_id = COALESCE(EXCLUDED.device_type_id, report_quotes.device_type_id),
             device_type_name = COALESCE(EXCLUDED.device_type_name, report_quotes.device_type_name),
             final_price = EXCLUDED.final_price,
             currency = EXCLUDED.currency,
             last_changed_at = EXCLUDED.last_changed_at,
             updated_at = NOW()
           WHERE report_quotes.last_changed_at <= EXCLUDED.last_changed_at`,
          [q.tenantId, q.quoteId, q.quoteType, q.status, q.deviceTypeId, q.deviceTypeName,
            q.finalPrice, q.currency, q.quoteCreatedAt, q.changedAt]
        );
        return;
      }
      case 'order': {
        const o = projection.data;
        await client.query(
          `INSERT INTO report_orders (
             tenant_id, order_id, order_number, status, device_type_id, device_type_name,
             quoted_price, final_price, currency, order_created_at, last_changed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (tenant_id, order_id) DO UPDATE SET
             order_number = COALESCE(EXCLUDED.order_number, report_orders.order_number),
             status = EXCLUDED.status,
             device_type_id = COALESCE(EXCLUDED.device_type_id, report_orders.device_type_id),
             device_type_name = COALESCE(EXCLUDED.device_type_name, report_orders.device_type_name),
             quoted_price = COALESCE(EXCLUDED.quoted_price, report_orders.quoted_price),
             final_price = COALESCE(EXCLUDED.final_price, report_orders.final_price),
             currency = EXCLUDED.currency,
             last_changed_at = EXCLUDED.last_changed_at,
             updated_at = NOW()
           WHERE report_orders.last_changed_at <= EXCLUDED.last_changed_at`,
          [o.tenantId, o.orderId, o.orderNumber, o.status, o.deviceTypeId, o.deviceTypeName,
            o.quotedPrice, o.finalPrice, o.currency, o.orderCreatedAt, o.changedAt]
        );
        return;
      }
      case 'payment': {
        const p = projection.data;
        // Un intento de pago termina en COMPLETED o FAILED una sola vez;
        // si llegara repetido con otro event_id, se conserva el primero.
        await client.query(
          `INSERT INTO report_payments (
             tenant_id, payment_id, order_id, method, status, amount, currency,
             failure_reason, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, payment_id) DO NOTHING`,
          [p.tenantId, p.paymentId, p.orderId, p.method, p.status, p.amount, p.currency,
            p.failureReason, p.occurredAt]
        );
        return;
      }
      case 'disposition': {
        const d = projection.data;
        await client.query(
          `INSERT INTO report_dispositions (tenant_id, disposition_id, order_id, type, completed_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, disposition_id) DO NOTHING`,
          [d.tenantId, d.dispositionId, d.orderId, d.type, d.completedAt]
        );
        return;
      }
    }
  }

  /** Agregaciones del reporte, siempre filtradas por el tenant del token. */
  static async getAggregates(tenantId: string, period: ReportPeriod): Promise<ReportAggregates> {
    const range = [tenantId, period.fromDate, period.toExclusive];
    const [quotes, ordersInPeriod, ordersCurrent, payments, dispositions, lastEvent] = await Promise.all([
      pool.query(
        `SELECT quote_type, status, currency, device_type_name,
                COUNT(*)::int AS count, COALESCE(SUM(final_price), 0)::float8 AS amount
         FROM report_quotes
         WHERE tenant_id = $1 AND quote_created_at >= $2 AND quote_created_at < $3
         GROUP BY quote_type, status, currency, device_type_name`,
        range
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM report_orders
         WHERE tenant_id = $1 AND order_created_at >= $2 AND order_created_at < $3
         GROUP BY status`,
        range
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM report_orders
         WHERE tenant_id = $1
         GROUP BY status`,
        [tenantId]
      ),
      pool.query(
        `SELECT method, status, currency,
                COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float8 AS amount
         FROM report_payments
         WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
         GROUP BY method, status, currency`,
        range
      ),
      pool.query(
        `SELECT type, COUNT(*)::int AS count
         FROM report_dispositions
         WHERE tenant_id = $1 AND completed_at >= $2 AND completed_at < $3
         GROUP BY type`,
        range
      ),
      pool.query(
        'SELECT MAX(processed_at) AS last_event_at FROM processed_events WHERE tenant_id = $1',
        [tenantId]
      ),
    ]);

    return {
      quotes: quotes.rows,
      ordersInPeriod: ordersInPeriod.rows,
      ordersCurrent: ordersCurrent.rows,
      payments: payments.rows,
      dispositions: dispositions.rows,
      lastEventAt: lastEvent.rows[0]?.last_event_at ?? null,
    };
  }
}
