"use client";

import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronRight,
  CircleDollarSign,
  Filter,
  Info,
  LoaderCircle,
  Mail,
  MessageCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import styles from "./notifications.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type NotificationItem = {
  id: string;
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  relatedResourceType: string | null;
  relatedResourceId: string | null;
  actionPath: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationsResponse = {
  unreadCount: number;
  filteredCount: number;
  items: NotificationItem[];
  nextCursor: string | null;
};

type Filters = {
  state: "ALL" | "UNREAD";
  type: string;
  severity: string;
  dateFrom: string;
  dateTo: string;
};

const initialFilters: Filters = {
  state: "ALL",
  type: "",
  severity: "",
  dateFrom: "",
  dateTo: "",
};

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    WELCOME: "Welcome",
    WALLET_FUNDED: "Wallet funding",
    TRANSFER_SENT: "Money sent",
    TRANSFER_RECEIVED: "Money received",
    TRANSFER_FAILED: "Transfer unsuccessful",
    TRANSFER_REVERSED: "Transfer reversed",
    WALLET_STATUS_CHANGED: "Wallet status",
    ACCOUNT_SECURITY: "Account security",
    SYSTEM_MESSAGE: "System message",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function NotificationIcon({ type }: { type: string }) {
  if (type === "WALLET_FUNDED") return <CircleDollarSign size={19} />;
  if (type === "TRANSFER_SENT") return <Send size={19} />;
  if (type === "TRANSFER_RECEIVED") return <Mail size={19} />;
  if (type === "TRANSFER_REVERSED") return <RotateCcw size={19} />;
  if (type === "TRANSFER_FAILED") return <AlertCircle size={19} />;
  if (type === "ACCOUNT_SECURITY") return <ShieldAlert size={19} />;
  if (type === "WALLET_STATUS_CHANGED") return <WalletCards size={19} />;
  if (type === "WELCOME") return <BellRing size={19} />;
  return <MessageCircle size={19} />;
}

