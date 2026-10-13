CREATE TABLE IF NOT EXISTS client_email_registrations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL DEFAULT '',
    phone         VARCHAR(50),
    code_hash     VARCHAR(64) NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    attempts      SMALLINT NOT NULL DEFAULT 0,
    last_sent_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_client_email_registration UNIQUE (tenant_id, email),
    CONSTRAINT ck_client_email_registration_attempts CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_client_email_registrations_expiry
    ON client_email_registrations (expires_at);
