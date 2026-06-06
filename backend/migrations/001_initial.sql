CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id text PRIMARY KEY,
  status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  profiles jsonb NOT NULL DEFAULT '{}'::jsonb,
  pitch_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing jsonb NOT NULL DEFAULT '{}'::jsonb,
  retention jsonb NOT NULL DEFAULT '{}'::jsonb,
  tempo jsonb,
  audio jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  asset_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  type text NOT NULL,
  path text NOT NULL,
  original_filename text,
  duration_sec double precision,
  sample_rate integer,
  channels integer,
  sha256 text,
  mime_type text,
  size_bytes bigint,
  produced_by_stage text NOT NULL,
  produced_by_substep text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS arrangements (
  arrangement_id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE REFERENCES jobs(job_id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  approved boolean NOT NULL DEFAULT false,
  document jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS export_selections (
  job_id text PRIMARY KEY REFERENCES jobs(job_id) ON DELETE CASCADE,
  selection jsonb NOT NULL DEFAULT '{}'::jsonb,
  project_export jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
