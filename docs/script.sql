-- ============================================================
-- AUTH DB
-- ============================================================

-- [NUEVO] Tenants: HU-001 habla de "contexto del tenant" y faltaba la tabla.
CREATE TABLE tenants (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenants_name UNIQUE (name),
    CONSTRAINT ck_tenants_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE users (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    -- [NUEVO] Rol: necesario para restringir catálogo (admin) e inspección (inspector).
    role VARCHAR(30) NOT NULL DEFAULT 'CLIENT',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- [NUEVO] FK válida: tenants y users viven en la misma base (AUTH DB).
    CONSTRAINT fk_users_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT ck_users_role
        CHECK (role IN ('CLIENT', 'INSPECTOR', 'CATALOG_ADMIN', 'TENANT_ADMIN'))
);

CREATE INDEX idx_users_tenant ON users (tenant_id);

-- [CAMBIO] Correo único por tenant SIN distinguir mayúsculas
-- (reemplaza a uq_users_tenant_email).
CREATE UNIQUE INDEX uq_users_tenant_email_lower
    ON users (tenant_id, lower(email));

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);


-- ============================================================
-- CATALOG DB
-- ============================================================
-- Los device_types se INACTIVAN (nunca se borran) para conservar historial.
-- [CAMBIO] Regla de los 12 meses del kata: un proceso programado INACTIVA
-- los tipos cuyo last_received_at supera 12 meses (o que nunca recibieron
-- equipos en ese plazo). Es la forma en que el sistema "elimina" el tipo
-- sin perder la información histórica.

