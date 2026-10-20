-- ============================================================
-- CATALOG DB — Migración 07 (HU-023)
-- Servicio: catalog-service
-- Base de datos: reecicla_catalog_db
-- Propósito: Auditoría de mantenimiento de catálogo y desactivación por inactividad
-- ============================================================

CREATE TABLE IF NOT EXISTS catalog_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_type VARCHAR(60) NOT NULL DEFAULT 'device_types',
    entity_id UUID NOT NULL,
    entity_name VARCHAR(120) NOT NULL,
    entity_code VARCHAR(60),
    action VARCHAR(60) NOT NULL, -- 'DEACTIVATED_INACTIVITY', 'REACTIVATED', etc.
    last_received_at TIMESTAMPTZ,
    reason TEXT NOT NULL,
    executed_by VARCHAR(120) NOT NULL DEFAULT 'SYSTEM_JOB',
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_audit_logs_tenant
    ON catalog_audit_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_audit_logs_entity
    ON catalog_audit_logs (entity_type, entity_id);
