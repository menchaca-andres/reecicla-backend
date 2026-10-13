ALTER TABLE received_devices
    ADD COLUMN IF NOT EXISTS quote_id UUID;
