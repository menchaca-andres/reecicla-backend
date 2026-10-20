import { pool } from '../config/db';
import type { PageResult, PaginationRequest } from '../utils/pagination';
import {
  AdjustedQuoteCreatedPayload,
  AdjustedQuoteDecisionPayload,
  DomainEvent,
  InspectionCompletedPayload,
  Quote,
  CreateQuoteDTO,
} from '../types/quotation';
import { randomUUID } from 'crypto';
import {
  buildAdjustmentJustification,
  calculateAdjustedPrice,
} from '../domain/inspectionCompleted';

export class QuoteModel {
  static async applyInspectionCompleted(
    event: DomainEvent<InspectionCompletedPayload>
  ): Promise<void> {
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
        await client.query('COMMIT');
        return;
      }

      const originalResult = await client.query<Quote & {
        condition_adjust: Record<string, number | string>;
      }>(
        `SELECT q.*, q.device_type_name AS device_type, r.condition_adjust
         FROM quotes q
         JOIN pricing_rules r ON r.id = q.pricing_rule_id
         WHERE q.id = $1 AND q.tenant_id = $2
         FOR UPDATE OF q`,
        [event.payload.quote_id, event.tenant_id]
      );
      const original = originalResult.rows[0];
      if (!original || original.quote_type !== 'INITIAL' || original.status !== 'ACCEPTED') {
        throw new Error('No se encontró la cotización original aceptada para la inspección.');
      }
      const declaredCondition = original.condition.trim();
      const actualCondition = event.payload.actual_condition.trim();
      const originalPrice = Number(original.final_price);
      const justification = declaredCondition.toLowerCase() === actualCondition.toLowerCase()
        ? `La condición real (${actualCondition}) coincide con la condición declarada; se confirma la cotización original.`
        : buildAdjustmentJustification(declaredCondition, actualCondition);

      let adjustedQuoteId: string | null = null;
      let adjustedPrice = originalPrice;
      const changed = declaredCondition.toLowerCase() !== actualCondition.toLowerCase();
      if (changed) {
        const adjusted = calculateAdjustedPrice(
          Number(original.base_price),
          original.condition_adjust ?? {},
          actualCondition
        );
        adjustedPrice = adjusted.finalPrice;
        const created = await client.query<{ id: string }>(
          `INSERT INTO quotes (
             tenant_id, user_id, pricing_rule_id, device_type_id, device_type_name,
             brand, model, year, condition, base_price, adjustment, final_price,
             currency, quote_type, parent_quote_id, adjustment_reason, valid_until, status
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, 'ADJUSTED', $14, $15, NOW() + INTERVAL '30 days', 'PENDING'
           )
           ON CONFLICT (tenant_id, parent_quote_id) WHERE quote_type = 'ADJUSTED'
           DO NOTHING
           RETURNING id`,
          [
            event.tenant_id,
            original.user_id,
            original.pricing_rule_id,
            original.device_type_id,
            original.device_type_name,
            original.brand ?? null,
            original.model ?? null,
            original.year ?? null,
            actualCondition,
            original.base_price,
            adjusted.adjustment,
            adjusted.finalPrice,
            original.currency,
            original.id,
            justification,
          ]
        );
        if (created.rows[0]) {
          adjustedQuoteId = created.rows[0].id;
        } else {
          const existing = await client.query<{ id: string; final_price: number | string }>(
            `SELECT id, final_price FROM quotes
             WHERE tenant_id = $1 AND parent_quote_id = $2 AND quote_type = 'ADJUSTED'`,
            [event.tenant_id, original.id]
          );
          adjustedQuoteId = existing.rows[0]?.id ?? null;
          if (!existing.rows[0]) throw new Error('No se pudo recuperar la cotización ajustada existente.');
          adjustedPrice = Number(existing.rows[0].final_price);
        }
      }

