-- Índice para el job que marca EXPIRED cotizaciones ANONYMOUS y PENDING vencidas.
CREATE INDEX IF NOT EXISTS idx_quotes_open_valid_until
    ON quotes (valid_until)
    WHERE status IN ('PENDING', 'ANONYMOUS');
