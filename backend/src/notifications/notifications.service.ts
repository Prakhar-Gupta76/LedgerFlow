import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { NotificationsQueryDto } from "./dto/notifications-query.dto";

type NotificationRow = {
  id: string;
  notification_type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  related_resource_type: string | null;
  related_resource_id: string | null;
  action_path: string | null;
  read_at: Date | null;
  created_at: Date;
};

type CursorPayload = {
  createdAt: string;
  notificationId: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly database: DatabaseService) {}

  async getNotifications(userId: string, query: NotificationsQueryDto) {
    this.validateRange(query);
    await this.assertUser(userId);
    const listFilter = this.buildFilter(userId, query, true);
    const countFilter = this.buildFilter(userId, query, false);
    const limit = query.limit ?? 20;
    const [listResult, countResult, unreadResult] = await Promise.all([
      this.database.query<NotificationRow>(
        `
          SELECT
            id,
            notification_type,
            severity,
            title,
            message,
            related_resource_type,
            related_resource_id,
            action_path,
            read_at,
            created_at
          FROM notifications
          WHERE ${listFilter.sql}
          ORDER BY created_at DESC, id DESC
          LIMIT $${listFilter.values.length + 1}
        `,
        [...listFilter.values, limit + 1],
      ),
      this.database.query<{ filtered_count: string }>(
        `
          SELECT COUNT(*)::TEXT AS filtered_count
          FROM notifications
          WHERE ${countFilter.sql}
        `,
        countFilter.values,
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
    const hasMore = listResult.rows.length > limit;
    const rows = hasMore ? listResult.rows.slice(0, limit) : listResult.rows;
    const last = rows[rows.length - 1];
    return {
      unreadCount: Number(unreadResult.rows[0].unread_count),
      filteredCount: Number(countResult.rows[0].filtered_count),
      items: rows.map((row) => this.mapNotification(row)),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              createdAt: last.created_at.toISOString(),
              notificationId: last.id,
            })
          : null,
    };
  }

  async markRead(userId: string, notificationId: string) {
    if (!this.isUuid(notificationId)) throw this.notificationNotFound();
    const result = await this.database.query<{
      id: string;
      read_at: Date;
    }>(
      `
        UPDATE notifications
        SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2
        RETURNING id, read_at
      `,
      [notificationId, userId],
    );
    if (!result.rows[0]) throw this.notificationNotFound();
    return {
      id: result.rows[0].id,
      readAt: result.rows[0].read_at.toISOString(),
    };
  }

  async markAllRead(userId: string) {
    const result = await this.database.query(
      `
        UPDATE notifications
        SET read_at = NOW()
        WHERE user_id = $1 AND read_at IS NULL
      `,
      [userId],
    );
    return { markedReadCount: result.rowCount ?? 0, unreadCount: 0 };
  }

  private async assertUser(userId: string) {
    const result = await this.database.query<{ status: string }>(
      "SELECT status FROM users WHERE id = $1",
      [userId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException({
        code: "NOTIFICATIONS_NOT_FOUND",
        message: "Notifications are unavailable for this account.",
      });
    }
  }

  private buildFilter(
    userId: string,
    query: NotificationsQueryDto,
    includeCursor: boolean,
  ) {
    const values: unknown[] = [userId];
    const conditions = ["user_id = $1"];
    const add = (sql: (position: number) => string, value: unknown) => {
      values.push(value);
      conditions.push(sql(values.length));
    };
    if (query.state === "UNREAD") conditions.push("read_at IS NULL");
    if (query.type) {
      add((position) => `notification_type = $${position}`, query.type);
    }
    if (query.severity) {
      add((position) => `severity = $${position}`, query.severity);
    }
    if (query.dateFrom) {
      add((position) => `created_at >= $${position}::DATE`, query.dateFrom);
    }
    if (query.dateTo) {
      add(
        (position) => `created_at < ($${position}::DATE + INTERVAL '1 day')`,
        query.dateTo,
      );
    }
    if (includeCursor && query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      values.push(cursor.createdAt, cursor.notificationId);
      conditions.push(
        `(created_at, id) < ($${values.length - 1}::TIMESTAMPTZ, $${values.length}::UUID)`,
      );
    }
    return { sql: conditions.join(" AND "), values };
  }

  private validateRange(query: NotificationsQueryDto) {
    if (
      query.dateFrom &&
      query.dateTo &&
      new Date(query.dateFrom) > new Date(query.dateTo)
    ) {
      throw new BadRequestException({
        code: "INVALID_NOTIFICATION_RANGE",
        message: "The start date must be before the end date.",
      });
    }
  }

  private mapNotification(row: NotificationRow) {
    return {
      id: row.id,
      type: row.notification_type,
      severity: row.severity,
      title: row.title,
      message: row.message,
      relatedResourceType: row.related_resource_type,
      relatedResourceId: row.related_resource_id,
      actionPath: row.action_path,
      readAt: row.read_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private encodeCursor(cursor: CursorPayload) {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  private decodeCursor(value: string): CursorPayload {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      ) as Partial<CursorPayload>;
      if (
        !parsed.createdAt ||
        !parsed.notificationId ||
        Number.isNaN(Date.parse(parsed.createdAt)) ||
        !this.isUuid(parsed.notificationId)
      ) {
        throw new Error("Invalid cursor");
      }
      return parsed as CursorPayload;
    } catch {
      throw new BadRequestException({
        code: "INVALID_NOTIFICATION_CURSOR",
        message: "The notification cursor is invalid.",
      });
    }
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private notificationNotFound() {
    return new NotFoundException({
      code: "NOTIFICATION_NOT_FOUND",
      message: "Notification not found.",
    });
  }
}
