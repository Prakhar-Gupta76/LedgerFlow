DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('CUSTOMER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE legal_document_type AS ENUM ('TERMS', 'PRIVACY_POLICY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE wallet_status AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE background_job_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL CHECK (length(trim(full_name)) > 0),
  email VARCHAR(254) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  role user_role NOT NULL DEFAULT 'CUSTOMER',
  status user_status NOT NULL DEFAULT 'ACTIVE',
  email_verified_at TIMESTAMPTZ,
  phone_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT users_email_normalized CHECK (email = lower(trim(email))),
  CONSTRAINT users_phone_e164 CHECK (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_phone_number_unique UNIQUE (phone_number)
);

CREATE INDEX IF NOT EXISTS users_role_status_created_idx
  ON users (role, status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failed_login_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_documents (
  id UUID PRIMARY KEY,
  document_type legal_document_type NOT NULL,
  version VARCHAR(20) NOT NULL,
  title VARCHAR(150) NOT NULL CHECK (length(trim(title)) > 0),
  content_url TEXT NOT NULL CHECK (length(trim(content_url)) > 0),
  content_hash VARCHAR(64),
  effective_at TIMESTAMPTZ NOT NULL,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT legal_documents_version_unique UNIQUE (document_type, version),
  CONSTRAINT legal_documents_retirement_valid
    CHECK (retired_at IS NULL OR retired_at > effective_at)
);

CREATE INDEX IF NOT EXISTS legal_documents_active_idx
  ON legal_documents (document_type, effective_at DESC)
  WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS user_consents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  legal_document_id UUID NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT user_consents_document_unique UNIQUE (user_id, legal_document_id),
  CONSTRAINT user_consents_revocation_valid
    CHECK (revoked_at IS NULL OR revoked_at > accepted_at)
);

CREATE INDEX IF NOT EXISTS user_consents_user_accepted_idx
  ON user_consents (user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY,
  wallet_number VARCHAR(24) NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (balance_minor >= 0),
  status wallet_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  CONSTRAINT wallets_user_currency_unique UNIQUE (user_id, currency),
  CONSTRAINT wallets_currency_uppercase CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS wallets_status_created_idx
  ON wallets (status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY,
  job_type VARCHAR(100) NOT NULL CHECK (length(trim(job_type)) > 0),
  resource_type VARCHAR(50) NOT NULL CHECK (length(trim(resource_type)) > 0),
  resource_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status background_job_status NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(100),
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code VARCHAR(100),
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS background_jobs_claim_idx
  ON background_jobs (status, available_at, created_at)
  WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS background_jobs_resource_idx
  ON background_jobs (resource_type, resource_id, created_at);

INSERT INTO legal_documents (
  id,
  document_type,
  version,
  title,
  content_url,
  effective_at
) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'TERMS',
    '1.0',
    'LedgerFlow Terms of Service',
    '/terms',
    '2026-01-01T00:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'PRIVACY_POLICY',
    '1.0',
    'LedgerFlow Privacy Policy',
    '/privacy',
    '2026-01-01T00:00:00Z'
  )
ON CONFLICT (document_type, version) DO NOTHING;
