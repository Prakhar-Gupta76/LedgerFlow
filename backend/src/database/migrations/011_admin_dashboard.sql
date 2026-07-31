DO $$ BEGIN
  CREATE TYPE audit_actor_type AS ENUM (
    'CUSTOMER', 'ADMIN', 'SYSTEM', 'SERVICE', 'ANONYMOUS'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_outcome AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE audit_source_type AS ENUM (
    'APPLICATION',
    'AUTHENTICATION',
    'ADMIN_API',
    'BACKGROUND_WORKER',
    'SCHEDULED_JOB',
    'DATABASE_CONTROL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS audit_records (
  id UUID PRIMARY KEY,
  deduplication_key VARCHAR(200) NOT NULL UNIQUE,
  actor_type audit_actor_type NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  actor_reference VARCHAR(150) NOT NULL CHECK (length(trim(actor_reference)) > 0),
  action_type VARCHAR(100) NOT NULL CHECK (length(trim(action_type)) > 0),
  resource_type VARCHAR(50) NOT NULL CHECK (length(trim(resource_type)) > 0),
  resource_id UUID,
  parent_resource_type VARCHAR(50),
  parent_resource_id UUID,
  outcome audit_outcome NOT NULL,
  severity audit_severity NOT NULL,
  reason_code VARCHAR(100),
  source_type audit_source_type NOT NULL,
  source_job_id UUID REFERENCES background_jobs(id) ON DELETE RESTRICT,
  correlation_id UUID,
  request_id VARCHAR(100),
  ip_address INET,
  user_agent VARCHAR(500),
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_parent_resource_pair_valid CHECK (
    (parent_resource_type IS NULL AND parent_resource_id IS NULL)
    OR
    (parent_resource_type IS NOT NULL AND parent_resource_id IS NOT NULL)
  ),
  CONSTRAINT audit_metadata_object CHECK (
    metadata IS NULL OR jsonb_typeof(metadata) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS audit_records_occurred_idx
  ON audit_records (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_records_actor_idx
  ON audit_records (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_records_action_idx
  ON audit_records (action_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_records_resource_idx
  ON audit_records (resource_type, resource_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_records_health_idx
  ON audit_records (outcome, severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_records_source_job_idx
  ON audit_records (source_job_id)
  WHERE source_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS background_jobs_type_created_idx
  ON background_jobs (job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS background_jobs_completed_idx
  ON background_jobs (completed_at DESC)
  WHERE completed_at IS NOT NULL;
