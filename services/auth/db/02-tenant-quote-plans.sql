CREATE TABLE IF NOT EXISTS tenant_plans (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    plan_code VARCHAR(20) NOT NULL DEFAULT 'FREE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_tenant_plans_code CHECK (plan_code IN ('FREE', 'PREMIUM'))
);

INSERT INTO tenant_plans (tenant_id, plan_code)
SELECT id, 'FREE' FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS quote_usage_counters (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    quote_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_quote_usage_counters PRIMARY KEY (tenant_id, period_start),
    CONSTRAINT ck_quote_usage_count_nonnegative CHECK (quote_count >= 0)
);

CREATE TABLE IF NOT EXISTS quote_usage_reservations (
    reservation_id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    period_start DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_quote_usage_reservations_counter
        FOREIGN KEY (tenant_id, period_start)
        REFERENCES quote_usage_counters (tenant_id, period_start) ON DELETE CASCADE,
    CONSTRAINT ck_quote_usage_reservations_status
        CHECK (status IN ('RESERVED', 'COMMITTED', 'RELEASED'))
);

CREATE INDEX IF NOT EXISTS idx_quote_usage_reservations_tenant
    ON quote_usage_reservations (tenant_id, period_start);

CREATE OR REPLACE FUNCTION update_tenant_plan_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_plans_updated_at ON tenant_plans;
CREATE TRIGGER trg_tenant_plans_updated_at
    BEFORE UPDATE ON tenant_plans
    FOR EACH ROW EXECUTE FUNCTION update_tenant_plan_updated_at();

CREATE OR REPLACE FUNCTION assign_free_plan_to_tenant()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO tenant_plans (tenant_id, plan_code) VALUES (NEW.id, 'FREE')
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_assign_free_plan ON tenants;
CREATE TRIGGER trg_tenants_assign_free_plan
    AFTER INSERT ON tenants
    FOR EACH ROW EXECUTE FUNCTION assign_free_plan_to_tenant();