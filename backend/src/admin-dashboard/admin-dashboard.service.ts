import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

@Injectable()
export class AdminDashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getDashboard(adminId: string, tokenRole: "CUSTOMER" | "ADMIN") {
    if (tokenRole !== "ADMIN") throw this.forbidden();
    const administrator = await this.database.query<{
      full_name: string;
      role: string;
      status: string;
    }>(
      "SELECT full_name, role, status FROM users WHERE id = $1",
      [adminId],
    );
    const admin = administrator.rows[0];
    if (!admin) throw new UnauthorizedException("Administrator was not found.");
    if (admin.role !== "ADMIN" || admin.status !== "ACTIVE") {
      throw this.forbidden();
    }

    const [
      customerResult,
      walletResult,
      walletBalanceResult,
      transferResult,
      transferVolumeResult,
      transferFailureResult,
      fundingResult,
      fundingVolumeResult,
      jobResult,
      recentJobResult,
      suspiciousIpResult,
      suspiciousAccountResult,
      recentTransferResult,
      recentFundingResult,
      auditResult,
    ] = await Promise.all([
      this.database.query<{
        total: string;
        active: string;
        pending_verification: string;
        suspended: string;
        closed: string;
        registered_24h: string;
      }>(`
        SELECT
          COUNT(*)::TEXT AS total,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')::TEXT AS active,
          COUNT(*) FILTER (WHERE status = 'PENDING_VERIFICATION')::TEXT
            AS pending_verification,
          COUNT(*) FILTER (WHERE status = 'SUSPENDED')::TEXT AS suspended,
          COUNT(*) FILTER (WHERE status = 'CLOSED')::TEXT AS closed,
          COUNT(*) FILTER (
            WHERE created_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS registered_24h
        FROM users
        WHERE role = 'CUSTOMER'
      `),
      this.database.query<{
        total: string;
        active: string;
        suspended: string;
        closed: string;
        created_24h: string;
      }>(`
        SELECT
          COUNT(*)::TEXT AS total,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')::TEXT AS active,
          COUNT(*) FILTER (WHERE status = 'SUSPENDED')::TEXT AS suspended,
          COUNT(*) FILTER (WHERE status = 'CLOSED')::TEXT AS closed,
          COUNT(*) FILTER (
            WHERE created_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS created_24h
        FROM wallets
      `),
      this.database.query<{ currency: string; balance_minor: string }>(`
        SELECT currency, SUM(balance_minor)::TEXT AS balance_minor
        FROM wallets
        WHERE status <> 'CLOSED'
        GROUP BY currency
        ORDER BY currency
      `),
      this.database.query<{
        total: string;
        pending: string;
        completed: string;
        failed: string;
        reversed: string;
        created_24h: string;
        completed_24h: string;
        failed_24h: string;
      }>(`
        SELECT
          COUNT(*)::TEXT AS total,
          COUNT(*) FILTER (WHERE status = 'PENDING')::TEXT AS pending,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::TEXT AS completed,
          COUNT(*) FILTER (WHERE status = 'FAILED')::TEXT AS failed,
          COUNT(*) FILTER (WHERE status = 'REVERSED')::TEXT AS reversed,
          COUNT(*) FILTER (
            WHERE initiated_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS created_24h,
          COUNT(*) FILTER (
            WHERE status = 'COMPLETED'
              AND completed_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS completed_24h,
          COUNT(*) FILTER (
            WHERE status = 'FAILED'
              AND failed_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS failed_24h
        FROM transfers
      `),
      this.database.query<{
        currency: string;
        all_time_minor: string;
        last_24h_minor: string;
      }>(`
        SELECT
          currency,
          COALESCE(SUM(amount_minor) FILTER (
            WHERE status = 'COMPLETED'
          ), 0)::TEXT AS all_time_minor,
          COALESCE(SUM(amount_minor) FILTER (
            WHERE status = 'COMPLETED'
              AND completed_at >= NOW() - INTERVAL '24 hours'
          ), 0)::TEXT AS last_24h_minor
        FROM transfers
        GROUP BY currency
        ORDER BY currency
      `),
      this.database.query<{ failure_code: string; count: string }>(`
        SELECT COALESCE(failure_code, 'UNCLASSIFIED') AS failure_code,
               COUNT(*)::TEXT AS count
        FROM transfers
        WHERE status = 'FAILED'
          AND initiated_at >= NOW() - INTERVAL '30 days'
        GROUP BY COALESCE(failure_code, 'UNCLASSIFIED')
        ORDER BY COUNT(*) DESC
        LIMIT 6
      `),
      this.database.query<{
        total: string;
        completed: string;
        failed: string;
        created_24h: string;
        failed_24h: string;
      }>(`
        SELECT
          COUNT(*)::TEXT AS total,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::TEXT AS completed,
          COUNT(*) FILTER (WHERE status = 'FAILED')::TEXT AS failed,
          COUNT(*) FILTER (
            WHERE initiated_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS created_24h,
          COUNT(*) FILTER (
            WHERE status = 'FAILED'
              AND initiated_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS failed_24h
        FROM funding_transactions
      `),
      this.database.query<{
        currency: string;
        all_time_minor: string;
        last_24h_minor: string;
      }>(`
        SELECT
          currency,
          COALESCE(SUM(amount_minor) FILTER (
            WHERE status = 'COMPLETED'
          ), 0)::TEXT AS all_time_minor,
          COALESCE(SUM(amount_minor) FILTER (
            WHERE status = 'COMPLETED'
              AND completed_at >= NOW() - INTERVAL '24 hours'
          ), 0)::TEXT AS last_24h_minor
        FROM funding_transactions
        GROUP BY currency
        ORDER BY currency
      `),
      this.database.query<{
        total: string;
        pending: string;
        processing: string;
        completed: string;
        failed: string;
        retrying: string;
        exhausted: string;
        completed_24h: string;
        oldest_pending_seconds: string | null;
      }>(`
        SELECT
          COUNT(*)::TEXT AS total,
          COUNT(*) FILTER (WHERE status = 'PENDING')::TEXT AS pending,
          COUNT(*) FILTER (WHERE status = 'PROCESSING')::TEXT AS processing,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::TEXT AS completed,
          COUNT(*) FILTER (WHERE status = 'FAILED')::TEXT AS failed,
          COUNT(*) FILTER (WHERE attempt_count > 1)::TEXT AS retrying,
          COUNT(*) FILTER (
            WHERE status = 'FAILED' AND attempt_count >= max_attempts
          )::TEXT AS exhausted,
          COUNT(*) FILTER (
            WHERE completed_at >= NOW() - INTERVAL '24 hours'
          )::TEXT AS completed_24h,
          EXTRACT(EPOCH FROM (
            NOW() - MIN(created_at) FILTER (
              WHERE status = 'PENDING' AND available_at <= NOW()
            )
          ))::BIGINT::TEXT AS oldest_pending_seconds
        FROM background_jobs
      `),
      this.database.query<{
        id: string;
        job_type: string;
        resource_type: string;
        status: string;
        attempt_count: number;
        max_attempts: number;
        last_error_code: string | null;
        created_at: Date;
        completed_at: Date | null;
      }>(`
        SELECT id, job_type, resource_type, status, attempt_count, max_attempts,
               last_error_code, created_at, completed_at
        FROM background_jobs
        WHERE status <> 'COMPLETED' OR completed_at >= NOW() - INTERVAL '24 hours'
        ORDER BY
          CASE status WHEN 'FAILED' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END,
          created_at DESC
        LIMIT 10
      `),
      this.database.query<{
        ip_address: string;
        event_count: string;
        known_user_count: string;
        last_seen_at: Date;
      }>(`
        SELECT
          COALESCE(host(ip_address), 'Unknown') AS ip_address,
          COUNT(*)::TEXT AS event_count,
          COUNT(DISTINCT user_id)::TEXT AS known_user_count,
          MAX(occurred_at) AS last_seen_at
        FROM authentication_events
        WHERE event_type IN ('LOGIN_FAILED', 'LOGIN_BLOCKED')
          AND occurred_at >= NOW() - INTERVAL '1 hour'
        GROUP BY ip_address
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC
        LIMIT 8
      `),
      this.database.query<{
        user_id: string | null;
        full_name: string | null;
        event_count: string;
        blocked_count: string;
        last_seen_at: Date;
      }>(`
        SELECT events.user_id, users.full_name,
               COUNT(*)::TEXT AS event_count,
               COUNT(*) FILTER (
                 WHERE events.event_type = 'LOGIN_BLOCKED'
               )::TEXT AS blocked_count,
               MAX(events.occurred_at) AS last_seen_at
        FROM authentication_events events
        LEFT JOIN users ON users.id = events.user_id
        WHERE events.event_type IN ('LOGIN_FAILED', 'LOGIN_BLOCKED')
          AND events.occurred_at >= NOW() - INTERVAL '24 hours'
        GROUP BY events.identifier_hash, events.user_id, users.full_name
        HAVING COUNT(*) >= 3
        ORDER BY COUNT(*) DESC
        LIMIT 8
      `),
      this.database.query<{
        id: string;
        transfer_reference: string;
        amount_minor: string;
        currency: string;
        status: string;
        sender_name: string;
        receiver_name: string;
        initiated_at: Date;
      }>(`
        SELECT transfers.id, transfers.transfer_reference,
               transfers.amount_minor, transfers.currency, transfers.status,
               sender.full_name AS sender_name,
               receiver.full_name AS receiver_name,
               transfers.initiated_at
        FROM transfers
        JOIN wallets sender_wallet ON sender_wallet.id = transfers.sender_wallet_id
        JOIN users sender ON sender.id = sender_wallet.user_id
        JOIN wallets receiver_wallet ON receiver_wallet.id = transfers.receiver_wallet_id
        JOIN users receiver ON receiver.id = receiver_wallet.user_id
        ORDER BY transfers.initiated_at DESC
        LIMIT 8
      `),
      this.database.query<{
        id: string;
        amount_minor: string;
        currency: string;
        status: string;
        full_name: string;
        initiated_at: Date;
      }>(`
        SELECT funding.id, funding.amount_minor, funding.currency,
               funding.status, users.full_name, funding.initiated_at
        FROM funding_transactions funding
        JOIN users ON users.id = funding.initiated_by_user_id
        ORDER BY funding.initiated_at DESC
        LIMIT 6
      `),
      this.database.query<{
        id: string;
        actor_type: string;
        actor_reference: string;
        actor_name: string | null;
        action_type: string;
        resource_type: string;
        outcome: string;
        severity: string;
        reason_code: string | null;
        occurred_at: Date;
      }>(`
        SELECT audit.id, audit.actor_type, audit.actor_reference,
               users.full_name AS actor_name, audit.action_type,
               audit.resource_type, audit.outcome, audit.severity,
               audit.reason_code, audit.occurred_at
        FROM audit_records audit
        LEFT JOIN users ON users.id = audit.actor_user_id
        WHERE audit.severity IN ('WARNING', 'CRITICAL')
           OR audit.occurred_at >= NOW() - INTERVAL '24 hours'
        ORDER BY audit.occurred_at DESC, audit.id DESC
        LIMIT 12
      `),
    ]);

