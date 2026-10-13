ALTER TABLE pricing_rules
    ADD COLUMN IF NOT EXISTS device_type_code VARCHAR(60);