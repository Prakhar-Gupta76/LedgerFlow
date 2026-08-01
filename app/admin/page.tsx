"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowRightLeft,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  UsersRound,
  WalletCards,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./admin.module.css";

const API =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type CurrencyVolume = {
  currency: string;
  allTimeMinor: string;
  last24hMinor: string;
};
type Dashboard = {
  generatedAt: string;
  administrator: { fullName: string };
  customers: {
    total: number;
    active: number;
    pendingVerification: number;
    suspended: number;
    closed: number;
    registered24h: number;
  };
  wallets: {
    total: number;
    active: number;
    suspended: number;
    closed: number;
    created24h: number;
    balances: { currency: string; balanceMinor: string }[];
  };
  transfers: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    reversed: number;
    created24h: number;
    completed24h: number;
    failed24h: number;
    successRate: number;
    volumes: CurrencyVolume[];
    failureCategories: { code: string; count: number }[];
  };
  funding: {
    total: number;
    completed: number;
    failed: number;
    created24h: number;
    failed24h: number;
    volumes: CurrencyVolume[];
  };
  jobs: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    retrying: number;
    exhausted: number;
    completed24h: number;
    oldestPendingSeconds: number | null;
    recent: {
      id: string;
      type: string;
      resourceType: string;
      status: string;
      attempts: number;
      maxAttempts: number;
      lastErrorCode: string | null;
      createdAt: string;
      completedAt: string | null;
    }[];
  };
  suspiciousActivity: {
    byIp: {
      ipAddress: string;
      eventCount: number;
      knownUserCount: number;
      lastSeenAt: string;
    }[];
    byAccount: {
      userId: string | null;
      displayName: string;
      eventCount: number;
      blockedCount: number;
      lastSeenAt: string;
    }[];
  };
  recentActivity: {
    transfers: {
      id: string;
      reference: string;
      amountMinor: string;
      currency: string;
      status: string;
      senderName: string;
      receiverName: string;
      occurredAt: string;
    }[];
    funding: {
      id: string;
      amountMinor: string;
      currency: string;
      status: string;
      customerName: string;
      occurredAt: string;
    }[];
    audits: {
      id: string;
      actorType: string;
      actorName: string;
      action: string;
      resourceType: string;
      outcome: string;
      severity: string;
      reasonCode: string | null;
      occurredAt: string;
    }[];
  };
};

