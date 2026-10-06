CREATE TABLE IF NOT EXISTS quote_event_outbox (
    event_id UUID PRIMARY KEY,
    correlation_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_event_outbox_pending
    ON quote_event_outbox (created_at) WHERE published_at IS NULL;