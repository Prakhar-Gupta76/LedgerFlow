"use client";

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BarChart3,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ReceiptText,
  Send,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type DashboardData = {
  customer: {
    id: string;
    fullName: string;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
  };
  wallet: {
    id: string;
    walletNumber: string;
    currency: string;
    balanceMinor: string;
    status: string;
    updatedAt: string;
  };
  recentTransfers: Array<{
    id: string;
    direction: "SENT" | "RECEIVED";
    counterpartyName: string;
    counterpartyWalletNumber: string;
    amountMinor: string;
    currency: string;
    status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
    note: string | null;
    initiatedAt: string;
  }>;
  monthlySummary: {
    sentAmountMinor: string;
    receivedAmountMinor: string;
    daily: Array<{
      date: string;
      sentAmountMinor: string;
      receivedAmountMinor: string;
      sentCount: number;
      receivedCount: number;
      failedTransferCount: number;
    }>;
  };
  notifications: Array<{
    id: string;
    type: string;
    severity: "INFO" | "WARNING" | "CRITICAL";
    title: string;
    message: string;
    actionPath: string | null;
    readAt: string | null;
    createdAt: string;
  }>;
  unreadNotificationCount: number;
  alerts: Array<{
    code: string;
    severity: "WARNING" | "CRITICAL";
    message: string;
  }>;
};

