import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { AdminTransfersQueryDto } from "./dto/admin-transfers-query.dto";

type Role = "CUSTOMER" | "ADMIN";
type LedgerTransaction = {
  id: string;
  transaction_type: string;
  reference_id: string;
  description: string | null;
  reversal_of_id: string | null;
  posted_at: Date;
  created_at: Date;
};
type LedgerEntry = {
  id: string;
  ledger_transaction_id: string;
  ledger_account_id: string;
  entry_type: "DEBIT" | "CREDIT";
  amount_minor: string;
  currency: string;
  created_at: Date;
  account_code: string;
  account_type: string;
  wallet_id: string | null;
  account_name: string;
  account_currency: string;
  account_status: string;
};

@Injectable()
export class AdminTransfersService {
  constructor(private readonly database: DatabaseService) {}

  async list(adminId: string, role: Role, query: AdminTransfersQueryDto) {
    await this.assertAdministrator(this.database, adminId, role);
    if (
      query.amountMinMinor &&
      query.amountMaxMinor &&
      query.amountMinMinor > query.amountMaxMinor
    ) {
      throw new BadRequestException(
        "Minimum amount cannot exceed maximum amount.",
      );
    }
    const cursor = this.decodeCursor(query.cursor);
    const search = query.search?.trim() ?? "";
    const participant = query.participant?.trim() ?? "";
    const result = await this.database.query<{
      id: string;
      transfer_reference: string;
      amount_minor: string;
      currency: string;
      note: string | null;
      status: string;
      failure_code: string | null;
      initiated_at: Date;
      completed_at: Date | null;
      failed_at: Date | null;
      reversed_at: Date | null;
      created_at: Date;
      sender_wallet_id: string;
      sender_wallet_number: string;
      sender_wallet_status: string;
      sender_user_id: string;
      sender_name: string;
      sender_email: string;
      sender_status: string;
      receiver_wallet_id: string;
      receiver_wallet_number: string;
      receiver_wallet_status: string;
      receiver_user_id: string;
      receiver_name: string;
      receiver_email: string;
      receiver_status: string;
      initiator_user_id: string;
      initiator_name: string;
      job_health: string;
      job_count: string;
    }>(
      `
        SELECT
          transfers.id, transfers.transfer_reference, transfers.amount_minor,
          transfers.currency, transfers.note, transfers.status,
          transfers.failure_code, transfers.initiated_at,
          transfers.completed_at, transfers.failed_at, transfers.reversed_at,
          transfers.created_at,
          sender_wallet.id AS sender_wallet_id,
          sender_wallet.wallet_number AS sender_wallet_number,
          sender_wallet.status AS sender_wallet_status,
          sender.id AS sender_user_id, sender.full_name AS sender_name,
          sender.email AS sender_email, sender.status AS sender_status,
          receiver_wallet.id AS receiver_wallet_id,
          receiver_wallet.wallet_number AS receiver_wallet_number,
          receiver_wallet.status AS receiver_wallet_status,
          receiver.id AS receiver_user_id, receiver.full_name AS receiver_name,
          receiver.email AS receiver_email, receiver.status AS receiver_status,
          initiator.id AS initiator_user_id,
          initiator.full_name AS initiator_name,
          CASE
            WHEN jobs.job_count = 0 THEN 'MISSING'
            WHEN jobs.failed_count > 0 THEN 'FAILED'
            WHEN jobs.retrying_count > 0 THEN 'RETRYING'
            ELSE 'HEALTHY'
          END AS job_health,
          jobs.job_count::TEXT AS job_count
        FROM transfers
        JOIN wallets sender_wallet
          ON sender_wallet.id = transfers.sender_wallet_id
        JOIN users sender ON sender.id = sender_wallet.user_id
        JOIN wallets receiver_wallet
          ON receiver_wallet.id = transfers.receiver_wallet_id
        JOIN users receiver ON receiver.id = receiver_wallet.user_id
        JOIN users initiator ON initiator.id = transfers.initiated_by_user_id
        CROSS JOIN LATERAL (
          SELECT
            COUNT(*) AS job_count,
            COUNT(*) FILTER (WHERE status = 'FAILED') AS failed_count,
            COUNT(*) FILTER (
              WHERE attempt_count > 1 AND status <> 'COMPLETED'
            ) AS retrying_count
          FROM background_jobs
          WHERE resource_type = 'TRANSFER'
            AND resource_id = transfers.id
        ) jobs
        WHERE (
          $2 = '' OR transfers.id::TEXT = $2
          OR upper(transfers.transfer_reference) = upper($2)
        )
          AND (
            $3 = '' OR sender_wallet.id::TEXT = $3
            OR receiver_wallet.id::TEXT = $3
            OR upper(sender_wallet.wallet_number) = upper($3)
            OR upper(receiver_wallet.wallet_number) = upper($3)
            OR sender.id::TEXT = $3 OR receiver.id::TEXT = $3
          )
          AND ($4::UUID IS NULL OR transfers.initiated_by_user_id = $4)
          AND ($5::TEXT IS NULL OR transfers.status::TEXT = $5)
          AND ($6::TEXT IS NULL OR transfers.failure_code = $6)
          AND ($7::TEXT IS NULL OR transfers.currency = $7)
          AND ($8::BIGINT IS NULL OR transfers.amount_minor >= $8)
          AND ($9::BIGINT IS NULL OR transfers.amount_minor <= $9)
          AND ($10::TIMESTAMPTZ IS NULL OR transfers.initiated_at >= $10)
          AND ($11::TIMESTAMPTZ IS NULL OR transfers.initiated_at <= $11)
          AND ($12::TEXT IS NULL OR (
            CASE
              WHEN jobs.job_count = 0 THEN 'MISSING'
              WHEN jobs.failed_count > 0 THEN 'FAILED'
              WHEN jobs.retrying_count > 0 THEN 'RETRYING'
              ELSE 'HEALTHY'
            END
          ) = $12)
          AND (
            $13::TIMESTAMPTZ IS NULL OR
            (transfers.created_at, transfers.id) <
              ($13::TIMESTAMPTZ, $14::UUID)
          )
        ORDER BY transfers.created_at DESC, transfers.id DESC
        LIMIT $1
      `,
      [
        query.limit + 1,
        search,
        participant,
        query.initiatorUserId ?? null,
        query.status ?? null,
        query.failureCode ?? null,
        query.currency ?? null,
        query.amountMinMinor ?? null,
        query.amountMaxMinor ?? null,
        query.initiatedFrom ?? null,
        query.initiatedTo ?? null,
        query.jobHealth ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
      ],
    );
    const hasMore = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        id: row.id,
        reference: row.transfer_reference,
        amountMinor: row.amount_minor,
        currency: row.currency,
        note: row.note,
        status: row.status,
        failureCode: row.failure_code,
        initiatedAt: row.initiated_at,
        completedAt: row.completed_at,
        failedAt: row.failed_at,
        reversedAt: row.reversed_at,
        sender: {
          userId: row.sender_user_id,
          fullName: row.sender_name,
          maskedEmail: this.maskEmail(row.sender_email),
          userStatus: row.sender_status,
          walletId: row.sender_wallet_id,
          walletNumber: row.sender_wallet_number,
          walletStatus: row.sender_wallet_status,
        },
        receiver: {
          userId: row.receiver_user_id,
          fullName: row.receiver_name,
          maskedEmail: this.maskEmail(row.receiver_email),
          userStatus: row.receiver_status,
          walletId: row.receiver_wallet_id,
          walletNumber: row.receiver_wallet_number,
          walletStatus: row.receiver_wallet_status,
        },
        initiator: {
          userId: row.initiator_user_id,
          fullName: row.initiator_name,
        },
        jobs: { health: row.job_health, count: Number(row.job_count) },
      })),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ createdAt: last.created_at, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }

  async details(adminId: string, role: Role, transferId: string) {
    this.assertUuid(transferId, "transfer");
    await this.assertAdministrator(this.database, adminId, role);
    const transferResult = await this.database.query<{
      id: string;
      transfer_reference: string;
      sender_wallet_id: string;
      receiver_wallet_id: string;
      initiated_by_user_id: string;
      idempotency_key: string;
      amount_minor: string;
      currency: string;
      note: string | null;
      status: string;
      sender_balance_before_minor: string | null;
      sender_balance_after_minor: string | null;
      receiver_balance_before_minor: string | null;
      receiver_balance_after_minor: string | null;
      failure_code: string | null;
      initiated_at: Date;
      completed_at: Date | null;
      failed_at: Date | null;
      reversed_at: Date | null;
      created_at: Date;
      updated_at: Date;
      sender_wallet_number: string;
      sender_wallet_status: string;
      sender_user_id: string;
      sender_name: string;
      sender_email: string;
      sender_phone: string;
      sender_user_status: string;
      receiver_wallet_number: string;
      receiver_wallet_status: string;
      receiver_user_id: string;
      receiver_name: string;
      receiver_email: string;
      receiver_phone: string;
      receiver_user_status: string;
      initiator_name: string;
    }>(
      `
        SELECT
          transfers.*,
          sender_wallet.wallet_number AS sender_wallet_number,
          sender_wallet.status AS sender_wallet_status,
          sender.id AS sender_user_id, sender.full_name AS sender_name,
          sender.email AS sender_email, sender.phone_number AS sender_phone,
          sender.status AS sender_user_status,
          receiver_wallet.wallet_number AS receiver_wallet_number,
          receiver_wallet.status AS receiver_wallet_status,
          receiver.id AS receiver_user_id, receiver.full_name AS receiver_name,
          receiver.email AS receiver_email,
          receiver.phone_number AS receiver_phone,
          receiver.status AS receiver_user_status,
          initiator.full_name AS initiator_name
        FROM transfers
        JOIN wallets sender_wallet
          ON sender_wallet.id = transfers.sender_wallet_id
        JOIN users sender ON sender.id = sender_wallet.user_id
        JOIN wallets receiver_wallet
          ON receiver_wallet.id = transfers.receiver_wallet_id
        JOIN users receiver ON receiver.id = receiver_wallet.user_id
        JOIN users initiator ON initiator.id = transfers.initiated_by_user_id
        WHERE transfers.id = $1
      `,
      [transferId],
    );
    const transfer = transferResult.rows[0];
    if (!transfer) throw this.notFound();

    const [lifecycleResult, ledgerTransactionResult, jobResult, auditResult] =
      await Promise.all([
        this.database.query<{
          id: string;
          previous_status: string | null;
          new_status: string;
          transition_source: string;
          reason_code: string | null;
          actor_user_id: string | null;
          actor_name: string | null;
          source_job_id: string | null;
          occurred_at: Date;
        }>(
          `
            SELECT history.id, history.previous_status, history.new_status,
                   history.transition_source, history.reason_code,
                   history.actor_user_id, actor.full_name AS actor_name,
                   history.source_job_id, history.occurred_at
            FROM transfer_status_history history
            LEFT JOIN users actor ON actor.id = history.actor_user_id
            WHERE history.transfer_id = $1
            ORDER BY
              history.occurred_at,
              CASE WHEN history.previous_status IS NULL THEN 0 ELSE 1 END,
              history.id
          `,
          [transferId],
        ),
        this.database.query<LedgerTransaction>(
          `
            WITH original AS (
              SELECT id
              FROM ledger_transactions
              WHERE transaction_type = 'WALLET_TRANSFER'
                AND reference_id = $1
                AND reversal_of_id IS NULL
            )
            SELECT id, transaction_type, reference_id, description,
                   reversal_of_id, posted_at, created_at
            FROM ledger_transactions
            WHERE id IN (SELECT id FROM original)
               OR reversal_of_id IN (SELECT id FROM original)
            ORDER BY posted_at, id
          `,
          [transferId],
        ),
        this.database.query<{
          id: string;
          job_type: string;
          status: string;
          attempt_count: number;
          max_attempts: number;
          available_at: Date;
          last_attempt_at: Date | null;
          completed_at: Date | null;
          last_error_code: string | null;
          last_error_message: string | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `
            SELECT id, job_type, status, attempt_count, max_attempts,
                   available_at, last_attempt_at, completed_at,
                   last_error_code, last_error_message, created_at, updated_at
            FROM background_jobs
            WHERE resource_type = 'TRANSFER' AND resource_id = $1
            ORDER BY created_at, id
          `,
          [transferId],
        ),
        this.database.query<{
          id: string;
          actor_type: string;
          actor_name: string | null;
          actor_reference: string;
          action_type: string;
          outcome: string;
          severity: string;
          source_job_id: string | null;
          metadata: Record<string, unknown> | null;
          occurred_at: Date;
        }>(
          `
            SELECT audit.id, audit.actor_type, actor.full_name AS actor_name,
                   audit.actor_reference, audit.action_type, audit.outcome,
                   audit.severity, audit.source_job_id, audit.metadata,
                   audit.occurred_at
            FROM audit_records audit
            LEFT JOIN users actor ON actor.id = audit.actor_user_id
            WHERE (audit.resource_type = 'TRANSFER' AND audit.resource_id = $1)
               OR audit.source_job_id IN (
                 SELECT id FROM background_jobs
                 WHERE resource_type = 'TRANSFER' AND resource_id = $1
               )
            ORDER BY audit.occurred_at, audit.id
          `,
          [transferId],
        ),
      ]);
    const ledgerIds = ledgerTransactionResult.rows.map((row) => row.id);
    const ledgerEntryResult = ledgerIds.length
      ? await this.database.query<LedgerEntry>(
          `
            SELECT entries.id, entries.ledger_transaction_id,
                   entries.ledger_account_id, entries.entry_type,
                   entries.amount_minor, entries.currency, entries.created_at,
                   accounts.account_code, accounts.account_type,
                   accounts.wallet_id, accounts.name AS account_name,
                   accounts.currency AS account_currency,
                   accounts.status AS account_status
            FROM ledger_entries entries
            JOIN ledger_accounts accounts
              ON accounts.id = entries.ledger_account_id
            WHERE entries.ledger_transaction_id = ANY($1::UUID[])
            ORDER BY entries.created_at, entries.id
          `,
          [ledgerIds],
        )
      : { rows: [] as LedgerEntry[] };
    const indicators = this.integrityIndicators(
      transfer,
      lifecycleResult.rows,
      ledgerTransactionResult.rows,
      ledgerEntryResult.rows,
      jobResult.rows,
    );

    return {
      transfer: {
        id: transfer.id,
        reference: transfer.transfer_reference,
        idempotencyKey: transfer.idempotency_key,
        amountMinor: transfer.amount_minor,
        currency: transfer.currency,
        note: transfer.note,
        status: transfer.status,
        failureCode: transfer.failure_code,
        initiatedAt: transfer.initiated_at,
        completedAt: transfer.completed_at,
        failedAt: transfer.failed_at,
        reversedAt: transfer.reversed_at,
        createdAt: transfer.created_at,
        updatedAt: transfer.updated_at,
        senderBalanceBeforeMinor: transfer.sender_balance_before_minor,
        senderBalanceAfterMinor: transfer.sender_balance_after_minor,
        receiverBalanceBeforeMinor: transfer.receiver_balance_before_minor,
        receiverBalanceAfterMinor: transfer.receiver_balance_after_minor,
      },
      sender: {
        userId: transfer.sender_user_id,
        fullName: transfer.sender_name,
        maskedEmail: this.maskEmail(transfer.sender_email),
        maskedPhone: this.maskPhone(transfer.sender_phone),
        userStatus: transfer.sender_user_status,
        walletId: transfer.sender_wallet_id,
        walletNumber: transfer.sender_wallet_number,
        walletStatus: transfer.sender_wallet_status,
      },
      receiver: {
        userId: transfer.receiver_user_id,
        fullName: transfer.receiver_name,
        maskedEmail: this.maskEmail(transfer.receiver_email),
        maskedPhone: this.maskPhone(transfer.receiver_phone),
        userStatus: transfer.receiver_user_status,
        walletId: transfer.receiver_wallet_id,
        walletNumber: transfer.receiver_wallet_number,
        walletStatus: transfer.receiver_wallet_status,
      },
      initiator: {
        userId: transfer.initiated_by_user_id,
        fullName: transfer.initiator_name,
      },
      lifecycle: lifecycleResult.rows.map((row) => ({
        id: row.id,
        previousStatus: row.previous_status,
        newStatus: row.new_status,
        source: row.transition_source,
        reasonCode: row.reason_code,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        sourceJobId: row.source_job_id,
        occurredAt: row.occurred_at,
      })),
      ledgerTransactions: ledgerTransactionResult.rows.map((row) => ({
        id: row.id,
        type: row.transaction_type,
        referenceId: row.reference_id,
        description: row.description,
        reversalOfId: row.reversal_of_id,
        postedAt: row.posted_at,
      })),
      ledgerEntries: ledgerEntryResult.rows.map((row) => ({
        id: row.id,
        ledgerTransactionId: row.ledger_transaction_id,
        entryType: row.entry_type,
        amountMinor: row.amount_minor,
        currency: row.currency,
        account: {
          id: row.ledger_account_id,
          code: row.account_code,
          type: row.account_type,
          walletId: row.wallet_id,
          name: row.account_name,
          currency: row.account_currency,
          status: row.account_status,
        },
        createdAt: row.created_at,
      })),
      jobs: jobResult.rows.map((row) => ({
        id: row.id,
        type: row.job_type,
        status: row.status,
        attempts: row.attempt_count,
        maxAttempts: row.max_attempts,
        availableAt: row.available_at,
        lastAttemptAt: row.last_attempt_at,
        completedAt: row.completed_at,
        lastErrorCode: row.last_error_code,
        lastErrorMessage: row.last_error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      audits: auditResult.rows.map((row) => ({
        id: row.id,
        actorType: row.actor_type,
        actorName: row.actor_name ?? row.actor_reference,
        action: row.action_type,
        outcome: row.outcome,
        severity: row.severity,
        sourceJobId: row.source_job_id,
        metadata: row.metadata,
        occurredAt: row.occurred_at,
      })),
      integrityIndicators: indicators,
    };
  }

  private integrityIndicators(
    transfer: {
      status: string;
      amount_minor: string;
      currency: string;
      sender_wallet_id: string;
      receiver_wallet_id: string;
    },
    lifecycle: { previous_status: string | null; new_status: string }[],
    transactions: LedgerTransaction[],
    entries: LedgerEntry[],
    jobs: { status: string; attempt_count: number }[],
  ) {
    const indicators = new Set<string>();
    const expectedLifecycle: Record<string, string[]> = {
      PENDING: ["PENDING"],
      COMPLETED: ["PENDING", "COMPLETED"],
      FAILED: ["PENDING", "FAILED"],
      REVERSED: ["PENDING", "COMPLETED", "REVERSED"],
    };
    const actualLifecycle = lifecycle.map((row) => row.new_status);
    if (
      JSON.stringify(actualLifecycle) !==
      JSON.stringify(expectedLifecycle[transfer.status])
    ) indicators.add("LIFECYCLE_HISTORY_MISMATCH");

    if (jobs.length === 0) indicators.add("BACKGROUND_JOB_MISSING");
    if (jobs.some((job) => job.status === "FAILED"))
      indicators.add("BACKGROUND_JOB_FAILED");
    if (
      jobs.some(
        (job) => job.attempt_count > 1 && job.status !== "COMPLETED",
      )
    ) indicators.add("BACKGROUND_JOB_RETRYING");

    const originals = transactions.filter((row) => !row.reversal_of_id);
    if (["COMPLETED", "REVERSED"].includes(transfer.status)) {
      if (originals.length !== 1) {
        indicators.add("LEDGER_MISSING");
      } else {
        const originalEntries = entries.filter(
          (row) => row.ledger_transaction_id === originals[0].id,
        );
        const senderDebit = originalEntries.find(
          (row) =>
            row.wallet_id === transfer.sender_wallet_id &&
            row.entry_type === "DEBIT",
        );
        const receiverCredit = originalEntries.find(
          (row) =>
            row.wallet_id === transfer.receiver_wallet_id &&
            row.entry_type === "CREDIT",
        );
        if (!senderDebit || !receiverCredit)
          indicators.add("LEDGER_PARTY_MISMATCH");
        const debitTotal = originalEntries
          .filter((row) => row.entry_type === "DEBIT")
          .reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
        const creditTotal = originalEntries
          .filter((row) => row.entry_type === "CREDIT")
          .reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
        if (debitTotal !== creditTotal)
          indicators.add("LEDGER_UNBALANCED");
        if (
          debitTotal !== BigInt(transfer.amount_minor) ||
          senderDebit?.amount_minor !== transfer.amount_minor ||
          receiverCredit?.amount_minor !== transfer.amount_minor
        ) indicators.add("LEDGER_AMOUNT_MISMATCH");
        if (
          originalEntries.some(
            (row) =>
              row.currency.trim() !== transfer.currency.trim() ||
              row.account_currency.trim() !== transfer.currency.trim(),
          )
        ) indicators.add("LEDGER_CURRENCY_MISMATCH");
        if (transfer.status === "REVERSED") {
          const reversals = transactions.filter(
            (row) => row.reversal_of_id === originals[0].id,
          );
          if (reversals.length !== 1) indicators.add("LEDGER_MISSING");
          for (const reversal of reversals) {
            const reversalEntries = entries.filter(
              (row) => row.ledger_transaction_id === reversal.id,
            );
            const debits = reversalEntries
              .filter((row) => row.entry_type === "DEBIT")
              .reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
            const credits = reversalEntries
              .filter((row) => row.entry_type === "CREDIT")
              .reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
            if (debits !== credits) indicators.add("LEDGER_UNBALANCED");
          }
        }
      }
    } else if (originals.length > 0) {
      indicators.add("UNEXPECTED_LEDGER_FOR_NON_COMPLETED_TRANSFER");
    }
    return [...indicators];
  }

  private async assertAdministrator(
    database: DatabaseService | PoolClient,
    adminId: string,
    role: Role,
  ) {
    if (role !== "ADMIN") throw this.forbidden();
    type AdminRow = { role: string; status: string };
    const statement = "SELECT role, status FROM users WHERE id = $1";
    const result =
      database instanceof DatabaseService
        ? await database.query<AdminRow>(statement, [adminId])
        : await database.query<AdminRow>(statement, [adminId]);
    const admin = result.rows[0];
    if (!admin || admin.role !== "ADMIN" || admin.status !== "ACTIVE")
      throw this.forbidden();
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

  private maskEmail(email: string) {
    const [local, domain] = email.split("@");
    return `${local.slice(0, 2)}${"*".repeat(Math.max(2, local.length - 2))}@${domain}`;
  }

  private maskPhone(phone: string) {
    return `${phone.slice(0, 3)}${"*".repeat(Math.max(4, phone.length - 7))}${phone.slice(-4)}`;
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
    return new NotFoundException("Transfer was not found.");
  }
}
