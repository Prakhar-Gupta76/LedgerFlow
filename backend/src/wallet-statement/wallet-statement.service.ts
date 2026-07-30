import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { StatementQueryDto } from "./dto/statement-query.dto";

type WalletAccountRow = {
  wallet_id: string;
  wallet_number: string;
  currency: string;
  wallet_status: string;
  wallet_balance_minor: string;
  wallet_created_at: Date;
  ledger_account_id: string;
};

type StatementEntryRow = {
  ledger_entry_id: string;
  transaction_type: string;
  reference_id: string;
  customer_reference: string;
  entry_type: "DEBIT" | "CREDIT";
  amount_minor: string;
  signed_amount_minor: string;
  balance_after_minor: string;
  currency: string;
  description: string;
  posted_at: Date;
};

type SummaryRow = {
  debit_total_minor: string;
  credit_total_minor: string;
  entry_count: string;
  closing_balance_minor: string | null;
};

type CursorPayload = {
  postedAt: string;
  ledgerEntryId: string;
};

@Injectable()
export class WalletStatementService {
  private readonly logger = new Logger(WalletStatementService.name);

  constructor(private readonly database: DatabaseService) {}

  async getStatement(userId: string, query: StatementQueryDto) {
    const period = this.resolvePeriod(query);
    const account = await this.getWalletAccount(userId);
    await this.assertReconciled(account);
    const openingBalanceMinor = await this.getOpeningBalance(
      account.wallet_id,
      period.dateFrom,
    );
    const filter = this.buildPeriodFilter(
      account.wallet_id,
      period,
      query.cursor,
    );
    const summaryFilter = this.buildPeriodFilter(account.wallet_id, period);
    const limit = query.limit ?? 25;

    const [entriesResult, summaryResult] = await Promise.all([
      this.database.query<StatementEntryRow>(
        `
          SELECT
            ledger_entry_id,
            transaction_type,
            reference_id,
            customer_reference,
            entry_type,
            amount_minor,
            signed_amount_minor,
            balance_after_minor,
            currency,
            description,
            posted_at
          FROM wallet_statement_entries
          WHERE ${filter.sql}
          ORDER BY posted_at ASC, ledger_entry_id ASC
          LIMIT $${filter.values.length + 1}
        `,
        [...filter.values, limit + 1],
      ),
      this.database.query<SummaryRow>(
        `
          SELECT
            COALESCE(SUM(amount_minor) FILTER (
              WHERE entry_type = 'DEBIT'
            ), 0)::TEXT AS debit_total_minor,
            COALESCE(SUM(amount_minor) FILTER (
              WHERE entry_type = 'CREDIT'
            ), 0)::TEXT AS credit_total_minor,
            COUNT(*)::TEXT AS entry_count,
            (
              ARRAY_AGG(
                balance_after_minor
                ORDER BY posted_at DESC, ledger_entry_id DESC
              )
            )[1]::TEXT AS closing_balance_minor
          FROM wallet_statement_entries
          WHERE ${summaryFilter.sql}
        `,
        summaryFilter.values,
      ),
    ]);

    const hasMore = entriesResult.rows.length > limit;
    const rows = hasMore
      ? entriesResult.rows.slice(0, limit)
      : entriesResult.rows;
    const last = rows[rows.length - 1];
    const summary = summaryResult.rows[0];

    return {
      wallet: {
        walletNumber: account.wallet_number,
        currency: account.currency.trim(),
        status: account.wallet_status,
      },
      period,
      balances: {
        openingBalanceMinor,
        closingBalanceMinor:
          summary.closing_balance_minor ?? openingBalanceMinor,
        currentBalanceMinor: account.wallet_balance_minor,
      },
      summary: {
        debitTotalMinor: summary.debit_total_minor,
        creditTotalMinor: summary.credit_total_minor,
        entryCount: Number(summary.entry_count),
      },
      entries: rows.map((row) => this.mapEntry(row)),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              postedAt: last.posted_at.toISOString(),
              ledgerEntryId: last.ledger_entry_id,
            })
          : null,
      exportFormats: ["CSV", "PRINT"],
    };
  }

  async exportCsv(userId: string, query: StatementQueryDto) {
    const period = this.resolvePeriod(query);
    const account = await this.getWalletAccount(userId);
    await this.assertReconciled(account);
    const filter = this.buildPeriodFilter(account.wallet_id, period);
    const openingBalanceMinor = await this.getOpeningBalance(
      account.wallet_id,
      period.dateFrom,
    );
    const result = await this.database.query<StatementEntryRow>(
      `
        SELECT
          ledger_entry_id,
          transaction_type,
          reference_id,
          customer_reference,
          entry_type,
          amount_minor,
          signed_amount_minor,
          balance_after_minor,
          currency,
          description,
          posted_at
        FROM wallet_statement_entries
        WHERE ${filter.sql}
        ORDER BY posted_at ASC, ledger_entry_id ASC
        LIMIT 10000
      `,
      filter.values,
    );
    const header = [
      "Date",
      "Description",
      "Reference",
      "Type",
      "Debit (minor)",
      "Credit (minor)",
      "Balance (minor)",
      "Currency",
    ];
    const lines = result.rows.map((row) =>
      [
        row.posted_at.toISOString(),
        row.description,
        row.customer_reference,
        row.transaction_type,
        row.entry_type === "DEBIT" ? row.amount_minor : "",
        row.entry_type === "CREDIT" ? row.amount_minor : "",
        row.balance_after_minor,
        row.currency.trim(),
      ]
        .map((value) => this.csvCell(String(value)))
        .join(","),
    );
    lines.unshift(
      [
        period.dateFrom,
        "Opening balance",
        "",
        "OPENING_BALANCE",
        "",
        "",
        openingBalanceMinor,
        account.currency.trim(),
      ]
        .map((value) => this.csvCell(String(value)))
        .join(","),
    );
    return { csv: [header.join(","), ...lines].join("\r\n"), period };
  }

  private async getWalletAccount(userId: string) {
    const result = await this.database.query<WalletAccountRow>(
      `
        SELECT
          w.id AS wallet_id,
          w.wallet_number,
          w.currency,
          w.status AS wallet_status,
          w.balance_minor AS wallet_balance_minor,
          w.created_at AS wallet_created_at,
          la.id AS ledger_account_id
        FROM wallets w
        JOIN ledger_accounts la
          ON la.wallet_id = w.id
          AND la.account_type = 'USER_WALLET'
        WHERE w.user_id = $1
          AND w.currency = 'INR'
      `,
      [userId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException({
        code: "WALLET_STATEMENT_NOT_FOUND",
        message: "Your wallet statement could not be found.",
      });
    }
    return result.rows[0];
  }

  private async assertReconciled(account: WalletAccountRow) {
    const result = await this.database.query<{ calculated_balance: string }>(
      `
        SELECT COALESCE(SUM(
          CASE
            WHEN entry_type = 'CREDIT' THEN amount_minor
            ELSE -amount_minor
          END
        ), 0)::TEXT AS calculated_balance
        FROM ledger_entries
        WHERE ledger_account_id = $1
      `,
      [account.ledger_account_id],
    );
    if (result.rows[0].calculated_balance !== account.wallet_balance_minor) {
      this.logger.error(
        `Wallet reconciliation failed for wallet ${account.wallet_id}.`,
      );
      throw new ServiceUnavailableException({
        code: "STATEMENT_TEMPORARILY_UNAVAILABLE",
        message:
          "Your statement is temporarily unavailable while we verify the wallet balance.",
      });
    }
  }

  private async getOpeningBalance(walletId: string, dateFrom: string) {
    const result = await this.database.query<{ balance_after_minor: string }>(
      `
        SELECT balance_after_minor
        FROM wallet_statement_entries
        WHERE wallet_id = $1
          AND posted_at < $2::DATE
        ORDER BY posted_at DESC, ledger_entry_id DESC
        LIMIT 1
      `,
      [walletId, dateFrom],
    );
    return result.rows[0]?.balance_after_minor ?? "0";
  }

  private buildPeriodFilter(
    walletId: string,
    period: { dateFrom: string; dateTo: string },
    cursorValue?: string,
  ) {
    const values: unknown[] = [walletId, period.dateFrom, period.dateTo];
    const conditions = [
      "wallet_id = $1",
      "posted_at >= $2::DATE",
      "posted_at < ($3::DATE + INTERVAL '1 day')",
    ];
    if (cursorValue) {
      const cursor = this.decodeCursor(cursorValue);
      values.push(cursor.postedAt, cursor.ledgerEntryId);
      conditions.push(
        `(posted_at, ledger_entry_id) > ($4::TIMESTAMPTZ, $5::UUID)`,
      );
    }
    return { sql: conditions.join(" AND "), values };
  }

  private resolvePeriod(query: StatementQueryDto) {
    const now = new Date();
    const defaultFrom = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, "0")}-01`;
    const defaultTo = now.toISOString().slice(0, 10);
    const dateFrom = query.dateFrom ?? defaultFrom;
    const dateTo = query.dateTo ?? defaultTo;
    if (new Date(dateFrom) > new Date(dateTo)) {
      throw new BadRequestException({
        code: "INVALID_DATE_RANGE",
        message: "The statement start date must be before the end date.",
      });
    }
    return { dateFrom, dateTo };
  }

  private mapEntry(row: StatementEntryRow) {
    return {
      id: row.ledger_entry_id,
      transactionType: row.transaction_type,
      sourceId: row.reference_id,
      customerReference: row.customer_reference,
      entryType: row.entry_type,
      amountMinor: row.amount_minor,
      signedAmountMinor: row.signed_amount_minor,
      balanceAfterMinor: row.balance_after_minor,
      currency: row.currency.trim(),
      description: row.description,
      postedAt: row.posted_at.toISOString(),
      detailPath:
        row.transaction_type === "WALLET_TRANSFER"
          ? `/transactions/${row.reference_id}`
          : null,
    };
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
        !parsed.postedAt ||
        !parsed.ledgerEntryId ||
        Number.isNaN(Date.parse(parsed.postedAt)) ||
        !/^[0-9a-f-]{36}$/i.test(parsed.ledgerEntryId)
      ) {
        throw new Error("Invalid cursor");
      }
      return parsed as CursorPayload;
    } catch {
      throw new BadRequestException({
        code: "INVALID_CURSOR",
        message: "The statement cursor is invalid.",
      });
    }
  }

  private csvCell(value: string) {
    return `"${value.replaceAll('"', '""')}"`;
  }
}
