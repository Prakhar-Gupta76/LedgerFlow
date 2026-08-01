import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";

type AnalyticsJob = {
  id: string;
  job_type: string;
  resource_id: string;
  payload: {
    walletId?: string;
    senderWalletId?: string;
    receiverWalletId?: string;
  };
};

@Injectable()
export class AnalyticsWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsWorkerService.name);
  private timer?: NodeJS.Timeout;
  private working = false;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.processNext(), 5_000);
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
      const claimed = await client.query<AnalyticsJob>(
        `
          SELECT id, job_type, resource_id, payload
          FROM background_jobs
          WHERE job_type IN (
            'TRANSFER_ANALYTICS',
            'FUNDING_ANALYTICS',
            'UPDATE_TRANSFER_ANALYTICS',
            'UPDATE_FAILED_TRANSFER_ANALYTICS',
            'UPDATE_FUNDING_ANALYTICS',
            'UPDATE_TRANSFER_REVERSAL_ANALYTICS'
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
        [job.id, `ledgerflow-api-${process.pid}`],
      );
      const processed = await client.query(
        `
          INSERT INTO processed_background_jobs (handler_name, job_id)
          VALUES ('wallet-analytics-v1', $1)
          ON CONFLICT (handler_name, job_id) DO NOTHING
          RETURNING job_id
        `,
        [job.id],
      );
      if (processed.rowCount) {
        const walletIds = this.walletIds(job);
        for (const walletId of walletIds) {
          await this.rebuildWallet(client, walletId);
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
      await client.query(
        `INSERT INTO background_job_attempts (
           id, job_id, attempt_number, worker_id, outcome, started_at, completed_at
         ) SELECT $2, id, attempt_count, $3, 'SUCCEEDED', last_attempt_at, NOW()
           FROM background_jobs WHERE id = $1
           ON CONFLICT (job_id, attempt_number) DO NOTHING`,
        [job.id, randomUUID(), `ledgerflow-api-${process.pid}`],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      if (jobId) {
        await this.database
          .query(
            `WITH failed AS (
               UPDATE background_jobs
               SET attempt_count = attempt_count + 1,
                   status = CASE WHEN attempt_count + 1 >= max_attempts
                     THEN 'FAILED'::background_job_status ELSE 'PENDING'::background_job_status END,
                   available_at = NOW() + LEAST(300, 30 * power(2, attempt_count)) * INTERVAL '1 second',
                   locked_at = NULL, locked_by = NULL, last_attempt_at = NOW(),
                   last_error_code = 'ANALYTICS_PROCESSING_FAILED',
                   last_error_message = 'Analytics processing failed.', updated_at = NOW()
               WHERE id = $1 RETURNING id, attempt_count, max_attempts, last_attempt_at
             ) INSERT INTO background_job_attempts (
               id, job_id, attempt_number, worker_id, outcome,
               error_code, error_message, started_at, completed_at
             ) SELECT $2, id, attempt_count, $3,
               CASE WHEN attempt_count >= max_attempts
                 THEN 'FAILED_PERMANENT'::background_job_attempt_outcome
                 ELSE 'FAILED_RETRYABLE'::background_job_attempt_outcome END,
               'ANALYTICS_PROCESSING_FAILED', 'Analytics processing failed.', last_attempt_at, NOW()
             FROM failed ON CONFLICT (job_id, attempt_number) DO NOTHING`,
            [jobId, randomUUID(), `ledgerflow-api-${process.pid}`],
          )
          .catch(() => undefined);
      }
      this.logger.error(
        error instanceof Error ? error.message : "Analytics processing failed",
      );
    } finally {
      client?.release();
      this.working = false;
    }
  }

  private walletIds(job: AnalyticsJob) {
    return [
      job.payload.walletId,
      job.payload.senderWalletId,
      job.payload.receiverWalletId,
    ].filter(
      (value, index, values): value is string =>
        typeof value === "string" && values.indexOf(value) === index,
    );
  }

  private async rebuildWallet(client: PoolClient, walletId: string) {
    await client.query(
      "DELETE FROM wallet_daily_summaries WHERE wallet_id = $1",
      [walletId],
    );
    await client.query(
      `
        WITH activity AS (
          SELECT
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
          WHERE sender_wallet_id = $1
            AND status = 'COMPLETED'
            AND completed_at IS NOT NULL
          UNION ALL
          SELECT
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
          WHERE receiver_wallet_id = $1
            AND status = 'COMPLETED'
            AND completed_at IS NOT NULL
          UNION ALL
          SELECT
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
          WHERE sender_wallet_id = $1 AND status = 'FAILED'
          UNION ALL
          SELECT
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
          WHERE wallet_id = $1
            AND status = 'COMPLETED'
            AND completed_at IS NOT NULL
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
          $1,
          summary_date,
          currency,
          SUM(sent_amount_minor),
          SUM(received_amount_minor),
          SUM(funded_amount_minor),
          SUM(sent_count)::INTEGER,
          SUM(received_count)::INTEGER,
          SUM(funding_count)::INTEGER,
          SUM(failed_transfer_count)::INTEGER,
          NOW(),
          NOW()
        FROM activity
        GROUP BY summary_date, currency
      `,
      [walletId],
    );
    await client.query(
      "DELETE FROM wallet_counterparty_daily_summaries WHERE wallet_id = $1",
      [walletId],
    );
    await client.query(
      `
        WITH activity AS (
          SELECT
            receiver_wallet_id AS counterparty_wallet_id,
            completed_at::DATE AS summary_date,
            currency,
            amount_minor AS sent_amount_minor,
            0::BIGINT AS received_amount_minor,
            1 AS sent_count,
            0 AS received_count,
            completed_at AS last_transfer_at
          FROM transfers
          WHERE sender_wallet_id = $1
            AND status = 'COMPLETED'
            AND completed_at IS NOT NULL
          UNION ALL
          SELECT
            sender_wallet_id,
            completed_at::DATE,
            currency,
            0::BIGINT,
            amount_minor,
            0,
            1,
            completed_at
          FROM transfers
          WHERE receiver_wallet_id = $1
            AND status = 'COMPLETED'
            AND completed_at IS NOT NULL
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
          $1,
          counterparty_wallet_id,
          summary_date,
          currency,
          SUM(sent_amount_minor),
          SUM(received_amount_minor),
          SUM(sent_count)::INTEGER,
          SUM(received_count)::INTEGER,
          MAX(last_transfer_at),
          NOW()
        FROM activity
        GROUP BY counterparty_wallet_id, summary_date, currency
      `,
      [walletId],
    );
  }
}
