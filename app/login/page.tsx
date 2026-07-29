"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "./login.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type LoginResponse = {
  accessToken: string;
  accessTokenExpiresIn: number;
  user: {
    id: string;
    fullName: string;
    email: string;
    role: "CUSTOMER" | "ADMIN";
  };
};

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [login, setLogin] = useState<LoginResponse | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState<
    "idle" | "submitting" | "sent"
  >("idle");
  const [recoveryError, setRecoveryError] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const nextEmailError = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      ? ""
      : "Enter a valid email address.";
    const nextPasswordError = password ? "" : "Enter your password.";
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setError("");
    if (nextEmailError || nextPasswordError) return;

    setStatus("submitting");
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password }),
      });
      const body = (await response.json().catch(() => null)) as
        | LoginResponse
        | { message?: string | string[] }
        | null;
      if (!response.ok) {
        const message = body && "message" in body ? body.message : undefined;
        throw new Error(
          Array.isArray(message)
            ? message[0]
            : message ?? "Sign-in failed. Please try again.",
        );
      }
      setLogin(body as LoginResponse);
      setPassword("");
      setStatus("success");
    } catch (loginError) {
      setStatus("idle");
      setError(
        loginError instanceof TypeError
          ? "Unable to reach LedgerFlow. Make sure the API is running."
          : loginError instanceof Error
            ? loginError.message
            : "Sign-in failed. Please try again.",
      );
    }
  }

  async function handleRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = recoveryEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setRecoveryError("Enter a valid email address.");
      return;
    }
    setRecoveryError("");
    setRecoveryStatus("submitting");
    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const body = (await response.json().catch(() => null)) as
        | { message?: string | string[] }
        | null;
      if (!response.ok) {
        const message = body?.message;
        throw new Error(
          Array.isArray(message)
            ? message[0]
            : message ?? "Unable to start password recovery.",
        );
      }
      setRecoveryStatus("sent");
    } catch (recoveryRequestError) {
      setRecoveryStatus("idle");
      setRecoveryError(
        recoveryRequestError instanceof TypeError
          ? "Unable to reach LedgerFlow. Make sure the API is running."
          : recoveryRequestError instanceof Error
            ? recoveryRequestError.message
            : "Unable to start password recovery.",
      );
    }
  }

  if (status === "success" && login) {
    return (
      <main className={styles.page}>
        <section className={styles.successCard}>
          <Link className={styles.brand} href="/">
            <BrandMark />
            <span>LedgerFlow</span>
          </Link>
          <span className={styles.successIcon}>
            <CheckCircle2 size={38} />
          </span>
          <span className={styles.kicker}>Secure session created</span>
          <h1>Welcome back, {login.user.fullName.split(" ")[0]}.</h1>
          <p>
            Your credentials were verified and a secure, renewable browser
            session is now active.
          </p>
          <div className={styles.sessionDetail}>
            <ShieldCheck size={18} />
            <span>
              <small>Signed in as</small>
              <strong>{login.user.email}</strong>
            </span>
          </div>
          <Link className={styles.primaryButton} href="/dashboard">
            Continue to dashboard
            <ArrowRight size={18} />
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.formPanel}>
          <div className={styles.topbar}>
            <Link className={styles.backLink} href="/">
              <ArrowLeft size={16} />
              Back to home
            </Link>
            <p>
              New to LedgerFlow? <Link href="/register">Create account</Link>
            </p>
          </div>

          <div className={styles.formWrap}>
            <Link className={styles.brand} href="/">
              <BrandMark />
              <span>LedgerFlow</span>
            </Link>

            <div className={styles.heading}>
              <span className={styles.kicker}>Secure account access</span>
              <h1>Welcome back.</h1>
              <p>Sign in to continue managing your virtual wallet.</p>
            </div>

            <form className={styles.form} onSubmit={handleLogin} noValidate>
              <div className={styles.field}>
                <label htmlFor="email">Email address</label>
                <div
                  className={`${styles.inputShell} ${
                    emailError ? styles.inputError : ""
                  }`}
                >
                  <Mail size={18} />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value.toLowerCase());
                      if (emailError) setEmailError("");
                    }}
                  />
                </div>
                {emailError && <span className={styles.errorText}>{emailError}</span>}
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label htmlFor="password">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryEmail(email);
                      setRecoveryOpen(true);
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div
                  className={`${styles.inputShell} ${
                    passwordError ? styles.inputError : ""
                  }`}
                >
                  <LockKeyhole size={18} />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (passwordError) setPasswordError("");
                    }}
                  />
                  <button
                    className={styles.visibilityButton}
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((visible) => !visible)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {passwordError && (
                  <span className={styles.errorText}>{passwordError}</span>
                )}
              </div>

              {error && (
                <div className={styles.apiError} role="alert">
                  <ShieldCheck size={17} />
                  <span>{error}</span>
                </div>
              )}

              <button
                className={styles.primaryButton}
                type="submit"
                disabled={status === "submitting"}
              >
                {status === "submitting" ? (
                  <>
                    <span className={styles.spinner} />
                    Securing your session…
                  </>
                ) : (
                  <>
                    Sign in securely
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              <p className={styles.securityNote}>
                <LockKeyhole size={13} />
                Protected by temporary lockouts and auditable security events.
              </p>
            </form>
          </div>
        </section>

        <aside className={styles.storyPanel}>
          <div className={styles.gridGlow} />
          <div className={styles.storyCopy}>
            <span className={styles.storyKicker}>
              <Sparkles size={13} />
              Pick up where you left off
            </span>
            <h2>Your wallet activity, protected and within reach.</h2>
            <p>
              Every sign-in creates a renewable session without storing your
              password or refresh token in plain text.
            </p>
          </div>

          <div className={styles.securityVisual} aria-hidden="true">
            <div className={styles.ringOuter}>
              <div className={styles.ringInner}>
                <span><Fingerprint size={38} /></span>
              </div>
            </div>
            <div className={`${styles.floatingCard} ${styles.cardSession}`}>
              <ShieldCheck size={17} />
              <span><strong>Session protected</strong><small>Refresh token hashed</small></span>
            </div>
            <div className={`${styles.floatingCard} ${styles.cardAudit}`}>
              <KeyRound size={17} />
              <span><strong>Access monitored</strong><small>Security events recorded</small></span>
            </div>
          </div>

          <div className={styles.storyFooter}>
            <ShieldCheck size={18} />
            <p><strong>Built for safe demonstrations</strong>Virtual funds only—no banking credentials required.</p>
          </div>
        </aside>
      </div>

      {recoveryOpen && (
        <div className={styles.modalBackdrop} role="presentation">
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-title"
          >
            <button
              className={styles.modalClose}
              type="button"
              aria-label="Close password recovery"
              onClick={() => {
                setRecoveryOpen(false);
                setRecoveryError("");
              }}
            >
              ×
            </button>
            {recoveryStatus === "sent" ? (
              <>
                <span className={styles.modalIcon}><Mail size={25} /></span>
                <h2 id="recovery-title">Check your inbox</h2>
                <p>
                  If an eligible account exists, password-reset instructions
                  have been sent.
                </p>
                <button
                  className={styles.modalButton}
                  type="button"
                  onClick={() => {
                    setRecoveryOpen(false);
                    setRecoveryStatus("idle");
                  }}
                >
                  Return to sign in
                </button>
              </>
            ) : (
              <>
                <span className={styles.modalIcon}><KeyRound size={25} /></span>
                <h2 id="recovery-title">Reset your password</h2>
                <p>
                  Enter your email and we’ll start secure account recovery.
                </p>
                <form onSubmit={handleRecovery} noValidate>
                  <label htmlFor="recovery-email">Email address</label>
                  <div className={styles.inputShell}>
                    <Mail size={18} />
                    <input
                      id="recovery-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={recoveryEmail}
                      onChange={(event) => setRecoveryEmail(event.target.value)}
                    />
                  </div>
                  {recoveryError && (
                    <span className={styles.errorText}>{recoveryError}</span>
                  )}
                  <button
                    className={styles.modalButton}
                    type="submit"
                    disabled={recoveryStatus === "submitting"}
                  >
                    {recoveryStatus === "submitting"
                      ? "Starting recovery…"
                      : "Send reset instructions"}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
