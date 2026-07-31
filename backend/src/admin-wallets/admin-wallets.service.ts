import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { AdminWalletsQueryDto } from "./dto/admin-wallets-query.dto";
import { ReactivateWalletDto, WalletActionDto } from "./dto/wallet-action.dto";

type Role = "CUSTOMER" | "ADMIN";
type Context = { ipAddress?: string; userAgent?: string };
type ReconciliationStatus =
  | "MATCHED"
  | "MISMATCH"
  | "MISSING_LEDGER_ACCOUNT"
  | "CURRENCY_MISMATCH"
  | "UNBALANCED_TRANSACTION";
type ReconciliationRow = {
  wallet_id: string;
  wallet_currency: string;
  operational_balance_minor: string;
  ledger_account_id: string | null;
  account_currency: string | null;
  ledger_balance_minor: string;
  entry_currency_mismatch: boolean;
  unbalanced_transaction: boolean;
};

@Injectable()
export class AdminWalletsService {
  constructor(private readonly database: DatabaseService) {}

  async list(adminId: string, role: Role, query: AdminWalletsQueryDto) {
    await this.assertAdministrator(this.database, adminId, role);
    const cursor = this.decodeCursor(query.cursor);
    const search = query.search ?? "";
    const result = await this.database.query<{
      id: string;
      wallet_number: string;
      currency: string;
      balance_minor: string;
      status: string;
      created_at: Date;
      updated_at: Date;
      owner_id: string;
      owner_name: string;
      owner_email: string;
      owner_phone: string;
      owner_status: string;
    }>(
      `
        SELECT
          wallets.id, wallets.wallet_number, wallets.currency,
          wallets.balance_minor, wallets.status, wallets.created_at,
          wallets.updated_at, users.id AS owner_id,
          users.full_name AS owner_name, users.email AS owner_email,
          users.phone_number AS owner_phone, users.status AS owner_status
        FROM wallets
        JOIN users ON users.id = wallets.user_id
        WHERE (
          $2 = '' OR
          lower(wallets.wallet_number) = $2 OR
          wallets.id::TEXT = $2 OR
          users.id::TEXT = $2 OR
          users.email = $2 OR
          users.phone_number = $2
        )
          AND ($3::TEXT IS NULL OR wallets.status::TEXT = $3)
          AND ($4::TEXT IS NULL OR wallets.currency = $4)
          AND ($5::TIMESTAMPTZ IS NULL OR wallets.created_at >= $5)
          AND ($6::TIMESTAMPTZ IS NULL OR wallets.created_at <= $6)
          AND (
            $7::TIMESTAMPTZ IS NULL OR
            (wallets.created_at, wallets.id) < ($7::TIMESTAMPTZ, $8::UUID)
          )
        ORDER BY wallets.created_at DESC, wallets.id DESC
        LIMIT $1
      `,
      [
        query.limit + 1,
        search,
        query.status ?? null,
        query.currency ?? null,
        query.createdFrom ?? null,
        query.createdTo ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
      ],
    );
    const hasMore = result.rows.length > query.limit;
    const pageRows = result.rows.slice(0, query.limit);
    const reconciliations = await this.getReconciliations(
      pageRows.map((row) => row.id),
    );
    const reconciliationByWallet = new Map(
      reconciliations.map((item) => [item.walletId, item]),
    );
    const items = pageRows
      .map((row) => ({
        id: row.id,
        number: row.wallet_number,
        currency: row.currency,
        balanceMinor: row.balance_minor,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        owner: {
          id: row.owner_id,
          fullName: row.owner_name,
          email: row.owner_email,
          phoneNumber: row.owner_phone,
          status: row.owner_status,
        },
        reconciliation: reconciliationByWallet.get(row.id),
      }))
      .filter(
        (item) =>
          !query.mismatchOnly || item.reconciliation?.status !== "MATCHED",
      );
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ createdAt: last.created_at, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }

