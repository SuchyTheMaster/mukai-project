ALTER TABLE IF EXISTS jobs
  ADD COLUMN IF NOT EXISTS syllabification_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
