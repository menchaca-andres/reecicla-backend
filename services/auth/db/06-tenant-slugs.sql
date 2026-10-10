ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug VARCHAR(80);

UPDATE tenants
SET slug = 'demo'
WHERE id = '00000000-0000-0000-0000-000000000001' AND slug IS NULL;

UPDATE tenants
SET slug = concat(
    coalesce(
        nullif(left(trim(BOTH '-' FROM regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), 50), ''),
        'business'
    ),
    '-',
    left(id::text, 8)
)
WHERE slug IS NULL;

ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tenants'::regclass AND conname = 'ck_tenants_slug'
    ) THEN
        ALTER TABLE tenants ADD CONSTRAINT ck_tenants_slug
            CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tenants'::regclass AND conname = 'ck_tenants_slug_length'
    ) THEN
        ALTER TABLE tenants ADD CONSTRAINT ck_tenants_slug_length CHECK (length(slug) <= 60);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug ON tenants (slug);
