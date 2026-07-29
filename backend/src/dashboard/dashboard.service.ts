import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

type DashboardOwnerRow = {
  user_id: string;
  full_name: string;
  user_status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  wallet_id: string;
  wallet_number: string;
  currency: string;
  balance_minor: string;
  wallet_status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  wallet_updated_at: Date;
};

type TransferRow = {
  id: string;
  direction: "SENT" | "RECEIVED";
  counterparty_name: string;
  counterparty_wallet_number: string;
  amount_minor: string;
  currency: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  note: string | null;
  initiated_at: Date;
  completed_at: Date | null;
};

type DailySummaryRow = {
  summary_date: string | Date;
  sent_amount_minor: string;
  received_amount_minor: string;
  sent_count: number;
  received_count: number;
  failed_transfer_count: number;
};

type NotificationRow = {
  id: string;
  notification_type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  action_path: string | null;
  read_at: Date | null;
  created_at: Date;
};

@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async getDashboard(userId: string) {
    const ownerResult = await this.database.query<DashboardOwnerRow>(
      `
        SELECT
          u.id AS user_id,
          u.full_name,
          u.status AS user_status,
          u.email_verified_at,
          u.phone_verified_at,
          w.id AS wallet_id,
          w.wallet_number,
          w.currency,
          w.balance_minor,
          w.status AS wallet_status,
          w.updated_at AS wallet_updated_at
        FROM users u
        JOIN wallets w ON w.user_id = u.id AND w.currency = 'INR'
        WHERE u.id = $1
      `,
      [userId],
    );
    const owner = ownerResult.rows[0];
    if (!owner) {
      throw new NotFoundException({
        code: "DASHBOARD_NOT_AVAILABLE",
        message: "Your wallet dashboard is not available.",
      });
    }

    const [transfers, summaries, notifications, unread] = await Promise.all([
      this.database.query<TransferRow>(
        `
          SELECT
            t.id,
            CASE
              WHEN t.sender_wallet_id = $1 THEN 'SENT'
              ELSE 'RECEIVED'
            END AS direction,
            CASE
              WHEN t.sender_wallet_id = $1 THEN receiver_user.full_name
              ELSE sender_user.full_name
            END AS counterparty_name,
            CASE
              WHEN t.sender_wallet_id = $1 THEN receiver_wallet.wallet_number
              ELSE sender_wallet.wallet_number
            END AS counterparty_wallet_number,
            t.amount_minor,
            t.currency,
            t.status,
            t.note,
            t.initiated_at,
            t.completed_at
          FROM transfers t
          JOIN wallets sender_wallet ON sender_wallet.id = t.sender_wallet_id
          JOIN users sender_user ON sender_user.id = sender_wallet.user_id
          JOIN wallets receiver_wallet ON receiver_wallet.id = t.receiver_wallet_id
          JOIN users receiver_user ON receiver_user.id = receiver_wallet.user_id
          WHERE t.sender_wallet_id = $1 OR t.receiver_wallet_id = $1
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT 6
        `,
        [owner.wallet_id],
      ),
      this.database.query<DailySummaryRow>(
        `
          SELECT
            summary_date,
            sent_amount_minor,
            received_amount_minor,
            sent_count,
            received_count,
            failed_transfer_count
          FROM wallet_daily_summaries
          WHERE wallet_id = $1
            AND currency = $2
            AND summary_date >= date_trunc('month', CURRENT_DATE)::DATE
          ORDER BY summary_date
        `,
        [owner.wallet_id, owner.currency],
      ),
      this.database.query<NotificationRow>(
        `
          SELECT
            id,
            notification_type,
            severity,
            title,
            message,
            action_path,
            read_at,
            created_at
          FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 6
        `,
        [userId],
      ),
      this.database.query<{ unread_count: string }>(
        `
          SELECT COUNT(*)::TEXT AS unread_count
          FROM notifications
          WHERE user_id = $1 AND read_at IS NULL
        `,
        [userId],
      ),
    ]);

    const sentThisMonth = summaries.rows.reduce(
      (total, row) => total + BigInt(row.sent_amount_minor),
      0n,
    );
    const receivedThisMonth = summaries.rows.reduce(
      (total, row) => total + BigInt(row.received_amount_minor),
      0n,
    );
    const alerts = [];
    if (owner.user_status !== "ACTIVE") {
      alerts.push({
        code: "ACCOUNT_RESTRICTED",
        severity: "CRITICAL",
        message: "Your account currently has restrictions.",
      });
    }
    if (owner.wallet_status !== "ACTIVE") {
      alerts.push({
        code: "WALLET_RESTRICTED",
        severity: "CRITICAL",
        message: "Your wallet is currently unavailable for transactions.",
      });
    }
    if (!owner.email_verified_at) {
      alerts.push({
        code: "EMAIL_NOT_VERIFIED",
        severity: "WARNING",
        message: "Verify your email address to strengthen account recovery.",
      });
    }
    if (!owner.phone_verified_at) {
      alerts.push({
        code: "PHONE_NOT_VERIFIED",
        severity: "WARNING",
        message: "Verify your phone number to receive security alerts.",
      });
    }

    return {
      customer: {
        id: owner.user_id,
        fullName: owner.full_name,
        status: owner.user_status,
        emailVerified: Boolean(owner.email_verified_at),
        phoneVerified: Boolean(owner.phone_verified_at),
      },
      wallet: {
        id: owner.wallet_id,
        walletNumber: owner.wallet_number,
        currency: owner.currency.trim(),
        balanceMinor: owner.balance_minor,
        status: owner.wallet_status,
        updatedAt: owner.wallet_updated_at.toISOString(),
      },
      recentTransfers: transfers.rows.map((transfer) => ({
        id: transfer.id,
        direction: transfer.direction,
        counterpartyName: transfer.counterparty_name,
        counterpartyWalletNumber: transfer.counterparty_wallet_number,
        amountMinor: transfer.amount_minor,
        currency: transfer.currency.trim(),
        status: transfer.status,
        note: transfer.note,
        initiatedAt: transfer.initiated_at.toISOString(),
        completedAt: transfer.completed_at?.toISOString() ?? null,
      })),
      monthlySummary: {
        sentAmountMinor: sentThisMonth.toString(),
        receivedAmountMinor: receivedThisMonth.toString(),
        daily: summaries.rows.map((summary) => ({
          date:
            summary.summary_date instanceof Date
              ? summary.summary_date.toISOString().slice(0, 10)
              : summary.summary_date,
          sentAmountMinor: summary.sent_amount_minor,
          receivedAmountMinor: summary.received_amount_minor,
          sentCount: summary.sent_count,
          receivedCount: summary.received_count,
          failedTransferCount: summary.failed_transfer_count,
        })),
      },
      notifications: notifications.rows.map((notification) => ({
        id: notification.id,
        type: notification.notification_type,
        severity: notification.severity,
        title: notification.title,
        message: notification.message,
        actionPath: notification.action_path,
        readAt: notification.read_at?.toISOString() ?? null,
        createdAt: notification.created_at.toISOString(),
      })),
      unreadNotificationCount: Number(unread.rows[0]?.unread_count ?? 0),
      alerts,
    };
  }

  async markNotificationRead(userId: string, notificationId: string) {
    const result = await this.database.query<{ read_at: Date }>(
      `
        UPDATE notifications
        SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2
        RETURNING read_at
      `,
      [notificationId, userId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException({
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notification not found.",
      });
    }
    return { readAt: result.rows[0].read_at.toISOString() };
  }
}
