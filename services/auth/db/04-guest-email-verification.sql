CREATE TABLE IF NOT EXISTS guest_email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    quote_id UUID NOT NULL,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    code_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts SMALLINT NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_guest_email_verifications_quote UNIQUE (tenant_id, quote_id),
    CONSTRAINT ck_guest_email_verifications_attempts CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_guest_email_verifications_rate_limit
    ON guest_email_verifications (tenant_id, lower(email), last_sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_email_verifications_expiry
    ON guest_email_verifications (expires_at)
    WHERE consumed_at IS NULL;
