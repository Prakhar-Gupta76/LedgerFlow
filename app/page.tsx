import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  Fingerprint,
  History,
  Landmark,
  LockKeyhole,
  Menu,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";

const features = [
  {
    icon: Send,
    title: "Instant transfers",
    description:
      "Move virtual money between wallets in a few clear, confident steps.",
    accent: "mint",
  },
  {
    icon: History,
    title: "Complete history",
    description:
      "Search every payment, funding activity, and reversal from one place.",
    accent: "violet",
  },
  {
    icon: ReceiptText,
    title: "Ledger-backed statements",
    description:
      "Understand how each transaction changed your wallet with an auditable trail.",
    accent: "blue",
  },
  {
    icon: BellRing,
    title: "Useful notifications",
    description:
      "Stay informed about transfers, wallet updates, and account security.",
    accent: "amber",
  },
  {
    icon: BarChart3,
    title: "Simple analytics",
    description:
      "See spending patterns, money received, and the people you pay most.",
    accent: "rose",
  },
  {
    icon: ShieldCheck,
    title: "Protected by design",
    description:
      "Authentication, controlled wallet actions, and immutable financial records.",
    accent: "green",
  },
];

const steps = [
  {
    number: "01",
    title: "Create your account",
    description: "Set up your profile and get a secure INR wallet in minutes.",
  },
  {
    number: "02",
    title: "Add virtual funds",
    description: "Top up your demo wallet and see the balance update instantly.",
  },
  {
    number: "03",
    title: "Send with confidence",
    description: "Choose a recipient, review the details, and confirm the transfer.",
  },
  {
    number: "04",
    title: "Track every movement",
    description: "Follow activity through history, statements, alerts, and insights.",
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <div className="container nav-shell">
          <Link className="brand" href="/" aria-label="LedgerFlow home">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <span>LedgerFlow</span>
          </Link>

          <nav className="desktop-nav" aria-label="Primary navigation">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#security">Security</a>
          </nav>

          <div className="nav-actions">
            <Link className="text-link" href="/login">
              Log in
            </Link>
            <Link className="button button-small button-dark" href="/register">
              Create account
              <ArrowRight size={16} strokeWidth={2.2} />
            </Link>
          </div>

          <button className="menu-button" type="button" aria-label="Open menu">
            <Menu size={24} />
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={15} fill="currentColor" />
              A clearer way to understand your money
            </div>
            <h1>
              Your money,
              <br />
              <span>clearly in motion.</span>
            </h1>
            <p className="hero-lead">
              Create a virtual wallet, send money in seconds, and follow every
              movement with a ledger-backed financial trail.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/register">
                Start for free
                <ArrowRight size={19} strokeWidth={2.2} />
              </Link>
              <a className="button button-ghost" href="#how-it-works">
                See how it works
                <ChevronRight size={18} />
              </a>
            </div>
            <div className="hero-proof" aria-label="Product benefits">
              <span>
                <Check size={15} />
                No real money
              </span>
              <span>
                <Check size={15} />
                Built for transparency
              </span>
              <span>
                <Check size={15} />
                Free to explore
              </span>
            </div>
          </div>

          <div className="product-visual" aria-label="LedgerFlow wallet preview">
            <div className="visual-glow" />
            <div className="wallet-window">
              <div className="window-topbar">
                <div className="mini-brand">
                  <span className="brand-mark brand-mark-small" aria-hidden="true">
                    <span />
                    <span />
                  </span>
                  LedgerFlow
                </div>
                <div className="avatar">PG</div>
              </div>

              <div className="balance-card">
                <div className="balance-card-top">
                  <span>Available balance</span>
                  <Eye size={17} />
                </div>
                <strong>₹24,860.50</strong>
                <span className="wallet-id">Wallet •••• 4821</span>
                <div className="quick-actions">
                  <div>
                    <span className="quick-icon">
                      <ArrowUpRight size={17} />
                    </span>
                    Send
                  </div>
                  <div>
                    <span className="quick-icon">
                      <ArrowDownLeft size={17} />
                    </span>
                    Add funds
                  </div>
                  <div>
                    <span className="quick-icon">
                      <ReceiptText size={17} />
                    </span>
                    Statement
                  </div>
                </div>
              </div>

              <div className="activity-card">
                <div className="activity-heading">
                  <div>
                    <span>Recent activity</span>
                    <small>Today</small>
                  </div>
                  <span>View all</span>
                </div>
                <div className="activity-row">
                  <span className="activity-icon activity-icon-send">
                    <ArrowUpRight size={17} />
                  </span>
                  <div>
                    <strong>Sent to Aanya</strong>
                    <small>12:42 PM · Completed</small>
                  </div>
                  <strong className="amount amount-out">− ₹1,250</strong>
                </div>
                <div className="activity-row">
                  <span className="activity-icon activity-icon-add">
                    <ArrowDownLeft size={17} />
                  </span>
                  <div>
                    <strong>Virtual funds added</strong>
                    <small>10:18 AM · Completed</small>
                  </div>
                  <strong className="amount amount-in">+ ₹5,000</strong>
                </div>
                <div className="activity-row">
                  <span className="activity-icon activity-icon-receive">
                    <Landmark size={17} />
                  </span>
                  <div>
                    <strong>Received from Kabir</strong>
                    <small>Yesterday · Completed</small>
                  </div>
                  <strong className="amount amount-in">+ ₹2,400</strong>
                </div>
              </div>
            </div>

            <div className="floating-pill floating-pill-secure">
              <span>
                <ShieldCheck size={18} />
              </span>
              <div>
                <strong>Protected transfer</strong>
                <small>Verified & recorded</small>
              </div>
            </div>

            <div className="floating-pill floating-pill-status">
              <span className="status-dot" />
              All systems healthy
            </div>
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div className="container trust-grid">
          <div>
            <strong>Every rupee accounted for.</strong>
            <span>Designed around financial clarity, not complexity.</span>
          </div>
          <div className="trust-item">
            <LockKeyhole size={21} />
            <span>
              <strong>Secure access</strong>
              Protected account actions
            </span>
          </div>
          <div className="trust-item">
            <ReceiptText size={21} />
            <span>
              <strong>Ledger backed</strong>
              Auditable transaction records
            </span>
          </div>
          <div className="trust-item">
            <Clock3 size={21} />
            <span>
              <strong>Always traceable</strong>
              Clear activity timelines
            </span>
          </div>
        </div>
      </section>

      <section className="section features-section" id="features">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Everything in one wallet</span>
              <h2>Simple on the surface.<br />Solid underneath.</h2>
            </div>
            <p>
              LedgerFlow gives you the tools to move virtual money and the
              context to understand what happened after every action.
            </p>
          </div>

          <div className="feature-grid">
            {features.map(({ icon: Icon, title, description, accent }) => (
              <article className="feature-card" key={title}>
                <span className={`feature-icon feature-${accent}`}>
                  <Icon size={23} strokeWidth={1.9} />
                </span>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className="feature-link">
                  Learn more <ArrowRight size={15} />
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section journey-section" id="how-it-works">
        <div className="container">
          <div className="center-heading">
            <span className="section-kicker">How it works</span>
            <h2>From zero to flowing in four steps.</h2>
            <p>No jargon. No hidden paths. Just a guided financial journey.</p>
          </div>

          <div className="steps-grid">
            {steps.map((step, index) => (
              <article className="step-card" key={step.number}>
                <div className="step-number">{step.number}</div>
                <div className="step-visual" aria-hidden="true">
                  {index === 0 && (
                    <div className="step-profile">
                      <span>PG</span>
                      <div><b>Wallet ready</b><i><Check size={12} /> Verified</i></div>
                    </div>
                  )}
                  {index === 1 && (
                    <div className="step-funds">
                      <small>Add virtual funds</small>
                      <strong>₹5,000</strong>
                      <span>Balance updated <Check size={12} /></span>
                    </div>
                  )}
                  {index === 2 && (
                    <div className="step-transfer">
                      <span>P</span>
                      <i><ArrowRight size={16} /></i>
                      <span>A</span>
                      <small>₹1,250 sent</small>
                    </div>
                  )}
                  {index === 3 && (
                    <div className="step-chart">
                      <span style={{ height: "38%" }} />
                      <span style={{ height: "62%" }} />
                      <span style={{ height: "46%" }} />
                      <span style={{ height: "82%" }} />
                      <span style={{ height: "70%" }} />
                    </div>
                  )}
                </div>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section security-section" id="security">
        <div className="container security-shell">
          <div className="security-copy">
            <span className="section-kicker section-kicker-light">
              Security at every step
            </span>
            <h2>Built to be trusted.<br />Designed to be understood.</h2>
            <p>
              Financial actions deserve more than a success message. LedgerFlow
              protects access, validates wallet operations, and preserves an
              auditable record of every movement.
            </p>
            <div className="security-list">
              <div>
                <span><Fingerprint size={20} /></span>
                <p><strong>Protected authentication</strong>Secure sessions and controlled access to private wallet data.</p>
              </div>
              <div>
                <span><WalletCards size={20} /></span>
                <p><strong>Controlled wallet operations</strong>Ownership, status, currency, and balance checks before changes.</p>
              </div>
              <div>
                <span><ReceiptText size={20} /></span>
                <p><strong>Auditable by design</strong>Ledger entries preserve what moved, when, and why.</p>
              </div>
            </div>
          </div>

          <div className="security-visual">
            <div className="shield-rings">
              <span className="ring ring-one" />
              <span className="ring ring-two" />
              <span className="ring ring-three" />
              <span className="shield-center"><ShieldCheck size={42} /></span>
              <span className="orbit-dot orbit-one"><LockKeyhole size={16} /></span>
              <span className="orbit-dot orbit-two"><ReceiptText size={16} /></span>
              <span className="orbit-dot orbit-three"><Eye size={16} /></span>
            </div>
            <div className="security-status-card">
              <div>
                <span className="pulse-dot" />
                Wallet protection
              </div>
              <strong>All checks passed</strong>
              <span className="status-line"><i /><i /><i /></span>
            </div>
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="container cta-shell">
          <div className="cta-orb" />
          <div>
            <span className="section-kicker">Ready when you are</span>
            <h2>Put your virtual money in motion.</h2>
            <p>Create your wallet and explore a clearer financial experience.</p>
          </div>
          <div className="cta-actions">
            <Link className="button button-dark button-large" href="/register">
              Create your free account
              <ArrowRight size={19} />
            </Link>
            <Link className="cta-login" href="/login">
              Already have an account? <strong>Log in</strong>
            </Link>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container footer-main">
          <div>
            <Link className="brand brand-light" href="/">
              <span className="brand-mark" aria-hidden="true"><span /><span /></span>
              <span>LedgerFlow</span>
            </Link>
            <p>A virtual wallet built to make every movement clear.</p>
          </div>
          <div className="footer-links">
            <div>
              <strong>Product</strong>
              <a href="#features">Features</a>
              <a href="#how-it-works">How it works</a>
              <a href="#security">Security</a>
            </div>
            <div>
              <strong>Account</strong>
              <Link href="/register">Create account</Link>
              <Link href="/login">Log in</Link>
            </div>
            <div>
              <strong>Project</strong>
              <span>Virtual funds only</span>
              <span>Portfolio demonstration</span>
            </div>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© 2026 LedgerFlow. Built for clarity.</span>
          <span>This product uses virtual money. No real funds are held.</span>
        </div>
      </footer>
    </main>
  );
}
