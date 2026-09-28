-- =====================================================
-- Migración 001: Tabla de usuarios
-- Servicio: auth-service
-- Base de datos: reecicla_auth_db
-- PostgreSQL 18
-- =====================================================

-- Habilitar extensión para UUIDs genéricos
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabla de usuarios
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);

-- Constraint de email único por tenant (un email no puede estar registrado dos veces en el mismo tenant)
CREATE UNIQUE INDEX idx_users_unique_email_per_tenant 
ON users(tenant_id, LOWER(email));

-- Comentario de documentación
COMMENT ON TABLE users IS 'Usuarios registrados en la plataforma Reecicla';
COMMENT ON COLUMN users.tenant_id IS 'Identificador del tenant/empresa a la que pertenece el usuario';
COMMENT ON COLUMN users.email IS 'Email único por tenant, usado para login';
COMMENT ON COLUMN users.password_hash IS 'Hash de la contraseña (bcrypt o similar)';

-- Tabla de tokens de sesión (opcional, para logout y gestión de sesiones)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Datos de prueba (OPCIONAL, solo para desarrollo)
-- INSERT INTO users (tenant_id, email, password_hash, name) VALUES
-- ('00000000-0000-0000-0000-000000000001', 'test@example.com', '$2b$10$...', 'Usuario Test');

-- =====================================================
-- Verificación
-- =====================================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';
