"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ContactRound,
  Info,
  LockKeyhole,
  Mail,
  Phone,
  ReceiptText,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./send-money.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type TransferContext = {
  wallet: {
    id: string;
    walletNumber: string;
    currency: "INR";
    balanceMinor: string;
    status: string;
  };
  maximumAmountMinor: number;
  canTransfer: boolean;
};

type Recipient = {
  fullName: string;
  walletNumber: string;
  currency: "INR";
};

type TransferResult = {
  transferId: string;
  transferReference: string;
  status: "COMPLETED" | "PENDING" | "FAILED" | "REVERSED";
  recipient: {
    fullName: string;
    walletNumber?: string;
  };
  amountMinor: string;
  currency: "INR";
  note: string | null;
  senderBalanceBeforeMinor: string;
  senderBalanceAfterMinor: string;
  completedAt: string | null;
  idempotentReplay: boolean;
};

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function formatMoney(minor: string | number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export default function SendMoneyPage() {
  const router = useRouter();
  const started = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [accessToken, setAccessToken] = useState("");
  const [context, setContext] = useState<TransferContext | null>(null);
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [identifier, setIdentifier] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [lookupStatus, setLookupStatus] = useState<
    "idle" | "searching" | "found" | "error"
  >("idle");
  const [lookupError, setLookupError] = useState("");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [note, setNote] = useState("");
  const [apiError, setApiError] = useState("");
  const [flowStatus, setFlowStatus] = useState<
    "editing" | "confirming" | "submitting" | "success"
  >("editing");
  const [result, setResult] = useState<TransferResult | null>(null);

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
          router.replace("/login?next=/transfers/new");
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        setAccessToken(session.accessToken);
        const response = await fetch(`${API_BASE_URL}/transfers/context`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(body?.message ?? "Unable to load your wallet.");
        }
        setContext((await response.json()) as TransferContext);
        setPageStatus("ready");
      } catch (loadError) {
        setApiError(
          loadError instanceof TypeError
            ? "Unable to reach LedgerFlow. Make sure the API is running."
            : loadError instanceof Error
              ? loadError.message
              : "Unable to load your wallet.",
        );
        setPageStatus("error");
      }
    }
    void load();
  }, [router]);

  const amountMinor = Math.round(Number(amount || 0) * 100);

  async function lookupRecipient() {
    const normalized = identifier.trim();
    if (normalized.length < 3) {
      setLookupError("Enter an exact email, phone number, or wallet ID.");
      setLookupStatus("error");
      return;
    }
    setLookupError("");
    setLookupStatus("searching");
    try {
      const response = await fetch(
        `${API_BASE_URL}/transfers/recipients/lookup?identifier=${encodeURIComponent(normalized)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const body = (await response.json().catch(() => null)) as
        | Recipient
        | { message?: string | string[] }
        | null;
      if (!response.ok) {
        const message = body && "message" in body ? body.message : undefined;
        throw new Error(
          Array.isArray(message)
            ? message[0]
            : message ?? "Recipient could not be found.",
        );
      }
      setRecipient(body as Recipient);
      setLookupStatus("found");
      idempotencyKey.current = crypto.randomUUID();
    } catch (recipientError) {
      setRecipient(null);
      setLookupStatus("error");
      setLookupError(
        recipientError instanceof TypeError
          ? "Unable to reach LedgerFlow."
          : recipientError instanceof Error
            ? recipientError.message
            : "Recipient could not be found.",
      );
    }
  }

  function updateAmount(value: string) {
    const cleaned = value.replace(/[^\d.]/g, "");
    const [whole = "", decimal = ""] = cleaned.split(".");
    setAmount(
      cleaned.includes(".") ? `${whole}.${decimal.slice(0, 2)}` : whole,
    );
    setAmountError("");
    setApiError("");
    idempotencyKey.current = crypto.randomUUID();
  }

  function validateTransfer() {
    if (!recipient) {
      setLookupError("Find and select a recipient first.");
      setLookupStatus("error");
      return false;
    }
    if (!amount || !Number.isFinite(amountMinor) || amountMinor <= 0) {
      setAmountError("Enter an amount greater than ₹0.");
      return false;
    }
    if (context && amountMinor > context.maximumAmountMinor) {
      setAmountError(
        `The maximum transfer is ${formatMoney(context.maximumAmountMinor)}.`,
      );
      return false;
    }
    if (context && amountMinor > Number(context.wallet.balanceMinor)) {
      setAmountError("Your wallet does not have enough virtual funds.");
      return false;
    }
    return true;
  }

  function reviewTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validateTransfer()) setFlowStatus("confirming");
  }

  async function confirmTransfer() {
    if (!recipient || !context || !accessToken || !validateTransfer()) return;
    setApiError("");
    setFlowStatus("submitting");
    try {
      const response = await fetch(`${API_BASE_URL}/transfers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientWalletNumber: recipient.walletNumber,
          amountMinor,
          currency: "INR",
          note,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | TransferResult
        | { message?: string | string[] }
        | null;
      if (!response.ok) {
        const message = body && "message" in body ? body.message : undefined;
        throw new Error(
          Array.isArray(message)
            ? message[0]
            : message ?? "The transfer could not be completed.",
        );
      }
      const transferResult = body as TransferResult;
      setResult(transferResult);
      setContext((current) =>
        current
          ? {
              ...current,
              wallet: {
                ...current.wallet,
                balanceMinor: transferResult.senderBalanceAfterMinor,
              },
            }
          : current,
      );
      setFlowStatus("success");
      router.push(`/transfers/result/${transferResult.transferId}`);
    } catch (transferError) {
      setFlowStatus("confirming");
      setApiError(
        transferError instanceof TypeError
          ? "The connection was interrupted. Retry safely—the same transfer cannot be sent twice."
          : transferError instanceof Error
            ? transferError.message
            : "The transfer could not be completed.",
      );
    }
  }

  if (pageStatus === "loading") {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Securing your transfer…</p>
      </main>
    );
  }

  if (pageStatus === "error" || !context) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}><Info size={27} /></span>
        <h1>Transfers unavailable</h1>
        <p>{apiError}</p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  if (flowStatus === "success" && result) {
    return (
      <main className={styles.page}>
        <section className={styles.successCard}>
          <Link className={styles.brand} href="/">
            <BrandMark />
            <span>LedgerFlow</span>
          </Link>
          <span className={styles.successIcon}><CheckCircle2 size={39} /></span>
          <span className={styles.eyebrow}>Transfer completed</span>
          <h1>Virtual money sent.</h1>
          <p>
            The debit, recipient credit, transfer record, and balanced ledger
            entries were committed together.
          </p>
          <div className={styles.sentSummary}>
            <span className={styles.recipientAvatar}>
              {initials(result.recipient.fullName)}
            </span>
            <p><small>Sent to</small><strong>{result.recipient.fullName}</strong></p>
            <strong>−{formatMoney(result.amountMinor)}</strong>
          </div>
          <div className={styles.resultGrid}>
            <p><small>Remaining balance</small><strong>{formatMoney(result.senderBalanceAfterMinor)}</strong></p>
            <p><small>Status</small><strong>{result.status}</strong></p>
          </div>
          <div className={styles.reference}>
            <ReceiptText size={15} />
            <span><small>Transfer reference</small>{result.transferReference}</span>
          </div>
          <div className={styles.successActions}>
            <Link className={styles.primaryButton} href="/dashboard">
              Return to dashboard <ArrowRight size={17} />
            </Link>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                setIdentifier("");
                setRecipient(null);
                setLookupStatus("idle");
                setAmount("");
                setNote("");
                setResult(null);
                idempotencyKey.current = crypto.randomUUID();
                setFlowStatus("editing");
              }}
            >
              Send another transfer
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          <BrandMark />
          <span>LedgerFlow</span>
        </Link>
        <Link className={styles.backLink} href="/dashboard">
          <ArrowLeft size={16} />
          Back to dashboard
        </Link>
      </header>

      <div className={styles.shell}>
        <section className={styles.formPanel}>
          <div className={styles.heading}>
            <span className={styles.eyebrow}>Wallet-to-wallet transfer</span>
            <h1>Send virtual money</h1>
            <p>Find an eligible recipient, enter the amount, and review before sending.</p>
          </div>

          <form className={styles.form} onSubmit={reviewTransfer}>
            <div className={styles.field}>
              <label htmlFor="recipient">Find recipient</label>
              <div className={styles.searchShell}>
                <Search size={18} />
                <input
                  id="recipient"
                  type="text"
                  autoComplete="off"
                  placeholder="Exact email, phone, or wallet ID"
                  value={identifier}
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                    setRecipient(null);
                    setLookupStatus("idle");
                    setLookupError("");
                    idempotencyKey.current = crypto.randomUUID();
                  }}
                />
                <button
                  type="button"
                  disabled={lookupStatus === "searching"}
                  onClick={() => void lookupRecipient()}
                >
                  {lookupStatus === "searching" ? "Finding…" : "Find"}
                </button>
              </div>
              <span className={styles.helpText}>
                <Mail size={11} /> Email <Phone size={11} /> Phone <WalletCards size={11} /> Wallet ID
              </span>
              {lookupError && <span className={styles.errorText}>{lookupError}</span>}
            </div>

            {recipient && (
              <div className={styles.recipientCard}>
                <span className={styles.recipientAvatar}>{initials(recipient.fullName)}</span>
                <p>
                  <small>Verified recipient</small>
                  <strong>{recipient.fullName}</strong>
                  <span>{recipient.walletNumber}</span>
                </p>
                <span className={styles.verified}><ShieldCheck size={14} /></span>
              </div>
            )}

            <div className={styles.field}>
              <label htmlFor="amount">Amount to send</label>
              <div className={`${styles.amountInput} ${amountError ? styles.inputError : ""}`}>
                <span>₹</span>
                <input
                  id="amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => updateAmount(event.target.value)}
                />
                <small>INR</small>
              </div>
              {amountError ? (
                <span className={styles.errorText}>{amountError}</span>
              ) : (
                <span className={styles.helpText}>
                  Available: {formatMoney(context.wallet.balanceMinor)} · Limit: {formatMoney(context.maximumAmountMinor)}
                </span>
              )}
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <label htmlFor="note">Note</label>
                <small>{note.length}/200</small>
              </div>
              <textarea
                id="note"
                maxLength={200}
                placeholder="What is this transfer for? (optional)"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  idempotencyKey.current = crypto.randomUUID();
                }}
              />
            </div>

            {apiError && <div className={styles.apiError}>{apiError}</div>}

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={!context.canTransfer}
            >
              Review transfer <ArrowRight size={17} />
            </button>
          </form>
        </section>

        <aside className={styles.summaryPanel}>
          <div className={styles.balanceCard}>
            <span><WalletCards size={16} /> Available balance</span>
            <strong>{formatMoney(context.wallet.balanceMinor)}</strong>
            <p>{context.wallet.walletNumber}</p>
            <small>{context.wallet.status}</small>
            <div />
          </div>
          <div className={styles.flowVisual}>
            <div><span>YOU</span><small>Sender wallet</small></div>
            <span className={styles.flowArrow}><ArrowUpRight size={20} /></span>
            <div className={recipient ? styles.recipientSelected : ""}>
              <span>{recipient ? initials(recipient.fullName) : <UserRound size={18} />}</span>
              <small>{recipient?.fullName ?? "Recipient"}</small>
            </div>
          </div>
          <div className={styles.safetyList}>
            <p><LockKeyhole size={16} /><span><strong>Atomic movement</strong>Both balances update together or not at all.</span></p>
            <p><ShieldCheck size={16} /><span><strong>Duplicate-safe</strong>Retries cannot send the transfer twice.</span></p>
            <p><ContactRound size={16} /><span><strong>Exact recipient match</strong>No public or fuzzy account search.</span></p>
          </div>
        </aside>
      </div>

      {flowStatus !== "editing" && (
        <div className={styles.modalBackdrop}>
          <section className={styles.modal} role="dialog" aria-modal="true">
            <button
              className={styles.modalClose}
              type="button"
              disabled={flowStatus === "submitting"}
              onClick={() => setFlowStatus("editing")}
              aria-label="Close confirmation"
            >
              <X size={20} />
            </button>
            <span className={styles.modalIcon}><Send size={25} /></span>
            <span className={styles.eyebrow}>Final confirmation</span>
            <h2>Send {formatMoney(amountMinor)}?</h2>
            <p>Review the recipient and amount. Completed transfers cannot be edited.</p>
            <div className={styles.confirmRecipient}>
              <span className={styles.recipientAvatar}>{initials(recipient?.fullName ?? "")}</span>
              <p><small>Recipient</small><strong>{recipient?.fullName}</strong><span>{recipient?.walletNumber}</span></p>
            </div>
            <div className={styles.confirmRows}>
              <p><span>Transfer amount</span><strong>{formatMoney(amountMinor)}</strong></p>
              <p><span>Fee</span><strong>₹0.00</strong></p>
              <p><span>Balance after</span><strong>{formatMoney(Number(context.wallet.balanceMinor) - amountMinor)}</strong></p>
              {note && <p><span>Note</span><strong>{note}</strong></p>}
            </div>
            {apiError && <div className={styles.apiError}>{apiError}</div>}
            <button
              className={styles.primaryButton}
              type="button"
              disabled={flowStatus === "submitting"}
              onClick={() => void confirmTransfer()}
            >
              {flowStatus === "submitting" ? (
                <><span className={styles.loaderSmall} /> Sending securely…</>
              ) : (
                <>Confirm and send <Send size={16} /></>
              )}
            </button>
            <button
              className={styles.cancelButton}
              type="button"
              disabled={flowStatus === "submitting"}
              onClick={() => setFlowStatus("editing")}
            >
              Cancel
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
