import { pool } from '../config/db';
import {
  AdjustmentResolution,
  AdjustedQuoteEventPayload,
  Disposition,
  DispositionCompletedPayload,
  DomainEvent,
  InspectionCompletedPayload,
  PaymentCompletedPayload,
  PaymentFailedPayload,
  QuoteAcceptedPayload,
  RegisterDispositionInput,
} from '../types/orders';
import { validateQuoteAcceptedEvent } from '../domain/quoteAccepted';
import { validateInspectionCompletedEvent } from '../domain/inspectionCompleted';
import { originalPriceWasConfirmed } from '../domain/inspectionPayment';
import { DispositionError, decideDispositionAction } from '../domain/disposition';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';

const TRACKING_LINK_TTL_DAYS = 90;

function trackingTokenSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET debe estar configurado para generar enlaces de seguimiento.');
  return secret;
}

function trackingToken(tenantId: string, orderId: string): string {
  return createHmac('sha256', trackingTokenSecret())
    .update(`order-tracking:${tenantId}:${orderId}`)
    .digest('hex');
}

function trackingTokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

async function sendTrackingLink(email: string, customerName: string, orderNumber: string, token: string): Promise<void> {
  const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://auth-service:3001';
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) throw new Error('INTERNAL_SERVICE_TOKEN debe estar configurado para enviar el enlace.');

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const trackingUrl = new URL(`/seguimiento/${token}`, frontendUrl).toString();
  const response = await fetch(new URL('/api/auth/internal/order-tracking-links', authServiceUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-service-token': internalToken,
    },
    body: JSON.stringify({ email, customer_name: customerName, order_number: orderNumber, tracking_url: trackingUrl }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || 'No se pudo enviar el enlace de seguimiento.');
  }
}

export class OrderModel {
  static async authorizePayment(
    orderId: string,
    tenantId: string,
    userId: string | undefined,
    action: 'PAY' | 'READ'
  ): Promise<{
    id: string;
    tenant_id: string;
    user_id: string | null;
    order_number: string;
    amount: number | string;
    currency: string;
    status: string;
  } | null> {
    const statuses = action === 'PAY' ? ['PAYMENT_PENDING'] : ['PAYMENT_PENDING', 'PAID', 'CLOSED'];
    const { rows } = await pool.query(
      `SELECT id, tenant_id, user_id, order_number,
              final_price AS amount,
              currency, status
       FROM orders
       WHERE id = $1 AND tenant_id = $2
         AND status = ANY($3::varchar[])
         AND final_price IS NOT NULL
         AND ($4::uuid IS NULL OR user_id = $4)`,
      [orderId, tenantId, statuses, userId ?? null]
    );
    return rows[0] ?? null;
  }

