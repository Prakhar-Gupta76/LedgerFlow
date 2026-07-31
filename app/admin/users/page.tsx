"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Clock3,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./users.module.css";

const API =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type UserItem = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  registeredAt: string;
  wallet: {
    number: string;
    currency: string;
    balanceMinor: string;
    status: string;
  };
  activeClosureStatus: string | null;
};
type UserList = { items: UserItem[]; nextCursor: string | null };
type Details = {
  customer: UserItem & {
    registeredAt: string;
    updatedAt: string;
    closedAt: string | null;
  };
  wallet: {
    id: string;
    number: string;
    currency: string;
    balanceMinor: string;
    status: string;
    createdAt: string;
  };
  transferOverview: { total: number; completed: number; failed: number };
  recentTransfers: {
    id: string;
    reference: string;
    direction: string;
    counterpartyName: string;
    amountMinor: string;
    currency: string;
    status: string;
    initiatedAt: string;
  }[];
  securityEvents: {
    id: string;
    type: string;
    failureReason: string | null;
    ipAddress: string | null;
    occurredAt: string;
  }[];
  sessions: {
    id: string;
    device: string;
    ipAddress: string | null;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string;
    revokedAt: string | null;
    revocationReason: string | null;
    active: boolean;
  }[];
  statusHistory: {
    id: string;
    previousStatus: string;
    newStatus: string;
    reasonCode: string;
    reason: string;
    changedBy: string;
    occurredAt: string;
  }[];
  closureRequests: {
    id: string;
    status: string;
    reason: string | null;
    requestedAt: string;
    reviewedAt: string | null;
    resolutionNote: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
  }[];
};
type Action =
  | { kind: "suspend"; title: string }
  | { kind: "reactivate"; title: string }
  | { kind: "sessions"; title: string }
  | {
      kind: "closure";
      title: string;
      requestId: string;
      reviewAction: "APPROVE" | "REJECT" | "COMPLETE";
    };

