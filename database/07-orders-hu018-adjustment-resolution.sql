ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS adjustment_rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS adjustment_resolution VARCHAR(20),
    ADD COLUMN IF NOT EXISTS adjustment_resolution_at TIMESTAMPTZ;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS ck_orders_adjustment_resolution;

ALTER TABLE orders
    ADD CONSTRAINT ck_orders_adjustment_resolution
    CHECK (adjustment_resolution IS NULL OR adjustment_resolution IN ('RETURN', 'RECYCLE'));

ALTER TABLE dispositions
    DROP CONSTRAINT IF EXISTS ck_dispositions_type;

ALTER TABLE dispositions
    ADD CONSTRAINT ck_dispositions_type
    CHECK (type IN ('RESALE', 'RECYCLE', 'RETURN'));

CREATE INDEX IF NOT EXISTS idx_orders_adjustment_rejection_deadline
    ON orders (adjustment_rejected_at)
    WHERE status = 'ADJUSTMENT_REJECTED' AND adjustment_resolution IS NULL;
