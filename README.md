# LedgerFlow

LedgerFlow is a portfolio digital-wallet MVP. The web app uses Next.js, while
the registration API uses NestJS and PostgreSQL.

## Registration flow

`POST /api/v1/auth/register` performs one database transaction that creates the
user, password hash, exact legal-document consent records, first INR wallet,
and a pending `USER_REGISTERED` background job. Any failure rolls the entire
registration back.

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

Open [http://localhost:3000/register](http://localhost:3000/register). The API
runs at `http://localhost:4000/api/v1`.

For Neon, replace `DATABASE_URL` in `backend/.env` with the Neon connection
string and set `DATABASE_SSL=true` before running `pnpm migrate`.

## Validation

```bash
pnpm lint
pnpm build:all
```
