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
  FileSpreadsheet,
  History,
  Info,
  LoaderCircle,
  Printer,
  ReceiptText,
  Search,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./wallet-statement.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type StatementEntry = {
  id: string;
  transactionType: string;
  sourceId: string;
  customerReference: string;
  entryType: "DEBIT" | "CREDIT";
  amountMinor: string;
  signedAmountMinor: string;
  balanceAfterMinor: string;
  currency: "INR";
  description: string;
  postedAt: string;
  detailPath: string | null;
};

type StatementResponse = {
  wallet: {
    walletNumber: string;
    currency: "INR";
    status: string;
  };
  period: {
    dateFrom: string;
    dateTo: string;
  };
  balances: {
    openingBalanceMinor: string;
    closingBalanceMinor: string;
    currentBalanceMinor: string;
  };
  summary: {
    debitTotalMinor: string;
    creditTotalMinor: string;
    entryCount: number;
  };
  entries: StatementEntry[];
  nextCursor: string | null;
  exportFormats: string[];
};

function currentPeriod() {
  const now = new Date();
  return {
    dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0",
    )}-01`,
    dateTo: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(now.getDate()).padStart(2, "0")}`,
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

function formatMoney(minor: string, signed = false) {
  const value = Number(minor) / 100;
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Math.abs(value));
  if (!signed || value === 0) return formatted;
  return `${value < 0 ? "−" : "+"}${formatted}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function periodLabel(from: string, to: string) {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(new Date(`${from}T00:00:00Z`))} – ${formatter.format(
    new Date(`${to}T00:00:00Z`),
  )}`;
}

