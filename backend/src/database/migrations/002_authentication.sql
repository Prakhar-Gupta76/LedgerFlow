DO $$ BEGIN
  CREATE TYPE auth_event_type AS ENUM (
    'LOGIN_SUCCEEDED',
    'LOGIN_FAILED',
    'LOGIN_BLOCKED',
    'LOGOUT_SUCCEEDED',
    'PASSWORD_RESET_REQUESTED',
    'PASSWORD_RESET_COMPLETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auth_failure_reason AS ENUM (
    'INVALID_CREDENTIALS',
    'TEMPORARILY_LOCKED',
    'ACCOUNT_SUSPENDED',
    'ACCOUNT_CLOSED',
    'RESET_TOKEN_EXPIRED',
    'RESET_TOKEN_ALREADY_USED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  refresh_token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason VARCHAR(50),
  ip_address INET,
  user_agent TEXT,
  CONSTRAINT auth_sessions_expiry_valid CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_active_idx
  ON auth_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  requested_ip INET,
  user_agent TEXT,
  CONSTRAINT password_reset_tokens_expiry_valid CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON password_reset_tokens (expires_at);

CREATE TABLE IF NOT EXISTS authentication_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  identifier_hash CHAR(64),
  event_type auth_event_type NOT NULL,
  failure_reason auth_failure_reason,
  ip_address INET,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS authentication_events_user_idx
  ON authentication_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS authentication_events_identifier_idx
  ON authentication_events (identifier_hash, occurred_at DESC);
CREATE INDEX IF NOT EXISTS authentication_events_ip_idx
  ON authentication_events (ip_address, occurred_at DESC);
CREATE INDEX IF NOT EXISTS authentication_events_type_idx
  ON authentication_events (event_type, occurred_at DESC);
