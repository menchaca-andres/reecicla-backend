-- 08-seed-inspector.sql
-- Seed para Inspector y Admin de Tenant para desarrollo y pruebas

INSERT INTO users (id, tenant_id, email, password_hash, name, role, is_active)
VALUES 
    (
        '10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'inspector@reecicla.com',
        crypt('inspector123', gen_salt('bf', 10)),
        'Carlos Inspector',
        'INSPECTOR',
        true
    ),
    (
        '10000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        'admin@reecicla.com',
        crypt('admin123', gen_salt('bf', 10)),
        'Admin Demo',
        'TENANT_ADMIN',
        true
    )
ON CONFLICT DO NOTHING;

