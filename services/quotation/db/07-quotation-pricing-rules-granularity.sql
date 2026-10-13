ALTER TABLE pricing_rules
    ADD COLUMN IF NOT EXISTS brand_id UUID,
    ADD COLUMN IF NOT EXISTS brand_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS model VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_brand_model
    ON pricing_rules (tenant_id, device_type_id, brand_id);

DROP INDEX IF EXISTS uq_pricing_rules_one_active;

CREATE UNIQUE INDEX uq_pricing_rules_one_active
    ON pricing_rules (
        tenant_id,
        device_type_id,
        COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(model, ''),
        COALESCE(min_year, -1),
        COALESCE(max_year, -1)
    )
    WHERE is_active;

