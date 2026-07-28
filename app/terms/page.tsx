import Link from "next/link";
import styles from "../legal.module.css";

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">LedgerFlow</Link>
        <Link className={styles.back} href="/register">Back to registration</Link>
      </header>
      <article className={styles.article}>
        <span className={styles.version}>Version 1.0 · Effective 1 January 2026</span>
        <h1>Terms of Service</h1>
        <p>
          LedgerFlow is a portfolio demonstration of a virtual-wallet system.
          By registering, you agree to use it only for lawful evaluation,
          learning, and demonstration purposes.
        </p>
        <h2>Virtual funds</h2>
        <p>
          All balances and transfers are simulated. They are not legal tender,
          cannot be withdrawn, and do not represent a bank deposit or payment
          service.
        </p>
        <h2>Your account</h2>
        <p>
          Provide accurate registration information, keep your credentials
          private, and do not attempt to access another user’s account.
        </p>
        <h2>Service availability</h2>
        <p>
          This MVP may change, reset demonstration data, or be unavailable
          without notice. It is provided without financial guarantees.
        </p>
      </article>
    </main>
  );
}
