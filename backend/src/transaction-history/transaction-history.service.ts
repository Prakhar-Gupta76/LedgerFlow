import {
  BadRequestException,
  Injectable,
  Logger,
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

type TransferDetailsRow = {
  id: string;
  transfer_reference: string;
  sender_wallet_id: string;
  receiver_wallet_id: string;
  sender_user_id: string;
  receiver_user_id: string;
  sender_name: string;
  receiver_name: string;
  sender_wallet_number: string;
  receiver_wallet_number: string;
  amount_minor: string;
  currency: string;
  note: string | null;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  sender_balance_before_minor: string | null;
  sender_balance_after_minor: string | null;
  receiver_balance_before_minor: string | null;
  receiver_balance_after_minor: string | null;
  failure_code: string | null;
  initiated_at: Date;
  completed_at: Date | null;
  failed_at: Date | null;
  reversed_at: Date | null;
};

type LedgerDetailsRow = {
  posted_at: Date;
  entry_type: "DEBIT" | "CREDIT" | null;
  amount_minor: string | null;
  currency: string | null;
  reversal_posted_at: Date | null;
  reversal_entry_type: "DEBIT" | "CREDIT" | null;
  reversal_amount_minor: string | null;
  reversal_currency: string | null;
};

@Injectable()
export class TransactionHistoryService {
  private readonly logger = new Logger(TransactionHistoryService.name);

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

  async getDetails(userId: string, transactionId: string) {
    if (!this.isUuid(transactionId)) throw this.transactionNotFound();

    const result = await this.database.query<TransferDetailsRow>(
      `
        SELECT
          t.id,
          t.transfer_reference,
          t.sender_wallet_id,
          t.receiver_wallet_id,
          sender_wallet.user_id AS sender_user_id,
          receiver_wallet.user_id AS receiver_user_id,
          sender_user.full_name AS sender_name,
          receiver_user.full_name AS receiver_name,
          sender_wallet.wallet_number AS sender_wallet_number,
          receiver_wallet.wallet_number AS receiver_wallet_number,
          t.amount_minor,
          t.currency,
          t.note,
          t.status,
          t.sender_balance_before_minor,
          t.sender_balance_after_minor,
          t.receiver_balance_before_minor,
          t.receiver_balance_after_minor,
          t.failure_code,
          t.initiated_at,
          t.completed_at,
          t.failed_at,
          t.reversed_at
        FROM transfers t
        JOIN wallets sender_wallet ON sender_wallet.id = t.sender_wallet_id
        JOIN users sender_user ON sender_user.id = sender_wallet.user_id
        JOIN wallets receiver_wallet ON receiver_wallet.id = t.receiver_wallet_id
        JOIN users receiver_user ON receiver_user.id = receiver_wallet.user_id
        WHERE t.id = $1
          AND (
            sender_wallet.user_id = $2
            OR (
              receiver_wallet.user_id = $2
              AND t.status IN ('COMPLETED', 'REVERSED')
            )
          )
      `,
      [transactionId, userId],
    );
    const transfer = result.rows[0];
    if (!transfer) throw this.transactionNotFound();

    const direction =
      transfer.sender_user_id === userId ? ("SENT" as const) : ("RECEIVED" as const);
    const customerWalletId =
      direction === "SENT"
        ? transfer.sender_wallet_id
        : transfer.receiver_wallet_id;
    const expectedEntry = direction === "SENT" ? "DEBIT" : "CREDIT";
    const expectedReversalEntry = direction === "SENT" ? "CREDIT" : "DEBIT";
    const ledger = await this.readCustomerLedger(
      transfer.id,
      customerWalletId,
    );
    const originalLedgerValid =
      ledger?.entry_type === expectedEntry &&
      ledger.amount_minor === transfer.amount_minor &&
      ledger.currency?.trim() === transfer.currency.trim();
    const reversalLedgerValid =
      transfer.status !== "REVERSED" ||
      (originalLedgerValid &&
        ledger?.reversal_entry_type === expectedReversalEntry &&
        ledger.reversal_amount_minor === transfer.amount_minor &&
        ledger.reversal_currency?.trim() === transfer.currency.trim());

    if (
      (transfer.status === "COMPLETED" && !originalLedgerValid) ||
      (transfer.status === "REVERSED" && !reversalLedgerValid)
    ) {
      this.logger.error(
        `Ledger consistency check failed for transfer ${transfer.id} and wallet ${customerWalletId}.`,
      );
    }

    const signedEffect =
      direction === "SENT"
        ? `-${transfer.amount_minor}`
        : transfer.amount_minor;
    const balanceBeforeMinor =
      direction === "SENT"
        ? transfer.sender_balance_before_minor
        : transfer.receiver_balance_before_minor;
    const balanceAfterMinor =
      direction === "SENT"
        ? transfer.sender_balance_after_minor
        : transfer.receiver_balance_after_minor;
    const timeline = [
      {
        type: "INITIATED",
        label: "Transfer initiated",
        occurredAt: transfer.initiated_at.toISOString(),
      },
      ...(originalLedgerValid && ledger
        ? [
            {
              type: "LEDGER_POSTED",
              label: "Ledger entry posted",
              occurredAt: ledger.posted_at.toISOString(),
            },
          ]
        : []),
      ...(transfer.completed_at
        ? [
            {
              type: "COMPLETED",
              label: "Transfer completed",
              occurredAt: transfer.completed_at.toISOString(),
            },
          ]
        : []),
      ...(transfer.failed_at
        ? [
            {
              type: "FAILED",
              label: "Transfer unsuccessful",
              occurredAt: transfer.failed_at.toISOString(),
            },
          ]
        : []),
      ...(transfer.reversed_at
        ? [
            ...(reversalLedgerValid && ledger?.reversal_posted_at
              ? [
                  {
                    type: "REVERSAL_POSTED",
                    label: "Reversal ledger entry posted",
                    occurredAt: ledger.reversal_posted_at.toISOString(),
                  },
                ]
              : []),
            {
              type: "REVERSED",
              label: "Transfer reversed",
              occurredAt: transfer.reversed_at.toISOString(),
            },
          ]
        : []),
    ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

    return {
      id: transfer.id,
      transferReference: transfer.transfer_reference,
      status: transfer.status,
      direction,
      amountMinor: transfer.amount_minor,
      currency: transfer.currency.trim(),
      note: transfer.note,
      participants: {
        sender: {
          fullName: transfer.sender_name,
          maskedWalletNumber: this.maskWalletNumber(
            transfer.sender_wallet_number,
          ),
          isYou: direction === "SENT",
        },
        receiver: {
          fullName: transfer.receiver_name,
          maskedWalletNumber: this.maskWalletNumber(
            transfer.receiver_wallet_number,
          ),
          isYou: direction === "RECEIVED",
        },
      },
      balanceEffectMinor:
        transfer.status === "COMPLETED" ? signedEffect : "0",
      originalBalanceEffectMinor: signedEffect,
      balanceBeforeMinor,
      balanceAfterMinor,
      failureMessage:
        direction === "SENT" && transfer.status === "FAILED"
          ? this.safeFailure(transfer.failure_code)
          : null,
      initiatedAt: transfer.initiated_at.toISOString(),
      completedAt: transfer.completed_at?.toISOString() ?? null,
      failedAt: transfer.failed_at?.toISOString() ?? null,
      reversedAt: transfer.reversed_at?.toISOString() ?? null,
      timeline,
    };
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
      detailPath:
        row.source_type === "TRANSFER"
          ? `/transactions/${row.source_id}`
          : "/wallet/statement",
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

  private async readCustomerLedger(
    transferId: string,
    customerWalletId: string,
  ) {
    const result = await this.database.query<LedgerDetailsRow>(
      `
        SELECT
          original.posted_at,
          customer_entry.entry_type,
          customer_entry.amount_minor,
          customer_entry.currency,
          reversal.posted_at AS reversal_posted_at,
          reversal_entry.entry_type AS reversal_entry_type,
          reversal_entry.amount_minor AS reversal_amount_minor,
          reversal_entry.currency AS reversal_currency
        FROM ledger_transactions original
        LEFT JOIN ledger_accounts customer_account
          ON customer_account.wallet_id = $2
          AND customer_account.account_type = 'USER_WALLET'
          AND customer_account.status = 'ACTIVE'
        LEFT JOIN ledger_entries customer_entry
          ON customer_entry.ledger_transaction_id = original.id
          AND customer_entry.ledger_account_id = customer_account.id
        LEFT JOIN ledger_transactions reversal
          ON reversal.reversal_of_id = original.id
        LEFT JOIN ledger_entries reversal_entry
          ON reversal_entry.ledger_transaction_id = reversal.id
          AND reversal_entry.ledger_account_id = customer_account.id
        WHERE original.transaction_type = 'WALLET_TRANSFER'
          AND original.reference_id = $1
        LIMIT 1
      `,
      [transferId, customerWalletId],
    );
    return result.rows[0] ?? null;
  }

  private safeFailure(code: string | null) {
    const messages: Record<string, string> = {
      INSUFFICIENT_FUNDS:
        "You do not have enough balance for this transfer.",
      TRANSFER_LIMIT_EXCEEDED:
        "This transfer exceeds the permitted limit.",
      RECIPIENT_UNAVAILABLE:
        "The selected recipient cannot receive this transfer.",
      WALLET_UNAVAILABLE: "Your wallet is currently unavailable.",
      CURRENCY_MISMATCH:
        "The wallets do not support the same currency.",
      PROCESSING_ERROR:
        "The transfer could not be completed. Please try again later.",
    };
    return (
      messages[code ?? ""] ??
      "The transfer could not be completed. Please try again later."
    );
  }

  private maskWalletNumber(walletNumber: string) {
    return `•••• ${walletNumber.slice(-4)}`;
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private transactionNotFound() {
    return new NotFoundException({
      code: "TRANSACTION_NOT_FOUND",
      message: "Transaction not found.",
    });
  }
}
