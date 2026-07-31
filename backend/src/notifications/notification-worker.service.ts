import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";

type NotificationJob = {
  id: string;
  job_type: string;
  resource_id: string;
  payload: Record<string, unknown>;
};

type NotificationInput = {
  userId: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  resourceType: string;
  resourceId: string;
  actionPath: string;
};

@Injectable()
export class NotificationWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private timer?: NodeJS.Timeout;
  private working = false;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.processNext(), 4_000);
    this.timer.unref();
    void this.processNext();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async processNext() {
    if (this.working) return;
    this.working = true;
    let client: PoolClient | undefined;
    let jobId: string | null = null;
    try {
      client = await this.database.connect();
      await client.query("BEGIN");
      const claimed = await client.query<NotificationJob>(
        `
          SELECT id, job_type, resource_id, payload
          FROM background_jobs
          WHERE job_type IN (
            'USER_REGISTERED',
            'FUNDING_NOTIFICATION',
            'TRANSFER_NOTIFICATION',
            'CREATE_WELCOME_NOTIFICATION',
            'CREATE_FUNDING_NOTIFICATION',
            'CREATE_TRANSFER_NOTIFICATIONS',
            'CREATE_FAILED_TRANSFER_NOTIFICATION',
            'CREATE_REVERSAL_NOTIFICATIONS',
            'account.password.changed',
            'account.closure.requested',
            'account.closure.cancelled',
            'account.suspended',
            'account.reactivated',
            'account.closed',
            'wallet.suspended',
            'wallet.reactivated'
          )
            AND (
              status IN ('PENDING', 'FAILED')
              OR (
                status = 'PROCESSING'
                AND locked_at < NOW() - INTERVAL '5 minutes'
              )
            )
            AND available_at <= NOW()
            AND attempt_count < max_attempts
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      const job = claimed.rows[0];
      if (!job) {
        await client.query("COMMIT");
        return;
      }
      jobId = job.id;
      await client.query(
        `
          UPDATE background_jobs
          SET
            status = 'PROCESSING',
            attempt_count = attempt_count + 1,
            locked_at = NOW(),
            locked_by = $2,
            last_attempt_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
        `,
        [job.id, `notification-worker-${process.pid}`],
      );
      const processed = await client.query(
        `
          INSERT INTO processed_background_jobs (handler_name, job_id)
          VALUES ('in-app-notifications-v1', $1)
          ON CONFLICT (handler_name, job_id) DO NOTHING
          RETURNING job_id
        `,
        [job.id],
      );
      if (processed.rowCount) {
        const notifications = await this.buildNotifications(client, job);
        for (const notification of notifications) {
          await this.insertNotification(client, job.id, notification);
        }
      }
      await client.query(
        `
          UPDATE background_jobs
          SET
            status = 'COMPLETED',
            completed_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = NOW()
          WHERE id = $1
        `,
        [job.id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      if (jobId) {
        await this.database
          .query(
            `
              UPDATE background_jobs
              SET
                status = 'FAILED',
                available_at = NOW() + INTERVAL '30 seconds',
                locked_at = NULL,
                locked_by = NULL,
                last_error_code = 'NOTIFICATION_PROCESSING_FAILED',
                last_error_message = $2,
                updated_at = NOW()
              WHERE id = $1
            `,
            [
              jobId,
              error instanceof Error
                ? error.message.slice(0, 1000)
                : "Notification processing failed",
            ],
          )
          .catch(() => undefined);
      }
      this.logger.error(
        error instanceof Error
          ? error.message
          : "Notification processing failed",
      );
    } finally {
      client?.release();
      this.working = false;
    }
  }

  private async buildNotifications(
    client: PoolClient,
    job: NotificationJob,
  ): Promise<NotificationInput[]> {
    if (job.job_type === "account.password.changed") {
      const userId = this.payloadUserId(job);
      await this.assertUserExists(client, userId);
      return [
        {
          userId,
          type: "ACCOUNT_SECURITY",
          severity: "CRITICAL",
          title: "Password changed",
          message:
            "Your LedgerFlow password was changed. Review your active sessions if this was not you.",
          resourceType: "USER_ACCOUNT",
          resourceId: userId,
          actionPath: "/settings",
        },
      ];
    }

    if (
      job.job_type === "account.suspended" ||
      job.job_type === "account.reactivated" ||
      job.job_type === "account.closed"
    ) {
      const userId = this.payloadUserId(job);
      await this.assertUserExists(client, userId);
      const content = {
        "account.suspended": {
          severity: "CRITICAL" as const,
          title: "Account suspended",
          message:
            "Your LedgerFlow account was suspended by an administrator and active sessions were signed out.",
        },
        "account.reactivated": {
          severity: "INFO" as const,
          title: "Account reactivated",
          message:
            "Your LedgerFlow customer account was reactivated after administrator review.",
        },
        "account.closed": {
          severity: "CRITICAL" as const,
          title: "Account closed",
          message:
            "Your LedgerFlow customer account and virtual wallet were closed after review.",
        },
      }[job.job_type];
      return [
        {
          userId,
          type: "ACCOUNT_SECURITY",
          severity: content.severity,
          title: content.title,
          message: content.message,
          resourceType: "USER_ACCOUNT",
          resourceId: userId,
          actionPath: "/settings",
        },
      ];
    }

    if (
      job.job_type === "wallet.suspended" ||
      job.job_type === "wallet.reactivated"
    ) {
      const userId = this.payloadUserId(job);
      await this.assertUserExists(client, userId);
      const suspended = job.job_type === "wallet.suspended";
      return [
        {
          userId,
          type: "WALLET_STATUS_CHANGED",
          severity: suspended ? "CRITICAL" : "INFO",
          title: suspended ? "Wallet suspended" : "Wallet reactivated",
          message: suspended
            ? "Your virtual wallet was suspended by an administrator. Its balance and transaction history were not changed."
            : "Your virtual wallet was reactivated after administrator review.",
          resourceType: "WALLET",
          resourceId: job.resource_id,
          actionPath: "/wallet/statement",
        },
      ];
    }

    if (
      job.job_type === "account.closure.requested" ||
      job.job_type === "account.closure.cancelled"
    ) {
      const userId = this.payloadUserId(job);
      await this.assertUserExists(client, userId);
      const requested = job.job_type === "account.closure.requested";
      return [
        {
          userId,
          type: "SYSTEM_MESSAGE",
          severity: requested ? "WARNING" : "INFO",
          title: requested
            ? "Account closure requested"
            : "Account closure request cancelled",
          message: requested
            ? "Your account closure request is pending review. Your account and wallet have not been deleted."
            : "Your pending account closure request was cancelled.",
          resourceType: "USER_ACCOUNT",
          resourceId: userId,
          actionPath: "/settings",
        },
      ];
    }

    if (
      job.job_type === "USER_REGISTERED" ||
      job.job_type === "CREATE_WELCOME_NOTIFICATION"
    ) {
      const result = await client.query<{ id: string; full_name: string }>(
        "SELECT id, full_name FROM users WHERE id = $1",
        [job.resource_id],
      );
      const user = result.rows[0];
      if (!user) throw new Error("Welcome notification user was not found.");
      return [
        {
          userId: user.id,
          type: "WELCOME",
          severity: "INFO",
          title: "Welcome to LedgerFlow",
          message: `Welcome, ${user.full_name}. Your virtual INR wallet is ready.`,
          resourceType: "USER_ACCOUNT",
          resourceId: user.id,
          actionPath: "/dashboard",
        },
      ];
    }

    if (
      job.job_type === "FUNDING_NOTIFICATION" ||
      job.job_type === "CREATE_FUNDING_NOTIFICATION"
    ) {
      const result = await client.query<{
        id: string;
        user_id: string;
        amount_minor: string;
        currency: string;
        status: string;
      }>(
        `
          SELECT
            funding.id,
            wallet.user_id,
            funding.amount_minor,
            funding.currency,
            funding.status
          FROM funding_transactions funding
          JOIN wallets wallet ON wallet.id = funding.wallet_id
          WHERE funding.id = $1
        `,
        [job.resource_id],
      );
      const funding = result.rows[0];
      if (!funding || funding.status !== "COMPLETED") {
        throw new Error("Completed funding transaction was not found.");
      }
      return [
        {
          userId: funding.user_id,
          type: "WALLET_FUNDED",
          severity: "INFO",
          title: "Virtual funds added",
          message: `${this.money(
            funding.amount_minor,
            funding.currency,
          )} was added to your virtual wallet.`,
          resourceType: "FUNDING_TRANSACTION",
          resourceId: funding.id,
          actionPath: "/wallet/statement",
        },
      ];
    }

    const result = await client.query<{
      id: string;
      transfer_reference: string;
      amount_minor: string;
      currency: string;
      status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
      sender_user_id: string;
      sender_name: string;
      receiver_user_id: string;
      receiver_name: string;
    }>(
      `
        SELECT
          transfer.id,
          transfer.transfer_reference,
          transfer.amount_minor,
          transfer.currency,
          transfer.status,
          sender_wallet.user_id AS sender_user_id,
          sender_user.full_name AS sender_name,
          receiver_wallet.user_id AS receiver_user_id,
          receiver_user.full_name AS receiver_name
        FROM transfers transfer
        JOIN wallets sender_wallet ON sender_wallet.id = transfer.sender_wallet_id
        JOIN users sender_user ON sender_user.id = sender_wallet.user_id
        JOIN wallets receiver_wallet ON receiver_wallet.id = transfer.receiver_wallet_id
        JOIN users receiver_user ON receiver_user.id = receiver_wallet.user_id
        WHERE transfer.id = $1
      `,
      [job.resource_id],
    );
    const transfer = result.rows[0];
    if (!transfer) throw new Error("Notification transfer was not found.");
    const amount = this.money(transfer.amount_minor, transfer.currency);
    const actionPath = `/transactions/${transfer.id}`;

    if (
      transfer.status === "FAILED" ||
      job.job_type === "CREATE_FAILED_TRANSFER_NOTIFICATION"
    ) {
      return [
        {
          userId: transfer.sender_user_id,
          type: "TRANSFER_FAILED",
          severity: "WARNING",
          title: "Transfer unsuccessful",
          message: `Your ${amount} transfer was not completed. Reference ${transfer.transfer_reference}.`,
          resourceType: "TRANSFER",
          resourceId: transfer.id,
          actionPath,
        },
      ];
    }
    if (
      transfer.status === "REVERSED" ||
      job.job_type === "CREATE_REVERSAL_NOTIFICATIONS"
    ) {
      const message = `The ${amount} transfer with reference ${transfer.transfer_reference} was reversed.`;
      return [
        {
          userId: transfer.sender_user_id,
          type: "TRANSFER_REVERSED",
          severity: "WARNING",
          title: "Transfer reversed",
          message,
          resourceType: "TRANSFER",
          resourceId: transfer.id,
          actionPath,
        },
        {
          userId: transfer.receiver_user_id,
          type: "TRANSFER_REVERSED",
          severity: "WARNING",
          title: "Transfer reversed",
          message,
          resourceType: "TRANSFER",
          resourceId: transfer.id,
          actionPath,
        },
      ];
    }
    if (transfer.status !== "COMPLETED") {
      throw new Error("Completed transfer was not found.");
    }
    return [
      {
        userId: transfer.sender_user_id,
        type: "TRANSFER_SENT",
        severity: "INFO",
        title: "Virtual money sent",
        message: `You sent ${amount} to ${transfer.receiver_name}. Reference ${transfer.transfer_reference}.`,
        resourceType: "TRANSFER",
        resourceId: transfer.id,
        actionPath,
      },
      {
        userId: transfer.receiver_user_id,
        type: "TRANSFER_RECEIVED",
        severity: "INFO",
        title: "Virtual money received",
        message: `You received ${amount} from ${transfer.sender_name}. Reference ${transfer.transfer_reference}.`,
        resourceType: "TRANSFER",
        resourceId: transfer.id,
        actionPath,
      },
    ];
  }

  private async insertNotification(
    client: PoolClient,
    jobId: string,
    notification: NotificationInput,
  ) {
    if (!(await this.shouldDeliver(client, notification))) return;
    await client.query(
      `
        INSERT INTO notifications (
          id,
          user_id,
          notification_type,
          severity,
          title,
          message,
          related_resource_type,
          related_resource_id,
          source_job_id,
          action_path
        )
        VALUES (
          $1,
          $2,
          $3::notification_type,
          $4::notification_severity,
          $5,
          $6,
          $7::notification_resource_type,
          $8,
          $9,
          $10
        )
        ON CONFLICT (user_id, source_job_id, notification_type)
          WHERE source_job_id IS NOT NULL
        DO NOTHING
      `,
      [
        randomUUID(),
        notification.userId,
        notification.type,
        notification.severity,
        notification.title.slice(0, 150),
        notification.message,
        notification.resourceType,
        notification.resourceId,
        jobId,
        notification.actionPath,
      ],
    );
  }

  private async shouldDeliver(
    client: PoolClient,
    notification: NotificationInput,
  ) {
    const fieldByType: Record<string, string> = {
      WALLET_FUNDED: "wallet_funding_enabled",
      TRANSFER_SENT: "transfer_sent_enabled",
      TRANSFER_RECEIVED: "transfer_received_enabled",
      TRANSFER_FAILED: "transfer_failed_enabled",
      TRANSFER_REVERSED: "transfer_reversed_enabled",
      SYSTEM_MESSAGE: "system_messages_enabled",
    };
    const field = fieldByType[notification.type];
    if (!field) return true;
    const result = await client.query<{ enabled: boolean }>(
      `
        SELECT COALESCE(
          (SELECT ${field} FROM notification_preferences WHERE user_id = $1),
          TRUE
        ) AS enabled
      `,
      [notification.userId],
    );
    return result.rows[0]?.enabled !== false;
  }

  private payloadUserId(job: NotificationJob) {
    const value = job.payload.userId;
    if (typeof value !== "string") {
      throw new Error("Notification job user was not provided.");
    }
    return value;
  }

  private async assertUserExists(client: PoolClient, userId: string) {
    const result = await client.query("SELECT 1 FROM users WHERE id = $1", [
      userId,
    ]);
    if (!result.rows[0]) throw new Error("Notification user was not found.");
  }

  private money(amountMinor: string, currency: string) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency.trim(),
      minimumFractionDigits: 2,
    }).format(Number(amountMinor) / 100);
  }
}
