ALTER TABLE processed_events
    ADD COLUMN IF NOT EXISTS tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_quotation_processed_events_tenant
    ON processed_events (tenant_id);