      await client.query(
        `INSERT INTO quote_adjustment_audits (
           event_id, tenant_id, order_id, original_quote_id, adjusted_quote_id,
           declared_condition, actual_condition, inspection_result,
           original_price, adjusted_price, outcome, justification
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (tenant_id, order_id) DO NOTHING`,
        [
          event.event_id,
          event.tenant_id,
          event.payload.order_id,
          original.id,
          adjustedQuoteId,
          declaredCondition,
          actualCondition,
          event.payload.result,
          originalPrice,
          adjustedPrice,
          changed ? 'ADJUSTED' : 'UNCHANGED',
          justification,
        ]
      );
      if (adjustedQuoteId) {
        const eventId = randomUUID();
        await client.query(
          `INSERT INTO quote_event_outbox (event_id, correlation_id, tenant_id, event_type, payload)
           VALUES ($1, $2, $3, 'AdjustedQuoteCreated', $4)`,
          [
            eventId,
            event.payload.order_id,
            event.tenant_id,
            JSON.stringify({
              order_id: event.payload.order_id,
              quote_id: adjustedQuoteId,
              parent_quote_id: original.id,
              adjusted_price: adjustedPrice,
              currency: original.currency,
            } satisfies AdjustedQuoteCreatedPayload),
          ]
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
        NOW() + INTERVAL '30 days', $15)
      ON CONFLICT (quota_reservation_id) DO NOTHING
      RETURNING *, device_type_name AS device_type;
    `;
    const values = [
      dto.tenant_id,
      dto.user_id || null,
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
      dto.user_id ? 'PENDING' : 'ANONYMOUS',
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
    userId: string | null,
    customerName: string,
    customerEmail: string,
    customerPhone?: string,
    pickupAddress?: string
  ): Promise<Quote> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const quoteResult = await client.query<Quote>(
        `SELECT *, device_type_name AS device_type
         FROM quotes WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [quoteId, tenantId]
      );
      const quote = quoteResult.rows[0];
      if (!quote) throw new Error('Cotización no encontrada.');
      if (quote.status !== 'PENDING' && quote.status !== 'ANONYMOUS') {
        throw new Error('La cotización ya no está pendiente.');
      }
      if (quote.quote_type === 'ADJUSTED') {
        throw new Error('La aceptación de cotizaciones ajustadas se implementa en HU-018.');
      }

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
        user_id: userId,
        device_type_id: quote.device_type_id,
        device_type_name: quote.device_type_name,
        brand: quote.brand ?? null,
        model: quote.model ?? null,
        year: quote.year ?? null,
        condition: quote.condition,
        quoted_price: Number(quote.final_price),
        currency: quote.currency,
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone ?? null,
        pickup_address: pickupAddress ?? null,
        accepted_at: acceptedAt,
      };

      const updatedResult = await client.query<Quote>(
        `UPDATE quotes SET status = 'ACCEPTED', user_id = $2
         WHERE id = $1 AND status IN ('PENDING', 'ANONYMOUS')
         RETURNING *, device_type_name AS device_type`,
        [quoteId, userId]
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

  static async expireOverdueQuotes(): Promise<number> {
    const { rowCount } = await pool.query(
      `UPDATE quotes
       SET status = 'EXPIRED'
       WHERE status IN ('ANONYMOUS', 'PENDING')
         AND valid_until <= NOW()`
    );
    return rowCount ?? 0;
  }

  static async purgeStaleAnonymousQuotes(retentionDays = 90): Promise<number> {
    const { rowCount } = await pool.query(
      `DELETE FROM quotes
       WHERE user_id IS NULL
         AND status IN ('EXPIRED', 'REJECTED')
         AND updated_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [retentionDays]
    );
    return rowCount ?? 0;
  }

  static async rejectQuote(quoteId: string, tenantId: string): Promise<Quote> {
    const quoteType = await pool.query<{ quote_type: string }>(
      'SELECT quote_type FROM quotes WHERE id = $1 AND tenant_id = $2',
      [quoteId, tenantId]
    );
    if (quoteType.rows[0]?.quote_type === 'ADJUSTED') {
      throw new Error('El rechazo de cotizaciones ajustadas se implementa en HU-018.');
    }
    const { rows } = await pool.query<Quote>(
      `UPDATE quotes
       SET status = 'REJECTED'
       WHERE id = $1 AND tenant_id = $2 AND quote_type = 'INITIAL'
         AND status IN ('ANONYMOUS', 'PENDING')
       RETURNING *, device_type_name AS device_type`,
      [quoteId, tenantId]
    );
    if (!rows[0]) throw new Error('La cotización inicial no está pendiente o no existe.');
    return rows[0];
  }

  static async respondToAdjustedQuote(
    quoteId: string,
    tenantId: string,
    userId: string | null,
    decision: 'ACCEPT' | 'REJECT',
    authorizedOrderId: string | null
  ): Promise<Quote> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<Quote & {
        order_id: string;
        parent_quote_id: string;
      }>(
        `SELECT q.*, q.device_type_name AS device_type, a.order_id
         FROM quotes q
         JOIN quote_adjustment_audits a
           ON a.tenant_id = q.tenant_id AND a.adjusted_quote_id = q.id
         WHERE q.id = $1 AND q.tenant_id = $2 AND q.quote_type = 'ADJUSTED'
         FOR UPDATE OF q`,
        [quoteId, tenantId]
      );
      const quote = result.rows[0];
      if (!quote) throw new Error('Cotización ajustada no encontrada.');
      if (quote.status !== 'PENDING') {
        throw new Error('La cotización ajustada ya no está pendiente.');
      }
      if (new Date(quote.valid_until).getTime() <= Date.now()) {
        await client.query(`UPDATE quotes SET status = 'EXPIRED' WHERE id = $1`, [quote.id]);
        await client.query('COMMIT');
        throw new Error('La cotización ajustada venció y no puede responderse.');
      }
      if (userId && quote.user_id !== userId) {
        throw new Error('No tienes permiso para responder esta cotización.');
      }
      if (!userId && authorizedOrderId !== quote.order_id) {
        throw new Error('El enlace de seguimiento no corresponde a esta cotización.');
      }
      if (!quote.parent_quote_id) {
        throw new Error('La cotización ajustada no está vinculada a una cotización original.');
      }

      const accepted = decision === 'ACCEPT';
      const status = accepted ? 'ACCEPTED' : 'REJECTED';
      const eventType = accepted ? 'AdjustedQuoteAccepted' : 'AdjustedQuoteRejected';
      const eventId = randomUUID();
      const payload: AdjustedQuoteDecisionPayload = {
        order_id: quote.order_id,
        quote_id: quote.id,
        parent_quote_id: quote.parent_quote_id,
        adjusted_price: Number(quote.final_price),
        currency: quote.currency,
        responded_by_user_id: userId,
        responded_at: new Date().toISOString(),
      };
      const updated = await client.query<Quote>(
        `UPDATE quotes SET status = $1
         WHERE id = $2 AND tenant_id = $3 AND status = 'PENDING'
         RETURNING *, device_type_name AS device_type`,
        [status, quote.id, tenantId]
      );
      if (!updated.rows[0]) throw new Error('La cotización ajustada ya no está pendiente.');
      await client.query(
        `INSERT INTO quote_event_outbox (event_id, correlation_id, tenant_id, event_type, payload)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          eventId,
          quote.order_id,
          tenantId,
          eventType,
          JSON.stringify(payload),
        ]
      );
      await client.query('COMMIT');
      return updated.rows[0];
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
    const quote: Quote | undefined = rows[0];
    if (!quote) return null;
    if (quote.quote_type === 'INITIAL') {
      const adjusted = await pool.query(
        `SELECT *, device_type_name AS device_type
         FROM quotes
         WHERE tenant_id = $1 AND parent_quote_id = $2 AND quote_type = 'ADJUSTED'
         ORDER BY created_at DESC
         LIMIT 1`,
        [quote.tenant_id, quote.id]
      );
      quote.adjusted_quote = adjusted.rows[0] ?? null;
      const audit = await pool.query<NonNullable<Quote['adjustment_audit']>>(
        `SELECT outcome, declared_condition, actual_condition, justification
         FROM quote_adjustment_audits
         WHERE tenant_id = $1 AND original_quote_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [quote.tenant_id, quote.id]
      );
      quote.adjustment_audit = audit.rows[0] ?? null;
    }
    return quote;
  }

  static findByUserId(tenantId: string, userId: string): Promise<Quote[]>;
  static findByUserId(
    tenantId: string,
    userId: string,
    pagination: PaginationRequest
  ): Promise<PageResult<Quote>>;
  static async findByUserId(
    tenantId: string,
    userId: string,
    pagination?: PaginationRequest
  ): Promise<Quote[] | PageResult<Quote>> {
    const query = `
      SELECT *, device_type_name AS device_type FROM quotes
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at DESC, id DESC
      ${pagination ? 'LIMIT $3 OFFSET $4' : ''};
    `;
    const values = pagination
      ? [tenantId, userId, pagination.limit, pagination.offset]
      : [tenantId, userId];
    const { rows } = await pool.query<Quote>(query, values);
    const result: Quote[] | PageResult<Quote> = pagination
      ? {
          items: rows,
          total_items: Number((await pool.query<{ count: string }>(
            'SELECT COUNT(*) AS count FROM quotes WHERE tenant_id = $1 AND user_id = $2',
            [tenantId, userId]
          )).rows[0].count),
        }
      : rows;
    const quotes = Array.isArray(result) ? result : result.items;
    const originalIds = quotes
      .filter((quote) => quote.quote_type === 'INITIAL')
      .map((quote) => quote.id);
    if (originalIds.length > 0) {
      const audits = await pool.query<NonNullable<Quote['adjustment_audit']> & { original_quote_id: string }>(
        `SELECT DISTINCT ON (original_quote_id)
           original_quote_id, outcome, declared_condition, actual_condition, justification
         FROM quote_adjustment_audits
         WHERE tenant_id = $1 AND original_quote_id = ANY($2::uuid[])
         ORDER BY original_quote_id, created_at DESC`,
        [tenantId, originalIds]
      );
      const auditsByQuote = new Map(audits.rows.map((audit) => [audit.original_quote_id, audit]));
      for (const quote of quotes) {
        quote.adjustment_audit = auditsByQuote.get(quote.id) ?? null;
      }
    }
    return result;
  }
}