const statusOptions = [
  ["", "All customers"],
  ["ACTIVE", "Active"],
  ["PENDING_VERIFICATION", "Pending verification"],
  ["SUSPENDED", "Suspended"],
  ["CLOSED", "Closed"],
];
const reasonOptions = [
  ["SUSPICIOUS_ACTIVITY", "Suspicious activity"],
  ["POLICY_VIOLATION", "Policy violation"],
  ["SECURITY_REVIEW", "Security review"],
  ["CUSTOMER_REQUEST", "Customer request"],
  ["OTHER", "Other"],
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
function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}
function messageFrom(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join(". ");
  }
  return fallback;
}
function Status({ value }: { value: string }) {
  return (
    <span className={`${styles.status} ${styles[value.toLowerCase()]}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
function Brand() {
  return (
    <span className={styles.brand}>
      <span className={styles.mark}><i /><i /></span>
      LedgerFlow <small>OPS</small>
    </span>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const started = useRef(false);
  const [token, setToken] = useState("");
  const [list, setList] = useState<UserList | null>(null);
  const [selected, setSelected] = useState<Details | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"overview" | "activity" | "security" | "history" | "closure">("overview");
  const [action, setAction] = useState<Action | null>(null);
  const [reasonCode, setReasonCode] = useState("SECURITY_REVIEW");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API}/admin/users${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (response.status === 401) {
      router.replace("/login");
      throw new Error("Your administrator session ended.");
    }
    if (response.status === 403) {
      setDenied(true);
      throw new Error("Administrator access is required.");
    }
    if (!response.ok) throw new Error(messageFrom(body, "The request could not be completed."));
    return body;
  }

  async function loadUsers(
    accessToken: string,
    cursor?: string,
    append = false,
    selectedStatus = status,
  ) {
    const params = new URLSearchParams({ limit: "20" });
    if (search.trim()) params.set("search", search.trim());
    if (selectedStatus) params.set("status", selectedStatus);
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`${API}/admin/users?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (response.status === 403) {
      setDenied(true);
      return;
    }
    if (!response.ok) throw new Error(messageFrom(body, "Customers could not be loaded."));
    setList((current) =>
      append && current
        ? { items: [...current.items, ...body.items], nextCursor: body.nextCursor }
        : body,
    );
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
        await loadUsers(body.accessToken);
      } catch (reasonValue) {
        setError(reasonValue instanceof Error ? reasonValue.message : "LedgerFlow is unavailable.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function runSearch(event?: FormEvent, selectedStatus = status) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    setSelected(null);
    try {
      await loadUsers(token, undefined, false, selectedStatus);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!list?.nextCursor) return;
    setLoadingMore(true);
    try {
      await loadUsers(token, list.nextCursor, true);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "More customers could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openDetails(userId: string) {
    setDetailsLoading(true);
    setError("");
    try {
      setSelected(await api(`/${userId}`));
      setTab("overview");
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Customer details could not be loaded.");
    } finally {
      setDetailsLoading(false);
    }
  }

  async function refreshSelected() {
    if (!selected) return;
    const userId = selected.customer.id;
    setSelected(await api(`/${userId}`));
    await loadUsers(token);
  }

  function showAction(value: Action) {
    setAction(value);
    setReason("");
    setReasonCode(value.kind === "suspend" ? "SECURITY_REVIEW" : "OTHER");
    setError("");
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault();
    if (!selected || !action) return;
    setSubmitting(true);
    setError("");
    try {
      let path = "";
      let body: Record<string, string> = { reason };
      if (action.kind === "suspend") {
        path = `/${selected.customer.id}/suspend`;
        body = { reason, reasonCode };
      } else if (action.kind === "reactivate") {
        path = `/${selected.customer.id}/reactivate`;
      } else if (action.kind === "sessions") {
        path = `/${selected.customer.id}/sessions/revoke`;
      } else {
        path = `/${selected.customer.id}/closure-requests/${action.requestId}/review`;
        body = { action: action.reviewAction, resolutionNote: reason };
      }
      const result = await api(path, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setAction(null);
      setNotice(result.message);
      await refreshSelected();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    router.replace("/login");
  }

  if (denied) {
    return <main className={styles.center}><ShieldAlert /><h1>Administrator access required</h1><Link href="/dashboard">Return to dashboard</Link></main>;
  }
  if (loading && !list) {
    return <main className={styles.center}><LoaderCircle className={styles.spin} /><h1>Loading customer operations…</h1></main>;
  }

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <Brand />
        <p>ADMINISTRATION</p>
        <nav>
          <Link href="/admin"><LayoutDashboard /> Dashboard</Link>
          <Link className={styles.active} href="/admin/users"><UsersRound /> User management</Link>
          <Link href="/admin/wallets"><WalletCards /> Wallet management</Link>
        </nav>
        <div className={styles.protection}><ShieldCheck /><span><strong>Controlled access</strong><small>All actions are audited</small></span></div>
        <button onClick={() => void logout()}><LogOut /> Sign out</button>
      </aside>

      <section className={styles.content}>
        <header className={styles.header}>
          <div><Link href="/admin"><ArrowLeft /> Admin dashboard</Link><span className={styles.kicker}>CUSTOMER OPERATIONS</span><h1>User management</h1><p>Inspect customer access and perform controlled account-state actions.</p></div>
          <button className={styles.refresh} onClick={() => void runSearch()}><RefreshCw /> Refresh</button>
        </header>

        {(error || notice) && <div className={error ? styles.error : styles.notice}>{error ? <AlertTriangle /> : <Check />}<span>{error || notice}</span><button onClick={() => error ? setError("") : setNotice("")}><X /></button></div>}

        <section className={styles.toolbar}>
          <form onSubmit={runSearch}><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, phone or customer ID" /><button>Search</button></form>
          <select value={status} onChange={(event) => { const selectedStatus = event.target.value; setStatus(selectedStatus); void runSearch(undefined, selectedStatus); }}>{statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        </section>

        <section className={styles.workspace}>
          <article className={styles.listPanel}>
            <div className={styles.listHead}><span><strong>{list?.items.length ?? 0}</strong> customers shown</span><small>Newest registration first</small></div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>Customer</th><th>Status</th><th>Wallet</th><th>Balance</th><th>Registered</th><th /></tr></thead>
                <tbody>
                  {list?.items.map((user) => (
                    <tr key={user.id} className={selected?.customer.id === user.id ? styles.selectedRow : ""} onClick={() => void openDetails(user.id)}>
                      <td><span className={styles.userCell}><i>{initials(user.fullName)}</i><span><strong>{user.fullName}</strong><small>{user.email}</small></span></span></td>
                      <td><Status value={user.status} />{user.activeClosureStatus && <small className={styles.closureFlag}>Closure {user.activeClosureStatus.toLowerCase()}</small>}</td>
                      <td><strong>{user.wallet.number}</strong><small>{user.wallet.status}</small></td>
                      <td>{money(user.wallet.balanceMinor, user.wallet.currency)}</td>
                      <td>{date(user.registeredAt)}</td>
                      <td><ChevronRight /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && list?.items.length === 0 && <div className={styles.empty}><UsersRound /><h3>No customers found</h3><p>Adjust your search or status filter.</p></div>}
              {loading && <div className={styles.loadingLine}><LoaderCircle className={styles.spin} /> Loading…</div>}
            </div>
            {list?.nextCursor && <button className={styles.loadMore} disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle className={styles.spin} /> : "Load more customers"}</button>}
          </article>

          <aside className={styles.detailPanel}>
            {detailsLoading && <div className={styles.detailEmpty}><LoaderCircle className={styles.spin} /> Loading customer…</div>}
            {!detailsLoading && !selected && <div className={styles.detailEmpty}><UserRound /><h3>Select a customer</h3><p>Open a customer to inspect their wallet, activity, security, and account history.</p></div>}
            {!detailsLoading && selected && (
              <>
                <div className={styles.profileHead}><i>{initials(selected.customer.fullName)}</i><div><h2>{selected.customer.fullName}</h2><p>{selected.customer.email}</p><Status value={selected.customer.status} /></div></div>
                <div className={styles.actions}>
                  {["ACTIVE", "PENDING_VERIFICATION"].includes(selected.customer.status) && <button className={styles.dangerButton} onClick={() => showAction({ kind: "suspend", title: "Suspend customer" })}><CircleSlash2 /> Suspend</button>}
                  {selected.customer.status === "SUSPENDED" && <button className={styles.successButton} onClick={() => showAction({ kind: "reactivate", title: "Reactivate customer" })}><UserCheck /> Reactivate</button>}
                  {selected.sessions.some((session) => session.active) && <button onClick={() => showAction({ kind: "sessions", title: "Revoke active sessions" })}><KeyRound /> Revoke sessions</button>}
                </div>
                <nav className={styles.tabs}>
                  {(["overview", "activity", "security", "history", "closure"] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={tab === value ? styles.current : ""}>{value}</button>)}
                </nav>

                <div className={styles.detailBody}>
                  {tab === "overview" && <>
                    <section className={styles.walletCard}><div><WalletCards /><span><small>VIRTUAL WALLET</small><strong>{selected.wallet.number}</strong></span></div><b>{money(selected.wallet.balanceMinor, selected.wallet.currency)}</b><span><Status value={selected.wallet.status} /><small>Opened {date(selected.wallet.createdAt)}</small></span></section>
                    <section className={styles.infoGrid}><div><small>Email</small><strong>{selected.customer.email}</strong><em>{selected.customer.emailVerified ? "Verified" : "Unverified"}</em></div><div><small>Phone</small><strong>{selected.customer.phoneNumber}</strong><em>{selected.customer.phoneVerified ? "Verified" : "Unverified"}</em></div><div><small>Registered</small><strong>{date(selected.customer.registeredAt)}</strong></div><div><small>Customer ID</small><strong className={styles.mono}>{selected.customer.id}</strong></div></section>
                    <section className={styles.overviewMetrics}><span><strong>{selected.transferOverview.total}</strong><small>Transfers</small></span><span><strong>{selected.transferOverview.completed}</strong><small>Completed</small></span><span><strong>{selected.transferOverview.failed}</strong><small>Failed</small></span></section>
                    <p className={styles.readonly}><LockKeyhole /> Identity, wallet balance, credentials, and financial records are read-only.</p>
                  </>}

                  {tab === "activity" && <div className={styles.timeline}>{selected.recentTransfers.map((transfer) => <div key={transfer.id}><span className={transfer.direction === "SENT" ? styles.outgoing : styles.incoming}>{transfer.direction === "SENT" ? "↑" : "↓"}</span><span><strong>{transfer.direction === "SENT" ? "To" : "From"} {transfer.counterpartyName}</strong><small>{transfer.reference} · {date(transfer.initiatedAt)}</small></span><b>{transfer.direction === "SENT" ? "−" : "+"}{money(transfer.amountMinor, transfer.currency)}</b><Status value={transfer.status} /></div>)}{selected.recentTransfers.length === 0 && <p className={styles.emptyText}>No transfer activity.</p>}</div>}

                  {tab === "security" && <>
                    <h3>Sessions</h3><div className={styles.sessionList}>{selected.sessions.map((session) => <div key={session.id}><MonitorSmartphone /><span><strong>{session.device}</strong><small>{session.ipAddress || "IP unavailable"} · {date(session.lastUsedAt || session.createdAt)}</small></span><Status value={session.active ? "ACTIVE" : "REVOKED"} /></div>)}{selected.sessions.length === 0 && <p className={styles.emptyText}>No sessions recorded.</p>}</div>
                    <h3>Authentication events</h3><div className={styles.securityList}>{selected.securityEvents.map((event) => <div key={event.id}><ShieldAlert /><span><strong>{event.type.replaceAll("_", " ")}</strong><small>{event.ipAddress || "IP unavailable"} · {date(event.occurredAt)}</small></span>{event.failureReason && <em>{event.failureReason.replaceAll("_", " ")}</em>}</div>)}{selected.securityEvents.length === 0 && <p className={styles.emptyText}>No security events.</p>}</div>
                  </>}

                  {tab === "history" && <div className={styles.history}>{selected.statusHistory.map((item) => <div key={item.id}><span><Clock3 /></span><div><strong><Status value={item.previousStatus} /> <ArrowRight /> <Status value={item.newStatus} /></strong><p>{item.reason}</p><small>{item.reasonCode.replaceAll("_", " ")} · {item.changedBy} · {date(item.occurredAt)}</small></div></div>)}{selected.statusHistory.length === 0 && <p className={styles.emptyText}>No account-state changes.</p>}</div>}

                  {tab === "closure" && <div className={styles.closures}>{selected.closureRequests.map((request) => <section key={request.id}><div><Status value={request.status} /><small>{date(request.requestedAt)}</small></div><p>{request.reason || "No customer reason provided."}</p>{request.resolutionNote && <blockquote>{request.resolutionNote}</blockquote>}<div className={styles.closureActions}>{request.status === "PENDING" && <><button className={styles.successButton} onClick={() => showAction({ kind: "closure", title: "Approve closure request", requestId: request.id, reviewAction: "APPROVE" })}><CheckCircle2 /> Approve</button><button className={styles.dangerButton} onClick={() => showAction({ kind: "closure", title: "Reject closure request", requestId: request.id, reviewAction: "REJECT" })}><XCircle /> Reject</button></>}{request.status === "APPROVED" && <button className={styles.dangerButton} onClick={() => showAction({ kind: "closure", title: "Complete account closure", requestId: request.id, reviewAction: "COMPLETE" })}><LockKeyhole /> Complete closure</button>}</div></section>)}{selected.closureRequests.length === 0 && <p className={styles.emptyText}>No account-closure requests.</p>}</div>}
                </div>
              </>
            )}
          </aside>
        </section>
      </section>

      {action && selected && (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.modal} role="dialog" aria-modal="true">
            <button className={styles.close} onClick={() => setAction(null)}><X /></button>
            <span className={action.kind === "reactivate" || (action.kind === "closure" && action.reviewAction === "APPROVE") ? styles.safeIcon : styles.warningIcon}>{action.kind === "reactivate" ? <UserCheck /> : <AlertTriangle />}</span>
            <span className={styles.kicker}>CONFIRM ADMIN ACTION</span>
            <h2>{action.title}</h2>
            <p>This action targets <strong>{selected.customer.fullName}</strong>. It will be recorded in the immutable audit history.</p>
            <form onSubmit={submitAction}>
              {action.kind === "suspend" && <label>Reason category<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{reasonOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
              <label>{action.kind === "closure" ? "Resolution note" : "Administrator reason"}<textarea rows={4} minLength={3} maxLength={action.kind === "closure" ? 1000 : 500} value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Explain why this action is required…" /></label>
              {action.kind === "suspend" && <small>All active customer sessions will be revoked. The wallet state will not change.</small>}
              {action.kind === "closure" && action.reviewAction === "COMPLETE" && <small>Completion requires a zero wallet balance and no pending financial activity. Historical records will remain intact.</small>}
              <div><button type="button" onClick={() => setAction(null)}>Cancel</button><button className={action.kind === "reactivate" ? styles.confirmSafe : styles.confirmDanger} disabled={submitting}>{submitting ? <LoaderCircle className={styles.spin} /> : "Confirm action"}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
