import { pool } from '../config/db';
import { DomainEvent, QuoteAcceptedPayload } from '../types/orders';
import { validateQuoteAcceptedEvent } from '../domain/quoteAccepted';
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

  static async getByTrackingToken(token: string): Promise<Record<string, unknown> | null> {
    if (!/^[0-9a-f]{64}$/i.test(token)) return null;
    const providedHash = trackingTokenHash(token);
    const result = await pool.query(
      `SELECT o.order_number, o.device_type_name, o.brand, o.model,
              o.device_year, o.declared_condition, o.quoted_price, o.currency, o.status,
              o.accepted_at, o.created_at,
              o.tracking_token_hash, o.tracking_token_expires_at,
              b.tracking_code, b.status AS box_status, b.shipped_at,
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
       WHERE o.tracking_token_hash = $1
         AND o.tracking_token_expires_at > NOW()
       GROUP BY o.id, b.tracking_code, b.status, b.shipped_at`,
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
              d.id AS disposition_id,
              d.type AS disposition_type,
              d.status AS disposition_status,
              d.reason AS disposition_reason,
              d.determined_at AS disposition_determined_at,
              d.determined_by_user AS disposition_determined_by_user,
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
       LEFT JOIN LATERAL (
         SELECT id, type, status, reason, determined_at, determined_by_user
         FROM dispositions
         WHERE order_id = o.id AND tenant_id = o.tenant_id
         LIMIT 1
       ) d ON true
       LEFT JOIN order_status_history h ON h.order_id = o.id AND h.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1
       GROUP BY o.id, b.tracking_code, b.status, b.shipped_at, d.id, d.type, d.status, d.reason, d.determined_at, d.determined_by_user
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
        `SELECT id, tenant_id, status, device_type_id, device_type_name, received_at
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

  static async getOrderInspection(
    tenantId: string,
    orderId: string
  ): Promise<{
    order: Record<string, unknown>;
    inspection: Record<string, unknown> | null;
    items: Record<string, unknown>[];
    disposition: Record<string, unknown> | null;
  } | null> {
    const orderRes = await pool.query(
      `SELECT o.*,
              d.id AS disposition_id,
              d.type AS disposition_type,
              d.status AS disposition_status,
              d.reason AS disposition_reason,
              d.determined_by_user AS disposition_determined_by_user,
              d.determined_at AS disposition_determined_at
       FROM orders o
       LEFT JOIN dispositions d ON d.order_id = o.id AND d.tenant_id = o.tenant_id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [orderId, tenantId]
    );
    const order = orderRes.rows[0];
    if (!order) return null;

    let inspRes = await pool.query(
      `SELECT * FROM inspections WHERE order_id = $1 AND tenant_id = $2 LIMIT 1`,
      [orderId, tenantId]
    );
    let inspection = inspRes.rows[0] ?? null;

    // Si no tiene inspección registrada aún, crear una por defecto para permitir diagnóstico
    if (!inspection) {
      const initInsp = await pool.query(
        `INSERT INTO inspections (
           tenant_id, order_id, device_type_id, result, actual_condition,
           observations, diagnostic_summary
         ) VALUES ($1, $2, $3, 'PENDING', $4, 'Diagnóstico técnico inicial', $5::jsonb)
         ON CONFLICT (order_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [
          tenantId,
          orderId,
          order.device_type_id,
          order.declared_condition || 'working',
          JSON.stringify({
            physical_state: order.declared_condition === 'working' ? 'Buen estado general' : 'Presenta detalles de uso',
            test_score: order.declared_condition === 'working' ? 8.5 : 5.0,
            passed_tests: 3,
            failed_tests: order.declared_condition === 'working' ? 0 : 1
          })
        ]
      );
      inspection = initInsp.rows[0];

      // Insertar items de prueba por defecto
      const defaultItems = [
        { key: 'power_on', label: 'Encendido y booteo', res: 'PASS', obs: 'Enciende correctamente' },
        { key: 'screen_display', label: 'Pantalla / Componente visual', res: order.declared_condition === 'broken' ? 'FAIL' : 'PASS', obs: order.declared_condition === 'broken' ? 'Falla en panel display' : 'Sin daños visibles' },
        { key: 'physical_chassis', label: 'Estado estético y chasis', res: order.declared_condition === 'damaged' ? 'FAIL' : 'PASS', obs: order.declared_condition === 'damaged' ? 'Desgaste o golpes en carcasa' : 'Estructura íntegra' },
        { key: 'operational_components', label: 'Componentes internos y carga', res: 'PASS', obs: 'Pruebas de circuito estables' }
      ];

      for (const item of defaultItems) {
        await pool.query(
          `INSERT INTO inspection_items (inspection_id, criterion_key, criterion_label, result, observation)
           VALUES ($1, $2, $3, $4, $5)`,
          [inspection.id, item.key, item.label, item.res, item.obs]
        );
      }
    }

    const itemsRes = await pool.query(
      `SELECT * FROM inspection_items WHERE inspection_id = $1 ORDER BY created_at ASC`,
      [inspection.id]
    );
    const items = itemsRes.rows;

    let disposition: Record<string, unknown> | null = null;
    if (order.disposition_id) {
      disposition = {
        id: order.disposition_id,
        type: order.disposition_type,
        status: order.disposition_status,
        reason: order.disposition_reason,
        determined_by_user: order.disposition_determined_by_user,
        determined_at: order.disposition_determined_at,
      };
    }

    return { order, inspection, items, disposition };
  }

  static async saveInspection(
    tenantId: string,
    orderId: string,
    inspectorUserId: string,
    data: {
      actual_condition?: string;
      observations?: string;
      diagnostic_summary?: Record<string, any>;
      items?: Array<{
        criterion_key: string;
        criterion_label: string;
        result: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
        observation?: string;
      }>;
    }
  ): Promise<{ inspection: Record<string, unknown>; items: Record<string, unknown>[] }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const inspRes = await client.query(
        `INSERT INTO inspections (
           tenant_id, order_id, actual_condition, observations,
           diagnostic_summary, inspected_by_user, inspected_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
         ON CONFLICT (order_id) DO UPDATE SET
           actual_condition = COALESCE(EXCLUDED.actual_condition, inspections.actual_condition),
           observations = COALESCE(EXCLUDED.observations, inspections.observations),
           diagnostic_summary = COALESCE(EXCLUDED.diagnostic_summary, inspections.diagnostic_summary),
           inspected_by_user = EXCLUDED.inspected_by_user,
           inspected_at = NOW(),
           updated_at = NOW()
         RETURNING *`,
        [
          tenantId,
          orderId,
          data.actual_condition || null,
          data.observations || null,
          JSON.stringify(data.diagnostic_summary || {}),
          inspectorUserId,
        ]
      );
      const inspection = inspRes.rows[0];

      if (Array.isArray(data.items) && data.items.length > 0) {
        await client.query(`DELETE FROM inspection_items WHERE inspection_id = $1`, [inspection.id]);
        for (const item of data.items) {
          await client.query(
            `INSERT INTO inspection_items (
               inspection_id, criterion_key, criterion_label, result, observation
             ) VALUES ($1, $2, $3, $4, $5)`,
            [inspection.id, item.criterion_key, item.criterion_label, item.result, item.observation || null]
          );
        }
      }

      const itemsRes = await client.query(
        `SELECT * FROM inspection_items WHERE inspection_id = $1 ORDER BY created_at ASC`,
        [inspection.id]
      );

      await client.query('COMMIT');
      return { inspection, items: itemsRes.rows };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async determineDestination(
    tenantId: string,
    orderId: string,
    inspectorUserId: string,
    destination: 'RESALE' | 'RECYCLE',
    reason: string
  ): Promise<{
    order: Record<string, unknown>;
    disposition: Record<string, unknown>;
  }> {
    const normalizedDest = String(destination || '').toUpperCase() as 'RESALE' | 'RECYCLE';
    if (!['RESALE', 'RECYCLE'].includes(normalizedDest)) {
      throw new Error('El destino debe ser obligatoriamente Reventa (RESALE) o Reciclaje (RECYCLE).');
    }
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) {
      throw new Error('La justificación u observación es obligatoria para determinar el destino del equipo.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        `SELECT id, status, order_number FROM orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [orderId, tenantId]
      );
      if (orderRes.rowCount === 0) {
        throw new Error('Orden no encontrada.');
      }
      const order = orderRes.rows[0];

      const newStatus = normalizedDest === 'RESALE' ? 'READY_FOR_RESALE' : 'IN_RECYCLING';
      const statusLabel = normalizedDest === 'RESALE' ? 'Listo para Reventa' : 'En Proceso de Reciclaje';

      await client.query(
        `SELECT set_config('reecicla.operator_user_id', $1, true),
                set_config('reecicla.status_reason', $2, true)`,
        [inspectorUserId, `Destino determinado (${statusLabel}): ${trimmedReason}`]
      );

      const dispRes = await client.query(
        `INSERT INTO dispositions (
           tenant_id, order_id, type, status, reason, determined_by_user, determined_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (order_id) DO UPDATE SET
           type = EXCLUDED.type,
           status = EXCLUDED.status,
           reason = EXCLUDED.reason,
           determined_by_user = EXCLUDED.determined_by_user,
           determined_at = NOW(),
           updated_at = NOW()
         RETURNING *`,
        [tenantId, orderId, normalizedDest, newStatus, trimmedReason, inspectorUserId]
      );
      const disposition = dispRes.rows[0];

      const updOrderRes = await client.query(
        `UPDATE orders
         SET status = $1,
             inventory_status = $1,
             updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3
         RETURNING *`,
        [newStatus, orderId, tenantId]
      );
      const updatedOrder = updOrderRes.rows[0];

      await client.query(
        `UPDATE inspections
         SET result = $1, updated_at = NOW()
         WHERE order_id = $2 AND tenant_id = $3`,
        [normalizedDest, orderId, tenantId]
      );

      const payload = {
        order_id: orderId,
        order_number: order.order_number,
        destination: normalizedDest,
        inventory_status: newStatus,
        reason: trimmedReason,
        determined_by_user_id: inspectorUserId,
        determined_at: disposition.determined_at,
      };

      await client.query(
        `INSERT INTO domain_event_outbox (
           tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
         ) VALUES ($1, $2, $2, 'EquipmentDestinationDetermined', 'inventory.destination.determined', $3::jsonb)
         ON CONFLICT (aggregate_id, event_type) DO UPDATE SET
           payload = EXCLUDED.payload,
           created_at = NOW(),
           published_at = NULL`,
        [tenantId, orderId, JSON.stringify(payload)]
      );

      await client.query('COMMIT');
      return { order: updatedOrder, disposition };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
