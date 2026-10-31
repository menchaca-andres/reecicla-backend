-- ============================================================
-- HU-022: eventos de cambio de estado de órdenes para Reporting
-- ============================================================
-- Reporting necesita "órdenes por estado" sin leer ORDERS DB.
-- order_status_history ya registra la creación de la orden (NULL -> ACCEPTED)
-- y cada cambio de estado (trigger trg_orders_status_history), así que basta
-- con escuchar sus INSERT y dejar un OrderStatusChanged en el outbox
-- existente; dispatchPendingOrderEvents lo publica con la routing key
-- 'order.status.changed'.
--
-- aggregate_id = id de la fila de historial: el outbox tiene
-- UNIQUE (aggregate_id, event_type) y una orden cambia de estado varias veces.
-- Las filas de historial que solo anotan algo sin cambiar de estado
-- (p. ej. ADJUSTMENT_REJECTED -> ADJUSTMENT_REJECTED) no generan evento.

CREATE OR REPLACE FUNCTION enqueue_order_status_changed()
RETURNS TRIGGER AS $$
DECLARE
    o RECORD;
BEGIN
    IF NEW.previous_status IS NOT DISTINCT FROM NEW.new_status THEN
        RETURN NEW;
    END IF;

    SELECT id, order_number, device_type_id, device_type_name, quoted_price,
           final_price, currency, created_at
    INTO o
    FROM orders
    WHERE id = NEW.order_id;

    INSERT INTO domain_event_outbox (
        tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
    ) VALUES (
        NEW.tenant_id,
        NEW.id,
        NEW.order_id,
        'OrderStatusChanged',
        'order.status.changed',
        jsonb_build_object(
            'order_id', NEW.order_id,
            'order_number', o.order_number,
            'previous_status', NEW.previous_status,
            'status', NEW.new_status,
            'device_type_id', o.device_type_id,
            'device_type_name', o.device_type_name,
            'quoted_price', o.quoted_price,
            'final_price', o.final_price,
            'currency', o.currency,
            'order_created_at', o.created_at,
            -- clock_timestamp y no NEW.created_at: DISPOSED y CLOSED se
            -- registran en la misma transacción y compartirían NOW().
            'changed_at', clock_timestamp()
        )
    )
    ON CONFLICT (aggregate_id, event_type) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_status_history_events ON order_status_history;
CREATE TRIGGER trg_order_status_history_events
AFTER INSERT ON order_status_history
FOR EACH ROW EXECUTE FUNCTION enqueue_order_status_changed();

-- Backfill: publica el historial que ya existía antes de este script.
INSERT INTO domain_event_outbox (
    tenant_id, aggregate_id, correlation_id, event_type, routing_key, payload
)
SELECT
    h.tenant_id,
    h.id,
    h.order_id,
    'OrderStatusChanged',
    'order.status.changed',
    jsonb_build_object(
        'order_id', h.order_id,
        'order_number', o.order_number,
        'previous_status', h.previous_status,
        'status', h.new_status,
        'device_type_id', o.device_type_id,
        'device_type_name', o.device_type_name,
        'quoted_price', o.quoted_price,
        'final_price', o.final_price,
        'currency', o.currency,
        'order_created_at', o.created_at,
        'changed_at', h.created_at
    )
FROM order_status_history h
JOIN orders o ON o.id = h.order_id
WHERE h.previous_status IS DISTINCT FROM h.new_status
ON CONFLICT (aggregate_id, event_type) DO NOTHING;
