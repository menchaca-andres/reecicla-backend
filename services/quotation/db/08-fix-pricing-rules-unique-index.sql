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
