"use client";

import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Copy,
  FileText,
  History,
  Info,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  UserRound,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./transaction-details.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type TimelineItem = {
  type: string;
  label: string;
  occurredAt: string;
};

type Participant = {
  fullName: string;
  maskedWalletNumber: string;
  isYou: boolean;
};

type TransactionDetails = {
  id: string;
  transferReference: string;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  direction: "SENT" | "RECEIVED";
  amountMinor: string;
  currency: "INR";
  note: string | null;
  participants: {
    sender: Participant;
    receiver: Participant;
  };
  balanceEffectMinor: string;
  originalBalanceEffectMinor: string;
  balanceBeforeMinor: string | null;
  balanceAfterMinor: string | null;
  failureMessage: string | null;
  initiatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  reversedAt: string | null;
  timeline: TimelineItem[];
};

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function formatMoney(minor: string | null, signed = false) {
  if (minor === null) return "Not available";
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

export default function TransactionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const started = useRef(false);
  const [details, setDetails] = useState<TransactionDetails | null>(null);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;

    async function load() {
      try {
        const refresh = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!refresh.ok) {
          router.replace(`/login?next=/transactions/${id}`);
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        const response = await fetch(`${API_BASE_URL}/transactions/${id}`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        const body = (await response.json().catch(() => null)) as
          | TransactionDetails
          | { message?: string | string[] }
          | null;
        if (!response.ok) {
          const message = body && "message" in body ? body.message : undefined;
          throw new Error(
            Array.isArray(message)
              ? message[0]
              : message ?? "Transaction not found.",
          );
        }
        if (!cancelled) {
          setDetails(body as TransactionDetails);
          setPageStatus("ready");
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Transaction not found.",
        );
        setPageStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  async function copyReference() {
    if (!details) return;
    await navigator.clipboard.writeText(details.transferReference);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (pageStatus === "loading") {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Loading transaction details…</p>
      </main>
    );
  }

  if (pageStatus === "error" || !details) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}>
          <AlertCircle size={28} />
        </span>
        <h1>Transaction not available</h1>
        <p>{error}</p>
        <Link href="/transactions">Return to transaction history</Link>
      </main>
    );
  }

  const statusContent = {
    COMPLETED: {
      icon: <CheckCircle2 size={27} />,
      title: "Transfer completed",
      description: "The wallet transfer was completed successfully.",
    },
    PENDING: {
      icon: <Clock3 size={27} />,
      title: "Transfer processing",
      description: "This transfer is still being processed.",
    },
    FAILED: {
      icon: <AlertCircle size={27} />,
      title: "Transfer unsuccessful",
      description:
        details.failureMessage ?? "The transfer could not be completed.",
    },
    REVERSED: {
      icon: <RotateCcw size={27} />,
      title: "Transfer reversed",
      description:
        "The original wallet effect was restored by a separate reversal.",
    },
  }[details.status];

  const amountSign = details.direction === "SENT" ? "−" : "+";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandMark />
          <span>LedgerFlow</span>
        </Link>
        <Link className={styles.backLink} href="/transactions">
          <ArrowLeft size={16} />
          Transaction history
        </Link>
      </header>

      <div className={styles.content}>
        <div className={styles.pageHeading}>
          <div>
            <span className={styles.eyebrow}>Wallet transfer</span>
            <h1>Transaction details</h1>
            <p>A customer-safe view of this transfer and its wallet effect.</p>
          </div>
          <span
            className={`${styles.statusBadge} ${
              styles[details.status.toLowerCase()]
            }`}
          >
            {statusContent.icon}
            <span>
              <strong>{statusContent.title}</strong>
              <small>{details.status}</small>
            </span>
          </span>
        </div>

        <section className={styles.heroCard}>
          <span
            className={`${styles.directionIcon} ${
              details.direction === "SENT" ? styles.sent : styles.received
            }`}
          >
            {details.direction === "SENT" ? (
              <ArrowUpRight size={24} />
            ) : (
              <ArrowDownLeft size={24} />
            )}
          </span>
          <div className={styles.amount}>
            <small>{details.direction === "SENT" ? "Money sent" : "Money received"}</small>
            <strong>
              {amountSign}
              {formatMoney(details.amountMinor)}
            </strong>
            <span>{statusContent.description}</span>
          </div>
          <div className={styles.reference}>
            <small>Transfer ID</small>
            <button type="button" onClick={() => void copyReference()}>
              {details.transferReference}
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </section>

        <div className={styles.columns}>
          <div className={styles.primaryColumn}>
            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <UserRound size={18} />
                <h2>Sender and receiver</h2>
              </div>
              <div className={styles.participants}>
                {(["sender", "receiver"] as const).map((role) => {
                  const participant = details.participants[role];
                  return (
                    <article key={role}>
                      <span className={styles.avatar}>
                        {initials(participant.fullName)}
                      </span>
                      <p>
                        <small>{role}</small>
                        <strong>
                          {participant.fullName}
                          {participant.isYou && <em>You</em>}
                        </strong>
                        <span>{participant.maskedWalletNumber}</span>
                      </p>
                      {participant.isYou && <ShieldCheck size={18} />}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <WalletCards size={18} />
                <h2>Balance effect</h2>
              </div>
              <div className={styles.effectSummary}>
                <div>
                  <small>Net wallet effect</small>
                  <strong>{formatMoney(details.balanceEffectMinor, true)}</strong>
                  <span>
                    {details.status === "REVERSED"
                      ? `Original ${formatMoney(
                          details.originalBalanceEffectMinor,
                          true,
                        )} effect was restored`
                      : "Effect of this transfer"}
                  </span>
                </div>
                <div className={styles.balanceSnapshots}>
                  <p>
                    <small>Balance before</small>
                    <strong>{formatMoney(details.balanceBeforeMinor)}</strong>
                  </p>
                  <span>→</span>
                  <p>
                    <small>Balance after</small>
                    <strong>{formatMoney(details.balanceAfterMinor)}</strong>
                  </p>
                </div>
              </div>
              <div className={styles.notice}>
                <Info size={15} />
                These are historical snapshots for your wallet only, not your
                current balance.
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <History size={18} />
                <h2>Activity timeline</h2>
              </div>
              <ol className={styles.timeline}>
                {details.timeline.map((item, index) => (
                  <li key={`${item.type}-${item.occurredAt}`}>
                    <span className={styles.timelineMarker}>
                      {index === details.timeline.length - 1 ? (
                        <Check size={13} />
                      ) : null}
                    </span>
                    <p>
                      <strong>{item.label}</strong>
                      <time>{formatDate(item.occurredAt)}</time>
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className={styles.secondaryColumn}>
            <section className={styles.card}>
              <div className={styles.cardHeading}>
                <FileText size={18} />
                <h2>Transfer information</h2>
              </div>
              <dl className={styles.detailsList}>
                <div>
                  <dt>Direction</dt>
                  <dd>{details.direction}</dd>
                </div>
                <div>
                  <dt>Currency</dt>
                  <dd>{details.currency}</dd>
                </div>
                <div>
                  <dt>Initiated</dt>
                  <dd>{formatDate(details.initiatedAt)}</dd>
                </div>
                <div>
                  <dt>Note</dt>
                  <dd>{details.note ?? "No note added"}</dd>
                </div>
              </dl>
            </section>

            <section className={`${styles.card} ${styles.supportCard}`}>
              <CircleHelp size={22} />
              <h2>Need help?</h2>
              <p>
                Use this reference when discussing the transfer with support.
              </p>
              <button type="button" onClick={() => void copyReference()}>
                {details.transferReference}
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <small>
                <LockKeyhole size={12} />
                Private ledger and background-job identifiers are never shown.
              </small>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
