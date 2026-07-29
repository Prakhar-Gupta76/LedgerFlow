DO $$ BEGIN
  CREATE TYPE transfer_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'TRANSFER_SENT',
    'TRANSFER_RECEIVED',
    'TRANSFER_FAILED',
    'WALLET_STATUS_CHANGED',
    'ACCOUNT_SECURITY',
    'SYSTEM_MESSAGE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS transfers (
  id UUID PRIMARY KEY,
  sender_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  receiver_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  status transfer_status NOT NULL,
  note VARCHAR(200),
  failure_code VARCHAR(50),
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfers_distinct_wallets CHECK (sender_wallet_id <> receiver_wallet_id),
  CONSTRAINT transfers_currency_uppercase CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS transfers_sender_created_idx
  ON transfers (sender_wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_receiver_created_idx
  ON transfers (receiver_wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_status_created_idx
  ON transfers (status, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_daily_summaries (
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  summary_date DATE NOT NULL,
  currency CHAR(3) NOT NULL,
  sent_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (sent_amount_minor >= 0),
  received_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (received_amount_minor >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  failed_transfer_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_transfer_count >= 0),
  last_job_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet_id, summary_date, currency),
  CONSTRAINT wallet_daily_summaries_currency_uppercase
    CHECK (currency = upper(currency))
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notification_type notification_type NOT NULL,
  severity notification_severity NOT NULL DEFAULT 'INFO',
  title VARCHAR(150) NOT NULL CHECK (length(trim(title)) > 0),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0),
  related_resource_type VARCHAR(40),
  related_resource_id UUID,
  source_job_id UUID REFERENCES background_jobs(id) ON DELETE RESTRICT,
  action_path VARCHAR(300),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_read_idx
  ON notifications (user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_severity_created_idx
  ON notifications (severity, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_job_idempotency_idx
  ON notifications (user_id, source_job_id, notification_type)
  WHERE source_job_id IS NOT NULL;
