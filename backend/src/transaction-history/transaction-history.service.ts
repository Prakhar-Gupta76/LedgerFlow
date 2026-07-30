import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { HistoryQueryDto } from "./dto/history-query.dto";

type WalletRow = {
  id: string;
  wallet_number: string;
  currency: string;
  status: string;
};

type ActivityRow = {
  activity_key: string;
  source_type: "TRANSFER" | "FUNDING";
  source_id: string;
  reference: string;
  activity_type:
    | "TRANSFER_SENT"
    | "TRANSFER_RECEIVED"
    | "FUNDS_ADDED"
    | "TRANSFER_REVERSED";
  direction: "DEBIT" | "CREDIT";
  amount_minor: string;
  currency: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  note: string | null;
  failure_code: string | null;
  occurred_at: Date;
  completed_at: Date | null;
  counterparty_name: string | null;
};

type TotalsRow = {
  sent_amount_minor: string;
  received_amount_minor: string;
  funded_amount_minor: string;
  activity_count: string;
  failed_count: string;
};

type CursorPayload = {
  occurredAt: string;
  sourceType: string;
  sourceId: string;
  activityType: string;
  activityKey: string;
};

@Injectable()
export class TransactionHistoryService {
  constructor(private readonly database: DatabaseService) {}

  async getHistory(userId: string, query: HistoryQueryDto) {
    this.validateRange(query);
    const wallet = await this.getWallet(userId);
    const listFilter = this.buildFilter(wallet.id, query, true);
    const totalsFilter = this.buildFilter(wallet.id, query, false);
    const limit = query.limit ?? 20;

    const [itemsResult, totalsResult] = await Promise.all([
      this.database.query<ActivityRow>(
        `
          SELECT
            h.activity_key,
            h.source_type,
            h.source_id,
            h.reference,
            h.activity_type,
            h.direction,
            h.amount_minor,
            h.currency,
            h.status,
            h.note,
            h.failure_code,
            h.occurred_at,
            h.completed_at,
            counterparty_user.full_name AS counterparty_name
          FROM wallet_activity_history h
          LEFT JOIN wallets counterparty_wallet
            ON counterparty_wallet.id = h.counterparty_wallet_id
          LEFT JOIN users counterparty_user
            ON counterparty_user.id = counterparty_wallet.user_id
          WHERE ${listFilter.sql}
          ORDER BY h.occurred_at DESC, h.activity_key DESC
          LIMIT $${listFilter.values.length + 1}
        `,
        [...listFilter.values, limit + 1],
      ),
      this.database.query<TotalsRow>(
        `
          SELECT
            COALESCE(SUM(h.amount_minor) FILTER (
              WHERE h.activity_type = 'TRANSFER_SENT'
                AND h.direction = 'DEBIT'
                AND h.status = 'COMPLETED'
            ), 0)::TEXT AS sent_amount_minor,
            COALESCE(SUM(h.amount_minor) FILTER (
              WHERE h.activity_type = 'TRANSFER_RECEIVED'
                AND h.direction = 'CREDIT'
                AND h.status = 'COMPLETED'
            ), 0)::TEXT AS received_amount_minor,
            COALESCE(SUM(h.amount_minor) FILTER (
              WHERE h.activity_type = 'FUNDS_ADDED'
                AND h.status = 'COMPLETED'
            ), 0)::TEXT AS funded_amount_minor,
            COUNT(*)::TEXT AS activity_count,
            COUNT(*) FILTER (WHERE h.status = 'FAILED')::TEXT AS failed_count
          FROM wallet_activity_history h
          LEFT JOIN wallets counterparty_wallet
            ON counterparty_wallet.id = h.counterparty_wallet_id
          LEFT JOIN users counterparty_user
            ON counterparty_user.id = counterparty_wallet.user_id
          WHERE ${totalsFilter.sql}
        `,
        totalsFilter.values,
      ),
    ]);

    const hasMore = itemsResult.rows.length > limit;
    const rows = hasMore ? itemsResult.rows.slice(0, limit) : itemsResult.rows;
    const last = rows.at(-1);
    return {
      wallet: {
        walletNumber: wallet.wallet_number,
        currency: wallet.currency.trim(),
        status: wallet.status,
      },
      summary: {
        sentAmountMinor: totalsResult.rows[0].sent_amount_minor,
        receivedAmountMinor: totalsResult.rows[0].received_amount_minor,
        fundedAmountMinor: totalsResult.rows[0].funded_amount_minor,
        activityCount: Number(totalsResult.rows[0].activity_count),
        failedCount: Number(totalsResult.rows[0].failed_count),
      },
      items: rows.map((row) => this.mapActivity(row)),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              occurredAt: last.occurred_at.toISOString(),
              sourceType: last.source_type,
              sourceId: last.source_id,
              activityType: last.activity_type,
              activityKey: last.activity_key,
            })
          : null,
    };
  }

  async exportCsv(userId: string, query: HistoryQueryDto) {
    this.validateRange(query);
    const wallet = await this.getWallet(userId);
    const filter = this.buildFilter(wallet.id, query, false);
    const result = await this.database.query<ActivityRow>(
      `
        SELECT
          h.activity_key,
          h.source_type,
          h.source_id,
          h.reference,
          h.activity_type,
          h.direction,
          h.amount_minor,
          h.currency,
          h.status,
          h.note,
          h.failure_code,
          h.occurred_at,
          h.completed_at,
          counterparty_user.full_name AS counterparty_name
        FROM wallet_activity_history h
        LEFT JOIN wallets counterparty_wallet
          ON counterparty_wallet.id = h.counterparty_wallet_id
        LEFT JOIN users counterparty_user
          ON counterparty_user.id = counterparty_wallet.user_id
        WHERE ${filter.sql}
        ORDER BY h.occurred_at DESC, h.activity_key DESC
        LIMIT 5000
      `,
      filter.values,
    );
    const header = [
      "Date",
      "Reference",
      "Activity",
      "Direction",
      "Counterparty",
      "Amount (minor)",
      "Currency",
      "Status",
      "Note",
    ];
    const lines = result.rows.map((row) =>
      [
        row.occurred_at.toISOString(),
        row.reference,
        row.activity_type,
        row.direction,
        row.counterparty_name ?? "LedgerFlow",
        row.amount_minor,
        row.currency.trim(),
        row.status,
        row.note ?? "",
      ]
        .map((value) => this.csvCell(String(value)))
        .join(","),
    );
    return [header.join(","), ...lines].join("\r\n");
  }

  private async getWallet(userId: string) {
    const result = await this.database.query<WalletRow>(
      `
        SELECT id, wallet_number, currency, status
        FROM wallets
        WHERE user_id = $1 AND currency = 'INR'
      `,
      [userId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException({
        code: "WALLET_NOT_FOUND",
        message: "Your INR wallet could not be found.",
      });
    }
    return result.rows[0];
  }

  private buildFilter(
    walletId: string,
    query: HistoryQueryDto,
    includeCursor: boolean,
  ) {
    const conditions = ["h.wallet_id = $1"];
    const values: unknown[] = [walletId];
    const add = (condition: (position: number) => string, value: unknown) => {
      values.push(value);
      conditions.push(condition(values.length));
    };

    if (query.search) {
      add(
        (position) =>
          `(h.reference ILIKE $${position}
            OR COALESCE(h.note, '') ILIKE $${position}
            OR COALESCE(counterparty_user.full_name, '') ILIKE $${position})`,
        `%${query.search}%`,
      );
    }
    if (query.dateFrom) {
      add((position) => `h.occurred_at >= $${position}::DATE`, query.dateFrom);
    }
    if (query.dateTo) {
      add(
        (position) =>
          `h.occurred_at < ($${position}::DATE + INTERVAL '1 day')`,
        query.dateTo,
      );
    }
    if (query.activityType) {
      add((position) => `h.activity_type = $${position}`, query.activityType);
    }
    if (query.direction) {
      add((position) => `h.direction = $${position}`, query.direction);
    }
    if (query.status) {
      add((position) => `h.status = $${position}`, query.status);
    }
    if (query.minAmountMinor !== undefined) {
      add(
        (position) => `h.amount_minor >= $${position}`,
        query.minAmountMinor,
      );
    }
    if (query.maxAmountMinor !== undefined) {
      add(
        (position) => `h.amount_minor <= $${position}`,
        query.maxAmountMinor,
      );
    }
    if (includeCursor && query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      values.push(cursor.occurredAt, cursor.activityKey);
      conditions.push(
        `(h.occurred_at, h.activity_key) < ($${values.length - 1}::TIMESTAMPTZ, $${values.length})`,
      );
    }
    return { sql: conditions.join(" AND "), values };
  }

  private mapActivity(row: ActivityRow) {
    const failureMessages: Record<string, string> = {
      INSUFFICIENT_FUNDS: "Insufficient balance",
      TRANSFER_LIMIT_EXCEEDED: "Transfer limit exceeded",
      RECIPIENT_UNAVAILABLE: "Recipient unavailable",
      WALLET_UNAVAILABLE: "Wallet unavailable",
      CURRENCY_MISMATCH: "Currency mismatch",
      PROCESSING_ERROR: "Processing error",
    };
    return {
      activityKey: row.activity_key,
      sourceType: row.source_type,
      sourceId: row.source_id,
      reference: row.reference,
      activityType: row.activity_type,
      direction: row.direction,
      counterpartyName: row.counterparty_name ?? "LedgerFlow",
      amountMinor: row.amount_minor,
      currency: row.currency.trim(),
      status: row.status,
      note: row.note,
      failureMessage: row.failure_code
        ? failureMessages[row.failure_code] ?? "Transaction unsuccessful"
        : null,
      occurredAt: row.occurred_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
      detailPath: `/transactions/${row.source_id}`,
    };
  }

  private validateRange(query: HistoryQueryDto) {
    if (
      query.dateFrom &&
      query.dateTo &&
      new Date(query.dateFrom) > new Date(query.dateTo)
    ) {
      throw new BadRequestException({
        code: "INVALID_DATE_RANGE",
        message: "The start date must be before the end date.",
      });
    }
    if (
      query.minAmountMinor !== undefined &&
      query.maxAmountMinor !== undefined &&
      query.minAmountMinor > query.maxAmountMinor
    ) {
      throw new BadRequestException({
        code: "INVALID_AMOUNT_RANGE",
        message: "The minimum amount cannot exceed the maximum amount.",
      });
    }
  }

  private encodeCursor(cursor: CursorPayload) {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  private decodeCursor(value: string): CursorPayload {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      ) as Partial<CursorPayload>;
      if (
        !parsed.occurredAt ||
        !parsed.sourceType ||
        !parsed.sourceId ||
        !parsed.activityType ||
        !parsed.activityKey ||
        Number.isNaN(Date.parse(parsed.occurredAt))
      ) {
        throw new Error("Invalid cursor");
      }
      return parsed as CursorPayload;
    } catch {
      throw new BadRequestException({
        code: "INVALID_CURSOR",
        message: "The history cursor is invalid.",
      });
    }
  }

  private csvCell(value: string) {
    return `"${value.replaceAll('"', '""')}"`;
  }
}