type RefreshResponse = {
  accessToken: string;
};

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function formatMoney(minor: string, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function DashboardPage() {
  const router = useRouter();
  const started = useRef(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    async function loadDashboard() {
      try {
        const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!refreshResponse.ok) {
          router.replace("/login?next=/dashboard");
          return;
        }
        const session = (await refreshResponse.json()) as RefreshResponse;
        setAccessToken(session.accessToken);
        const dashboardResponse = await fetch(`${API_BASE_URL}/dashboard`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!dashboardResponse.ok) {
          const body = (await dashboardResponse.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(body?.message ?? "Unable to load your dashboard.");
        }
        setData((await dashboardResponse.json()) as DashboardData);
        setStatus("ready");
      } catch (loadError) {
        setError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load your dashboard.",
        );
        setStatus("error");
      }
    }

    void loadDashboard();
  }, [router]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const rows = data.monthlySummary.daily.slice(-10);
    if (rows.length) return rows;
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return {
        date: date.toISOString().slice(0, 10),
        sentAmountMinor: "0",
        receivedAmountMinor: "0",
        sentCount: 0,
        receivedCount: 0,
        failedTransferCount: 0,
      };
    });
  }, [data]);

  const chartMaximum = Math.max(
    1,
    ...chartData.flatMap((day) => [
      Number(day.sentAmountMinor),
      Number(day.receivedAmountMinor),
    ]),
  );

  async function markNotificationRead(notificationId: string) {
    if (!data || !accessToken) return;
    const notification = data.notifications.find((item) => item.id === notificationId);
    if (!notification || notification.readAt) return;
    const response = await fetch(
      `${API_BASE_URL}/dashboard/notifications/${notificationId}/read`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return;
    const result = (await response.json()) as { readAt: string };
    setData((current) =>
      current
        ? {
            ...current,
            unreadNotificationCount: Math.max(
              0,
              current.unreadNotificationCount - 1,
            ),
            notifications: current.notifications.map((item) =>
              item.id === notificationId
                ? { ...item, readAt: result.readAt }
                : item,
            ),
          }
        : current,
    );
  }

  async function logout() {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => undefined);
    router.replace("/login");
  }

  if (status === "loading") {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Preparing your wallet overview…</p>
      </main>
    );
  }

  if (status === "error" || !data) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}><AlertTriangle size={29} /></span>
        <h1>Dashboard unavailable</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  const sent = Number(data.monthlySummary.sentAmountMinor);
  const received = Number(data.monthlySummary.receivedAmountMinor);
  const activityTotal = sent + received;
  const sentShare = activityTotal ? Math.round((sent / activityTotal) * 100) : 0;
  const firstName = data.customer.fullName.split(" ")[0];

  return (
    <main className={styles.page}>
      <aside className={`${styles.sidebar} ${mobileNavOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.sidebarTop}>
          <Link className={styles.brand} href="/">
            <BrandMark />
            <span>LedgerFlow</span>
          </Link>
          <button
            className={styles.closeNav}
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <nav className={styles.nav}>
          <span>Workspace</span>
          <Link className={styles.navActive} href="/dashboard">
            <LayoutDashboard size={18} />
            Overview
          </Link>
          <Link href="/transactions">
            <ReceiptText size={18} />
            Transactions
          </Link>
          <Link href="/wallet/statement">
            <CreditCard size={18} />
            Wallet statement
          </Link>
          <Link href="/analytics">
            <BarChart3 size={18} />
            Analytics
          </Link>
          <Link href="/transfers/new">
            <Send size={18} />
            Send money
          </Link>
          <Link href="/wallet/add-funds">
            <CircleDollarSign size={18} />
            Add funds
          </Link>
          <span>Account</span>
          <Link href="/notifications">
            <Bell size={18} />
            Notifications
            {data.unreadNotificationCount > 0 && (
              <small>{data.unreadNotificationCount}</small>
            )}
          </Link>
          <Link href="/profile">
            <UserRound size={18} />
            Profile
          </Link>
        </nav>

        <div className={styles.sidebarSecurity}>
          <ShieldCheck size={19} />
          <p><strong>Protected session</strong>Your access is securely renewed.</p>
        </div>
        <button className={styles.logout} type="button" onClick={() => void logout()}>
          <LogOut size={17} />
          Log out
        </button>
      </aside>

      {mobileNavOpen && (
        <button
          className={styles.navBackdrop}
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <section className={styles.workspace}>
        <header className={styles.header}>
          <div className={styles.headerGreeting}>
            <button
              className={styles.menuButton}
              type="button"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu size={21} />
            </button>
            <div>
              <p>Good to see you, {firstName}</p>
              <span>Here’s what’s happening with your wallet.</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.notificationButton} href="/notifications">
              <Bell size={19} />
              {data.unreadNotificationCount > 0 && <span />}
            </Link>
            <div className={styles.avatar}>
              {data.customer.fullName
                .split(" ")
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase()}
            </div>
          </div>
        </header>

        <div className={styles.content}>
          {data.alerts.length > 0 && (
            <div className={styles.alertStrip}>
              <AlertTriangle size={18} />
              <p>
                <strong>Account attention needed</strong>
                {data.alerts[0].message}
              </p>
              <button type="button">Review</button>
            </div>
          )}

          <section className={styles.heroGrid}>
            <article className={styles.balanceCard}>
              <div className={styles.balanceTop}>
                <span><WalletCards size={16} /> Available balance</span>
                <small className={styles.statusBadge}>{data.wallet.status}</small>
              </div>
              <strong>{formatMoney(data.wallet.balanceMinor, data.wallet.currency)}</strong>
              <p>Wallet · {data.wallet.walletNumber}</p>
              <div className={styles.balanceActions}>
                <Link href="/transfers/new"><Send size={16} /> Send money</Link>
                <Link href="/wallet/add-funds"><Plus size={16} /> Add funds</Link>
                <Link href="/transactions"><ReceiptText size={16} /> History</Link>
              </div>
              <div className={styles.cardOrb} />
            </article>

            <article className={styles.monthlyCard}>
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.sectionLabel}>This month</span>
                  <h2>Money movement</h2>
                </div>
                <Clock3 size={18} />
              </div>
              <div className={styles.monthlyFigures}>
                <div>
                  <span className={styles.sentIcon}><TrendingDown size={16} /></span>
                  <p><small>Money sent</small><strong>{formatMoney(data.monthlySummary.sentAmountMinor)}</strong></p>
                </div>
                <div>
                  <span className={styles.receivedIcon}><TrendingUp size={16} /></span>
                  <p><small>Money received</small><strong>{formatMoney(data.monthlySummary.receivedAmountMinor)}</strong></p>
                </div>
              </div>
            </article>
          </section>

          <section className={styles.mainGrid}>
            <article className={styles.activityCard}>
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.sectionLabel}>Monthly activity</span>
                  <h2>Wallet flow</h2>
                </div>
                <div className={styles.legend}>
                  <span><i className={styles.legendReceived} />Received</span>
                  <span><i className={styles.legendSent} />Sent</span>
                </div>
              </div>
              <div className={styles.chart}>
                {chartData.map((day) => (
                  <div className={styles.chartColumn} key={day.date}>
                    <div className={styles.bars}>
                      <i
                        className={styles.receivedBar}
                        style={{
                          height: `${Math.max(
                            4,
                            (Number(day.receivedAmountMinor) / chartMaximum) * 118,
                          )}px`,
                        }}
                      />
                      <i
                        className={styles.sentBar}
                        style={{
                          height: `${Math.max(
                            4,
                            (Number(day.sentAmountMinor) / chartMaximum) * 118,
                          )}px`,
                        }}
                      />
                    </div>
                    <span>
                      {new Date(`${day.date}T00:00:00`).toLocaleDateString("en-IN", {
                        day: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              </div>
              <p className={styles.consistencyNote}>
                Analytics are updated asynchronously and do not determine your balance.
              </p>
            </article>

            <article className={styles.spendingCard}>
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.sectionLabel}>Spending overview</span>
                  <h2>Outgoing share</h2>
                </div>
              </div>
              <div className={styles.donutWrap}>
                <div
                  className={styles.donut}
                  style={{
                    background: `conic-gradient(#5bdbb2 0 ${sentShare}%, #e8eeea ${sentShare}% 100%)`,
                  }}
                >
                  <span><strong>{sentShare}%</strong><small>sent</small></span>
                </div>
              </div>
              <div className={styles.spendingFooter}>
                <p><span>Total sent</span><strong>{formatMoney(data.monthlySummary.sentAmountMinor)}</strong></p>
                <p><span>Net flow</span><strong>{formatMoney(String(received - sent))}</strong></p>
              </div>
            </article>
          </section>

          <section className={styles.bottomGrid}>
            <article className={styles.listCard}>
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.sectionLabel}>Latest activity</span>
                  <h2>Recent transactions</h2>
                </div>
                <Link href="/transactions">View all <ChevronRight size={14} /></Link>
              </div>
              {data.recentTransfers.length ? (
                <div className={styles.transactionList}>
                  {data.recentTransfers.map((transfer) => (
                    <div className={styles.transaction} key={transfer.id}>
                      <span className={transfer.direction === "SENT" ? styles.transactionSent : styles.transactionReceived}>
                        {transfer.direction === "SENT" ? <ArrowUpRight size={18} /> : <ArrowDownLeft size={18} />}
                      </span>
                      <p>
                        <strong>{transfer.counterpartyName}</strong>
                        <small>{transfer.note ?? transfer.counterpartyWalletNumber}</small>
                      </p>
                      <div>
                        <strong className={transfer.direction === "SENT" ? styles.amountSent : styles.amountReceived}>
                          {transfer.direction === "SENT" ? "−" : "+"}
                          {formatMoney(transfer.amountMinor, transfer.currency)}
                        </strong>
                        <small>{formatRelativeDate(transfer.initiatedAt)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <CreditCard size={25} />
                  <p><strong>No transfers yet</strong>Your sent and received money will appear here.</p>
                </div>
              )}
            </article>

            <article className={styles.listCard}>
              <div className={styles.cardHeading}>
                <div>
                  <span className={styles.sectionLabel}>Stay informed</span>
                  <h2>Notifications</h2>
                </div>
                {data.unreadNotificationCount > 0 && (
                  <small className={styles.unreadBadge}>
                    {data.unreadNotificationCount} new
                  </small>
                )}
              </div>
              {data.notifications.length ? (
                <div className={styles.notificationList}>
                  {data.notifications.map((notification) => (
                    <button
                      className={`${styles.notification} ${
                        !notification.readAt ? styles.notificationUnread : ""
                      }`}
                      type="button"
                      key={notification.id}
                      onClick={() => void markNotificationRead(notification.id)}
                    >
                      <span className={styles.notificationIcon}><Bell size={16} /></span>
                      <p><strong>{notification.title}</strong><small>{notification.message}</small></p>
                      <time>{formatRelativeDate(notification.createdAt)}</time>
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <Bell size={25} />
                  <p><strong>You’re all caught up</strong>Important wallet updates will appear here.</p>
                </div>
              )}
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}
