-- ============================================================
-- ORDERS DB — Migración 03
-- Servicio: orders-service
-- Base de datos: reecicla_orders_db
-- Alineado con: script.sql definitivo (Reecicla v1.0)
-- ============================================================
-- Sin FKs cross-DB: user_id, quote_id, device_type_id son refs lógicas.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Secuencia para números legibles de orden ──────────────────
CREATE SEQUENCE order_number_seq START 1;

-- ── Orders ────────────────────────────────────────────────────
CREATE TABLE orders (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID         NOT NULL,
    order_number      VARCHAR(30)  NOT NULL,
    user_id           UUID,                            -- ref lógica → Auth DB; NULL for guest orders
    quote_id          UUID         NOT NULL,           -- ref lógica → Quotation DB
    device_type_id    UUID         NOT NULL,           -- ref lógica → Catalog DB
    device_type_name  VARCHAR(120) NOT NULL,           -- snapshot
    brand             VARCHAR(100),                   -- snapshot declarado
    model             VARCHAR(100),                   -- snapshot declarado
    device_year       SMALLINT,                       -- snapshot declarado
    declared_condition VARCHAR(50),                   -- snapshot declarado
    quoted_price      NUMERIC(12,2) NOT NULL,
    final_price       NUMERIC(12,2),
    currency          CHAR(3)      NOT NULL DEFAULT 'BOB',
    -- Estado: describe el proceso, NO el destino (eso va en dispositions).
    -- La orden nace en ACCEPTED (creada desde cotización aceptada).
    status            VARCHAR(40)  NOT NULL DEFAULT 'ACCEPTED',
    customer_name     VARCHAR(255) NOT NULL,
    customer_email    VARCHAR(255) NOT NULL,
    customer_phone    VARCHAR(50),
    pickup_address    JSONB,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    accepted_at       TIMESTAMPTZ,
    received_at       TIMESTAMPTZ,
    CONSTRAINT uq_orders_tenant_order_number
        UNIQUE (tenant_id, order_number),
    -- Idempotencia HU-011: una cotización genera una sola orden.
    CONSTRAINT uq_orders_tenant_quote
        UNIQUE (tenant_id, quote_id),
    CONSTRAINT ck_orders_prices
        CHECK (quoted_price >= 0 AND (final_price IS NULL OR final_price >= 0)),
    CONSTRAINT ck_orders_device_year
        CHECK (device_year IS NULL OR device_year BETWEEN 1800 AND 2200),
    CONSTRAINT ck_orders_status CHECK (status IN (
        'ACCEPTED',
        'BOX_REQUESTED',
        'BOX_SHIPPED',
        'IN_TRANSIT',
        'RECEIVED',
        'INSPECTING',
        'INSPECTED',
        'ADJUSTMENT_PENDING',
        'ADJUSTMENT_REJECTED',
        'PAYMENT_PENDING',
        'PAID',
        'DISPOSED',
        'CLOSED',
        'CANCELLED'
    ))
);

CREATE INDEX idx_orders_tenant_user  ON orders (tenant_id, user_id);
CREATE INDEX idx_orders_quote        ON orders (quote_id);
CREATE INDEX idx_orders_status       ON orders (tenant_id, status);

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Order Status History ──────────────────────────────────────
-- Sin ON DELETE CASCADE: la auditoría no debe desaparecer con la orden.
CREATE TABLE order_status_history (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    order_id        UUID        NOT NULL,
    previous_status VARCHAR(40),
    new_status      VARCHAR(40) NOT NULL,
    changed_by_user UUID,                -- ref lógica → Auth DB
    reason          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_order_status_history_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX idx_order_status_history_order
    ON order_status_history (order_id, created_at);

-- ── Box Requests ──────────────────────────────────────────────
-- Una orden puede tener varias cajas (pérdidas, fallos de entrega).
CREATE TABLE box_requests (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    order_id     UUID        NOT NULL,
    tracking_code VARCHAR(100),
    label_url    TEXT,
    status       VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    shipped_at   TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_box_requests_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT ck_box_requests_status
        CHECK (status IN ('REQUESTED', 'SHIPPED', 'DELIVERED', 'LOST', 'CANCELLED'))
);

CREATE INDEX idx_box_requests_order ON box_requests (order_id);

CREATE TRIGGER trg_box_requests_updated_at
    BEFORE UPDATE ON box_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Dispositions (HU-025) ─────────────────────────────────────
-- Destino final del equipo: RESALE o RECYCLE. Sprint 4.
CREATE TABLE dispositions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    order_id     UUID        NOT NULL,
    type         VARCHAR(20) NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reference    VARCHAR(255),  -- certificado de destrucción o ref de publicación
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_dispositions_order
        FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT uq_dispositions_order UNIQUE (order_id),
    CONSTRAINT ck_dispositions_type   CHECK (type   IN ('RESALE', 'RECYCLE')),
    CONSTRAINT ck_dispositions_status CHECK (status IN ('PENDING', 'COMPLETED'))
);

CREATE TRIGGER trg_dispositions_updated_at
    BEFORE UPDATE ON dispositions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS processed_events (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    tenant_id UUID NOT NULL,
    correlation_id UUID NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_processed_events_tenant
    ON processed_events (tenant_id, processed_at);
