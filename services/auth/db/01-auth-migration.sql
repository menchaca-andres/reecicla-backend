-- =====================================================
-- Migración 001: Tabla de roles y usuarios
-- Servicio: auth-service
-- Base de datos: reecicla_auth_db
-- PostgreSQL 18
-- =====================================================

-- Habilitar extensión para UUIDs genéricos
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabla de roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insertar roles por defecto del sistema
INSERT INTO roles (name, description) VALUES
('CLIENT', 'Cliente general de la plataforma'),
('ADMIN', 'Administrador del tenant'),
('INSPECTOR', 'Inspector técnico de equipos')
ON CONFLICT (name) DO NOTHING;

-- Tabla de usuarios
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    phone VARCHAR(50),
    role_id UUID REFERENCES roles(id),
    role VARCHAR(50) DEFAULT 'CLIENT', -- mantiene compatibilidad histórica
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para mejorar rendimiento
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_tenant_email ON users(tenant_id, email);

-- Constraint de email único por tenant
CREATE UNIQUE INDEX idx_users_unique_email_per_tenant 
ON users(tenant_id, LOWER(email));

-- Comentarios de documentación
COMMENT ON TABLE roles IS 'Roles disponibles en la plataforma Reecicla';
COMMENT ON TABLE users IS 'Usuarios registrados en la plataforma Reecicla';
COMMENT ON COLUMN users.tenant_id IS 'Identificador del tenant/empresa a la que pertenece el usuario';
COMMENT ON COLUMN users.email IS 'Email único por tenant, usado para login';
COMMENT ON COLUMN users.password_hash IS 'Hash de la contraseña (bcrypt)';
COMMENT ON COLUMN users.role_id IS 'Referencia FK a la tabla roles';

-- Tabla de tokens de sesión
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
