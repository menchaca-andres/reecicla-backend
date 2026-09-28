-- =====================================================
-- Migración 001: Tablas de cotización
-- Servicio: quotation-service
-- Base de datos: reecicla_quotation_db
-- PostgreSQL 18
-- =====================================================

-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabla de cotizaciones (quotes)
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    brand VARCHAR(100),
    model VARCHAR(100),
    year INTEGER,
    condition VARCHAR(50) NOT NULL,
    base_price DECIMAL(10,2) NOT NULL,
    adjustment DECIMAL(10,2) DEFAULT 0,
    final_price DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_quotes_tenant ON quotes(tenant_id);
CREATE INDEX idx_quotes_user ON quotes(user_id);
CREATE INDEX idx_quotes_device_type ON quotes(device_type);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_created_at ON quotes(created_at);

-- Comentario de documentación
COMMENT ON TABLE quotes IS 'Cotizaciones de equipos electrónicos usados';
COMMENT ON COLUMN quotes.tenant_id IS 'Identificador del tenant/empresa';
COMMENT ON COLUMN quotes.user_id IS 'Referencia al usuario que solicitó la cotización (en reecicla_auth_db.users)';
COMMENT ON COLUMN quotes.device_type IS 'Tipo de dispositivo: refrigerator, washing_machine, dishwasher, stove, etc.';
COMMENT ON COLUMN quotes.condition IS 'Condición declarada: working, damaged, broken, etc.';
COMMENT ON COLUMN quotes.base_price IS 'Precio base según tipo de dispositivo';
COMMENT ON COLUMN quotes.adjustment IS 'Ajuste por condición, antigüedad, etc. (puede ser negativo)';
COMMENT ON COLUMN quotes.final_price IS 'Precio final: base_price + adjustment';
COMMENT ON COLUMN quotes.status IS 'Estado: PENDING, ACCEPTED, REJECTED, EXPIRED';

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_quotes_updated_at
    BEFORE UPDATE ON quotes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Tabla de reglas de cotización (opcional, para Sprint 2+)
CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    rule_key VARCHAR(100) NOT NULL,
    rule_value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_pricing_rules_tenant ON pricing_rules(tenant_id);
CREATE INDEX idx_pricing_rules_device_type ON pricing_rules(device_type);
CREATE UNIQUE INDEX idx_pricing_rules_unique ON pricing_rules(tenant_id, device_type, rule_key);

COMMENT ON TABLE pricing_rules IS 'Reglas de cotización por tipo de dispositivo y tenant';
COMMENT ON COLUMN pricing_rules.rule_key IS 'Clave de la regla: base_price, condition_adjustment, age_factor, etc.';
COMMENT ON COLUMN pricing_rules.rule_value IS 'Valor de la regla en formato JSON (flexible para diferentes tipos de reglas)';

-- Trigger para pricing_rules
CREATE TRIGGER update_pricing_rules_updated_at
    BEFORE UPDATE ON pricing_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Datos de prueba (OPCIONAL, solo para desarrollo)
-- Reglas hardcodeadas para MVP
INSERT INTO pricing_rules (tenant_id, device_type, rule_key, rule_value) VALUES
('00000000-0000-0000-0000-000000000001', 'refrigerator', 'base_price', '{"amount": 150, "currency": "USD"}'),
('00000000-0000-0000-0000-000000000001', 'refrigerator', 'condition_adjustment', '{"working": 0, "damaged": -50, "broken": -100}'),
('00000000-0000-0000-0000-000000000001', 'washing_machine', 'base_price', '{"amount": 120, "currency": "USD"}'),
('00000000-0000-0000-0000-000000000001', 'washing_machine', 'condition_adjustment', '{"working": 0, "damaged": -40, "broken": -80}');

-- =====================================================
-- Verificación
-- =====================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'quotes';