export default function WalletStatementPage() {
  const router = useRouter();
  const started = useRef(false);
  const [accessToken, setAccessToken] = useState("");
  const [dates, setDates] = useState(currentPeriod);
  const [appliedDates, setAppliedDates] = useState(currentPeriod);
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  function buildQuery(
    period: { dateFrom: string; dateTo: string },
    cursor?: string | null,
  ) {
    const params = new URLSearchParams({
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      limit: "25",
    });
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function fetchStatement(
    token: string,
    period: { dateFrom: string; dateTo: string },
    cursor?: string | null,
  ) {
    const response = await fetch(
      `${API_BASE_URL}/wallet/statement?${buildQuery(period, cursor)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await response.json().catch(() => null)) as
      | StatementResponse
      | { message?: string | string[] }
      | null;
    if (!response.ok) {
      const message = body && "message" in body ? body.message : undefined;
      throw new Error(
        Array.isArray(message)
          ? message[0]
          : message ?? "Unable to load your wallet statement.",
      );
    }
    return body as StatementResponse;
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
          router.replace("/login?next=/wallet/statement");
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        const initialPeriod = currentPeriod();
        setAccessToken(session.accessToken);
        setStatement(await fetchStatement(session.accessToken, initialPeriod));
        setPageStatus("ready");
      } catch (loadError) {
        setError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load your wallet statement.",
        );
        setPageStatus("error");
      }
    }
    void load();
  }, [router]);

  async function applyPeriod(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    setPageStatus("loading");
    setError("");
    try {
      const response = await fetchStatement(accessToken, dates);
      setAppliedDates(dates);
      setStatement(response);
      setPageStatus("ready");
    } catch (periodError) {
      setError(
        periodError instanceof Error
          ? periodError.message
          : "Unable to load that statement period.",
      );
      setPageStatus("error");
    }
  }

  async function loadMore() {
    if (!accessToken || !statement?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await fetchStatement(
        accessToken,
        appliedDates,
        statement.nextCursor,
      );
      setStatement({
        ...next,
        entries: [...statement.entries, ...next.entries],
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load more entries.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportCsv() {
    if (!accessToken) return;
    setExporting(true);
    setError("");
    try {
      const params = buildQuery(appliedDates);
      params.delete("limit");
      const response = await fetch(
        `${API_BASE_URL}/wallet/statement/export?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) throw new Error("Statement export could not be created.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ledgerflow-statement-${appliedDates.dateFrom}-to-${appliedDates.dateTo}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Statement export could not be created.",
      );
    } finally {
      setExporting(false);
    }
  }

  if (pageStatus === "loading" && !statement) {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Preparing your wallet statement…</p>
      </main>
    );
  }

  if (pageStatus === "error" && !statement) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}>
          <Info size={27} />
        </span>
        <h1>Statement unavailable</h1>
        <p>{error}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  if (!statement) return null;

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
            <span className={styles.eyebrow}>Ledger-backed activity</span>
            <h1>Wallet statement</h1>
            <p>
              Wallet {statement.wallet.walletNumber} ·{" "}
              {periodLabel(statement.period.dateFrom, statement.period.dateTo)}
            </p>
          </div>
          <div className={styles.exportActions}>
            <button
              type="button"
              disabled={exporting}
              onClick={() => void exportCsv()}
            >
              {exporting ? <LoaderCircle size={16} /> : <Download size={16} />}
              {exporting ? "Preparing…" : "Export CSV"}
            </button>
            <button type="button" onClick={() => window.print()}>
              <Printer size={16} />
              Print / PDF
            </button>
          </div>
        </div>

        <section className={styles.balanceHero}>
          <div>
            <span className={styles.walletIcon}>
              <WalletCards size={23} />
            </span>
            <p>
              <small>Opening balance</small>
              <strong>
                {formatMoney(statement.balances.openingBalanceMinor)}
              </strong>
            </p>
          </div>
          <ArrowRight size={20} />
          <div>
            <span className={styles.closingIcon}>
              <ShieldCheck size={23} />
            </span>
            <p>
              <small>Closing balance</small>
              <strong>
                {formatMoney(statement.balances.closingBalanceMinor)}
              </strong>
            </p>
          </div>
          <span className={styles.reconciled}>
            <ShieldCheck size={14} />
            Ledger reconciled
          </span>
        </section>

        <section className={styles.summaryGrid}>
          <article>
            <span className={styles.creditIcon}>
              <ArrowDownLeft size={18} />
            </span>
            <p>
              <small>Total credits</small>
              <strong>{formatMoney(statement.summary.creditTotalMinor)}</strong>
            </p>
          </article>
          <article>
            <span className={styles.debitIcon}>
              <ArrowUpRight size={18} />
            </span>
            <p>
              <small>Total debits</small>
              <strong>{formatMoney(statement.summary.debitTotalMinor)}</strong>
            </p>
          </article>
          <article>
            <span className={styles.entriesIcon}>
              <History size={18} />
            </span>
            <p>
              <small>Posted entries</small>
              <strong>{statement.summary.entryCount}</strong>
            </p>
          </article>
        </section>

        <section className={styles.statementCard}>
          <form className={styles.periodForm} onSubmit={applyPeriod}>
            <div>
              <CalendarDays size={16} />
              <label>
                <span>From</span>
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
              </label>
              <label>
                <span>To</span>
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
              </label>
            </div>
            <button type="submit" disabled={pageStatus === "loading"}>
              <Search size={15} />
              View period
            </button>
          </form>

          {error && <div className={styles.inlineError}><Info size={15} />{error}</div>}

          <div className={styles.tableHeader}>
            <span>Date and description</span>
            <span>Reference</span>
            <span>Debit</span>
            <span>Credit</span>
            <span>Balance</span>
            <span />
          </div>

          {statement.entries.length ? (
            <div className={styles.entryList}>
              {statement.entries.map((entry) => {
                const row = (
                  <>
                    <span
                      className={`${styles.entryIcon} ${
                        entry.entryType === "DEBIT"
                          ? styles.debit
                          : styles.credit
                      }`}
                    >
                      {entry.transactionType === "WALLET_FUNDING" ? (
                        <CircleDollarSign size={18} />
                      ) : entry.entryType === "DEBIT" ? (
                        <ArrowUpRight size={18} />
                      ) : (
                        <ArrowDownLeft size={18} />
                      )}
                    </span>
                    <div className={styles.entryMain}>
                      <strong>{entry.description}</strong>
                      <time>{formatDate(entry.postedAt)}</time>
                      <small>{entry.transactionType.replaceAll("_", " ")}</small>
                    </div>
                    <code>{entry.customerReference}</code>
                    <strong className={styles.debitAmount}>
                      {entry.entryType === "DEBIT"
                        ? formatMoney(entry.amountMinor)
                        : "—"}
                    </strong>
                    <strong className={styles.creditAmount}>
                      {entry.entryType === "CREDIT"
                        ? formatMoney(entry.amountMinor)
                        : "—"}
                    </strong>
                    <strong className={styles.runningBalance}>
                      {formatMoney(entry.balanceAfterMinor)}
                    </strong>
                    {entry.detailPath ? <ChevronRight size={16} /> : <span />}
                  </>
                );
                return entry.detailPath ? (
                  <Link
                    className={styles.entry}
                    href={entry.detailPath}
                    key={entry.id}
                  >
                    {row}
                  </Link>
                ) : (
                  <div className={styles.entry} key={entry.id}>
                    {row}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <ReceiptText size={30} />
              <h2>No posted entries</h2>
              <p>
                This period has no completed wallet movements. Pending and
                failed operations never appear on a statement.
              </p>
            </div>
          )}

          {statement.nextCursor && (
            <button
              className={styles.loadMore}
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? (
                <LoaderCircle size={16} />
              ) : (
                <FileSpreadsheet size={16} />
              )}
              {loadingMore ? "Loading…" : "Load more entries"}
            </button>
          )}

          <footer className={styles.statementFooter}>
            <ShieldCheck size={14} />
            Statement entries are posted ledger movements. Pending and failed
            operations are excluded.
          </footer>
        </section>
      </div>
    </main>
  );
}
