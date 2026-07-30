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
            'CREATE_REVERSAL_NOTIFICATIONS'
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

  private money(amountMinor: string, currency: string) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency.trim(),
      minimumFractionDigits: 2,
    }).format(Number(amountMinor) / 100);
  }
}
