ALTER TABLE quote_usage_reservations
    DROP CONSTRAINT IF EXISTS fk_quote_usage_reservations_counter;

ALTER TABLE quote_usage_reservations
    ADD CONSTRAINT fk_quote_usage_reservations_counter
    FOREIGN KEY (tenant_id, period_start)
    REFERENCES quote_usage_counters (tenant_id, period_start) ON DELETE CASCADE;