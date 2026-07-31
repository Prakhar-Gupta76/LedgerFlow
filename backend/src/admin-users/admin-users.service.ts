import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { AdminUsersQueryDto } from "./dto/admin-users-query.dto";
import { ClosureReviewDto } from "./dto/closure-review.dto";
import {
  ReactivateUserDto,
  RevokeSessionsDto,
  UserActionDto,
} from "./dto/user-action.dto";

type Role = "CUSTOMER" | "ADMIN";
type Context = { ipAddress?: string; userAgent?: string };
type CustomerRow = {
  id: string;
  full_name: string;
  email: string;
  phone_number: string;
  status: string;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  wallet_id: string;
  wallet_number: string;
  currency: string;
  balance_minor: string;
  wallet_status: string;
  wallet_created_at: Date;
  transfer_count: string;
  completed_transfer_count: string;
  failed_transfer_count: string;
};

@Injectable()
export class AdminUsersService {
  constructor(private readonly database: DatabaseService) {}

  async list(
    adminId: string,
    role: Role,
    query: AdminUsersQueryDto,
  ) {
    await this.assertAdministrator(this.database, adminId, role);
    const cursor = this.decodeCursor(query.cursor);
    const search = query.search?.toLowerCase() ?? "";
    const result = await this.database.query<{
      id: string;
      full_name: string;
      email: string;
      phone_number: string;
      status: string;
      email_verified_at: Date | null;
      phone_verified_at: Date | null;
      created_at: Date;
      wallet_number: string;
      currency: string;
      balance_minor: string;
      wallet_status: string;
      active_closure_status: string | null;
    }>(
      `
        SELECT
          users.id, users.full_name, users.email, users.phone_number,
          users.status, users.email_verified_at, users.phone_verified_at,
          users.created_at, wallets.wallet_number, wallets.currency,
          wallets.balance_minor, wallets.status AS wallet_status,
          closure.status AS active_closure_status
        FROM users
        JOIN wallets
          ON wallets.user_id = users.id AND wallets.currency = 'INR'
        LEFT JOIN LATERAL (
          SELECT status
          FROM account_closure_requests
          WHERE user_id = users.id
            AND status IN ('PENDING', 'APPROVED')
          ORDER BY requested_at DESC
          LIMIT 1
        ) closure ON TRUE
        WHERE users.role = 'CUSTOMER'
          AND ($2 = '' OR
            lower(users.full_name) LIKE '%' || $2 || '%' OR
            users.email LIKE '%' || $2 || '%' OR
            users.phone_number LIKE '%' || $2 || '%' OR
            users.id::TEXT = $2
          )
          AND ($3::TEXT IS NULL OR users.status::TEXT = $3)
          AND (
            $4::TIMESTAMPTZ IS NULL
            OR (users.created_at, users.id) < ($4::TIMESTAMPTZ, $5::UUID)
          )
        ORDER BY users.created_at DESC, users.id DESC
        LIMIT $1
      `,
      [
        query.limit + 1,
        search,
        query.status ?? null,
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
        fullName: row.full_name,
        email: row.email,
        phoneNumber: row.phone_number,
        status: row.status,
        emailVerified: Boolean(row.email_verified_at),
        phoneVerified: Boolean(row.phone_verified_at),
        registeredAt: row.created_at,
        wallet: {
          number: row.wallet_number,
          currency: row.currency,
          balanceMinor: row.balance_minor,
          status: row.wallet_status,
        },
        activeClosureStatus: row.active_closure_status,
      })),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ createdAt: last.created_at, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }

  async details(adminId: string, role: Role, userId: string) {
    this.assertUuid(userId, "user");
    await this.assertAdministrator(this.database, adminId, role);
    const customerResult = await this.database.query<CustomerRow>(
      `
        SELECT
          users.id, users.full_name, users.email, users.phone_number,
          users.status, users.email_verified_at, users.phone_verified_at,
          users.created_at, users.updated_at, users.closed_at,
          wallets.id AS wallet_id, wallets.wallet_number, wallets.currency,
          wallets.balance_minor, wallets.status AS wallet_status,
          wallets.created_at AS wallet_created_at,
          (
            SELECT COUNT(*)::TEXT FROM transfers
            WHERE sender_wallet_id = wallets.id OR receiver_wallet_id = wallets.id
          ) AS transfer_count,
          (
            SELECT COUNT(*)::TEXT FROM transfers
            WHERE (sender_wallet_id = wallets.id OR receiver_wallet_id = wallets.id)
              AND status = 'COMPLETED'
          ) AS completed_transfer_count,
          (
            SELECT COUNT(*)::TEXT FROM transfers
            WHERE sender_wallet_id = wallets.id AND status = 'FAILED'
          ) AS failed_transfer_count
        FROM users
        JOIN wallets ON wallets.user_id = users.id AND wallets.currency = 'INR'
        WHERE users.id = $1 AND users.role = 'CUSTOMER'
      `,
      [userId],
    );
    const customer = customerResult.rows[0];
    if (!customer) throw this.notFound();

    const [transferResult, eventResult, sessionResult, historyResult, closureResult] =
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
               OR (
                 transfers.receiver_wallet_id = $1
                 AND transfers.status IN ('COMPLETED', 'REVERSED')
               )
            ORDER BY transfers.initiated_at DESC
            LIMIT 10
          `,
          [customer.wallet_id],
        ),
        this.database.query<{
          id: string;
          event_type: string;
          failure_reason: string | null;
          ip_address: string | null;
          occurred_at: Date;
        }>(
          `
            SELECT id, event_type, failure_reason,
                   host(ip_address) AS ip_address, occurred_at
            FROM authentication_events
            WHERE user_id = $1
            ORDER BY occurred_at DESC
            LIMIT 12
          `,
          [userId],
        ),
        this.database.query<{
          id: string;
          created_at: Date;
          last_used_at: Date | null;
          expires_at: Date;
          revoked_at: Date | null;
          revocation_reason: string | null;
          ip_address: string | null;
          user_agent: string | null;
        }>(
          `
            SELECT id, created_at, last_used_at, expires_at, revoked_at,
                   revocation_reason, host(ip_address) AS ip_address, user_agent
            FROM auth_sessions
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 10
          `,
          [userId],
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
            FROM user_status_history history
            JOIN users admin ON admin.id = history.changed_by_user_id
            WHERE history.user_id = $1
            ORDER BY history.occurred_at DESC
            LIMIT 10
          `,
          [userId],
        ),
        this.database.query<{
          id: string;
          status: string;
          reason: string | null;
          requested_at: Date;
          reviewed_at: Date | null;
          resolution_note: string | null;
          completed_at: Date | null;
          cancelled_at: Date | null;
        }>(
          `
            SELECT id, status, reason, requested_at, reviewed_at,
                   resolution_note, completed_at, cancelled_at
            FROM account_closure_requests
            WHERE user_id = $1
            ORDER BY requested_at DESC
            LIMIT 8
          `,
          [userId],
        ),
      ]);

    return {
      customer: {
        id: customer.id,
        fullName: customer.full_name,
        email: customer.email,
        phoneNumber: customer.phone_number,
        status: customer.status,
        emailVerified: Boolean(customer.email_verified_at),
        phoneVerified: Boolean(customer.phone_verified_at),
        registeredAt: customer.created_at,
        updatedAt: customer.updated_at,
        closedAt: customer.closed_at,
      },
      wallet: {
        id: customer.wallet_id,
        number: customer.wallet_number,
        currency: customer.currency,
        balanceMinor: customer.balance_minor,
        status: customer.wallet_status,
        createdAt: customer.wallet_created_at,
      },
      transferOverview: {
        total: Number(customer.transfer_count),
        completed: Number(customer.completed_transfer_count),
        failed: Number(customer.failed_transfer_count),
      },
      recentTransfers: transferResult.rows.map((row) => ({
        id: row.id,
        reference: row.transfer_reference,
        direction: row.direction,
        counterpartyName: row.counterparty_name,
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: row.status,
        initiatedAt: row.initiated_at,
      })),
      securityEvents: eventResult.rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        failureReason: row.failure_reason,
        ipAddress: row.ip_address,
        occurredAt: row.occurred_at,
      })),
      sessions: sessionResult.rows.map((row) => ({
        id: row.id,
        device: this.deviceName(row.user_agent),
        ipAddress: row.ip_address,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        revocationReason: row.revocation_reason,
        active: !row.revoked_at && row.expires_at > new Date(),
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
      closureRequests: closureResult.rows.map((row) => ({
        id: row.id,
        status: row.status,
        reason: row.reason,
        requestedAt: row.requested_at,
        reviewedAt: row.reviewed_at,
        resolutionNote: row.resolution_note,
        completedAt: row.completed_at,
        cancelledAt: row.cancelled_at,
      })),
    };
  }

  suspend(
    adminId: string,
    role: Role,
    userId: string,
    dto: UserActionDto,
    context: Context,
  ) {
    return this.changeStatus(
      adminId,
      role,
      userId,
      ["ACTIVE", "PENDING_VERIFICATION"],
      "SUSPENDED",
      dto.reasonCode,
      dto.reason,
      "CUSTOMER_SUSPENDED",
      "account.suspended",
      context,
    );
  }

  reactivate(
    adminId: string,
    role: Role,
    userId: string,
    dto: ReactivateUserDto,
    context: Context,
  ) {
    return this.changeStatus(
      adminId,
      role,
      userId,
      ["SUSPENDED"],
      "ACTIVE",
      "REACTIVATED_AFTER_REVIEW",
      dto.reason,
      "CUSTOMER_REACTIVATED",
      "account.reactivated",
      context,
    );
  }

  async revokeSessions(
    adminId: string,
    role: Role,
    userId: string,
    dto: RevokeSessionsDto,
    context: Context,
  ) {
    this.assertUuid(userId, "user");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const admin = await this.assertAdministrator(client, adminId, role);
      await this.lockCustomer(client, userId);
      const revoked = await client.query(
        `
          UPDATE auth_sessions
          SET revoked_at = NOW(), revocation_reason = 'ADMIN_ACTION'
          WHERE user_id = $1 AND revoked_at IS NULL
        `,
        [userId],
      );
      await this.appendAudit(client, {
        adminId,
        adminReference: admin,
        action: "CUSTOMER_SESSIONS_REVOKED",
        resourceId: userId,
        reasonCode: "ADMIN_SECURITY_ACTION",
        context,
        metadata: {
          reason: dto.reason,
          revokedSessionCount: revoked.rowCount ?? 0,
        },
      });
      await client.query("COMMIT");
      return {
        message: "Customer sessions revoked.",
        revokedSessionCount: revoked.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reviewClosure(
    adminId: string,
    role: Role,
    userId: string,
    requestId: string,
    dto: ClosureReviewDto,
    context: Context,
  ) {
    this.assertUuid(userId, "user");
    this.assertUuid(requestId, "closure request");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const admin = await this.assertAdministrator(client, adminId, role);
      const customer = await this.lockCustomer(client, userId);
      const requestResult = await client.query<{ status: string }>(
        `
          SELECT status
          FROM account_closure_requests
          WHERE id = $1 AND user_id = $2
          FOR UPDATE
        `,
        [requestId, userId],
      );
      const request = requestResult.rows[0];
      if (!request) throw new NotFoundException("Closure request was not found.");

      if (dto.action === "APPROVE" || dto.action === "REJECT") {
        if (request.status !== "PENDING") {
          throw new ConflictException("Only a pending request can be reviewed.");
        }
        const nextStatus = dto.action === "APPROVE" ? "APPROVED" : "REJECTED";
        await client.query(
          `
            UPDATE account_closure_requests
            SET status = $3::closure_request_status,
                reviewed_by_user_id = $4,
                reviewed_at = NOW(),
                resolution_note = $5,
                updated_at = NOW()
            WHERE id = $1 AND user_id = $2
          `,
          [requestId, userId, nextStatus, adminId, dto.resolutionNote],
        );
        await this.appendAudit(client, {
          adminId,
          adminReference: admin,
          action: `ACCOUNT_CLOSURE_${nextStatus}`,
          resourceId: userId,
          reasonCode: `CLOSURE_${nextStatus}`,
          context,
          metadata: { closureRequestId: requestId },
        });
        await client.query("COMMIT");
        return { message: `Closure request ${nextStatus.toLowerCase()}.` };
      }

      if (request.status !== "APPROVED") {
        throw new ConflictException("The closure request must be approved first.");
      }
      if (customer.status === "CLOSED") {
        throw new ConflictException("Customer account is already closed.");
      }
      const walletResult = await client.query<{
        id: string;
        balance_minor: string;
        status: string;
      }>(
        `
          SELECT id, balance_minor, status
          FROM wallets
          WHERE user_id = $1 AND currency = 'INR'
          FOR UPDATE
        `,
        [userId],
      );
      const wallet = walletResult.rows[0];
      if (!wallet) throw new NotFoundException("Customer wallet was not found.");
      if (wallet.balance_minor !== "0") {
        throw new UnprocessableEntityException(
          "Wallet balance must be zero before account closure.",
        );
      }
      const pending = await client.query(
        `
          SELECT 1
          FROM transfers
          WHERE status = 'PENDING'
            AND (sender_wallet_id = $1 OR receiver_wallet_id = $1)
          UNION ALL
          SELECT 1
          FROM funding_transactions
          WHERE status = 'PENDING' AND wallet_id = $1
          LIMIT 1
        `,
        [wallet.id],
      );
      if (pending.rows[0]) {
        throw new UnprocessableEntityException(
          "Pending financial activity must finish before account closure.",
        );
      }

      await client.query(
        `
          UPDATE users
          SET status = 'CLOSED', closed_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [userId],
      );
      await client.query(
        `
          UPDATE wallets
          SET status = 'CLOSED', closed_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [wallet.id],
      );
      await client.query(
        `
          UPDATE account_closure_requests
          SET status = 'COMPLETED', completed_at = NOW(),
              resolution_note = $3, updated_at = NOW()
          WHERE id = $1 AND user_id = $2
        `,
        [requestId, userId, dto.resolutionNote],
      );
      await client.query(
        `
          UPDATE auth_sessions
          SET revoked_at = NOW(), revocation_reason = 'ADMIN_ACTION'
          WHERE user_id = $1 AND revoked_at IS NULL
        `,
        [userId],
      );
      await this.appendHistory(
        client,
        userId,
        customer.status,
        "CLOSED",
        "ACCOUNT_CLOSURE",
        dto.resolutionNote,
        adminId,
      );
      await this.appendAudit(client, {
        adminId,
        adminReference: admin,
        action: "ACCOUNT_CLOSURE_COMPLETED",
        resourceId: userId,
        reasonCode: "ACCOUNT_CLOSURE",
        context,
        metadata: { closureRequestId: requestId, walletId: wallet.id },
      });
      await this.enqueue(client, "account.closed", userId, {
        userId,
        closureRequestId: requestId,
      });
      await client.query("COMMIT");
      return { message: "Customer account closure completed." };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async changeStatus(
    adminId: string,
    role: Role,
    userId: string,
    allowedPrevious: string[],
    nextStatus: string,
    reasonCode: string,
    reason: string,
    auditAction: string,
    jobType: string,
    context: Context,
  ) {
    this.assertUuid(userId, "user");
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const admin = await this.assertAdministrator(client, adminId, role);
      const customer = await this.lockCustomer(client, userId);
      if (!allowedPrevious.includes(customer.status)) {
        throw new ConflictException(
          `Customer cannot transition from ${customer.status} to ${nextStatus}.`,
        );
      }
      await client.query(
        "UPDATE users SET status = $2::user_status, updated_at = NOW() WHERE id = $1",
        [userId, nextStatus],
      );
      await this.appendHistory(
        client,
        userId,
        customer.status,
        nextStatus,
        reasonCode,
        reason,
        adminId,
      );
      let revokedSessionCount = 0;
      if (nextStatus === "SUSPENDED") {
        const revoked = await client.query(
          `
            UPDATE auth_sessions
            SET revoked_at = NOW(), revocation_reason = 'ADMIN_ACTION'
            WHERE user_id = $1 AND revoked_at IS NULL
          `,
          [userId],
        );
        revokedSessionCount = revoked.rowCount ?? 0;
      }
      await this.appendAudit(client, {
        adminId,
        adminReference: admin,
        action: auditAction,
        resourceId: userId,
        reasonCode,
        context,
        metadata: {
          previousStatus: customer.status,
          newStatus: nextStatus,
          reason,
          revokedSessionCount,
        },
      });
      await this.enqueue(client, jobType, userId, {
        userId,
        previousStatus: customer.status,
        newStatus: nextStatus,
      });
      await client.query("COMMIT");
      return {
        message:
          nextStatus === "SUSPENDED"
            ? "Customer suspended and active sessions revoked."
            : "Customer reactivated. Wallet restrictions were not changed.",
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
    type AdminRow = {
      id: string;
      role: string;
      status: string;
    };
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

  private async lockCustomer(client: PoolClient, userId: string) {
    const result = await client.query<{ id: string; status: string }>(
      `
        SELECT id, status
        FROM users
        WHERE id = $1 AND role = 'CUSTOMER'
        FOR UPDATE
      `,
      [userId],
    );
    if (!result.rows[0]) throw this.notFound();
    return result.rows[0];
  }

  private appendHistory(
    client: PoolClient,
    userId: string,
    previousStatus: string,
    newStatus: string,
    reasonCode: string,
    reason: string,
    adminId: string,
  ) {
    return client.query(
      `
        INSERT INTO user_status_history (
          id, user_id, previous_status, new_status, reason_code,
          reason, changed_by_user_id
        )
        VALUES (
          $1, $2, $3::user_status, $4::user_status,
          $5::user_status_reason, $6, $7
        )
      `,
      [
        randomUUID(),
        userId,
        previousStatus,
        newStatus,
        reasonCode,
        reason,
        adminId,
      ],
    );
  }

  private appendAudit(
    client: PoolClient,
    input: {
      adminId: string;
      adminReference: string;
      action: string;
      resourceId: string;
      reasonCode: string;
      context: Context;
      metadata: Record<string, unknown>;
    },
  ) {
    const id = randomUUID();
    return client.query(
      `
        INSERT INTO audit_records (
          id, deduplication_key, actor_type, actor_user_id, actor_reference,
          action_type, resource_type, resource_id, outcome, severity,
          reason_code, source_type, ip_address, user_agent, metadata, occurred_at
        )
        VALUES (
          $1, $2, 'ADMIN', $3, $4, $5, 'USER_ACCOUNT', $6,
          'SUCCESS', 'WARNING', $7, 'ADMIN_API', $8, $9, $10::JSONB, NOW()
        )
      `,
      [
        id,
        `admin-user-action:${id}`,
        input.adminId,
        input.adminReference,
        input.action,
        input.resourceId,
        input.reasonCode,
        input.context.ipAddress ?? null,
        input.context.userAgent?.slice(0, 500) ?? null,
        JSON.stringify(input.metadata),
      ],
    );
  }

  private enqueue(
    client: PoolClient,
    jobType: string,
    userId: string,
    payload: Record<string, unknown>,
  ) {
    return client.query(
      `
        INSERT INTO background_jobs (
          id, job_type, resource_type, resource_id, payload
        )
        VALUES ($1, $2, 'USER_ACCOUNT', $3, $4::JSONB)
      `,
      [randomUUID(), jobType, userId, JSON.stringify(payload)],
    );
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
      ) {
        throw new Error();
      }
      this.assertUuid(parsed.id, "cursor");
      return parsed as { createdAt: string; id: string };
    } catch {
      throw new BadRequestException("Invalid pagination cursor.");
    }
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

  private forbidden() {
    return new ForbiddenException({
      code: "ADMIN_ACCESS_REQUIRED",
      message: "An active administrator account is required.",
    });
  }

  private notFound() {
    return new NotFoundException("Customer was not found.");
  }
}
