-- ============================================================
-- HU-022: eventos de ciclo de vida de cotizaciones para Reporting
-- ============================================================
-- Reporting arma su read model solo con eventos (sin leer QUOTATION DB).
-- Hasta ahora Quotation solo publicaba aceptaciones y ajustes, así que
-- creaciones, rechazos y vencimientos no llegaban a ningún consumidor.
--
-- Cada INSERT de una cotización y cada cambio de status escribe un
-- QuoteStatusChanged en el outbox existente, en la misma transacción.
-- quoteOutbox.ts lo publica con la routing key 'quote.status.changed'.
-- Al ser un trigger cubre también los UPDATE masivos (job de vencimiento)
-- sin tocar cada consulta del servicio.

CREATE OR REPLACE FUNCTION enqueue_quote_status_changed()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    INSERT INTO quote_event_outbox (event_id, correlation_id, tenant_id, event_type, payload)
    VALUES (
        gen_random_uuid(),
        NEW.id,
        NEW.tenant_id,
        'QuoteStatusChanged',
        jsonb_build_object(
            'quote_id', NEW.id,
            'quote_type', NEW.quote_type,
            'parent_quote_id', NEW.parent_quote_id,
            'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
            'status', NEW.status,
            'device_type_id', NEW.device_type_id,
            'device_type_name', NEW.device_type_name,
            'final_price', NEW.final_price,
            'currency', NEW.currency,
            'quote_created_at', NEW.created_at,
            'changed_at', clock_timestamp()
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quotes_status_events ON quotes;
CREATE TRIGGER trg_quotes_status_events
AFTER INSERT OR UPDATE OF status ON quotes
FOR EACH ROW EXECUTE FUNCTION enqueue_quote_status_changed();

-- Backfill: publica el estado actual de las cotizaciones que ya existían
-- antes de este script para que el reporte no arranque vacío.
INSERT INTO quote_event_outbox (event_id, correlation_id, tenant_id, event_type, payload)
SELECT
    gen_random_uuid(),
    q.id,
    q.tenant_id,
    'QuoteStatusChanged',
    jsonb_build_object(
        'quote_id', q.id,
        'quote_type', q.quote_type,
        'parent_quote_id', q.parent_quote_id,
        'previous_status', NULL,
        'status', q.status,
        'device_type_id', q.device_type_id,
        'device_type_name', q.device_type_name,
        'final_price', q.final_price,
        'currency', q.currency,
        'quote_created_at', q.created_at,
        'changed_at', q.updated_at
    )
FROM quotes q
WHERE NOT EXISTS (
    SELECT 1 FROM quote_event_outbox o
    WHERE o.event_type = 'QuoteStatusChanged'
      AND o.correlation_id = q.id
);
