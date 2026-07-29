import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { LoginDto } from "./dto/login.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import {
  LoginResult,
  RequestContext,
} from "./authentication.types";

type LoginRow = {
  id: string;
  full_name: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  password_hash: string;
  failed_login_attempts: number;
  locked_until: Date | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  expires_at: Date;
};

type ResetTokenRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  invalidated_at: Date | null;
};

type AuthEventType =
  | "LOGIN_SUCCEEDED"
  | "LOGIN_FAILED"
  | "LOGIN_BLOCKED"
  | "LOGOUT_SUCCEEDED"
  | "PASSWORD_RESET_REQUESTED"
  | "PASSWORD_RESET_COMPLETED";

type AuthFailureReason =
  | "INVALID_CREDENTIALS"
  | "TEMPORARILY_LOCKED"
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_CLOSED"
  | "RESET_TOKEN_EXPIRED"
  | "RESET_TOKEN_ALREADY_USED";

@Injectable()
export class AuthenticationService {
  private readonly jwtSecret: string;
  private readonly resetEncryptionKey: Buffer;
  private readonly bcryptRounds: number;
  private readonly dummyHash: Promise<string>;
  private readonly accessTokenTtlSeconds = 15 * 60;
  private readonly refreshTokenTtlMs = 7 * 24 * 60 * 60 * 1000;
  private readonly resetTokenTtlMs = 15 * 60 * 1000;

  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const jwtSecret = config.get<string>("JWT_ACCESS_SECRET");
    const resetSecret = config.get<string>("RESET_TOKEN_ENCRYPTION_SECRET");
    if (!jwtSecret || !resetSecret) {
      throw new Error(
        "JWT_ACCESS_SECRET and RESET_TOKEN_ENCRYPTION_SECRET are required.",
      );
    }
    this.jwtSecret = jwtSecret;
    this.resetEncryptionKey = createHash("sha256").update(resetSecret).digest();
    const configuredRounds = Number(config.get<string>("BCRYPT_ROUNDS", "12"));
    this.bcryptRounds = Number.isInteger(configuredRounds)
      ? Math.min(Math.max(configuredRounds, 10), 14)
      : 12;
    this.dummyHash = hash(randomBytes(24).toString("hex"), this.bcryptRounds);
  }

  async login(dto: LoginDto, context: RequestContext): Promise<LoginResult> {
    const client = await this.database.connect();
    const identifierHash = this.sha256(dto.email);
    let transactionOpen = false;

    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const result = await client.query<LoginRow>(
        `
          SELECT
            u.id,
            u.full_name,
            u.email,
            u.role,
            u.status,
            c.password_hash,
            c.failed_login_attempts,
            c.locked_until
          FROM users u
          JOIN user_credentials c ON c.user_id = u.id
          WHERE u.email = $1
          FOR UPDATE OF c
        `,
        [dto.email],
      );
      const account = result.rows[0];

      if (!account) {
        await compare(dto.password, await this.dummyHash);
        await this.appendEvent(client, {
          identifierHash,
          eventType: "LOGIN_FAILED",
          failureReason: "INVALID_CREDENTIALS",
          context,
        });
        await client.query("COMMIT");
        transactionOpen = false;
        throw this.invalidCredentials();
      }

      if (account.locked_until && account.locked_until > new Date()) {
        await this.appendEvent(client, {
          userId: account.id,
          identifierHash,
          eventType: "LOGIN_BLOCKED",
          failureReason: "TEMPORARILY_LOCKED",
          context,
        });
        await client.query("COMMIT");
        transactionOpen = false;
        throw new HttpException(
          {
            code: "LOGIN_TEMPORARILY_LOCKED",
            message: "Sign-in is temporarily unavailable. Try again later.",
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const passwordMatches = await compare(dto.password, account.password_hash);
      if (!passwordMatches) {
        const attempts = account.failed_login_attempts + 1;
        const shouldLock = attempts >= 5;
        await client.query(
          `
            UPDATE user_credentials
            SET failed_login_attempts = $2,
                locked_until = CASE
                  WHEN $3::BOOLEAN THEN NOW() + INTERVAL '15 minutes'
                  ELSE NULL
                END,
                updated_at = NOW()
            WHERE user_id = $1
          `,
          [account.id, attempts, shouldLock],
        );
        await this.appendEvent(client, {
          userId: account.id,
          identifierHash,
          eventType: shouldLock ? "LOGIN_BLOCKED" : "LOGIN_FAILED",
          failureReason: shouldLock
            ? "TEMPORARILY_LOCKED"
            : "INVALID_CREDENTIALS",
          context,
        });
        await client.query("COMMIT");
        transactionOpen = false;
        throw this.invalidCredentials();
      }

      if (account.status !== "ACTIVE") {
        const failureReason =
          account.status === "CLOSED" ? "ACCOUNT_CLOSED" : "ACCOUNT_SUSPENDED";
        await this.appendEvent(client, {
          userId: account.id,
          identifierHash,
          eventType: "LOGIN_BLOCKED",
          failureReason,
          context,
        });
        await client.query("COMMIT");
        transactionOpen = false;
        throw new ForbiddenException({
          code: "ACCOUNT_UNAVAILABLE",
          message: "This account is currently unavailable. Contact support.",
        });
      }

      const refreshToken = randomBytes(48).toString("base64url");
      const refreshTokenExpiresAt = new Date(Date.now() + this.refreshTokenTtlMs);
      await client.query(
        `
          UPDATE user_credentials
          SET failed_login_attempts = 0,
              locked_until = NULL,
              updated_at = NOW()
          WHERE user_id = $1
        `,
        [account.id],
      );
      await client.query(
        `
          INSERT INTO auth_sessions (
            id,
            user_id,
            refresh_token_hash,
            expires_at,
            ip_address,
            user_agent
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          randomUUID(),
          account.id,
          this.sha256(refreshToken),
          refreshTokenExpiresAt,
          context.ipAddress ?? null,
          context.userAgent?.slice(0, 1000) ?? null,
        ],
      );
      await this.appendEvent(client, {
        userId: account.id,
        identifierHash,
        eventType: "LOGIN_SUCCEEDED",
        context,
      });
      await client.query("COMMIT");
      transactionOpen = false;

      return {
        accessToken: await this.createAccessToken(account),
        accessTokenExpiresIn: this.accessTokenTtlSeconds,
        refreshToken,
        refreshTokenExpiresAt,
        user: {
          id: account.id,
          fullName: account.full_name,
          email: account.email,
          role: account.role,
        },
      };
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async refresh(rawRefreshToken: string): Promise<LoginResult> {
    const client = await this.database.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const result = await client.query<SessionRow>(
        `
          SELECT
            s.id,
            s.user_id,
            s.expires_at,
            u.full_name,
            u.email,
            u.role,
            u.status
          FROM auth_sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.refresh_token_hash = $1
            AND s.revoked_at IS NULL
          FOR UPDATE OF s
        `,
        [this.sha256(rawRefreshToken)],
      );
      const session = result.rows[0];
      if (
        !session ||
        session.expires_at <= new Date() ||
        session.status !== "ACTIVE"
      ) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        throw new UnauthorizedException({
          code: "SESSION_INVALID",
          message: "Your session has expired. Please log in again.",
        });
      }

      const rotatedToken = randomBytes(48).toString("base64url");
      const refreshTokenExpiresAt = new Date(Date.now() + this.refreshTokenTtlMs);
      await client.query(
        `
          UPDATE auth_sessions
          SET refresh_token_hash = $2,
              last_used_at = NOW(),
              expires_at = $3
          WHERE id = $1
        `,
        [session.id, this.sha256(rotatedToken), refreshTokenExpiresAt],
      );
      await client.query("COMMIT");
      transactionOpen = false;

      return {
        accessToken: await this.createAccessToken({
          id: session.user_id,
          role: session.role,
        }),
        accessTokenExpiresIn: this.accessTokenTtlSeconds,
        refreshToken: rotatedToken,
        refreshTokenExpiresAt,
        user: {
          id: session.user_id,
          fullName: session.full_name,
          email: session.email,
          role: session.role,
        },
      };
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(rawRefreshToken: string | undefined, context: RequestContext) {
    if (!rawRefreshToken) return;
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ user_id: string }>(
        `
          UPDATE auth_sessions
          SET revoked_at = NOW(),
              revocation_reason = 'USER_LOGOUT'
          WHERE refresh_token_hash = $1
            AND revoked_at IS NULL
          RETURNING user_id
        `,
        [this.sha256(rawRefreshToken)],
      );
      if (result.rows[0]) {
        await this.appendEvent(client, {
          userId: result.rows[0].user_id,
          eventType: "LOGOUT_SUCCEEDED",
          context,
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async requestPasswordReset(dto: ForgotPasswordDto, context: RequestContext) {
    const client = await this.database.connect();
    const identifierHash = this.sha256(dto.email);
    try {
      await client.query("BEGIN");
      const userResult = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 AND status = 'ACTIVE'`,
        [dto.email],
      );
      const user = userResult.rows[0];

      if (user) {
        await client.query(
          `
            UPDATE password_reset_tokens
            SET invalidated_at = NOW()
            WHERE user_id = $1
              AND used_at IS NULL
              AND invalidated_at IS NULL
          `,
          [user.id],
        );
        const rawToken = randomBytes(48).toString("base64url");
        const resetTokenId = randomUUID();
        await client.query(
          `
            INSERT INTO password_reset_tokens (
              id,
              user_id,
              token_hash,
              expires_at,
              requested_ip,
              user_agent
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            resetTokenId,
            user.id,
            this.sha256(rawToken),
            new Date(Date.now() + this.resetTokenTtlMs),
            context.ipAddress ?? null,
            context.userAgent?.slice(0, 1000) ?? null,
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
            VALUES (
              $1,
              'SEND_PASSWORD_RESET_EMAIL',
              'PASSWORD_RESET_TOKEN',
              $2,
              $3::JSONB,
              'PENDING'
            )
          `,
          [
            randomUUID(),
            resetTokenId,
            JSON.stringify({
              userId: user.id,
              resetTokenId,
              encryptedDeliveryToken: this.encryptResetToken(rawToken),
            }),
          ],
        );
      }

      await this.appendEvent(client, {
        userId: user?.id,
        identifierHash,
        eventType: "PASSWORD_RESET_REQUESTED",
        context,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      message:
        "If an eligible account exists, password-reset instructions have been sent.",
    };
  }

  async resetPassword(dto: ResetPasswordDto, context: RequestContext) {
    const passwordHash = await hash(dto.password, this.bcryptRounds);
    const client = await this.database.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const result = await client.query<ResetTokenRow>(
        `
          SELECT id, user_id, expires_at, used_at, invalidated_at
          FROM password_reset_tokens
          WHERE token_hash = $1
          FOR UPDATE
        `,
        [this.sha256(dto.token)],
      );
      const resetToken = result.rows[0];
      if (!resetToken) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        throw this.invalidResetToken();
      }
      if (resetToken.used_at) {
        await this.appendEvent(client, {
          userId: resetToken.user_id,
          eventType: "LOGIN_BLOCKED",
          failureReason: "RESET_TOKEN_ALREADY_USED",
          context,
        });
        await client.query("COMMIT");
        transactionOpen = false;
        throw this.invalidResetToken();
      }
      if (resetToken.invalidated_at || resetToken.expires_at <= new Date()) {
        await this.appendEvent(client, {
          userId: resetToken.user_id,
          eventType: "LOGIN_BLOCKED",
          failureReason: "RESET_TOKEN_EXPIRED",
          context,
        });
        await client.query("COMMIT");
        transactionOpen = false;
        throw this.invalidResetToken();
      }

      await client.query(
        `
          UPDATE user_credentials
          SET password_hash = $2,
              password_changed_at = NOW(),
              failed_login_attempts = 0,
              locked_until = NULL,
              updated_at = NOW()
          WHERE user_id = $1
        `,
        [resetToken.user_id, passwordHash],
      );
      await client.query(
        `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
        [resetToken.id],
      );
      await client.query(
        `
          UPDATE auth_sessions
          SET revoked_at = NOW(),
              revocation_reason = 'PASSWORD_RESET'
          WHERE user_id = $1
            AND revoked_at IS NULL
        `,
        [resetToken.user_id],
      );
      await this.appendEvent(client, {
        userId: resetToken.user_id,
        eventType: "PASSWORD_RESET_COMPLETED",
        context,
      });
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
          VALUES (
            $1,
            'PASSWORD_RESET_COMPLETED',
            'USER_ACCOUNT',
            $2,
            $3::JSONB,
            'PENDING'
          )
        `,
        [
          randomUUID(),
          resetToken.user_id,
          JSON.stringify({ userId: resetToken.user_id }),
        ],
      );
      await client.query("COMMIT");
      transactionOpen = false;
      return { message: "Your password has been reset. You can now log in." };
    } catch (error) {
      if (transactionOpen) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private createAccessToken(account: { id: string; role: string }) {
    return this.jwt.signAsync(
      { sub: account.id, role: account.role },
      {
        secret: this.jwtSecret,
        expiresIn: this.accessTokenTtlSeconds,
        issuer: "ledgerflow-api",
        audience: "ledgerflow-web",
      },
    );
  }

  private appendEvent(
    client: PoolClient,
    event: {
      userId?: string;
      identifierHash?: string;
      eventType: AuthEventType;
      failureReason?: AuthFailureReason;
      context: RequestContext;
    },
  ) {
    return client.query(
      `
        INSERT INTO authentication_events (
          id,
          user_id,
          identifier_hash,
          event_type,
          failure_reason,
          ip_address,
          user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        randomUUID(),
        event.userId ?? null,
        event.identifierHash ?? null,
        event.eventType,
        event.failureReason ?? null,
        event.context.ipAddress ?? null,
        event.context.userAgent?.slice(0, 1000) ?? null,
      ],
    );
  }

  private sha256(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private encryptResetToken(rawToken: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.resetEncryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(rawToken, "utf8"),
      cipher.final(),
    ]);
    return [
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  private invalidCredentials() {
    return new UnauthorizedException({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
    });
  }

  private invalidResetToken() {
    return new BadRequestException({
      code: "RESET_TOKEN_INVALID",
      message: "This password-reset link is invalid or has expired.",
    });
  }
}
