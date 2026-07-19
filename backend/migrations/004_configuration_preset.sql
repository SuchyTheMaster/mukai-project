ALTER TABLE IF EXISTS jobs
  ADD COLUMN IF NOT EXISTS configuration_preset text NOT NULL DEFAULT 'manual';
