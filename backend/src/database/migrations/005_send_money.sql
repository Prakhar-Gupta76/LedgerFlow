ALTER TYPE ledger_transaction_type ADD VALUE IF NOT EXISTS 'WALLET_TRANSFER';

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS transfer_reference VARCHAR(24),
  ADD COLUMN IF NOT EXISTS initiated_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS sender_balance_before_minor BIGINT
    CHECK (sender_balance_before_minor >= 0),
  ADD COLUMN IF NOT EXISTS sender_balance_after_minor BIGINT
    CHECK (sender_balance_after_minor >= 0),
  ADD COLUMN IF NOT EXISTS receiver_balance_before_minor BIGINT
    CHECK (receiver_balance_before_minor >= 0),
  ADD COLUMN IF NOT EXISTS receiver_balance_after_minor BIGINT
    CHECK (receiver_balance_after_minor >= 0),
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;

UPDATE transfers t
SET
  transfer_reference = COALESCE(
    transfer_reference,
    'LFTR-' || upper(substr(md5(t.id::TEXT), 1, 16))
  ),
  initiated_by_user_id = COALESCE(
    initiated_by_user_id,
    (SELECT w.user_id FROM wallets w WHERE w.id = t.sender_wallet_id)
  ),
  idempotency_key = COALESCE(idempotency_key, gen_random_uuid());

ALTER TABLE transfers
  ALTER COLUMN transfer_reference SET NOT NULL,
  ALTER COLUMN initiated_by_user_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'PENDING';

CREATE UNIQUE INDEX IF NOT EXISTS transfers_reference_unique_idx
  ON transfers (transfer_reference);
CREATE UNIQUE INDEX IF NOT EXISTS transfers_sender_idempotency_unique_idx
  ON transfers (sender_wallet_id, idempotency_key);
CREATE INDEX IF NOT EXISTS transfers_initiator_created_idx
  ON transfers (initiated_by_user_id, created_at DESC);

DO $$ BEGIN
  ALTER TABLE transfers ADD CONSTRAINT transfers_completion_state_valid CHECK (
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND failed_at IS NULL)
    OR (status = 'FAILED' AND failed_at IS NOT NULL AND completed_at IS NULL)
    OR (status = 'PENDING' AND completed_at IS NULL AND failed_at IS NULL)
    OR (status = 'REVERSED' AND completed_at IS NOT NULL AND reversed_at IS NOT NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
