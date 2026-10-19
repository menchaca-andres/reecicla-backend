CREATE TABLE IF NOT EXISTS order_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id),
    notification_type VARCHAR(80) NOT NULL,
    channel VARCHAR(20) NOT NULL DEFAULT 'EMAIL',
    recipient VARCHAR(320) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_order_notifications_type UNIQUE (tenant_id, order_id, notification_type),
    CONSTRAINT ck_order_notifications_channel CHECK (channel IN ('EMAIL')),
    CONSTRAINT ck_order_notifications_status CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
    CONSTRAINT ck_order_notifications_attempt_count CHECK (attempt_count >= 0)
);

ALTER TABLE order_notifications
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_order_notifications_sent
    ON order_notifications (tenant_id, order_id, sent_at)
    WHERE status = 'SENT';

CREATE INDEX IF NOT EXISTS idx_order_notifications_retry
    ON order_notifications (next_attempt_at)
    WHERE status = 'FAILED';
