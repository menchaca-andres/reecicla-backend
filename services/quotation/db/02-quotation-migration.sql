-- ============================================================
-- QUOTATION DB — Migración 02
-- Servicio: quotation-service
-- Base de datos: reecicla_quotation_db
-- Alineado con: script.sql definitivo (Reecicla v1.0)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Pricing Rules ─────────────────────────────────────────────
-- Versionadas: cambiar una regla no altera cotizaciones ya emitidas (HU-004).
-- device_type_id es referencia lógica al Catalog DB (sin FK cross-DB).
CREATE TABLE pricing_rules (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    device_type_id UUID         NOT NULL,  -- ref lógica → Catalog DB
    version        INTEGER      NOT NULL,
    base_price     NUMERIC(12,2) NOT NULL,
    currency       CHAR(3)      NOT NULL DEFAULT 'BOB',
    condition_adjust JSONB      NOT NULL DEFAULT '{}'::jsonb,
    min_year       SMALLINT,
    max_year       SMALLINT,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMPTZ  NOT NULL DEFAULT now(),
    effective_until TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_pricing_rules_type_version
        UNIQUE (tenant_id, device_type_id, version),
    CONSTRAINT ck_pricing_rules_version
        CHECK (version > 0),
    CONSTRAINT ck_pricing_rules_base_price
        CHECK (base_price >= 0),
    CONSTRAINT ck_pricing_rules_years
        CHECK (min_year IS NULL OR max_year IS NULL OR min_year <= max_year),
    CONSTRAINT ck_pricing_rules_dates
        CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX idx_pricing_rules_device_type
    ON pricing_rules (tenant_id, device_type_id);

-- Solo una regla activa por tipo y tenant.
CREATE UNIQUE INDEX uq_pricing_rules_one_active
    ON pricing_rules (tenant_id, device_type_id)
    WHERE is_active;

CREATE TRIGGER trg_pricing_rules_updated_at
    BEFORE UPDATE ON pricing_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Quotes ────────────────────────────────────────────────────
CREATE TABLE quotes (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID         NOT NULL,
    user_id          UUID         NOT NULL,  -- ref lógica → Auth DB
    pricing_rule_id  UUID         NOT NULL,
    device_type_id   UUID         NOT NULL,  -- ref lógica → Catalog DB
    device_type_name VARCHAR(120) NOT NULL,  -- snapshot
    brand            VARCHAR(100),           -- snapshot
    model            VARCHAR(100),
    year             SMALLINT,
    condition        VARCHAR(50)  NOT NULL,
    base_price       NUMERIC(12,2) NOT NULL,
    adjustment       NUMERIC(12,2) NOT NULL DEFAULT 0,
    final_price      NUMERIC(12,2) NOT NULL,
    currency         CHAR(3)      NOT NULL DEFAULT 'BOB',
    -- HU-017/HU-018: cotización ajustada referencia a la original.
    quote_type       VARCHAR(20)  NOT NULL DEFAULT 'INITIAL',
    parent_quote_id  UUID,
    -- HU-010: solo se aceptan cotizaciones vigentes.
    valid_until      TIMESTAMPTZ  NOT NULL,
    status           VARCHAR(30)  NOT NULL DEFAULT 'PENDING',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_quotes_pricing_rule
        FOREIGN KEY (pricing_rule_id) REFERENCES pricing_rules(id),
    CONSTRAINT fk_quotes_parent
        FOREIGN KEY (parent_quote_id) REFERENCES quotes(id),
    CONSTRAINT ck_quotes_prices
        CHECK (base_price >= 0 AND final_price >= 0),
    CONSTRAINT ck_quotes_year
        CHECK (year IS NULL OR year BETWEEN 1800 AND 2200),
    CONSTRAINT ck_quotes_type
        CHECK (
            (quote_type = 'INITIAL'  AND parent_quote_id IS NULL) OR
            (quote_type = 'ADJUSTED' AND parent_quote_id IS NOT NULL)
        ),
    CONSTRAINT ck_quotes_valid_until
        CHECK (valid_until > created_at),
    CONSTRAINT ck_quotes_status
        CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'))
);

CREATE INDEX idx_quotes_tenant_user ON quotes (tenant_id, user_id);
CREATE INDEX idx_quotes_status      ON quotes (tenant_id, status);
CREATE INDEX idx_quotes_parent      ON quotes (parent_quote_id);
-- Para el job que marca EXPIRED las cotizaciones vencidas.
CREATE INDEX idx_quotes_pending_valid_until
    ON quotes (valid_until) WHERE status = 'PENDING';

CREATE TRIGGER trg_quotes_updated_at
    BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
