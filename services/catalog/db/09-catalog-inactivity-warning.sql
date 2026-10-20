CREATE TABLE IF NOT EXISTS catalog_inactivity_warnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_type_id UUID NOT NULL,
    inactivity_since TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    warning_sent_at TIMESTAMPTZ,
    eligible_after TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_catalog_inactivity_warning_device_type
        FOREIGN KEY (tenant_id, device_type_id) REFERENCES device_types (tenant_id, id),
    CONSTRAINT uq_catalog_inactivity_warning_cycle
        UNIQUE (tenant_id, device_type_id, inactivity_since),
    CONSTRAINT ck_catalog_inactivity_warning_status
        CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
    CONSTRAINT ck_catalog_inactivity_warning_attempts
        CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_catalog_inactivity_warnings_retry
    ON catalog_inactivity_warnings (updated_at)
    WHERE status IN ('PENDING', 'FAILED', 'SENDING');
