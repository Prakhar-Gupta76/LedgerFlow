"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MonitorSmartphone,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./settings.module.css";

const API =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type Preferences = {
  walletFundingEnabled: boolean;
  transferSentEnabled: boolean;
  transferReceivedEnabled: boolean;
  transferFailedEnabled: boolean;
  transferReversedEnabled: boolean;
  systemMessagesEnabled: boolean;
};
type SettingsData = {
  profile: {
    fullName: string;
    email: string;
    phoneNumber: string;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    createdAt: string;
  };
  wallet: {
    walletNumber: string;
    currency: string;
    balanceMinor: string;
    status: string;
    createdAt: string;
  };
  notificationPreferences: Preferences;
  sessions: {
    id: string;
    device: string;
    ipAddress: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string;
    current: boolean;
  }[];
  recentSecurityEvents: {
    id: string;
    type: string;
    device: string;
    ipAddress: string | null;
    occurredAt: string;
  }[];
  closureRequests: {
    id: string;
    status: string;
    reason: string | null;
    requestedAt: string;
    cancelledAt: string | null;
  }[];
};

const preferenceLabels: { key: keyof Preferences; title: string; text: string }[] =
  [
    {
      key: "walletFundingEnabled",
      title: "Wallet funding",
      text: "When virtual funds are added to your wallet.",
    },
    {
      key: "transferSentEnabled",
      title: "Money sent",
      text: "Confirmation after you send virtual money.",
    },
    {
      key: "transferReceivedEnabled",
      title: "Money received",
      text: "When another customer sends money to you.",
    },
    {
      key: "transferFailedEnabled",
      title: "Failed transfers",
      text: "When a transfer cannot be completed.",
    },
    {
      key: "transferReversedEnabled",
      title: "Reversed transfers",
      text: "When a completed transfer is reversed.",
    },
    {
      key: "systemMessagesEnabled",
      title: "System messages",
      text: "Product and account-service updates.",
    },
  ];

function money(minor: string, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.trim(),
  }).format(Number(minor) / 100);
}
function date(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function messageFrom(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "message" in body) {
    const value = (body as { message: unknown }).message;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.join(". ");
  }
  return fallback;
}

