-- ============================================================
-- AUTH DB — Migración 01
-- Servicio: auth-service
-- Base de datos: reecicla_auth_db
-- Alineado con: script.sql definitivo (Reecicla v1.0)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Función reutilizable para updated_at ─────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Tenants ──────────────────────────────────────────────────
-- HU-001: el contexto del tenant necesita su propia tabla.
CREATE TABLE tenants (
    id   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenants_name   UNIQUE (name),
    CONSTRAINT ck_tenants_status CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Users ─────────────────────────────────────────────────────
-- Roles válidos según HU-001: CLIENT, INSPECTOR, CATALOG_ADMIN, TENANT_ADMIN.
-- SUPER_ADMIN vive fuera del modelo tenant; se siembra directamente en DB.
CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL DEFAULT '',
    phone         VARCHAR(50),
    role          VARCHAR(30)  NOT NULL DEFAULT 'CLIENT',
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_users_tenant
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT ck_users_role
        CHECK (role IN ('CLIENT', 'INSPECTOR', 'CATALOG_ADMIN', 'TENANT_ADMIN', 'SUPER_ADMIN'))
);

CREATE INDEX idx_users_tenant ON users (tenant_id);

-- Correo único por tenant, case-insensitive.
CREATE UNIQUE INDEX uq_users_tenant_email_lower
    ON users (tenant_id, lower(email));

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Sessions ──────────────────────────────────────────────────
CREATE TABLE sessions (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID         NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user       ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

-- ── Seed: tenant por defecto + SUPER_ADMIN ────────────────────
-- El tenant 00000000-0000-0000-0000-000000000001 se usa en desarrollo.
INSERT INTO tenants (id, name, status) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Reecicla Demo', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- Cuenta de transición de desarrollo. La migración 07 la mueve a platform_admins
-- y convierte el valor semilla a bcrypt si aún no es un hash.
INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES
    (
        '00000000-0000-0000-0000-000000000001',
        'superadmin@reecicla.com',
        'superadmin123',
        'Super Admin',
        'SUPER_ADMIN'
    )
ON CONFLICT DO NOTHING;

-- ── Processed Events (TE-02: idempotencia de mensajería) ─────
CREATE TABLE IF NOT EXISTS processed_events (
    event_id      UUID         PRIMARY KEY,
    event_type    VARCHAR(120) NOT NULL,
    tenant_id     UUID         NOT NULL,
    processed_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_tenant ON processed_events (tenant_id);
