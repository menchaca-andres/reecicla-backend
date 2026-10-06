ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS quota_reservation_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_quota_reservation
    ON quotes (quota_reservation_id);