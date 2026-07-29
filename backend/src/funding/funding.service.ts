import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { AddFundsDto } from "./dto/add-funds.dto";

type WalletRow = {
  user_status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  wallet_id: string;
  wallet_number: string;
  currency: string;
  balance_minor: string;
  wallet_status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  updated_at: Date;
};

type ExistingFundingRow = {
  id: string;
  amount_minor: string;
  currency: string;
  source_type: "SIMULATED";
  status: "PENDING" | "COMPLETED" | "FAILED";
  balance_before_minor: string | null;
  balance_after_minor: string | null;
  completed_at: Date | null;
};

type LedgerAccountRow = {
  id: string;
  account_type: "USER_WALLET" | "SYSTEM_FUNDING";
};

@Injectable()
export class FundingService {
  private readonly maximumAmountMinor: number;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    const configuredLimit = Number(
      config.get<string>("MAX_FUNDING_AMOUNT_MINOR", "10000000"),
    );
    this.maximumAmountMinor =
      Number.isSafeInteger(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : 10_000_000;
  }

  async getContext(userId: string) {
    const result = await this.database.query<WalletRow>(
      `
        SELECT
          u.status AS user_status,
          w.id AS wallet_id,
          w.wallet_number,
          w.currency,
          w.balance_minor,
          w.status AS wallet_status,
          w.updated_at
        FROM users u
        JOIN wallets w ON w.user_id = u.id AND w.currency = 'INR'
        WHERE u.id = $1
      `,
      [userId],
    );
    const wallet = result.rows[0];
    if (!wallet) throw this.walletNotFound();

    return {
      wallet: {
        id: wallet.wallet_id,
        walletNumber: wallet.wallet_number,
        currency: wallet.currency.trim(),
        balanceMinor: wallet.balance_minor,
        status: wallet.wallet_status,
        updatedAt: wallet.updated_at.toISOString(),
      },
      source: {
        type: "SIMULATED",
        label: "LedgerFlow virtual funding",
      },
      maximumAmountMinor: this.maximumAmountMinor,
      canFund:
        wallet.user_status === "ACTIVE" && wallet.wallet_status === "ACTIVE",
    };
  }

