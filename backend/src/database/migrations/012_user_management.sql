DO $$ BEGIN
  CREATE TYPE user_status_reason AS ENUM (
    'SUSPICIOUS_ACTIVITY',
    'POLICY_VIOLATION',
    'SECURITY_REVIEW',
    'CUSTOMER_REQUEST',
    'ACCOUNT_CLOSURE',
    'REACTIVATED_AFTER_REVIEW',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_status_history (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_status user_status NOT NULL,
  new_status user_status NOT NULL,
  reason_code user_status_reason NOT NULL,
  reason VARCHAR(500) NOT NULL CHECK (length(trim(reason)) > 0),
  changed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_status_history_transition CHECK (
    previous_status <> new_status
  )
);

CREATE INDEX IF NOT EXISTS user_status_history_user_idx
  ON user_status_history (user_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS user_status_history_admin_idx
  ON user_status_history (changed_by_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS user_status_history_state_idx
  ON user_status_history (new_status, occurred_at DESC);
