ALTER TYPE auth_event_type ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE auth_event_type ADD VALUE IF NOT EXISTS 'SESSION_REVOKED';
ALTER TYPE auth_event_type ADD VALUE IF NOT EXISTS 'ALL_OTHER_SESSIONS_REVOKED';

DO $$ BEGIN
  CREATE TYPE closure_request_status AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    'COMPLETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  wallet_funding_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transfer_sent_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transfer_received_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transfer_failed_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transfer_reversed_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_messages_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO notification_preferences (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_closure_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status closure_request_status NOT NULL DEFAULT 'PENDING',
  reason VARCHAR(500),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  resolution_note TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT account_closure_reason_nonempty CHECK (
    reason IS NULL OR length(trim(reason)) > 0
  ),
  CONSTRAINT account_closure_cancelled_state CHECK (
    status <> 'CANCELLED' OR cancelled_at IS NOT NULL
  ),
  CONSTRAINT account_closure_completed_state CHECK (
    status <> 'COMPLETED' OR completed_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS account_closure_active_user_idx
  ON account_closure_requests (user_id)
  WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX IF NOT EXISTS account_closure_user_requested_idx
  ON account_closure_requests (user_id, requested_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS account_closure_status_requested_idx
  ON account_closure_requests (status, requested_at);
