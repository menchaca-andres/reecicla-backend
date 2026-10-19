CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency CHAR(3) NOT NULL,
    method VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    reference VARCHAR(150),
    failure_reason TEXT,
    internal_receipt_path TEXT NOT NULL,
    internal_receipt_mime_type VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    internal_receipt_sha256 CHAR(64) NOT NULL,
    external_receipt_path TEXT,
    external_receipt_mime_type VARCHAR(100),
    external_receipt_sha256 CHAR(64),
    paid_by_user_id UUID NOT NULL,
    paid_by_user_name VARCHAR(255),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payments_tenant_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT ck_payments_amount CHECK (amount > 0),
    CONSTRAINT ck_payments_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_payments_method CHECK (method IN ('BANK_TRANSFER', 'CHECK')),
    CONSTRAINT ck_payments_status CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_order
    ON payments (tenant_id, order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_status
    ON payments (tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_one_completed_per_order
    ON payments (tenant_id, order_id)
    WHERE status = 'COMPLETED';

CREATE TABLE IF NOT EXISTS payment_event_outbox (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    aggregate_id UUID NOT NULL,
    correlation_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    routing_key VARCHAR(150) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    CONSTRAINT uq_payment_outbox_aggregate_type UNIQUE (aggregate_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_payment_outbox_pending
    ON payment_event_outbox (created_at)
    WHERE published_at IS NULL;
