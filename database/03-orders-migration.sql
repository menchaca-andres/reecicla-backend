-- =====================================================
-- Migración 003: Órdenes de reciclaje
-- Servicio: orders-service
-- Base de datos: reecicla_orders_db
-- PostgreSQL 18
-- =====================================================
-- Propiedad de datos: orders-service.
-- No crear foreign keys hacia auth, quotation o catalog:
-- esas entidades viven en otras bases de datos.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_number VARCHAR(30) NOT NULL,
    user_id UUID NOT NULL,
    quote_id UUID NOT NULL,
    device_type_id UUID,
    device_type_name VARCHAR(100) NOT NULL,
    quoted_price NUMERIC(12,2) NOT NULL CHECK (quoted_price >= 0),
    final_price NUMERIC(12,2),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(40) NOT NULL DEFAULT 'ORDER_CREATED',
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    pickup_address JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    CONSTRAINT chk_orders_status CHECK (
        status IN (
            'ORDER_CREATED',
            'BOX_REQUESTED',
            'BOX_SHIPPED',
            'IN_TRANSIT',
            'RECEIVED',
            'UNDER_INSPECTION',
            'PRICE_ADJUSTED',
            'PRICE_ACCEPTED',
            'PRICE_REJECTED',
            'PAYMENT_PENDING',
            'PAID',
            'CANCELLED'
        )
    ),
    CONSTRAINT uq_orders_tenant_number UNIQUE (tenant_id, order_number)
);

COMMENT ON TABLE orders IS 'Órdenes de reciclaje; propiedad exclusiva del orders-service.';
COMMENT ON COLUMN orders.user_id IS 'ID del usuario en auth-service. Sin FK porque pertenece a otra base de datos.';
COMMENT ON COLUMN orders.quote_id IS 'ID de cotización en quotation-service. Sin FK porque pertenece a otra base de datos.';
COMMENT ON COLUMN orders.device_type_id IS 'ID del dispositivo en catalog-service. Sin FK porque pertenece a otra base de datos.';
COMMENT ON COLUMN orders.device_type_name IS 'Snapshot del nombre para conservar historial si el catálogo cambia.';
COMMENT ON COLUMN orders.pickup_address IS 'Dirección de envío/recojo como JSONB; se puede normalizar en una evolución posterior.';

CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX idx_orders_user ON orders(tenant_id, user_id);
CREATE INDEX idx_orders_quote ON orders(tenant_id, quote_id);
CREATE INDEX idx_orders_created_at ON orders(tenant_id, created_at DESC);

-- Solicitud de caja asociada a una orden.
CREATE TABLE box_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tracking_code VARCHAR(100),
    label_url TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_box_requests_status CHECK (status IN ('PENDING', 'SHIPPED', 'DELIVERED', 'LOST', 'CANCELLED')),
    CONSTRAINT uq_box_requests_order UNIQUE (order_id),
    CONSTRAINT uq_box_requests_tenant_tracking UNIQUE (tenant_id, tracking_code)
);

COMMENT ON TABLE box_requests IS 'Solicitudes de caja y tracking simulado para el envío del equipo.';

CREATE INDEX idx_box_requests_tenant ON box_requests(tenant_id);
CREATE INDEX idx_box_requests_status ON box_requests(tenant_id, status);

-- Historial de estados para auditoría y notificaciones.
CREATE TABLE order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    previous_status VARCHAR(40),
    new_status VARCHAR(40) NOT NULL,
    changed_by_user_id UUID,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE order_status_history IS 'Historial auditable de cambios de estado de una orden.';

CREATE INDEX idx_order_status_history_order ON order_status_history(order_id, created_at DESC);
CREATE INDEX idx_order_status_history_tenant ON order_status_history(tenant_id);

-- Función y triggers de updated_at.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_box_requests_updated_at
BEFORE UPDATE ON box_requests
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Registra el cambio de estado automáticamente.
CREATE OR REPLACE FUNCTION record_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO order_status_history (
            tenant_id, order_id, previous_status, new_status
        ) VALUES (
            NEW.tenant_id, NEW.id, OLD.status, NEW.status
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_status_history
AFTER UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION record_order_status_change();

-- Ejemplo opcional de orden de desarrollo:
-- INSERT INTO orders (
--   tenant_id, order_number, user_id, quote_id, device_type_name, quoted_price
-- ) VALUES (
--   '00000000-0000-0000-0000-000000000001',
--   'REC-000001',
--   '00000000-0000-0000-0000-000000000010',
--   '00000000-0000-0000-0000-000000000020',
--   'Refrigerador', 150.00
-- );
