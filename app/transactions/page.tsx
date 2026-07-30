"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Download,
  Filter,
  History,
  Info,
  LoaderCircle,
  ReceiptText,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./transactions.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type HistoryItem = {
  activityKey: string;
  sourceType: "TRANSFER" | "FUNDING";
  sourceId: string;
  reference: string;
  activityType:
    | "TRANSFER_SENT"
    | "TRANSFER_RECEIVED"
    | "FUNDS_ADDED"
    | "TRANSFER_REVERSED";
  direction: "DEBIT" | "CREDIT";
  counterpartyName: string;
  amountMinor: string;
  currency: "INR";
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  note: string | null;
  failureMessage: string | null;
  occurredAt: string;
  completedAt: string | null;
  detailPath: string;
};

type HistoryResponse = {
  wallet: {
    walletNumber: string;
    currency: "INR";
    status: string;
  };
  summary: {
    sentAmountMinor: string;
    receivedAmountMinor: string;
    fundedAmountMinor: string;
    activityCount: number;
    failedCount: number;
  };
  items: HistoryItem[];
  nextCursor: string | null;
};

type Filters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  activityType: string;
  direction: string;
  status: string;
  minAmount: string;
  maxAmount: string;
};

const initialFilters: Filters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  activityType: "",
  direction: "",
  status: "",
  minAmount: "",
  maxAmount: "",
};

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function formatMoney(minor: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activityLabel(type: HistoryItem["activityType"]) {
  return {
    TRANSFER_SENT: "Money sent",
    TRANSFER_RECEIVED: "Money received",
    FUNDS_ADDED: "Virtual funds added",
    TRANSFER_REVERSED: "Transfer reversed",
  }[type];
}

function ActivityIcon({ item }: { item: HistoryItem }) {
  if (item.activityType === "FUNDS_ADDED") return <CircleDollarSign size={18} />;
  if (item.activityType === "TRANSFER_REVERSED") return <RotateCcw size={18} />;
  return item.direction === "DEBIT" ? (
    <ArrowUpRight size={18} />
  ) : (
    <ArrowDownLeft size={18} />
  );
}

export default function TransactionsPage() {
  const router = useRouter();
  const started = useRef(false);
  const [accessToken, setAccessToken] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(initialFilters);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [error, setError] = useState("");

  function buildQuery(selected: Filters, cursor?: string | null) {
    const params = new URLSearchParams({ limit: "15" });
    if (selected.search.trim()) params.set("search", selected.search.trim());
    if (selected.dateFrom) params.set("dateFrom", selected.dateFrom);
    if (selected.dateTo) params.set("dateTo", selected.dateTo);
    if (selected.activityType) params.set("activityType", selected.activityType);
    if (selected.direction) params.set("direction", selected.direction);
    if (selected.status) params.set("status", selected.status);
    if (selected.minAmount) {
      params.set(
        "minAmountMinor",
        String(Math.round(Number(selected.minAmount) * 100)),
      );
    }
    if (selected.maxAmount) {
      params.set(
        "maxAmountMinor",
        String(Math.round(Number(selected.maxAmount) * 100)),
      );
    }
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function fetchHistory(
    token: string,
    selected: Filters,
    cursor?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/transactions?${buildQuery(selected, cursor)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await response.json().catch(() => null)) as
      | HistoryResponse
      | { message?: string | string[] }
      | null;
    if (!response.ok) {
      const message = body && "message" in body ? body.message : undefined;
      throw new Error(
        Array.isArray(message)
          ? message[0]
          : message ?? "Unable to load transaction history.",
      );
    }
    return body as HistoryResponse;
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
          router.replace("/login?next=/transactions");
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        setAccessToken(session.accessToken);
        setHistory(await fetchHistory(session.accessToken, initialFilters));
        setPageStatus("ready");
      } catch (loadError) {
        setError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load transaction history.",
        );
        setPageStatus("error");
      }
    }
    void load();
  }, [router]);

  async function applyFilters(event?: FormEvent) {
    event?.preventDefault();
    if (!accessToken) return;
    setPageStatus("loading");
    setError("");
    try {
      const response = await fetchHistory(accessToken, filters);
      setAppliedFilters(filters);
      setHistory(response);
      setFilterOpen(false);
      setPageStatus("ready");
    } catch (filterError) {
      setError(
        filterError instanceof Error
          ? filterError.message
          : "Unable to apply filters.",
      );
      setPageStatus("error");
    }
  }

  async function loadMore() {
    if (!accessToken || !history?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await fetchHistory(
        accessToken,
        appliedFilters,
        history.nextCursor,
      );
      setHistory({
        ...next,
        items: [...history.items, ...next.items],
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load more.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv() {
    if (!accessToken) return;
    setExporting(true);
    try {
      const params = buildQuery(appliedFilters);
      params.delete("limit");
      const response = await fetch(
        `${API_BASE_URL}/transactions/export?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) throw new Error("CSV export could not be created.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ledgerflow-transactions-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "CSV export could not be created.",
      );
    } finally {
      setExporting(false);
    }
  }

  function resetFilters() {
    setFilters(initialFilters);
  }

  if (pageStatus === "loading" && !history) {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Loading your wallet activity…</p>
      </main>
    );
  }

  if (pageStatus === "error" && !history) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}><Info size={27} /></span>
        <h1>History unavailable</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  if (!history) return null;

  const activeFilterCount = Object.values(appliedFilters).filter(Boolean).length;

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
            <span className={styles.eyebrow}>Wallet activity</span>
            <h1>Transaction history</h1>
            <p>
              Search and filter customer-visible activity for wallet{" "}
              {history.wallet.walletNumber}.
            </p>
          </div>
          <button
            className={styles.exportButton}
            type="button"
            disabled={exporting}
            onClick={() => void exportCsv()}
          >
            {exporting ? <LoaderCircle size={16} /> : <Download size={16} />}
            {exporting ? "Preparing…" : "Export CSV"}
          </button>
        </div>

        <section className={styles.summaryGrid}>
          <article>
            <span className={styles.sentIcon}><TrendingDown size={18} /></span>
            <p><small>Money sent</small><strong>{formatMoney(history.summary.sentAmountMinor)}</strong><span>Selected period</span></p>
          </article>
          <article>
            <span className={styles.receivedIcon}><TrendingUp size={18} /></span>
            <p><small>Money received</small><strong>{formatMoney(history.summary.receivedAmountMinor)}</strong><span>Selected period</span></p>
          </article>
          <article>
            <span className={styles.fundedIcon}><CircleDollarSign size={18} /></span>
            <p><small>Virtual funds added</small><strong>{formatMoney(history.summary.fundedAmountMinor)}</strong><span>Selected period</span></p>
          </article>
          <article>
            <span className={styles.activityIcon}><History size={18} /></span>
            <p><small>Total activity</small><strong>{history.summary.activityCount}</strong><span>{history.summary.failedCount} unsuccessful</span></p>
          </article>
        </section>

        <section className={styles.historyCard}>
          <form className={styles.toolbar} onSubmit={(event) => void applyFilters(event)}>
            <div className={styles.searchShell}>
              <Search size={17} />
              <input
                type="search"
                placeholder="Search reference, person, or note"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }))
                }
              />
            </div>
            <button className={styles.searchButton} type="submit">Search</button>
            <button
              className={styles.filterButton}
              type="button"
              onClick={() => setFilterOpen(true)}
            >
              <SlidersHorizontal size={16} />
              Filters
              {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
            </button>
          </form>

          {error && (
            <div className={styles.inlineError}>
              <Info size={15} />
              {error}
              <button type="button" onClick={() => setError("")}><X size={14} /></button>
            </div>
          )}

          <div className={styles.listHeader}>
            <span>Transaction</span>
            <span>Date</span>
            <span>Status</span>
            <span>Amount</span>
            <span />
          </div>

          {history.items.length ? (
            <div className={styles.transactionList}>
              {history.items.map((item) => (
                <Link
                  className={styles.transaction}
                  href={item.detailPath}
                  key={item.activityKey}
                >
                  <span className={`${styles.transactionIcon} ${styles[item.direction.toLowerCase()]}`}>
                    <ActivityIcon item={item} />
                  </span>
                  <div className={styles.transactionMain}>
                    <strong>{activityLabel(item.activityType)}</strong>
                    <small>
                      {item.counterpartyName}
                      {item.note ? ` · ${item.note}` : ""}
                    </small>
                    <span>{item.reference}</span>
                  </div>
                  <time>{formatDate(item.occurredAt)}</time>
                  <span className={`${styles.status} ${styles[item.status.toLowerCase()]}`}>
                    {item.status}
                  </span>
                  <strong className={item.direction === "DEBIT" ? styles.amountDebit : styles.amountCredit}>
                    {item.direction === "DEBIT" ? "−" : "+"}
                    {formatMoney(item.amountMinor)}
                  </strong>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <ReceiptText size={29} />
              <h2>No activity found</h2>
              <p>Try adjusting the filters or add virtual funds to get started.</p>
              <Link href="/wallet/add-funds">Add virtual funds <ArrowRight size={15} /></Link>
            </div>
          )}

          {history.nextCursor && (
            <button
              className={styles.loadMore}
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? <LoaderCircle size={16} /> : <History size={16} />}
              {loadingMore ? "Loading…" : "Load more activity"}
            </button>
          )}
        </section>
      </div>

      {filterOpen && (
        <div className={styles.filterBackdrop}>
          <aside className={styles.filterDrawer}>
            <div className={styles.filterHeading}>
              <div><Filter size={18} /><h2>Filter activity</h2></div>
              <button type="button" onClick={() => setFilterOpen(false)}><X size={19} /></button>
            </div>

            <div className={styles.filterFields}>
              <div className={styles.dateGrid}>
                <label>
                  <span>From date</span>
                  <div><CalendarDays size={15} /><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></div>
                </label>
                <label>
                  <span>To date</span>
                  <div><CalendarDays size={15} /><input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></div>
                </label>
              </div>

              <label>
                <span>Activity type</span>
                <select value={filters.activityType} onChange={(event) => setFilters((current) => ({ ...current, activityType: event.target.value }))}>
                  <option value="">All activity</option>
                  <option value="TRANSFER_SENT">Money sent</option>
                  <option value="TRANSFER_RECEIVED">Money received</option>
                  <option value="FUNDS_ADDED">Funds added</option>
                  <option value="TRANSFER_REVERSED">Reversals</option>
                </select>
              </label>

              <div className={styles.dateGrid}>
                <label>
                  <span>Direction</span>
                  <select value={filters.direction} onChange={(event) => setFilters((current) => ({ ...current, direction: event.target.value }))}>
                    <option value="">Debit and credit</option>
                    <option value="DEBIT">Debit</option>
                    <option value="CREDIT">Credit</option>
                  </select>
                </label>
                <label>
                  <span>Status</span>
                  <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                    <option value="">All statuses</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="PENDING">Pending</option>
                    <option value="FAILED">Failed</option>
                    <option value="REVERSED">Reversed</option>
                  </select>
                </label>
              </div>

              <div className={styles.dateGrid}>
                <label>
                  <span>Minimum amount (₹)</span>
                  <input type="number" min="0" step="0.01" value={filters.minAmount} onChange={(event) => setFilters((current) => ({ ...current, minAmount: event.target.value }))} />
                </label>
                <label>
                  <span>Maximum amount (₹)</span>
                  <input type="number" min="0" step="0.01" value={filters.maxAmount} onChange={(event) => setFilters((current) => ({ ...current, maxAmount: event.target.value }))} />
                </label>
              </div>
            </div>

            <div className={styles.filterActions}>
              <button className={styles.resetButton} type="button" onClick={resetFilters}>Reset</button>
              <button className={styles.applyButton} type="button" onClick={() => void applyFilters()}>Apply filters</button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
