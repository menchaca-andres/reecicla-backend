ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_one_adjustment_per_parent
    ON quotes (tenant_id, parent_quote_id)
    WHERE quote_type = 'ADJUSTED';

CREATE TABLE IF NOT EXISTS quote_adjustment_audits (
    event_id          UUID         PRIMARY KEY,
    tenant_id         UUID         NOT NULL,
    order_id          UUID         NOT NULL,
    original_quote_id UUID         NOT NULL REFERENCES quotes(id),
    adjusted_quote_id UUID REFERENCES quotes(id),
    declared_condition VARCHAR(50) NOT NULL,
    actual_condition   VARCHAR(50) NOT NULL,
    inspection_result  VARCHAR(20) NOT NULL,
    original_price     NUMERIC(12,2) NOT NULL,
    adjusted_price     NUMERIC(12,2) NOT NULL,
    outcome            VARCHAR(20) NOT NULL,
    justification      TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_quote_adjustment_audits_order UNIQUE (tenant_id, order_id),
    CONSTRAINT ck_quote_adjustment_audit_result
        CHECK (inspection_result IN ('RESALE', 'RECYCLE')),
    CONSTRAINT ck_quote_adjustment_audit_outcome
        CHECK (outcome IN ('ADJUSTED', 'UNCHANGED')),
    CONSTRAINT ck_quote_adjustment_audit_prices
        CHECK (original_price >= 0 AND adjusted_price >= 0),
    CONSTRAINT ck_quote_adjustment_audit_justification
        CHECK (length(btrim(justification)) > 0)
);

ALTER TABLE quotes
    ADD CONSTRAINT ck_adjusted_quote_justification
    CHECK (
        quote_type <> 'ADJUSTED'
        OR (adjustment_reason IS NOT NULL AND length(btrim(adjustment_reason)) > 0)
    ) NOT VALID;
