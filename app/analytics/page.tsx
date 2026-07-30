"use client";

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Info,
  LoaderCircle,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./analytics.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type ChartPoint = {
  date: string;
  sentAmountMinor: string;
  receivedAmountMinor: string;
  fundedAmountMinor: string;
  sentCount: number;
  receivedCount: number;
  fundingCount: number;
  failedTransferCount: number;
};

type AnalyticsResponse = {
  wallet: {
    walletNumber: string;
    currency: "INR";
    status: string;
  };
  period: {
    dateFrom: string;
    dateTo: string;
  };
  totals: {
    sentAmountMinor: string;
    receivedAmountMinor: string;
    fundedAmountMinor: string;
    sentCount: number;
    receivedCount: number;
    fundingCount: number;
    failedTransferCount: number;
    averageSentAmountMinor: string;
    successRate: number | null;
  };
  chart: ChartPoint[];
  frequentRecipients: Array<{
    walletId: string;
    fullName: string;
    maskedWalletNumber: string;
    sentAmountMinor: string;
    sentCount: number;
    lastTransferAt: string | null;
  }>;
  freshness: {
    lastUpdatedAt: string | null;
    isStale: boolean;
  };
  disclaimer: string;
};

type Period = { dateFrom: string; dateTo: string };
type Preset = "7" | "30" | "90" | "custom";

function presetPeriod(days: number): Period {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function formatMoney(minor: string, compact = false) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 1 : 2,
    notation: compact ? "compact" : "standard",
  }).format(Number(minor) / 100);
}

function formatShortDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatDateTime(value: string | null) {
  if (!value) return "Awaiting processed activity";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function AnalyticsPage() {
  const router = useRouter();
  const started = useRef(false);
  const [accessToken, setAccessToken] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [preset, setPreset] = useState<Preset>("30");
  const [dates, setDates] = useState<Period>(() => presetPeriod(30));
  const [metric, setMetric] = useState<"amount" | "count">("amount");
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function fetchAnalytics(token: string, period: Period) {
    const params = new URLSearchParams(period);
    const response = await fetch(`${API_BASE_URL}/analytics?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await response.json().catch(() => null)) as
      | AnalyticsResponse
      | { message?: string | string[] }
      | null;
    if (!response.ok) {
      const message = body && "message" in body ? body.message : undefined;
      throw new Error(
        Array.isArray(message)
          ? message[0]
          : message ?? "Unable to load wallet analytics.",
      );
    }
    return body as AnalyticsResponse;
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
          router.replace("/login?next=/analytics");
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        const initialPeriod = presetPeriod(30);
        setAccessToken(session.accessToken);
        setAnalytics(await fetchAnalytics(session.accessToken, initialPeriod));
        setPageStatus("ready");
      } catch (loadError) {
        setError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load wallet analytics.",
        );
        setPageStatus("error");
      }
    }
    void load();
  }, [router]);

  async function loadPeriod(period: Period) {
    if (!accessToken) return;
    setRefreshing(true);
    setError("");
    try {
      setAnalytics(await fetchAnalytics(accessToken, period));
      setDates(period);
      setPageStatus("ready");
    } catch (periodError) {
      setError(
        periodError instanceof Error
          ? periodError.message
          : "Unable to load that analytics period.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  function selectPreset(next: Exclude<Preset, "custom">) {
    setPreset(next);
    void loadPeriod(presetPeriod(Number(next)));
  }

  function submitCustom(event: FormEvent) {
    event.preventDefault();
    setPreset("custom");
    void loadPeriod(dates);
  }

  if (pageStatus === "loading") {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Preparing your analytics…</p>
      </main>
    );
  }

  if (pageStatus === "error" || !analytics) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}>
          <AlertCircle size={28} />
        </span>
        <h1>Analytics unavailable</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  const values = analytics.chart.flatMap((point) =>
    metric === "amount"
      ? [Number(point.sentAmountMinor), Number(point.receivedAmountMinor)]
      : [point.sentCount, point.receivedCount],
  );
  const chartMaximum = Math.max(1, ...values);
  const successRate = analytics.totals.successRate ?? 0;

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
            <span className={styles.eyebrow}>Financial activity</span>
            <h1>Wallet analytics</h1>
            <p>
              Trends for wallet {analytics.wallet.walletNumber}, derived from
              processed activity summaries.
            </p>
          </div>
          <div className={styles.freshness}>
            <span
              className={
                analytics.freshness.isStale ? styles.staleDot : styles.liveDot
              }
            />
            <p>
              <small>Last updated</small>
              <strong>
                {formatDateTime(analytics.freshness.lastUpdatedAt)}
              </strong>
            </p>
            <button
              type="button"
              disabled={refreshing}
              aria-label="Refresh analytics"
              onClick={() => void loadPeriod(dates)}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>

        <section className={styles.periodCard}>
          <div className={styles.presets}>
            <CalendarDays size={17} />
            {(["7", "30", "90"] as const).map((value) => (
              <button
                className={preset === value ? styles.activePreset : ""}
                type="button"
                key={value}
                onClick={() => selectPreset(value)}
              >
                {value} days
              </button>
            ))}
            <button
              className={preset === "custom" ? styles.activePreset : ""}
              type="button"
              onClick={() => setPreset("custom")}
            >
              Custom
            </button>
          </div>
          {preset === "custom" && (
            <form className={styles.customDates} onSubmit={submitCustom}>
              <input
                type="date"
                value={dates.dateFrom}
                onChange={(event) =>
                  setDates((current) => ({
                    ...current,
                    dateFrom: event.target.value,
                  }))
                }
              />
              <span>to</span>
              <input
                type="date"
                value={dates.dateTo}
                onChange={(event) =>
                  setDates((current) => ({
                    ...current,
                    dateTo: event.target.value,
                  }))
                }
              />
              <button type="submit">Apply</button>
            </form>
          )}
        </section>

        {error && (
          <div className={styles.inlineError}>
            <Info size={15} />
            {error}
          </div>
        )}

        <section className={styles.summaryGrid}>
          <article>
            <span className={styles.sentIcon}>
              <ArrowUpRight size={19} />
            </span>
            <p>
              <small>Total sent</small>
              <strong>{formatMoney(analytics.totals.sentAmountMinor)}</strong>
              <span>{analytics.totals.sentCount} completed transfers</span>
            </p>
          </article>
          <article>
            <span className={styles.receivedIcon}>
              <ArrowDownLeft size={19} />
            </span>
            <p>
              <small>Total received</small>
              <strong>
                {formatMoney(analytics.totals.receivedAmountMinor)}
              </strong>
              <span>{analytics.totals.receivedCount} incoming transfers</span>
            </p>
          </article>
          <article>
            <span className={styles.averageIcon}>
              <TrendingUp size={19} />
            </span>
            <p>
              <small>Average sent</small>
              <strong>
                {formatMoney(analytics.totals.averageSentAmountMinor)}
              </strong>
              <span>Per completed transfer</span>
            </p>
          </article>
          <article>
            <span className={styles.fundedIcon}>
              <Sparkles size={19} />
            </span>
            <p>
              <small>Virtual funds added</small>
              <strong>{formatMoney(analytics.totals.fundedAmountMinor)}</strong>
              <span>{analytics.totals.fundingCount} funding activities</span>
            </p>
          </article>
        </section>

        <div className={styles.analyticsGrid}>
          <section className={`${styles.card} ${styles.chartCard}`}>
            <div className={styles.cardHeading}>
              <div>
                <h2>Transaction volume</h2>
                <p>Sent and received activity across the selected period.</p>
              </div>
              <div className={styles.metricToggle}>
                <button
                  className={metric === "amount" ? styles.activeMetric : ""}
                  type="button"
                  onClick={() => setMetric("amount")}
                >
                  Amount
                </button>
                <button
                  className={metric === "count" ? styles.activeMetric : ""}
                  type="button"
                  onClick={() => setMetric("count")}
                >
                  Count
                </button>
              </div>
            </div>
            <div className={styles.legend}>
              <span><i className={styles.sentLegend} />Sent</span>
              <span><i className={styles.receivedLegend} />Received</span>
            </div>
            <div className={styles.chartScroll}>
              <div
                className={styles.chart}
                style={{
                  minWidth: `${Math.max(analytics.chart.length * 34, 560)}px`,
                }}
              >
                {analytics.chart.map((point, index) => {
                  const sent =
                    metric === "amount"
                      ? Number(point.sentAmountMinor)
                      : point.sentCount;
                  const received =
                    metric === "amount"
                      ? Number(point.receivedAmountMinor)
                      : point.receivedCount;
                  const showLabel =
                    analytics.chart.length <= 14 ||
                    index % Math.ceil(analytics.chart.length / 10) === 0 ||
                    index === analytics.chart.length - 1;
                  return (
                    <div className={styles.chartDay} key={point.date}>
                      <div className={styles.bars}>
                        <span
                          className={styles.sentBar}
                          style={{
                            height: `${Math.max(
                              sent ? 4 : 0,
                              (sent / chartMaximum) * 100,
                            )}%`,
                          }}
                          title={`Sent: ${
                            metric === "amount"
                              ? formatMoney(String(sent), true)
                              : sent
                          }`}
                        />
                        <span
                          className={styles.receivedBar}
                          style={{
                            height: `${Math.max(
                              received ? 4 : 0,
                              (received / chartMaximum) * 100,
                            )}%`,
                          }}
                          title={`Received: ${
                            metric === "amount"
                              ? formatMoney(String(received), true)
                              : received
                          }`}
                        />
                      </div>
                      <small>{showLabel ? formatShortDate(point.date) : ""}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className={`${styles.card} ${styles.successCard}`}>
            <div className={styles.cardHeading}>
              <div>
                <h2>Transfer success</h2>
                <p>Outgoing attempts in this period.</p>
              </div>
            </div>
            <div
              className={styles.donut}
              style={{
                background: `conic-gradient(#5145cd ${successRate}%, #ececf3 0)`,
              }}
            >
              <div>
                <strong>
                  {analytics.totals.successRate === null
                    ? "—"
                    : `${analytics.totals.successRate}%`}
                </strong>
                <span>success rate</span>
              </div>
            </div>
            <div className={styles.outcomes}>
              <p>
                <CheckCircle2 size={15} />
                <span>Completed</span>
                <strong>{analytics.totals.sentCount}</strong>
              </p>
              <p>
                <AlertCircle size={15} />
                <span>Unsuccessful</span>
                <strong>{analytics.totals.failedTransferCount}</strong>
              </p>
            </div>
          </section>

          <section className={`${styles.card} ${styles.recipientsCard}`}>
            <div className={styles.cardHeading}>
              <div>
                <h2>Frequent recipients</h2>
                <p>Ranked by completed transfers and total sent.</p>
              </div>
              <UsersRound size={20} />
            </div>
            {analytics.frequentRecipients.length ? (
              <ol className={styles.recipientList}>
                {analytics.frequentRecipients.map((recipient, index) => (
                  <li key={recipient.walletId}>
                    <span className={styles.rank}>{index + 1}</span>
                    <span className={styles.avatar}>
                      {initials(recipient.fullName)}
                    </span>
                    <p>
                      <strong>{recipient.fullName}</strong>
                      <span>{recipient.maskedWalletNumber}</span>
                    </p>
                    <p className={styles.recipientAmount}>
                      <strong>{formatMoney(recipient.sentAmountMinor)}</strong>
                      <span>{recipient.sentCount} transfers</span>
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <div className={styles.emptyRecipients}>
                <UserRound size={26} />
                <strong>No frequent recipients yet</strong>
                <p>Completed outgoing transfers will appear here.</p>
                <Link href="/transfers/new">
                  <Send size={14} />
                  Send virtual money
                </Link>
              </div>
            )}
          </section>
        </div>

        <footer className={styles.disclaimer}>
          <WalletCards size={15} />
          <p>
            <strong>Informational summaries</strong>
            {analytics.disclaimer} Use Wallet Statement for the ledger-backed
            record.
          </p>
          <Link href="/wallet/statement">View statement</Link>
        </footer>
      </div>

      {refreshing && (
        <div className={styles.refreshOverlay}>
          <LoaderCircle size={20} />
          Updating analytics…
        </div>
      )}
    </main>
  );
}
