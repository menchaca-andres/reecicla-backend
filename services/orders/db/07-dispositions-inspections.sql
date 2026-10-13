-- 07-dispositions-inspections.sql
-- HU-016: Determinar destino del equipo (reventa o reciclaje)

-- 1. Actualizar check constraint de orders para permitir nuevos estados de inventario
ALTER TABLE orders DROP CONSTRAINT IF EXISTS ck_orders_status;
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN (
    'ACCEPTED',
    'BOX_REQUESTED',
    'BOX_SHIPPED',
    'IN_TRANSIT',
    'RECEIVED',
    'INSPECTING',
    'INSPECTED',
    'READY_FOR_RESALE',
    'IN_RECYCLING',
    'ADJUSTMENT_PENDING',
    'ADJUSTMENT_REJECTED',
    'PAYMENT_PENDING',
    'PAID',
    'DISPOSED',
    'CLOSED',
    'CANCELLED'
));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(50);

-- 2. Actualizar tabla dispositions con justificación e inspector
ALTER TABLE dispositions ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE dispositions ADD COLUMN IF NOT EXISTS determined_by_user UUID;
ALTER TABLE dispositions ADD COLUMN IF NOT EXISTS determined_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE dispositions DROP CONSTRAINT IF EXISTS ck_dispositions_status;
ALTER TABLE dispositions ADD CONSTRAINT ck_dispositions_status CHECK (
    status IN ('PENDING', 'COMPLETED', 'READY_FOR_RESALE', 'IN_RECYCLING')
);

-- 3. Crear tablas de inspección y diagnóstico
CREATE TABLE IF NOT EXISTS inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL,
    device_type_id UUID,
    evaluation_rule_id UUID,
    result VARCHAR(30) DEFAULT 'PENDING',
    actual_condition VARCHAR(50),
    observations TEXT,
    diagnostic_summary JSONB DEFAULT '{}'::jsonb,
    inspected_by_user UUID,
    inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_inspections_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT uq_inspections_order UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS inspection_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS idx_inspections_order ON inspections (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_inspection_items_inspection ON inspection_items (inspection_id);