export default function NotificationsPage() {
  const router = useRouter();
  const started = useRef(false);
  const [accessToken, setAccessToken] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<Filters>(initialFilters);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [error, setError] = useState("");

  function buildQuery(selected: Filters, cursor?: string | null) {
    const params = new URLSearchParams({
      state: selected.state,
      limit: "20",
    });
    if (selected.type) params.set("type", selected.type);
    if (selected.severity) params.set("severity", selected.severity);
    if (selected.dateFrom) params.set("dateFrom", selected.dateFrom);
    if (selected.dateTo) params.set("dateTo", selected.dateTo);
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function fetchNotifications(
    token: string,
    selected: Filters,
    cursor?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/notifications?${buildQuery(selected, cursor)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await response.json().catch(() => null)) as
      | NotificationsResponse
      | { message?: string | string[] }
      | null;
    if (!response.ok) {
      const message = body && "message" in body ? body.message : undefined;
      throw new Error(
        Array.isArray(message)
          ? message[0]
          : message ?? "Unable to load notifications.",
      );
    }
    return body as NotificationsResponse;
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    async function load() {
      try {
        const refresh = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!refresh.ok) {
          router.replace("/login?next=/notifications");
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        setAccessToken(session.accessToken);
        setData(
          await fetchNotifications(session.accessToken, initialFilters),
        );
        setPageStatus("ready");
      } catch (loadError) {
        setError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load notifications.",
        );
        setPageStatus("error");
      }
    }
    void load();
  }, [router]);

  async function applyFilters(
    selected = filters,
    event?: FormEvent,
  ) {
    event?.preventDefault();
    if (!accessToken) return;
    setError("");
    try {
      const response = await fetchNotifications(accessToken, selected);
      setFilters(selected);
      setAppliedFilters(selected);
      setData(response);
      setFilterOpen(false);
    } catch (filterError) {
      setError(
        filterError instanceof Error
          ? filterError.message
          : "Unable to apply notification filters.",
      );
    }
  }

  function changeState(state: Filters["state"]) {
    const next = { ...appliedFilters, state };
    void applyFilters(next);
  }

  async function markRead(notificationId: string) {
    if (!accessToken || !data) return;
    const item = data.items.find((notification) => notification.id === notificationId);
    if (!item || item.readAt) return;
    const response = await fetch(
      `${API_BASE_URL}/notifications/${notificationId}/read`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return;
    const result = (await response.json()) as { readAt: string };
    setData((current) => {
      if (!current) return current;
      const items = current.items
        .map((notification) =>
          notification.id === notificationId
            ? { ...notification, readAt: result.readAt }
            : notification,
        )
        .filter(
          (notification) =>
            appliedFilters.state !== "UNREAD" || !notification.readAt,
        );
      return {
        ...current,
        unreadCount: Math.max(0, current.unreadCount - 1),
        filteredCount:
          appliedFilters.state === "UNREAD"
            ? Math.max(0, current.filteredCount - 1)
            : current.filteredCount,
        items,
      };
    });
  }

  async function openNotification(
    event: MouseEvent<HTMLAnchorElement>,
    notification: NotificationItem,
  ) {
    if (!notification.readAt) void markRead(notification.id);
    if (!notification.actionPath) event.preventDefault();
  }

  async function markAllRead() {
    if (!accessToken || !data?.unreadCount) return;
    setMarkingAll(true);
    try {
      const response = await fetch(`${API_BASE_URL}/notifications/read-all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Unable to mark notifications read.");
      setData((current) =>
        current
          ? {
              ...current,
              unreadCount: 0,
              filteredCount:
                appliedFilters.state === "UNREAD"
                  ? 0
                  : current.filteredCount,
              items:
                appliedFilters.state === "UNREAD"
                  ? []
                  : current.items.map((item) => ({
                      ...item,
                      readAt: item.readAt ?? new Date().toISOString(),
                    })),
            }
          : current,
      );
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : "Unable to mark notifications read.",
      );
    } finally {
      setMarkingAll(false);
    }
  }

  async function loadMore() {
    if (!accessToken || !data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await fetchNotifications(
        accessToken,
        appliedFilters,
        data.nextCursor,
      );
      setData({
        ...next,
        items: [...data.items, ...next.items],
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load more notifications.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  if (pageStatus === "loading") {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Loading your notifications…</p>
      </main>
    );
  }

  if (pageStatus === "error" || !data) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}><AlertCircle size={28} /></span>
        <h1>Notifications unavailable</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  const activeFilterCount = [
    appliedFilters.type,
    appliedFilters.severity,
    appliedFilters.dateFrom,
    appliedFilters.dateTo,
  ].filter(Boolean).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandMark />
          <span>LedgerFlow</span>
        </Link>
        <Link className={styles.backLink} href="/dashboard">
          <ArrowLeft size={16} />
          Dashboard
        </Link>
      </header>

      <div className={styles.content}>
        <div className={styles.titleRow}>
          <div>
            <span className={styles.eyebrow}>In-app updates</span>
            <h1>Notifications</h1>
            <p>Wallet, transfer, account and security activity in one place.</p>
          </div>
          <button
            className={styles.markAllButton}
            type="button"
            disabled={!data.unreadCount || markingAll}
            onClick={() => void markAllRead()}
          >
            {markingAll ? <LoaderCircle size={16} /> : <CheckCheck size={16} />}
            {markingAll ? "Updating…" : "Mark all as read"}
          </button>
        </div>

        <section className={styles.unreadHero}>
          <span><BellRing size={25} /></span>
          <p>
            <small>Unread notifications</small>
            <strong>{data.unreadCount}</strong>
            <span>
              {data.unreadCount
                ? "Updates are waiting for your review."
                : "You’re all caught up."}
            </span>
          </p>
          <ShieldCheck size={22} />
        </section>

        <section className={styles.notificationCard}>
          <div className={styles.toolbar}>
            <div className={styles.tabs}>
              <button
                className={
                  appliedFilters.state === "ALL" ? styles.activeTab : ""
                }
                type="button"
                onClick={() => changeState("ALL")}
              >
                All
              </button>
              <button
                className={
                  appliedFilters.state === "UNREAD" ? styles.activeTab : ""
                }
                type="button"
                onClick={() => changeState("UNREAD")}
              >
                Unread
                {data.unreadCount > 0 && <span>{data.unreadCount}</span>}
              </button>
            </div>
            <p>{data.filteredCount} notifications</p>
            <button
              className={styles.filterButton}
              type="button"
              onClick={() => setFilterOpen(true)}
            >
              <SlidersHorizontal size={16} />
              Filters
              {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
            </button>
          </div>

          {error && (
            <div className={styles.inlineError}>
              <Info size={15} />
              {error}
              <button type="button" onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}

          {data.items.length ? (
            <div className={styles.notificationList}>
              {data.items.map((notification) => (
                <article
                  className={`${styles.notification} ${
                    notification.readAt ? "" : styles.unread
                  }`}
                  key={notification.id}
                >
                  <span
                    className={`${styles.notificationIcon} ${
                      styles[notification.severity.toLowerCase()]
                    }`}
                  >
                    <NotificationIcon type={notification.type} />
                  </span>
                  <div className={styles.notificationMain}>
                    <div>
                      <span>{typeLabel(notification.type)}</span>
                      {!notification.readAt && <i>New</i>}
                    </div>
                    <strong>{notification.title}</strong>
                    <p>{notification.message}</p>
                    <time>{relativeTime(notification.createdAt)}</time>
                  </div>
                  <div className={styles.notificationActions}>
                    {!notification.readAt && (
                      <button
                        type="button"
                        title="Mark as read"
                        onClick={() => void markRead(notification.id)}
                      >
                        <Check size={15} />
                      </button>
                    )}
                    {notification.actionPath && (
                      <Link
                        href={notification.actionPath}
                        onClick={(event) =>
                          void openNotification(event, notification)
                        }
                      >
                        View
                        <ChevronRight size={15} />
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Bell size={30} />
              <h2>
                {appliedFilters.state === "UNREAD"
                  ? "No unread notifications"
                  : "No notifications found"}
              </h2>
              <p>
                {activeFilterCount
                  ? "Try changing the selected filters."
                  : "New wallet and account updates will appear here."}
              </p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => void applyFilters(initialFilters)}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {data.nextCursor && (
            <button
              className={styles.loadMore}
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? <LoaderCircle size={16} /> : <RefreshCw size={16} />}
              {loadingMore ? "Loading…" : "Load more notifications"}
            </button>
          )}
        </section>
      </div>

      {filterOpen && (
        <div className={styles.filterBackdrop}>
          <form
            className={styles.filterDrawer}
            onSubmit={(event) => void applyFilters(filters, event)}
          >
            <div className={styles.filterHeading}>
              <div><Filter size={18} /><h2>Filter notifications</h2></div>
              <button type="button" onClick={() => setFilterOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <div className={styles.filterFields}>
              <label>
                <span>Notification type</span>
                <select
                  value={filters.type}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      type: event.target.value,
                    }))
                  }
                >
                  <option value="">All types</option>
                  <option value="WELCOME">Welcome</option>
                  <option value="WALLET_FUNDED">Wallet funding</option>
                  <option value="TRANSFER_SENT">Money sent</option>
                  <option value="TRANSFER_RECEIVED">Money received</option>
                  <option value="TRANSFER_FAILED">Unsuccessful transfer</option>
                  <option value="TRANSFER_REVERSED">Reversal</option>
                  <option value="WALLET_STATUS_CHANGED">Wallet status</option>
                  <option value="ACCOUNT_SECURITY">Account security</option>
                  <option value="SYSTEM_MESSAGE">System message</option>
                </select>
              </label>
              <label>
                <span>Severity</span>
                <select
                  value={filters.severity}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      severity: event.target.value,
                    }))
                  }
                >
                  <option value="">All severities</option>
                  <option value="INFO">Information</option>
                  <option value="WARNING">Warning</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </label>
              <div className={styles.dateGrid}>
                <label>
                  <span>From date</span>
                  <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        dateFrom: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>To date</span>
                  <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        dateTo: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className={styles.filterActions}>
              <button
                type="button"
                onClick={() =>
                  setFilters({
                    ...initialFilters,
                    state: appliedFilters.state,
                  })
                }
              >
                Reset
              </button>
              <button type="submit">
                <Search size={15} />
                Apply filters
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
