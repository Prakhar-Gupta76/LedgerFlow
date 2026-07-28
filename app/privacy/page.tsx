import Link from "next/link";
import styles from "../legal.module.css";

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">LedgerFlow</Link>
        <Link className={styles.back} href="/register">Back to registration</Link>
      </header>
      <article className={styles.article}>
        <span className={styles.version}>Version 1.0 · Effective 1 January 2026</span>
        <h1>Privacy Policy</h1>
        <p>
          LedgerFlow stores only the information needed to demonstrate account,
          wallet, and audit workflows.
        </p>
        <h2>Information collected</h2>
        <ul>
          <li>Name, email address, and phone number supplied at registration.</li>
          <li>A one-way password hash; the raw password is never stored.</li>
          <li>The exact policy versions accepted, with time and request metadata.</li>
          <li>Virtual-wallet and ledger activity created while using the demo.</li>
        </ul>
        <h2>How it is used</h2>
        <p>
          The data supports authentication, protected wallet operations,
          notifications, and auditable transaction records.
        </p>
        <h2>Demonstration notice</h2>
        <p>
          Do not enter real payment credentials or highly sensitive personal
          information. This project handles virtual funds only.
        </p>
      </article>
    </main>
  );
}
