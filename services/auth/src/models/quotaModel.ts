import { pool } from '../config/db';

export type TenantPlanCode = 'FREE' | 'PREMIUM';

const FREE_MONTHLY_QUOTE_LIMIT = 20;

function currentUtcPeriodStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export class QuotaModel {
  static async setTenantPlan(tenantId: string, planCode: TenantPlanCode): Promise<{ tenant_id: string; plan_code: TenantPlanCode }> {
    const { rows } = await pool.query(
      `INSERT INTO tenant_plans (tenant_id, plan_code)
       SELECT id, $2 FROM tenants WHERE id = $1
       ON CONFLICT (tenant_id)
       DO UPDATE SET plan_code = EXCLUDED.plan_code, updated_at = NOW()
       RETURNING tenant_id, plan_code`,
      [tenantId, planCode]
    );
    if (!rows[0]) throw new Error('Tenant no encontrado.');
    return rows[0];
  }

  static async reserveQuote(tenantId: string, reservationId: string): Promise<{ reservation_id: string; period_start: string; plan_code: TenantPlanCode; quote_count: number }> {
    const client = await pool.connect();
    const periodStart = currentUtcPeriodStart();

    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        `SELECT r.reservation_id, r.tenant_id, r.period_start, r.status, p.plan_code, c.quote_count
         FROM quote_usage_reservations r
         JOIN tenant_plans p ON p.tenant_id = r.tenant_id
         JOIN quote_usage_counters c ON c.tenant_id = r.tenant_id AND c.period_start = r.period_start
         WHERE r.reservation_id = $1
         FOR UPDATE OF r`,
        [reservationId]
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (existing.tenant_id && existing.tenant_id !== tenantId) {
          throw new Error('La reserva de cuota pertenece a otro tenant.');
        }
        if (existing.status === 'RELEASED') {
          throw new Error('La reserva de cuota ya fue liberada.');
        }
        await client.query('COMMIT');
        return {
          reservation_id: existing.reservation_id,
          period_start: existing.period_start,
          plan_code: existing.plan_code,
          quote_count: existing.quote_count,
        };
      }

      const tenantResult = await client.query(
        `INSERT INTO tenant_plans (tenant_id, plan_code)
         SELECT id, 'FREE' FROM tenants WHERE id = $1
         ON CONFLICT (tenant_id) DO NOTHING
         RETURNING tenant_id`,
        [tenantId]
      );
      const planResult = await client.query<{ plan_code: TenantPlanCode }>(
        'SELECT plan_code FROM tenant_plans WHERE tenant_id = $1 FOR UPDATE',
        [tenantId]
      );
      if (!planResult.rows[0] && tenantResult.rowCount === 0) {
        throw new Error('Tenant no encontrado.');
      }
      const planCode = planResult.rows[0]?.plan_code ?? 'FREE';

      const counterResult = await client.query<{ quote_count: number }>(
        `INSERT INTO quote_usage_counters (tenant_id, period_start, quote_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (tenant_id, period_start)
         DO UPDATE SET quote_count = quote_usage_counters.quote_count + 1, updated_at = NOW()
         WHERE $3 = 'PREMIUM' OR quote_usage_counters.quote_count < $4
         RETURNING quote_count`,
        [tenantId, periodStart, planCode, FREE_MONTHLY_QUOTE_LIMIT]
      );
      if (!counterResult.rows[0]) {
        throw new Error('Alcanzaste el límite de 20 cotizaciones mensuales del plan gratuito. Cambia a Premium para continuar.');
      }

      await client.query(
        `INSERT INTO quote_usage_reservations (reservation_id, tenant_id, period_start)
         VALUES ($1, $2, $3)`,
        [reservationId, tenantId, periodStart]
      );
      await client.query('COMMIT');

      return {
        reservation_id: reservationId,
        period_start: periodStart,
        plan_code: planCode,
        quote_count: counterResult.rows[0].quote_count,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async finishReservation(reservationId: string, action: 'COMMIT' | 'RELEASE'): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT tenant_id, period_start, status
         FROM quote_usage_reservations WHERE reservation_id = $1 FOR UPDATE`,
        [reservationId]
      );
      const reservation = result.rows[0];
      if (!reservation) throw new Error('Reserva de cuota no encontrada.');

      if (action === 'COMMIT') {
        if (reservation.status === 'RELEASED') throw new Error('La reserva de cuota ya fue liberada.');
        await client.query(
          `UPDATE quote_usage_reservations SET status = 'COMMITTED', updated_at = NOW()
           WHERE reservation_id = $1 AND status = 'RESERVED'`,
          [reservationId]
        );
      } else if (reservation.status === 'RESERVED') {
        await client.query(
          `UPDATE quote_usage_counters
           SET quote_count = GREATEST(quote_count - 1, 0), updated_at = NOW()
           WHERE tenant_id = $1 AND period_start = $2`,
          [reservation.tenant_id, reservation.period_start]
        );
        await client.query(
          `UPDATE quote_usage_reservations SET status = 'RELEASED', updated_at = NOW()
           WHERE reservation_id = $1`,
          [reservationId]
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
}