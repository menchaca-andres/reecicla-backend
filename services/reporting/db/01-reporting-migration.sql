-- ============================================================
-- REPORTING DB — HU-022 Ver reportes del negocio
-- ============================================================
-- Read model simplificado (documento oficial, sección 4.2): se alimenta
-- solo de eventos del broker. No hay FKs ni lecturas hacia otras bases;
-- quote_id, order_id, payment_id y device_type_id son referencias lógicas.
--
-- Cada proyección guarda last_changed_at (marca de tiempo del evento en
-- origen) para ignorar eventos viejos que lleguen fuera de orden.

-- Idempotencia de mensajería (TE-02): un evento se proyecta una sola vez.
CREATE TABLE IF NOT EXISTS processed_events (
    event_id      UUID         PRIMARY KEY,
    event_type    VARCHAR(100) NOT NULL,
    tenant_id     UUID         NOT NULL,
    processed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processed_events_tenant
    ON processed_events (tenant_id, processed_at DESC);

-- Cotizaciones (evento quote.status.changed).
CREATE TABLE IF NOT EXISTS report_quotes (
    tenant_id         UUID          NOT NULL,
    quote_id          UUID          NOT NULL,
    quote_type        VARCHAR(20)   NOT NULL,
    status            VARCHAR(30)   NOT NULL,
    device_type_id    UUID,
    device_type_name  VARCHAR(120),
    final_price       NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency          CHAR(3)       NOT NULL DEFAULT 'BOB',
    quote_created_at  TIMESTAMPTZ   NOT NULL,
    last_changed_at   TIMESTAMPTZ   NOT NULL,
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, quote_id),
    CONSTRAINT ck_report_quotes_type CHECK (quote_type IN ('INITIAL', 'ADJUSTED')),
    CONSTRAINT ck_report_quotes_status
        CHECK (status IN ('ANONYMOUS', 'PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'))
);

CREATE INDEX IF NOT EXISTS idx_report_quotes_tenant_created
    ON report_quotes (tenant_id, quote_created_at);

-- Órdenes (evento order.status.changed). Guarda el estado actual.
CREATE TABLE IF NOT EXISTS report_orders (
    tenant_id         UUID          NOT NULL,
    order_id          UUID          NOT NULL,
    order_number      VARCHAR(30),
    status            VARCHAR(40)   NOT NULL,
    device_type_id    UUID,
    device_type_name  VARCHAR(120),
    quoted_price      NUMERIC(12,2),
    final_price       NUMERIC(12,2),
    currency          CHAR(3)       NOT NULL DEFAULT 'BOB',
    order_created_at  TIMESTAMPTZ   NOT NULL,
    last_changed_at   TIMESTAMPTZ   NOT NULL,
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_report_orders_tenant_created
    ON report_orders (tenant_id, order_created_at);
CREATE INDEX IF NOT EXISTS idx_report_orders_tenant_status
    ON report_orders (tenant_id, status);

-- Pagos (eventos payment.completed y payment.failed). Un intento por fila.
CREATE TABLE IF NOT EXISTS report_payments (
    tenant_id       UUID          NOT NULL,
    payment_id      UUID          NOT NULL,
    order_id        UUID          NOT NULL,
    method          VARCHAR(20)   NOT NULL,
    status          VARCHAR(20)   NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    currency        CHAR(3)       NOT NULL DEFAULT 'BOB',
    failure_reason  TEXT,
    occurred_at     TIMESTAMPTZ   NOT NULL,
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, payment_id),
    CONSTRAINT ck_report_payments_status CHECK (status IN ('COMPLETED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_report_payments_tenant_occurred
    ON report_payments (tenant_id, occurred_at);

-- Destino final de equipos (evento disposition.completed). RETURN es la
-- devolución al cliente tras rechazar el ajuste (HU-018/HU-025).
CREATE TABLE IF NOT EXISTS report_dispositions (
    tenant_id       UUID         NOT NULL,
    disposition_id  UUID         NOT NULL,
    order_id        UUID         NOT NULL,
    type            VARCHAR(20)  NOT NULL,
    completed_at    TIMESTAMPTZ  NOT NULL,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, disposition_id),
    CONSTRAINT ck_report_dispositions_type CHECK (type IN ('RESALE', 'RECYCLE', 'RETURN'))
);

CREATE INDEX IF NOT EXISTS idx_report_dispositions_tenant_completed
    ON report_dispositions (tenant_id, completed_at);
