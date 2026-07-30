"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  History,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./transfer-result.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type TransferResult = {
  id: string;
  transferReference: string;
  amountMinor: string;
  currency: "INR";
  note: string | null;
  status: "COMPLETED" | "FAILED" | "PENDING" | "REVERSED";
  recipient: {
    fullName: string;
    maskedWalletNumber: string;
  };
  senderBalanceBeforeMinor: string | null;
  senderBalanceAfterMinor: string | null;
  failureMessage: string | null;
  retryable: boolean;
  initiatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  reversedAt: string | null;
};

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function formatMoney(minor: string | null) {
  if (minor === null) return "Not available";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function TransferResultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const started = useRef(false);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | undefined;

    async function readTransfer(accessToken: string) {
      const response = await fetch(`${API_BASE_URL}/transfers/result/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = (await response.json().catch(() => null)) as
        | TransferResult
        | { message?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          body && "message" in body
            ? body.message ?? "Transfer not found."
            : "Transfer not found.",
        );
      }
      if (cancelled) return null;
      const transfer = body as TransferResult;
      setResult(transfer);
      setPageStatus("ready");
      if (transfer.status !== "PENDING" && pollId) {
        clearInterval(pollId);
        pollId = undefined;
      }
      return transfer;
    }

    async function bootstrap() {
      try {
        const refresh = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!refresh.ok) {
          router.replace(`/login?next=/transfers/result/${id}`);
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        const transfer = await readTransfer(session.accessToken);
        if (transfer?.status === "PENDING") {
          pollId = setInterval(() => {
            void readTransfer(session.accessToken).catch(() => undefined);
          }, 3000);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Transfer not found.",
        );
        setPageStatus("error");
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
      if (pollId) clearInterval(pollId);
    };
  }, [id, router]);

  async function copyReference() {
    if (!result) return;
    await navigator.clipboard.writeText(result.transferReference);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (pageStatus === "loading") {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Loading transfer result…</p>
      </main>
    );
  }

  if (pageStatus === "error" || !result) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}><AlertCircle size={29} /></span>
        <h1>Transfer not available</h1>
        <p>{error}</p>
        <Link href="/dashboard">Return to dashboard</Link>
      </main>
    );
  }

  const state = {
    COMPLETED: {
      icon: <CheckCircle2 size={40} />,
      eyebrow: "Transfer completed",
      title: "Virtual money delivered.",
      description:
        "The sender debit, recipient credit, and ledger entries committed successfully.",
    },
    FAILED: {
      icon: <AlertCircle size={40} />,
      eyebrow: "Transfer unsuccessful",
      title: "The transfer was not completed.",
      description:
        result.failureMessage ?? "The transfer could not be completed.",
    },
    PENDING: {
      icon: <Clock3 size={40} />,
      eyebrow: "Transfer processing",
      title: "We’re checking this transfer.",
      description:
        "This page will automatically recheck the existing transfer. Do not submit it again.",
    },
    REVERSED: {
      icon: <RotateCcw size={40} />,
      eyebrow: "Transfer reversed",
      title: "This transfer was later reversed.",
      description:
        "The original completed transfer was reversed by a separate financial operation.",
    },
  }[result.status];

  const stateTime =
    result.status === "REVERSED"
      ? result.reversedAt
      : result.status === "FAILED"
        ? result.failedAt
        : result.status === "COMPLETED"
          ? result.completedAt
          : result.initiatedAt;

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

      <section className={`${styles.resultCard} ${styles[result.status.toLowerCase()]}`}>
        <div className={styles.statusHero}>
          <span className={styles.statusIcon}>{state.icon}</span>
          <span className={styles.eyebrow}>{state.eyebrow}</span>
          <h1>{state.title}</h1>
          <p>{state.description}</p>
          {result.status === "PENDING" && (
            <span className={styles.polling}>
              <RefreshCw size={13} />
              Rechecking every few seconds
            </span>
          )}
        </div>

        <div className={styles.amountBlock}>
          <small>Transfer amount</small>
          <strong>{formatMoney(result.amountMinor)}</strong>
          <span>{result.status}</span>
        </div>

        <div className={styles.recipientBlock}>
          <span className={styles.avatar}>{initials(result.recipient.fullName)}</span>
          <p>
            <small>Recipient</small>
            <strong>{result.recipient.fullName}</strong>
            <span>{result.recipient.maskedWalletNumber}</span>
          </p>
          <ShieldCheck size={20} />
        </div>

        <div className={styles.details}>
          <div>
            <small>Transfer reference</small>
            <button type="button" onClick={() => void copyReference()}>
              {result.transferReference}
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <div>
            <small>{result.status === "COMPLETED" ? "Completed at" : "Last status time"}</small>
            <strong>{formatDate(stateTime)}</strong>
          </div>
          <div>
            <small>Balance immediately after</small>
            <strong>{formatMoney(result.senderBalanceAfterMinor)}</strong>
          </div>
          <div>
            <small>Note</small>
            <strong>{result.note ?? "No note added"}</strong>
          </div>
        </div>

        <div className={styles.resultNotice}>
          <WalletCards size={17} />
          <p>
            <strong>Historical balance snapshot</strong>
            The balance shown above is immediately after this transfer, not
            necessarily your current wallet balance.
          </p>
        </div>

        <div className={styles.actions}>
          <Link className={styles.primaryButton} href="/dashboard">
            Return to dashboard <ArrowRight size={16} />
          </Link>
          <Link className={styles.secondaryButton} href={`/transactions/${result.id}`}>
            <History size={16} /> View transaction details
          </Link>
          {result.status === "FAILED" && result.retryable && (
            <Link className={styles.retryButton} href="/transfers/new">
              <RefreshCw size={15} /> Start a new transfer
            </Link>
          )}
        </div>

        <footer>
          <LockKeyhole size={13} />
          Refreshing this page only reads the existing result and never repeats
          the transfer.
        </footer>
      </section>
    </main>
  );
}
