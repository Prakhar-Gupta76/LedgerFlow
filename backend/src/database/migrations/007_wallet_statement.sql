ALTER TYPE ledger_transaction_type ADD VALUE IF NOT EXISTS 'REVERSAL';

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS account_balance_after_minor BIGINT
    CHECK (
      account_balance_after_minor IS NULL
      OR account_balance_after_minor >= 0
    );

WITH running_balances AS (
  SELECT
    le.id,
    SUM(
      CASE
        WHEN le.entry_type = 'CREDIT' THEN le.amount_minor
        ELSE -le.amount_minor
      END
    ) OVER (
      PARTITION BY le.ledger_account_id
      ORDER BY lt.posted_at ASC, le.id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS balance_after_minor
  FROM ledger_entries le
  JOIN ledger_accounts la ON la.id = le.ledger_account_id
  JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
  WHERE la.account_type = 'USER_WALLET'
)
UPDATE ledger_entries le
SET account_balance_after_minor = running_balances.balance_after_minor
FROM running_balances
WHERE le.id = running_balances.id
  AND le.account_balance_after_minor IS NULL;

CREATE OR REPLACE FUNCTION enforce_wallet_entry_balance_snapshot()
RETURNS TRIGGER AS $$
DECLARE
  selected_account_type ledger_account_type;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.account_balance_after_minor IS DISTINCT FROM NEW.account_balance_after_minor
  THEN
    RAISE EXCEPTION 'Ledger balance snapshots are immutable';
  END IF;

  SELECT account_type
  INTO selected_account_type
  FROM ledger_accounts
  WHERE id = NEW.ledger_account_id;

  IF selected_account_type = 'USER_WALLET'
    AND NEW.account_balance_after_minor IS NULL
  THEN
    RAISE EXCEPTION 'User wallet ledger entries require a balance snapshot';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_entry_balance_snapshot_guard ON ledger_entries;
CREATE TRIGGER wallet_entry_balance_snapshot_guard
BEFORE INSERT OR UPDATE OF ledger_account_id, account_balance_after_minor
ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION enforce_wallet_entry_balance_snapshot();

CREATE INDEX IF NOT EXISTS ledger_entries_account_created_id_idx
  ON ledger_entries (ledger_account_id, created_at, id);
CREATE INDEX IF NOT EXISTS ledger_transactions_posted_id_idx
  ON ledger_transactions (posted_at, id);

CREATE OR REPLACE VIEW wallet_statement_entries AS
SELECT
  le.id AS ledger_entry_id,
  la.wallet_id,
  lt.id AS ledger_transaction_id,
  lt.transaction_type::TEXT AS transaction_type,
  COALESCE(original.reference_id, lt.reference_id) AS reference_id,
  CASE
    WHEN lt.transaction_type::TEXT IN ('WALLET_TRANSFER', 'REVERSAL')
      THEN transfer.transfer_reference::TEXT
    WHEN lt.transaction_type::TEXT = 'WALLET_FUNDING'
      THEN funding.id::TEXT
    ELSE lt.reference_id::TEXT
  END AS customer_reference,
  le.entry_type::TEXT AS entry_type,
  le.amount_minor,
  CASE
    WHEN le.entry_type = 'CREDIT' THEN le.amount_minor
    ELSE -le.amount_minor
  END AS signed_amount_minor,
  le.account_balance_after_minor AS balance_after_minor,
  le.currency,
  CASE
    WHEN lt.transaction_type::TEXT = 'WALLET_FUNDING'
      THEN 'Virtual funds added'
    WHEN lt.transaction_type::TEXT = 'WALLET_TRANSFER'
      AND la.wallet_id = transfer.sender_wallet_id
      THEN 'Transfer to ' || COALESCE(receiver_user.full_name, 'another wallet')
    WHEN lt.transaction_type::TEXT = 'WALLET_TRANSFER'
      AND la.wallet_id = transfer.receiver_wallet_id
      THEN 'Transfer from ' || COALESCE(sender_user.full_name, 'another wallet')
    WHEN lt.transaction_type::TEXT = 'REVERSAL'
      AND la.wallet_id = transfer.sender_wallet_id
      THEN 'Reversal of transfer to ' || COALESCE(receiver_user.full_name, 'another wallet')
    WHEN lt.transaction_type::TEXT = 'REVERSAL'
      AND la.wallet_id = transfer.receiver_wallet_id
      THEN 'Reversal of transfer from ' || COALESCE(sender_user.full_name, 'another wallet')
    ELSE COALESCE(lt.description, 'Wallet adjustment')
  END::TEXT AS description,
  CASE
    WHEN la.wallet_id = transfer.sender_wallet_id
      THEN transfer.receiver_wallet_id
    WHEN la.wallet_id = transfer.receiver_wallet_id
      THEN transfer.sender_wallet_id
    ELSE NULL
  END AS counterparty_wallet_id,
  lt.reversal_of_id,
  lt.posted_at
FROM ledger_entries le
JOIN ledger_accounts la
  ON la.id = le.ledger_account_id
  AND la.account_type = 'USER_WALLET'
JOIN ledger_transactions lt ON lt.id = le.ledger_transaction_id
LEFT JOIN ledger_transactions original ON original.id = lt.reversal_of_id
LEFT JOIN transfers transfer
  ON transfer.id = COALESCE(original.reference_id, lt.reference_id)
  AND lt.transaction_type::TEXT IN ('WALLET_TRANSFER', 'REVERSAL')
LEFT JOIN wallets sender_wallet ON sender_wallet.id = transfer.sender_wallet_id
LEFT JOIN users sender_user ON sender_user.id = sender_wallet.user_id
LEFT JOIN wallets receiver_wallet ON receiver_wallet.id = transfer.receiver_wallet_id
LEFT JOIN users receiver_user ON receiver_user.id = receiver_wallet.user_id
LEFT JOIN funding_transactions funding
  ON funding.id = lt.reference_id
  AND lt.transaction_type::TEXT = 'WALLET_FUNDING';
