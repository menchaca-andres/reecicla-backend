-- =====================================================
-- Migración 004: Catálogo de dispositivos
-- Servicio: catalog-service
-- Base de datos: reecicla_catalog_db
-- PostgreSQL 18
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE device_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    accepts_quotes BOOLEAN NOT NULL DEFAULT TRUE,
    last_received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    inactivated_at TIMESTAMPTZ,
    CONSTRAINT chk_device_types_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    CONSTRAINT uq_device_types_tenant_code UNIQUE (tenant_id, code)
);

COMMENT ON TABLE device_types IS 'Tipos de equipos electrónicos aceptados por tenant.';
COMMENT ON COLUMN device_types.code IS 'Código técnico estable, ejemplo: REFRIGERATOR o WASHING_MACHINE.';

CREATE INDEX idx_device_types_tenant ON device_types(tenant_id);
CREATE INDEX idx_device_types_active ON device_types(tenant_id, status) WHERE status = 'ACTIVE';

-- Marcas permitidas por tipo de dispositivo
CREATE TABLE device_brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_type_id UUID NOT NULL REFERENCES device_types(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_device_brands_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- Índice único case-insensitive para marcas (CORREGIDO)
CREATE UNIQUE INDEX idx_device_brands_unique_name 
ON device_brands(tenant_id, device_type_id, LOWER(name));

CREATE INDEX idx_device_brands_type ON device_brands(tenant_id, device_type_id);

-- Reglas básicas para cotización
CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_type_id UUID NOT NULL REFERENCES device_types(id) ON DELETE CASCADE,
    base_price NUMERIC(12,2) NOT NULL CHECK (base_price >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    condition_adjustments JSONB NOT NULL DEFAULT '{}'::jsonb,
    min_year SMALLINT,
    max_year SMALLINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_pricing_rule_years CHECK (
        min_year IS NULL OR max_year IS NULL OR min_year <= max_year
    )
);

CREATE INDEX idx_pricing_rules_tenant_type ON pricing_rules(tenant_id, device_type_id);
CREATE INDEX idx_pricing_rules_active ON pricing_rules(tenant_id, device_type_id, is_active) WHERE is_active = TRUE;

-- Checklists de inspección
CREATE TABLE evaluation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_type_id UUID NOT NULL REFERENCES device_types(id) ON DELETE CASCADE,
    checklist JSONB NOT NULL,
    resale_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    recycle_criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evaluation_rules_tenant_type ON evaluation_rules(tenant_id, device_type_id);

-- Función y triggers de updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_device_types_updated_at
BEFORE UPDATE ON device_types
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_device_brands_updated_at
BEFORE UPDATE ON device_brands
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_pricing_rules_updated_at
BEFORE UPDATE ON pricing_rules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_evaluation_rules_updated_at
BEFORE UPDATE ON evaluation_rules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Datos iniciales
INSERT INTO device_types (tenant_id, code, name, description)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'REFRIGERATOR', 'Refrigerador', 'Refrigerador doméstico'),
    ('00000000-0000-0000-0000-000000000001', 'WASHING_MACHINE', 'Lavadora', 'Lavadora doméstica')
ON CONFLICT (tenant_id, code) DO NOTHING;

INSERT INTO pricing_rules (tenant_id, device_type_id, base_price, currency, condition_adjustments)
SELECT
    dt.tenant_id,
    dt.id,
    CASE dt.code
        WHEN 'REFRIGERATOR' THEN 150.00
        WHEN 'WASHING_MACHINE' THEN 120.00
    END,
    'USD',
    CASE dt.code
        WHEN 'REFRIGERATOR' THEN '{"WORKING":0,"DAMAGED":-50,"BROKEN":-100}'::jsonb
        WHEN 'WASHING_MACHINE' THEN '{"WORKING":0,"DAMAGED":-40,"BROKEN":-80}'::jsonb
    END
FROM device_types dt
WHERE dt.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND dt.code IN ('REFRIGERATOR', 'WASHING_MACHINE')
  AND NOT EXISTS (
    SELECT 1 FROM pricing_rules pr
    WHERE pr.tenant_id = dt.tenant_id
      AND pr.device_type_id = dt.id
      AND pr.is_active = TRUE
  );