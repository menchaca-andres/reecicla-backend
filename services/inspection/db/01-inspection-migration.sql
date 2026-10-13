-- ============================================================
-- INSPECTION DB — Migración 01
-- Servicio: inspection-service
-- Base de datos: reecicla_inspection_db
-- HU-015: Registrar inspección con checklist
-- ============================================================
-- Sin FKs hacia otras bases: order_id, device_type_id, evaluation_rule_id
-- e inspected_by_user son referencias lógicas a Orders, Catalog y Auth.

-- Equipos recibidos en almacén. Se alimenta del evento DeviceReceived
-- (Orders); Inspection no consulta la base de Orders.
CREATE TABLE IF NOT EXISTS received_devices (
    tenant_id        UUID         NOT NULL,
    order_id         UUID         NOT NULL, -- ID externo del Orders DB
    device_type_id   UUID         NOT NULL, -- ID externo del Catalog DB
    device_type_name VARCHAR(120) NOT NULL, -- snapshot
    received_at      TIMESTAMPTZ  NOT NULL,
    received_by_user UUID,                  -- ID externo del Auth DB
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_received_devices PRIMARY KEY (tenant_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_received_devices_tenant_received
    ON received_devices (tenant_id, received_at);

CREATE TABLE IF NOT EXISTS inspections (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL,
    order_id                UUID        NOT NULL, -- ID externo del Orders DB
    device_type_id          UUID        NOT NULL, -- ID externo del Catalog DB
    evaluation_rule_id      UUID        NOT NULL, -- ID externo del Catalog DB
    evaluation_rule_version INTEGER     NOT NULL, -- versión de la checklist usada
    -- REGISTERED: checklist registrada (HU-015).
    -- COMPLETED: resultado determinado (HU-016).
    status                  VARCHAR(20) NOT NULL DEFAULT 'REGISTERED',
    -- El resultado lo define HU-016; hasta entonces es NULL.
    result                  VARCHAR(30),
    actual_condition        VARCHAR(50) NOT NULL,
    observations            TEXT,
    evidence_refs           JSONB       NOT NULL DEFAULT '[]'::jsonb,
    inspected_by_user       UUID        NOT NULL, -- ID externo del Auth DB
    inspected_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_inspections_received_device
        FOREIGN KEY (tenant_id, order_id)
        REFERENCES received_devices (tenant_id, order_id),
    -- Una inspección por orden (la reinspección queda fuera de HU-015).
    CONSTRAINT uq_inspections_tenant_order UNIQUE (tenant_id, order_id),
    CONSTRAINT ck_inspections_status
        CHECK (status IN ('REGISTERED', 'COMPLETED')),
    CONSTRAINT ck_inspections_result
        CHECK (result IS NULL OR result IN ('RESALE', 'RECYCLE')),
    CONSTRAINT ck_inspections_rule_version
        CHECK (evaluation_rule_version > 0)
);

CREATE INDEX IF NOT EXISTS idx_inspections_tenant_inspected
    ON inspections (tenant_id, inspected_at);

CREATE TABLE IF NOT EXISTS inspection_items (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id   UUID         NOT NULL,
    criterion_key   VARCHAR(100) NOT NULL,
    criterion_label VARCHAR(255) NOT NULL, -- snapshot de la checklist
    criterion_type  VARCHAR(20)  NOT NULL, -- snapshot de la checklist
    value           JSONB        NOT NULL, -- true/false, número o texto
    -- PASS/FAIL solo aplica a criterios boolean; NULL en el resto.
    result          VARCHAR(30),
    observation     TEXT,
    evidence_refs   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_inspection_items_inspection
        FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
    CONSTRAINT uq_inspection_items_criterion UNIQUE (inspection_id, criterion_key),
    CONSTRAINT ck_inspection_items_type
        CHECK (criterion_type IN ('boolean', 'number', 'text', 'select')),
    CONSTRAINT ck_inspection_items_result
        CHECK (result IS NULL OR result IN ('PASS', 'FAIL', 'NOT_APPLICABLE'))
);

-- ── Mensajería (TE-02) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_events (
    event_id       UUID         PRIMARY KEY,
    event_type     VARCHAR(100) NOT NULL,
    tenant_id      UUID         NOT NULL,
    correlation_id UUID         NOT NULL,
    processed_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_processed_events_tenant
    ON processed_events (tenant_id, processed_at);

CREATE TABLE IF NOT EXISTS domain_event_outbox (
    event_id       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    aggregate_id   UUID         NOT NULL,
    correlation_id UUID         NOT NULL,
    event_type     VARCHAR(100) NOT NULL,
    routing_key    VARCHAR(150) NOT NULL,
    payload        JSONB        NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at   TIMESTAMPTZ,
    CONSTRAINT uq_domain_event_outbox_aggregate_type UNIQUE (aggregate_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_pending
    ON domain_event_outbox (created_at)
    WHERE published_at IS NULL;
