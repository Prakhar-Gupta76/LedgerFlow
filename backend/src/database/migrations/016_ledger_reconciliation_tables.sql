DO $$ BEGIN CREATE TYPE reconciliation_run_type AS ENUM ('GLOBAL_TRIAL_BALANCE','LEDGER_TRANSACTION_BALANCE','WALLET_BALANCE','TRANSFER_POSTING','FUNDING_POSTING'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reconciliation_run_status AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reconciliation_trigger_source AS ENUM ('SCHEDULED','ADMIN','SYSTEM'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reconciliation_finding_type AS ENUM ('UNBALANCED_LEDGER_TRANSACTION','WALLET_BALANCE_MISMATCH','MISSING_TRANSFER_POSTING','DUPLICATE_TRANSFER_POSTING','TRANSFER_PARTY_MISMATCH','TRANSFER_AMOUNT_MISMATCH','TRANSFER_CURRENCY_MISMATCH','UNEXPECTED_TRANSFER_POSTING','MISSING_FUNDING_POSTING','DUPLICATE_FUNDING_POSTING','GLOBAL_TRIAL_BALANCE_MISMATCH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reconciliation_severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE reconciliation_finding_status AS ENUM ('OPEN','UNDER_REVIEW','RESOLVED','ACCEPTED_EXCEPTION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ledger_adjustment_type AS ENUM ('FULL_REVERSAL','CORRECTIVE_POSTING','WALLET_BALANCE_CORRECTION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE ledger_adjustment_status AS ENUM ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED','CANCELLED','FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_wallet_requirement;
ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_wallet_requirement CHECK (
    (account_type = 'USER_WALLET' AND wallet_id IS NOT NULL)
    OR (account_type IN ('SYSTEM_FUNDING', 'SYSTEM_ADJUSTMENT') AND wallet_id IS NULL)
  );

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id UUID PRIMARY KEY,
  run_type reconciliation_run_type NOT NULL,
  scope_currency CHAR(3),
  scope_wallet_id UUID REFERENCES wallets(id) ON DELETE RESTRICT,
  status reconciliation_run_status NOT NULL DEFAULT 'PENDING',
  trigger_source reconciliation_trigger_source NOT NULL,
  initiated_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  as_of_time TIMESTAMPTZ NOT NULL,
  records_checked BIGINT NOT NULL DEFAULT 0 CHECK (records_checked >= 0),
  finding_count INTEGER NOT NULL DEFAULT 0 CHECK (finding_count >= 0),
  error_code VARCHAR(100), error_message TEXT,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_runs_scope_currency_upper CHECK (scope_currency IS NULL OR scope_currency = upper(scope_currency))
);

CREATE TABLE IF NOT EXISTS reconciliation_findings (
  id UUID PRIMARY KEY,
  reconciliation_run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE RESTRICT,
  finding_type reconciliation_finding_type NOT NULL,
  severity reconciliation_severity NOT NULL,
  status reconciliation_finding_status NOT NULL DEFAULT 'OPEN',
  currency CHAR(3) NOT NULL,
  wallet_id UUID REFERENCES wallets(id) ON DELETE RESTRICT,
  transfer_id UUID REFERENCES transfers(id) ON DELETE RESTRICT,
  funding_transaction_id UUID REFERENCES funding_transactions(id) ON DELETE RESTRICT,
  ledger_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  ledger_account_id UUID REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  expected_amount_minor BIGINT, actual_amount_minor BIGINT, difference_minor BIGINT,
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolution_note VARCHAR(500), resolved_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reconciliation_findings_currency_upper CHECK (currency = upper(currency)),
  CONSTRAINT reconciliation_findings_evidence_object CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE IF NOT EXISTS ledger_adjustment_requests (
  id UUID PRIMARY KEY, adjustment_reference VARCHAR(24) NOT NULL UNIQUE,
  finding_id UUID REFERENCES reconciliation_findings(id) ON DELETE RESTRICT,
  adjustment_type ledger_adjustment_type NOT NULL,
  target_ledger_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  currency CHAR(3) NOT NULL, reason_code VARCHAR(100) NOT NULL,
  reason VARCHAR(500) NOT NULL CHECK (length(trim(reason)) > 0),
  status ledger_adjustment_status NOT NULL DEFAULT 'DRAFT',
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT, approved_at TIMESTAMPTZ,
  rejected_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT, rejected_at TIMESTAMPTZ,
  resolution_note VARCHAR(500),
  executed_ledger_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  executed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_adjustment_currency_upper CHECK (currency = upper(currency)),
  CONSTRAINT ledger_adjustment_self_approval CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id)
);

CREATE TABLE IF NOT EXISTS ledger_adjustment_lines (
  id UUID PRIMARY KEY,
  adjustment_request_id UUID NOT NULL REFERENCES ledger_adjustment_requests(id) ON DELETE RESTRICT,
  ledger_account_id UUID NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  entry_type ledger_entry_type NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0), currency CHAR(3) NOT NULL,
  description VARCHAR(200), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_adjustment_lines_currency_upper CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS reconciliation_runs_status_created_idx ON reconciliation_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS reconciliation_findings_status_severity_idx ON reconciliation_findings(status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS reconciliation_findings_wallet_idx ON reconciliation_findings(wallet_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS reconciliation_findings_ledger_idx ON reconciliation_findings(ledger_transaction_id);
CREATE INDEX IF NOT EXISTS ledger_adjustment_status_created_idx ON ledger_adjustment_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_adjustment_lines_request_idx ON ledger_adjustment_lines(adjustment_request_id);

INSERT INTO ledger_accounts (id, account_code, account_type, wallet_id, name, currency, status)
VALUES (gen_random_uuid(), 'SYS-ADJUST-INR', 'SYSTEM_ADJUSTMENT', NULL, 'System INR Adjustment', 'INR', 'ACTIVE')
ON CONFLICT (account_code) DO NOTHING;