  async details(adminId: string, role: Role, walletId: string) {
    this.assertUuid(walletId, "wallet");
    await this.assertAdministrator(this.database, adminId, role);
    const walletResult = await this.database.query<{
      id: string;
      wallet_number: string;
      user_id: string;
      currency: string;
      balance_minor: string;
      status: string;
      created_at: Date;
      updated_at: Date;
      closed_at: Date | null;
      owner_name: string;
      owner_email: string;
      owner_phone: string;
      owner_status: string;
      owner_created_at: Date;
      ledger_account_id: string | null;
      account_code: string | null;
      account_currency: string | null;
      account_status: string | null;
    }>(
      `
        SELECT
          wallets.id, wallets.wallet_number, wallets.user_id,
          wallets.currency, wallets.balance_minor, wallets.status,
          wallets.created_at, wallets.updated_at, wallets.closed_at,
          users.full_name AS owner_name, users.email AS owner_email,
          users.phone_number AS owner_phone, users.status AS owner_status,
          users.created_at AS owner_created_at,
          accounts.id AS ledger_account_id, accounts.account_code,
          accounts.currency AS account_currency,
          accounts.status AS account_status
        FROM wallets
        JOIN users ON users.id = wallets.user_id
        LEFT JOIN ledger_accounts accounts
          ON accounts.wallet_id = wallets.id
         AND accounts.account_type = 'USER_WALLET'
        WHERE wallets.id = $1
      `,
      [walletId],
    );
    const wallet = walletResult.rows[0];
    if (!wallet) throw this.notFound();

    const [transferResult, fundingResult, historyResult, reconciliationResult] =
      await Promise.all([
        this.database.query<{
          id: string;
          transfer_reference: string;
          direction: string;
          counterparty_name: string;
          amount_minor: string;
          currency: string;
          status: string;
          initiated_at: Date;
        }>(
          `
            SELECT
              transfers.id, transfers.transfer_reference,
              CASE WHEN transfers.sender_wallet_id = $1
                THEN 'SENT' ELSE 'RECEIVED' END AS direction,
              CASE WHEN transfers.sender_wallet_id = $1
                THEN receiver.full_name ELSE sender.full_name
              END AS counterparty_name,
              transfers.amount_minor, transfers.currency, transfers.status,
              transfers.initiated_at
            FROM transfers
            JOIN wallets sender_wallet
              ON sender_wallet.id = transfers.sender_wallet_id
            JOIN users sender ON sender.id = sender_wallet.user_id
            JOIN wallets receiver_wallet
              ON receiver_wallet.id = transfers.receiver_wallet_id
            JOIN users receiver ON receiver.id = receiver_wallet.user_id
            WHERE transfers.sender_wallet_id = $1
               OR transfers.receiver_wallet_id = $1
            ORDER BY transfers.initiated_at DESC
            LIMIT 12
          `,
          [walletId],
        ),
        this.database.query<{
          id: string;
          amount_minor: string;
          currency: string;
          status: string;
          source_type: string;
          initiated_at: Date;
          completed_at: Date | null;
        }>(
          `
            SELECT id, amount_minor, currency, status, source_type,
                   initiated_at, completed_at
            FROM funding_transactions
            WHERE wallet_id = $1
            ORDER BY initiated_at DESC
            LIMIT 10
          `,
          [walletId],
        ),
        this.database.query<{
          id: string;
          previous_status: string;
          new_status: string;
          reason_code: string;
          reason: string;
          admin_name: string;
          occurred_at: Date;
        }>(
          `
            SELECT history.id, history.previous_status, history.new_status,
                   history.reason_code, history.reason,
                   admin.full_name AS admin_name, history.occurred_at
            FROM wallet_status_history history
            JOIN users admin ON admin.id = history.changed_by_user_id
            WHERE history.wallet_id = $1
            ORDER BY history.occurred_at DESC
            LIMIT 12
          `,
          [walletId],
        ),
        this.getReconciliations([walletId]),
      ]);

    const ledgerEntries = wallet.ledger_account_id
      ? await this.database.query<{
          id: string;
          ledger_transaction_id: string;
          transaction_type: string;
          reference_id: string;
          reversal_of_id: string | null;
          entry_type: string;
          amount_minor: string;
          currency: string;
          account_balance_after_minor: string | null;
          posted_at: Date;
        }>(
          `
            SELECT entries.id, entries.ledger_transaction_id,
                   transactions.transaction_type, transactions.reference_id,
                   transactions.reversal_of_id, entries.entry_type,
                   entries.amount_minor, entries.currency,
                   entries.account_balance_after_minor,
                   transactions.posted_at
            FROM ledger_entries entries
            JOIN ledger_transactions transactions
              ON transactions.id = entries.ledger_transaction_id
            WHERE entries.ledger_account_id = $1
            ORDER BY transactions.posted_at DESC, entries.id DESC
            LIMIT 100
          `,
          [wallet.ledger_account_id],
        )
      : { rows: [] };

    return {
      wallet: {
        id: wallet.id,
        number: wallet.wallet_number,
        currency: wallet.currency,
        balanceMinor: wallet.balance_minor,
        status: wallet.status,
        createdAt: wallet.created_at,
        updatedAt: wallet.updated_at,
        closedAt: wallet.closed_at,
      },
      owner: {
        id: wallet.user_id,
        fullName: wallet.owner_name,
        email: wallet.owner_email,
        phoneNumber: wallet.owner_phone,
        status: wallet.owner_status,
        registeredAt: wallet.owner_created_at,
      },
      ledgerAccount: wallet.ledger_account_id
        ? {
            id: wallet.ledger_account_id,
            code: wallet.account_code,
            currency: wallet.account_currency,
            status: wallet.account_status,
          }
        : null,
      reconciliation: reconciliationResult[0],
      recentTransfers: transferResult.rows.map((row) => ({
        id: row.id,
        reference: row.transfer_reference,
        direction: row.direction,
        counterpartyName: row.counterparty_name,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: row.status,
        occurredAt: row.initiated_at,
      })),
      recentFunding: fundingResult.rows.map((row) => ({
        id: row.id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: row.status,
        sourceType: row.source_type,
        occurredAt: row.initiated_at,
        completedAt: row.completed_at,
      })),
      ledgerEntries: ledgerEntries.rows.map((row) => ({
        id: row.id,
        ledgerTransactionId: row.ledger_transaction_id,
        transactionType: row.transaction_type,
        referenceId: row.reference_id,
        reversalOfId: row.reversal_of_id,
        entryType: row.entry_type,
        amountMinor: row.amount_minor,
        currency: row.currency,
        balanceAfterMinor: row.account_balance_after_minor,
        postedAt: row.posted_at,
      })),
      statusHistory: historyResult.rows.map((row) => ({
        id: row.id,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        reasonCode: row.reason_code,
        reason: row.reason,
        changedBy: row.admin_name,
        occurredAt: row.occurred_at,
      })),
    };
  }

