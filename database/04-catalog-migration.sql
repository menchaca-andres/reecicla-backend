-- ============================================================
-- CATALOG DB — Migración 04
-- Servicio: catalog-service
-- Base de datos: reecicla_catalog_db
-- Alineado con: script.sql definitivo (Reecicla v1.0)
-- ============================================================
-- NOTA: pricing_rules NO va aquí. Es responsabilidad de Quotation DB.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Device Types ──────────────────────────────────────────────
-- Los tipos se INACTIVAN, nunca se borran (HU-023, S4 kata).
-- last_received_at: el job de 12 meses usa este campo para detectar inactivación.
CREATE TABLE device_types (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    code            VARCHAR(60)  NOT NULL,
    name            VARCHAR(120) NOT NULL,
    description     TEXT,
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    accepts_quotes  BOOLEAN      NOT NULL DEFAULT TRUE,
    last_received_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    inactivated_at  TIMESTAMPTZ,
    CONSTRAINT uq_device_types_tenant_code UNIQUE (tenant_id, code),
    -- FK compuesta para que marcas y reglas no puedan pertenecer a un tenant distinto.
    CONSTRAINT uq_device_types_tenant_id   UNIQUE (tenant_id, id),
    CONSTRAINT ck_device_types_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX idx_device_types_tenant ON device_types (tenant_id);

CREATE TRIGGER trg_device_types_updated_at
    BEFORE UPDATE ON device_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Device Brands ─────────────────────────────────────────────
CREATE TABLE device_brands (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    device_type_id UUID         NOT NULL,
    name           VARCHAR(120) NOT NULL,
    status         VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- FK compuesta: la marca no puede pertenecer a un tenant distinto al de su tipo.
    CONSTRAINT fk_device_brands_device_type
        FOREIGN KEY (tenant_id, device_type_id)
        REFERENCES device_types (tenant_id, id),
    CONSTRAINT uq_device_brands_tenant_type_name
        UNIQUE (tenant_id, device_type_id, name),
    CONSTRAINT ck_device_brands_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX idx_device_brands_type ON device_brands (device_type_id);

CREATE TRIGGER trg_device_brands_updated_at
    BEFORE UPDATE ON device_brands
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Evaluation Rules ──────────────────────────────────────────
-- Versionadas: la inspección referencia la versión vigente al momento de ejecutarse.
CREATE TABLE evaluation_rules (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    device_type_id  UUID        NOT NULL,
    version         INTEGER     NOT NULL,
    checklist       JSONB       NOT NULL,
    resale_criteria JSONB       NOT NULL,
    recycle_criteria JSONB      NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_until TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_evaluation_rules_device_type
        FOREIGN KEY (tenant_id, device_type_id)
        REFERENCES device_types (tenant_id, id),
    CONSTRAINT uq_evaluation_rules_type_version
        UNIQUE (device_type_id, version),
    CONSTRAINT ck_evaluation_rules_version
        CHECK (version > 0),
    CONSTRAINT ck_evaluation_rules_dates
        CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX idx_evaluation_rules_type ON evaluation_rules (device_type_id);

-- Solo una regla de evaluación activa por tipo.
CREATE UNIQUE INDEX uq_evaluation_rules_one_active
    ON evaluation_rules (device_type_id)
    WHERE is_active;

CREATE TRIGGER trg_evaluation_rules_updated_at
    BEFORE UPDATE ON evaluation_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Seed: tipos de dispositivo para el tenant demo ────────────
INSERT INTO device_types (tenant_id, code, name, description) VALUES
    ('00000000-0000-0000-0000-000000000001', 'REFRIGERATOR',   'Refrigerador',  'Refrigerador doméstico'),
    ('00000000-0000-0000-0000-000000000001', 'WASHING_MACHINE', 'Lavadora',      'Lavadora doméstica'),
    ('00000000-0000-0000-0000-000000000001', 'TV',              'Televisor',     'Televisor / Smart TV'),
    ('00000000-0000-0000-0000-000000000001', 'LAPTOP',          'Laptop',        'Notebook / Laptop'),
    ('00000000-0000-0000-0000-000000000001', 'SMARTPHONE',      'Smartphone',    'Celular / Smartphone'),
    ('00000000-0000-0000-0000-000000000001', 'MICROWAVE',       'Horno de Microondas', 'Horno microondas doméstico')
ON CONFLICT (tenant_id, code) DO NOTHING;