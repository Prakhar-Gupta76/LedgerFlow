# LedgerFlow

LedgerFlow is a portfolio digital-wallet MVP. The web app uses Next.js, while
the account and authentication API uses NestJS and PostgreSQL.

## Registration flow

`POST /api/v1/auth/register` performs one database transaction that creates the
user, password hash, exact legal-document consent records, first INR wallet,
and a pending `USER_REGISTERED` background job. Any failure rolls the entire
registration back.

## Login and recovery flow

`POST /api/v1/auth/login` verifies credentials, applies temporary lockouts,
records an authentication event, and creates a renewable session. The raw
refresh token is kept only in a secure HTTP-only cookie; PostgreSQL stores its
SHA-256 hash.

Password recovery uses single-use, 15-minute reset tokens. Reset requests
receive the same public response for known and unknown email addresses.
Completing a reset changes the password and revokes existing sessions in one
transaction.

## Customer dashboard

`GET /api/v1/dashboard` requires a short-lived access token and composes the
authenticated customer’s overview from `users`, `wallets`, `transfers`,
`wallet_daily_summaries`, and `notifications`. It never accepts a user ID from
the browser and does not mutate financial state. Notifications are marked read
only through their dedicated protected endpoint.

## Add virtual funds

`POST /api/v1/wallet/add-funds` adds simulated INR funds in one PostgreSQL
transaction. It locks the wallet, applies an idempotency key, updates the
authoritative balance, posts equal system debit and wallet credit entries,
queues notification/analytics/audit jobs, and completes the funding record
together. No card, bank, CVV, UPI, or real payment data is collected.

## Send money

`POST /api/v1/transfers` moves virtual INR between two active customer wallets
in one transaction. Both wallets are locked in stable order, the sender debit
uses a non-negative conditional update, the receiver is credited, balanced
ledger entries are posted, and notification/analytics/audit jobs are queued.
Exact recipient lookup is protected, rate-limited, and returns only a safe
preview. Sender-wallet idempotency prevents duplicate transfers.

## Transfer result

`GET /api/v1/transfers/result/:id` is a sender-only, read-only result endpoint.
It returns the committed transfer state, safe recipient preview, reference,
timestamps, optional note, and the sender’s historical balance immediately
after the transfer. Missing and unauthorized transfers share the same not-found
response. Pending results are polled without resubmitting the transfer.

## Transaction history

`GET /api/v1/transactions` returns the authenticated wallet's unified activity
feed from the `wallet_activity_history` database view. Search, date, type,
direction, status, and amount filters use stable cursor pagination. Summary
totals count only completed monetary activity. `GET
/api/v1/transactions/export` applies the same authorized filters to a CSV
download without storing export records.

## Transaction details

`GET /api/v1/transactions/:id` returns one wallet transfer from the
authenticated customer's perspective. Senders can read every transfer state;
receivers can read only completed or reversed transfers. The response exposes
safe participant details, only the customer's balance snapshots and ledger
entry, a financial timeline, and the customer-facing support reference.

## Wallet statement

`GET /api/v1/wallet/statement` returns the authenticated wallet's reconciled,
ledger-backed statement for a selected period. It includes opening and closing
balances, debit and credit totals, immutable running-balance snapshots, and
cursor-paginated posted entries. `GET /api/v1/wallet/statement/export` applies
the same authorized period query to CSV; the page also provides a print/PDF
layout.

## Analytics

`GET /api/v1/analytics` reads replaceable daily wallet and counterparty
summaries for a selected period. A lightweight PostgreSQL-backed worker
processes funding and transfer analytics jobs idempotently—without Kafka—and
updates totals, volume points, frequent recipients, averages, success rates,
and freshness metadata. Analytics remains informational and never determines
the authoritative wallet balance.

## Notifications

`GET /api/v1/notifications` returns only the authenticated customer's
cursor-paginated in-app notifications with unread, type, severity, and date
filters. Customers can idempotently mark one or all notifications read. A
PostgreSQL-backed worker creates welcome, funding, transfer, failure, and
reversal notifications in the same transaction as its processed-job marker;
notification delivery never controls financial correctness.

## Local setup

Requirements: Node.js 20+, pnpm 7+, and PostgreSQL 16 (or Docker).

```bash
pnpm install
docker compose up -d
copy .env.example .env.local
copy backend\.env.example backend\.env
pnpm migrate
```

Run the API and web app in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

Open [http://localhost:3000/register](http://localhost:3000/register) or
[http://localhost:3000/login](http://localhost:3000/login). The API runs at
`http://localhost:4000/api/v1`.

For Neon, replace `DATABASE_URL` in `backend/.env` with the Neon connection
string and set `DATABASE_SSL=true` before running `pnpm migrate`.

## Validation

```bash
pnpm lint
pnpm build:all
```