    const customers = customerResult.rows[0];
    const wallets = walletResult.rows[0];
    const transfers = transferResult.rows[0];
    const funding = fundingResult.rows[0];
    const jobs = jobResult.rows[0];
    const completedTransfers = Number(transfers.completed);
    const failedTransfers = Number(transfers.failed);
    const decidedTransfers = completedTransfers + failedTransfers;

    return {
      generatedAt: new Date(),
      administrator: { fullName: admin.full_name },
      customers: {
        total: Number(customers.total),
        active: Number(customers.active),
        pendingVerification: Number(customers.pending_verification),
        suspended: Number(customers.suspended),
        closed: Number(customers.closed),
        registered24h: Number(customers.registered_24h),
      },
      wallets: {
        total: Number(wallets.total),
        active: Number(wallets.active),
        suspended: Number(wallets.suspended),
        closed: Number(wallets.closed),
        created24h: Number(wallets.created_24h),
        balances: walletBalanceResult.rows.map((row) => ({
          currency: row.currency,
          balanceMinor: row.balance_minor,
        })),
      },
      transfers: {
        total: Number(transfers.total),
        pending: Number(transfers.pending),
        completed: completedTransfers,
        failed: failedTransfers,
        reversed: Number(transfers.reversed),
        created24h: Number(transfers.created_24h),
        completed24h: Number(transfers.completed_24h),
        failed24h: Number(transfers.failed_24h),
        successRate:
          decidedTransfers === 0
            ? 100
            : Math.round((completedTransfers / decidedTransfers) * 1000) / 10,
        volumes: transferVolumeResult.rows.map((row) => ({
          currency: row.currency,
          allTimeMinor: row.all_time_minor,
          last24hMinor: row.last_24h_minor,
        })),
        failureCategories: transferFailureResult.rows.map((row) => ({
          code: row.failure_code,
          count: Number(row.count),
        })),
      },
      funding: {
        total: Number(funding.total),
        completed: Number(funding.completed),
        failed: Number(funding.failed),
        created24h: Number(funding.created_24h),
        failed24h: Number(funding.failed_24h),
        volumes: fundingVolumeResult.rows.map((row) => ({
          currency: row.currency,
          allTimeMinor: row.all_time_minor,
          last24hMinor: row.last_24h_minor,
        })),
      },
      jobs: {
        total: Number(jobs.total),
        pending: Number(jobs.pending),
        processing: Number(jobs.processing),
        completed: Number(jobs.completed),
        failed: Number(jobs.failed),
        retrying: Number(jobs.retrying),
        exhausted: Number(jobs.exhausted),
        completed24h: Number(jobs.completed_24h),
        oldestPendingSeconds: jobs.oldest_pending_seconds
          ? Number(jobs.oldest_pending_seconds)
          : null,
        recent: recentJobResult.rows.map((row) => ({
          id: row.id,
          type: row.job_type,
          resourceType: row.resource_type,
          status: row.status,
          attempts: row.attempt_count,
          maxAttempts: row.max_attempts,
          lastErrorCode: row.last_error_code,
          createdAt: row.created_at,
          completedAt: row.completed_at,
        })),
      },
      suspiciousActivity: {
        byIp: suspiciousIpResult.rows.map((row) => ({
          ipAddress: row.ip_address,
          eventCount: Number(row.event_count),
          knownUserCount: Number(row.known_user_count),
          lastSeenAt: row.last_seen_at,
        })),
        byAccount: suspiciousAccountResult.rows.map((row) => ({
          userId: row.user_id,
          displayName: row.full_name ?? "Unknown account",
          eventCount: Number(row.event_count),
          blockedCount: Number(row.blocked_count),
          lastSeenAt: row.last_seen_at,
        })),
      },
      recentActivity: {
        transfers: recentTransferResult.rows.map((row) => ({
          id: row.id,
          reference: row.transfer_reference,
          amountMinor: row.amount_minor,
          currency: row.currency,
          status: row.status,
          senderName: row.sender_name,
          receiverName: row.receiver_name,
          occurredAt: row.initiated_at,
        })),
        funding: recentFundingResult.rows.map((row) => ({
          id: row.id,
          amountMinor: row.amount_minor,
          currency: row.currency,
          status: row.status,
          customerName: row.full_name,
          occurredAt: row.initiated_at,
        })),
        audits: auditResult.rows.map((row) => ({
          id: row.id,
          actorType: row.actor_type,
          actorName: row.actor_name ?? row.actor_reference,
          action: row.action_type,
          resourceType: row.resource_type,
          outcome: row.outcome,
          severity: row.severity,
          reasonCode: row.reason_code,
          occurredAt: row.occurred_at,
        })),
      },
    };
  }

  private forbidden() {
    return new ForbiddenException({
      code: "ADMIN_ACCESS_REQUIRED",
      message: "An active administrator account is required.",
    });
  }
}
