import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { CreateClosureRequestDto } from "./dto/create-closure-request.dto";
import { UpdatePreferencesDto } from "./dto/update-preferences.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";

type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

type ClosureRow = {
  id: string;
  status: string;
  reason: string | null;
  requested_at: Date;
  cancelled_at: Date | null;
  reviewed_at: Date | null;
  resolution_note: string | null;
  completed_at: Date | null;
};

@Injectable()
export class SettingsService {
  private readonly bcryptRounds: number;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService,
  ) {
    const configured = Number(config.get<string>("BCRYPT_ROUNDS", "12"));
    this.bcryptRounds = Math.min(14, Math.max(10, configured || 12));
  }

  async getSettings(userId: string, currentSessionId?: string) {
    const [accountResult, preferenceResult, sessionResult, eventResult, closureResult] =
      await Promise.all([
        this.database.query<{
          id: string;
          full_name: string;
          email: string;
          phone_number: string;
          status: string;
          email_verified_at: Date | null;
          phone_verified_at: Date | null;
          created_at: Date;
          wallet_id: string;
          wallet_number: string;
          currency: string;
          balance_minor: string;
          wallet_status: string;
          wallet_created_at: Date;
        }>(
          `
            SELECT
              users.id, users.full_name, users.email, users.phone_number,
              users.status, users.email_verified_at, users.phone_verified_at,
              users.created_at, wallets.id AS wallet_id, wallets.wallet_number,
              wallets.currency, wallets.balance_minor,
              wallets.status AS wallet_status,
              wallets.created_at AS wallet_created_at
            FROM users
            JOIN wallets ON wallets.user_id = users.id AND wallets.currency = 'INR'
            WHERE users.id = $1
          `,
          [userId],
        ),
        this.database.query<{
          wallet_funding_enabled: boolean;
          transfer_sent_enabled: boolean;
          transfer_received_enabled: boolean;
          transfer_failed_enabled: boolean;
          transfer_reversed_enabled: boolean;
          system_messages_enabled: boolean;
        }>(
          `
            SELECT *
            FROM notification_preferences
            WHERE user_id = $1
          `,
          [userId],
        ),
        this.database.query<{
          id: string;
          created_at: Date;
          expires_at: Date;
          last_used_at: Date | null;
          ip_address: string | null;
          user_agent: string | null;
        }>(
          `
            SELECT id, created_at, expires_at, last_used_at,
                   host(ip_address) AS ip_address, user_agent
            FROM auth_sessions
            WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
            ORDER BY COALESCE(last_used_at, created_at) DESC
          `,
          [userId],
        ),
        this.database.query<{
          id: string;
          event_type: string;
          ip_address: string | null;
          user_agent: string | null;
          occurred_at: Date;
        }>(
          `
            SELECT id, event_type, host(ip_address) AS ip_address,
                   user_agent, occurred_at
            FROM authentication_events
            WHERE user_id = $1
            ORDER BY occurred_at DESC
            LIMIT 8
          `,
          [userId],
        ),
        this.database.query<ClosureRow>(
          `
            SELECT id, status, reason, requested_at, cancelled_at,
                   reviewed_at, resolution_note, completed_at
            FROM account_closure_requests
            WHERE user_id = $1
            ORDER BY requested_at DESC
            LIMIT 5
          `,
          [userId],
        ),
      ]);

    const account = accountResult.rows[0];
    if (!account) throw new NotFoundException("Account was not found.");
    const preferences = preferenceResult.rows[0] ?? {
      wallet_funding_enabled: true,
      transfer_sent_enabled: true,
      transfer_received_enabled: true,
      transfer_failed_enabled: true,
      transfer_reversed_enabled: true,
      system_messages_enabled: true,
    };

    return {
      profile: {
        id: account.id,
        fullName: account.full_name,
        email: account.email,
        phoneNumber: account.phone_number,
        status: account.status,
        emailVerified: Boolean(account.email_verified_at),
        phoneVerified: Boolean(account.phone_verified_at),
        createdAt: account.created_at,
      },
      wallet: {
        id: account.wallet_id,
        walletNumber: account.wallet_number,
        currency: account.currency,
        balanceMinor: account.balance_minor,
        status: account.wallet_status,
        createdAt: account.wallet_created_at,
      },
      notificationPreferences: {
        walletFundingEnabled: preferences.wallet_funding_enabled,
        transferSentEnabled: preferences.transfer_sent_enabled,
        transferReceivedEnabled: preferences.transfer_received_enabled,
        transferFailedEnabled: preferences.transfer_failed_enabled,
        transferReversedEnabled: preferences.transfer_reversed_enabled,
        systemMessagesEnabled: preferences.system_messages_enabled,
      },
      sessions: sessionResult.rows.map((session) => ({
        id: session.id,
        device: this.deviceName(session.user_agent),
        ipAddress: session.ip_address,
        createdAt: session.created_at,
        lastUsedAt: session.last_used_at,
        expiresAt: session.expires_at,
        current: session.id === currentSessionId,
      })),
      recentSecurityEvents: eventResult.rows.map((event) => ({
        id: event.id,
        type: event.event_type,
        device: this.deviceName(event.user_agent),
        ipAddress: event.ip_address,
        occurredAt: event.occurred_at,
      })),
      closureRequests: closureResult.rows.map((row) => this.mapClosure(row)),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const result = await this.database.query<{ full_name: string; updated_at: Date }>(
      `
        UPDATE users
        SET full_name = $2, updated_at = NOW()
        WHERE id = $1 AND status <> 'CLOSED'
        RETURNING full_name, updated_at
      `,
      [userId, dto.fullName],
    );
    if (!result.rows[0]) throw new NotFoundException("Active account was not found.");
    return {
      message: "Profile updated.",
      fullName: result.rows[0].full_name,
      updatedAt: result.rows[0].updated_at,
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const result = await this.database.query(
      `
        INSERT INTO notification_preferences (
          user_id, wallet_funding_enabled, transfer_sent_enabled,
          transfer_received_enabled, transfer_failed_enabled,
          transfer_reversed_enabled, system_messages_enabled
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) DO UPDATE SET
          wallet_funding_enabled = EXCLUDED.wallet_funding_enabled,
          transfer_sent_enabled = EXCLUDED.transfer_sent_enabled,
          transfer_received_enabled = EXCLUDED.transfer_received_enabled,
          transfer_failed_enabled = EXCLUDED.transfer_failed_enabled,
          transfer_reversed_enabled = EXCLUDED.transfer_reversed_enabled,
          system_messages_enabled = EXCLUDED.system_messages_enabled,
          updated_at = NOW()
        RETURNING updated_at
      `,
      [
        userId,
        dto.walletFundingEnabled,
        dto.transferSentEnabled,
        dto.transferReceivedEnabled,
        dto.transferFailedEnabled,
        dto.transferReversedEnabled,
        dto.systemMessagesEnabled,
      ],
    );
    return {
      message: "Notification preferences updated.",
      updatedAt: result.rows[0]?.updated_at,
    };
  }

  async changePassword(
    userId: string,
    currentSessionId: string | undefined,
    dto: ChangePasswordDto,
    context: RequestContext,
  ) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const credentialResult = await client.query<{ password_hash: string }>(
        "SELECT password_hash FROM user_credentials WHERE user_id = $1 FOR UPDATE",
        [userId],
      );
      const credential = credentialResult.rows[0];
      if (!credential) throw new NotFoundException("Credentials were not found.");
      if (!(await compare(dto.currentPassword, credential.password_hash))) {
        throw new UnauthorizedException("Current password is incorrect.");
      }
      if (await compare(dto.newPassword, credential.password_hash)) {
        throw new BadRequestException(
          "New password must be different from the current password.",
        );
      }

      const passwordHash = await hash(dto.newPassword, this.bcryptRounds);
      await client.query(
        `
          UPDATE user_credentials
          SET password_hash = $2, password_changed_at = NOW(),
              failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
          WHERE user_id = $1
        `,
        [userId, passwordHash],
      );
      const revoked = await client.query(
        `
          UPDATE auth_sessions
          SET revoked_at = NOW(), revocation_reason = 'PASSWORD_CHANGED'
          WHERE user_id = $1 AND revoked_at IS NULL
            AND ($2::UUID IS NULL OR id <> $2::UUID)
        `,
        [userId, currentSessionId ?? null],
      );
      await this.appendEvent(client, userId, "PASSWORD_CHANGED", context);
      await this.enqueue(client, "account.password.changed", "USER_ACCOUNT", userId, {
        userId,
      });
      await client.query("COMMIT");
      return {
        message: "Password changed. Other active sessions were signed out.",
        revokedSessionCount: revoked.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSession(
    userId: string,
    currentSessionId: string | undefined,
    sessionId: string,
    context: RequestContext,
  ) {
    this.assertUuid(sessionId, "session");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const revoked = await client.query<{ id: string }>(
        `
          UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, NOW()),
              revocation_reason = COALESCE(revocation_reason, 'USER_LOGOUT')
          WHERE id = $2 AND user_id = $1
          RETURNING id
        `,
        [userId, sessionId],
      );
      if (!revoked.rows[0]) throw new NotFoundException("Session was not found.");
      await this.appendEvent(client, userId, "SESSION_REVOKED", context);
      await client.query("COMMIT");
      return {
        message: "Session revoked.",
        currentSessionRevoked: sessionId === currentSessionId,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string | undefined,
    context: RequestContext,
  ) {
    if (!currentSessionId) {
      throw new ForbiddenException("Current session cannot be identified.");
    }
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `
          UPDATE auth_sessions
          SET revoked_at = NOW(), revocation_reason = 'USER_LOGOUT'
          WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL
        `,
        [userId, currentSessionId],
      );
      await this.appendEvent(
        client,
        userId,
        "ALL_OTHER_SESSIONS_REVOKED",
        context,
      );
      await client.query("COMMIT");
      return {
        message: "All other active sessions were revoked.",
        revokedSessionCount: result.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async requestClosure(
    userId: string,
    dto: CreateClosureRequestDto,
    context: RequestContext,
  ) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        user_status: string;
        password_hash: string;
        wallet_status: string;
        balance_minor: string;
      }>(
        `
          SELECT users.status AS user_status, credentials.password_hash,
                 wallets.status AS wallet_status, wallets.balance_minor
          FROM users
          JOIN user_credentials credentials ON credentials.user_id = users.id
          JOIN wallets ON wallets.user_id = users.id AND wallets.currency = 'INR'
          WHERE users.id = $1
          FOR UPDATE OF users, credentials, wallets
        `,
        [userId],
      );
      const account = result.rows[0];
      if (!account) throw new NotFoundException("Account was not found.");
      if (!(await compare(dto.password, account.password_hash))) {
        throw new UnauthorizedException("Current password is incorrect.");
      }
      if (account.user_status !== "ACTIVE" || account.wallet_status !== "ACTIVE") {
        throw new ForbiddenException("Only an active account can request closure.");
      }
      if (BigInt(account.balance_minor) !== 0n) {
        throw new UnprocessableEntityException(
          "Wallet balance must be zero before requesting account closure.",
        );
      }
      const existing = await client.query(
        `
          SELECT id FROM account_closure_requests
          WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED')
          LIMIT 1
        `,
        [userId],
      );
      if (existing.rows[0]) {
        throw new ConflictException("An active closure request already exists.");
      }
      const id = randomUUID();
      const inserted = await client.query<ClosureRow>(
        `
          INSERT INTO account_closure_requests (id, user_id, reason)
          VALUES ($1, $2, $3)
          RETURNING id, status, reason, requested_at, cancelled_at,
                    reviewed_at, resolution_note, completed_at
        `,
        [id, userId, dto.reason ?? null],
      );
      await this.enqueue(
        client,
        "account.closure.requested",
        "ACCOUNT_CLOSURE_REQUEST",
        id,
        { userId, ipAddress: context.ipAddress ?? null },
      );
      await client.query("COMMIT");
      return {
        message: "Account closure request submitted for review.",
        request: this.mapClosure(inserted.rows[0]),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelClosure(userId: string, requestId: string) {
    this.assertUuid(requestId, "closure request");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ClosureRow>(
        `
          UPDATE account_closure_requests
          SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND user_id = $1 AND status = 'PENDING'
          RETURNING id, status, reason, requested_at, cancelled_at,
                    reviewed_at, resolution_note, completed_at
        `,
        [userId, requestId],
      );
      if (!result.rows[0]) {
        throw new ConflictException(
          "Only your pending closure request can be cancelled.",
        );
      }
      await this.enqueue(
        client,
        "account.closure.cancelled",
        "ACCOUNT_CLOSURE_REQUEST",
        requestId,
        { userId },
      );
      await client.query("COMMIT");
      return {
        message: "Account closure request cancelled.",
        request: this.mapClosure(result.rows[0]),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private appendEvent(
    client: PoolClient,
    userId: string,
    eventType: string,
    context: RequestContext,
  ) {
    return client.query(
      `
        INSERT INTO authentication_events (
          id, user_id, event_type, ip_address, user_agent
        )
        VALUES ($1, $2, $3::auth_event_type, $4, $5)
      `,
      [
        randomUUID(),
        userId,
        eventType,
        context.ipAddress ?? null,
        context.userAgent ?? null,
      ],
    );
  }

  private enqueue(
    client: PoolClient,
    jobType: string,
    resourceType: string,
    resourceId: string,
    payload: Record<string, unknown>,
  ) {
    return client.query(
      `
        INSERT INTO background_jobs (
          id, job_type, resource_type, resource_id, payload
        )
        VALUES ($1, $2, $3, $4, $5::JSONB)
      `,
      [randomUUID(), jobType, resourceType, resourceId, JSON.stringify(payload)],
    );
  }

  private mapClosure(row: ClosureRow) {
    return {
      id: row.id,
      status: row.status,
      reason: row.reason,
      requestedAt: row.requested_at,
      cancelledAt: row.cancelled_at,
      reviewedAt: row.reviewed_at,
      resolutionNote: row.resolution_note,
      completedAt: row.completed_at,
    };
  }

  private deviceName(userAgent: string | null) {
    if (!userAgent) return "Unknown device";
    const browser = /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : "Browser";
    const platform = /Windows/.test(userAgent)
      ? "Windows"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /Mac OS/.test(userAgent)
            ? "macOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "device";
    return `${browser} on ${platform}`;
  }

  private assertUuid(value: string, label: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      throw new BadRequestException(`Invalid ${label} identifier.`);
    }
  }
}
