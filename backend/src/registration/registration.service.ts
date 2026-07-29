import {
  ConflictException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseError } from "pg";
import { DatabaseService } from "../database/database.service";
import { RegisterDto } from "./dto/register.dto";
import { LegalDocumentType, RegistrationResult } from "./registration.types";

type RegistrationContext = {
  ipAddress?: string;
  userAgent?: string;
};

type ActiveLegalDocumentRow = {
  id: string;
  document_type: LegalDocumentType;
};

type CreatedUserRow = {
  created_at: Date;
};

@Injectable()
export class RegistrationService {
  private readonly bcryptRounds: number;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    const configuredRounds = Number(config.get<string>("BCRYPT_ROUNDS", "12"));
    this.bcryptRounds = Number.isInteger(configuredRounds)
      ? Math.min(Math.max(configuredRounds, 10), 14)
      : 12;
  }

  async register(
    dto: RegisterDto,
    context: RegistrationContext,
  ): Promise<RegistrationResult> {
    const passwordHash = await hash(dto.password, this.bcryptRounds);
    const client = await this.database.connect();

    const userId = randomUUID();
    const walletId = randomUUID();
    const ledgerAccountId = randomUUID();
    const backgroundJobId = randomUUID();
    const walletNumber = this.createWalletNumber();
    const acceptedDocumentIds = [...new Set(dto.acceptedLegalDocumentIds)];

    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");

      const documents = await client.query<ActiveLegalDocumentRow>(
        `
          SELECT DISTINCT ON (document_type)
            id,
            document_type
          FROM legal_documents
          WHERE effective_at <= NOW()
            AND (retired_at IS NULL OR retired_at > NOW())
          ORDER BY document_type, effective_at DESC
        `,
      );

      const activeByType = new Map(
        documents.rows.map((document) => [
          document.document_type,
          document.id,
        ]),
      );
      const requiredDocumentIds = [
        activeByType.get("TERMS"),
        activeByType.get("PRIVACY_POLICY"),
      ];

      if (requiredDocumentIds.some((documentId) => !documentId)) {
        throw new ServiceUnavailableException({
          code: "LEGAL_DOCUMENTS_UNAVAILABLE",
          message: "Registration is temporarily unavailable.",
        });
      }

      if (
        acceptedDocumentIds.length !== 2 ||
        !requiredDocumentIds.every((documentId) =>
          acceptedDocumentIds.includes(documentId!),
        )
      ) {
        throw new UnprocessableEntityException({
          code: "LEGAL_DOCUMENTS_CHANGED",
          message:
            "The terms or privacy policy changed. Review the current versions and try again.",
        });
      }

      const userResult = await client.query<CreatedUserRow>(
        `
          INSERT INTO users (
            id,
            full_name,
            email,
            phone_number,
            role,
            status
          )
          VALUES ($1, $2, $3, $4, 'CUSTOMER', 'ACTIVE')
          RETURNING created_at
        `,
        [userId, dto.fullName, dto.email, dto.phoneNumber],
      );

      await client.query(
        `
          INSERT INTO user_credentials (
            user_id,
            password_hash,
            password_changed_at
          )
          VALUES ($1, $2, NOW())
        `,
        [userId, passwordHash],
      );

      for (const legalDocumentId of acceptedDocumentIds) {
        await client.query(
          `
            INSERT INTO user_consents (
              id,
              user_id,
              legal_document_id,
              ip_address,
              user_agent
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            randomUUID(),
            userId,
            legalDocumentId,
            context.ipAddress ?? null,
            context.userAgent?.slice(0, 1000) ?? null,
          ],
        );
      }

      await client.query(
        `
          INSERT INTO wallets (
            id,
            wallet_number,
            user_id,
            currency,
            balance_minor,
            status
          )
          VALUES ($1, $2, $3, 'INR', 0, 'ACTIVE')
        `,
        [walletId, walletNumber, userId],
      );

      await client.query(
        `
          INSERT INTO ledger_accounts (
            id,
            account_code,
            account_type,
            wallet_id,
            name,
            currency,
            status
          )
          VALUES ($1, $2, 'USER_WALLET', $3, $4, 'INR', 'ACTIVE')
        `,
        [
          ledgerAccountId,
          `UW-${walletNumber}`,
          walletId,
          `${dto.fullName}'s INR wallet`,
        ],
      );

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
          VALUES ($1, 'USER_REGISTERED', 'USER_ACCOUNT', $2, $3::JSONB, 'PENDING')
        `,
        [
          backgroundJobId,
          userId,
          JSON.stringify({
            userId,
            walletId,
          }),
        ],
      );

      await client.query("COMMIT");

      return {
        user: {
          id: userId,
          fullName: dto.fullName,
          email: dto.email,
          phoneNumber: dto.phoneNumber,
          status: "ACTIVE",
          createdAt: userResult.rows[0].created_at.toISOString(),
        },
        wallet: {
          id: walletId,
          walletNumber,
          currency: "INR",
          balanceMinor: 0,
          status: "ACTIVE",
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");

      if (error instanceof HttpException) throw error;
      if (error instanceof DatabaseError && error.code === "23505") {
        if (error.constraint === "users_email_unique") {
          throw new ConflictException({
            code: "EMAIL_ALREADY_REGISTERED",
            message: "An account already exists with this email address.",
          });
        }
        if (error.constraint === "users_phone_number_unique") {
          throw new ConflictException({
            code: "PHONE_ALREADY_REGISTERED",
            message: "An account already exists with this phone number.",
          });
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private createWalletNumber() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const entropy = randomBytes(5).toString("hex").toUpperCase();
    return `LF${timestamp}${entropy}`.slice(0, 24);
  }
}
