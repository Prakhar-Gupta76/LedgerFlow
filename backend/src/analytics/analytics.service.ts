import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AnalyticsQueryDto } from "./dto/analytics-query.dto";

type WalletRow = {
  id: string;
  wallet_number: string;
  currency: string;
  status: string;
  created_at: Date;
};

type DailyRow = {
  summary_date: Date;
  sent_amount_minor: string;
  received_amount_minor: string;
  funded_amount_minor: string;
  sent_count: number;
  received_count: number;
  funding_count: number;
  failed_transfer_count: number;
  last_job_at: Date | null;
};

type CounterpartyRow = {
  wallet_id: string;
  full_name: string;
  wallet_number: string;
  sent_amount_minor: string;
  sent_count: string;
  last_transfer_at: Date | null;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly database: DatabaseService) {}

  async getAnalytics(userId: string, query: AnalyticsQueryDto) {
    const period = this.resolvePeriod(query);
    const wallet = await this.getWallet(userId);
    const [dailyResult, counterpartiesResult] = await Promise.all([
      this.database.query<DailyRow>(
        `
          SELECT
            day::DATE AS summary_date,
            COALESCE(summary.sent_amount_minor, 0)::TEXT AS sent_amount_minor,
            COALESCE(summary.received_amount_minor, 0)::TEXT AS received_amount_minor,
            COALESCE(summary.funded_amount_minor, 0)::TEXT AS funded_amount_minor,
            COALESCE(summary.sent_count, 0)::INTEGER AS sent_count,
            COALESCE(summary.received_count, 0)::INTEGER AS received_count,
            COALESCE(summary.funding_count, 0)::INTEGER AS funding_count,
            COALESCE(summary.failed_transfer_count, 0)::INTEGER
              AS failed_transfer_count,
            summary.last_job_at
          FROM generate_series(
            $2::DATE,
            $3::DATE,
            INTERVAL '1 day'
          ) day
          LEFT JOIN wallet_daily_summaries summary
            ON summary.wallet_id = $1
            AND summary.summary_date = day::DATE
            AND summary.currency = $4
          ORDER BY day ASC
        `,
        [wallet.id, period.dateFrom, period.dateTo, wallet.currency.trim()],
      ),
      this.database.query<CounterpartyRow>(
        `
          SELECT
            summary.counterparty_wallet_id AS wallet_id,
            counterparty_user.full_name,
            counterparty_wallet.wallet_number,
            SUM(summary.sent_amount_minor)::TEXT AS sent_amount_minor,
            SUM(summary.sent_count)::TEXT AS sent_count,
            MAX(summary.last_transfer_at) AS last_transfer_at
          FROM wallet_counterparty_daily_summaries summary
          JOIN wallets counterparty_wallet
            ON counterparty_wallet.id = summary.counterparty_wallet_id
          JOIN users counterparty_user
            ON counterparty_user.id = counterparty_wallet.user_id
          WHERE summary.wallet_id = $1
            AND summary.summary_date >= $2::DATE
            AND summary.summary_date <= $3::DATE
            AND summary.currency = $4
            AND summary.sent_count > 0
          GROUP BY
            summary.counterparty_wallet_id,
            counterparty_user.full_name,
            counterparty_wallet.wallet_number
          ORDER BY
            SUM(summary.sent_count) DESC,
            SUM(summary.sent_amount_minor) DESC,
            summary.counterparty_wallet_id
          LIMIT 5
        `,
        [wallet.id, period.dateFrom, period.dateTo, wallet.currency.trim()],
      ),
    ]);

    const totals = dailyResult.rows.reduce(
      (result, row) => ({
        sent: result.sent + BigInt(row.sent_amount_minor),
        received: result.received + BigInt(row.received_amount_minor),
        funded: result.funded + BigInt(row.funded_amount_minor),
        sentCount: result.sentCount + row.sent_count,
        receivedCount: result.receivedCount + row.received_count,
        fundingCount: result.fundingCount + row.funding_count,
        failedCount: result.failedCount + row.failed_transfer_count,
      }),
      {
        sent: 0n,
        received: 0n,
        funded: 0n,
        sentCount: 0,
        receivedCount: 0,
        fundingCount: 0,
        failedCount: 0,
      },
    );
    const updatedTimes = dailyResult.rows
      .map((row) => row.last_job_at)
      .filter((value): value is Date => value !== null);
    const lastUpdatedAt = updatedTimes.length
      ? new Date(Math.max(...updatedTimes.map((value) => value.getTime())))
      : null;
    const attempted = totals.sentCount + totals.failedCount;

    return {
      wallet: {
        walletNumber: wallet.wallet_number,
        currency: wallet.currency.trim(),
        status: wallet.status,
      },
      period,
      totals: {
        sentAmountMinor: totals.sent.toString(),
        receivedAmountMinor: totals.received.toString(),
        fundedAmountMinor: totals.funded.toString(),
        sentCount: totals.sentCount,
        receivedCount: totals.receivedCount,
        fundingCount: totals.fundingCount,
        failedTransferCount: totals.failedCount,
        averageSentAmountMinor:
          totals.sentCount > 0
            ? (totals.sent / BigInt(totals.sentCount)).toString()
            : "0",
        successRate:
          attempted > 0
            ? Number(((totals.sentCount / attempted) * 100).toFixed(1))
            : null,
      },
      chart: dailyResult.rows.map((row) => ({
        date: this.dateOnly(row.summary_date),
        sentAmountMinor: row.sent_amount_minor,
        receivedAmountMinor: row.received_amount_minor,
        fundedAmountMinor: row.funded_amount_minor,
        sentCount: row.sent_count,
        receivedCount: row.received_count,
        fundingCount: row.funding_count,
        failedTransferCount: row.failed_transfer_count,
      })),
      frequentRecipients: counterpartiesResult.rows.map((row) => ({
        walletId: row.wallet_id,
        fullName: row.full_name,
        maskedWalletNumber: `•••• ${row.wallet_number.slice(-4)}`,
        sentAmountMinor: row.sent_amount_minor,
        sentCount: Number(row.sent_count),
        lastTransferAt: row.last_transfer_at?.toISOString() ?? null,
      })),
      freshness: {
        lastUpdatedAt: lastUpdatedAt?.toISOString() ?? null,
        isStale:
          lastUpdatedAt === null ||
          Date.now() - lastUpdatedAt.getTime() > 10 * 60 * 1000,
      },
      disclaimer:
        "Analytics is informational and is not the source of your wallet balance.",
    };
  }

  private async getWallet(userId: string) {
    const result = await this.database.query<WalletRow>(
      `
        SELECT id, wallet_number, currency, status, created_at
        FROM wallets
        WHERE user_id = $1 AND currency = 'INR'
      `,
      [userId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException({
        code: "ANALYTICS_NOT_FOUND",
        message: "Analytics is unavailable for this wallet.",
      });
    }
    return result.rows[0];
  }

  private resolvePeriod(query: AnalyticsQueryDto) {
    const now = new Date();
    const defaultTo = now.toISOString().slice(0, 10);
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 29);
    const dateFrom = query.dateFrom ?? from.toISOString().slice(0, 10);
    const dateTo = query.dateTo ?? defaultTo;
    const start = new Date(`${dateFrom}T00:00:00Z`);
    const end = new Date(`${dateTo}T00:00:00Z`);
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
    if (days < 0) {
      throw new BadRequestException({
        code: "INVALID_ANALYTICS_RANGE",
        message: "The analytics start date must be before the end date.",
      });
    }
    if (days > 365) {
      throw new BadRequestException({
        code: "ANALYTICS_RANGE_TOO_LARGE",
        message: "Analytics can cover a maximum of 366 days.",
      });
    }
    return { dateFrom, dateTo };
  }

  private dateOnly(value: Date | string) {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }
}
