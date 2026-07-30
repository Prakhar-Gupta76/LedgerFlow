ALTER TABLE wallet_daily_summaries
  ADD COLUMN IF NOT EXISTS funded_amount_minor BIGINT NOT NULL DEFAULT 0
    CHECK (funded_amount_minor >= 0),
  ADD COLUMN IF NOT EXISTS funding_count INTEGER NOT NULL DEFAULT 0
    CHECK (funding_count >= 0);

CREATE INDEX IF NOT EXISTS wallet_daily_summaries_wallet_date_idx
  ON wallet_daily_summaries (wallet_id, summary_date);

CREATE TABLE IF NOT EXISTS wallet_counterparty_daily_summaries (
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  counterparty_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  summary_date DATE NOT NULL,
  currency CHAR(3) NOT NULL,
  sent_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (sent_amount_minor >= 0),
  received_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (received_amount_minor >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  last_transfer_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (
    wallet_id,
    counterparty_wallet_id,
    summary_date,
    currency
  ),
  CONSTRAINT wallet_counterparty_summary_distinct_wallets
    CHECK (wallet_id <> counterparty_wallet_id),
  CONSTRAINT wallet_counterparty_summary_currency_uppercase
    CHECK (currency = upper(currency))
);

CREATE INDEX IF NOT EXISTS wallet_counterparty_summary_wallet_date_idx
  ON wallet_counterparty_daily_summaries (wallet_id, summary_date);
CREATE INDEX IF NOT EXISTS wallet_counterparty_summary_pair_date_idx
  ON wallet_counterparty_daily_summaries (
    wallet_id,
    counterparty_wallet_id,
    summary_date
  );

CREATE TABLE IF NOT EXISTS processed_background_jobs (
  handler_name VARCHAR(100) NOT NULL,
  job_id UUID NOT NULL REFERENCES background_jobs(id) ON DELETE RESTRICT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (handler_name, job_id)
);

CREATE INDEX IF NOT EXISTS processed_background_jobs_processed_idx
  ON processed_background_jobs (processed_at);

WITH wallet_activity AS (
  SELECT
    sender_wallet_id AS wallet_id,
    completed_at::DATE AS summary_date,
    currency,
    amount_minor AS sent_amount_minor,
    0::BIGINT AS received_amount_minor,
    0::BIGINT AS funded_amount_minor,
    1 AS sent_count,
    0 AS received_count,
    0 AS funding_count,
    0 AS failed_transfer_count,
    completed_at AS activity_at
  FROM transfers
  WHERE status = 'COMPLETED' AND completed_at IS NOT NULL

  UNION ALL

  SELECT
    receiver_wallet_id,
    completed_at::DATE,
    currency,
    0::BIGINT,
    amount_minor,
    0::BIGINT,
    0,
    1,
    0,
    0,
    completed_at
  FROM transfers
  WHERE status = 'COMPLETED' AND completed_at IS NOT NULL

  UNION ALL

  SELECT
    sender_wallet_id,
    COALESCE(failed_at, initiated_at)::DATE,
    currency,
    0::BIGINT,
    0::BIGINT,
    0::BIGINT,
    0,
    0,
    0,
    1,
    COALESCE(failed_at, initiated_at)
  FROM transfers
  WHERE status = 'FAILED'

  UNION ALL

  SELECT
    wallet_id,
    completed_at::DATE,
    currency,
    0::BIGINT,
    0::BIGINT,
    amount_minor,
    0,
    0,
    1,
    0,
    completed_at
  FROM funding_transactions
  WHERE status = 'COMPLETED' AND completed_at IS NOT NULL
),
rebuilt AS (
  SELECT
    wallet_id,
    summary_date,
    currency,
    SUM(sent_amount_minor) AS sent_amount_minor,
    SUM(received_amount_minor) AS received_amount_minor,
    SUM(funded_amount_minor) AS funded_amount_minor,
    SUM(sent_count)::INTEGER AS sent_count,
    SUM(received_count)::INTEGER AS received_count,
    SUM(funding_count)::INTEGER AS funding_count,
    SUM(failed_transfer_count)::INTEGER AS failed_transfer_count,
    NOW() AS last_job_at
  FROM wallet_activity
  GROUP BY wallet_id, summary_date, currency
)
INSERT INTO wallet_daily_summaries (
  wallet_id,
  summary_date,
  currency,
  sent_amount_minor,
  received_amount_minor,
  funded_amount_minor,
  sent_count,
  received_count,
  funding_count,
  failed_transfer_count,
  last_job_at,
  updated_at
)
SELECT
  wallet_id,
  summary_date,
  currency,
  sent_amount_minor,
  received_amount_minor,
  funded_amount_minor,
  sent_count,
  received_count,
  funding_count,
  failed_transfer_count,
  last_job_at,
  NOW()
FROM rebuilt
ON CONFLICT (wallet_id, summary_date, currency) DO UPDATE
SET
  sent_amount_minor = EXCLUDED.sent_amount_minor,
  received_amount_minor = EXCLUDED.received_amount_minor,
  funded_amount_minor = EXCLUDED.funded_amount_minor,
  sent_count = EXCLUDED.sent_count,
  received_count = EXCLUDED.received_count,
  funding_count = EXCLUDED.funding_count,
  failed_transfer_count = EXCLUDED.failed_transfer_count,
  last_job_at = EXCLUDED.last_job_at,
  updated_at = NOW();

WITH counterparty_activity AS (
  SELECT
    sender_wallet_id AS wallet_id,
    receiver_wallet_id AS counterparty_wallet_id,
    completed_at::DATE AS summary_date,
    currency,
    amount_minor AS sent_amount_minor,
    0::BIGINT AS received_amount_minor,
    1 AS sent_count,
    0 AS received_count,
    completed_at AS last_transfer_at
  FROM transfers
  WHERE status = 'COMPLETED' AND completed_at IS NOT NULL

  UNION ALL

  SELECT
    receiver_wallet_id,
    sender_wallet_id,
    completed_at::DATE,
    currency,
    0::BIGINT,
    amount_minor,
    0,
    1,
    completed_at
  FROM transfers
  WHERE status = 'COMPLETED' AND completed_at IS NOT NULL
),
rebuilt AS (
  SELECT
    wallet_id,
    counterparty_wallet_id,
    summary_date,
    currency,
    SUM(sent_amount_minor) AS sent_amount_minor,
    SUM(received_amount_minor) AS received_amount_minor,
    SUM(sent_count)::INTEGER AS sent_count,
    SUM(received_count)::INTEGER AS received_count,
    MAX(last_transfer_at) AS last_transfer_at
  FROM counterparty_activity
  GROUP BY wallet_id, counterparty_wallet_id, summary_date, currency
)
INSERT INTO wallet_counterparty_daily_summaries (
  wallet_id,
  counterparty_wallet_id,
  summary_date,
  currency,
  sent_amount_minor,
  received_amount_minor,
  sent_count,
  received_count,
  last_transfer_at,
  updated_at
)
SELECT
  wallet_id,
  counterparty_wallet_id,
  summary_date,
  currency,
  sent_amount_minor,
  received_amount_minor,
  sent_count,
  received_count,
  last_transfer_at,
  NOW()
FROM rebuilt
ON CONFLICT (
  wallet_id,
  counterparty_wallet_id,
  summary_date,
  currency
) DO UPDATE
SET
  sent_amount_minor = EXCLUDED.sent_amount_minor,
  received_amount_minor = EXCLUDED.received_amount_minor,
  sent_count = EXCLUDED.sent_count,
  received_count = EXCLUDED.received_count,
  last_transfer_at = EXCLUDED.last_transfer_at,
  updated_at = NOW();

INSERT INTO processed_background_jobs (handler_name, job_id)
SELECT 'wallet-analytics-v1', id
FROM background_jobs
WHERE job_type IN (
  'TRANSFER_ANALYTICS',
  'FUNDING_ANALYTICS',
  'UPDATE_TRANSFER_ANALYTICS',
  'UPDATE_FAILED_TRANSFER_ANALYTICS',
  'UPDATE_FUNDING_ANALYTICS',
  'UPDATE_TRANSFER_REVERSAL_ANALYTICS'
)
ON CONFLICT (handler_name, job_id) DO NOTHING;

UPDATE background_jobs
SET
  status = 'COMPLETED',
  completed_at = COALESCE(completed_at, NOW()),
  locked_at = NULL,
  locked_by = NULL,
  updated_at = NOW()
WHERE job_type IN (
  'TRANSFER_ANALYTICS',
  'FUNDING_ANALYTICS',
  'UPDATE_TRANSFER_ANALYTICS',
  'UPDATE_FAILED_TRANSFER_ANALYTICS',
  'UPDATE_FUNDING_ANALYTICS',
  'UPDATE_TRANSFER_REVERSAL_ANALYTICS'
)
  AND status <> 'COMPLETED';
