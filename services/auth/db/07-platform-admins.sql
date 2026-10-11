BEGIN;

CREATE TABLE IF NOT EXISTS platform_admins (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_admins_email_lower
    ON platform_admins (lower(email));

INSERT INTO platform_admins (id, email, password_hash, name, is_active, created_at, updated_at)
SELECT
    id,
    lower(email),
    CASE
        WHEN left(password_hash, 4) IN ('$2a$', '$2b$', '$2y$') THEN password_hash
        ELSE crypt(password_hash, gen_salt('bf', 10))
    END,
    name,
    is_active,
    created_at,
    updated_at
FROM users
WHERE role = 'SUPER_ADMIN'
ON CONFLICT (id) DO NOTHING;

DELETE FROM users WHERE role = 'SUPER_ADMIN';

ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_role;
ALTER TABLE users ADD CONSTRAINT ck_users_role
    CHECK (role IN ('CLIENT', 'INSPECTOR', 'CATALOG_ADMIN', 'TENANT_ADMIN'));

COMMIT;
