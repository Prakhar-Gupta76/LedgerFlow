"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash2,
  Database,
  Filter,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  UserCheck,
  UsersRound,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import styles from "./wallets.module.css";

const API =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

type Reconciliation = {
  walletId: string;
  status: string;
  operationalBalanceMinor: string;
  ledgerBalanceMinor: string | null;
  differenceMinor: string | null;
  currency: string;
  ledgerAccountId: string | null;
  currencyMismatch: boolean;
  unbalancedTransaction: boolean;
};
type WalletItem = {
  id: string;
  number: string;
  currency: string;
  balanceMinor: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    status: string;
  };
  reconciliation: Reconciliation;
};
type WalletList = { items: WalletItem[]; nextCursor: string | null };
type Details = {
  wallet: {
    id: string;
    number: string;
    currency: string;
    balanceMinor: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
  };
  owner: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    status: string;
    registeredAt: string;
  };
  ledgerAccount: {
    id: string;
    code: string;
    currency: string;
    status: string;
  } | null;
  reconciliation: Reconciliation;
  recentTransfers: {
    id: string;
    reference: string;
    direction: string;
    counterpartyName: string;
    amountMinor: string;
    currency: string;
    status: string;
    occurredAt: string;
  }[];
  recentFunding: {
    id: string;
    amountMinor: string;
    currency: string;
    status: string;
    sourceType: string;
    occurredAt: string;
  }[];
  ledgerEntries: {
    id: string;
    ledgerTransactionId: string;
    transactionType: string;
    referenceId: string;
    reversalOfId: string | null;
    entryType: string;
    amountMinor: string;
    currency: string;
    balanceAfterMinor: string | null;
    postedAt: string;
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
};
type Filters = {
  search: string;
  status: string;
  currency: string;
  mismatchOnly: boolean;
};
type Action = "suspend" | "reactivate";

const reasonOptions = [
  ["SUSPICIOUS_ACTIVITY", "Suspicious activity"],
  ["SECURITY_REVIEW", "Security review"],
  ["POLICY_VIOLATION", "Policy violation"],
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
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
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
  return <span className={`${styles.status} ${styles[value.toLowerCase()]}`}>{value.replaceAll("_", " ")}</span>;
}
function Brand() {
  return <span className={styles.brand}><span className={styles.mark}><i /><i /></span>LedgerFlow <small>OPS</small></span>;
}

