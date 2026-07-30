CREATE OR REPLACE VIEW wallet_activity_history AS
SELECT
  'TRANSFER_SENT:' || t.id::TEXT AS activity_key,
  t.sender_wallet_id AS wallet_id,
  'TRANSFER'::TEXT AS source_type,
  t.id AS source_id,
  t.transfer_reference::TEXT AS reference,
  CASE
    WHEN t.status = 'REVERSED' THEN 'TRANSFER_REVERSED'
    ELSE 'TRANSFER_SENT'
  END::TEXT AS activity_type,
  CASE
    WHEN t.status = 'REVERSED' THEN 'CREDIT'
    ELSE 'DEBIT'
  END::TEXT AS direction,
  t.receiver_wallet_id AS counterparty_wallet_id,
  t.amount_minor,
  t.currency,
  t.status::TEXT AS status,
  t.note,
  t.failure_code,
  CASE
    WHEN t.status = 'REVERSED' THEN COALESCE(t.reversed_at, t.updated_at)
    WHEN t.status = 'FAILED' THEN COALESCE(t.failed_at, t.updated_at)
    WHEN t.status = 'COMPLETED' THEN COALESCE(t.completed_at, t.initiated_at)
    ELSE t.initiated_at
  END AS occurred_at,
  t.completed_at
FROM transfers t

UNION ALL

SELECT
  'TRANSFER_RECEIVED:' || t.id::TEXT AS activity_key,
  t.receiver_wallet_id AS wallet_id,
  'TRANSFER'::TEXT AS source_type,
  t.id AS source_id,
  t.transfer_reference::TEXT AS reference,
  CASE
    WHEN t.status = 'REVERSED' THEN 'TRANSFER_REVERSED'
    ELSE 'TRANSFER_RECEIVED'
  END::TEXT AS activity_type,
  CASE
    WHEN t.status = 'REVERSED' THEN 'DEBIT'
    ELSE 'CREDIT'
  END::TEXT AS direction,
  t.sender_wallet_id AS counterparty_wallet_id,
  t.amount_minor,
  t.currency,
  t.status::TEXT AS status,
  t.note,
  t.failure_code,
  CASE
    WHEN t.status = 'REVERSED' THEN COALESCE(t.reversed_at, t.updated_at)
    ELSE COALESCE(t.completed_at, t.initiated_at)
  END AS occurred_at,
  t.completed_at
FROM transfers t
WHERE t.status IN ('COMPLETED', 'REVERSED')

UNION ALL

SELECT
  'FUNDING:' || f.id::TEXT AS activity_key,
  f.wallet_id,
  'FUNDING'::TEXT AS source_type,
  f.id AS source_id,
  f.id::TEXT AS reference,
  'FUNDS_ADDED'::TEXT AS activity_type,
  'CREDIT'::TEXT AS direction,
  NULL::UUID AS counterparty_wallet_id,
  f.amount_minor,
  f.currency,
  f.status::TEXT AS status,
  'LedgerFlow virtual funding'::VARCHAR(200) AS note,
  f.failure_code,
  CASE
    WHEN f.status = 'COMPLETED' THEN COALESCE(f.completed_at, f.initiated_at)
    ELSE f.initiated_at
  END AS occurred_at,
  f.completed_at
FROM funding_transactions f;
