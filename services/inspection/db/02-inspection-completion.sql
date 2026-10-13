ALTER TABLE inspections
    ADD COLUMN IF NOT EXISTS result_justification TEXT,
    ADD COLUMN IF NOT EXISTS completed_by_user UUID,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_inspections_completed_result'
          AND conrelid = 'inspections'::regclass
    ) THEN
        ALTER TABLE inspections
            ADD CONSTRAINT ck_inspections_completed_result
            CHECK (
                status <> 'COMPLETED'
                OR (
                    result IS NOT NULL
                    AND result_justification IS NOT NULL
                    AND length(btrim(result_justification)) > 0
                    AND completed_by_user IS NOT NULL
                    AND completed_at IS NOT NULL
                )
            ) NOT VALID;
    END IF;
END $$;