export default function AdminWalletsPage() {
  const router = useRouter();
  const started = useRef(false);
  const [token, setToken] = useState("");
  const [filters, setFilters] = useState<Filters>({ search: "", status: "", currency: "", mismatchOnly: false });
  const [list, setList] = useState<WalletList | null>(null);
  const [selected, setSelected] = useState<Details | null>(null);
  const [tab, setTab] = useState<"summary" | "activity" | "ledger" | "reconcile" | "history">("summary");
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [reasonCode, setReasonCode] = useState("SECURITY_REVIEW");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function queryString(selectedFilters: Filters, cursor?: string) {
    const params = new URLSearchParams({ limit: "20" });
    if (selectedFilters.search.trim()) params.set("search", selectedFilters.search.trim());
    if (selectedFilters.status) params.set("status", selectedFilters.status);
    if (selectedFilters.currency) params.set("currency", selectedFilters.currency);
    if (selectedFilters.mismatchOnly) params.set("mismatchOnly", "true");
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function loadWallets(accessToken: string, selectedFilters: Filters, cursor?: string, append = false) {
    const response = await fetch(`${API}/admin/wallets?${queryString(selectedFilters, cursor)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (response.status === 401) { router.replace("/login"); return; }
    if (response.status === 403) { setDenied(true); return; }
    if (!response.ok) throw new Error(messageFrom(body, "Wallets could not be loaded."));
    setList((current) => append && current
      ? { items: [...current.items, ...body.items], nextCursor: body.nextCursor }
      : body);
  }

  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(`${API}/admin/wallets${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (response.status === 401) { router.replace("/login"); throw new Error("Administrator session ended."); }
    if (response.status === 403) { setDenied(true); throw new Error("Administrator access is required."); }
    if (!response.ok) throw new Error(messageFrom(body, "The request could not be completed."));
    return body;
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const response = await fetch(`${API}/auth/refresh`, { method: "POST", credentials: "include" });
        if (!response.ok) { router.replace("/login"); return; }
        const body = await response.json();
        setToken(body.accessToken);
        await loadWallets(body.accessToken, filters);
      } catch (value) {
        setError(value instanceof Error ? value.message : "LedgerFlow is unavailable.");
      } finally { setLoading(false); }
    })();
  }, [router]);

  async function search(event?: FormEvent, nextFilters = filters) {
    event?.preventDefault();
    setLoading(true); setError(""); setSelected(null);
    try { await loadWallets(token, nextFilters); }
    catch (value) { setError(value instanceof Error ? value.message : "Wallet search failed."); }
    finally { setLoading(false); }
  }
  function changeFilter(patch: Partial<Filters>, autoSearch = true) {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (autoSearch) void search(undefined, next);
  }
  async function loadMore() {
    if (!list?.nextCursor) return;
    setLoadingMore(true);
    try { await loadWallets(token, filters, list.nextCursor, true); }
    catch (value) { setError(value instanceof Error ? value.message : "More wallets could not be loaded."); }
    finally { setLoadingMore(false); }
  }
  async function openDetails(walletId: string) {
    setDetailsLoading(true); setError("");
    try { setSelected(await api(`/${walletId}`)); setTab("summary"); }
    catch (value) { setError(value instanceof Error ? value.message : "Wallet details could not be loaded."); }
    finally { setDetailsLoading(false); }
  }
  async function refreshSelected() {
    if (!selected) return;
    setSelected(await api(`/${selected.wallet.id}`));
    await loadWallets(token, filters);
  }
  function showAction(value: Action) {
    setAction(value); setReason(""); setReasonCode(value === "suspend" ? "SECURITY_REVIEW" : "OTHER"); setError("");
  }
  async function submitAction(event: FormEvent) {
    event.preventDefault();
    if (!selected || !action) return;
    setSubmitting(true); setError("");
    try {
      const body = action === "suspend" ? { reasonCode, reason } : { reason };
      const result = await api(`/${selected.wallet.id}/${action}`, { method: "PATCH", body: JSON.stringify(body) });
      setAction(null); setNotice(result.message); await refreshSelected();
    } catch (value) { setError(value instanceof Error ? value.message : "Wallet action failed."); }
    finally { setSubmitting(false); }
  }
  async function logout() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    router.replace("/login");
  }

  if (denied) return <main className={styles.center}><LockKeyhole /><h1>Administrator access required</h1><Link href="/dashboard">Return to dashboard</Link></main>;
  if (loading && !list) return <main className={styles.center}><LoaderCircle className={styles.spin} /><h1>Loading wallet operations…</h1></main>;

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <Brand /><p>ADMINISTRATION</p>
        <nav><Link href="/admin"><LayoutDashboard /> Dashboard</Link><Link href="/admin/users"><UsersRound /> User management</Link><Link className={styles.active} href="/admin/wallets"><WalletCards /> Wallet management</Link><Link href="/admin/transfers"><Activity /> Transfer monitoring</Link><Link href="/admin/ledger"><Database /> Ledger &amp; reconciliation</Link></nav>
        <div className={styles.protection}><ShieldCheck /><span><strong>Accounting-safe</strong><small>No balance editing</small></span></div>
        <button onClick={() => void logout()}><LogOut /> Sign out</button>
      </aside>

      <section className={styles.content}>
        <header className={styles.header}><div><Link href="/admin"><ArrowLeft /> Admin dashboard</Link><span className={styles.kicker}>FINANCIAL OPERATIONS</span><h1>Wallet management</h1><p>Inspect operational balances against immutable ledger evidence.</p></div><button onClick={() => void search()}><RefreshCw /> Refresh</button></header>
        {(error || notice) && <div className={error ? styles.error : styles.notice}>{error ? <AlertTriangle /> : <Check />}<span>{error || notice}</span><button onClick={() => error ? setError("") : setNotice("")}><X /></button></div>}

        <section className={styles.filters}>
          <form onSubmit={search}><Search /><input value={filters.search} onChange={(event) => changeFilter({ search: event.target.value }, false)} placeholder="Exact wallet, owner ID, email or phone" /><button>Search</button></form>
          <select value={filters.status} onChange={(event) => changeFilter({ status: event.target.value })}><option value="">All states</option><option>ACTIVE</option><option>SUSPENDED</option><option>CLOSED</option></select>
          <select value={filters.currency} onChange={(event) => changeFilter({ currency: event.target.value })}><option value="">All currencies</option><option>INR</option></select>
          <label className={styles.toggle}><input type="checkbox" checked={filters.mismatchOnly} onChange={(event) => changeFilter({ mismatchOnly: event.target.checked })} /><i /><span><Filter /> Mismatches only</span></label>
        </section>

        <section className={styles.workspace}>
          <article className={styles.listPanel}>
            <div className={styles.listHead}><span><strong>{list?.items.length ?? 0}</strong> wallets shown</span><small>Reconciliation computed live</small></div>
            <div className={styles.tableWrap}><table><thead><tr><th>Wallet</th><th>Owner</th><th>State</th><th>Operational balance</th><th>Reconciliation</th><th /></tr></thead><tbody>{list?.items.map((wallet) => <tr key={wallet.id} onClick={() => void openDetails(wallet.id)} className={selected?.wallet.id === wallet.id ? styles.selectedRow : ""}><td><span className={styles.walletCell}><i><WalletCards /></i><span><strong>{wallet.number}</strong><small>{wallet.currency} · {date(wallet.createdAt)}</small></span></span></td><td><strong>{wallet.owner.fullName}</strong><small>{wallet.owner.email} · <Status value={wallet.owner.status} /></small></td><td><Status value={wallet.status} /></td><td><strong>{money(wallet.balanceMinor, wallet.currency)}</strong></td><td><Status value={wallet.reconciliation?.status ?? "MISSING_LEDGER_ACCOUNT"} /></td><td><ChevronRight /></td></tr>)}</tbody></table>{loading && <div className={styles.loadingLine}><LoaderCircle className={styles.spin} /> Loading…</div>}{!loading && list?.items.length === 0 && <div className={styles.empty}><WalletCards /><h3>No wallets found</h3><p>Adjust the search or reconciliation filters.</p></div>}</div>
            {list?.nextCursor && <button className={styles.loadMore} onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className={styles.spin} /> : "Load more wallets"}</button>}
          </article>

          <aside className={styles.detailPanel}>
            {detailsLoading && <div className={styles.detailEmpty}><LoaderCircle className={styles.spin} /> Loading wallet…</div>}
            {!detailsLoading && !selected && <div className={styles.detailEmpty}><Scale /><h3>Select a wallet</h3><p>Inspect activity, ledger entries, and balance reconciliation.</p></div>}
            {!detailsLoading && selected && <>
              <div className={styles.detailHead}><span><WalletCards /></span><div><small>VIRTUAL WALLET</small><h2>{selected.wallet.number}</h2><p>{selected.owner.fullName} · {selected.owner.email}</p></div><Status value={selected.wallet.status} /></div>
              <div className={styles.actions}>{selected.wallet.status === "ACTIVE" && <button className={styles.dangerButton} onClick={() => showAction("suspend")}><CircleSlash2 /> Suspend</button>}{selected.wallet.status === "SUSPENDED" && <button className={styles.successButton} onClick={() => showAction("reactivate")}><UserCheck /> Reactivate</button>}</div>
              <nav className={styles.tabs}>{(["summary", "activity", "ledger", "reconcile", "history"] as const).map((value) => <button key={value} onClick={() => setTab(value)} className={tab === value ? styles.current : ""}>{value}</button>)}</nav>
              <div className={styles.detailBody}>
                {tab === "summary" && <><section className={styles.balanceCard}><small>OPERATIONAL BALANCE</small><strong>{money(selected.wallet.balanceMinor, selected.wallet.currency)}</strong><span><Status value={selected.wallet.status} /><small>Updated {date(selected.wallet.updatedAt)}</small></span></section><section className={styles.infoGrid}><div><small>Owner</small><strong>{selected.owner.fullName}</strong><em><Status value={selected.owner.status} /></em></div><div><small>Owner phone</small><strong>{selected.owner.phoneNumber}</strong></div><div><small>Wallet ID</small><strong className={styles.mono}>{selected.wallet.id}</strong></div><div><small>Created</small><strong>{date(selected.wallet.createdAt)}</strong></div></section><p className={styles.readonly}><LockKeyhole /> Balance, ownership, currency, and financial history are read-only.</p></>}
                {tab === "activity" && <><h3>Transfers</h3><div className={styles.activityList}>{selected.recentTransfers.map((item) => <div key={item.id}><span className={item.direction === "SENT" ? styles.outgoing : styles.incoming}>{item.direction === "SENT" ? <ArrowUpRight /> : <ArrowDownLeft />}</span><span><strong>{item.direction === "SENT" ? "To" : "From"} {item.counterpartyName}</strong><small>{item.reference} · {date(item.occurredAt)}</small></span><b>{item.direction === "SENT" ? "−" : "+"}{money(item.amountMinor, item.currency)}</b><Status value={item.status} /></div>)}{selected.recentTransfers.length === 0 && <p className={styles.emptyText}>No transfer activity.</p>}</div><h3>Funding</h3><div className={styles.activityList}>{selected.recentFunding.map((item) => <div key={item.id}><span className={styles.incoming}><ArrowDownLeft /></span><span><strong>{item.sourceType} funding</strong><small>{date(item.occurredAt)}</small></span><b>+{money(item.amountMinor, item.currency)}</b><Status value={item.status} /></div>)}{selected.recentFunding.length === 0 && <p className={styles.emptyText}>No funding activity.</p>}</div></>}
                {tab === "ledger" && <><section className={styles.accountCard}>{selected.ledgerAccount ? <><Database /><span><small>LEDGER ACCOUNT</small><strong>{selected.ledgerAccount.code}</strong><em>{selected.ledgerAccount.currency} · {selected.ledgerAccount.status}</em></span></> : <><AlertTriangle /><span><strong>Ledger account missing</strong><small>This wallet requires investigation.</small></span></>}</section><div className={styles.ledgerList}>{selected.ledgerEntries.map((entry) => <div key={entry.id}><span className={entry.entryType === "CREDIT" ? styles.credit : styles.debit}>{entry.entryType}</span><span><strong>{entry.transactionType.replaceAll("_", " ")}</strong><small>Posted {date(entry.postedAt)} · Reference {entry.referenceId.slice(0, 8)}…</small></span><b>{money(entry.amountMinor, entry.currency)}</b>{entry.balanceAfterMinor !== null && <small>After: {money(entry.balanceAfterMinor, entry.currency)}</small>}</div>)}{selected.ledgerEntries.length === 0 && <p className={styles.emptyText}>No ledger entries.</p>}</div></>}
                {tab === "reconcile" && <section className={`${styles.reconcileCard} ${styles[selected.reconciliation.status.toLowerCase()]}`}><span>{selected.reconciliation.status === "MATCHED" ? <CheckCircle2 /> : <XCircle />}</span><div><small>RECONCILIATION RESULT</small><h3>{selected.reconciliation.status.replaceAll("_", " ")}</h3><p>Operational balance and immutable ledger evidence were compared live. No data was changed.</p></div><dl><div><dt>Operational balance</dt><dd>{money(selected.reconciliation.operationalBalanceMinor, selected.reconciliation.currency)}</dd></div><div><dt>Ledger-derived balance</dt><dd>{selected.reconciliation.ledgerBalanceMinor === null ? "Unavailable" : money(selected.reconciliation.ledgerBalanceMinor, selected.reconciliation.currency)}</dd></div><div><dt>Difference</dt><dd>{selected.reconciliation.differenceMinor === null ? "Unavailable" : money(selected.reconciliation.differenceMinor, selected.reconciliation.currency)}</dd></div><div><dt>Currency validation</dt><dd>{selected.reconciliation.currencyMismatch ? "Mismatch" : "Passed"}</dd></div><div><dt>Double-entry validation</dt><dd>{selected.reconciliation.unbalancedTransaction ? "Unbalanced" : "Passed"}</dd></div></dl><p><LockKeyhole /> Corrections require compensating ledger entries through a separate reconciliation workflow.</p></section>}
                {tab === "history" && <div className={styles.history}>{selected.statusHistory.map((item) => <div key={item.id}><span><Activity /></span><div><strong><Status value={item.previousStatus} /> <ArrowRight /> <Status value={item.newStatus} /></strong><p>{item.reason}</p><small>{item.reasonCode.replaceAll("_", " ")} · {item.changedBy} · {date(item.occurredAt)}</small></div></div>)}{selected.statusHistory.length === 0 && <p className={styles.emptyText}>No wallet-state changes.</p>}</div>}
              </div>
            </>}
          </aside>
        </section>
      </section>

      {action && selected && <div className={styles.modalBackdrop}><section className={styles.modal}><button className={styles.close} onClick={() => setAction(null)}><X /></button><span className={action === "suspend" ? styles.warningIcon : styles.safeIcon}>{action === "suspend" ? <AlertTriangle /> : <UserCheck />}</span><span className={styles.kicker}>CONFIRM WALLET ACTION</span><h2>{action === "suspend" ? "Suspend wallet" : "Reactivate wallet"}</h2><p>This changes access for <strong>{selected.wallet.number}</strong> and creates immutable status and audit records. The balance and owner account will not change.</p><form onSubmit={submitAction}>{action === "suspend" && <label>Reason category<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{reasonOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}<label>Administrator explanation<textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} rows={4} required /></label>{action === "reactivate" && selected.owner.status !== "ACTIVE" && <small className={styles.modalWarning}>The owner account is {selected.owner.status.toLowerCase()}. Reactivating the wallet does not reactivate the owner.</small>}<div><button type="button" onClick={() => setAction(null)}>Cancel</button><button className={action === "suspend" ? styles.confirmDanger : styles.confirmSafe} disabled={submitting}>{submitting ? <LoaderCircle className={styles.spin} /> : "Confirm action"}</button></div></form></section></div>}
    </main>
  );
}
