import { pool } from '../config/db';
import { Quote, CreateQuoteDTO } from '../types/quotation';
import { randomUUID } from 'crypto';

export class QuoteModel {
  static async createQuote(
    dto: CreateQuoteDTO,
    basePrice: number,
    adjustment: number,
    finalPrice: number
  ): Promise<Quote> {
    const query = `
      INSERT INTO quotes (
        tenant_id, user_id, quota_reservation_id, pricing_rule_id, device_type_id, device_type_name,
        brand, model, year, condition, base_price, adjustment, final_price,
        currency, valid_until, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        NOW() + INTERVAL '30 days', 'PENDING')
      ON CONFLICT (quota_reservation_id) DO NOTHING
      RETURNING *, device_type_name AS device_type;
    `;
    const values = [
      dto.tenant_id,
      dto.user_id,
      dto.quota_reservation_id || null,
      dto.pricing_rule_id,
      dto.device_type_id,
      dto.device_type_name,
      dto.brand || null,
      dto.model || null,
      dto.year || null,
      dto.condition,
      basePrice,
      adjustment,
      finalPrice,
      dto.currency || 'BOB',
    ];
    const { rows } = await pool.query(query, values);
    if (rows[0]) return rows[0];
    const existing = await pool.query(
      'SELECT *, device_type_name AS device_type FROM quotes WHERE quota_reservation_id = $1',
      [dto.quota_reservation_id]
    );
    if (!existing.rows[0]) throw new Error('No se pudo guardar la cotización.');
    return existing.rows[0];
  }

  static async acceptQuote(
    quoteId: string,
    tenantId: string,
    userId: string,
    customerName: string,
    customerEmail: string
  ): Promise<Quote> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const quoteResult = await client.query<Quote>(
        `SELECT *, device_type_name AS device_type
         FROM quotes WHERE id = $1 AND tenant_id = $2 AND user_id = $3 FOR UPDATE`,
        [quoteId, tenantId, userId]
      );
      const quote = quoteResult.rows[0];
      if (!quote) throw new Error('Cotización no encontrada.');
      if (quote.status !== 'PENDING') throw new Error('La cotización ya no está pendiente.');

      if (new Date(quote.valid_until).getTime() <= Date.now()) {
        await client.query(`UPDATE quotes SET status = 'EXPIRED' WHERE id = $1`, [quoteId]);
        await client.query('COMMIT');
        throw new Error('La cotización venció y no puede aceptarse.');
      }

      const eventId = randomUUID();
      const correlationId = randomUUID();
      const acceptedAt = new Date().toISOString();
      const payload = {
        quote_id: quote.id,
        user_id: quote.user_id,
        device_type_id: quote.device_type_id,
        device_type_name: quote.device_type_name,
        brand: quote.brand ?? null,
        model: quote.model ?? null,
        year: quote.year ?? null,
        condition: quote.condition,
        quoted_price: Number(quote.final_price),
        currency: quote.currency,
        customer_name: customerName || customerEmail,
        customer_email: customerEmail,
        accepted_at: acceptedAt,
      };

      const updatedResult = await client.query<Quote>(
        `UPDATE quotes SET status = 'ACCEPTED'
         WHERE id = $1 AND status = 'PENDING'
         RETURNING *, device_type_name AS device_type`,
        [quoteId]
      );
      await client.query(
        `INSERT INTO quote_event_outbox (event_id, correlation_id, tenant_id, event_type, payload)
         VALUES ($1, $2, $3, 'QuoteAccepted', $4)`,
        [eventId, correlationId, tenantId, JSON.stringify(payload)]
      );
      await client.query('COMMIT');
      return updatedResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async findById(id: string): Promise<Quote | null> {
    const query = `SELECT *, device_type_name AS device_type FROM quotes WHERE id = $1;`;
    const { rows } = await pool.query(query, [id]);
    return rows[0] || null;
  }

  static async findByUserId(tenantId: string, userId: string): Promise<Quote[]> {
    const query = `
      SELECT *, device_type_name AS device_type FROM quotes
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC;
    `;
    const { rows } = await pool.query(query, [tenantId, userId]);
    return rows;
  }
}
