-- 08-seed-inspections.sql
INSERT INTO orders (
    id, tenant_id, order_number, user_id, quote_id, device_type_id,
    device_type_name, brand, model, device_year, declared_condition,
    quoted_price, final_price, currency, status, customer_name, customer_email,
    customer_phone, accepted_at, received_at
) VALUES 
    (
        '20000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        'ORD-00000001',
        '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001',
        'ce848641-7949-4671-afb3-409c0dc05bb3',
        'Laptop',
        'Apple',
        'MacBook Air M2',
        2023,
        'working',
        130.00,
        130.00,
        'BOB',
        'INSPECTED',
        'Maria Gomez',
        'maria@ejemplo.com',
        '70012345',
        now() - INTERVAL '3 days',
        now() - INTERVAL '1 day'
    ),
    (
        '20000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        'ORD-00000002',
        '10000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000002',
        'eb7d2b11-d328-403a-89d2-5582b5c31f26',
        'Smartphone',
        'Samsung',
        'Galaxy S23',
        2023,
        'damaged',
        80.00,
        40.00,
        'BOB',
        'INSPECTED',
        'Juan Perez',
        'juan@ejemplo.com',
        '70098765',
        now() - INTERVAL '4 days',
        now() - INTERVAL '2 days'
    )
ON CONFLICT (id) DO NOTHING;

-- Seed inspections para estas órdenes
INSERT INTO inspections (
    id, tenant_id, order_id, device_type_id, result, actual_condition,
    observations, diagnostic_summary, inspected_by_user, inspected_at
) VALUES 
    (
        '40000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        'ce848641-7949-4671-afb3-409c0dc05bb3',
        'PENDING',
        'working',
        'Equipo en óptimas condiciones generales. Todos los componentes principales pasaron el diagnóstico técnico.',
        '{"test_score": 9.5, "passed_tests": 4, "failed_tests": 0, "physical_state": "Excelente sin golpes ni fisuras"}'::jsonb,
        '10000000-0000-0000-0000-000000000001',
        now() - INTERVAL '1 day'
    ),
    (
        '40000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000002',
        'eb7d2b11-d328-403a-89d2-5582b5c31f26',
        'PENDING',
        'damaged',
        'Pantalla con roturas profundas y táctil no responsivo. Placa madre y batería en estado recuperable.',
        '{"test_score": 4.0, "passed_tests": 2, "failed_tests": 2, "physical_state": "Daño severo en pantalla y cristal posterior"}'::jsonb,
        '10000000-0000-0000-0000-000000000001',
        now() - INTERVAL '2 days'
    )
ON CONFLICT (order_id) DO NOTHING;

-- Seed inspection items (pruebas de diagnóstico individuales con componentes aptos y defectuosos)
INSERT INTO inspection_items (id, inspection_id, criterion_key, criterion_label, result, observation)
VALUES
    -- Pruebas de la Laptop ORD-00000001
    ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'power_on', 'Encendido y booteo', 'PASS', 'Enciende normalmente y carga el sistema operativo'),
    ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'screen_ok', 'Pantalla / Display Retina', 'PASS', 'Display impecable sin píxeles muertos ni líneas'),
    ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'keyboard_working', 'Teclado y Trackpad', 'PASS', 'Todas las teclas responden y el trackpad tiene click háptico fluido'),
    ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000001', 'battery_health', 'Salud de Batería', 'PASS', 'Batería con 94% de capacidad original y pocos ciclos'),

    -- Pruebas del Smartphone ORD-00000002
    ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000002', 'power_on', 'Encendido', 'PASS', 'Enciende y vibra al conectar cargador'),
    ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000002', 'screen_intact', 'Integridad de Pantalla', 'FAIL', 'Display quebrado con derrame de cristales AMOLED'),
    ('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000002', 'touch_working', 'Digitalizador Táctil', 'FAIL', 'El táctil no responde en la mitad inferior de la pantalla'),
    ('50000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000002', 'battery_health', 'Batería y Carga', 'PASS', 'Carga correctamente sin sobrecalentamiento')
ON CONFLICT (id) DO NOTHING;

