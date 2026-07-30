import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseService } from "../database/database.service";
import { CreateTransferDto } from "./dto/create-transfer.dto";

type WalletContextRow = {
  user_status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  wallet_id: string;
  wallet_number: string;
  currency: string;
  balance_minor: string;
  wallet_status: "ACTIVE" | "SUSPENDED" | "CLOSED";
};

type RecipientRow = {
  user_id: string;
  full_name: string;
  wallet_id: string;
  wallet_number: string;
  currency: string;
};

type LockedWalletRow = {
  wallet_id: string;
  user_id: string;
  user_status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  full_name: string;
  wallet_number: string;
  currency: string;
  balance_minor: string;
  wallet_status: "ACTIVE" | "SUSPENDED" | "CLOSED";
};

type ExistingTransferRow = {
  id: string;
  transfer_reference: string;
  receiver_wallet_id: string;
  amount_minor: string;
  currency: string;
  note: string | null;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  sender_balance_before_minor: string | null;
  sender_balance_after_minor: string | null;
  receiver_balance_before_minor: string | null;
  receiver_balance_after_minor: string | null;
  completed_at: Date | null;
};

type LedgerAccountRow = {
  id: string;
  wallet_id: string;
};

@Injectable()
export class TransfersService {
  private readonly maximumAmountMinor: number;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    const configuredLimit = Number(
      config.get<string>("MAX_TRANSFER_AMOUNT_MINOR", "10000000"),
    );
    this.maximumAmountMinor =
      Number.isSafeInteger(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : 10_000_000;
  }