CREATE TABLE device_types (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    code VARCHAR(60) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    -- status: ciclo de vida del tipo (ACTIVE / INACTIVE definitivo).
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    -- accepts_quotes: pausa temporal de cotizaciones sin inactivar el tipo.
    accepts_quotes BOOLEAN NOT NULL DEFAULT TRUE,
    last_received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    inactivated_at TIMESTAMPTZ,
    CONSTRAINT uq_device_types_tenant_code UNIQUE (tenant_id, code),
    -- [NUEVO] Permite FKs compuestas desde marcas y reglas (blinda el tenant).
    CONSTRAINT uq_device_types_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_device_types_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX idx_device_types_tenant ON device_types (tenant_id);

CREATE TABLE device_brands (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    device_type_id UUID NOT NULL,
    name VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- [CAMBIO] FK compuesta: la marca no puede pertenecer a un tenant
    -- distinto al de su tipo.
    CONSTRAINT fk_device_brands_device_type
        FOREIGN KEY (tenant_id, device_type_id)
        REFERENCES device_types (tenant_id, id),
    CONSTRAINT uq_device_brands_tenant_type_name
        UNIQUE (tenant_id, device_type_id, name),
    CONSTRAINT ck_device_brands_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX idx_device_brands_type ON device_brands (device_type_id);

-- Las pricing_rules NO van aquí: son responsabilidad de Quotation.

CREATE TABLE evaluation_rules (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    device_type_id UUID NOT NULL,
    version INTEGER NOT NULL,
    checklist JSONB NOT NULL,
    resale_criteria JSONB NOT NULL,
    recycle_criteria JSONB NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- [CAMBIO] FK compuesta (mismo motivo que en marcas).
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

-- [NUEVO] Una sola regla de evaluación activa por tipo.
CREATE UNIQUE INDEX uq_evaluation_rules_one_active
    ON evaluation_rules (device_type_id)
    WHERE is_active;


-- ============================================================
-- QUOTATION DB
-- ============================================================

CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    device_type_id UUID NOT NULL, -- ID externo del Catalog DB
    version INTEGER NOT NULL,
    base_price NUMERIC(12,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    condition_adjust JSONB NOT NULL DEFAULT '{}'::jsonb,
    min_year SMALLINT,
    max_year SMALLINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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

-- [NUEVO] Una sola regla de precio activa por tipo y tenant.
CREATE UNIQUE INDEX uq_pricing_rules_one_active
    ON pricing_rules (tenant_id, device_type_id)
    WHERE is_active;

CREATE TABLE quotes (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL, -- ID externo del Auth DB
    pricing_rule_id UUID NOT NULL, -- ID local de pricing_rules
    device_type_id UUID NOT NULL, -- ID externo del Catalog DB
    device_type_name VARCHAR(120) NOT NULL, -- snapshot
    brand VARCHAR(100), -- snapshot
    model VARCHAR(100),
    year SMALLINT,
    condition VARCHAR(50) NOT NULL,
    -- Precio: final_price = base_price + adjustment (adjustment puede ser negativo).
    -- "adjustment" es el ajuste por condición declarada al cotizar.
    base_price NUMERIC(12,2) NOT NULL,
    adjustment NUMERIC(12,2) NOT NULL DEFAULT 0,
    final_price NUMERIC(12,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    -- [NUEVO] Tipo de cotización y enlace a la original (para HU-017/HU-018).
    quote_type VARCHAR(20) NOT NULL DEFAULT 'INITIAL',
    parent_quote_id UUID, -- solo en cotizaciones ajustadas (misma base: FK válida)
    -- [NUEVO] Vigencia: HU-010 solo permite aceptar cotizaciones vigentes.
    valid_until TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_quotes_pricing_rule
        FOREIGN KEY (pricing_rule_id) REFERENCES pricing_rules(id),
    CONSTRAINT fk_quotes_parent
        FOREIGN KEY (parent_quote_id) REFERENCES quotes(id),
    CONSTRAINT ck_quotes_prices
        CHECK (base_price >= 0 AND final_price >= 0),
    -- [NUEVO] Mismo rango de año que en orders.
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
    -- Opcional: restringir 'condition' a los valores que use tu código, p. ej.
    -- CHECK (condition IN ('EXCELLENT', 'GOOD', 'FAIR', 'POOR'))
);

CREATE INDEX idx_quotes_tenant_user ON quotes (tenant_id, user_id);
CREATE INDEX idx_quotes_status ON quotes (tenant_id, status);
-- [NUEVO] Para el proceso que marca como EXPIRED las cotizaciones vencidas.
CREATE INDEX idx_quotes_pending_valid_until
    ON quotes (valid_until) WHERE status = 'PENDING';
CREATE INDEX idx_quotes_parent ON quotes (parent_quote_id);


-- ============================================================
-- ORDERS DB
-- ============================================================

-- [NUEVO] Fuente de números de orden. El servicio arma, por ejemplo,
-- 'ORD-' || lpad(nextval('order_number_seq')::text, 8, '0').
CREATE SEQUENCE order_number_seq START 1;

CREATE TABLE orders (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_number VARCHAR(30) NOT NULL,
    user_id UUID NOT NULL, -- ID externo del Auth DB
    quote_id UUID NOT NULL, -- ID externo del Quotation DB
    device_type_id UUID NOT NULL, -- ID externo del Catalog DB
    device_type_name VARCHAR(120) NOT NULL, -- snapshot
    brand VARCHAR(100), -- snapshot de lo declarado por el cliente
    model VARCHAR(100), -- snapshot de lo declarado por el cliente
    device_year SMALLINT, -- snapshot de lo declarado por el cliente
    declared_condition VARCHAR(50), -- snapshot de lo declarado por el cliente
    quoted_price NUMERIC(12,2) NOT NULL,
    final_price NUMERIC(12,2),
    currency CHAR(3) NOT NULL,
    -- [CAMBIO] La orden nace en ACCEPTED (se crea desde una cotización aceptada).
    -- El estado describe SOLO el proceso; el destino (reventa/reciclaje)
    -- vive en la tabla dispositions.
    status VARCHAR(40) NOT NULL DEFAULT 'ACCEPTED',
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    pickup_address JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    CONSTRAINT uq_orders_tenant_order_number
        UNIQUE (tenant_id, order_number),
    -- [NUEVO] Idempotencia de HU-011: una cotización genera una sola orden.
    CONSTRAINT uq_orders_tenant_quote
        UNIQUE (tenant_id, quote_id),
    CONSTRAINT ck_orders_prices
        CHECK (quoted_price >= 0 AND (final_price IS NULL OR final_price >= 0)),
    CONSTRAINT ck_orders_device_year
        CHECK (device_year IS NULL OR device_year BETWEEN 1800 AND 2200),
    -- [CAMBIO] Estados solo de proceso, incluido el camino del precio ajustado.
    CONSTRAINT ck_orders_status
        CHECK (status IN (
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

CREATE INDEX idx_orders_tenant_user ON orders (tenant_id, user_id);
CREATE INDEX idx_orders_quote ON orders (quote_id);
CREATE INDEX idx_orders_status ON orders (tenant_id, status);

CREATE TABLE order_status_history (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL,
    previous_status VARCHAR(40),
    new_status VARCHAR(40) NOT NULL,
    changed_by_user UUID, -- ID externo del Auth DB
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- [CAMBIO] Sin ON DELETE CASCADE: la auditoría no debe desaparecer con la orden.
    CONSTRAINT fk_order_status_history_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX idx_order_status_history_order
    ON order_status_history (order_id, created_at);

CREATE TABLE box_requests (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL,
    tracking_code VARCHAR(100),
    label_url TEXT,
    status VARCHAR(30) NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_box_requests_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT ck_box_requests_status
        CHECK (status IN ('REQUESTED', 'SHIPPED', 'DELIVERED', 'LOST', 'CANCELLED'))
);

CREATE INDEX idx_box_requests_order ON box_requests (order_id);

-- Se permite más de una box_request por orden para cubrir pérdidas,
-- fallos de entrega u otras incidencias que requieran reenvío.

-- [NUEVO] Destino final del equipo (kata: reciclar con destrucción segura o vender).
-- Para el Sprint 4 (HU-025); se puede crear ahora sin costo.
CREATE TABLE dispositions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL,
    type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reference VARCHAR(255), -- certificado de destrucción o referencia de publicación
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_dispositions_order
        FOREIGN KEY (order_id) REFERENCES orders(id),
    CONSTRAINT uq_dispositions_order UNIQUE (order_id),
    CONSTRAINT ck_dispositions_type
        CHECK (type IN ('RESALE', 'RECYCLE')),
    CONSTRAINT ck_dispositions_status
        CHECK (status IN ('PENDING', 'COMPLETED'))
);


-- ============================================================
-- INSPECTION DB
-- ============================================================
-- [CAMBIO] Base propia (como define el documento base).
-- Se quitó la FK a orders: order_id es referencia lógica al Orders DB.
-- Una orden puede registrar inspecciones/reinspecciones; la regla usada
-- queda identificada mediante evaluation_rule_id.

CREATE TABLE inspections (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL, -- ID externo del Orders DB
    device_type_id UUID NOT NULL, -- ID externo del Catalog DB
    evaluation_rule_id UUID NOT NULL, -- ID externo del Catalog DB
    -- [CAMBIO] Mismo vocabulario que dispositions.type.
    result VARCHAR(30) NOT NULL,
    actual_condition VARCHAR(50),
    observations TEXT,
    inspected_by_user UUID, -- ID externo del Auth DB
    inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_inspections_result
        CHECK (result IN ('RESALE', 'RECYCLE'))
);

CREATE INDEX idx_inspections_order ON inspections (tenant_id, order_id);

CREATE TABLE inspection_items (
    id UUID PRIMARY KEY,
    inspection_id UUID NOT NULL,
    criterion_key VARCHAR(100) NOT NULL,
    criterion_label VARCHAR(255) NOT NULL,
    result VARCHAR(30) NOT NULL,
    observation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_inspection_items_inspection
        FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
    CONSTRAINT ck_inspection_items_result
        CHECK (result IN ('PASS', 'FAIL', 'NOT_APPLICABLE'))
);

CREATE INDEX idx_inspection_items_inspection
    ON inspection_items (inspection_id);


-- ============================================================
-- PAYMENT DB
-- ============================================================
-- [CAMBIO] Base propia (como define el documento base).
-- Se quitó la FK a orders: order_id es referencia lógica al Orders DB.
-- Una orden puede tener varios intentos de pago. Los FAILED se conservan
-- para auditoría y pueden reintentarse. La BD impide más de un COMPLETED
-- por orden. La transición/reintento es responsabilidad del servicio.

CREATE TABLE payments (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL, -- ID externo del Orders DB
    -- [NUEVO] Evita pagos duplicados ante reintentos de la misma operación.
    idempotency_key VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    method VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    reference VARCHAR(150),
    failure_reason TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_payments_tenant_idempotency
        UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT ck_payments_amount
        CHECK (amount > 0),
    CONSTRAINT ck_payments_method
        CHECK (method IN ('BANK_TRANSFER', 'CHECK')),
    CONSTRAINT ck_payments_status
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'))
);

CREATE INDEX idx_payments_order ON payments (order_id);
CREATE INDEX idx_payments_status ON payments (tenant_id, status);

-- Un pago COMPLETED por orden como máximo.
-- Los pagos FAILED pueden coexistir para permitir reintentos.
CREATE UNIQUE INDEX uq_payments_one_completed_per_order
    ON payments (order_id)
    WHERE status = 'COMPLETED';