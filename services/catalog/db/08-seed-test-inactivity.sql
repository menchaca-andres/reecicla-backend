-- ============================================================
-- CATALOG DB — Seed para pruebas de HU-023
-- ============================================================

-- 1. REFRIGERATOR: Última recepción hace 14 meses, sin stock ni pedidos pendientes -> Elegible para desactivación
UPDATE device_types
SET last_received_at = NOW() - INTERVAL '14 months',
    status = 'ACTIVE',
    accepts_quotes = true,
    inactivated_at = NULL
WHERE code = 'REFRIGERATOR';

-- 2. WASHING_MACHINE: Última recepción hace 13 meses, sin stock ni pedidos pendientes -> Elegible para desactivación
UPDATE device_types
SET last_received_at = NOW() - INTERVAL '13 months',
    status = 'ACTIVE',
    accepts_quotes = true,
    inactivated_at = NULL
WHERE code = 'WASHING_MACHINE';

-- 3. MICROWAVE: Creado hace 15 meses sin ninguna recepción en 12+ meses, sin stock -> Elegible para desactivación
UPDATE device_types
SET created_at = NOW() - INTERVAL '15 months',
    last_received_at = NULL,
    status = 'ACTIVE',
    accepts_quotes = true,
    inactivated_at = NULL
WHERE code = 'MICROWAVE';

-- 4. LAPTOP: Última recepción hace 14 meses, PERO tiene orden ORD-00000001 en READY_FOR_RESALE (Stock físico) -> BLOQUEADO POR CA03
UPDATE device_types
SET last_received_at = NOW() - INTERVAL '14 months',
    status = 'ACTIVE',
    accepts_quotes = true,
    inactivated_at = NULL
WHERE code = 'LAPTOP';

-- 5. SMARTPHONE: Recepción reciente (hace 2 días) -> NO ELEGIBLE (Activo con recepciones recientes)
UPDATE device_types
SET last_received_at = NOW() - INTERVAL '2 days',
    status = 'ACTIVE',
    accepts_quotes = true,
    inactivated_at = NULL
WHERE code = 'SMARTPHONE';

-- 6. TV: Creado recientemente (hace 2 meses) sin recepciones -> NO ELEGIBLE (No ha transcurrido el periodo de 12 meses)
UPDATE device_types
SET created_at = NOW() - INTERVAL '2 months',
    last_received_at = NULL,
    status = 'ACTIVE',
    accepts_quotes = true,
    inactivated_at = NULL
WHERE code = 'TV';
