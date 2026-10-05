-- ============================================================
-- CATALOG DB — Migración 05
-- Servicio: catalog-service
-- Agrega: tabla devices (Modelo B — catálogo completo)
-- ============================================================

-- ── Devices (catálogo de dispositivos: tipo + marca + modelo + año) ──
CREATE TABLE IF NOT EXISTS devices (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    device_type_id  UUID         NOT NULL,
    brand_id        UUID         NOT NULL,
    model           VARCHAR(200) NOT NULL,
    year            SMALLINT,
    description     TEXT,
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- FK compuesta: garantiza que el device_type pertenece al mismo tenant
    CONSTRAINT fk_devices_device_type
        FOREIGN KEY (tenant_id, device_type_id)
        REFERENCES device_types (tenant_id, id),
    -- FK simple a device_brands (brand ya validó su tenant al crearse)
    CONSTRAINT fk_devices_brand
        FOREIGN KEY (brand_id)
        REFERENCES device_brands (id),
    CONSTRAINT ck_devices_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_devices_year
        CHECK (year IS NULL OR (year >= 1990 AND year <= 2100))
);

CREATE INDEX IF NOT EXISTS idx_devices_tenant      ON devices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_type ON devices (device_type_id);
CREATE INDEX IF NOT EXISTS idx_devices_brand       ON devices (brand_id);

CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Seed: dispositivos demo ──────────────────────────────────
-- Insertar algunos dispositivos de ejemplo usando los tipos y marcas ya seeded
INSERT INTO devices (tenant_id, device_type_id, brand_id, model, year, description)
SELECT
    dt.tenant_id,
    dt.id AS device_type_id,
    db.id AS brand_id,
    d.model,
    d.year,
    d.description
FROM device_types dt
JOIN device_brands db ON db.device_type_id = dt.id AND db.tenant_id = dt.tenant_id
JOIN (
    VALUES
        ('REFRIGERATOR',   'Samsung',    'No Frost 400L',         2022, 'Refrigerador familiar doble puerta'),
        ('REFRIGERATOR',   'LG',         'Inverter 350L',         2021, 'Refrigerador LG inverter'),
        ('WASHING_MACHINE','Samsung',    'WW12T Eco Bubble 12kg', 2023, 'Lavadora automática de carga frontal'),
        ('WASHING_MACHINE','LG',         'F4WV710S2EA 10.5kg',    2022, 'Lavadora LG con vapor'),
        ('TV',             'Samsung',    'QLED 55" Q70A',         2021, 'Smart TV 4K QLED'),
        ('TV',             'LG',         'OLED 55" C1',           2021, 'Smart TV 4K OLED'),
        ('TV',             'Sony',       'X80J 50"',              2022, 'Smart TV 4K LED'),
        ('LAPTOP',         'Apple',      'MacBook Air M2',        2023, 'Laptop ultrabook Apple Silicon'),
        ('LAPTOP',         'Dell',       'XPS 15 9530',           2023, 'Laptop premium Dell'),
        ('LAPTOP',         'Lenovo',     'ThinkPad X1 Carbon',    2022, 'Laptop empresarial Lenovo'),
        ('LAPTOP',         'HP',         'EliteBook 840 G9',      2022, 'Laptop profesional HP'),
        ('SMARTPHONE',     'Apple',      'iPhone 14',             2022, 'Smartphone Apple'),
        ('SMARTPHONE',     'Samsung',    'Galaxy S23',            2023, 'Smartphone Samsung flagship'),
        ('SMARTPHONE',     'Xiaomi',     'Redmi Note 12',         2023, 'Smartphone Xiaomi mid-range'),
        ('MICROWAVE',      'LG',         'MS2042DB 20L',          2020, 'Microondas LG básico'),
        ('MICROWAVE',      'Samsung',    'MS28F303TAS 28L',       2021, 'Microondas Samsung acero')
) AS d(type_code, brand_name, model, year, description)
WHERE dt.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND dt.code = d.type_code
  AND db.name = d.brand_name
ON CONFLICT DO NOTHING;