export default function SettingsPage() {
  const router = useRouter();
  const started = useRef(false);
  const [token, setToken] = useState("");
  const [data, setData] = useState<SettingsData | null>(null);
  const [name, setName] = useState("");
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [closurePassword, setClosurePassword] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(accessToken: string) {
    const response = await fetch(`${API}/settings`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(messageFrom(body, "Settings could not be loaded."));
    setData(body);
    setName(body.profile.fullName);
    setPreferences(body.notificationPreferences);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const response = await fetch(`${API}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const body = await response.json();
        setToken(body.accessToken);
        await load(body.accessToken);
      } catch {
        setError("LedgerFlow is temporarily unavailable. Please try again.");
      }
    })();
  }, [router]);

  async function request(path: string, options: RequestInit = {}) {
    setError("");
    setNotice("");
    const response = await fetch(`${API}/settings${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => null);
    if (response.status === 401 && path !== "/password") {
      router.replace("/login");
      throw new Error("Your session has ended.");
    }
    if (!response.ok) throw new Error(messageFrom(body, "The request could not be completed."));
    return body;
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy("profile");
    try {
      const body = await request("/profile", {
        method: "PATCH",
        body: JSON.stringify({ fullName: name }),
      });
      setNotice(body.message);
      await load(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profile update failed.");
    } finally {
      setBusy("");
    }
  }

  async function savePreferences() {
    if (!preferences) return;
    setBusy("preferences");
    try {
      const body = await request("/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify(preferences),
      });
      setNotice(body.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preference update failed.");
    } finally {
      setBusy("");
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy("password");
    try {
      const body = await request("/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(body.message);
      await load(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Password change failed.");
    } finally {
      setBusy("");
    }
  }

  async function revoke(path: string, current = false) {
    setBusy(path);
    try {
      const body = await request(path, { method: "PATCH" });
      if (current) {
        router.replace("/login");
        return;
      }
      setNotice(body.message);
      await load(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Session revocation failed.");
    } finally {
      setBusy("");
    }
  }

  async function requestClosure(event: FormEvent) {
    event.preventDefault();
    setBusy("closure");
    try {
      const body = await request("/closure-requests", {
        method: "POST",
        body: JSON.stringify({
          password: closurePassword,
          reason: closureReason || undefined,
        }),
      });
      setClosurePassword("");
      setClosureReason("");
      setNotice(body.message);
      await load(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Closure request failed.");
    } finally {
      setBusy("");
    }
  }

  async function cancelClosure(id: string) {
    setBusy(id);
    try {
      const body = await request(`/closure-requests/${id}/cancel`, {
        method: "PATCH",
      });
      setNotice(body.message);
      await load(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cancellation failed.");
    } finally {
      setBusy("");
    }
  }

  if (!data || !preferences) {
    return (
      <main className={styles.loading}>
        {error ? <AlertTriangle /> : <LoaderCircle className={styles.spin} />}
        <h1>{error || "Opening your settings…"}</h1>
        {error && <Link href="/dashboard">Return to dashboard</Link>}
      </main>
    );
  }

  const pendingClosure = data.closureRequests.find((item) =>
    ["PENDING", "APPROVED"].includes(item.status),
  );
  const canClose = data.wallet.balanceMinor === "0" && !pendingClosure;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.back}>
          <ArrowLeft size={18} /> Dashboard
        </Link>
        <div>
          <span className={styles.eyebrow}>ACCOUNT CONTROL</span>
          <h1>Profile & settings</h1>
          <p>Manage your identity, security and LedgerFlow preferences.</p>
        </div>
        <div className={styles.avatar}>{data.profile.fullName.charAt(0)}</div>
      </header>

      {(error || notice) && (
        <div className={error ? styles.error : styles.notice}>
          {error ? <AlertTriangle size={18} /> : <Check size={18} />}
          <span>{error || notice}</span>
          <button onClick={() => (error ? setError("") : setNotice(""))}>
            <X size={17} />
          </button>
        </div>
      )}

      <nav className={styles.tabs} aria-label="Settings sections">
        <a href="#profile">Profile</a>
        <a href="#security">Security</a>
        <a href="#notifications">Notifications</a>
        <a href="#account">Account</a>
      </nav>

      <section className={styles.grid} id="profile">
        <article className={styles.card}>
          <div className={styles.cardTitle}>
            <UserRound />
            <div><h2>Profile information</h2><p>Your customer identity.</p></div>
          </div>
          <form onSubmit={saveProfile} className={styles.form}>
            <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={100} required /></label>
            <label>Email address<div className={styles.readonly}><span>{data.profile.email}</span><small>{data.profile.emailVerified ? "Verified" : "Unverified"}</small></div></label>
            <label>Phone number<div className={styles.readonly}><span>{data.profile.phoneNumber}</span><small>{data.profile.phoneVerified ? "Verified" : "Unverified"}</small></div></label>
            <p className={styles.hint}>Email and phone changes require a verification workflow and are read-only in this MVP.</p>
            <button className={styles.primary} disabled={busy === "profile" || name.trim() === data.profile.fullName}>{busy === "profile" ? <LoaderCircle className={styles.spin} /> : "Save profile"}</button>
          </form>
        </article>

        <article className={`${styles.card} ${styles.wallet}`}>
          <div className={styles.cardTitle}><WalletCards /><div><h2>Wallet information</h2><p>Read-only virtual wallet details.</p></div></div>
          <div className={styles.balance}>{money(data.wallet.balanceMinor, data.wallet.currency)}</div>
          <dl>
            <div><dt>Wallet number</dt><dd>{data.wallet.walletNumber}</dd></div>
            <div><dt>Currency</dt><dd>{data.wallet.currency}</dd></div>
            <div><dt>Status</dt><dd><span className={styles.status}>{data.wallet.status}</span></dd></div>
            <div><dt>Opened</dt><dd>{date(data.wallet.createdAt)}</dd></div>
          </dl>
        </article>
      </section>

      <section className={styles.stack} id="security">
        <article className={styles.card}>
          <div className={styles.cardTitle}><KeyRound /><div><h2>Password & security</h2><p>Changing your password signs out every other device.</p></div></div>
          <form onSubmit={changePassword} className={styles.passwordGrid}>
            {[
              ["Current password", currentPassword, setCurrentPassword],
              ["New password", newPassword, setNewPassword],
              ["Confirm new password", confirmPassword, setConfirmPassword],
            ].map(([label, value, setter]) => (
              <label key={label as string}>{label as string}<span className={styles.password}><input type={showPasswords ? "text" : "password"} value={value as string} onChange={(e) => (setter as (v: string) => void)(e.target.value)} minLength={8} required />{label === "Current password" && <button type="button" onClick={() => setShowPasswords(!showPasswords)} aria-label="Show or hide passwords">{showPasswords ? <EyeOff size={17} /> : <Eye size={17} />}</button>}</span></label>
            ))}
            <p className={styles.hint}>Use 8+ characters with an uppercase letter, number and special character.</p>
            <button className={styles.primary} disabled={busy === "password"}>{busy === "password" ? <LoaderCircle className={styles.spin} /> : "Change password"}</button>
          </form>
        </article>

        <article className={styles.card}>
          <div className={styles.cardTitle}><MonitorSmartphone /><div><h2>Active sessions</h2><p>Devices currently signed in to your account.</p></div><button className={styles.secondary} disabled={busy !== "" || data.sessions.length < 2} onClick={() => void revoke("/sessions/revoke-others")}>Sign out others</button></div>
          <div className={styles.sessions}>
            {data.sessions.map((session) => (
              <div className={styles.session} key={session.id}>
                <MonitorSmartphone />
                <div><strong>{session.device} {session.current && <em>Current</em>}</strong><span>{session.ipAddress || "IP unavailable"} · Last used {date(session.lastUsedAt || session.createdAt)}</span><small>Expires {date(session.expiresAt)}</small></div>
                <button aria-label={`Revoke ${session.device}`} disabled={busy !== ""} onClick={() => void revoke(`/sessions/${session.id}/revoke`, session.current)}><LogOut size={17} /> Sign out</button>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardTitle}><ShieldCheck /><div><h2>Recent security activity</h2><p>Auditable authentication events.</p></div></div>
          <div className={styles.events}>
            {data.recentSecurityEvents.map((event) => <div key={event.id}><ShieldCheck /><span><strong>{event.type.replaceAll("_", " ")}</strong><small>{event.device} · {date(event.occurredAt)}</small></span></div>)}
          </div>
        </article>
      </section>

      <section className={styles.card} id="notifications">
        <div className={styles.cardTitle}><Bell /><div><h2>Notification preferences</h2><p>Choose optional in-app activity alerts.</p></div></div>
        <div className={styles.preferences}>
          {preferenceLabels.map((item) => (
            <label key={item.key}><span><strong>{item.title}</strong><small>{item.text}</small></span><input type="checkbox" checked={preferences[item.key]} onChange={(e) => setPreferences({ ...preferences, [item.key]: e.target.checked })} /><i aria-hidden="true" /></label>
          ))}
        </div>
        <div className={styles.mandatory}><LockKeyhole size={18} /><span><strong>Security and critical alerts stay on.</strong> These protect your account and cannot be disabled.</span></div>
        <button className={styles.primary} disabled={busy === "preferences"} onClick={() => void savePreferences()}>{busy === "preferences" ? <LoaderCircle className={styles.spin} /> : "Save preferences"}</button>
      </section>

      <section className={`${styles.card} ${styles.danger}`} id="account">
        <div className={styles.cardTitle}><AlertTriangle /><div><h2>Account closure</h2><p>Submit a review request—your financial records are never physically deleted.</p></div></div>
        {pendingClosure ? (
          <div className={styles.pending}>
            <div><strong>{pendingClosure.status} request</strong><p>Submitted {date(pendingClosure.requestedAt)}{pendingClosure.reason ? ` · ${pendingClosure.reason}` : ""}</p></div>
            {pendingClosure.status === "PENDING" && <button className={styles.dangerButton} disabled={busy === pendingClosure.id} onClick={() => void cancelClosure(pendingClosure.id)}>Cancel request</button>}
          </div>
        ) : (
          <form className={styles.closureForm} onSubmit={requestClosure}>
            <p>Your wallet balance must be zero. Current balance: <strong>{money(data.wallet.balanceMinor, data.wallet.currency)}</strong></p>
            <label>Reason (optional)<textarea value={closureReason} onChange={(e) => setClosureReason(e.target.value)} maxLength={500} rows={3} /></label>
            <label>Confirm with current password<input type="password" value={closurePassword} onChange={(e) => setClosurePassword(e.target.value)} minLength={8} required /></label>
            <button className={styles.dangerButton} disabled={!canClose || busy === "closure"}>{busy === "closure" ? <LoaderCircle className={styles.spin} /> : "Request account closure"}</button>
            {!canClose && <small>Transfer or otherwise clear the virtual wallet balance before requesting closure.</small>}
          </form>
        )}
        {data.closureRequests.length > 0 && <details><summary>Previous requests</summary>{data.closureRequests.map((item) => <p key={item.id}><strong>{item.status}</strong> · {date(item.requestedAt)}</p>)}</details>}
      </section>
    </main>
  );
}
