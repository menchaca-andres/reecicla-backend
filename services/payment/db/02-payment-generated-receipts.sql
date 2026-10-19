DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'payments'
          AND column_name = 'receipt_path'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'payments'
          AND column_name = 'external_receipt_path'
    ) THEN
        ALTER TABLE payments RENAME COLUMN receipt_path TO external_receipt_path;
        ALTER TABLE payments RENAME COLUMN receipt_mime_type TO external_receipt_mime_type;
        ALTER TABLE payments RENAME COLUMN receipt_sha256 TO external_receipt_sha256;
    END IF;
END $$;

ALTER TABLE payments
    ALTER COLUMN external_receipt_path DROP NOT NULL,
    ALTER COLUMN external_receipt_mime_type DROP NOT NULL,
    ALTER COLUMN external_receipt_sha256 DROP NOT NULL;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS internal_receipt_path TEXT,
    ADD COLUMN IF NOT EXISTS internal_receipt_mime_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS internal_receipt_sha256 CHAR(64),
    ADD COLUMN IF NOT EXISTS paid_by_user_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE payments
    ALTER COLUMN internal_receipt_path DROP NOT NULL,
    ALTER COLUMN internal_receipt_mime_type DROP NOT NULL,
    ALTER COLUMN internal_receipt_sha256 DROP NOT NULL;
