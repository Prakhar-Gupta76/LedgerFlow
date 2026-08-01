DO $$ BEGIN CREATE TYPE audit_change_type AS ENUM ('CREATED','UPDATED','REMOVED','STATUS_TRANSITION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE audit_data_classification AS ENUM ('INTERNAL','RESTRICTED','HIGHLY_RESTRICTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE audit_access_type AS ENUM ('SEARCH','VIEW_DETAILS','VIEW_RESTRICTED_CONTEXT','EXPORT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS audit_record_changes (
  id UUID PRIMARY KEY,
  audit_record_id UUID NOT NULL REFERENCES audit_records(id) ON DELETE RESTRICT,
  field_name VARCHAR(100) NOT NULL,
  change_type audit_change_type NOT NULL,
  before_value JSONB, after_value JSONB,
  data_classification audit_data_classification NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_change_field_allowlist CHECK (field_name IN (
    'status','reason_code','role','wallet_status','user_status',
    'attempt_count','available_at','resolution_status','adjustment_reference',
    'ledger_transaction_id','amount_minor','currency','resource_reference'
  ))
);

CREATE TABLE IF NOT EXISTS audit_log_accesses (
  id UUID PRIMARY KEY,
  accessed_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  access_type audit_access_type NOT NULL,
  target_audit_record_id UUID REFERENCES audit_records(id) ON DELETE RESTRICT,
  query_fingerprint VARCHAR(128), result_count INTEGER CHECK(result_count >= 0),
  reason VARCHAR(500), ip_address INET, user_agent VARCHAR(500),
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_access_reason_required CHECK (
    access_type NOT IN ('VIEW_RESTRICTED_CONTEXT','EXPORT')
    OR length(trim(COALESCE(reason,''))) >= 3
  )
);

CREATE INDEX IF NOT EXISTS audit_records_correlation_idx ON audit_records(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_record_changes_record_idx ON audit_record_changes(audit_record_id);
CREATE INDEX IF NOT EXISTS audit_log_accesses_admin_idx ON audit_log_accesses(accessed_by_user_id,accessed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_accesses_record_idx ON audit_log_accesses(target_audit_record_id) WHERE target_audit_record_id IS NOT NULL;

INSERT INTO audit_record_changes (
  id, audit_record_id, field_name, change_type,
  before_value, after_value, data_classification, created_at
)
SELECT gen_random_uuid(), id,
  CASE resource_type WHEN 'WALLET' THEN 'wallet_status'
       WHEN 'USER_ACCOUNT' THEN 'user_status' ELSE 'status' END,
  'STATUS_TRANSITION', metadata->'previousStatus', metadata->'newStatus',
  'INTERNAL', occurred_at
FROM audit_records
WHERE metadata ? 'previousStatus' AND metadata ? 'newStatus'
  AND NOT EXISTS (
    SELECT 1 FROM audit_record_changes changes
    WHERE changes.audit_record_id = audit_records.id
      AND changes.field_name IN ('status','wallet_status','user_status')
  );

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_records_immutable ON audit_records;
CREATE TRIGGER audit_records_immutable BEFORE UPDATE OR DELETE ON audit_records
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
DROP TRIGGER IF EXISTS audit_record_changes_immutable ON audit_record_changes;
CREATE TRIGGER audit_record_changes_immutable BEFORE UPDATE OR DELETE ON audit_record_changes
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
DROP TRIGGER IF EXISTS audit_log_accesses_immutable ON audit_log_accesses;
CREATE TRIGGER audit_log_accesses_immutable BEFORE UPDATE OR DELETE ON audit_log_accesses
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
