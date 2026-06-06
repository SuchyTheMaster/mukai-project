ALTER TABLE IF EXISTS jobs
  ADD COLUMN IF NOT EXISTS transcription_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