function money(minor: string, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency.trim(),
    maximumFractionDigits: 0,
  }).format(Number(minor) / 100);
}
function timestamp(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function duration(seconds: number | null) {
  if (seconds === null) return "None waiting";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}
function Brand() {
  return (
    <span className={styles.brand}>
      <span className={styles.mark}><i /><i /></span>
      LedgerFlow <small>OPS</small>
    </span>
  );
}
function Status({ value }: { value: string }) {
  return <span className={`${styles.status} ${styles[value.toLowerCase()]}`}>{value}</span>;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const started = useRef(false);
  const [token, setToken] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "refreshing" | "denied" | "error">("loading");
  const [error, setError] = useState("");
  const [activityTab, setActivityTab] = useState<"transfers" | "funding" | "audits">("transfers");

  async function load(accessToken: string, refreshing = false) {
    if (refreshing) setState("refreshing");
    const response = await fetch(`${API}/admin/dashboard`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (response.status === 403) {
      setState("denied");
      return;
    }
    if (!response.ok) throw new Error(errorMessage(body, "Operational data could not be loaded."));
    setData(body);
    setState("ready");
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
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "LedgerFlow is unavailable.");
        setState("error");
      }
    })();
  }, [router]);

  async function refresh() {
    try {
      await load(token, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Refresh failed.");
      setState("error");
    }
  }
  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    router.replace("/login");
  }

  if (state === "loading") {
    return <main className={styles.center}><LoaderCircle className={styles.spin} /><h1>Loading operations overview…</h1></main>;
  }
  if (state === "denied") {
    return (
      <main className={styles.center}>
        <ShieldAlert />
        <span className={styles.kicker}>RESTRICTED AREA</span>
        <h1>Administrator access required</h1>
        <p>This route is available only to active LedgerFlow administrators.</p>
        <Link href="/dashboard">Return to customer dashboard</Link>
      </main>
    );
  }
  if (!data || state === "error") {
    return <main className={styles.center}><XCircle /><h1>{error || "Dashboard unavailable"}</h1><button onClick={() => void refresh()}>Try again</button></main>;
  }

  const maxFailure = Math.max(1, ...data.transfers.failureCategories.map((item) => item.count));
  const alerts =
    data.jobs.failed +
    data.jobs.exhausted +
    data.suspiciousActivity.byIp.length +
    data.suspiciousActivity.byAccount.length;

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <Brand />
        <p className={styles.navLabel}>OPERATIONS</p>
        <nav>
          <a className={styles.active} href="#overview"><LayoutDashboard /> Overview</a>
          <Link href="/admin/users"><UsersRound /> User management</Link>
          <Link href="/admin/wallets"><WalletCards /> Wallet management</Link>
          <Link href="/admin/transfers"><ArrowRightLeft /> Transfer monitoring</Link>
          <Link href="/admin/ledger"><Database /> Ledger &amp; reconciliation</Link>
          <Link href="/admin/jobs"><Clock3 /> Background jobs</Link>
          <a href="#jobs"><Database /> Job processing</a>
          <a href="#security"><ShieldAlert /> Security signals {alerts > 0 && <b>{alerts}</b>}</a>
          <a href="#activity"><Activity /> System activity</a>
        </nav>
        <div className={styles.access}><ShieldCheck /><span><strong>Admin access</strong><small>Read-only operational view</small></span></div>
        <button className={styles.logout} onClick={() => void logout()}><LogOut /> Sign out</button>
      </aside>

      <section className={styles.content}>
        <header className={styles.header}>
          <div><span className={styles.kicker}>SYSTEM OVERVIEW</span><h1>Good day, {data.administrator.fullName.split(" ")[0]}.</h1><p>Here is the current health of LedgerFlow.</p></div>
          <div className={styles.headerActions}><span>Updated {timestamp(data.generatedAt)}</span><button onClick={() => void refresh()} disabled={state === "refreshing"}><RefreshCw className={state === "refreshing" ? styles.spin : ""} /> Refresh</button></div>
        </header>

        <section className={styles.metrics} id="overview">
          <article><span className={styles.metricIcon}><UsersRound /></span><div><small>Customers</small><strong>{data.customers.total.toLocaleString()}</strong><p><b>+{data.customers.registered24h}</b> in 24 hours</p></div></article>
          <article><span className={styles.metricIcon}><WalletCards /></span><div><small>Active wallets</small><strong>{data.wallets.active.toLocaleString()}</strong><p>{data.wallets.suspended} suspended</p></div></article>
          <article><span className={styles.metricIcon}><ArrowRightLeft /></span><div><small>Transfers · 24h</small><strong>{data.transfers.created24h.toLocaleString()}</strong><p><b>{data.transfers.completed24h}</b> completed</p></div></article>
          <article className={data.transfers.successRate < 90 ? styles.attention : ""}><span className={styles.metricIcon}><Gauge /></span><div><small>Transfer success</small><strong>{data.transfers.successRate}%</strong><p>{data.transfers.failed24h} failures today</p></div></article>
        </section>

        <section className={styles.split}>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.kicker}>VIRTUAL VALUE</span><h2>Financial footprint</h2></div><BriefcaseBusiness /></div>
            <div className={styles.moneyGrid}>
              <div><small>Wallet balances</small>{data.wallets.balances.length ? data.wallets.balances.map((item) => <strong key={item.currency}>{money(item.balanceMinor, item.currency)}</strong>) : <strong>₹0</strong>}</div>
              <div><small>Completed transfer volume</small>{data.transfers.volumes.length ? data.transfers.volumes.map((item) => <strong key={item.currency}>{money(item.allTimeMinor, item.currency)}</strong>) : <strong>₹0</strong>}<span>24h: {data.transfers.volumes.map((item) => money(item.last24hMinor, item.currency)).join(" · ") || "₹0"}</span></div>
              <div><small>Simulated funding</small>{data.funding.volumes.length ? data.funding.volumes.map((item) => <strong key={item.currency}>{money(item.allTimeMinor, item.currency)}</strong>) : <strong>₹0</strong>}<span>{data.funding.failed} failed overall</span></div>
            </div>
          </article>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.kicker}>CUSTOMER STATES</span><h2>Account distribution</h2></div><UserRound /></div>
            <div className={styles.distribution}>
              {[
                ["Active", data.customers.active],
                ["Pending verification", data.customers.pendingVerification],
                ["Suspended", data.customers.suspended],
                ["Closed", data.customers.closed],
              ].map(([label, value]) => <div key={label as string}><span><b>{label}</b><small>{value}</small></span><i><b style={{ width: `${data.customers.total ? (Number(value) / data.customers.total) * 100 : 0}%` }} /></i></div>)}
            </div>
          </article>
        </section>

        <section className={styles.split} id="transfers">
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.kicker}>TRANSFER PIPELINE</span><h2>Status health</h2></div><ArrowRightLeft /></div>
            <div className={styles.statusGrid}>
              <div><CheckCircle2 /><strong>{data.transfers.completed}</strong><small>Completed</small></div>
              <div><Clock3 /><strong>{data.transfers.pending}</strong><small>Pending</small></div>
              <div><XCircle /><strong>{data.transfers.failed}</strong><small>Failed</small></div>
              <div><ArrowDownToLine /><strong>{data.transfers.reversed}</strong><small>Reversed</small></div>
            </div>
          </article>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.kicker}>LAST 30 DAYS</span><h2>Failure categories</h2></div><AlertTriangle /></div>
            <div className={styles.failures}>
              {data.transfers.failureCategories.length === 0 && <p className={styles.empty}>No failed transfers in this period.</p>}
              {data.transfers.failureCategories.map((item) => <div key={item.code}><span><b>{item.code.replaceAll("_", " ")}</b><small>{item.count}</small></span><i><b style={{ width: `${(item.count / maxFailure) * 100}%` }} /></i></div>)}
            </div>
          </article>
        </section>

        <section className={styles.panel} id="jobs">
          <div className={styles.panelHead}><div><span className={styles.kicker}>BACKGROUND PROCESSING</span><h2>Worker & retry health</h2></div><div className={styles.oldest}>Oldest pending <strong>{duration(data.jobs.oldestPendingSeconds)}</strong></div></div>
          <div className={styles.jobMetrics}>
            <span><small>Pending</small><b>{data.jobs.pending}</b></span><span><small>Processing</small><b>{data.jobs.processing}</b></span><span><small>Completed · 24h</small><b>{data.jobs.completed24h}</b></span><span><small>Retrying</small><b>{data.jobs.retrying}</b></span><span className={data.jobs.failed ? styles.red : ""}><small>Failed</small><b>{data.jobs.failed}</b></span><span className={data.jobs.exhausted ? styles.red : ""}><small>Exhausted</small><b>{data.jobs.exhausted}</b></span>
          </div>
          <div className={styles.tableWrap}><table><thead><tr><th>Job</th><th>Resource</th><th>Status</th><th>Attempts</th><th>Created</th><th>Safe error</th></tr></thead><tbody>{data.jobs.recent.map((job) => <tr key={job.id}><td><strong>{job.type}</strong></td><td>{job.resourceType}</td><td><Status value={job.status} /></td><td>{job.attempts}/{job.maxAttempts}</td><td>{timestamp(job.createdAt)}</td><td>{job.lastErrorCode || "—"}</td></tr>)}</tbody></table>{data.jobs.recent.length === 0 && <p className={styles.empty}>No background jobs yet.</p>}</div>
        </section>

        <section className={styles.split} id="security">
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.kicker}>LAST HOUR</span><h2>Repeated failures by IP</h2></div><ShieldAlert /></div>
            <div className={styles.signalList}>{data.suspiciousActivity.byIp.map((signal) => <div key={signal.ipAddress}><AlertTriangle /><span><strong>{signal.ipAddress}</strong><small>{signal.eventCount} failures · {signal.knownUserCount} known accounts</small></span><time>{timestamp(signal.lastSeenAt)}</time></div>)}{data.suspiciousActivity.byIp.length === 0 && <p className={styles.empty}>No repeated IP failures detected.</p>}</div>
          </article>
          <article className={styles.panel}>
            <div className={styles.panelHead}><div><span className={styles.kicker}>LAST 24 HOURS</span><h2>Repeated failures by account</h2></div><UserRound /></div>
            <div className={styles.signalList}>{data.suspiciousActivity.byAccount.map((signal, index) => <div key={signal.userId || index}><ShieldAlert /><span><strong>{signal.displayName}</strong><small>{signal.eventCount} failures · {signal.blockedCount} blocked</small></span><time>{timestamp(signal.lastSeenAt)}</time></div>)}{data.suspiciousActivity.byAccount.length === 0 && <p className={styles.empty}>No repeated account failures detected.</p>}</div>
          </article>
        </section>

        <section className={styles.panel} id="activity">
          <div className={styles.panelHead}><div><span className={styles.kicker}>LIVE READ MODEL</span><h2>Recent system activity</h2></div><Activity /></div>
          <div className={styles.tabs}>
            {(["transfers", "funding", "audits"] as const).map((tab) => <button className={activityTab === tab ? styles.selected : ""} onClick={() => setActivityTab(tab)} key={tab}>{tab}</button>)}
          </div>
          <div className={styles.activityList}>
            {activityTab === "transfers" && data.recentActivity.transfers.map((item) => <div key={item.id}><span className={styles.activityIcon}><ArrowRightLeft /></span><span><strong>{item.senderName} → {item.receiverName}</strong><small>{item.reference} · {timestamp(item.occurredAt)}</small></span><b>{money(item.amountMinor, item.currency)}</b><Status value={item.status} /></div>)}
            {activityTab === "funding" && data.recentActivity.funding.map((item) => <div key={item.id}><span className={styles.activityIcon}><ArrowDownToLine /></span><span><strong>{item.customerName}</strong><small>Simulated funding · {timestamp(item.occurredAt)}</small></span><b>{money(item.amountMinor, item.currency)}</b><Status value={item.status} /></div>)}
            {activityTab === "audits" && data.recentActivity.audits.map((item) => <div key={item.id}><span className={styles.activityIcon}><ShieldCheck /></span><span><strong>{item.action.replaceAll("_", " ")}</strong><small>{item.actorName} · {item.resourceType} · {timestamp(item.occurredAt)}</small></span><b>{item.severity}</b><Status value={item.outcome} /></div>)}
            {data.recentActivity[activityTab].length === 0 && <p className={styles.empty}>No recent {activityTab} activity.</p>}
          </div>
        </section>
        <footer>LedgerFlow operational view · Exact live data · Refresh is read-only</footer>
      </section>
    </main>
  );
}
