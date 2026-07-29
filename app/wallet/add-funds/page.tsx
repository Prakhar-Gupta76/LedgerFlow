"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Info,
  Landmark,
  LockKeyhole,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./add-funds.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type FundingContext = {
  wallet: {
    id: string;
    walletNumber: string;
    currency: "INR";
    balanceMinor: string;
    status: string;
    updatedAt: string;
  };
  source: {
    type: "SIMULATED";
    label: string;
  };
  maximumAmountMinor: number;
  canFund: boolean;
};

type FundingResult = {
  fundingTransactionId: string;
  status: "COMPLETED" | "PENDING" | "FAILED";
  amountMinor: string;
  currency: "INR";
  balanceBeforeMinor: string;
  balanceAfterMinor: string;
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

export default function AddFundsPage() {
  const router = useRouter();
  const started = useRef(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [accessToken, setAccessToken] = useState("");
  const [context, setContext] = useState<FundingContext | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [pageStatus, setPageStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [flowStatus, setFlowStatus] = useState<
    "editing" | "confirming" | "submitting" | "success"
  >("editing");
  const [apiError, setApiError] = useState("");
  const [result, setResult] = useState<FundingResult | null>(null);

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
          router.replace("/login?next=/wallet/add-funds");
          return;
        }
        const session = (await refresh.json()) as { accessToken: string };
        setAccessToken(session.accessToken);
        const response = await fetch(`${API_BASE_URL}/wallet/funding-context`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(body?.message ?? "Unable to load your wallet.");
        }
        setContext((await response.json()) as FundingContext);
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

  function updateAmount(value: string) {
    const cleaned = value.replace(/[^\d.]/g, "");
    const [whole = "", decimal = ""] = cleaned.split(".");
    const normalized =
      cleaned.includes(".") ? `${whole}.${decimal.slice(0, 2)}` : whole;
    setAmount(normalized);
    setAmountError("");
    setApiError("");
    idempotencyKey.current = crypto.randomUUID();
  }

  function validateAmount() {
    if (!amount || !Number.isFinite(amountMinor) || amountMinor <= 0) {
      setAmountError("Enter an amount greater than ₹0.");
      return false;
    }
    if (context && amountMinor > context.maximumAmountMinor) {
      setAmountError(
        `The maximum amount is ${formatMoney(context.maximumAmountMinor)}.`,
      );
      return false;
    }
    return true;
  }

  function reviewFunding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateAmount()) return;
    setFlowStatus("confirming");
  }

  async function confirmFunding() {
    if (!context || !accessToken || !validateAmount()) return;
    setApiError("");
    setFlowStatus("submitting");
    try {
      const response = await fetch(`${API_BASE_URL}/wallet/add-funds`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amountMinor,
          currency: "INR",
          sourceType: "SIMULATED",
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | FundingResult
        | { message?: string | string[] }
        | null;
      if (!response.ok) {
        const message = body && "message" in body ? body.message : undefined;
        throw new Error(
          Array.isArray(message)
            ? message[0]
            : message ?? "Virtual funds could not be added.",
        );
      }
      const fundingResult = body as FundingResult;
      setResult(fundingResult);
      setContext((current) =>
        current
          ? {
              ...current,
              wallet: {
                ...current.wallet,
                balanceMinor: fundingResult.balanceAfterMinor,
              },
            }
          : current,
      );
      setFlowStatus("success");
    } catch (fundingError) {
      setFlowStatus("confirming");
      setApiError(
        fundingError instanceof TypeError
          ? "The connection was interrupted. Retry safely—the same request will not add funds twice."
          : fundingError instanceof Error
            ? fundingError.message
            : "Virtual funds could not be added.",
      );
    }
  }

  if (pageStatus === "loading") {
    return (
      <main className={styles.loadingPage}>
        <BrandMark />
        <span className={styles.loader} />
        <p>Securing your wallet…</p>
      </main>
    );
  }

  if (pageStatus === "error" || !context) {
    return (
      <main className={styles.loadingPage}>
        <span className={styles.errorIcon}><Info size={27} /></span>
        <h1>Wallet unavailable</h1>
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
          <span className={styles.eyebrow}>Funding completed</span>
          <h1>Your virtual funds are ready.</h1>
          <p>
            The wallet balance and balanced ledger entries were committed
            together in one transaction.
          </p>
          <div className={styles.resultAmount}>
            <small>Amount added</small>
            <strong>+{formatMoney(result.amountMinor)}</strong>
          </div>
          <div className={styles.resultGrid}>
            <p><small>Previous balance</small><strong>{formatMoney(result.balanceBeforeMinor)}</strong></p>
            <p><small>New balance</small><strong>{formatMoney(result.balanceAfterMinor)}</strong></p>
          </div>
          <div className={styles.reference}>
            <ReceiptText size={15} />
            <span><small>Funding reference</small>{result.fundingTransactionId}</span>
          </div>
          <div className={styles.successActions}>
            <Link className={styles.primaryButton} href="/dashboard">
              Return to dashboard <ArrowRight size={17} />
            </Link>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() => {
                setAmount("");
                setResult(null);
                setApiError("");
                idempotencyKey.current = crypto.randomUUID();
                setFlowStatus("editing");
              }}
            >
              Add more funds
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
            <span className={styles.eyebrow}>Virtual wallet funding</span>
            <h1>Add virtual funds</h1>
            <p>
              Top up your demonstration wallet without a bank account, card, or
              real payment.
            </p>
          </div>

          {!context.canFund && (
            <div className={styles.apiError}>
              This wallet is currently unavailable for funding.
            </div>
          )}

          <form className={styles.form} onSubmit={reviewFunding}>
            <div className={styles.field}>
              <label htmlFor="amount">Amount to add</label>
              <div className={`${styles.amountInput} ${amountError ? styles.inputError : ""}`}>
                <span>₹</span>
                <input
                  id="amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => updateAmount(event.target.value)}
                  aria-invalid={Boolean(amountError)}
                />
                <small>INR</small>
              </div>
              {amountError ? (
                <span className={styles.errorText}>{amountError}</span>
              ) : (
                <span className={styles.helpText}>
                  Up to {formatMoney(context.maximumAmountMinor)} per operation
                </span>
              )}
            </div>

            <div className={styles.presets}>
              {[500, 1000, 2500, 5000].map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => updateAmount(String(preset))}
                >
                  +₹{preset.toLocaleString("en-IN")}
                </button>
              ))}
            </div>

            <div className={styles.field}>
              <label>Funding source</label>
              <div className={styles.sourceCard}>
                <span className={styles.sourceIcon}><Sparkles size={19} /></span>
                <p>
                  <strong>{context.source.label}</strong>
                  <small>Simulated source · No payment details required</small>
                </p>
                <span className={styles.selected}><Check size={13} /></span>
              </div>
            </div>

            <div className={styles.notice}>
              <Info size={16} />
              <p>
                <strong>Portfolio demonstration only</strong>
                These funds have no monetary value and cannot be withdrawn.
              </p>
            </div>

            {apiError && <div className={styles.apiError}>{apiError}</div>}

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={!context.canFund}
            >
              Review funding
              <ArrowRight size={17} />
            </button>
          </form>
        </section>

        <aside className={styles.summaryPanel}>
          <div className={styles.walletCard}>
            <div className={styles.walletTop}>
              <span><WalletCards size={16} /> Your INR wallet</span>
              <small>{context.wallet.status}</small>
            </div>
            <strong>{formatMoney(context.wallet.balanceMinor)}</strong>
            <p>Current available balance</p>
            <span className={styles.walletNumber}>{context.wallet.walletNumber}</span>
            <div className={styles.walletOrb} />
          </div>

          <div className={styles.trustList}>
            <div><span><LockKeyhole size={17} /></span><p><strong>Atomic balance update</strong><small>The balance and ledger commit together.</small></p></div>
            <div><span><ShieldCheck size={17} /></span><p><strong>Duplicate-safe confirmation</strong><small>Retries cannot add the same funds twice.</small></p></div>
            <div><span><Landmark size={17} /></span><p><strong>Balanced ledger entries</strong><small>Every credit has an equal system debit.</small></p></div>
          </div>
        </aside>
      </div>

      {flowStatus !== "editing" && (
        <div className={styles.modalBackdrop}>
          <section className={styles.modal} role="dialog" aria-modal="true">
            <button
              className={styles.modalClose}
              type="button"
              aria-label="Close confirmation"
              disabled={flowStatus === "submitting"}
              onClick={() => setFlowStatus("editing")}
            >
              <X size={20} />
            </button>
            <span className={styles.modalIcon}><CircleDollarSign size={26} /></span>
            <span className={styles.eyebrow}>Confirm virtual funding</span>
            <h2>Add {formatMoney(amountMinor)}?</h2>
            <p>
              Review the details below. This will immediately increase your
              simulated wallet balance.
            </p>
            <div className={styles.confirmRows}>
              <p><span>Funding source</span><strong>Simulated</strong></p>
              <p><span>Current balance</span><strong>{formatMoney(context.wallet.balanceMinor)}</strong></p>
              <p><span>New balance</span><strong>{formatMoney(Number(context.wallet.balanceMinor) + amountMinor)}</strong></p>
              <p><span>Fee</span><strong>₹0.00</strong></p>
            </div>
            {apiError && <div className={styles.apiError}>{apiError}</div>}
            <button
              className={styles.primaryButton}
              type="button"
              disabled={flowStatus === "submitting"}
              onClick={() => void confirmFunding()}
            >
              {flowStatus === "submitting" ? (
                <><span className={styles.loaderSmall} /> Adding funds securely…</>
              ) : (
                <>Confirm and add funds <Plus size={17} /></>
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