  suspend(
    adminId: string,
    role: Role,
    walletId: string,
    dto: WalletActionDto,
    context: Context,
  ) {
    return this.changeStatus(
      adminId,
      role,
      walletId,
      "ACTIVE",
      "SUSPENDED",
      dto.reasonCode,
      dto.reason,
      "WALLET_SUSPENDED",
      "wallet.suspended",
      context,
    );
  }

  reactivate(
    adminId: string,
    role: Role,
    walletId: string,
    dto: ReactivateWalletDto,
    context: Context,
  ) {
    return this.changeStatus(
      adminId,
      role,
      walletId,
      "SUSPENDED",
      "ACTIVE",
      "REACTIVATED_AFTER_REVIEW",
      dto.reason,
      "WALLET_REACTIVATED",
      "wallet.reactivated",
      context,
    );
  }

  private async getReconciliations(walletIds: string[]) {
    if (walletIds.length === 0) return [];
    const result = await this.database.query<ReconciliationRow>(
      `
        SELECT
          wallets.id AS wallet_id,
          wallets.currency AS wallet_currency,
          wallets.balance_minor AS operational_balance_minor,
          accounts.id AS ledger_account_id,
          accounts.currency AS account_currency,
          COALESCE(SUM(
            CASE entries.entry_type
              WHEN 'CREDIT' THEN entries.amount_minor
              WHEN 'DEBIT' THEN -entries.amount_minor
            END
          ), 0)::TEXT AS ledger_balance_minor,
          COALESCE(BOOL_OR(entries.currency <> wallets.currency), FALSE)
            AS entry_currency_mismatch,
          CASE WHEN accounts.id IS NULL THEN FALSE ELSE EXISTS (
            SELECT 1
            FROM ledger_transactions related_transaction
            WHERE EXISTS (
              SELECT 1 FROM ledger_entries wallet_entry
              WHERE wallet_entry.ledger_transaction_id = related_transaction.id
                AND wallet_entry.ledger_account_id = accounts.id
            )
            AND (
              SELECT COALESCE(SUM(CASE WHEN all_entries.entry_type = 'DEBIT'
                THEN all_entries.amount_minor ELSE 0 END), 0)
              FROM ledger_entries all_entries
              WHERE all_entries.ledger_transaction_id = related_transaction.id
            ) <> (
              SELECT COALESCE(SUM(CASE WHEN all_entries.entry_type = 'CREDIT'
                THEN all_entries.amount_minor ELSE 0 END), 0)
              FROM ledger_entries all_entries
              WHERE all_entries.ledger_transaction_id = related_transaction.id
            )
          ) END AS unbalanced_transaction
        FROM wallets
        LEFT JOIN ledger_accounts accounts
          ON accounts.wallet_id = wallets.id
         AND accounts.account_type = 'USER_WALLET'
        LEFT JOIN ledger_entries entries
          ON entries.ledger_account_id = accounts.id
        WHERE wallets.id = ANY($1::UUID[])
        GROUP BY wallets.id, wallets.currency, wallets.balance_minor,
                 accounts.id, accounts.currency
      `,
      [walletIds],
    );
    return result.rows.map((row) => {
      const status: ReconciliationStatus = !row.ledger_account_id
        ? "MISSING_LEDGER_ACCOUNT"
        : row.account_currency !== row.wallet_currency ||
            row.entry_currency_mismatch
          ? "CURRENCY_MISMATCH"
          : row.unbalanced_transaction
            ? "UNBALANCED_TRANSACTION"
            : row.operational_balance_minor !== row.ledger_balance_minor
              ? "MISMATCH"
              : "MATCHED";
      return {
        walletId: row.wallet_id,
        status,
        operationalBalanceMinor: row.operational_balance_minor,
        ledgerBalanceMinor: row.ledger_account_id
          ? row.ledger_balance_minor
          : null,
        differenceMinor: row.ledger_account_id
          ? (
              BigInt(row.operational_balance_minor) -
              BigInt(row.ledger_balance_minor)
            ).toString()
          : null,
        currency: row.wallet_currency,
        ledgerAccountId: row.ledger_account_id,
        currencyMismatch:
          row.account_currency !== row.wallet_currency ||
          row.entry_currency_mismatch,
        unbalancedTransaction: row.unbalanced_transaction,
      };
    });
  }

