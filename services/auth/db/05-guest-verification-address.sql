ALTER TABLE guest_email_verifications
    ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
