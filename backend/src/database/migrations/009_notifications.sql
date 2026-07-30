ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'WELCOME';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'WALLET_FUNDED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TRANSFER_REVERSED';

DO $$ BEGIN
  CREATE TYPE notification_resource_type AS ENUM (
    'TRANSFER',
    'FUNDING_TRANSACTION',
    'WALLET',
    'USER_ACCOUNT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE notifications
  ALTER COLUMN related_resource_type TYPE notification_resource_type
  USING (
    CASE
      WHEN related_resource_type IS NULL THEN NULL
      ELSE related_resource_type::notification_resource_type
    END
  );

DO $$ BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT notifications_resource_pair_valid CHECK (
      (related_resource_type IS NULL AND related_resource_id IS NULL)
      OR
      (related_resource_type IS NOT NULL AND related_resource_id IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notifications
    ADD CONSTRAINT notifications_action_path_internal CHECK (
      action_path IS NULL
      OR (
        action_path LIKE '/%'
        AND action_path NOT LIKE '//%'
        AND action_path NOT LIKE '%://%'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS notifications_user_created_id_idx
  ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_created_idx
  ON notifications (user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_user_type_created_idx
  ON notifications (user_id, notification_type, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_severity_created_idx
  ON notifications (user_id, severity, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_resource_idx
  ON notifications (related_resource_type, related_resource_id);
