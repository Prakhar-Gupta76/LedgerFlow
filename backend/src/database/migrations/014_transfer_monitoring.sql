DO $$ BEGIN
  CREATE TYPE transfer_transition_source AS ENUM (
    'CUSTOMER_REQUEST',
    'TRANSFER_PROCESSOR',
    'REVERSAL_WORKFLOW',
    'SYSTEM_RECOVERY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS transfer_status_history (
  id UUID PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES transfers(id) ON DELETE RESTRICT,
  previous_status transfer_status,
  new_status transfer_status NOT NULL,
  transition_source transfer_transition_source NOT NULL,
  reason_code VARCHAR(100),
  actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  source_job_id UUID REFERENCES background_jobs(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfer_status_history_changed CHECK (
    previous_status IS NULL OR previous_status <> new_status
  ),
  CONSTRAINT transfer_status_history_allowed_transition CHECK (
    (previous_status IS NULL AND new_status = 'PENDING')
    OR (previous_status = 'PENDING' AND new_status IN ('COMPLETED', 'FAILED'))
    OR (previous_status = 'COMPLETED' AND new_status = 'REVERSED')
  )
);

CREATE INDEX IF NOT EXISTS transfer_status_history_transfer_idx
  ON transfer_status_history (transfer_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS transfer_status_history_state_idx
  ON transfer_status_history (new_status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS transfer_status_history_job_idx
  ON transfer_status_history (source_job_id)
  WHERE source_job_id IS NOT NULL;

INSERT INTO transfer_status_history (
  id, transfer_id, previous_status, new_status, transition_source,
  actor_user_id, occurred_at
)
SELECT
  gen_random_uuid(), id, NULL, 'PENDING', 'CUSTOMER_REQUEST',
  initiated_by_user_id, initiated_at
FROM transfers
WHERE NOT EXISTS (
  SELECT 1 FROM transfer_status_history history
  WHERE history.transfer_id = transfers.id
    AND history.previous_status IS NULL
);

INSERT INTO transfer_status_history (
  id, transfer_id, previous_status, new_status, transition_source,
  reason_code, occurred_at
)
SELECT
  gen_random_uuid(), id, 'PENDING', 'COMPLETED', 'TRANSFER_PROCESSOR',
  NULL, completed_at
FROM transfers
WHERE status = 'REVERSED'
  AND NOT EXISTS (
    SELECT 1 FROM transfer_status_history history
    WHERE history.transfer_id = transfers.id
      AND history.new_status = 'COMPLETED'
  );

INSERT INTO transfer_status_history (
  id, transfer_id, previous_status, new_status, transition_source,
  reason_code, occurred_at
)
SELECT
  gen_random_uuid(), id,
  CASE WHEN status = 'REVERSED' THEN 'COMPLETED'::transfer_status
       ELSE 'PENDING'::transfer_status END,
  status,
  CASE WHEN status = 'REVERSED'
       THEN 'REVERSAL_WORKFLOW'::transfer_transition_source
       ELSE 'TRANSFER_PROCESSOR'::transfer_transition_source END,
  failure_code,
  COALESCE(reversed_at, failed_at, completed_at, updated_at)
FROM transfers
WHERE status <> 'PENDING'
  AND NOT EXISTS (
    SELECT 1 FROM transfer_status_history history
    WHERE history.transfer_id = transfers.id
      AND history.new_status = transfers.status
  );

CREATE INDEX IF NOT EXISTS transfers_failure_created_idx
  ON transfers (failure_code, created_at DESC)
  WHERE failure_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS transfers_currency_created_idx
  ON transfers (currency, created_at DESC, id DESC);