  static async processPaymentCompletedEvent(
    event: DomainEvent<PaymentCompletedPayload>
  ): Promise<void> {
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

      const result = await client.query<{
        id: string;
        status: string;
        final_price: number | string | null;
        quoted_price: number | string;
        currency: string;
      }>(
        `SELECT id, status, final_price, quoted_price, currency
         FROM orders
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [event.payload.order_id, event.tenant_id]
      );
      const order = result.rows[0];
      if (!order) throw new Error('No se encontró la orden del pago.');
      const acceptedAmount = Number(order.final_price);
      if (
        !Number.isFinite(acceptedAmount) ||
        acceptedAmount.toFixed(2) !== Number(event.payload.amount).toFixed(2) ||
        order.currency.trim() !== event.payload.currency
      ) {
        throw new Error('El monto o moneda del pago no coincide con el monto aceptado de la orden.');
      }
      if (order.status === 'PAID') {
        await client.query('COMMIT');
        return;
      }
      if (order.status !== 'PAYMENT_PENDING') {
        throw new Error('La orden ya no está pendiente de pago.');
      }

      await client.query(
        `SELECT set_config('reecicla.operator_user_id', $1, true),
                set_config('reecicla.status_reason', $2, true)`,
        [event.payload.paid_by_user_id, `Pago ${event.payload.payment_id} completado por ${event.payload.method}.`]
      );
      const updated = await client.query(
        `UPDATE orders
         SET status = 'PAID', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND status = 'PAYMENT_PENDING'`,
        [order.id, event.tenant_id]
      );
      if (updated.rowCount === 0) {
        throw new Error('La orden cambió de estado mientras se procesaba el pago.');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async processPaymentFailedEvent(
    event: DomainEvent<PaymentFailedPayload>
  ): Promise<void> {
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

      const order = await client.query<{ status: string }>(
        `SELECT status FROM orders
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [event.payload.order_id, event.tenant_id]
      );
      if (!order.rows[0] || !['PAYMENT_PENDING', 'PAID'].includes(order.rows[0].status)) {
        throw new Error('La orden no está disponible para registrar el fallo de pago.');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async createFromAcceptedQuote(event: DomainEvent<QuoteAcceptedPayload>): Promise<void> {
    validateQuoteAcceptedEvent(event);

    const client = await pool.connect();
    let trackingEmail: string;
    let customerName: string;
    let orderNumber: string;
    let token: string;
    try {
      await client.query('BEGIN');
      const processed = await client.query(
        `INSERT INTO processed_events (event_id, event_type, tenant_id, correlation_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.event_id, event.event_type, event.tenant_id, event.correlation_id]
      );
      if (processed.rowCount !== 0) {
        const payload = event.payload;
        const orderId = randomUUID();
        const orderToken = trackingToken(event.tenant_id, orderId);
        const orderResult = await client.query(
          `INSERT INTO orders (
             id, tenant_id, order_number, user_id, quote_id, device_type_id,
             device_type_name, brand, model, device_year, declared_condition,
             quoted_price, currency, status, customer_name, customer_email, customer_phone,
             pickup_address, accepted_at, tracking_token_hash, tracking_token_expires_at
           ) VALUES (
             $1, $2, 'ORD-' || LPAD(nextval('order_number_seq')::text, 8, '0'),
             $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ACCEPTED',
             $13, $14, $15, $16::jsonb, $17, $18, NOW() + ($19::int * INTERVAL '1 day')
           )
           ON CONFLICT (tenant_id, quote_id) DO NOTHING
           RETURNING id, tenant_id, order_number, status, tracking_token_expires_at`,
          [
            orderId,
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
            trackingTokenHash(orderToken),
            TRACKING_LINK_TTL_DAYS,
          ]
        );

        if (orderResult.rows[0]) {
          await client.query(
            `INSERT INTO order_status_history (tenant_id, order_id, previous_status, new_status, changed_by_user, reason)
             VALUES ($1, $2, NULL, 'ACCEPTED', $3, 'Orden creada al aceptar la cotización')`,
            [event.tenant_id, orderResult.rows[0].id, payload.user_id]
          );
        }
      }

      const orderResult = await client.query(
        `SELECT id, order_number, customer_name, customer_email,
                tracking_token_hash, tracking_token_expires_at
         FROM orders WHERE tenant_id = $1 AND quote_id = $2 FOR UPDATE`,
        [event.tenant_id, event.payload.quote_id]
      );
      const order = orderResult.rows[0];
      if (!order) throw new Error('No se encontró la orden asociada a la cotización aceptada.');

      token = trackingToken(event.tenant_id, order.id);
      const tokenHash = trackingTokenHash(token);
      if (
        !order.tracking_token_hash ||
        !timingSafeEqual(Buffer.from(order.tracking_token_hash), tokenHash) ||
        new Date(order.tracking_token_expires_at).getTime() <= Date.now()
      ) {
        await client.query(
          `UPDATE orders
           SET tracking_token_hash = $1,
               tracking_token_expires_at = NOW() + ($2::int * INTERVAL '1 day')
           WHERE id = $3 AND tenant_id = $4`,
          [tokenHash, TRACKING_LINK_TTL_DAYS, order.id, event.tenant_id]
        );
      }
      trackingEmail = order.customer_email;
      customerName = order.customer_name;
      orderNumber = order.order_number;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    await sendTrackingLink(trackingEmail!, customerName!, orderNumber!, token!);
  }

  static async completeFromInspectionEvent(
    event: DomainEvent<InspectionCompletedPayload>
  ): Promise<void> {
    validateInspectionCompletedEvent(event);
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

      const existing = await client.query<{
        id: string;
        status: string;
        declared_condition: string | null;
      }>(
        `SELECT id, status, declared_condition
         FROM orders
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [event.payload.order_id, event.tenant_id]
      );
      const order = existing.rows[0];
      if (!order) throw new Error('No se encontró la orden asociada a la inspección.');
      const quoteConfirmed = originalPriceWasConfirmed(
        order.declared_condition,
        event.payload.actual_condition,
        event.payload.result
      );
      const targetStatus = quoteConfirmed ? 'PAYMENT_PENDING' : 'INSPECTED';
      const reason = quoteConfirmed
        ? 'Inspección confirmó la condición declarada y el precio original aceptado.'
        : event.payload.justification;
      await client.query(
        `SELECT set_config('reecicla.operator_user_id', $1, true),
                set_config('reecicla.status_reason', $2, true)`,
        [event.payload.completed_by_user_id, reason]
      );
      const updated = await client.query(
        `UPDATE orders
         SET status = $1,
             final_price = CASE WHEN $1 = 'PAYMENT_PENDING' THEN quoted_price ELSE final_price END,
             updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND status IN ('RECEIVED', 'INSPECTING')`,
        [targetStatus, event.payload.order_id, event.tenant_id]
      );
      if (updated.rowCount === 0) {
        if (order.status !== targetStatus) {
          throw new Error('No se encontró la orden elegible para completar la inspección.');
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async processAdjustedQuoteEvent(
    event: DomainEvent<AdjustedQuoteEventPayload>
  ): Promise<void> {
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

      const target = event.event_type === 'AdjustedQuoteCreated'
        ? 'ADJUSTMENT_PENDING'
        : event.event_type === 'AdjustedQuoteAccepted'
          ? 'PAYMENT_PENDING'
          : 'ADJUSTMENT_REJECTED';
      const reason = event.event_type === 'AdjustedQuoteCreated'
        ? 'Inspección generó una cotización ajustada pendiente de respuesta.'
        : event.event_type === 'AdjustedQuoteAccepted'
          ? 'El cliente aceptó el precio ajustado.'
          : 'El cliente rechazó el precio ajustado.';
      await client.query(
        `SELECT set_config('reecicla.operator_user_id', $1, true),
                set_config('reecicla.status_reason', $2, true)`,
        [event.payload.responded_by_user_id ?? '', reason]
      );

      const statusFilter = ['INSPECTED', 'ADJUSTMENT_PENDING'];
      const update = event.event_type === 'AdjustedQuoteAccepted'
        ? `UPDATE orders
           SET status = $1, final_price = $2, updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4 AND quote_id = $5
             AND status = ANY($6::varchar[])`
        : event.event_type === 'AdjustedQuoteRejected'
          ? `UPDATE orders
             SET status = $1, adjustment_rejected_at = NOW(), updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3 AND quote_id = $4
               AND status = ANY($5::varchar[])`
          : `UPDATE orders
             SET status = $1, updated_at = NOW()
             WHERE id = $2 AND tenant_id = $3 AND quote_id = $4
               AND status = ANY($5::varchar[])`;
      const parameters = event.event_type === 'AdjustedQuoteAccepted'
        ? [
          target,
          event.payload.adjusted_price,
          event.payload.order_id,
          event.tenant_id,
          event.payload.parent_quote_id,
          statusFilter,
        ]
        : [
          target,
          event.payload.order_id,
          event.tenant_id,
          event.payload.parent_quote_id,
          statusFilter,
        ];
      const updated = await client.query(update, parameters);
      if (updated.rowCount === 0) {
        const existing = await client.query(
          `SELECT status FROM orders
           WHERE id = $1 AND tenant_id = $2 AND quote_id = $3`,
          [event.payload.order_id, event.tenant_id, event.payload.parent_quote_id]
        );
        if (
          event.event_type === 'AdjustedQuoteCreated' &&
          ['PAYMENT_PENDING', 'ADJUSTMENT_REJECTED'].includes(existing.rows[0]?.status)
        ) {
          await client.query('COMMIT');
          return;
        }
        if (existing.rows[0]?.status !== target) {
          throw new Error('La orden no está en un estado que permita procesar la respuesta al ajuste.');
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async authorizeAdjustedQuoteResponse(
    token: string,
    parentQuoteId: string
  ): Promise<{ id: string; tenant_id: string } | null> {
    if (!/^[0-9a-f]{64}$/i.test(token)) return null;
    const providedHash = trackingTokenHash(token);
    const result = await pool.query<{ id: string; tenant_id: string; tracking_token_hash: Buffer }>(
      `SELECT id, tenant_id, tracking_token_hash
       FROM orders
       WHERE tracking_token_hash = $1
         AND tracking_token_expires_at > NOW()
         AND quote_id = $2
         AND status IN ('INSPECTED', 'ADJUSTMENT_PENDING')`,
      [providedHash, parentQuoteId]
    );
    const order = result.rows[0];
    if (!order) return null;
    const storedHash = Buffer.from(order.tracking_token_hash);
    if (storedHash.length !== providedHash.length || !timingSafeEqual(storedHash, providedHash)) {
      return null;
    }
    return { id: order.id, tenant_id: order.tenant_id };
  }

  static async resolveAdjustmentForUser(
    orderId: string,
    tenantId: string,
    userId: string,
    resolution: AdjustmentResolution
  ): Promise<{ resolution: AdjustmentResolution; automatic: boolean }> {
    return OrderModel.resolveAdjustment({ orderId, tenantId, userId, resolution });
  }

  static async resolveAdjustmentByTrackingToken(
    token: string,
    resolution: AdjustmentResolution
  ): Promise<{ resolution: AdjustmentResolution; automatic: boolean }> {
    if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('El enlace de seguimiento no es válido o venció.');
    return OrderModel.resolveAdjustment({ token, resolution });
  }

  private static async resolveAdjustment(input: {
    orderId?: string;
    tenantId?: string;
    userId?: string;
    token?: string;
    resolution: AdjustmentResolution;
  }): Promise<{ resolution: AdjustmentResolution; automatic: boolean }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const params = input.token
        ? [trackingTokenHash(input.token)]
        : [input.orderId, input.tenantId, input.userId];
      const where = input.token
        ? 'tracking_token_hash = $1 AND tracking_token_expires_at > NOW()'
        : 'id = $1 AND tenant_id = $2 AND user_id = $3';
      const result = await client.query<{
        id: string;
        tenant_id: string;
        status: string;
        adjustment_rejected_at: Date | null;
        adjustment_resolution: AdjustmentResolution | null;
        deadline_passed: boolean;
      }>(
        `SELECT id, tenant_id, status, adjustment_rejected_at, adjustment_resolution,
                adjustment_rejected_at <= NOW() - INTERVAL '7 days' AS deadline_passed
         FROM orders WHERE ${where} FOR UPDATE`,
        params
      );
      const order = result.rows[0];
      if (!order) throw new Error('Orden no encontrada o enlace de seguimiento vencido.');
      if (order.status !== 'ADJUSTMENT_REJECTED' || !order.adjustment_rejected_at) {
        throw new Error('La orden no tiene un ajuste rechazado pendiente de resolución.');
      }
      if (order.adjustment_resolution) {
        throw new Error('El destino del equipo ya fue elegido.');
      }

      const expired = order.deadline_passed;
      const resolution = expired ? 'RECYCLE' : input.resolution;
      const reason = expired
        ? 'Venció el plazo de 7 días sin respuesta; reciclaje sin pago según S2.'
        : resolution === 'RETURN'
          ? 'El cliente solicitó la devolución del equipo, a su cargo, según S2.'
          : 'El cliente eligió el reciclaje del equipo sin pago, según S2.';
      await client.query(
        `INSERT INTO dispositions (tenant_id, order_id, type, status)
         VALUES ($1, $2, $3, 'PENDING')
         ON CONFLICT (order_id) DO NOTHING`,
        [order.tenant_id, order.id, resolution]
      );
      await client.query(
        `UPDATE orders
         SET adjustment_resolution = $1, adjustment_resolution_at = NOW(), updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [resolution, order.id, order.tenant_id]
      );
      await client.query(
        `INSERT INTO order_status_history
           (tenant_id, order_id, previous_status, new_status, changed_by_user, reason)
         VALUES ($1, $2, 'ADJUSTMENT_REJECTED', 'ADJUSTMENT_REJECTED', $3, $4)`,
        [order.tenant_id, order.id, input.userId ?? null, reason]
      );
      await client.query('COMMIT');
      return { resolution, automatic: expired };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async applyExpiredAdjustmentRejections(): Promise<number> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const due = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM orders
         WHERE status = 'ADJUSTMENT_REJECTED'
           AND adjustment_rejected_at <= NOW() - INTERVAL '7 days'
           AND adjustment_resolution IS NULL
         ORDER BY adjustment_rejected_at
         LIMIT 100
         FOR UPDATE SKIP LOCKED`
      );
      for (const order of due.rows) {
        await client.query(
          `INSERT INTO dispositions (tenant_id, order_id, type, status)
           VALUES ($1, $2, 'RECYCLE', 'PENDING')
           ON CONFLICT (order_id) DO NOTHING`,
          [order.tenant_id, order.id]
        );
        await client.query(
          `UPDATE orders
           SET adjustment_resolution = 'RECYCLE', adjustment_resolution_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2 AND adjustment_resolution IS NULL`,
          [order.id, order.tenant_id]
        );
        await client.query(
          `INSERT INTO order_status_history
             (tenant_id, order_id, previous_status, new_status, reason)
           VALUES ($1, $2, 'ADJUSTMENT_REJECTED', 'ADJUSTMENT_REJECTED',
                   'Venció el plazo de 7 días sin respuesta; reciclaje sin pago según S2.')`,
          [order.tenant_id, order.id]
        );
      }
      await client.query('COMMIT');
      return due.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }


  static async getByTrackingToken(token: string): Promise<Record<string, unknown> | null> {
    if (!/^[0-9a-f]{64}$/i.test(token)) return null;
    const providedHash = trackingTokenHash(token);
    const result = await pool.query(
      `SELECT o.order_number, o.quote_id, o.device_type_name, o.brand, o.model,
              o.device_year, o.declared_condition, o.quoted_price, o.final_price, o.currency, o.status,
              o.adjustment_rejected_at, o.adjustment_resolution, o.adjustment_resolution_at,
              o.accepted_at, o.created_at,
              o.tracking_token_hash, o.tracking_token_expires_at,
              b.tracking_code, b.status AS box_status, b.shipped_at,
              d.type AS disposition_type,
              d.status AS disposition_status,
              d.reference AS disposition_reference,
              d.completed_at AS disposition_completed_at,
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
       LEFT JOIN dispositions d ON d.order_id = o.id AND d.tenant_id = o.tenant_id
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.tracking_token_hash = $1
         AND o.tracking_token_expires_at > NOW()
       GROUP BY o.id, d.id, b.tracking_code, b.status, b.shipped_at`,
      [providedHash]
    );
    const order = result.rows[0];
    if (!order) return null;

    const storedHash = Buffer.from(order.tracking_token_hash);
    if (storedHash.length !== providedHash.length || !timingSafeEqual(storedHash, providedHash)) {
      return null;
    }
    const { tracking_token_hash: _hash, tracking_token_expires_at: _expiresAt, ...trackingDetails } = order;
    return trackingDetails;
  }

  static async listForUser(tenantId: string, userId: string): Promise<Record<string, unknown>[]> {
    const { rows } = await pool.query(
      `SELECT o.*,
              b.tracking_code,
              b.status AS box_status,
              b.shipped_at,
              d.type AS disposition_type,
              d.status AS disposition_status,
              d.reference AS disposition_reference,
              d.completed_at AS disposition_completed_at,
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
       LEFT JOIN dispositions d ON d.order_id = o.id AND d.tenant_id = o.tenant_id
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 AND o.user_id = $2
       GROUP BY o.id, d.id, b.tracking_code, b.status, b.shipped_at
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
              d.type AS disposition_type,
              d.status AS disposition_status,
              d.reference AS disposition_reference,
              d.completed_at AS disposition_completed_at,
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
       LEFT JOIN dispositions d ON d.order_id = o.id AND d.tenant_id = o.tenant_id
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1
       GROUP BY o.id, d.id, b.tracking_code, b.status, b.shipped_at
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
              d.type AS disposition_type,
              d.status AS disposition_status,
              d.reference AS disposition_reference,
              d.completed_at AS disposition_completed_at,
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
       LEFT JOIN dispositions d ON d.order_id = o.id AND d.tenant_id = o.tenant_id
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2 AND o.user_id = $3
       GROUP BY o.id, d.id, b.tracking_code, b.status, b.shipped_at`,
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
        `SELECT set_config('reecicla.operator_user_id', $1, true),
                set_config('reecicla.status_reason', $2, true)`,
        [operatorUserId, `Guía de envío registrada: ${trackingCode}`]
      );

      await client.query(
        `UPDATE orders
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [newStatus, orderId, tenantId]
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

  static async receiveOrder(
    tenantId: string,
    orderId: string,
    operatorUserId: string
  ): Promise<{ id: string; tenant_id: string; status: 'RECEIVED'; device_type_id: string; device_type_name: string; received_at: Date }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query(
        `SELECT id, tenant_id, status, quote_id, device_type_id, device_type_name, received_at
         FROM orders
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [orderId, tenantId]
      );
      if (!orderResult.rows[0]) throw new Error('Orden no encontrada.');

      const order = orderResult.rows[0];
      if (order.status !== 'IN_TRANSIT' && order.status !== 'RECEIVED') {
        throw new Error(`No se puede registrar la recepción desde el estado ${order.status}; la orden debe estar IN_TRANSIT.`);
      }

      let receivedAt: Date;
      if (order.status === 'RECEIVED') {
        receivedAt = order.received_at;
      } else {
        await client.query(
          `SELECT set_config('reecicla.operator_user_id', $1, true),
                  set_config('reecicla.status_reason', $2, true)`,
          [operatorUserId, 'Equipo recibido en almacén']
        );
        const updated = await client.query(
          `UPDATE orders
           SET status = 'RECEIVED', received_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2
           RETURNING received_at`,
          [orderId, tenantId]
        );
        receivedAt = updated.rows[0].received_at;
      }

      const payload = {
        order_id: orderId,
        quote_id: order.quote_id,
        device_type_id: order.device_type_id,
        device_type_name: order.device_type_name,
        received_at: receivedAt.toISOString(),
        received_by_user_id: operatorUserId,
      };
      await client.query(
        `INSERT INTO domain_event_outbox (
           tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
         ) VALUES ($1, $2, $2, 'DeviceReceived', 'device.received', $3::jsonb)
         ON CONFLICT (aggregate_id, event_type) DO NOTHING`,
        [tenantId, orderId, JSON.stringify(payload)]
      );

      await client.query('COMMIT');
      return {
        id: orderId,
        tenant_id: tenantId,
        status: 'RECEIVED',
        device_type_id: order.device_type_id,
        device_type_name: order.device_type_name,
        received_at: receivedAt,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  static async registerDisposition(
    tenantId: string,
    orderId: string,
    operatorUserId: string,
    input: RegisterDispositionInput
  ): Promise<{ disposition: Disposition; order_status: 'CLOSED'; already_registered: boolean }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderResult = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [orderId, tenantId]
      );
      const order = orderResult.rows[0];
      if (!order) throw new DispositionError('Orden no encontrada.', 404);

      const existingResult = await client.query<Disposition>(
        `SELECT id, tenant_id, order_id, type, status, reference, completed_at, created_at, updated_at
         FROM dispositions
         WHERE order_id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [orderId, tenantId]
      );
      const existing = existingResult.rows[0] ?? null;

      const action = decideDispositionAction(order, existing, input);
      if (action === 'ALREADY_REGISTERED' && existing) {
        await client.query('COMMIT');
        return { disposition: existing, order_status: 'CLOSED', already_registered: true };
      }

      let disposition: Disposition;
      if (action === 'CREATE') {
        const inserted = await client.query<Disposition>(
          `INSERT INTO dispositions (tenant_id, order_id, type, status, reference, completed_at)
           VALUES ($1, $2, $3, 'COMPLETED', $4, NOW())
           RETURNING id, tenant_id, order_id, type, status, reference, completed_at, created_at, updated_at`,
          [tenantId, orderId, input.type, input.reference]
        );
        disposition = inserted.rows[0];
      } else {
        const completed = await client.query<Disposition>(
          `UPDATE dispositions
           SET status = 'COMPLETED', reference = $1, completed_at = NOW(), updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3 AND status = 'PENDING'
           RETURNING id, tenant_id, order_id, type, status, reference, completed_at, created_at, updated_at`,
          [input.reference, existing!.id, tenantId]
        );
        if (completed.rowCount === 0) {
          throw new DispositionError('El destino de esta orden ya fue completado.', 409);
        }
        disposition = completed.rows[0];
      }

      await client.query(
        `SELECT set_config('reecicla.operator_user_id', $1, true),
                set_config('reecicla.status_reason', $2, true)`,
        [operatorUserId, `Destino final registrado: ${input.type} (${input.reference}).`]
      );
      await client.query(
        `UPDATE orders SET status = 'DISPOSED', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [orderId, tenantId]
      );
      await client.query(
        `SELECT set_config('reecicla.status_reason', $1, true)`,
        ['Ciclo completado: la orden se cierra tras registrar el destino final.']
      );
      await client.query(
        `UPDATE orders SET status = 'CLOSED', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [orderId, tenantId]
      );

      const payload: DispositionCompletedPayload = {
        disposition_id: disposition.id,
        order_id: orderId,
        type: input.type,
        reference: input.reference,
        completed_by_user_id: operatorUserId,
        completed_at: new Date(disposition.completed_at ?? Date.now()).toISOString(),
      };
      await client.query(
        `INSERT INTO domain_event_outbox (
           tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
         ) VALUES ($1, $2, $2, 'DispositionCompleted', 'disposition.completed', $3::jsonb)
         ON CONFLICT (aggregate_id, event_type) DO NOTHING`,
        [tenantId, orderId, JSON.stringify(payload)]
      );

      await client.query('COMMIT');
      return { disposition, order_status: 'CLOSED', already_registered: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

}
