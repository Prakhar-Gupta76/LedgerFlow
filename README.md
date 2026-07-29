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
