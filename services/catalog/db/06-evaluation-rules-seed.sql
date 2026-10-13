-- ============================================================
-- CATALOG DB — Migración / Seed 06
-- Servicio: catalog-service
-- Base de datos: reecicla_catalog_db
-- HU-008: Reglas de evaluación (checklist) iniciales por tipo de dispositivo
-- ============================================================

INSERT INTO evaluation_rules (tenant_id, device_type_id, version, checklist, resale_criteria, recycle_criteria, is_active)
SELECT 
    dt.tenant_id,
    dt.id,
    1,
    CASE dt.code
        WHEN 'SMARTPHONE' THEN '[
            {"id": "power_on", "label": "¿El dispositivo enciende?", "type": "boolean", "required": true},
            {"id": "screen_intact", "label": "¿Pantalla sin fisuras o roturas?", "type": "boolean", "required": true},
            {"id": "touch_working", "label": "¿El táctil funciona correctamente?", "type": "boolean", "required": true},
            {"id": "battery_health", "label": "Estado de la batería (1-10)", "type": "number", "required": true},
            {"id": "cosmetic_condition", "label": "Estado estético general (1-10)", "type": "number", "required": true}
        ]'::jsonb
        WHEN 'LAPTOP' THEN '[
            {"id": "power_on", "label": "¿La laptop enciende y da video?", "type": "boolean", "required": true},
            {"id": "keyboard_working", "label": "¿Teclado y touchpad funcionan?", "type": "boolean", "required": true},
            {"id": "screen_ok", "label": "¿Pantalla sin líneas ni manchas?", "type": "boolean", "required": true},
            {"id": "charger_included", "label": "¿Incluye cargador original?", "type": "boolean", "required": false},
            {"id": "cosmetic_condition", "label": "Estado estético de carcasa (1-10)", "type": "number", "required": true}
        ]'::jsonb
        WHEN 'TV' THEN '[
            {"id": "power_on", "label": "¿El televisor enciende?", "type": "boolean", "required": true},
            {"id": "panel_intact", "label": "¿Panel/Display intacto sin golpes?", "type": "boolean", "required": true},
            {"id": "ports_working", "label": "¿Puertos HDMI/USB en buen estado?", "type": "boolean", "required": true},
            {"id": "remote_included", "label": "¿Incluye control remoto?", "type": "boolean", "required": false},
            {"id": "cosmetic_condition", "label": "Estado estético general (1-10)", "type": "number", "required": true}
        ]'::jsonb
        WHEN 'REFRIGERATOR' THEN '[
            {"id": "cooling_works", "label": "¿El sistema de enfriamiento funciona?", "type": "boolean", "required": true},
            {"id": "compressor_status", "label": "¿Compresor sin ruidos anómalos?", "type": "boolean", "required": true},
            {"id": "gaskets_ok", "label": "¿Empaques/gomas de puerta sellan bien?", "type": "boolean", "required": true},
            {"id": "cosmetic_condition", "label": "Estado estético exterior (1-10)", "type": "number", "required": true}
        ]'::jsonb
        WHEN 'WASHING_MACHINE' THEN '[
            {"id": "spin_cycle", "label": "¿Realiza ciclo de lavado y centrifugado?", "type": "boolean", "required": true},
            {"id": "no_leaks", "label": "¿Sin fugas de agua?", "type": "boolean", "required": true},
            {"id": "motor_sound", "label": "¿Motor sin ruidos extraños?", "type": "boolean", "required": true},
            {"id": "cosmetic_condition", "label": "Estado estético exterior (1-10)", "type": "number", "required": true}
        ]'::jsonb
        WHEN 'MICROWAVE' THEN '[
            {"id": "heating_works", "label": "¿Calienta adecuadamente agua/alimentos?", "type": "boolean", "required": true},
            {"id": "door_latch", "label": "¿Cierre y seguro de puerta en buen estado?", "type": "boolean", "required": true},
            {"id": "plate_rotates", "label": "¿Plato giratorio funciona?", "type": "boolean", "required": true},
            {"id": "cosmetic_condition", "label": "Estado estético general (1-10)", "type": "number", "required": true}
        ]'::jsonb
        ELSE '[
            {"id": "power_on", "label": "¿El equipo enciende?", "type": "boolean", "required": true},
            {"id": "cosmetic_condition", "label": "Estado estético (1-10)", "type": "number", "required": true}
        ]'::jsonb
    END,
    '{"min_cosmetic_score": 6, "must_power_on": true}'::jsonb,
    '{"accept_damaged": true, "recycle_components": true}'::jsonb,
    true
FROM device_types dt
WHERE dt.tenant_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (device_type_id) WHERE is_active DO NOTHING;
