CREATE TABLE IF NOT EXISTS configuration_presets (
  preset_id text PRIMARY KEY CHECK (preset_id <> 'default' AND preset_id ~ '^[a-z][a-z0-9_-]{0,63}$'),
  name text NOT NULL,
  preset_type text NOT NULL CHECK (preset_type IN ('predefined', 'custom')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS configuration_presets_type_name_unique
  ON configuration_presets (preset_type, lower(btrim(name)));

ALTER TABLE IF EXISTS jobs
  ADD COLUMN IF NOT EXISTS configuration_preset_name text NOT NULL DEFAULT 'Domyślna',
  ADD COLUMN IF NOT EXISTS configuration_preset_type text NOT NULL DEFAULT 'predefined',
  ADD COLUMN IF NOT EXISTS configuration_fallback_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE jobs
SET configuration_preset_name = configuration_preset
WHERE configuration_preset <> 'default'
  AND configuration_preset_name = 'Domyślna';
