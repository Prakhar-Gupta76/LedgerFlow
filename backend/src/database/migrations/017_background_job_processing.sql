DO $$ BEGIN CREATE TYPE background_job_attempt_outcome AS ENUM ('SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE background_job_retry_status AS ENUM ('REQUESTED','VALIDATED','EXECUTING','SUCCEEDED','FAILED','REJECTED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS background_job_attempts (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES background_jobs(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  worker_id VARCHAR(100) NOT NULL CHECK (length(trim(worker_id)) > 0),
  outcome background_job_attempt_outcome NOT NULL,
  error_code VARCHAR(100), error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT background_job_attempt_number_unique UNIQUE(job_id,attempt_number)
);

CREATE TABLE IF NOT EXISTS background_job_retry_requests (
  id UUID PRIMARY KEY, idempotency_key UUID NOT NULL UNIQUE,
  job_id UUID NOT NULL REFERENCES background_jobs(id) ON DELETE RESTRICT,
  reason_code VARCHAR(100) NOT NULL CHECK(length(trim(reason_code)) > 0),
  reason VARCHAR(500) NOT NULL CHECK(length(trim(reason)) > 0),
  status background_job_retry_status NOT NULL DEFAULT 'REQUESTED',
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), validated_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  result_attempt_id UUID REFERENCES background_job_attempts(id) ON DELETE RESTRICT,
  failure_code VARCHAR(100), failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS background_job_attempts_outcome_created_idx ON background_job_attempts(outcome,created_at DESC);
CREATE INDEX IF NOT EXISTS background_job_retry_status_created_idx ON background_job_retry_requests(status,created_at DESC);
CREATE INDEX IF NOT EXISTS background_job_retry_job_created_idx ON background_job_retry_requests(job_id,created_at DESC);

INSERT INTO background_job_attempts (
  id, job_id, attempt_number, worker_id, outcome,
  error_code, error_message, started_at, completed_at
)
SELECT gen_random_uuid(), id, attempt_count,
  COALESCE(locked_by, 'historical-worker'),
  CASE
    WHEN status = 'COMPLETED' THEN 'SUCCEEDED'::background_job_attempt_outcome
    WHEN attempt_count >= max_attempts THEN 'FAILED_PERMANENT'::background_job_attempt_outcome
    ELSE 'FAILED_RETRYABLE'::background_job_attempt_outcome
  END,
  last_error_code, last_error_message,
  COALESCE(last_attempt_at, created_at), COALESCE(completed_at, updated_at)
FROM background_jobs
WHERE attempt_count > 0 AND status IN ('COMPLETED', 'FAILED')
ON CONFLICT (job_id, attempt_number) DO NOTHING;
