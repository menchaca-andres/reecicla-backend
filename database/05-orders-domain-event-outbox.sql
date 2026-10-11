CREATE TABLE IF NOT EXISTS domain_event_outbox (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    aggregate_id UUID NOT NULL,
    correlation_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    routing_key VARCHAR(150) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    CONSTRAINT uq_domain_event_outbox_aggregate_type UNIQUE (aggregate_id, event_type)
);

ALTER TABLE order_status_history
    ADD COLUMN IF NOT EXISTS changed_by_user UUID;

CREATE OR REPLACE FUNCTION record_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
    operator_id UUID;
    status_reason TEXT;
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        operator_id := NULLIF(current_setting('reecicla.operator_user_id', true), '')::UUID;
        status_reason := NULLIF(current_setting('reecicla.status_reason', true), '');
        INSERT INTO order_status_history (
            tenant_id, order_id, previous_status, new_status, changed_by_user, reason
        ) VALUES (
            NEW.tenant_id, NEW.id, OLD.status, NEW.status, operator_id, status_reason
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_status_history ON orders;
CREATE TRIGGER trg_orders_status_history
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION record_order_status_change();

CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_pending
    ON domain_event_outbox (created_at)
    WHERE published_at IS NULL;
