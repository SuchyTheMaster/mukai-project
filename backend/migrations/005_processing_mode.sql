ALTER TABLE IF EXISTS jobs
  ADD COLUMN IF NOT EXISTS processing_mode text NOT NULL DEFAULT 'manual';

UPDATE jobs
SET processing_mode = CASE
      WHEN configuration_preset = 'manual' THEN 'manual'
      ELSE 'automatic'
    END,
    configuration_preset = CASE
      WHEN configuration_preset = 'manual' THEN 'default'
      ELSE configuration_preset
    END;

ALTER TABLE IF EXISTS jobs
  ALTER COLUMN configuration_preset SET DEFAULT 'default';