  async addFunds(userId: string, dto: AddFundsDto) {
    if (dto.amountMinor > this.maximumAmountMinor) {
      throw new UnprocessableEntityException({
        code: "FUNDING_LIMIT_EXCEEDED",
        message: `The maximum virtual funding amount is ₹${(
          this.maximumAmountMinor / 100
        ).toLocaleString("en-IN")}.`,
      });
    }

    const client = await this.database.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const walletResult = await client.query<WalletRow>(
        `
          SELECT
            u.status AS user_status,
            w.id AS wallet_id,
            w.wallet_number,
            w.currency,
            w.balance_minor,
            w.status AS wallet_status,
            w.updated_at
          FROM users u
          JOIN wallets w ON w.user_id = u.id AND w.currency = $2
          WHERE u.id = $1
          FOR UPDATE OF w
        `,
        [userId, dto.currency],
      );
      const wallet = walletResult.rows[0];
      if (!wallet) throw this.walletNotFound();
      if (wallet.user_status !== "ACTIVE") {
        throw new ForbiddenException({
          code: "ACCOUNT_UNAVAILABLE",
          message: "This account is currently unavailable.",
        });
      }
      if (wallet.wallet_status !== "ACTIVE") {
        throw new ForbiddenException({
          code: "WALLET_UNAVAILABLE",
          message: "This wallet is currently unavailable for funding.",
        });
      }
      if (wallet.currency.trim() !== dto.currency) {
        throw new UnprocessableEntityException({
          code: "CURRENCY_MISMATCH",
          message: "The funding currency does not match your wallet.",
        });
      }

      const existingResult = await client.query<ExistingFundingRow>(
        `
          SELECT
            id,
            amount_minor,
            currency,
            source_type,
            status,
            balance_before_minor,
            balance_after_minor,
            completed_at
          FROM funding_transactions
          WHERE wallet_id = $1 AND idempotency_key = $2
        `,
        [wallet.wallet_id, dto.idempotencyKey],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (
          existing.amount_minor !== String(dto.amountMinor) ||
          existing.currency.trim() !== dto.currency ||
          existing.source_type !== dto.sourceType
        ) {
          throw new ConflictException({
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "This request key was already used for different funding details.",
          });
        }
        await client.query("COMMIT");
        transactionOpen = false;
        return this.resultFromExisting(existing);
      }

      const accountsResult = await client.query<LedgerAccountRow>(
        `
          SELECT id, account_type
          FROM ledger_accounts
          WHERE status = 'ACTIVE'
            AND currency = $2
            AND (
              (account_type = 'USER_WALLET' AND wallet_id = $1)
              OR (account_type = 'SYSTEM_FUNDING' AND wallet_id IS NULL)
            )
        `,
        [wallet.wallet_id, dto.currency],
      );
      const userLedgerAccount = accountsResult.rows.find(
        (account) => account.account_type === "USER_WALLET",
      );
      const systemFundingAccount = accountsResult.rows.find(
        (account) => account.account_type === "SYSTEM_FUNDING",
      );
      if (!userLedgerAccount || !systemFundingAccount) {
        throw new ServiceUnavailableException({
          code: "FUNDING_ACCOUNTS_UNAVAILABLE",
          message: "Virtual funding is temporarily unavailable.",
        });
      }

      const fundingId = randomUUID();
      const ledgerTransactionId = randomUUID();
      const balanceBefore = BigInt(wallet.balance_minor);
      const balanceAfter = balanceBefore + BigInt(dto.amountMinor);

      await client.query(
        `
          INSERT INTO funding_transactions (
            id,
            wallet_id,
            initiated_by_user_id,
            idempotency_key,
            amount_minor,
            currency,
            source_type,
            status,
            balance_before_minor
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'SIMULATED', 'PENDING', $7)
        `,
        [
          fundingId,
          wallet.wallet_id,
          userId,
          dto.idempotencyKey,
          dto.amountMinor,
          dto.currency,
          balanceBefore.toString(),
        ],
      );

      await client.query(
        `
          UPDATE wallets
          SET balance_minor = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [wallet.wallet_id, balanceAfter.toString()],
      );
      await client.query(
        `
          INSERT INTO ledger_transactions (
            id,
            transaction_type,
            reference_id,
            description
          )
          VALUES ($1, 'WALLET_FUNDING', $2, $3)
        `,
        [
          ledgerTransactionId,
          fundingId,
          `Simulated funding for wallet ${wallet.wallet_number}`,
        ],
      );
      await client.query(
        `
          INSERT INTO ledger_entries (
            id,
            ledger_transaction_id,
            ledger_account_id,
            entry_type,
            amount_minor,
            currency
          )
          VALUES
            ($1, $2, $3, 'DEBIT', $4, $5),
            ($6, $2, $7, 'CREDIT', $4, $5)
        `,
        [
          randomUUID(),
          ledgerTransactionId,
          systemFundingAccount.id,
          dto.amountMinor,
          dto.currency,
          randomUUID(),
          userLedgerAccount.id,
        ],
      );

      const totals = await client.query<{
        debit_total: string;
        credit_total: string;
      }>(
        `
          SELECT
            COALESCE(SUM(amount_minor) FILTER (WHERE entry_type = 'DEBIT'), 0)::TEXT
              AS debit_total,
            COALESCE(SUM(amount_minor) FILTER (WHERE entry_type = 'CREDIT'), 0)::TEXT
              AS credit_total
          FROM ledger_entries
          WHERE ledger_transaction_id = $1
        `,
        [ledgerTransactionId],
      );
      if (
        totals.rows[0].debit_total !== totals.rows[0].credit_total ||
        totals.rows[0].debit_total !== String(dto.amountMinor)
      ) {
        throw new Error("Ledger entries are not balanced.");
      }

      for (const jobType of [
        "FUNDING_NOTIFICATION",
        "FUNDING_ANALYTICS",
        "FUNDING_AUDIT",
      ]) {
        await client.query(
          `
            INSERT INTO background_jobs (
              id,
              job_type,
              resource_type,
              resource_id,
              payload,
              status
            )
            VALUES ($1, $2, 'FUNDING_TRANSACTION', $3, $4::JSONB, 'PENDING')
          `,
          [
            randomUUID(),
            jobType,
            fundingId,
            JSON.stringify({
              fundingTransactionId: fundingId,
              walletId: wallet.wallet_id,
            }),
          ],
        );
      }

      const completed = await client.query<{ completed_at: Date }>(
        `
          UPDATE funding_transactions
          SET status = 'COMPLETED',
              balance_after_minor = $2,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
          RETURNING completed_at
        `,
        [fundingId, balanceAfter.toString()],
      );
      await client.query("COMMIT");
      transactionOpen = false;

      return {
        fundingTransactionId: fundingId,
        status: "COMPLETED",
        amountMinor: String(dto.amountMinor),
        currency: dto.currency,
        balanceBeforeMinor: balanceBefore.toString(),
        balanceAfterMinor: balanceAfter.toString(),
        completedAt: completed.rows[0].completed_at.toISOString(),
        idempotentReplay: false,
      };
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private resultFromExisting(existing: ExistingFundingRow) {
    return {
      fundingTransactionId: existing.id,
      status: existing.status,
      amountMinor: existing.amount_minor,
      currency: existing.currency.trim(),
      balanceBeforeMinor: existing.balance_before_minor,
      balanceAfterMinor: existing.balance_after_minor,
      completedAt: existing.completed_at?.toISOString() ?? null,
      idempotentReplay: true,
    };
  }

  private walletNotFound() {
    return new NotFoundException({
      code: "WALLET_NOT_FOUND",
      message: "Your INR wallet could not be found.",
    });
  }
}
