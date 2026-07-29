"use client";

import { CheckCircle2, Eye, EyeOff, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "../login/login.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      setError(
        "Use at least 8 characters with an uppercase letter, number, and special character.",
      );
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (!token) {
      setError("This password-reset link is invalid or incomplete.");
      return;
    }
    setError("");
    setStatus("submitting");
    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await response.json().catch(() => null)) as
        | { message?: string | string[] }
        | null;
      if (!response.ok) {
        const message = body?.message;
        throw new Error(
          Array.isArray(message)
            ? message[0]
            : message ?? "Unable to reset your password.",
        );
      }
      setPassword("");
      setConfirmPassword("");
      setStatus("success");
    } catch (resetError) {
      setStatus("idle");
      setError(
        resetError instanceof TypeError
          ? "Unable to reach LedgerFlow. Make sure the API is running."
          : resetError instanceof Error
            ? resetError.message
            : "Unable to reset your password.",
      );
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.successCard}>
        {status === "success" ? (
          <>
            <span className={styles.successIcon}><CheckCircle2 size={36} /></span>
            <span className={styles.kicker}>Password updated</span>
            <h1>You’re ready to sign in.</h1>
            <p>Your old browser sessions were revoked for your protection.</p>
            <Link className={styles.primaryButton} href="/login">
              Return to login
            </Link>
          </>
        ) : (
          <>
            <span className={styles.successIcon}><LockKeyhole size={32} /></span>
            <span className={styles.kicker}>Secure account recovery</span>
            <h1>Choose a new password.</h1>
            <p>The reset link can only be used once and expires after 15 minutes.</p>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label htmlFor="new-password">New password</label>
                <div className={styles.inputShell}>
                  <LockKeyhole size={18} />
                  <input
                    id="new-password"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    className={styles.visibilityButton}
                    type="button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible((current) => !current)}
                  >
                    {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor="confirm-password">Confirm new password</label>
                <div className={styles.inputShell}>
                  <LockKeyhole size={18} />
                  <input
                    id="confirm-password"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
              </div>
              {error && <div className={styles.apiError}>{error}</div>}
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={status === "submitting"}
              >
                {status === "submitting" ? "Resetting password…" : "Reset password"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
