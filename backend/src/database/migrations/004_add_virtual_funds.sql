DO $$ BEGIN
  CREATE TYPE funding_source_type AS ENUM ('SIMULATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE funding_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ledger_account_type AS ENUM ('USER_WALLET', 'SYSTEM_FUNDING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ledger_account_status AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ledger_transaction_type AS ENUM ('WALLET_FUNDING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS funding_transactions (
  id UUID PRIMARY KEY,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  initiated_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key UUID NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  source_type funding_source_type NOT NULL DEFAULT 'SIMULATED',
  status funding_status NOT NULL DEFAULT 'PENDING',
  balance_before_minor BIGINT CHECK (balance_before_minor >= 0),
  balance_after_minor BIGINT CHECK (balance_after_minor >= 0),
  failure_code VARCHAR(50),
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT funding_transactions_wallet_idempotency_unique
    UNIQUE (wallet_id, idempotency_key),
  CONSTRAINT funding_transactions_currency_uppercase
    CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS funding_transactions_wallet_created_idx
  ON funding_transactions (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS funding_transactions_user_created_idx
  ON funding_transactions (initiated_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS funding_transactions_status_created_idx
  ON funding_transactions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id UUID PRIMARY KEY,
  account_code VARCHAR(50) NOT NULL UNIQUE,
  account_type ledger_account_type NOT NULL,
  wallet_id UUID UNIQUE REFERENCES wallets(id) ON DELETE RESTRICT,
  name VARCHAR(150) NOT NULL CHECK (length(trim(name)) > 0),
  currency CHAR(3) NOT NULL,
  status ledger_account_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_accounts_currency_uppercase CHECK (currency = upper(currency)),
  CONSTRAINT ledger_accounts_wallet_requirement CHECK (
    (account_type = 'USER_WALLET' AND wallet_id IS NOT NULL)
    OR (account_type = 'SYSTEM_FUNDING' AND wallet_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id UUID PRIMARY KEY,
  transaction_type ledger_transaction_type NOT NULL,
  reference_id UUID NOT NULL,
  description VARCHAR(200),
  reversal_of_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_transactions_reference_unique
    UNIQUE (transaction_type, reference_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY,
  ledger_transaction_id UUID NOT NULL
    REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  ledger_account_id UUID NOT NULL
    REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  entry_type ledger_entry_type NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_entries_currency_uppercase CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx
  ON ledger_entries (ledger_transaction_id);
CREATE INDEX IF NOT EXISTS ledger_entries_account_created_idx
  ON ledger_entries (ledger_account_id, created_at DESC);

INSERT INTO ledger_accounts (
  id,
  account_code,
  account_type,
  wallet_id,
  name,
  currency,
  status
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  'SYS-FUND-INR',
  'SYSTEM_FUNDING',
  NULL,
  'System INR Funding',
  'INR',
  'ACTIVE'
)
ON CONFLICT (account_code) DO NOTHING;

INSERT INTO ledger_accounts (
  id,
  account_code,
  account_type,
  wallet_id,
  name,
  currency,
  status
)
SELECT
  gen_random_uuid(),
  'UW-' || w.wallet_number,
  'USER_WALLET',
  w.id,
  u.full_name || '''s INR wallet',
  w.currency,
  CASE
    WHEN w.status = 'ACTIVE' THEN 'ACTIVE'::ledger_account_status
    WHEN w.status = 'SUSPENDED' THEN 'SUSPENDED'::ledger_account_status
    ELSE 'CLOSED'::ledger_account_status
  END
FROM wallets w
JOIN users u ON u.id = w.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM ledger_accounts la WHERE la.wallet_id = w.id
);