  private async changeStatus(
    adminId: string,
    role: Role,
    walletId: string,
    expectedStatus: string,
    nextStatus: string,
    reasonCode: string,
    reason: string,
    auditAction: string,
    jobType: string,
    context: Context,
  ) {
    this.assertUuid(walletId, "wallet");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const adminReference = await this.assertAdministrator(client, adminId, role);
      const walletResult = await client.query<{
        id: string;
        status: string;
        user_id: string;
      }>(
        "SELECT id, status, user_id FROM wallets WHERE id = $1 FOR UPDATE",
        [walletId],
      );
      const wallet = walletResult.rows[0];
      if (!wallet) throw this.notFound();
      if (wallet.status === "CLOSED") {
        throw new ConflictException("A closed wallet cannot be reopened or suspended.");
      }
      if (wallet.status !== expectedStatus) {
        throw new ConflictException(
          `Wallet cannot transition from ${wallet.status} to ${nextStatus}.`,
        );
      }
      await client.query(
        "UPDATE wallets SET status = $2::wallet_status, updated_at = NOW() WHERE id = $1",
        [walletId, nextStatus],
      );
      await client.query(
        `
          INSERT INTO wallet_status_history (
            id, wallet_id, previous_status, new_status, reason_code,
            reason, changed_by_user_id
          )
          VALUES (
            $1, $2, $3::wallet_status, $4::wallet_status,
            $5::wallet_status_reason, $6, $7
          )
        `,
        [
          randomUUID(),
          walletId,
          wallet.status,
          nextStatus,
          reasonCode,
          reason,
          adminId,
        ],
      );
      const auditId = randomUUID();
      await client.query(
        `
          INSERT INTO audit_records (
            id, deduplication_key, actor_type, actor_user_id,
            actor_reference, action_type, resource_type, resource_id,
            outcome, severity, reason_code, source_type, ip_address,
            user_agent, metadata, occurred_at
          )
          VALUES (
            $1, $2, 'ADMIN', $3, $4, $5, 'WALLET', $6,
            'SUCCESS', 'WARNING', $7, 'ADMIN_API', $8, $9, $10::JSONB, NOW()
          )
        `,
        [
          auditId,
          `admin-wallet-action:${auditId}`,
          adminId,
          adminReference,
          auditAction,
          walletId,
          reasonCode,
          context.ipAddress ?? null,
          context.userAgent?.slice(0, 500) ?? null,
          JSON.stringify({
            previousStatus: wallet.status,
            newStatus: nextStatus,
            reason,
            ownerUserId: wallet.user_id,
          }),
        ],
      );
      await client.query(
        `
          INSERT INTO background_jobs (
            id, job_type, resource_type, resource_id, payload
          )
          VALUES ($1, $2, 'WALLET', $3, $4::JSONB)
        `,
        [
          randomUUID(),
          jobType,
          walletId,
          JSON.stringify({
            walletId,
            userId: wallet.user_id,
            previousStatus: wallet.status,
            newStatus: nextStatus,
          }),
        ],
      );
      await client.query("COMMIT");
      return {
        message:
          nextStatus === "SUSPENDED"
            ? "Wallet suspended. Its balance and owner account were not changed."
            : "Wallet reactivated. Its owner account state was not changed.",
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertAdministrator(
    database: DatabaseService | PoolClient,
    adminId: string,
    role: Role,
  ) {
    if (role !== "ADMIN") throw this.forbidden();
    type AdminRow = { id: string; role: string; status: string };
    const statement = "SELECT id, role, status FROM users WHERE id = $1";
    const result =
      database instanceof DatabaseService
        ? await database.query<AdminRow>(statement, [adminId])
        : await database.query<AdminRow>(statement, [adminId]);
    const admin = result.rows[0];
    if (!admin || admin.role !== "ADMIN" || admin.status !== "ACTIVE") {
      throw this.forbidden();
    }
    return `admin:${admin.id}`;
  }

  private decodeCursor(value?: string) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      ) as { createdAt?: string; id?: string };
      if (
        !parsed.createdAt ||
        Number.isNaN(new Date(parsed.createdAt).getTime()) ||
        !parsed.id
      ) throw new Error();
      this.assertUuid(parsed.id, "cursor");
      return parsed as { createdAt: string; id: string };
    } catch {
      throw new BadRequestException("Invalid pagination cursor.");
    }
  }

  private assertUuid(value: string, label: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) throw new BadRequestException(`Invalid ${label} identifier.`);
  }

  private forbidden() {
    return new ForbiddenException({
      code: "ADMIN_ACCESS_REQUIRED",
      message: "An active administrator account is required.",
    });
  }

  private notFound() {
    return new NotFoundException("Wallet was not found.");
  }
}