  async getContext(userId: string) {
    const result = await this.database.query<WalletContextRow>(
      `
        SELECT
          u.status AS user_status,
          w.id AS wallet_id,
          w.wallet_number,
          w.currency,
          w.balance_minor,
          w.status AS wallet_status
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
      },
      maximumAmountMinor: this.maximumAmountMinor,
      canTransfer:
        wallet.user_status === "ACTIVE" && wallet.wallet_status === "ACTIVE",
    };
  }

  async lookupRecipient(userId: string, submittedIdentifier: string) {
    const identifier = submittedIdentifier.trim();
    const email = identifier.toLowerCase();
    const digits = identifier.replace(/\D/g, "");
    const phone =
      digits.length === 10
        ? `+91${digits}`
        : digits.length === 12 && digits.startsWith("91")
          ? `+${digits}`
          : identifier;
    const walletNumber = identifier.toUpperCase();

    const result = await this.database.query<RecipientRow>(
      `
        SELECT
          u.id AS user_id,
          u.full_name,
          w.id AS wallet_id,
          w.wallet_number,
          w.currency
        FROM users u
        JOIN wallets w ON w.user_id = u.id
        WHERE u.id <> $1
          AND u.status = 'ACTIVE'
          AND w.status = 'ACTIVE'
          AND (
            u.email = $2
            OR u.phone_number = $3
            OR w.wallet_number = $4
          )
        LIMIT 1
      `,
      [userId, email, phone, walletNumber],
    );
    const recipient = result.rows[0];
    if (!recipient) {
      throw new NotFoundException({
        code: "RECIPIENT_NOT_FOUND",
        message: "No eligible recipient matched that exact identifier.",
      });
    }
    return {
      fullName: recipient.full_name,
      walletNumber: recipient.wallet_number,
      currency: recipient.currency.trim(),
    };
  }

  async createTransfer(userId: string, dto: CreateTransferDto) {
    if (dto.amountMinor > this.maximumAmountMinor) {
      throw new UnprocessableEntityException({
        code: "TRANSFER_LIMIT_EXCEEDED",
        message: `The maximum transfer amount is ₹${(
          this.maximumAmountMinor / 100
        ).toLocaleString("en-IN")}.`,
      });
    }

    const partiesResult = await this.database.query<{
      sender_wallet_id: string;
      receiver_wallet_id: string;
    }>(
      `
        SELECT
          (SELECT id FROM wallets WHERE user_id = $1 AND currency = $3)
            AS sender_wallet_id,
          (SELECT id FROM wallets WHERE wallet_number = $2)
            AS receiver_wallet_id
      `,
      [userId, dto.recipientWalletNumber, dto.currency],
    );
    const parties = partiesResult.rows[0];
    if (!parties?.sender_wallet_id) throw this.walletNotFound();
    if (!parties.receiver_wallet_id) throw this.recipientUnavailable();
    if (parties.sender_wallet_id === parties.receiver_wallet_id) {
      throw new UnprocessableEntityException({
        code: "SELF_TRANSFER_NOT_ALLOWED",
        message: "You cannot send virtual money to your own wallet.",
      });
    }

    const client = await this.database.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const locked = await client.query<LockedWalletRow>(
        `
          SELECT
            w.id AS wallet_id,
            w.user_id,
            u.status AS user_status,
            u.full_name,
            w.wallet_number,
            w.currency,
            w.balance_minor,
            w.status AS wallet_status
          FROM wallets w
          JOIN users u ON u.id = w.user_id
          WHERE w.id = ANY($1::UUID[])
          ORDER BY w.id
          FOR UPDATE OF w
        `,
        [[parties.sender_wallet_id, parties.receiver_wallet_id].sort()],
      );
      const sender = locked.rows.find(
        (wallet) => wallet.wallet_id === parties.sender_wallet_id,
      );
      const receiver = locked.rows.find(
        (wallet) => wallet.wallet_id === parties.receiver_wallet_id,
      );
      if (!sender) throw this.walletNotFound();
      if (!receiver) throw this.recipientUnavailable();

      const existingResult = await client.query<ExistingTransferRow>(
        `
          SELECT
            id,
            transfer_reference,
            receiver_wallet_id,
            amount_minor,
            currency,
            note,
            status,
            sender_balance_before_minor,
            sender_balance_after_minor,
            receiver_balance_before_minor,
            receiver_balance_after_minor,
            completed_at
          FROM transfers
          WHERE sender_wallet_id = $1 AND idempotency_key = $2
        `,
        [sender.wallet_id, dto.idempotencyKey],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (
          existing.receiver_wallet_id !== receiver.wallet_id ||
          existing.amount_minor !== String(dto.amountMinor) ||
          existing.currency.trim() !== dto.currency ||
          (existing.note ?? null) !== (dto.note ?? null)
        ) {
          throw new ConflictException({
            code: "IDEMPOTENCY_KEY_REUSED",
            message: "This request key was already used for another transfer.",
          });
        }
        await client.query("COMMIT");
        transactionOpen = false;
        return this.resultFromExisting(existing, receiver.full_name);
      }

      if (sender.user_id !== userId || sender.user_status !== "ACTIVE") {
        throw new ForbiddenException({
          code: "ACCOUNT_UNAVAILABLE",
          message: "Your account is currently unavailable for transfers.",
        });
      }
      if (receiver.user_status !== "ACTIVE") throw this.recipientUnavailable();
      if (
        sender.wallet_status !== "ACTIVE" ||
        receiver.wallet_status !== "ACTIVE"
      ) {
        throw new ForbiddenException({
          code: "WALLET_UNAVAILABLE",
          message: "One of the wallets is currently unavailable.",
        });
      }
      if (
        sender.currency.trim() !== dto.currency ||
        receiver.currency.trim() !== dto.currency
      ) {
        throw new UnprocessableEntityException({
          code: "CURRENCY_MISMATCH",
          message: "Both wallets must use the transfer currency.",
        });
      }

      const senderBefore = BigInt(sender.balance_minor);
      const receiverBefore = BigInt(receiver.balance_minor);
      if (senderBefore < BigInt(dto.amountMinor)) {
        throw new UnprocessableEntityException({
          code: "INSUFFICIENT_BALANCE",
          message: "Your wallet does not have enough virtual funds.",
        });
      }
      const senderAfter = senderBefore - BigInt(dto.amountMinor);
      const receiverAfter = receiverBefore + BigInt(dto.amountMinor);

      const accounts = await client.query<LedgerAccountRow>(
        `
          SELECT id, wallet_id
          FROM ledger_accounts
          WHERE wallet_id = ANY($1::UUID[])
            AND account_type = 'USER_WALLET'
            AND status = 'ACTIVE'
            AND currency = $2
        `,
        [[sender.wallet_id, receiver.wallet_id], dto.currency],
      );
      const senderAccount = accounts.rows.find(
        (account) => account.wallet_id === sender.wallet_id,
      );
      const receiverAccount = accounts.rows.find(
        (account) => account.wallet_id === receiver.wallet_id,
      );
      if (!senderAccount || !receiverAccount) {
        throw new ServiceUnavailableException({
          code: "TRANSFER_ACCOUNTS_UNAVAILABLE",
          message: "Transfers are temporarily unavailable.",
        });
      }

      const transferId = randomUUID();
      const transferReference = this.createTransferReference();
      const ledgerTransactionId = randomUUID();
      await client.query(
        `
          INSERT INTO transfers (
            id,
            transfer_reference,
            sender_wallet_id,
            receiver_wallet_id,
            initiated_by_user_id,
            idempotency_key,
            amount_minor,
            currency,
            note,
            status,
            sender_balance_before_minor,
            receiver_balance_before_minor
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, $11)
        `,
        [
          transferId,
          transferReference,
          sender.wallet_id,
          receiver.wallet_id,
          userId,
          dto.idempotencyKey,
          dto.amountMinor,
          dto.currency,
          dto.note ?? null,
          senderBefore.toString(),
          receiverBefore.toString(),
        ],
      );

      const senderUpdate = await client.query(
        `
          UPDATE wallets
          SET balance_minor = balance_minor - $2,
              updated_at = NOW()
          WHERE id = $1 AND balance_minor >= $2
          RETURNING id
        `,
        [sender.wallet_id, dto.amountMinor],
      );
      if (!senderUpdate.rowCount) {
        throw new UnprocessableEntityException({
          code: "INSUFFICIENT_BALANCE",
          message: "Your wallet does not have enough virtual funds.",
        });
      }
      await client.query(
        `
          UPDATE wallets
          SET balance_minor = balance_minor + $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [receiver.wallet_id, dto.amountMinor],
      );
      await client.query(
        `
          INSERT INTO ledger_transactions (
            id,
            transaction_type,
            reference_id,
            description
          )
          VALUES ($1, 'WALLET_TRANSFER', $2, $3)
        `,
        [
          ledgerTransactionId,
          transferId,
          `Wallet transfer ${transferReference}`,
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
          senderAccount.id,
          dto.amountMinor,
          dto.currency,
          randomUUID(),
          receiverAccount.id,
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
        "TRANSFER_NOTIFICATION",
        "TRANSFER_ANALYTICS",
        "TRANSFER_AUDIT",
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
            VALUES ($1, $2, 'TRANSFER', $3, $4::JSONB, 'PENDING')
          `,
          [
            randomUUID(),
            jobType,
            transferId,
            JSON.stringify({
              transferId,
              senderWalletId: sender.wallet_id,
              receiverWalletId: receiver.wallet_id,
            }),
          ],
        );
      }

      const completed = await client.query<{ completed_at: Date }>(
        `
          UPDATE transfers
          SET status = 'COMPLETED',
              sender_balance_after_minor = $2,
              receiver_balance_after_minor = $3,
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = $1
          RETURNING completed_at
        `,
        [transferId, senderAfter.toString(), receiverAfter.toString()],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return {
        transferId,
        transferReference,
        status: "COMPLETED",
        recipient: {
          fullName: receiver.full_name,
          walletNumber: receiver.wallet_number,
        },
        amountMinor: String(dto.amountMinor),
        currency: dto.currency,
        note: dto.note ?? null,
        senderBalanceBeforeMinor: senderBefore.toString(),
        senderBalanceAfterMinor: senderAfter.toString(),
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

  private resultFromExisting(
    existing: ExistingTransferRow,
    recipientName: string,
  ) {
    return {
      transferId: existing.id,
      transferReference: existing.transfer_reference,
      status: existing.status,
      recipient: { fullName: recipientName },
      amountMinor: existing.amount_minor,
      currency: existing.currency.trim(),
      note: existing.note,
      senderBalanceBeforeMinor: existing.sender_balance_before_minor,
      senderBalanceAfterMinor: existing.sender_balance_after_minor,
      completedAt: existing.completed_at?.toISOString() ?? null,
      idempotentReplay: true,
    };
  }

  private createTransferReference() {
    const time = Date.now().toString(36).toUpperCase();
    const entropy = randomBytes(5).toString("hex").toUpperCase();
    return `LFTR${time}${entropy}`.slice(0, 24);
  }

  private walletNotFound() {
    return new NotFoundException({
      code: "WALLET_NOT_FOUND",
      message: "Your INR wallet could not be found.",
    });
  }

  private recipientUnavailable() {
    return new NotFoundException({
      code: "RECIPIENT_UNAVAILABLE",
      message: "The selected recipient is unavailable.",
    });
  }
}
