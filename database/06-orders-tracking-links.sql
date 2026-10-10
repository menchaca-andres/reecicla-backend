ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS tracking_token_hash BYTEA,
    ADD COLUMN IF NOT EXISTS tracking_token_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tracking_token_hash
    ON orders (tracking_token_hash)
    WHERE tracking_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_tracking_token_expiry
    ON orders (tracking_token_expires_at)
    WHERE tracking_token_hash IS NOT NULL;
