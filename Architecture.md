# Digital Wallet and Ledger MVP

## Deployment Architecture

| Component | Platform | Responsibility |
|---|---|---|
| Next.js frontend | Vercel | Customer and administrator interfaces |
| NestJS application | Render | HTTP API and PostgreSQL-backed background worker |
| PostgreSQL | Neon | Financial source of truth and application data |
| Source repository | GitHub | Source control and deployment integration |

For the MVP deployment, the NestJS HTTP API and background worker can run in
one Render process. Deferred notification, analytics, email, and audit work is
stored in PostgreSQL and processed without an external message broker.

## Application Pages

---

## 1. Landing Page

**Route:** `/`

**Purpose:** Introduce the virtual-wallet application to visitors and direct
them to registration or login. It does not display private financial data.

### Sections

- **Hero:** Explains that users can create a virtual wallet, transfer virtual
  money, and monitor their activity.
- **Key features:** Introduces transfers, transaction history, ledger-backed
  statements, notifications, and analytics.
- **How it works:** Presents the journey of creating an account, adding virtual
  funds, transferring money, and tracking activity.
- **Security overview:** Briefly describes authentication, protected wallet
  operations, and auditable transactions.
- **Call to action:** Links visitors to registration and login.

### Database design status

Pending discussion.

---

## 2. Registration Page

**Route:** `/register`

**Purpose:** Create a customer account and its first INR wallet.

### Sections

- **Personal information:** Full name, email address, phone number, and
  password.
- **Terms and consent:** Acceptance of the current terms and privacy policy.
- **Account creation status:** Validation errors and registration progress.

### Database design status

Completed for registration.

### Registration transaction

Registration is completed in one PostgreSQL transaction:

1. Validate and normalize the submitted information.
2. Hash the password.
3. Create the user.
4. Create the user's credentials.
5. Record acceptance of the current terms and privacy policy.
6. Create an empty INR wallet.
7. Create a pending `USER_REGISTERED` background job.
8. Commit all records together.

If any database operation fails, PostgreSQL rolls back the complete
registration.

### Table: `users`

Stores the customer's identity and account state.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Internal user identifier |
| `full_name` | `VARCHAR(100)` | Yes | Non-empty | Customer display name |
| `email` | `VARCHAR(254)` | Yes | Unique, normalized lowercase | Login and contact address |
| `phone_number` | `VARCHAR(20)` | Yes | Unique, E.164 format | Customer phone number |
| `role` | `user_role` enum | Yes | Default `CUSTOMER` | Authorization role |
| `status` | `user_status` enum | Yes | Default `ACTIVE` | Account lifecycle state |
| `email_verified_at` | `TIMESTAMPTZ` | No | — | Email verification time |
| `phone_verified_at` | `TIMESTAMPTZ` | No | — | Phone verification time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Account creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last profile/state update |
| `closed_at` | `TIMESTAMPTZ` | No | — | Account closure time |

`user_role` values:

- `CUSTOMER`
- `ADMIN`

`user_status` values:

- `PENDING_VERIFICATION`
- `ACTIVE`
- `SUSPENDED`
- `CLOSED`

#### CRUD operations

- **Create:** Create a customer during registration.
- **Read:** Find a user for login, profile display, uniqueness checks, and
  administration.
- **Update:** Change permitted profile fields, verification timestamps, or
  account status.
- **Delete:** Do not physically delete the user. Close the account and preserve
  its financial history.

### Table: `user_credentials`

Stores password and authentication controls separately from the customer
profile.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `user_id` | `UUID` | Yes | Primary key, foreign key to `users.id` | Credential owner |
| `password_hash` | `TEXT` | Yes | Non-empty | Argon2id or bcrypt password hash |
| `password_changed_at` | `TIMESTAMPTZ` | Yes | Current time | Last password change |
| `failed_login_attempts` | `SMALLINT` | Yes | Default `0`, non-negative | Consecutive failed attempts |
| `locked_until` | `TIMESTAMPTZ` | No | — | Temporary login lock expiry |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Credential creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last credential update |

The raw password and confirm-password value are never stored.

#### CRUD operations

- **Create:** Store the password hash during registration.
- **Read:** Load the hash internally for password verification. Never expose it
  to the frontend.
- **Update:** Change a password, manage failed attempts, or manage a temporary
  login lock.
- **Delete:** No normal physical deletion.

### Table: `legal_documents`

Stores versioned terms and privacy policies.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Document-version identifier |
| `document_type` | `legal_document_type` enum | Yes | — | `TERMS` or `PRIVACY_POLICY` |
| `version` | `VARCHAR(20)` | Yes | Unique with `document_type` | Human-readable version |
| `title` | `VARCHAR(150)` | Yes | Non-empty | Display title |
| `content_url` | `TEXT` | Yes | Non-empty | Published document location |
| `content_hash` | `VARCHAR(64)` | No | — | Fingerprint of exact content |
| `effective_at` | `TIMESTAMPTZ` | Yes | — | Effective time |
| `retired_at` | `TIMESTAMPTZ` | No | Later than `effective_at` | Retirement time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Record creation time |

#### CRUD operations

- **Create:** An administrator publishes a new document version.
- **Read:** Registration retrieves the active terms and privacy policy.
- **Update:** Do not modify published content; publish a new version instead.
- **Delete:** Do not delete published versions. Set `retired_at`.

### Table: `user_consents`

Records the exact legal-document versions accepted by a user.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Consent identifier |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | User providing consent |
| `legal_document_id` | `UUID` | Yes | Foreign key to `legal_documents.id` | Accepted version |
| `accepted_at` | `TIMESTAMPTZ` | Yes | Current time | Acceptance time |
| `ip_address` | `INET` | No | — | Request-origin IP |
| `user_agent` | `TEXT` | No | — | Browser/device context |
| `revoked_at` | `TIMESTAMPTZ` | No | Later than `accepted_at` | Revocation time, when applicable |

The combination of `user_id` and `legal_document_id` is unique. Registration
normally creates one consent for the terms and one for the privacy policy.

#### CRUD operations

- **Create:** Record acceptance during registration.
- **Read:** Verify accepted versions and determine whether updated consent is
  required.
- **Update:** Only record a permitted revocation. Acceptance of a new version
  creates a new row.
- **Delete:** Never physically delete consent history.

### Table: `wallets`

Stores the user's first wallet and its current balance.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Internal wallet identifier |
| `wallet_number` | `VARCHAR(24)` | Yes | Unique | Public wallet reference |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | Wallet owner |
| `currency` | `CHAR(3)` | Yes | Default `INR`, unique with `user_id` | ISO currency |
| `balance_minor` | `BIGINT` | Yes | Default `0`, non-negative | Balance in paise |
| `status` | `wallet_status` enum | Yes | Default `ACTIVE` | Wallet lifecycle state |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Wallet creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last wallet update |
| `closed_at` | `TIMESTAMPTZ` | No | — | Wallet closure time |

`wallet_status` values:

- `ACTIVE`
- `SUSPENDED`
- `CLOSED`

Money is stored in minor units: `₹10.50` is stored as `1050` paise.

#### CRUD operations

- **Create:** Automatically create an empty INR wallet during registration.
- **Read:** Display balances and support transfer validation.
- **Update:** Change balances only through controlled financial transactions;
  change status through authorized account operations.
- **Delete:** Do not physically delete a wallet. Close it and preserve its
  ledger history.

### Registration background-job interaction

Registration creates a pending `USER_REGISTERED` job in `background_jobs`.
The complete database-backed job table is defined in Background Job Processing.

### Registration CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | Yes | Yes | Yes | Soft close only |
| `user_credentials` | Yes | Internal only | Yes | No |
| `legal_documents` | Administrator | Yes | Replace by version | Retire only |
| `user_consents` | Yes | Yes | Limited | No |
| `wallets` | Yes | Yes | Controlled | Soft close only |
| `background_jobs` | Yes | Worker | Processing state | Retention process later |

---

## 3. Login Page

**Route:** `/login`

**Purpose:** Authenticate an existing user, create a secure session, and start
password recovery when necessary.

### Sections

- **Login form:** Email address and password.
- **Forgot-password link:** Starts password recovery.
- **Registration link:** Directs new users to account creation.
- **Security feedback:** Reports invalid credentials, temporary authentication
  locks, or unavailable accounts without exposing whether an arbitrary email is
  registered.

### Database design status

Completed for login and password recovery.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `users` | Existing | Find the account and check its state |
| `user_credentials` | Existing | Verify the password and manage failed attempts |
| `auth_sessions` | New | Manage login sessions and refresh tokens |
| `password_reset_tokens` | New | Support forgot-password and password reset |
| `authentication_events` | New | Record security-relevant authentication activity |

The Login page does not create another user or wallet.

### Reused table: `users`

Login uses the following existing fields:

| Field | Type | Login usage |
|---|---|---|
| `id` | `UUID` | Links credentials and sessions |
| `email` | `VARCHAR(254)` | Finds the normalized customer account |
| `role` | `user_role` | Determines customer or administrator access |
| `status` | `user_status` | Blocks suspended or closed accounts |
| `email_verified_at` | `TIMESTAMPTZ` | Checks verification when required |

#### Login CRUD operations

- **Create:** None.
- **Read:** Find the user by normalized email and read account state.
- **Update:** None during normal login.
- **Delete:** None.

### Reused table: `user_credentials`

Login uses the following existing fields:

| Field | Type | Login usage |
|---|---|---|
| `user_id` | `UUID` | Connects credentials to the user |
| `password_hash` | `TEXT` | Verifies the submitted password |
| `password_changed_at` | `TIMESTAMPTZ` | Tracks password changes |
| `failed_login_attempts` | `SMALLINT` | Counts consecutive failures |
| `locked_until` | `TIMESTAMPTZ` | Enforces a temporary authentication lock |
| `updated_at` | `TIMESTAMPTZ` | Records credential-state changes |

#### Login CRUD operations

- **Create:** None; the row is created during registration.
- **Read:** Read the password hash, failure count, and lock expiry internally.
- **Update:** Increment or reset failed attempts, set or clear a temporary
  lock, and update the password during recovery.
- **Delete:** None.

The password hash is never returned to the frontend.

### Table: `auth_sessions`

Represents logged-in browsers or devices. The application uses a short-lived
access token and a longer-lived refresh token. Only a hash of the refresh token
is stored.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Session identifier |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | Authenticated user |
| `refresh_token_hash` | `CHAR(64)` | Yes | Unique | SHA-256 hash of refresh token |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Session creation time |
| `expires_at` | `TIMESTAMPTZ` | Yes | Later than `created_at` | Absolute session expiry |
| `last_used_at` | `TIMESTAMPTZ` | No | — | Most recent token refresh |
| `revoked_at` | `TIMESTAMPTZ` | No | — | Revocation time |
| `revocation_reason` | `VARCHAR(50)` | No | — | Reason for revocation |
| `ip_address` | `INET` | No | — | Login IP address |
| `user_agent` | `TEXT` | No | — | Browser/device information |

Suggested revocation reasons:

- `USER_LOGOUT`
- `PASSWORD_RESET`
- `PASSWORD_CHANGED`
- `ADMIN_ACTION`
- `SECURITY_RISK`

Indexes:

- Unique index on `refresh_token_hash`
- Index on `user_id`
- Index on `expires_at`
- Optional partial index for sessions where `revoked_at` is null

#### CRUD operations

- **Create:** Create a session after valid credentials and account-state checks.
- **Read:** Validate a refresh request and list active sessions.
- **Update:** Rotate the refresh-token hash, set `last_used_at`, or revoke the
  session.
- **Delete:** Prefer revocation. A retention job may remove old expired and
  revoked sessions.

The raw refresh token is sent in a secure, HTTP-only cookie and is never stored
as plaintext.

### Table: `password_reset_tokens`

Stores single-use, time-limited password-reset requests.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Reset-request identifier |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | User resetting their password |
| `token_hash` | `CHAR(64)` | Yes | Unique | Hash of reset token |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Request creation time |
| `expires_at` | `TIMESTAMPTZ` | Yes | Later than `created_at` | Token expiry |
| `used_at` | `TIMESTAMPTZ` | No | — | Successful use time |
| `invalidated_at` | `TIMESTAMPTZ` | No | — | Invalidation time |
| `requested_ip` | `INET` | No | — | Request-origin IP |
| `user_agent` | `TEXT` | No | — | Browser/device context |

Only the token hash is stored. The reset-token lifetime is application
configuration; approximately 15 minutes is appropriate for the MVP.

Indexes:

- Unique index on `token_hash`
- Index on `user_id`
- Index on `expires_at`

#### CRUD operations

- **Create:** Invalidate older unused tokens and create a new reset request.
- **Read:** Find an unexpired, unused token by its hash.
- **Update:** Mark the token used or invalidated.
- **Delete:** A retention job may remove old expired, invalidated, and used
  tokens.

### Table: `authentication_events`

Stores an append-only security history without storing submitted passwords.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Event identifier |
| `user_id` | `UUID` | No | Foreign key to `users.id` | Known affected user |
| `identifier_hash` | `CHAR(64)` | No | — | Hash of normalized submitted email |
| `event_type` | `auth_event_type` enum | Yes | — | Authentication activity |
| `failure_reason` | `auth_failure_reason` enum | No | — | Internal failure category |
| `ip_address` | `INET` | No | — | Request-origin IP |
| `user_agent` | `TEXT` | No | — | Browser/device context |
| `occurred_at` | `TIMESTAMPTZ` | Yes | Current time | Event time |

`user_id` is nullable because a login attempt may use an email that does not
exist. `identifier_hash` supports abuse detection without retaining an
unnecessary plaintext identifier.

Suggested `auth_event_type` values:

- `LOGIN_SUCCEEDED`
- `LOGIN_FAILED`
- `LOGIN_BLOCKED`
- `LOGOUT_SUCCEEDED`
- `PASSWORD_RESET_REQUESTED`
- `PASSWORD_RESET_COMPLETED`

Suggested `auth_failure_reason` values:

- `INVALID_CREDENTIALS`
- `TEMPORARILY_LOCKED`
- `ACCOUNT_SUSPENDED`
- `ACCOUNT_CLOSED`
- `RESET_TOKEN_EXPIRED`
- `RESET_TOKEN_ALREADY_USED`

Indexes:

- Index on `user_id, occurred_at`
- Index on `identifier_hash, occurred_at`
- Index on `ip_address, occurred_at`
- Index on `event_type, occurred_at`

#### CRUD operations

- **Create:** Append important authentication activity.
- **Read:** Support security investigation, throttling, and administration.
- **Update:** Never update an authentication event.
- **Delete:** Remove only through a defined security-data retention policy.

### Normal login operation

1. Normalize the submitted email.
2. Read the user and credentials.
3. Check the temporary authentication lock.
4. Verify the submitted password against the stored hash.
5. Check the account state.
6. On success, reset failed attempts, create a session, and append a
   `LOGIN_SUCCEEDED` event.
7. On failure, update the failure state when appropriate and append a
   `LOGIN_FAILED` or `LOGIN_BLOCKED` event.

Invalid credentials receive a generic response such as `Invalid email or
password.` The response does not reveal whether the email exists. After valid
credentials are established, a suspended account can receive a safe message
such as `This account is currently unavailable. Contact support.`

### Forgot-password operation

1. Accept and normalize the submitted email.
2. Always return the same public response, whether or not the email exists.
3. For an eligible account, invalidate older unused reset tokens.
4. Create a new password-reset token.
5. Create a pending `SEND_PASSWORD_RESET_EMAIL` background job.
6. When the token is used, update `user_credentials.password_hash` and
   `password_changed_at`.
7. Mark the token used and revoke existing sessions.

The public response is similar to: `If an eligible account exists,
password-reset instructions have been sent.`

### Password-reset transaction

The following changes occur in one PostgreSQL transaction:

1. Verify that the reset token is valid.
2. Update the password hash and `password_changed_at`.
3. Mark the reset token as used.
4. Revoke existing sessions.
5. Append a `PASSWORD_RESET_COMPLETED` background job when follow-up work is
   required.
6. Commit all changes together.

The existing `background_jobs` mechanism requests delivery of the
password-reset message. Its complete schema is defined in Background Job
Processing.

### Login CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Yes | No during login | No |
| `user_credentials` | No | Internal only | Attempts, lock, and password | No |
| `auth_sessions` | Yes | Yes | Refresh or revoke | Retention cleanup |
| `password_reset_tokens` | Yes | Yes | Use or invalidate | Retention cleanup |
| `authentication_events` | Append only | Yes | No | Retention policy only |

---

## 4. Customer Dashboard

**Route:** `/dashboard`

**Purpose:** Give the authenticated customer a quick overview of their wallet.

### Sections

- Wallet balance card
- Quick actions
- Recent transactions
- Monthly money-sent and money-received summary
- Spending overview
- Recent notifications
- Important account or wallet alerts

### Database design status

Completed for the Customer Dashboard.

The dashboard is primarily a read page. Opening it does not create a financial
record or update a wallet balance.

### Tables involved

| Table | Existing/New | Dashboard responsibility |
|---|---|---|
| `users` | Existing | Customer name and account alerts |
| `wallets` | Existing | Current balance and wallet status |
| `transfers` | New | Recent sent and received transfers |
| `wallet_daily_summaries` | New | Worker-produced charts and monthly totals |
| `notifications` | New | Recent notifications and important alerts |

There is no separate `dashboards` table. NestJS composes the response from
these tables.

### Reused table: `users`

| Field | Type | Dashboard usage |
|---|---|---|
| `id` | `UUID` | Identifies the authenticated customer |
| `full_name` | `VARCHAR(100)` | Displays the customer's name |
| `status` | `user_status` | Shows account restrictions |
| `email_verified_at` | `TIMESTAMPTZ` | Supports an email-verification warning |
| `phone_verified_at` | `TIMESTAMPTZ` | Supports a phone-verification warning |

#### Dashboard CRUD operations

- **Create:** None.
- **Read:** Read the customer's name, status, and verification state.
- **Update:** None from the dashboard.
- **Delete:** None.

The user ID comes from the authenticated session. The frontend cannot select a
different user's dashboard by submitting another user ID.

### Reused table: `wallets`

| Field | Type | Dashboard usage |
|---|---|---|
| `id` | `UUID` | Wallet identifier |
| `wallet_number` | `VARCHAR(24)` | Public wallet reference |
| `user_id` | `UUID` | Confirms wallet ownership |
| `currency` | `CHAR(3)` | Displays the wallet currency |
| `balance_minor` | `BIGINT` | Current available balance in minor units |
| `status` | `wallet_status` | Displays active, suspended, or closed state |
| `updated_at` | `TIMESTAMPTZ` | Indicates when the balance last changed |

#### Dashboard CRUD operations

- **Create:** None.
- **Read:** Read the balance, currency, and wallet state.
- **Update:** None from the dashboard.
- **Delete:** None.

The displayed balance comes directly from `wallets`, not from derived
analytics.

### Table: `transfers`

Stores wallet-to-wallet transfers. The dashboard reads the most recent
transfers involving the customer's wallet. The complete financial mutation
rules will be finalized with the Send Money page.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Transfer identifier |
| `sender_wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Sending wallet |
| `receiver_wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Receiving wallet |
| `amount_minor` | `BIGINT` | Yes | Greater than zero | Amount in minor units |
| `currency` | `CHAR(3)` | Yes | — | Transfer currency |
| `status` | `transfer_status` enum | Yes | — | Transfer state |
| `note` | `VARCHAR(200)` | No | — | Customer-provided description |
| `failure_code` | `VARCHAR(50)` | No | — | Internal failure category |
| `initiated_at` | `TIMESTAMPTZ` | Yes | Current time | Initiation time |
| `completed_at` | `TIMESTAMPTZ` | No | — | Successful completion time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Record creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last state change |

`transfer_status` values:

- `PENDING`
- `COMPLETED`
- `FAILED`
- `REVERSED`

Indexes:

- Index on `sender_wallet_id, created_at`
- Index on `receiver_wallet_id, created_at`
- Index on `status, created_at`

The counterparty name is obtained through the counterparty wallet's user. It is
not copied into the transfer.

#### Dashboard CRUD operations

- **Create:** None from the dashboard.
- **Read:** Read recent transfers involving the customer's wallet.
- **Update:** None from the dashboard.
- **Delete:** None.

### Table: `wallet_daily_summaries`

Stores daily analytics generated by the background analytics worker.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Summarized wallet |
| `summary_date` | `DATE` | Yes | — | Calendar date |
| `currency` | `CHAR(3)` | Yes | — | Summary currency |
| `sent_amount_minor` | `BIGINT` | Yes | Default `0`, non-negative | Total money sent |
| `received_amount_minor` | `BIGINT` | Yes | Default `0`, non-negative | Total money received |
| `sent_count` | `INTEGER` | Yes | Default `0`, non-negative | Successful outgoing transfers |
| `received_count` | `INTEGER` | Yes | Default `0`, non-negative | Successful incoming transfers |
| `failed_transfer_count` | `INTEGER` | Yes | Default `0`, non-negative | Failed transfer attempts |
| `last_job_at` | `TIMESTAMPTZ` | No | — | Latest included job |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last summary update |

The composite primary key is `wallet_id + summary_date + currency`.

#### CRUD operations

- **Create:** The analytics worker creates the first summary for a wallet,
  date, and currency.
- **Read:** The dashboard reads today's and the current month's summaries.
- **Update:** The analytics worker upserts totals as it processes jobs.
- **Delete:** Customers cannot delete summaries. Retention or rebuilding is an
  operational action.

These summaries are eventually consistent. They are not used to approve a
transfer or calculate the official wallet balance.

### Table: `notifications`

Stores in-app notifications, primarily created by the background notification
worker.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Notification identifier |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | Recipient |
| `notification_type` | `notification_type` enum | Yes | — | Notification category |
| `severity` | `notification_severity` enum | Yes | Default `INFO` | Importance |
| `title` | `VARCHAR(150)` | Yes | Non-empty | Short heading |
| `message` | `TEXT` | Yes | Non-empty | User-facing message |
| `related_resource_type` | `VARCHAR(40)` | No | — | Such as `TRANSFER` or `WALLET` |
| `related_resource_id` | `UUID` | No | — | Related record |
| `source_job_id` | `UUID` | No | Idempotency constraint | Source background job |
| `action_path` | `VARCHAR(300)` | No | Internal application path | Page opened from the notification |
| `read_at` | `TIMESTAMPTZ` | No | — | Time marked as read |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |

Suggested `notification_type` values:

- `TRANSFER_SENT`
- `TRANSFER_RECEIVED`
- `TRANSFER_FAILED`
- `WALLET_STATUS_CHANGED`
- `ACCOUNT_SECURITY`
- `SYSTEM_MESSAGE`

`notification_severity` values:

- `INFO`
- `WARNING`
- `CRITICAL`

`read_at = null` means unread, so a separate `is_read` field is unnecessary.

Indexes:

- Index on `user_id, created_at`
- Index on `user_id, read_at`
- Index on `severity, created_at`
- Idempotency index using `user_id`, `source_job_id`, and
  `notification_type`

#### CRUD operations

- **Create:** The notification worker creates notifications. Certain
  synchronous security operations may also create them.
- **Read:** The dashboard reads recent notifications, unread count, and
  important alerts.
- **Update:** Mark a notification as read by setting `read_at`.
- **Delete:** The dashboard cannot delete notifications. Retention handles old
  records.

Viewing the dashboard does not automatically mark notifications as read.

### Quick actions

Send Money, Add Virtual Funds, and View Transactions are navigation controls.
They require no database table and perform no database operation until their
destination workflow is used.

### Dashboard loading operation

1. Obtain the user ID from the authenticated session.
2. Read the customer's name and account state.
3. Read the active INR wallet and authoritative balance.
4. Read recent transfers involving that wallet.
5. Read the current month's daily summaries.
6. Read recent notifications and the unread count.
7. Return one composed dashboard response.

### Dashboard CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Yes | No | No |
| `wallets` | No | Yes | No | No |
| `transfers` | No | Yes | No | No |
| `wallet_daily_summaries` | Analytics worker | Yes | Analytics worker | Retention only |
| `notifications` | Notification worker | Yes | Mark as read | Retention only |

The dashboard reads authoritative financial state from PostgreSQL and displays
Worker-produced analytics remains secondary, eventually consistent
information.

---

## 5. Add Virtual Funds

**Route:** `/wallet/add-funds`

**Purpose:** Add simulated funds without a real bank or payment gateway.

### Sections

- Current balance
- Amount input
- Simulated funding source
- Summary and confirmation
- Operation result

Every successful operation must create balanced ledger entries.

### Database design status

Completed for Add Virtual Funds.

The workflow uses simulated funds only. It does not collect or store card,
bank-account, CVV, or UPI credentials.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `users` | Existing | Identify the authenticated customer |
| `wallets` | Existing | Read and increase the wallet balance |
| `funding_transactions` | New | Record simulated funding operations |
| `ledger_accounts` | New | Represent customer-wallet and system accounts |
| `ledger_transactions` | New | Group entries for one financial operation |
| `ledger_entries` | New | Record balanced debits and credits |
| `background_jobs` | Existing | Process deferred post-funding work |

### Reused table: `users`

| Field | Type | Funding usage |
|---|---|---|
| `id` | `UUID` | Identifies the authenticated customer |
| `status` | `user_status` | Prevents restricted accounts from adding funds |

#### CRUD operations

- **Create:** None.
- **Read:** Confirm the authenticated account is active.
- **Update:** None.
- **Delete:** None.

The user ID comes from the authenticated session, not from a user-selectable
request field.

### Reused table: `wallets`

| Field | Type | Funding usage |
|---|---|---|
| `id` | `UUID` | Wallet being funded |
| `user_id` | `UUID` | Confirms ownership |
| `currency` | `CHAR(3)` | Confirms the operation uses INR |
| `balance_minor` | `BIGINT` | Current balance in paise |
| `status` | `wallet_status` | Confirms the wallet is active |
| `updated_at` | `TIMESTAMPTZ` | Records the balance update |

#### CRUD operations

- **Create:** None.
- **Read:** Read ownership, balance, currency, and status.
- **Update:** Increase `balance_minor` atomically.
- **Delete:** None.

The wallet row is locked inside the PostgreSQL transaction before its balance
changes.

### Table: `funding_transactions`

Stores every accepted simulated funding operation.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Funding identifier |
| `wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Funded wallet |
| `initiated_by_user_id` | `UUID` | Yes | Foreign key to `users.id` | Initiating customer |
| `idempotency_key` | `UUID` | Yes | Unique with `wallet_id` | Prevents duplicate funding |
| `amount_minor` | `BIGINT` | Yes | Greater than zero | Amount in paise |
| `currency` | `CHAR(3)` | Yes | Must match wallet | Funding currency |
| `source_type` | `funding_source_type` enum | Yes | `SIMULATED` | Funding source |
| `status` | `funding_status` enum | Yes | Initially `PENDING` | Operation state |
| `balance_before_minor` | `BIGINT` | No | Non-negative | Balance before completion |
| `balance_after_minor` | `BIGINT` | No | Non-negative | Balance after completion |
| `failure_code` | `VARCHAR(50)` | No | — | Internal failure category |
| `initiated_at` | `TIMESTAMPTZ` | Yes | Current time | Initiation time |
| `completed_at` | `TIMESTAMPTZ` | No | — | Completion time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Record creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last state update |

For the MVP, `funding_source_type` contains only `SIMULATED`.

`funding_status` values:

- `PENDING`
- `COMPLETED`
- `FAILED`

The unique combination `wallet_id + idempotency_key` ensures that a retry or
double-click returns the original operation instead of adding funds twice.

Indexes:

- Unique index on `wallet_id, idempotency_key`
- Index on `wallet_id, created_at`
- Index on `initiated_by_user_id, created_at`
- Index on `status, created_at`

#### CRUD operations

- **Create:** Create the funding operation after confirmation.
- **Read:** Support results, transaction history, administration, and
  idempotency checks.
- **Update:** Change processing state, balance snapshots, failure code, and
  completion time. Do not edit the amount, currency, wallet, or customer after
  completion.
- **Delete:** Never physically delete a financial-operation record.

### Table: `ledger_accounts`

Represents accounts affected by ledger entries.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Ledger-account identifier |
| `account_code` | `VARCHAR(50)` | Yes | Unique | Stable account reference |
| `account_type` | `ledger_account_type` enum | Yes | — | Account classification |
| `wallet_id` | `UUID` | No | Unique foreign key to `wallets.id` | Related customer wallet |
| `name` | `VARCHAR(150)` | Yes | Non-empty | Human-readable name |
| `currency` | `CHAR(3)` | Yes | — | Account currency |
| `status` | `ledger_account_status` enum | Yes | Default `ACTIVE` | Account state |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last state update |

Account types currently required:

- `USER_WALLET`
- `SYSTEM_FUNDING`

For `USER_WALLET`, `wallet_id` is required and unique. For `SYSTEM_FUNDING`,
`wallet_id` is null, and the platform has one system funding account for INR.

#### CRUD operations

- **Create:** Seed the system funding account and create a user-wallet account
  when a wallet is created.
- **Read:** Find accounts needed for ledger entries.
- **Update:** Change only permitted metadata or account status.
- **Delete:** Never delete an account referenced by ledger entries.

This design adds a dependency to Registration: creating a wallet must also
create its `USER_WALLET` ledger account. The Registration section can be
amended when the shared ledger design is consolidated.

### Table: `ledger_transactions`

Groups all ledger entries created by one financial operation.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Ledger-transaction identifier |
| `transaction_type` | `ledger_transaction_type` enum | Yes | — | Financial-operation type |
| `reference_id` | `UUID` | Yes | Unique with transaction type | Source business record |
| `description` | `VARCHAR(200)` | No | — | Human-readable explanation |
| `reversal_of_id` | `UUID` | No | Foreign key to `ledger_transactions.id` | Original transaction reversed |
| `posted_at` | `TIMESTAMPTZ` | Yes | Current time | Posting time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |

The funding transaction type is `WALLET_FUNDING`. The combination
`transaction_type + reference_id` is unique.

#### CRUD operations

- **Create:** Create one ledger transaction per completed funding operation.
- **Read:** Support statements, details, reconciliation, and investigation.
- **Update:** Never update a posted ledger transaction.
- **Delete:** Never delete it. Corrections create a reversing transaction.

### Table: `ledger_entries`

Stores the individual debit and credit movements.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Entry identifier |
| `ledger_transaction_id` | `UUID` | Yes | Foreign key to `ledger_transactions.id` | Parent transaction |
| `ledger_account_id` | `UUID` | Yes | Foreign key to `ledger_accounts.id` | Affected account |
| `entry_type` | `ledger_entry_type` enum | Yes | — | `DEBIT` or `CREDIT` |
| `amount_minor` | `BIGINT` | Yes | Greater than zero | Entry amount |
| `currency` | `CHAR(3)` | Yes | Must match account | Entry currency |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Entry creation time |

For a ₹500 funding:

| Ledger account | Entry | Amount |
|---|---|---:|
| System INR funding account | Debit | ₹500 |
| Customer wallet account | Credit | ₹500 |

Total debits must equal total credits.

Indexes:

- Index on `ledger_transaction_id`
- Index on `ledger_account_id, created_at`

#### CRUD operations

- **Create:** Create balanced debit and credit entries in the funding
  transaction.
- **Read:** Support statements, reconciliation, details, and administration.
- **Update:** Never update a posted entry.
- **Delete:** Never delete a posted entry. Corrections use reversing entries.

NestJS validates the complete debit-credit set, and PostgreSQL commits all
entries atomically. A deferred database trigger can later provide an additional
balance safeguard.

### Background-job interaction

The same database transaction creates separate pending jobs for notification,
analytics, and audit work. Each job references the funding transaction and
wallet and contains only the minimum safe data needed by its handler. The full
`background_jobs` schema is defined in Background Job Processing.

### Atomic Add Virtual Funds operation

1. Obtain the user ID from the authenticated session.
2. Validate the amount, account, wallet ownership, wallet status, and currency.
3. Begin a PostgreSQL transaction.
4. Lock the wallet row.
5. Check the idempotency key.
6. Record the balance before funding.
7. Create the funding transaction.
8. Increase the wallet balance and record the resulting balance.
9. Create the ledger transaction.
10. Debit the system funding account.
11. Credit the customer wallet account.
12. Validate that total debits equal total credits.
13. Create the required post-funding background jobs.
14. Mark the funding transaction completed.
15. Commit everything together.

If any database step fails, all changes are rolled back.

Invalid requests, including non-positive amounts, incorrect ownership,
suspended wallets, currency mismatch, and amounts over the configured limit,
do not modify financial tables.

### Add Virtual Funds CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Account state | No | No |
| `wallets` | No | Balance and status | Increase balance atomically | No |
| `funding_transactions` | Yes | Yes | Status and result | No |
| `ledger_accounts` | Setup/registration | Yes | Restricted metadata/status | No |
| `ledger_transactions` | Yes | Yes | No | No |
| `ledger_entries` | Yes | Yes | No | No |
| `background_jobs` | Yes | Worker | Processing state | Retention later |

---

## 6. Send Money

**Route:** `/transfers/new`

**Purpose:** Transfer virtual money to another user.

### Sections

- Available balance
- Recipient search and selection
- Verified recipient preview
- Transfer amount
- Optional note
- Transfer summary
- Final confirmation

### Database design status

Completed for Send Money.

A successful transfer atomically debits the sender, credits the receiver,
records the transfer, creates balanced ledger entries, and creates the required
background jobs.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `users` | Existing | Validate sender and resolve recipient |
| `wallets` | Existing | Read and update both balances |
| `transfers` | Existing provisional design | Store the business transfer |
| `ledger_accounts` | Existing | Identify sender and receiver accounts |
| `ledger_transactions` | Existing | Group the transfer ledger entries |
| `ledger_entries` | Existing | Record sender debit and receiver credit |
| `background_jobs` | Existing | Process deferred transfer work |
| `notifications` | Existing | Worker-created customer notifications |
| `wallet_daily_summaries` | Existing | Worker-updated analytics |

No saved-recipient or beneficiary table is required for the MVP.

### Reused table: `users`

| Field | Type | Transfer usage |
|---|---|---|
| `id` | `UUID` | Identifies sender and receiver |
| `full_name` | `VARCHAR(100)` | Displays a safe recipient preview |
| `email` | `VARCHAR(254)` | Exact recipient lookup |
| `phone_number` | `VARCHAR(20)` | Exact recipient lookup |
| `status` | `user_status` | Confirms both accounts are eligible |

#### CRUD operations

- **Create:** None.
- **Read:** Read sender state and resolve the recipient.
- **Update:** None.
- **Delete:** None.

Recipient lookup requires an exact identifier, is rate-limited, returns only
safe preview information, and does not reveal restricted accounts. A sender
cannot select themselves.

### Reused table: `wallets`

| Field | Type | Transfer usage |
|---|---|---|
| `id` | `UUID` | Identifies each wallet |
| `wallet_number` | `VARCHAR(24)` | Recipient lookup and display |
| `user_id` | `UUID` | Confirms ownership |
| `currency` | `CHAR(3)` | Confirms matching currencies |
| `balance_minor` | `BIGINT` | Balance before and after transfer |
| `status` | `wallet_status` | Confirms both wallets are active |
| `updated_at` | `TIMESTAMPTZ` | Records the balance update |

#### CRUD operations

- **Create:** None.
- **Read:** Read ownership, currency, status, and balance.
- **Update:** Debit the sender and credit the receiver atomically.
- **Delete:** None.

Both wallet rows are locked before either balance changes. They are always
locked in a deterministic order, such as ascending wallet ID, to reduce
deadlocks.

### Finalized table: `transfers`

The Send Money workflow finalizes the provisional transfer structure introduced
by the Customer Dashboard.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Internal transfer identifier |
| `transfer_reference` | `VARCHAR(24)` | Yes | Unique | Customer-facing reference |
| `sender_wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Sending wallet |
| `receiver_wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Receiving wallet |
| `initiated_by_user_id` | `UUID` | Yes | Foreign key to `users.id` | Initiating customer |
| `idempotency_key` | `UUID` | Yes | Unique with sender wallet | Prevents duplicates |
| `amount_minor` | `BIGINT` | Yes | Greater than zero | Transfer amount |
| `currency` | `CHAR(3)` | Yes | Must match both wallets | Transfer currency |
| `note` | `VARCHAR(200)` | No | — | Optional customer note |
| `status` | `transfer_status` enum | Yes | Initially `PENDING` | Transfer state |
| `sender_balance_before_minor` | `BIGINT` | No | Non-negative | Sender balance before |
| `sender_balance_after_minor` | `BIGINT` | No | Non-negative | Sender balance after |
| `receiver_balance_before_minor` | `BIGINT` | No | Non-negative | Receiver balance before |
| `receiver_balance_after_minor` | `BIGINT` | No | Non-negative | Receiver balance after |
| `failure_code` | `VARCHAR(50)` | No | — | Internal failure reason |
| `initiated_at` | `TIMESTAMPTZ` | Yes | Current time | Initiation time |
| `completed_at` | `TIMESTAMPTZ` | No | — | Completion time |
| `failed_at` | `TIMESTAMPTZ` | No | — | Failure time |
| `reversed_at` | `TIMESTAMPTZ` | No | — | Future reversal time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last state update |

`transfer_status` values:

- `PENDING`
- `COMPLETED`
- `FAILED`
- `REVERSED`

Constraints:

- `amount_minor > 0`
- Sender and receiver wallets must differ
- Both wallets must use the transfer currency
- Sender must have sufficient balance
- `transfer_reference` is unique
- `sender_wallet_id + idempotency_key` is unique
- `completed_at` is required for `COMPLETED`
- `failed_at` is required for `FAILED`

If the same sender, key, and payload are submitted again, return the original
transfer. Reusing the key with a different recipient or amount is rejected.

Indexes:

- Unique index on `transfer_reference`
- Unique index on `sender_wallet_id, idempotency_key`
- Index on `sender_wallet_id, created_at`
- Index on `receiver_wallet_id, created_at`
- Index on `initiated_by_user_id, created_at`
- Index on `status, created_at`

#### CRUD operations

- **Create:** Create a transfer after customer confirmation.
- **Read:** Support results, history, dashboard, details, administration, and
  idempotency.
- **Update:** Change only processing state, balance snapshots, failure code,
  and lifecycle timestamps. Do not edit completed transfer parties, amount,
  currency, note, or idempotency key.
- **Delete:** Never physically delete a transfer. Reversals create new
  financial records.

### Reused table: `ledger_accounts`

The transfer reads the sender and receiver `USER_WALLET` accounts and verifies
that both are active and use the transfer currency.

#### CRUD operations

- **Create:** None during transfer.
- **Read:** Find sender and receiver ledger accounts.
- **Update:** None.
- **Delete:** None.

### Reused table: `ledger_transactions`

One completed transfer creates one ledger transaction with:

- `transaction_type = WALLET_TRANSFER`
- `reference_id = transfer.id`

#### CRUD operations

- **Create:** Create one transaction per completed transfer.
- **Read:** Support statements, details, and reconciliation.
- **Update:** None after posting.
- **Delete:** None.

### Reused table: `ledger_entries`

For a ₹500 transfer from Alice to Bob:

| Ledger account | Entry type | Amount |
|---|---|---:|
| Alice's wallet account | Debit | ₹500 |
| Bob's wallet account | Credit | ₹500 |

Total debits must equal total credits.

#### CRUD operations

- **Create:** Create the sender debit and receiver credit.
- **Read:** Support statements, details, and reconciliation.
- **Update:** None.
- **Delete:** None.

Both entries are inserted in the same PostgreSQL transaction as the wallet
balance updates.

### Background-job interaction

A successful transfer creates separate pending jobs for notification,
analytics, and audit work. Each job references the transfer and contains only
the minimum safe facts needed by its handler. It does not include credentials,
contact information, authentication tokens, or wallet balances.

A user-relevant failed transfer may create a failure-notification or audit job.

#### CRUD operations

- **Create:** The financial transaction creates the background jobs.
- **Read:** The worker claims pending jobs.
- **Update:** The worker records processing and retry state.
- **Delete:** Retention process only.

### Asynchronous table interactions

The Send Money request does not synchronously create notifications or daily
summaries.

- The notification worker creates `notifications` rows. Customers later read
  them and may set `read_at`.
- The analytics worker creates or upserts `wallet_daily_summaries` for the
  sender and receiver.

A background-job failure does not reverse a completed transfer.

### Atomic Send Money operation

1. Obtain the sender user ID from the authenticated session.
2. Validate the amount and optional note.
3. Resolve the recipient by an exact identifier.
4. Prevent a self-transfer.
5. Begin a PostgreSQL transaction.
6. Lock both wallet rows in deterministic order.
7. Recheck ownership and account and wallet states.
8. Confirm matching currencies.
9. Check the idempotency key.
10. Confirm sufficient sender balance.
11. Record both balances before the transfer.
12. Create the transfer.
13. Debit the sender and credit the receiver.
14. Record both resulting balances.
15. Create the ledger transaction.
16. Create the sender debit and receiver credit.
17. Validate equal total debits and credits.
18. Create the required completed-transfer background jobs.
19. Mark the transfer completed.
20. Commit everything together.

If any financial step fails, PostgreSQL rolls back all changes.

Concurrent transfers are protected by the sender-wallet lock and a conditional
balance update that prevents the balance from becoming negative.

### Failed transfers

Business failures include insufficient balance, inactive participants,
suspended wallets, currency mismatch, self-transfer, invalid amount, and
configured transfer-limit violations.

They do not change balances, create ledger entries, or produce completed-work
jobs. A user-relevant failure may be stored as a `FAILED` transfer with a safe
internal failure code. Infrastructure failures during the atomic transaction
cause a complete rollback.

### Send Money CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Sender/recipient state | No | No |
| `wallets` | No | Ownership, state, and balances | Debit and credit atomically | No |
| `transfers` | Yes | Yes | Processing state only | No |
| `ledger_accounts` | No | Yes | No | No |
| `ledger_transactions` | Yes | Yes | No | No |
| `ledger_entries` | Yes | Yes | No | No |
| `background_jobs` | Yes | Worker | Processing state | Retention only |
| `notifications` | Worker | Yes | Mark as read | Retention only |
| `wallet_daily_summaries` | Worker | Yes | Worker upsert | Retention/rebuild |

PostgreSQL completes the debit, credit, transfer, ledger, and job creation
atomically. The background worker handles deferred work after the financial
operation is safe.

---

## 7. Transfer Result

**Route:** `/transfers/result/:id`

**Purpose:** Show the immediate result of a transfer attempt.

### Sections

- Transfer status
- Transfer summary
- Safe failure explanation
- Links to the dashboard or transaction details

`COMPLETED` means the PostgreSQL financial transaction committed. It does not
wait for notification or analytics background jobs.

### Database design status

Completed for Transfer Result.

The result page is read-only. It presents the outcome created by the Send Money
workflow and never repeats or changes the financial operation.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `transfers` | Existing | Main source of result information |
| `wallets` | Existing | Verify sender ownership and identify the counterparty |
| `users` | Existing | Display safe recipient information |

No new table is required. The ledger does not need to be queried on every page
load because it was posted atomically with a completed transfer.

### Reused table: `transfers`

| Field | Type | Result-page usage |
|---|---|---|
| `id` | `UUID` | Route identifier |
| `transfer_reference` | `VARCHAR(24)` | Customer-facing reference |
| `sender_wallet_id` | `UUID` | Identifies the sender |
| `receiver_wallet_id` | `UUID` | Identifies the recipient |
| `initiated_by_user_id` | `UUID` | Authorizes access |
| `amount_minor` | `BIGINT` | Displays the amount |
| `currency` | `CHAR(3)` | Formats the amount |
| `note` | `VARCHAR(200)` | Displays the optional note |
| `status` | `transfer_status` | Selects the result state |
| `sender_balance_before_minor` | `BIGINT` | Optional balance-change explanation |
| `sender_balance_after_minor` | `BIGINT` | Balance immediately after transfer |
| `failure_code` | `VARCHAR(50)` | Maps to a safe failure message |
| `initiated_at` | `TIMESTAMPTZ` | Initiation time |
| `completed_at` | `TIMESTAMPTZ` | Completion time |
| `failed_at` | `TIMESTAMPTZ` | Failure time |
| `reversed_at` | `TIMESTAMPTZ` | Reversal time |

The page displays `sender_balance_after_minor`, not the sender's current wallet
balance. Later transactions may have changed the current balance.

Status behavior:

- **`COMPLETED`:** Show success, amount, recipient, reference, completion time,
  and the sender balance immediately after the transfer.
- **`FAILED`:** Show an unsuccessful result and a safe explanation.
- **`PENDING`:** Show processing and recheck the existing transfer instead of
  submitting another.
- **`REVERSED`:** Explain that the completed transfer was later reversed.

#### CRUD operations

- **Create:** None.
- **Read:** Read the result.
- **Update:** None from this page.
- **Delete:** None.

Refreshing the page never repeats the transfer.

### Reused table: `wallets`

| Field | Type | Result-page usage |
|---|---|---|
| `id` | `UUID` | Matches sender and receiver wallet IDs |
| `wallet_number` | `VARCHAR(24)` | Displays a masked recipient reference |
| `user_id` | `UUID` | Connects each wallet to its owner |
| `currency` | `CHAR(3)` | Confirms display currency |

#### CRUD operations

- **Create:** None.
- **Read:** Verify sender ownership and resolve the receiver.
- **Update:** None.
- **Delete:** None.

### Reused table: `users`

| Field | Type | Result-page usage |
|---|---|---|
| `id` | `UUID` | Connects the receiver wallet to its owner |
| `full_name` | `VARCHAR(100)` | Displays the safe recipient name |

The result does not expose the recipient's full email address, full phone
number, account state, or private profile information.

#### CRUD operations

- **Create:** None.
- **Read:** Read the recipient's safe display name.
- **Update:** None.
- **Delete:** None.

### Safe failure mapping

`failure_code` is internal and is mapped by NestJS to safe text.

| Internal failure code | Customer message |
|---|---|
| `INSUFFICIENT_FUNDS` | You do not have enough balance for this transfer. |
| `TRANSFER_LIMIT_EXCEEDED` | This transfer exceeds the permitted limit. |
| `RECIPIENT_UNAVAILABLE` | The selected recipient cannot receive this transfer. |
| `WALLET_UNAVAILABLE` | Your wallet is currently unavailable. |
| `CURRENCY_MISMATCH` | The wallets do not support the same currency. |
| `PROCESSING_ERROR` | The transfer could not be completed. Please try again later. |

No failure-message table is needed. The application configuration owns the
mapping. Responses never expose database errors, stack traces, internal service
names, recipient restrictions, background-job errors, or PostgreSQL errors.

### Authorization and loading operation

1. Authenticate the customer.
2. Read the transfer by ID.
3. Verify that `initiated_by_user_id` matches the authenticated user.
4. Load safe recipient information.
5. Map status and failure code.
6. Return the result.

A missing transfer and a transfer belonging to another user both return the
same `Transfer not found` response. This post-transfer result page is intended
for the sender; a receiver can later use Transaction Details.

### Pending polling and retry

Polling reads the same transfer until it becomes `COMPLETED`, `FAILED`, or
`REVERSED`. It never submits a new transfer or creates a new idempotency key.

A retry action is shown only for a confirmed retryable `FAILED` transfer. The
retry is a new transfer request with a new idempotency key. An uncertain or
`PENDING` transfer must be checked rather than recreated.

### Transfer Result CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `transfers` | No | Yes | No | No |
| `wallets` | No | Yes | No | No |
| `users` | No | Safe recipient details | No | No |

The Send Money workflow creates the result; this page only reads and presents
it safely.

---

## 8. Transaction History

**Route:** `/transactions`

**Purpose:** Provide searchable and filterable wallet activity.

### Sections

- Period summary cards
- Search
- Date, direction, amount, and status filters
- Paginated transaction list
- Future CSV export

### Database design status

Completed for Transaction History.

The page is read-only and presents customer-visible wallet activity: sent and
received transfers, simulated funding, failed outgoing transfers, and
reversals. Wallet Statement later provides the accounting-level view.

### Tables and view involved

| Data source | Existing/New | Purpose |
|---|---|---|
| `wallets` | Existing | Identify the customer's wallet |
| `transfers` | Existing | Provide outgoing and incoming transfers |
| `funding_transactions` | Existing | Provide simulated funding activity |
| `users` | Existing | Provide safe counterparty names |
| `wallet_activity_history` | New database view | Combine source records for reading |

No new storage table is required. A PostgreSQL view, or an equivalent
repository-level `UNION ALL` query, avoids duplicating financial data.

### Reused table: `wallets`

| Field | Type | History usage |
|---|---|---|
| `id` | `UUID` | Filters activity |
| `user_id` | `UUID` | Verifies ownership |
| `wallet_number` | `VARCHAR(24)` | Displays the wallet reference |
| `currency` | `CHAR(3)` | Formats amounts |
| `status` | `wallet_status` | Shows wallet state |

#### CRUD operations

- **Create:** None.
- **Read:** Find the authenticated customer's wallet.
- **Update:** None.
- **Delete:** None.

### Reused table: `transfers`

| Field | Type | History usage |
|---|---|---|
| `id` | `UUID` | Source transaction ID |
| `transfer_reference` | `VARCHAR(24)` | Searchable customer reference |
| `sender_wallet_id` | `UUID` | Determines outgoing direction |
| `receiver_wallet_id` | `UUID` | Determines incoming direction |
| `amount_minor` | `BIGINT` | Displays and filters the amount |
| `currency` | `CHAR(3)` | Formats the amount |
| `note` | `VARCHAR(200)` | Description and search |
| `status` | `transfer_status` | Status filter |
| `failure_code` | `VARCHAR(50)` | Safe failure display |
| `initiated_at` | `TIMESTAMPTZ` | Activity ordering |
| `completed_at` | `TIMESTAMPTZ` | Completion display |
| `failed_at` | `TIMESTAMPTZ` | Failure display |
| `reversed_at` | `TIMESTAMPTZ` | Reversal display |

The sender can see all transfer states. The receiver sees a transfer only after
it financially affects their wallet: `COMPLETED` or `REVERSED`. Failed and
pending incoming attempts are not exposed to the intended receiver.

#### CRUD operations

- **Create:** None.
- **Read:** Read transfers involving the customer's wallet.
- **Update:** None.
- **Delete:** None.

### Reused table: `funding_transactions`

| Field | Type | History usage |
|---|---|---|
| `id` | `UUID` | Source funding ID |
| `wallet_id` | `UUID` | Filters by customer wallet |
| `amount_minor` | `BIGINT` | Displays and filters amount |
| `currency` | `CHAR(3)` | Formats amount |
| `source_type` | `funding_source_type` | Displays simulated source |
| `status` | `funding_status` | Status filter |
| `failure_code` | `VARCHAR(50)` | Safe failure display |
| `initiated_at` | `TIMESTAMPTZ` | Activity ordering |
| `completed_at` | `TIMESTAMPTZ` | Completion display |

#### CRUD operations

- **Create:** None.
- **Read:** Read funding operations for the customer's wallet.
- **Update:** None.
- **Delete:** None.

### Reused table: `users`

| Field | Type | History usage |
|---|---|---|
| `id` | `UUID` | Counterparty identifier |
| `full_name` | `VARCHAR(100)` | Safe counterparty name |

#### CRUD operations

- **Create:** None.
- **Read:** Read safe counterparty names.
- **Update:** None.
- **Delete:** None.

History does not expose counterparties' contact information, balances, or
account state.

### Database view: `wallet_activity_history`

The read-only view combines:

- Outgoing transfers
- Incoming completed or reversed transfers
- Funding transactions

| Field | Derived type | Purpose |
|---|---|---|
| `activity_key` | `TEXT` | Unique type-and-source key |
| `wallet_id` | `UUID` | Wallet whose history contains the activity |
| `source_type` | Activity-source enum | `TRANSFER` or `FUNDING` |
| `source_id` | `UUID` | Transfer or funding ID |
| `reference` | `VARCHAR(24)` | Transfer reference or funding identifier |
| `activity_type` | Activity-type enum | Customer-friendly classification |
| `direction` | Direction enum | `DEBIT` or `CREDIT` |
| `counterparty_wallet_id` | `UUID` | Other transfer wallet |
| `amount_minor` | `BIGINT` | Activity amount |
| `currency` | `CHAR(3)` | Activity currency |
| `status` | Normalized status enum | Current activity state |
| `note` | `VARCHAR(200)` | Optional description |
| `failure_code` | `VARCHAR(50)` | Internal failure category |
| `occurred_at` | `TIMESTAMPTZ` | Stable sorting timestamp |
| `completed_at` | `TIMESTAMPTZ` | Completion time |

Activity types:

- `TRANSFER_SENT`
- `TRANSFER_RECEIVED`
- `FUNDS_ADDED`
- `TRANSFER_REVERSED`

Directions:

- Sent transfer: `DEBIT`
- Received transfer: `CREDIT`
- Added funds: `CREDIT`
- Reversal returned to sender: `CREDIT`

An activity key includes its perspective, for example:

- `TRANSFER_SENT:<transfer UUID>`
- `TRANSFER_RECEIVED:<transfer UUID>`
- `FUNDING:<funding UUID>`

#### CRUD operations

- **Create:** None; rows are derived.
- **Read:** History reads the view.
- **Update:** Not allowed.
- **Delete:** Not allowed.

If ORM view support is inconvenient, NestJS executes the same model through a
repository-level `UNION ALL` query.

### Search, filters, and totals

Searchable values:

- Transfer reference
- Counterparty display name
- Transfer note

Filters:

- Date range
- Activity type
- Debit or credit direction
- Status
- Minimum and maximum amount

Only `COMPLETED` activity contributes to sent, received, and funded monetary
totals. Failed and pending operations can contribute to counts but not money
totals. Selected-period totals are calculated from authoritative transfer and
funding records rather than derived analytics.

### Pagination

The history uses cursor pagination rather than offset pagination. The cursor
contains:

- `occurred_at`
- `source_type`
- `source_id`
- `activity_type`

Ordering is `occurred_at DESC, activity_key DESC`, preventing skipped or
duplicated items when new activity arrives.

Existing sender, receiver, funding-wallet, status, creation-time, and unique
reference indexes cover the MVP. Additional status-specific composite indexes
are added only if query measurements justify them.

### CSV export

The MVP executes the same authorized, filtered query without pagination and
returns CSV directly. No export-jobs table is needed for the small expected
volume.

### Transaction History loading operation

1. Authenticate the customer.
2. Find their wallet.
3. Apply authorized filters and search.
4. Query the combined activity view.
5. Load safe counterparty names.
6. Calculate exact selected-period summaries.
7. Return a cursor-paginated page and next cursor.

### Transaction History CRUD summary

| Data source | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `wallets` | No | Ownership | No | No |
| `transfers` | No | Yes | No | No |
| `funding_transactions` | No | Yes | No | No |
| `users` | No | Safe counterparty names | No | No |
| `wallet_activity_history` view | Derived | Yes | No | No |

Transaction History combines authoritative financial records into a
customer-friendly read model without creating another copy of them.

---

## 9. Transaction Details

**Route:** `/transactions/:id`

**Purpose:** Explain one transfer and its effect on the customer's wallet.

### Sections

- Transaction status
- Amount and direction
- Sender and receiver
- Transfer ID, date, note, and currency
- Balance effect
- Activity timeline
- Support reference

Background-job implementation details are not exposed to customers.

### Database design status

Completed for Transaction Details.

This read-only page explains one wallet-to-wallet transfer from the
authenticated customer's perspective. Funding activity links to Wallet
Statement for the MVP rather than using this transfer-specific page.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `transfers` | Existing | Main transfer information |
| `wallets` | Existing | Determine ownership and customer perspective |
| `users` | Existing | Display safe counterparty information |
| `ledger_accounts` | Existing | Locate the customer's ledger account |
| `ledger_transactions` | Existing | Locate the transfer posting |
| `ledger_entries` | Existing | Verify the customer's debit or credit |

No new table is required.

### Reused table: `transfers`

| Field | Type | Details usage |
|---|---|---|
| `id` | `UUID` | Route and internal identifier |
| `transfer_reference` | `VARCHAR(24)` | Customer and support reference |
| `sender_wallet_id` | `UUID` | Identifies sender |
| `receiver_wallet_id` | `UUID` | Identifies receiver |
| `initiated_by_user_id` | `UUID` | Identifies initiator |
| `amount_minor` | `BIGINT` | Displays amount |
| `currency` | `CHAR(3)` | Formats amount |
| `note` | `VARCHAR(200)` | Displays optional note |
| `status` | `transfer_status` | Displays current state |
| `sender_balance_before_minor` | `BIGINT` | Sender balance before |
| `sender_balance_after_minor` | `BIGINT` | Sender balance after |
| `receiver_balance_before_minor` | `BIGINT` | Receiver balance before |
| `receiver_balance_after_minor` | `BIGINT` | Receiver balance after |
| `failure_code` | `VARCHAR(50)` | Safe sender-side failure explanation |
| `initiated_at` | `TIMESTAMPTZ` | Timeline initiation |
| `completed_at` | `TIMESTAMPTZ` | Timeline completion |
| `failed_at` | `TIMESTAMPTZ` | Timeline failure |
| `reversed_at` | `TIMESTAMPTZ` | Timeline reversal |

#### CRUD operations

- **Create:** None.
- **Read:** Read the transfer.
- **Update:** None.
- **Delete:** None.

### Reused table: `wallets`

| Field | Type | Details usage |
|---|---|---|
| `id` | `UUID` | Matches sender or receiver |
| `wallet_number` | `VARCHAR(24)` | Displays a masked counterparty reference |
| `user_id` | `UUID` | Verifies ownership |
| `currency` | `CHAR(3)` | Confirms display currency |
| `status` | `wallet_status` | Internal consistency check |

#### CRUD operations

- **Create:** None.
- **Read:** Determine ownership and the counterparty wallet.
- **Update:** None.
- **Delete:** None.

The page never reads or returns the counterparty's balance.

### Reused table: `users`

| Field | Type | Details usage |
|---|---|---|
| `id` | `UUID` | Counterparty identifier |
| `full_name` | `VARCHAR(100)` | Safe counterparty name |

#### CRUD operations

- **Create:** None.
- **Read:** Read the safe display name.
- **Update:** None.
- **Delete:** None.

Email, phone, account state, balance, and authentication information are not
exposed.

### Reused table: `ledger_accounts`

| Field | Type | Details usage |
|---|---|---|
| `id` | `UUID` | Referenced by ledger entry |
| `account_type` | `ledger_account_type` | Must be `USER_WALLET` |
| `wallet_id` | `UUID` | Connects to customer wallet |
| `currency` | `CHAR(3)` | Must match transfer currency |
| `status` | `ledger_account_status` | Internal consistency check |

#### CRUD operations

- **Create:** None.
- **Read:** Find the customer's ledger account.
- **Update:** None.
- **Delete:** None.

### Reused table: `ledger_transactions`

| Field | Type | Details usage |
|---|---|---|
| `id` | `UUID` | Parent of ledger entries |
| `transaction_type` | `ledger_transaction_type` | Must be `WALLET_TRANSFER` |
| `reference_id` | `UUID` | Must equal `transfers.id` |
| `reversal_of_id` | `UUID` | Connects a reversal |
| `posted_at` | `TIMESTAMPTZ` | Confirms posting time |

The lookup uses `transaction_type = WALLET_TRANSFER` and
`reference_id = transfer.id`.

#### CRUD operations

- **Create:** None.
- **Read:** Read the transfer's ledger transaction.
- **Update:** None.
- **Delete:** None.

### Reused table: `ledger_entries`

| Field | Type | Details usage |
|---|---|---|
| `id` | `UUID` | Entry identifier |
| `ledger_transaction_id` | `UUID` | Connects to transfer posting |
| `ledger_account_id` | `UUID` | Connects to customer account |
| `entry_type` | `ledger_entry_type` | Debit or credit |
| `amount_minor` | `BIGINT` | Entry amount |
| `currency` | `CHAR(3)` | Entry currency |
| `created_at` | `TIMESTAMPTZ` | Entry time |

Expected customer entry:

- Sender: `DEBIT` for the transfer amount.
- Receiver: `CREDIT` for the transfer amount.

#### CRUD operations

- **Create:** None.
- **Read:** Read the authenticated customer's entry.
- **Update:** None.
- **Delete:** None.

Internal ledger IDs and the counterparty's ledger entry are not exposed. A
missing or inconsistent ledger for a completed transfer creates an operational
alert rather than exposing an accounting error to the customer.

### Customer perspective

For the sender, the page shows direction `SENT`, a negative amount effect, the
sender's balance snapshots, and the counterparty. For the receiver, it shows
direction `RECEIVED`, a positive effect, the receiver's balance snapshots, and
the sender. Neither participant sees the other's balance snapshots.

### Authorization

- The sender can view `PENDING`, `COMPLETED`, `FAILED`, and `REVERSED`.
- The receiver can view only `COMPLETED` and `REVERSED`.
- Everyone else receives the same `Transaction not found` response as a
  missing record.

Only the sender receives a safe mapped failure explanation. A receiver cannot
see failed incoming attempts, sender balance problems, or limit failures.

### Status timeline

No separate status-history table is required for the MVP.

| Timeline item | Source |
|---|---|
| Transfer initiated | `transfers.initiated_at` |
| Transfer completed | `transfers.completed_at` |
| Transfer failed | `transfers.failed_at` |
| Transfer reversed | `transfers.reversed_at` |
| Ledger posted | `ledger_transactions.posted_at` |

Notification background-job processing is not part of the financial timeline.

### Reversal and support

A reversal ledger transaction is found through
`reversal_of_id = original ledger transaction ID`. Original entries remain
unchanged; the reversal uses separate opposite entries.

The customer uses `transfer_reference` when contacting support. The UI does not
expose database IDs as support instructions, background-job IDs, ledger-entry
IDs, or internal failure details.

### Transaction Details loading operation

1. Authenticate the customer and find their wallet.
2. Read the transfer and determine sender or receiver perspective.
3. Apply status-based authorization.
4. Load the safe counterparty identity.
5. Load the transfer ledger transaction.
6. Read only the authenticated wallet's ledger entry.
7. Verify amount, currency, and direction.
8. Build the customer-specific balance effect and timeline.
9. Return the details representation.

### Transaction Details CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `transfers` | No | Yes | No | No |
| `wallets` | No | Ownership and perspective | No | No |
| `users` | No | Safe counterparty name | No | No |
| `ledger_accounts` | No | Customer account | No | No |
| `ledger_transactions` | No | Transfer posting | No | No |
| `ledger_entries` | No | Customer debit or credit | No | No |

Transaction Details presents one immutable transfer without exposing the
counterparty's private financial information.

---

## 10. Wallet Statement

**Route:** `/wallet/statement`

**Purpose:** Provide a customer-friendly view of ledger activity.

### Sections

- Opening and closing balance
- Statement period
- Debit and credit entries
- Running balance
- Entry descriptions
- Future CSV or PDF export

### Database design status

Completed for Wallet Statement.

The statement is a customer-friendly presentation of posted ledger movements:
transfers sent and received, simulated funding, reversals, and future fees or
adjustments. Failed and pending operations do not appear because they have no
posted ledger entries.

### Tables and view involved

| Data source | Existing/New | Purpose |
|---|---|---|
| `wallets` | Existing | Wallet identity and current balance |
| `ledger_accounts` | Existing | Find the wallet ledger account |
| `ledger_transactions` | Existing | Financial operation and posting time |
| `ledger_entries` | Existing, one field added | Debit, credit, and running balance |
| `transfers` | Existing | Transfer reference, note, and counterparty |
| `funding_transactions` | Existing | Funding source information |
| `users` | Existing | Safe counterparty names |
| `wallet_statement_entries` | New database view | Customer-friendly ledger projection |

No new storage table is required.

### Ledger-entry amendment

Add the following field to `ledger_entries`:

| Field | PostgreSQL type | Required | Purpose |
|---|---|---:|---|
| `account_balance_after_minor` | `BIGINT` | Conditional | Account balance immediately after this entry |

It is required for a `USER_WALLET` entry and may initially be null for system
accounts. Add Virtual Funds and Send Money already know the resulting wallet
balance and store it in the corresponding customer entry. The snapshot is
immutable.

### Reused table: `wallets`

| Field | Type | Statement usage |
|---|---|---|
| `id` | `UUID` | Identifies the wallet |
| `wallet_number` | `VARCHAR(24)` | Statement heading |
| `user_id` | `UUID` | Verifies ownership |
| `currency` | `CHAR(3)` | Statement currency |
| `balance_minor` | `BIGINT` | Current balance and reconciliation |
| `status` | `wallet_status` | Displays wallet state |
| `created_at` | `TIMESTAMPTZ` | Earliest possible statement date |

#### CRUD operations

- **Create:** None.
- **Read:** Read wallet identity, ownership, currency, and current balance.
- **Update:** None.
- **Delete:** None.

### Reused table: `ledger_accounts`

| Field | Type | Statement usage |
|---|---|---|
| `id` | `UUID` | Filters ledger entries |
| `account_code` | `VARCHAR(50)` | Internal reconciliation reference |
| `account_type` | `ledger_account_type` | Must be `USER_WALLET` |
| `wallet_id` | `UUID` | Connects account to wallet |
| `currency` | `CHAR(3)` | Confirms statement currency |
| `status` | `ledger_account_status` | Internal account state |

#### CRUD operations

- **Create:** None.
- **Read:** Find the wallet's ledger account.
- **Update:** None.
- **Delete:** None.

Internal account codes are not normally displayed to customers.

### Reused table: `ledger_transactions`

| Field | Type | Statement usage |
|---|---|---|
| `id` | `UUID` | Parent transaction |
| `transaction_type` | `ledger_transaction_type` | Classifies the movement |
| `reference_id` | `UUID` | Links the business record |
| `description` | `VARCHAR(200)` | Base description |
| `reversal_of_id` | `UUID` | Links reversal to original posting |
| `posted_at` | `TIMESTAMPTZ` | Statement date and ordering |

Relevant transaction types are `WALLET_FUNDING`, `WALLET_TRANSFER`, and
`REVERSAL`. Future types may include fees, refunds, and adjustments.

#### CRUD operations

- **Create:** None.
- **Read:** Read posted transaction information.
- **Update:** None.
- **Delete:** None.

### Reused table: `ledger_entries`

| Field | Type | Statement usage |
|---|---|---|
| `id` | `UUID` | Statement-entry identifier |
| `ledger_transaction_id` | `UUID` | Connects to business operation |
| `ledger_account_id` | `UUID` | Filters entries for this wallet |
| `entry_type` | `ledger_entry_type` | Debit or credit |
| `amount_minor` | `BIGINT` | Absolute amount |
| `currency` | `CHAR(3)` | Entry currency |
| `account_balance_after_minor` | `BIGINT` | Running balance |
| `created_at` | `TIMESTAMPTZ` | Stable entry timestamp |

For a customer wallet, a credit is a positive signed amount and a debit is a
negative signed amount.

#### CRUD operations

- **Create:** None.
- **Read:** Read entries for the selected period.
- **Update:** None.
- **Delete:** None.

### Reused business tables

`transfers` supplies its ID, customer reference, sender and receiver wallets,
note, completion time, and reversal time. `funding_transactions` supplies its
ID, wallet, source, amount, currency, and completion time. Both are read-only
for statement generation.

`users.id` and `users.full_name` provide safe counterparty names such as
`Transfer to Bob` or `Transfer from Alice`. Contact information and balances
are not exposed.

### Database view: `wallet_statement_entries`

The read-only view converts ledger data into customer-friendly rows.

| Field | Derived type | Purpose |
|---|---|---|
| `ledger_entry_id` | `UUID` | Unique statement-entry identifier |
| `wallet_id` | `UUID` | Wallet owning the statement |
| `ledger_transaction_id` | `UUID` | Parent accounting transaction |
| `transaction_type` | `ledger_transaction_type` | Funding, transfer, or reversal |
| `reference_id` | `UUID` | Source business record |
| `customer_reference` | `VARCHAR(24)` | Customer-facing reference |
| `entry_type` | `ledger_entry_type` | Debit or credit |
| `amount_minor` | `BIGINT` | Absolute amount |
| `signed_amount_minor` | `BIGINT` | Positive credit or negative debit |
| `balance_after_minor` | `BIGINT` | Running balance |
| `currency` | `CHAR(3)` | Statement currency |
| `description` | `TEXT` | Customer-friendly description |
| `counterparty_wallet_id` | `UUID` | Other transfer wallet when applicable |
| `reversal_of_id` | `UUID` | Original posting for a reversal |
| `posted_at` | `TIMESTAMPTZ` | Statement timestamp |

#### CRUD operations

- **Create:** None; rows are derived.
- **Read:** Statement reads the view.
- **Update:** Not allowed.
- **Delete:** Not allowed.

If ORM view support is inconvenient, NestJS produces the same projection using
joined repository queries.

### Balances and reconciliation

Opening balance is the latest `account_balance_after_minor` before the selected
period, or zero when there is no previous entry. Closing balance is the last
period entry's balance snapshot, or the opening balance when the period is
empty. Each row displays its immutable balance snapshot as the running balance.

Across the full ledger:

`calculated balance = total credits - total debits`

This must equal `wallets.balance_minor`. A mismatch does not trigger a silent
correction or ledger edit. It creates an operational alert for Admin Ledger and
Reconciliation, while the customer receives safe temporary-error feedback.

### Ordering, pagination, and export

Order entries by `posted_at ASC, ledger_entry_id ASC`. For long periods, cursor
pagination uses those same values.

Useful indexes:

- `ledger_accounts.wallet_id`
- `ledger_entries.ledger_account_id, created_at, id`
- `ledger_transactions.posted_at, id`
- `ledger_transactions.transaction_type, reference_id`

CSV and PDF exports use the same authorized query and date range. The MVP
generates them synchronously and needs no export-jobs table.

### Wallet Statement loading operation

1. Authenticate the customer and find their wallet.
2. Find its `USER_WALLET` ledger account.
3. Validate the requested date range.
4. Find the opening balance.
5. Read posted entries for the period.
6. Load safe business and counterparty descriptions.
7. Determine the closing balance and relevant reconciliation result.
8. Return statement rows and export metadata.

### Wallet Statement CRUD summary

| Table or view | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `wallets` | No | Current balance and ownership | No | No |
| `ledger_accounts` | No | Wallet account | No | No |
| `ledger_transactions` | No | Posted operations | No | No |
| `ledger_entries` | No | Debit, credit, and balance | No | No |
| `transfers` | No | Transfer description | No | No |
| `funding_transactions` | No | Funding description | No | No |
| `users` | No | Safe counterparty name | No | No |
| `wallet_statement_entries` view | Derived | Yes | No | No |

Transaction History explains business operations; Wallet Statement proves every
posted change to the customer's balance.

---

## 11. Analytics

**Route:** `/analytics`

**Purpose:** Display asynchronous financial-activity summaries.

### Sections

- Period selector
- Sent-versus-received comparison
- Transaction-volume chart
- Frequent recipients
- Average transfer amount
- Success-and-failure summary
- Last-updated indicator

Analytics is informational and is not the source of the wallet balance.

### Database design status

Completed for Analytics.

Analytics is derived asynchronously by the PostgreSQL background worker and is
never used to calculate the official wallet balance.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `wallets` | Existing | Identify the customer wallet |
| `users` | Existing | Display safe counterparty names |
| `wallet_daily_summaries` | Existing, fields added | Daily wallet totals |
| `wallet_counterparty_daily_summaries` | New | Daily counterparty analytics |
| `processed_background_jobs` | New shared table | Prevent duplicate job processing |
| `transfers` | Existing | Source for analytics rebuilds |
| `funding_transactions` | Existing | Source for analytics rebuilds |

Normal page loads read the summary tables rather than aggregating every source
transaction.

### Reused tables: `wallets` and `users`

The page reads wallet ID, owner, number, currency, state, and creation time to
authorize and format analytics. It reads only `users.id` and `users.full_name`
for safe counterparty names.

#### CRUD operations

- **Create:** None.
- **Read:** Wallet ownership/currency and safe counterparty names.
- **Update:** None.
- **Delete:** None.

Counterparty contact details, balances, and account states are not exposed.

### Amended table: `wallet_daily_summaries`

The existing dashboard summary gains funding totals.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Summarized wallet |
| `summary_date` | `DATE` | Yes | — | Calendar date |
| `currency` | `CHAR(3)` | Yes | — | Summary currency |
| `sent_amount_minor` | `BIGINT` | Yes | Default `0`, non-negative | Completed outgoing amount |
| `received_amount_minor` | `BIGINT` | Yes | Default `0`, non-negative | Completed incoming amount |
| `funded_amount_minor` | `BIGINT` | Yes | Default `0`, non-negative | Completed simulated funding |
| `sent_count` | `INTEGER` | Yes | Default `0`, non-negative | Completed outgoing count |
| `received_count` | `INTEGER` | Yes | Default `0`, non-negative | Completed incoming count |
| `funding_count` | `INTEGER` | Yes | Default `0`, non-negative | Completed funding count |
| `failed_transfer_count` | `INTEGER` | Yes | Default `0`, non-negative | Persisted failed outgoing attempts |
| `last_job_at` | `TIMESTAMPTZ` | No | — | Latest included job |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last summary update |

The primary key is `wallet_id + summary_date + currency`.

Job effects:

- `UPDATE_TRANSFER_ANALYTICS`: Increment sender sent totals and receiver
  received totals.
- `UPDATE_FAILED_TRANSFER_ANALYTICS`: Increment the sender failure count for persisted,
  customer-relevant failures.
- `UPDATE_FUNDING_ANALYTICS`: Increment funding totals.
- `UPDATE_TRANSFER_REVERSAL_ANALYTICS`: Apply an idempotent compensating adjustment to
  the original summary without allowing negative totals.

#### CRUD operations

- **Create:** Analytics worker creates a missing daily row.
- **Read:** Dashboard and Analytics read selected days.
- **Update:** Analytics worker atomically upserts totals and freshness.
- **Delete:** Customers cannot delete it; retention and rebuilds are
  operational.

### Table: `wallet_counterparty_daily_summaries`

Supports frequent-recipient calculations over weekly, monthly, and custom date
ranges.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Analytics owner |
| `counterparty_wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Other wallet |
| `summary_date` | `DATE` | Yes | — | Calendar date |
| `currency` | `CHAR(3)` | Yes | — | Summary currency |
| `sent_amount_minor` | `BIGINT` | Yes | Default `0`, non-negative | Amount sent to counterparty |
| `received_amount_minor` | `BIGINT` | Yes | Default `0`, non-negative | Amount received from counterparty |
| `sent_count` | `INTEGER` | Yes | Default `0`, non-negative | Completed sent count |
| `received_count` | `INTEGER` | Yes | Default `0`, non-negative | Completed received count |
| `last_transfer_at` | `TIMESTAMPTZ` | No | — | Latest included transfer |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last update |

The primary key is:

`wallet_id + counterparty_wallet_id + summary_date + currency`

For a completed transfer, the sender row increments sent totals and the
receiver row increments received totals. Frequent recipients are calculated by
grouping the selected dates by counterparty and ordering by sent count, then
sent amount.

#### CRUD operations

- **Create:** Analytics worker creates a missing daily counterparty row.
- **Read:** Analytics groups rows for the selected period.
- **Update:** Analytics worker upserts totals.
- **Delete:** Retention and rebuild only.

### Shared table: `processed_background_jobs`

Prevents a retried background job from incrementing analytics twice.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `handler_name` | `VARCHAR(100)` | Yes | Composite primary key | Logical handler |
| `job_id` | `UUID` | Yes | Composite primary key, foreign key to `background_jobs.id` | Processed job |
| `processed_at` | `TIMESTAMPTZ` | Yes | Current time | Completion time |

The primary key is `handler_name + job_id`.

#### CRUD operations

- **Create:** Insert inside the same transaction as summary changes.
- **Read:** Check whether the handler already processed the job.
- **Update:** None; records are immutable.
- **Delete:** Controlled retention after the job can no longer be retried.

The worker begins a PostgreSQL transaction, inserts the processed-job record,
skips duplicates, upserts all affected summaries, marks the job completed, and
commits PostgreSQL.

### Calculations

For a selected range:

- Total sent is the sum of `sent_amount_minor`.
- Total received is the sum of `received_amount_minor`.
- Total funded is the sum of `funded_amount_minor`.
- Average sent is total sent divided by `sent_count`, with safe zero handling.
- Success rate is sent count divided by sent count plus failed count.
- The volume chart groups amounts or counts by `summary_date`.
- Last updated is the latest `last_job_at`.

### Rebuild behavior and indexes

Summaries are replaceable derived data. They can be rebuilt from authoritative
`transfers` and `funding_transactions` without modifying balances, ledger
entries, or source records.

Indexes:

- Primary key and `wallet_id, summary_date` on daily wallet summaries.
- Primary key plus `wallet_id, summary_date` and
  `wallet_id, counterparty_wallet_id, summary_date` on counterparty summaries.
- Primary key plus `processed_at` on processed jobs.

### Analytics loading operation

1. Authenticate the customer and find their wallet.
2. Validate the selected date range.
3. Read wallet and counterparty daily summaries.
4. Load safe counterparty names.
5. Calculate sent, received, funded, averages, rates, and chart points.
6. Return the latest processed-job time with the response.

### Analytics CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `wallets` | No | Ownership and currency | No | No |
| `users` | No | Safe counterparty names | No | No |
| `wallet_daily_summaries` | Analytics worker | Yes | Worker upsert | Retention/rebuild |
| `wallet_counterparty_daily_summaries` | Analytics worker | Yes | Worker upsert | Retention/rebuild |
| `processed_background_jobs` | Worker | Idempotency check | No | Controlled retention |
| `transfers` | No | Rebuild only | No | No |
| `funding_transactions` | No | Rebuild only | No | No |

Financial tables provide truth; the background worker produces replaceable
analytics read models.

---

## 12. Notifications

**Route:** `/notifications`

**Purpose:** Display transfer, wallet, account, and security notifications.

### Sections

- Unread notifications
- Complete notification list
- Type filters
- Mark-as-read controls
- Related transaction links

### Database design status

Completed for Notifications.

The MVP provides in-app notifications only. Email and SMS delivery tracking are
outside this page's scope.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `users` | Existing | Identify the notification owner |
| `notifications` | Existing, finalized here | Store in-app notifications |
| `processed_background_jobs` | Existing | Prevent duplicate job processing |

No additional notification table is required.

### Reused table: `users`

The page uses `users.id` from the authenticated session and `users.status` to
confirm account availability.

#### CRUD operations

- **Create:** None.
- **Read:** Confirm the authenticated user.
- **Update:** None.
- **Delete:** None.

The frontend cannot select another user's notifications.

### Finalized table: `notifications`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Notification identifier |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | Recipient |
| `notification_type` | `notification_type` enum | Yes | — | Category |
| `severity` | `notification_severity` enum | Yes | Default `INFO` | Importance |
| `title` | `VARCHAR(150)` | Yes | Non-empty | Short heading |
| `message` | `TEXT` | Yes | Non-empty | User-facing content |
| `related_resource_type` | `notification_resource_type` enum | No | — | Related business resource |
| `related_resource_id` | `UUID` | No | — | Related record |
| `source_job_id` | `UUID` | No | Idempotency constraint | Source background job |
| `action_path` | `VARCHAR(300)` | No | Internal relative path | Page opened when selected |
| `read_at` | `TIMESTAMPTZ` | No | — | Time marked read |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |

Notification types:

- `WELCOME`
- `WALLET_FUNDED`
- `TRANSFER_SENT`
- `TRANSFER_RECEIVED`
- `TRANSFER_FAILED`
- `TRANSFER_REVERSED`
- `WALLET_STATUS_CHANGED`
- `ACCOUNT_SECURITY`
- `SYSTEM_MESSAGE`

Severity values are `INFO`, `WARNING`, and `CRITICAL`. Related-resource types
are `TRANSFER`, `FUNDING_TRANSACTION`, `WALLET`, and `USER_ACCOUNT`.

If a related-resource type is present, its ID is also present. `read_at = null`
means unread, so no separate Boolean is stored. `action_path` must be an
internal relative path, never an arbitrary external URL.

### Idempotency and indexes

The partial unique combination `user_id + source_job_id +
notification_type`, applied when `source_job_id` is not null, prevents
duplicate notifications while allowing related jobs to create different
sender and receiver notification types.

Indexes:

- `user_id, created_at DESC, id`
- Partial `user_id, created_at WHERE read_at IS NULL`
- `user_id, notification_type, created_at`
- `user_id, severity, created_at`
- `related_resource_type, related_resource_id`

#### CRUD operations

- **Create:** Notification worker or an authorized synchronous security
  operation.
- **Read:** Customer-owned notifications, filters, and unread count.
- **Update:** Set `read_at`. Content, recipient, type, and resource linkage are
  immutable.
- **Delete:** Customers cannot delete notifications; retention handles old
  records.

### Job mapping

- `CREATE_WELCOME_NOTIFICATION` creates `WELCOME`.
- `CREATE_FUNDING_NOTIFICATION` creates `WALLET_FUNDED`.
- `CREATE_TRANSFER_NOTIFICATIONS` creates `TRANSFER_SENT` for the sender and
  `TRANSFER_RECEIVED` for the receiver.
- `CREATE_FAILED_TRANSFER_NOTIFICATION` creates `TRANSFER_FAILED` for the sender only.
- `CREATE_REVERSAL_NOTIFICATIONS` creates the applicable reversal notifications.
- Account and wallet restriction jobs create `ACCOUNT_SECURITY` or
  `WALLET_STATUS_CHANGED`.

The notification worker builds escaped, user-facing text from job data.
Messages never contain credentials, tokens, raw internal errors, private
contact information, or current balances.

### Idempotent worker operation

The notification worker begins a PostgreSQL transaction, inserts its
`processed_background_jobs` record, skips an already-completed job, creates all
notification rows, marks the job completed, and commits PostgreSQL.

For a completed transfer, sender and receiver notifications are created in the
same transaction. If any insert fails, both notifications and the
processed-job record roll back.

#### Processed-job CRUD operations

- **Create:** Notification worker records successful processing.
- **Read:** Check idempotency.
- **Update:** None.
- **Delete:** Controlled retention only.

### Listing and read-state operations

Filters include all/unread, type, severity, and date range. Cursor pagination
uses `created_at + notification ID` in descending order.

Marking one notification read updates only a row whose ID and `user_id` match
the authenticated customer and whose `read_at` is null. Marking all read
updates only that customer's unread rows. Both operations are idempotent.

A missing notification and one owned by somebody else return the same
not-found response.

### Eventual consistency and retention

A financial operation completes when its PostgreSQL transaction commits; it
does not wait for notification delivery. Notification failure never reverses a
transfer or funding operation.

Retention may remove old notification rows but never financial records, and it
must respect investigation requirements. Its duration is configurable.

### Notifications loading operation

1. Authenticate the customer.
2. Validate filters and cursor.
3. Query only that customer's notifications.
4. Calculate unread count.
5. Return a cursor-paginated response.
6. Validate ownership again when following related-resource actions.

### Notifications CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Authentication context | No | No |
| `notifications` | Worker/system | Customer-owned rows | Set `read_at` | Retention only |
| `processed_background_jobs` | Worker | Idempotency check | No | Controlled retention |

The background worker creates notifications, customers control only their read
state, and notification delivery never controls financial correctness.

---

## 13. Profile and Settings

**Route:** `/settings`

**Purpose:** Manage profile, security, sessions, and notification preferences.

### Sections

- Profile information
- Password and security
- Active sessions
- Notification preferences
- Wallet information
- Account closure

### Database design status

Completed for Profile and Settings.

The page manages profile information, password security, active sessions,
notification preferences, read-only wallet information, and controlled
account-closure requests.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `users` | Existing | Profile and account state |
| `user_credentials` | Existing | Password changes |
| `auth_sessions` | Existing | Active-device and logout management |
| `authentication_events` | Existing | Security history |
| `notification_preferences` | New | Optional notification choices |
| `wallets` | Existing | Read-only wallet information |
| `account_closure_requests` | New | Controlled closure workflow |
| `background_jobs` | Existing | Deferred security and closure work |

### Reused table: `users`

The page reads the existing profile, verification, account-state, and lifecycle
fields. For the MVP, the customer may update only `full_name`. Email and phone
are displayed but remain read-only until a separate verified contact-change
workflow is designed. Customers cannot update their role, status,
verification timestamps, or closure timestamp.

#### CRUD operations

- **Create:** None.
- **Read:** Read profile and account state.
- **Update:** Update `full_name` and `updated_at`.
- **Delete:** Never physically delete the user.

### Reused table: `user_credentials`

Password changes use `user_id`, `password_hash`, `password_changed_at`,
`failed_login_attempts`, `locked_until`, and `updated_at`.

The customer reauthenticates with their current password. In one PostgreSQL
transaction, the backend stores the new hash, updates the change time, resets
failure state, revokes other sessions, appends a security event, and creates a
security-notification background job.

#### CRUD operations

- **Create:** None.
- **Read:** Internal reauthentication only.
- **Update:** Change the password and reset failure state.
- **Delete:** None.

Raw passwords are never stored or logged.

### Reused table: `auth_sessions`

The UI reads session ID, creation and expiry times, last use, revocation state,
IP context, and user agent. It never receives the refresh-token hash.

#### CRUD operations

- **Create:** Login only.
- **Read:** Read the authenticated customer's sessions.
- **Update:** Revoke one session, all other sessions, or the current session
  during logout.
- **Delete:** Retention removes old expired or revoked sessions.

Revocation sets `revoked_at` and a reason such as `USER_LOGOUT`. Every update
must match both session ID and the authenticated `user_id`.

### Reused table: `authentication_events`

Add these event types:

- `PASSWORD_CHANGED`
- `SESSION_REVOKED`
- `ALL_OTHER_SESSIONS_REVOKED`

The page appends user ID, event type, IP, user agent, and occurrence time.
Events are immutable and are deleted only under the security retention policy.

### Table: `notification_preferences`

Security and critical wallet-state notifications are mandatory and are not
represented by disable switches.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `user_id` | `UUID` | Yes | Primary key, foreign key to `users.id` | Preference owner |
| `wallet_funding_enabled` | `BOOLEAN` | Yes | Default `TRUE` | Funding notifications |
| `transfer_sent_enabled` | `BOOLEAN` | Yes | Default `TRUE` | Sent-transfer notifications |
| `transfer_received_enabled` | `BOOLEAN` | Yes | Default `TRUE` | Received-transfer notifications |
| `transfer_failed_enabled` | `BOOLEAN` | Yes | Default `TRUE` | Failed-transfer notifications |
| `transfer_reversed_enabled` | `BOOLEAN` | Yes | Default `TRUE` | Reversal notifications |
| `system_messages_enabled` | `BOOLEAN` | Yes | Default `TRUE` | Non-critical system messages |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last update |

#### CRUD operations

- **Create:** Create defaults during registration or upsert on first save.
- **Read:** Display current preferences.
- **Update:** Update only the authenticated user's Boolean choices.
- **Delete:** No normal deletion.

The notification worker reads these preferences for optional notifications
but always creates required security and critical state notifications.

### Reused table: `wallets`

Settings displays wallet ID/number, owner, currency, balance, status, creation
time, and closure time.

#### CRUD operations

- **Create:** None.
- **Read:** Display customer-owned wallet information.
- **Update:** None.
- **Delete:** None.

Customers cannot edit wallet identity, currency, balance, or state.

### Table: `account_closure_requests`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Request identifier |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | Requesting customer |
| `status` | `closure_request_status` enum | Yes | Default `PENDING` | Workflow state |
| `reason` | `VARCHAR(500)` | No | — | Optional customer reason |
| `requested_at` | `TIMESTAMPTZ` | Yes | Current time | Request time |
| `cancelled_at` | `TIMESTAMPTZ` | No | — | Customer cancellation time |
| `reviewed_by_user_id` | `UUID` | No | Foreign key to `users.id` | Reviewing administrator |
| `reviewed_at` | `TIMESTAMPTZ` | No | — | Review time |
| `resolution_note` | `TEXT` | No | — | Administrative resolution |
| `completed_at` | `TIMESTAMPTZ` | No | — | Closure completion time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last workflow update |

Statuses:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `CANCELLED`
- `COMPLETED`

A partial unique index prevents more than one active `PENDING` or `APPROVED`
request per user.

#### Customer CRUD operations

- **Create:** Create after password reauthentication, zero-balance eligibility,
  and active-request checks.
- **Read:** Read current and previous requests.
- **Update:** Change a `PENDING` request to `CANCELLED`.
- **Delete:** Never delete closure history.

The customer cannot approve, reject, or complete a request.

### Closure completion

The later administrator workflow atomically closes the user and wallet, sets
closure timestamps, revokes sessions, completes the request, and creates audit
and background jobs. Transfers, funding records, ledger entries, and audit
history remain intact.

### Background-job interactions

Settings may create:

- `account.password.changed`
- `account.closure.requested`
- `account.closure.cancelled`
- `notification.preferences.updated`

Notification and audit workers process them. Background Job Processing owns the
complete job schema.

### Profile and Settings loading operation

1. Authenticate the customer.
2. Read profile and verification state.
3. Read wallet information.
4. Read active sessions.
5. Read notification preferences.
6. Read any active closure request.
7. Return a response without credential secrets.

### Profile and Settings CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Profile/account state | Full name only | No |
| `user_credentials` | No | Internal reauthentication | Password | No |
| `auth_sessions` | Login only | Customer sessions | Revoke | Retention only |
| `authentication_events` | Append | Security review | No | Retention only |
| `notification_preferences` | Registration/upsert | Yes | Preferences | No |
| `wallets` | No | Read-only information | No | No |
| `account_closure_requests` | Yes | Customer requests | Cancel pending | No |
| `background_jobs` | Yes | Worker | Processing state | Retention only |

Customers manage profile and security preferences while financial identity,
balances, and historical records remain controlled and auditable.

---

## 14. Admin Dashboard

**Route:** `/admin`

**Purpose:** Provide system-wide operational and financial health information.

### Sections

- User, wallet, transfer, and volume totals
- Transfer success and failure health
- Background-job processing health
- Suspicious activity
- Recent system activity

### Database design status

Completed for Admin Dashboard.

The dashboard is an admin-only, read-only operational overview. With the small
expected data volume, it uses exact live queries rather than a separate
dashboard summary table.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `users` | Existing | Admin authorization and customer totals |
| `wallets` | Existing | Wallet totals, states, and balances |
| `transfers` | Existing | Transfer health and volume |
| `funding_transactions` | Existing | Funding health and volume |
| `authentication_events` | Existing | Suspicious login indicators |
| `background_jobs` | Existing concept, provisional fields finalized | Worker and retry health |
| `audit_records` | New provisional design | Recent important activity |

No `admin_dashboard` table is required.

### Live business metrics

From `users`, the dashboard reads ID, display identity, role, state, and
lifecycle timestamps to calculate customer totals by state and recent
registrations. Only `role = CUSTOMER` contributes to customer metrics.

From `wallets`, it calculates wallet counts by state, recent wallets, and total
virtual balance grouped separately by currency.

From `transfers`, it calculates counts by status, completed volume by currency,
failure categories, reversals, and recent transfers. Only completed transfers
contribute to completed volume.

From `funding_transactions`, it calculates counts, completed simulated funding
volume by currency, failures, and recent activity.

#### Dashboard CRUD operations

- **Create:** None.
- **Read:** Authorization, counts, volumes, and recent records.
- **Update:** None.
- **Delete:** None.

### Authentication-event indicators

The dashboard reads authentication event ID, known user, identifier hash, type,
failure reason, IP address, and time to surface repeated failures by user,
identifier, IP, and time window. These are basic security indicators rather
than a complete fraud-detection system.

### Provisional finalized table: `background_jobs`

The Background Job Processing page finalizes workflow behavior, while this
schema supports dashboard health.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Job identifier |
| `job_type` | `VARCHAR(100)` | Yes | Non-empty | Handler selection |
| `resource_type` | `VARCHAR(50)` | Yes | Non-empty | Source entity type |
| `resource_id` | `UUID` | Yes | — | Source entity ID |
| `payload` | `JSONB` | Yes | Sanitized | Minimum handler input |
| `status` | `background_job_status` enum | Yes | Default `PENDING` | Processing state |
| `attempt_count` | `INTEGER` | Yes | Default `0`, non-negative | Processing attempts |
| `max_attempts` | `INTEGER` | Yes | Default `5`, positive | Retry limit |
| `available_at` | `TIMESTAMPTZ` | Yes | Current time | Earliest retry time |
| `locked_at` | `TIMESTAMPTZ` | No | — | Claim time |
| `locked_by` | `VARCHAR(100)` | No | — | Worker identifier |
| `last_attempt_at` | `TIMESTAMPTZ` | No | — | Last attempt |
| `completed_at` | `TIMESTAMPTZ` | No | — | Successful completion |
| `last_error_code` | `VARCHAR(100)` | No | — | Safe failure category |
| `last_error_message` | `TEXT` | No | Sanitized | Operational detail |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last state update |

Statuses are `PENDING`, `PROCESSING`, `COMPLETED`, and `FAILED`.

The dashboard shows counts, oldest pending age, recent completion volume, and
repeated attempts, but not complete payloads. Indexes cover
`status + available_at + created_at`, job type and time, resource identity, and
completion time.

#### CRUD operations

- **Create:** Business workflows.
- **Read:** Dashboard and background worker.
- **Update:** Worker processing and retry state.
- **Delete:** Retention only.

The dashboard itself only reads. Failed jobs retain their safe last-error
fields, so a separate failure table is not needed for the MVP.

### Provisional table: `audit_records`

The Audit Log page will finalize the schema. The dashboard needs:

| Field | PostgreSQL type | Required | Purpose |
|---|---|---:|---|
| `id` | `UUID` | Yes | Audit identifier |
| `actor_type` | `audit_actor_type` enum | Yes | Customer, admin, or system |
| `actor_user_id` | `UUID` | No | Known user actor |
| `action_type` | `VARCHAR(100)` | Yes | Action performed |
| `resource_type` | `VARCHAR(50)` | Yes | Affected resource |
| `resource_id` | `UUID` | No | Affected record |
| `outcome` | `audit_outcome` enum | Yes | Success or failure |
| `severity` | `audit_severity` enum | Yes | Importance |
| `source_job_id` | `UUID` | No | Related background job |
| `ip_address` | `INET` | No | Request context |
| `metadata` | `JSONB` | No | Sanitized context |
| `occurred_at` | `TIMESTAMPTZ` | Yes | Activity time |

Recent warning and critical actions include suspensions, closures, password
changes, reversals, repeated processing failures, and administrator actions.
Audit records are append-only.

### Access control and refresh behavior

The route requires an authenticated, active `ADMIN`. It never returns
credential hashes, tokens, full job payloads, raw exceptions, or
infrastructure credentials.

Refreshing performs reads only. It never retries a job, suspends a user,
changes a wallet, reverses a transfer, or mutates an audit record.

### Admin Dashboard loading operation

1. Authenticate an active administrator.
2. Read customer and wallet totals.
3. Read transfer and funding health by currency and period.
4. Read background-job health.
5. Aggregate suspicious authentication activity.
6. Read recent important audit records.
7. Return a restricted operational summary.

### Admin Dashboard CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Metrics/authorization | No | No |
| `wallets` | No | Metrics/balances | No | No |
| `transfers` | No | Health/volume | No | No |
| `funding_transactions` | No | Health/volume | No | No |
| `authentication_events` | No | Security indicators | No | No |
| `background_jobs` | Workflows | Health | Worker | Retention only |
| `audit_records` | Audit producer | Recent activity | No | Retention policy |

The dashboard observes system health but does not mutate financial or
operational state.

---

## 15. User Management

**Route:** `/admin/users`

**Purpose:** Inspect and manage customer accounts.

### Sections

- User search and filters
- User list
- User details
- Wallet and transfer overview
- Suspend and reactivate actions

### Database design status

Completed for User Management.

The page supports customer search, profile/wallet/transfer/security inspection,
controlled suspension and reactivation, session revocation, and account-closure
review. Administrators cannot view credential secrets or rewrite financial
history.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `users` | Existing | Customer search, details, and state |
| `wallets` | Existing | Wallet overview |
| `transfers` | Existing | Recent transfer activity |
| `authentication_events` | Existing | Security history |
| `auth_sessions` | Existing | Session revocation |
| `user_status_history` | New | Immutable state changes |
| `account_closure_requests` | Existing | Closure review |
| `audit_records` | Existing provisional | Administrator-action history |
| `background_jobs` | Existing | Deferred account-state work |

### Reused table: `users`

The page searches and filters customer ID, name, normalized email/phone, state,
verification state, and registration date. Only `role = CUSTOMER` appears in
normal results.

Useful indexes are the existing unique email and phone indexes plus
`role + status + created_at`. A name trigram index is optional only if measured
partial-name searches require it.

#### CRUD operations

- **Create:** None.
- **Read:** Search and inspect customers.
- **Update:** Controlled state transitions only.
- **Delete:** Never physically delete a customer.

Permitted transitions include active or pending-verification to suspended,
suspended to active, and an eligible closure to closed. Administrators cannot
change customer role, credentials, contact identity, or verification
timestamps.

### Reused table: `wallets`

The page reads wallet identity, owner, currency, balance, state, and lifecycle
times. It updates a wallet only during an approved account closure.

Suspending a user does not change wallet state. User and wallet restrictions
remain independent, and reactivating a user does not reactivate an
independently suspended wallet.

### Reused operational tables

- `transfers` is read-only and supplies recent customer activity.
- `authentication_events` is read-only and supplies recent security context.
- `auth_sessions` exposes only safe session metadata. Suspension or closure
  sets `revoked_at` and `revocation_reason = ADMIN_ACTION`; token hashes are
  never returned.

### Table: `user_status_history`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | History identifier |
| `user_id` | `UUID` | Yes | Foreign key to `users.id` | Affected customer |
| `previous_status` | `user_status` enum | Yes | — | State before change |
| `new_status` | `user_status` enum | Yes | Different from previous | State after change |
| `reason_code` | `user_status_reason` enum | Yes | — | Standard reason |
| `reason` | `VARCHAR(500)` | Yes | Non-empty | Administrator explanation |
| `changed_by_user_id` | `UUID` | Yes | Foreign key to `users.id` | Administrator |
| `occurred_at` | `TIMESTAMPTZ` | Yes | Current time | Change time |

Reason codes:

- `SUSPICIOUS_ACTIVITY`
- `POLICY_VIOLATION`
- `SECURITY_REVIEW`
- `CUSTOMER_REQUEST`
- `ACCOUNT_CLOSURE`
- `REACTIVATED_AFTER_REVIEW`
- `OTHER`

Previous and new states differ, the actor is an active administrator, and rows
are append-only. Indexes cover affected user/time, administrator/time, and new
state/time.

#### CRUD operations

- **Create:** Append every state transition.
- **Read:** Display state history.
- **Update:** Never.
- **Delete:** Approved retention only.

### Reused table: `account_closure_requests`

Administrators read customer requests and may approve, reject, or complete an
eligible closure with a required resolution note. Customers create requests;
administrators do not delete their history.

Before completion, the wallet balance is zero, no prohibited pending financial
operation remains, and the customer is not already closed.

### State-change transactions

Suspension atomically locks and rechecks the customer, changes state, appends
status history, revokes active sessions, appends an audit record, and creates
the required account-suspension background jobs.

Reactivation requires a currently suspended customer and reason, then
atomically changes state, appends history/audit, and creates the required
account-reactivation background jobs. It does not change an independently
restricted wallet.

Closure atomically closes the user and wallet, sets timestamps, revokes
sessions, completes the closure request, appends history/audit, and creates
the required account-closure background jobs. Financial and audit history
remains intact.

### Access, search, and pagination

Only an active administrator may access this customer page. Administrators
cannot target themselves or other administrators here, reopen closed accounts
through basic reactivation, edit balances, edit ledger records, or read
credential/token hashes.

Status actions require explicit confirmation and a non-empty reason. Customer
search uses normalized inputs and cursor pagination ordered by
`created_at DESC, user_id DESC`.

### User Management CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `users` | No | Search/details | Controlled state | No |
| `wallets` | No | Wallet overview | Closure only | No |
| `transfers` | No | Recent activity | No | No |
| `authentication_events` | No | Security history | No | No |
| `auth_sessions` | No | Safe session metadata | Revoke | No |
| `user_status_history` | Append | Yes | No | Retention only |
| `account_closure_requests` | No | Yes | Review/complete | No |
| `audit_records` | Append | Yes | No | Retention only |
| `background_jobs` | Append | Worker | Processing state | Retention only |

Administrators change customer access through controlled state transitions but
cannot rewrite identity, balances, or financial history.

---

## 16. Wallet Management

**Route:** `/admin/wallets`

**Purpose:** Inspect wallets and reconcile balances.

### Sections

- Wallet search
- Wallet summary
- Transaction history
- Ledger view
- Balance reconciliation
- Suspend and reactivate controls

Administrators cannot directly edit balances.

### Database design status

Completed for Wallet Management.

The page uses the wallet row as the operational balance and the immutable ledger
as accounting evidence. It supports wallet search, financial-history inspection,
balance reconciliation, and controlled suspension or reactivation. It never
offers a free-form balance update or edits posted ledger records.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `wallets` | Existing | Search, wallet state, and operational balance |
| `users` | Existing | Safe owner identity and account state |
| `transfers` | Existing | Recent sent and received transfers |
| `funding_transactions` | Existing | Recent wallet funding |
| `ledger_accounts` | Existing | Resolve the wallet's ledger account |
| `ledger_transactions` | Existing | Identify source financial operations |
| `ledger_entries` | Existing | Calculate and explain the ledger balance |
| `wallet_status_history` | New | Append-only wallet state transitions |
| `audit_records` | Existing provisional | Administrator-action evidence |
| `background_jobs` | Existing | Deferred wallet-state work |

### Reused table: `wallets`

| Field | PostgreSQL type | Wallet Management usage |
|---|---|---|
| `id` | `UUID` | Internal wallet lookup |
| `wallet_number` | `VARCHAR(24)` | Exact public-reference search and display |
| `user_id` | `UUID` | Join to the owner |
| `currency` | `CHAR(3)` | Currency filter and reconciliation scope |
| `balance_minor` | `BIGINT` | Authoritative operational balance |
| `status` | `wallet_status` | State filter and controlled transition |
| `created_at` | `TIMESTAMPTZ` | Creation range and ordering |
| `updated_at` | `TIMESTAMPTZ` | Last wallet mutation |
| `closed_at` | `TIMESTAMPTZ` | Permanent closure evidence |

#### CRUD operations

- **Create:** None from Wallet Management.
- **Read:** Search and inspect wallet identity, owner, currency, balance, state,
  and lifecycle timestamps.
- **Update:** Change only `ACTIVE` to `SUSPENDED` or `SUSPENDED` to `ACTIVE`
  through the controlled state-change transaction.
- **Delete:** Never. A closed wallet and its financial history are retained.

Wallet Management cannot change `wallet_number`, `user_id`, `currency`, or
`balance_minor`. A `CLOSED` wallet cannot be reopened through this page.

### Reused owner and activity tables

The page reads only safe owner fields from `users`: `id`, `full_name`,
normalized email or phone for exact administrative search, `status`, and
`created_at`. Credential fields are never joined or returned.

`transfers` supplies recent outgoing and incoming operations, while
`funding_transactions` supplies recent funding. Both are read-only here.
Transfer and funding rows are linked, not rewritten, when an administrator
investigates a balance.

### Reused ledger tables

`ledger_accounts` is resolved with `account_type = USER_WALLET` and
`wallet_id = wallets.id`. Wallet Management reads its `id`, `account_code`,
`currency`, and `status`.

For that account, `ledger_entries` supplies `entry_type`, `amount_minor`,
`currency`, `created_at`, and `ledger_transaction_id`.
`ledger_transactions` supplies the operation type, source `reference_id`,
reversal relationship, and posting time.

The ledger-derived wallet balance is:

`SUM(CREDIT amount_minor) - SUM(DEBIT amount_minor)`

for the wallet ledger account and currency. The reconciliation result compares
that value with `wallets.balance_minor` and reports:

- `MATCHED` when the values are equal.
- `MISMATCH` when they differ.
- `MISSING_LEDGER_ACCOUNT` when no `USER_WALLET` account exists.
- `CURRENCY_MISMATCH` when wallet, account, or entry currencies disagree.
- `UNBALANCED_TRANSACTION` when any related ledger transaction has unequal
  debit and credit totals.

This result is calculated by a read query or service response; it is not stored
as a second balance. Wallet Management does not create adjustments. Any future
correction belongs to Ledger and Reconciliation and must post compensating
entries.

#### Ledger CRUD operations

- **Create:** None.
- **Read:** Resolve the wallet account, list its posted transactions and
  entries, calculate its ledger balance, and validate debit-credit equality.
- **Update:** None.
- **Delete:** None.

### Table: `wallet_status_history`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Transition identifier |
| `wallet_id` | `UUID` | Yes | Foreign key to `wallets.id` | Affected wallet |
| `previous_status` | `wallet_status` | Yes | Different from new state | State before change |
| `new_status` | `wallet_status` | Yes | Different from previous state | State after change |
| `reason_code` | `wallet_status_reason` | Yes | Standard value | Searchable reason |
| `reason` | `VARCHAR(500)` | Yes | Non-empty | Administrator explanation |
| `changed_by_user_id` | `UUID` | Yes | Foreign key to `users.id` | Administrator actor |
| `occurred_at` | `TIMESTAMPTZ` | Yes | Current time | Transition time |

Reason codes:

- `SUSPICIOUS_ACTIVITY`
- `SECURITY_REVIEW`
- `POLICY_VIOLATION`
- `CUSTOMER_REQUEST`
- `ACCOUNT_CLOSURE`
- `REACTIVATED_AFTER_REVIEW`
- `OTHER`

Rows are append-only. Indexes cover `wallet_id, occurred_at DESC`,
`changed_by_user_id, occurred_at DESC`, and
`new_status, occurred_at DESC`.

#### CRUD operations

- **Create:** Append one row for every wallet state transition.
- **Read:** Display the wallet's state timeline.
- **Update:** Never.
- **Delete:** Approved retention only, and never while required for audit or
  financial-record retention.

### Wallet state-change transaction

Suspension or reactivation requires an active administrator, explicit
confirmation, a standard reason code, and a non-empty explanation. The service
then atomically:

1. Locks the wallet and rechecks its current state.
2. Applies the permitted state transition.
3. Appends `wallet_status_history`.
4. Appends an `audit_records` row.
5. Creates the required wallet-state background jobs in `background_jobs`.

Suspension blocks new funding and outgoing transfers. It does not alter the
wallet balance, reverse completed operations, suspend the owner account, or
block investigation of incoming historical records. Reactivation does not
reactivate a suspended or closed user.

### Search, indexes, and pagination

Search supports exact wallet number or wallet ID, exact owner email or phone,
owner ID, wallet state, currency, creation range, and an optional mismatch-only
reconciliation filter. Useful indexes are:

- Existing unique `wallet_number` and `user_id, currency`.
- `wallets(status, created_at DESC, id DESC)`.
- Existing sender, receiver, funding-wallet, ledger-account, and ledger-entry
  indexes described by their source workflows.

Results use cursor pagination ordered by `created_at DESC, id DESC`. Expensive
reconciliation is performed for the wallets on the selected page or for one
selected wallet, not for every wallet before pagination.

### Wallet Management CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `wallets` | No | Search/details/balance | Controlled state only | No |
| `users` | No | Safe owner identity/state | No | No |
| `transfers` | No | Recent activity | No | No |
| `funding_transactions` | No | Recent activity | No | No |
| `ledger_accounts` | No | Wallet account | No | No |
| `ledger_transactions` | No | Source operations | No | No |
| `ledger_entries` | No | Entries/reconciliation | No | No |
| `wallet_status_history` | Append | Yes | No | Retention only |
| `audit_records` | Append | Yes | No | Retention only |
| `background_jobs` | Append | Processing status | Worker only | Retention only |

---

## 17. Transfer Monitoring

**Route:** `/admin/transfers`

**Purpose:** Investigate transfers across the platform.

### Sections

- Transfer filters
- Transfer table
- Transfer lifecycle
- Related ledger entries
- Related background-job status

### Database design status

Completed for Transfer Monitoring.

Transfer Monitoring is an administrator-only, read-only investigation feature.
It does not update transfer states, retry background jobs, reverse transfers, modify
wallet balances, or change ledger records.

No dedicated `transfer_monitoring` table is required. The page reads the
existing source tables, with one new append-only lifecycle-history table.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `transfers` | Existing | Primary transfer record and filters |
| `transfer_status_history` | New | Immutable transfer lifecycle |
| `wallets` | Existing | Sender and receiver wallet references |
| `users` | Existing | Safe participant identity |
| `ledger_transactions` | Existing | Accounting transaction for the transfer |
| `ledger_entries` | Existing | Debit and credit evidence |
| `ledger_accounts` | Existing | Affected wallet accounts |
| `background_jobs` | Existing | Deferred transfer-work status |
| `audit_records` | Existing provisional | Investigation timeline |

### Reused table: `transfers`

| Field | PostgreSQL type | Transfer Monitoring usage |
|---|---|---|
| `id` | `UUID` | Internal transfer identifier and joins |
| `transfer_reference` | `VARCHAR(24)` | Customer-reference search |
| `sender_wallet_id` | `UUID` | Sender filter and wallet join |
| `receiver_wallet_id` | `UUID` | Receiver filter and wallet join |
| `initiated_by_user_id` | `UUID` | Initiating-customer filter |
| `idempotency_key` | `UUID` | Duplicate-request investigation |
| `amount_minor` | `BIGINT` | Amount and range filters |
| `currency` | `CHAR(3)` | Currency filter |
| `note` | `VARCHAR(200)` | Customer-provided context |
| `status` | `transfer_status` | Current state and filter |
| `sender_balance_before_minor` | `BIGINT` | Sender balance evidence |
| `sender_balance_after_minor` | `BIGINT` | Sender result evidence |
| `receiver_balance_before_minor` | `BIGINT` | Receiver balance evidence |
| `receiver_balance_after_minor` | `BIGINT` | Receiver result evidence |
| `failure_code` | `VARCHAR(50)` | Safe failure classification |
| `initiated_at` | `TIMESTAMPTZ` | Initiation time and range filter |
| `completed_at` | `TIMESTAMPTZ` | Completion evidence |
| `failed_at` | `TIMESTAMPTZ` | Failure evidence |
| `reversed_at` | `TIMESTAMPTZ` | Reversal evidence |
| `created_at` | `TIMESTAMPTZ` | Stable list ordering |
| `updated_at` | `TIMESTAMPTZ` | Last state change |

#### CRUD operations

- **Create:** None from Transfer Monitoring.
- **Read:** Search, filter, list, and inspect transfers.
- **Update:** None. Transfer processors own lifecycle updates.
- **Delete:** Never.

Filters include transfer ID/reference, sender or receiver wallet ID/reference,
initiating user, status, failure code, currency, amount range, initiation range,
and background-job health. Customer notes are rendered as untrusted text.

### Table: `transfer_status_history`

The current state remains in `transfers.status`. This table preserves how and
when the transfer reached that state.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Lifecycle-row identifier |
| `transfer_id` | `UUID` | Yes | Foreign key to `transfers.id` | Affected transfer |
| `previous_status` | `transfer_status` | No | Null only for initial row | State before transition |
| `new_status` | `transfer_status` | Yes | Different from previous | State after transition |
| `transition_source` | `transfer_transition_source` | Yes | Standard value | Workflow responsible |
| `reason_code` | `VARCHAR(100)` | No | Safe standard code | Transition explanation |
| `actor_user_id` | `UUID` | No | Foreign key to `users.id` | Customer/admin actor |
| `source_job_id` | `UUID` | No | Background-job identifier | Job correlation |
| `occurred_at` | `TIMESTAMPTZ` | Yes | Current time | Transition time |

`transfer_transition_source` values:

- `CUSTOMER_REQUEST`
- `TRANSFER_PROCESSOR`
- `REVERSAL_WORKFLOW`
- `SYSTEM_RECOVERY`

The permitted lifecycle is:

- `NULL -> PENDING`
- `PENDING -> COMPLETED`
- `PENDING -> FAILED`
- `COMPLETED -> REVERSED`

History rows are append-only and are inserted in the same database transaction
as the corresponding transfer-state change.

Indexes:

- `transfer_status_history(transfer_id, occurred_at, id)`
- `transfer_status_history(new_status, occurred_at DESC)`
- Optional index on `source_job_id`

#### CRUD operations

- **Create:** Transfer-processing and reversal workflows append rows.
- **Read:** Transfer Monitoring displays the ordered lifecycle.
- **Update:** Never.
- **Delete:** Approved retention only.

### Reused party tables: `wallets` and `users`

For both sender and receiver, the page reads wallet `id`, `wallet_number`,
`user_id`, `currency`, and `status`.

It reads user `id`, `full_name`, `status`, and masked email or phone. Credential
hashes, session tokens, and authentication secrets are never returned.

Current wallet balances are not presented as balances at the time of transfer;
the balance snapshots stored on `transfers` are used for that purpose.

#### CRUD operations

- **Create:** None.
- **Read:** Resolve safe sender, receiver, and initiating-user context.
- **Update:** None.
- **Delete:** None.

### Reused ledger tables and required fields

The accounting lookup uses:

`ledger_transactions.transaction_type = WALLET_TRANSFER`

and:

`ledger_transactions.reference_id = transfers.id`

| Table | Fields needed | Monitoring purpose |
|---|---|---|
| `ledger_transactions` | `id`, `transaction_type`, `reference_id`, `description`, `reversal_of_id`, `posted_at`, `created_at` | Find the original and reversing postings |
| `ledger_entries` | `id`, `ledger_transaction_id`, `ledger_account_id`, `entry_type`, `amount_minor`, `currency`, `created_at` | Show debit and credit evidence |
| `ledger_accounts` | `id`, `account_code`, `account_type`, `wallet_id`, `name`, `currency`, `status` | Resolve entries to wallet accounts |

For a `COMPLETED` transfer:

- Exactly one original `WALLET_TRANSFER` ledger transaction must exist.
- The sender wallet account must be debited.
- The receiver wallet account must be credited.
- Entry amounts and currencies must match the transfer.
- Total debits must equal total credits.

A `FAILED` or `PENDING` transfer must not have a completed-transfer posting. A
`REVERSED` transfer retains its original posting and points to a balanced
reversing transaction instead of editing the original entries.

#### CRUD operations

- **Create:** None from Transfer Monitoring.
- **Read:** Find the posting, accounts, entries, reversal, and validation
  result.
- **Update:** None.
- **Delete:** None.

### Reused background-job table and required fields

Transfer jobs are found with
`background_jobs.resource_type = TRANSFER` and
`background_jobs.resource_id = transfers.id`.

The page reads `id`, `job_type`, `resource_type`, `resource_id`, `status`,
`attempt_count`, `max_attempts`, `available_at`, `last_attempt_at`,
`completed_at`, `last_error_code`, `last_error_message`, `created_at`, and
`updated_at`.

The page does not return the complete job payload, raw exception stacks,
credentials, contact details, or infrastructure secrets. Error information is
sanitized before storage.

#### CRUD operations

- **Create:** None from Transfer Monitoring. Business workflows create jobs.
- **Read:** Display processing and retry health.
- **Update:** None. The background worker and retry workflow own updates.
- **Delete:** Approved retention only.

### Reused table: `audit_records`

Transfer-related audit records are found with:

`resource_type = TRANSFER AND resource_id = transfers.id`

or through a related `source_job_id`.

Required fields are `id`, `actor_type`, `actor_user_id`, `action_type`,
`resource_type`, `resource_id`, `outcome`, `severity`, `source_job_id`,
sanitized `metadata`, and `occurred_at`.

#### CRUD operations

- **Create:** None from Transfer Monitoring; authorized workflows append rows.
- **Read:** Display the restricted investigation timeline.
- **Update:** Never.
- **Delete:** Approved retention only.

### Integrity indicators

The service derives, but does not persist:

- `LEDGER_MISSING`
- `LEDGER_UNBALANCED`
- `LEDGER_PARTY_MISMATCH`
- `LEDGER_AMOUNT_MISMATCH`
- `LEDGER_CURRENCY_MISMATCH`
- `UNEXPECTED_LEDGER_FOR_NON_COMPLETED_TRANSFER`
- `BACKGROUND_JOB_MISSING`
- `BACKGROUND_JOB_FAILED`
- `BACKGROUND_JOB_RETRYING`
- `LIFECYCLE_HISTORY_MISMATCH`

Indicators direct the administrator to the workflow that owns remediation.
They never automatically modify a transfer or ledger record.

### Filters, indexes, and pagination

In addition to the existing transfer indexes:

- `transfers(status, created_at DESC, id DESC)`
- `transfers(failure_code, created_at DESC)` for non-null failure codes
- `transfers(currency, created_at DESC)`
- `background_jobs(resource_type, resource_id, created_at)`
- `audit_records(resource_type, resource_id, occurred_at DESC)`

The table uses cursor pagination ordered by `created_at DESC, id DESC`.
Lifecycle, ledger, job, and audit records are loaded for one selected transfer
or the current page to avoid a large cross-product query.

### Transfer Monitoring loading operation

1. Authenticate an active administrator.
2. Validate filters and read a cursor-paginated transfer page.
3. Resolve safe sender, receiver, and initiator context.
4. Read the selected transfer's immutable lifecycle.
5. Read and validate related ledger transactions, accounts, and entries.
6. Read related background-job processing state.
7. Read restricted audit records.
8. Derive integrity indicators and return a read-only response.

### Transfer Monitoring CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `transfers` | No | Search/details | No | No |
| `transfer_status_history` | Workflows append | Lifecycle | No | Retention only |
| `wallets` | No | Party references | No | No |
| `users` | No | Safe party identity | No | No |
| `ledger_transactions` | No | Accounting link/reversal | No | No |
| `ledger_entries` | No | Debit-credit evidence | No | No |
| `ledger_accounts` | No | Account context | No | No |
| `background_jobs` | Business workflows | Processing status | Worker only | Retention only |
| `audit_records` | Authorized workflows | Investigation timeline | No | Retention only |

The Transfer Monitoring route itself performs only reads. Retries, reversals,
ledger adjustments, and retention remain separate authorized workflows.

---

## 18. Ledger and Reconciliation

**Route:** `/admin/ledger`

**Purpose:** Validate accounting integrity across wallets and system accounts.

### Sections

- Global ledger entries
- Debit-and-credit balance validation
- Wallet reconciliation
- Unbalanced-transfer detection
- Controlled adjustment history

Ledger corrections create reversing or adjustment entries; they do not edit
historical entries.

### Database design status

Completed for Ledger and Reconciliation.

The workflow validates that every ledger transaction is balanced, wallet
operational balances match ledger-derived balances, transfers and funding
operations have the expected postings, and all corrections are represented by
new reversing or adjustment entries. Historical ledger transactions and entries
are never edited or deleted.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `ledger_accounts` | Existing, amended | Customer and system accounts |
| `ledger_transactions` | Existing, amended | Groups entries for financial operations |
| `ledger_entries` | Existing | Immutable debit and credit movements |
| `wallets` | Existing | Operational wallet balances |
| `transfers` | Existing | Validate transfer postings |
| `funding_transactions` | Existing | Validate funding postings |
| `reconciliation_runs` | New | Reconciliation execution history |
| `reconciliation_findings` | New | Detected discrepancies |
| `ledger_adjustment_requests` | New | Approval-controlled corrections |
| `ledger_adjustment_lines` | New | Proposed debit and credit lines |
| `audit_records` | Existing provisional | Administrator and system history |
| `background_jobs` | Existing | Deferred adjustment and reconciliation work |

### Amended table: `ledger_accounts`

| Field | PostgreSQL type | Reconciliation usage |
|---|---|---|
| `id` | `UUID` | Account identifier |
| `account_code` | `VARCHAR(50)` | Stable account reference |
| `account_type` | `ledger_account_type` | Account classification |
| `wallet_id` | `UUID` | Related wallet when applicable |
| `name` | `VARCHAR(150)` | Display name |
| `currency` | `CHAR(3)` | Account currency |
| `status` | `ledger_account_status` | Account state |
| `created_at` | `TIMESTAMPTZ` | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Last permitted metadata update |

Account types now include:

- `USER_WALLET`
- `SYSTEM_FUNDING`
- `SYSTEM_ADJUSTMENT`

One system adjustment account is provisioned for each supported currency.

#### CRUD operations

- **Create:** Create wallet accounts during provisioning and seed system
  accounts.
- **Read:** Support the global ledger, reconciliation, and adjustment
  preparation.
- **Update:** Change only controlled account status or safe metadata.
- **Delete:** Never after an account is referenced.

### Amended table: `ledger_transactions`

| Field | PostgreSQL type | Reconciliation usage |
|---|---|---|
| `id` | `UUID` | Ledger transaction identifier |
| `transaction_type` | `ledger_transaction_type` | Financial operation type |
| `reference_id` | `UUID` | Source operation or adjustment request |
| `description` | `VARCHAR(200)` | Safe explanation |
| `reversal_of_id` | `UUID` | Original transaction being reversed |
| `posted_at` | `TIMESTAMPTZ` | Posting time |
| `created_at` | `TIMESTAMPTZ` | Creation time |

Transaction types include:

- `WALLET_FUNDING`
- `WALLET_TRANSFER`
- `TRANSFER_REVERSAL`
- `LEDGER_ADJUSTMENT`

#### CRUD operations

- **Create:** Financial workflows and approved adjustment execution.
- **Read:** Global ledger, source-operation validation, and reconciliation.
- **Update:** Never after posting.
- **Delete:** Never.

A correction creates a new ledger transaction. It never changes the original.

### Reused table: `ledger_entries`

| Field | PostgreSQL type | Reconciliation usage |
|---|---|---|
| `id` | `UUID` | Entry identifier |
| `ledger_transaction_id` | `UUID` | Parent transaction |
| `ledger_account_id` | `UUID` | Affected account |
| `entry_type` | `ledger_entry_type` | `DEBIT` or `CREDIT` |
| `amount_minor` | `BIGINT` | Positive entry amount |
| `currency` | `CHAR(3)` | Entry currency |
| `created_at` | `TIMESTAMPTZ` | Entry time |

For every ledger transaction and currency:

`SUM(DEBIT amount_minor) = SUM(CREDIT amount_minor)`

#### CRUD operations

- **Create:** Financial workflows and approved adjustment execution.
- **Read:** Ledger view, trial balance, and reconciliation.
- **Update:** Never.
- **Delete:** Never.

### Reused operational tables

For `wallets`, reconciliation reads `id`, `wallet_number`, `user_id`,
`currency`, `balance_minor`, `status`, and `updated_at`.

The ledger-derived wallet balance is:

`SUM(CREDIT amount_minor) - SUM(DEBIT amount_minor)`

for the wallet's `USER_WALLET` ledger account. The feature does not expose a
direct balance-edit operation. Only approved adjustment execution may change an
operational wallet balance, atomically with new balanced ledger entries.

For `transfers`, reconciliation reads `id`, `transfer_reference`,
`sender_wallet_id`, `receiver_wallet_id`, `amount_minor`, `currency`, `status`,
`completed_at`, and `reversed_at`. It detects missing, duplicate, incorrect, or
unexpected transfer postings.

For `funding_transactions`, reconciliation reads `id`, `wallet_id`,
`amount_minor`, `currency`, `status`, and `completed_at` to validate expected
funding postings.

#### CRUD operations

- **Create:** None from reconciliation.
- **Read:** Wallet-balance, transfer-posting, and funding-posting validation.
- **Update:** Only the approved adjustment executor may apply an atomic wallet
  balance effect. Transfers and funding records are never updated here.
- **Delete:** None.

### Table: `reconciliation_runs`

Stores scheduled and administrator-triggered reconciliation executions.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Run identifier |
| `run_type` | `reconciliation_run_type` | Yes | Standard value | Validation scope |
| `scope_currency` | `CHAR(3)` | No | Supported currency | Optional currency restriction |
| `scope_wallet_id` | `UUID` | No | Foreign key to `wallets.id` | Optional wallet restriction |
| `status` | `reconciliation_run_status` | Yes | Default `PENDING` | Execution state |
| `trigger_source` | `reconciliation_trigger_source` | Yes | Standard value | Scheduled, admin, or system |
| `initiated_by_user_id` | `UUID` | No | Foreign key to `users.id` | Manual initiator |
| `as_of_time` | `TIMESTAMPTZ` | Yes | Required cutoff | Reconciliation boundary |
| `records_checked` | `BIGINT` | Yes | Default `0`, non-negative | Records checked |
| `finding_count` | `INTEGER` | Yes | Default `0`, non-negative | Findings created |
| `error_code` | `VARCHAR(100)` | No | Safe category | Failure classification |
| `error_message` | `TEXT` | No | Sanitized | Failure detail |
| `started_at` | `TIMESTAMPTZ` | No | — | Start time |
| `completed_at` | `TIMESTAMPTZ` | No | — | Completion time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last run-state update |

Run types:

- `GLOBAL_TRIAL_BALANCE`
- `LEDGER_TRANSACTION_BALANCE`
- `WALLET_BALANCE`
- `TRANSFER_POSTING`
- `FUNDING_POSTING`

Statuses are `PENDING`, `RUNNING`, `COMPLETED`, and `FAILED`.

#### CRUD operations

- **Create:** Scheduler or authorized administrator starts a run.
- **Read:** Display run history and results.
- **Update:** Reconciliation worker updates state, counters, and safe failure
  fields.
- **Delete:** Approved retention only.

### Table: `reconciliation_findings`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Finding identifier |
| `reconciliation_run_id` | `UUID` | Yes | Foreign key to `reconciliation_runs.id` | Parent run |
| `finding_type` | `reconciliation_finding_type` | Yes | Standard value | Discrepancy type |
| `severity` | `reconciliation_severity` | Yes | Standard value | Operational importance |
| `status` | `reconciliation_finding_status` | Yes | Default `OPEN` | Finding lifecycle |
| `currency` | `CHAR(3)` | Yes | Supported currency | Affected currency |
| `wallet_id` | `UUID` | No | Foreign key to `wallets.id` | Affected wallet |
| `transfer_id` | `UUID` | No | Foreign key to `transfers.id` | Affected transfer |
| `funding_transaction_id` | `UUID` | No | Foreign key to `funding_transactions.id` | Affected funding |
| `ledger_transaction_id` | `UUID` | No | Foreign key to `ledger_transactions.id` | Affected transaction |
| `ledger_account_id` | `UUID` | No | Foreign key to `ledger_accounts.id` | Affected account |
| `expected_amount_minor` | `BIGINT` | No | — | Expected value |
| `actual_amount_minor` | `BIGINT` | No | — | Observed value |
| `difference_minor` | `BIGINT` | No | — | Difference |
| `evidence` | `JSONB` | Yes | Sanitized | Reconciliation evidence |
| `resolution_note` | `VARCHAR(500)` | No | — | Resolution explanation |
| `resolved_by_user_id` | `UUID` | No | Foreign key to `users.id` | Resolving administrator |
| `detected_at` | `TIMESTAMPTZ` | Yes | Current time | Detection time |
| `resolved_at` | `TIMESTAMPTZ` | No | — | Resolution time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last lifecycle update |

Finding types:

- `UNBALANCED_LEDGER_TRANSACTION`
- `WALLET_BALANCE_MISMATCH`
- `MISSING_TRANSFER_POSTING`
- `DUPLICATE_TRANSFER_POSTING`
- `TRANSFER_PARTY_MISMATCH`
- `TRANSFER_AMOUNT_MISMATCH`
- `TRANSFER_CURRENCY_MISMATCH`
- `UNEXPECTED_TRANSFER_POSTING`
- `MISSING_FUNDING_POSTING`
- `DUPLICATE_FUNDING_POSTING`
- `GLOBAL_TRIAL_BALANCE_MISMATCH`

Statuses are `OPEN`, `UNDER_REVIEW`, `RESOLVED`, and `ACCEPTED_EXCEPTION`.

#### CRUD operations

- **Create:** Reconciliation workers create findings.
- **Read:** Administrators search and investigate.
- **Update:** Controlled lifecycle and resolution fields only.
- **Delete:** Approved retention only.

Finding evidence contains identifiers and calculated values, not complete
customer, job, or infrastructure payloads.

### Table: `ledger_adjustment_requests`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Request identifier |
| `adjustment_reference` | `VARCHAR(24)` | Yes | Unique | Administrative reference |
| `finding_id` | `UUID` | No | Foreign key to `reconciliation_findings.id` | Related finding |
| `adjustment_type` | `ledger_adjustment_type` | Yes | Standard value | Correction type |
| `target_ledger_transaction_id` | `UUID` | No | Foreign key to `ledger_transactions.id` | Transaction corrected |
| `currency` | `CHAR(3)` | Yes | Supported currency | Adjustment currency |
| `reason_code` | `VARCHAR(100)` | Yes | Standard value | Searchable reason |
| `reason` | `VARCHAR(500)` | Yes | Non-empty | Required explanation |
| `status` | `ledger_adjustment_status` | Yes | Default `DRAFT` | Approval lifecycle |
| `requested_by_user_id` | `UUID` | Yes | Foreign key to `users.id` | Requester |
| `requested_at` | `TIMESTAMPTZ` | Yes | Current time | Request time |
| `approved_by_user_id` | `UUID` | No | Foreign key to `users.id` | Approver |
| `approved_at` | `TIMESTAMPTZ` | No | — | Approval time |
| `rejected_by_user_id` | `UUID` | No | Foreign key to `users.id` | Rejector |
| `rejected_at` | `TIMESTAMPTZ` | No | — | Rejection time |
| `resolution_note` | `VARCHAR(500)` | No | — | Approval/rejection note |
| `executed_ledger_transaction_id` | `UUID` | No | Foreign key to `ledger_transactions.id` | Resulting posting |
| `executed_at` | `TIMESTAMPTZ` | No | — | Execution time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last lifecycle update |

Adjustment types:

- `FULL_REVERSAL`
- `CORRECTIVE_POSTING`
- `WALLET_BALANCE_CORRECTION`

Statuses:

- `DRAFT`
- `PENDING_APPROVAL`
- `APPROVED`
- `REJECTED`
- `EXECUTED`
- `CANCELLED`
- `FAILED`

#### CRUD operations

- **Create:** Authorized administrator creates a request.
- **Read:** Display adjustment history and approval review.
- **Update:** Edit draft content and apply controlled lifecycle transitions.
- **Delete:** Draft cancellation only; submitted requests are retained.

The requester cannot approve their own adjustment.

### Table: `ledger_adjustment_lines`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Line identifier |
| `adjustment_request_id` | `UUID` | Yes | Foreign key to `ledger_adjustment_requests.id` | Parent request |
| `ledger_account_id` | `UUID` | Yes | Foreign key to `ledger_accounts.id` | Account affected |
| `entry_type` | `ledger_entry_type` | Yes | `DEBIT` or `CREDIT` | Proposed movement |
| `amount_minor` | `BIGINT` | Yes | Greater than zero | Proposed amount |
| `currency` | `CHAR(3)` | Yes | Must match request/account | Line currency |
| `description` | `VARCHAR(200)` | No | — | Line explanation |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |

Before submission, at least two lines must exist, all lines must use the request
currency, total debits must equal total credits, and every account must support
the currency. After submission, lines become immutable.

#### CRUD operations

- **Create:** Add lines while the request is `DRAFT`.
- **Read:** Review the proposed adjustment.
- **Update:** Edit lines while the request is `DRAFT`.
- **Delete:** Remove lines while the request is `DRAFT`.

### Adjustment execution

An approved adjustment executes atomically:

1. Lock and recheck the request.
2. Confirm it has not already executed.
3. Revalidate debit-credit equality, accounts, amounts, and currencies.
4. Create one `ledger_transactions` row.
5. Create immutable `ledger_entries`.
6. If a customer wallet is financially affected, update its operational
   balance by the corresponding net ledger effect.
7. Mark the request `EXECUTED`.
8. Resolve or update the related reconciliation finding.
9. Append an `audit_records` row.
10. Create the required adjustment follow-up jobs in `background_jobs`.

Any failure rolls back the complete transaction.

### Indexes and pagination

Important indexes include:

- `ledger_transactions(transaction_type, reference_id)` unique.
- `ledger_transactions(posted_at DESC, id DESC)`.
- `ledger_entries(ledger_transaction_id)`.
- `ledger_entries(ledger_account_id, created_at)`.
- `reconciliation_runs(status, created_at DESC)`.
- `reconciliation_findings(status, severity, detected_at DESC)`.
- `reconciliation_findings(wallet_id, detected_at DESC)`.
- `reconciliation_findings(ledger_transaction_id)`.
- Unique `ledger_adjustment_requests(adjustment_reference)`.
- `ledger_adjustment_requests(status, created_at DESC)`.
- `ledger_adjustment_lines(adjustment_request_id)`.

Global ledger and finding lists use cursor pagination. Reconciliation scans use
the fixed `as_of_time` recorded on the run so later writes do not change the
meaning of an already completed result.

### Ledger and Reconciliation CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `ledger_accounts` | Provisioning | Yes | Controlled metadata/state | No |
| `ledger_transactions` | Financial/adjustment workflows | Yes | No | No |
| `ledger_entries` | Financial/adjustment workflows | Yes | No | No |
| `wallets` | No | Reconciliation | Approved atomic balance effect only | No |
| `transfers` | No | Posting validation | No | No |
| `funding_transactions` | No | Posting validation | No | No |
| `reconciliation_runs` | Scheduler/admin | Yes | Worker state | Retention only |
| `reconciliation_findings` | Reconciliation worker | Yes | Controlled lifecycle | Retention only |
| `ledger_adjustment_requests` | Administrator | Yes | Approval lifecycle | Draft cancellation only |
| `ledger_adjustment_lines` | Draft author | Yes | Draft only | Draft only |
| `audit_records` | Workflows append | Yes | No | Retention only |
| `background_jobs` | Workflows append | Worker | Worker state | Retention only |

---

## 19. Background Job Processing

**Route:** `/admin/jobs`

**Purpose:** Expose PostgreSQL-backed deferred work, failures, and safe retries.

### Sections

- Job summary
- Recent jobs
- Worker-processing status
- Failed jobs
- Safe retry action
- Redacted job payload and processing attempts

### Database design status

Completed for Background Job Processing.

The page exposes job health, worker attempts, redacted payloads, and controlled
retry requests. It does not allow administrators to directly rewrite job state.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `background_jobs` | Existing | Current job and retry state |
| `background_job_attempts` | New | Immutable worker-attempt history |
| `background_job_retry_requests` | New | Controlled manual retry commands |
| `audit_records` | Existing provisional | Administrator and system history |
| `users` | Existing | Administrator identity and authorization |

### Finalized table: `background_jobs`

| Field | PostgreSQL type | Background Job Processing usage |
|---|---|---|
| `id` | `UUID` | Job identifier |
| `job_type` | `VARCHAR(100)` | Handler selection and filter |
| `resource_type` | `VARCHAR(50)` | Source resource type |
| `resource_id` | `UUID` | Source resource identifier |
| `payload` | `JSONB` | Minimum handler input, returned only through redaction |
| `status` | `background_job_status` | Processing state |
| `attempt_count` | `INTEGER` | Processing attempts |
| `max_attempts` | `INTEGER` | Retry limit |
| `available_at` | `TIMESTAMPTZ` | Earliest processing time |
| `locked_at` | `TIMESTAMPTZ` | Claim time |
| `locked_by` | `VARCHAR(100)` | Worker identifier |
| `last_attempt_at` | `TIMESTAMPTZ` | Most recent attempt |
| `completed_at` | `TIMESTAMPTZ` | Successful completion time |
| `last_error_code` | `VARCHAR(100)` | Safe failure classification |
| `last_error_message` | `TEXT` | Sanitized failure detail |
| `created_at` | `TIMESTAMPTZ` | Job creation time |
| `updated_at` | `TIMESTAMPTZ` | Last state update |

Statuses are `PENDING`, `PROCESSING`, `COMPLETED`, and `FAILED`.

#### CRUD operations

- **Create:** Business workflows append jobs atomically with their source
  operation.
- **Read:** Background worker and Background Job Processing page.
- **Update:** Worker changes processing and automatic-retry state.
- **Delete:** Approved retention only.

Completed jobs cannot be reset directly by an administrator.

### Worker claim and retry flow

The NestJS worker polls PostgreSQL and claims a small batch with
`SELECT ... FOR UPDATE SKIP LOCKED`. Inside a short transaction it changes each
claimed job to `PROCESSING`, records `locked_at` and `locked_by`, and commits.
It then runs the appropriate allowlisted handler.

Success marks the job `COMPLETED`. A retryable failure increments
`attempt_count`, clears the lock, returns the job to `PENDING`, and advances
`available_at` using bounded exponential backoff. Reaching `max_attempts` marks
the job `FAILED`. A watchdog may safely recover a stale `PROCESSING` lock.

### Table: `background_job_attempts`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Attempt identifier |
| `job_id` | `UUID` | Yes | Foreign key to `background_jobs.id` | Job attempted |
| `attempt_number` | `INTEGER` | Yes | Positive, unique with job | Sequential attempt |
| `worker_id` | `VARCHAR(100)` | Yes | Non-empty | Worker instance |
| `outcome` | `background_job_attempt_outcome` | Yes | Standard value | Attempt result |
| `error_code` | `VARCHAR(100)` | No | Safe category | Failure classification |
| `error_message` | `TEXT` | No | Sanitized | Failure explanation |
| `started_at` | `TIMESTAMPTZ` | Yes | Current time | Attempt start |
| `completed_at` | `TIMESTAMPTZ` | No | — | Attempt completion |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Row creation time |

Outcomes are `SUCCEEDED`, `FAILED_RETRYABLE`, and `FAILED_PERMANENT`.

The combination `job_id + attempt_number` is unique. A completed attempt is
immutable.

#### CRUD operations

- **Create:** Background worker appends one row per attempt.
- **Read:** Display worker-attempt history.
- **Update:** Complete an active attempt only.
- **Delete:** Approved retention only.

### Table: `background_job_retry_requests`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Retry-request identifier |
| `idempotency_key` | `UUID` | Yes | Unique | Prevent duplicate requests |
| `job_id` | `UUID` | Yes | Foreign key to `background_jobs.id` | Job retried |
| `reason_code` | `VARCHAR(100)` | Yes | Standard value | Searchable reason |
| `reason` | `VARCHAR(500)` | Yes | Non-empty | Administrator explanation |
| `status` | `background_job_retry_status` | Yes | Default `REQUESTED` | Request lifecycle |
| `requested_by_user_id` | `UUID` | Yes | Foreign key to `users.id` | Administrator |
| `requested_at` | `TIMESTAMPTZ` | Yes | Current time | Request time |
| `validated_at` | `TIMESTAMPTZ` | No | — | Validation time |
| `executed_at` | `TIMESTAMPTZ` | No | — | Execution time |
| `completed_at` | `TIMESTAMPTZ` | No | — | Completion time |
| `result_attempt_id` | `UUID` | No | Attempt identifier | Resulting attempt |
| `failure_code` | `VARCHAR(100)` | No | Safe category | Request failure |
| `failure_message` | `TEXT` | No | Sanitized | Failure explanation |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |
| `updated_at` | `TIMESTAMPTZ` | Yes | Current time | Last lifecycle update |

Statuses:

- `REQUESTED`
- `VALIDATED`
- `EXECUTING`
- `SUCCEEDED`
- `FAILED`
- `REJECTED`
- `CANCELLED`

#### CRUD operations

- **Create:** Active administrator submits a retry request.
- **Read:** Display retry history and current status.
- **Update:** Retry worker applies controlled lifecycle transitions.
- **Delete:** Never after submission.

The page creates a retry request rather than resetting the job directly.

### Retry validation and execution

Before execution, the worker verifies that the job exists, is `FAILED`, has not
exceeded its retry limit or retention boundary, has no equivalent retry already
executing, uses an idempotent handler, and was requested by an active
administrator.

Once validated, the worker changes the job back to `PENDING`, sets
`available_at`, records the next attempt, updates the retry request, and appends
an audit record.

### Payload access and audit interaction

`background_jobs.payload` remains stored for processing, but the administrator
receives only a redacted projection. The response removes or masks credentials,
tokens, session identifiers, unnecessary contact information, infrastructure
secrets, and raw exception stacks.

Job-related audit fields needed are `id`, `actor_type`, `actor_user_id`,
`action_type`, `resource_type`, `resource_id`, `outcome`, `severity`,
`source_job_id`, sanitized `metadata`, and `occurred_at`.

Viewing a sensitive payload creates an audit record when required by policy.
Retry requested, validated, rejected, executed, and resolved actions are also
audited.

### Indexes and pagination

Important indexes:

- `background_jobs(status, available_at, created_at)`
- `background_jobs(resource_type, resource_id, created_at)`
- `background_jobs(job_type, created_at DESC)`
- `background_jobs(completed_at DESC)`
- Unique `background_job_attempts(job_id, attempt_number)`
- `background_job_attempts(outcome, created_at DESC)`
- Unique `background_job_retry_requests(idempotency_key)`
- `background_job_retry_requests(status, created_at DESC)`
- `background_job_retry_requests(job_id, created_at DESC)`

Job, attempt, and retry lists use cursor pagination with stable
timestamp and ID ordering.

### Background Job Processing loading operation

1. Authenticate an active administrator.
2. Read job health totals and a cursor-paginated job list.
3. Read the selected job's redacted payload and processing attempts.
4. Read retry-request and audit history.
5. Return the restricted operational view.

### Background Job Processing CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `background_jobs` | Business workflows | Yes | Worker only | Retention only |
| `background_job_attempts` | Worker | Yes | Complete active attempt | Retention only |
| `background_job_retry_requests` | Administrator | Yes | Retry worker lifecycle | No |
| `audit_records` | Workflows append | Yes | No | Retention only |
| `users` | No | Administrator authorization | No | No |

The page mainly performs reads. Its only direct business mutation is creating
an idempotent retry request. The background worker and retry workflow own all
job-state transitions.

---

## 20. Audit Log

**Route:** `/admin/audit`

**Purpose:** Provide an append-only history of important customer,
administrator, and system activity.

### Sections

- Audit search
- Activity timeline
- Actor information
- Affected resource
- Permitted before-and-after context

### Database design status

Completed for Audit Log.

The Audit Log provides an append-only history of important customer,
administrator, service, and system activity. The administrator page is
read-only. Authorized audit producers create records, and only an approved
retention process may remove expired data.

### Tables involved

| Table | Existing/New | Purpose |
|---|---|---|
| `audit_records` | Existing provisional, finalized | Primary audit activity records |
| `audit_record_changes` | New | Permitted field-level before/after context |
| `audit_log_accesses` | New | Access to the audit system |
| `users` | Existing | Safe actor identity and authorization |
| `background_jobs` | Existing | Source-job correlation |
| Business resource tables | Existing | Optional current resource context |

### Finalized table: `audit_records`

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Audit-record identifier |
| `deduplication_key` | `VARCHAR(200)` | Yes | Unique | Prevent duplicate records |
| `actor_type` | `audit_actor_type` | Yes | Standard value | Actor classification |
| `actor_user_id` | `UUID` | No | Foreign key to `users.id` | User/admin actor |
| `actor_reference` | `VARCHAR(150)` | Yes | Non-empty | Stable actor/service reference |
| `action_type` | `VARCHAR(100)` | Yes | Controlled value | Action performed |
| `resource_type` | `VARCHAR(50)` | Yes | Controlled value | Affected resource type |
| `resource_id` | `UUID` | No | — | Affected resource identifier |
| `parent_resource_type` | `VARCHAR(50)` | No | Controlled value | Parent resource type |
| `parent_resource_id` | `UUID` | No | — | Parent resource identifier |
| `outcome` | `audit_outcome` | Yes | Standard value | Action result |
| `severity` | `audit_severity` | Yes | Standard value | Importance |
| `reason_code` | `VARCHAR(100)` | No | Safe standard code | Reason or failure category |
| `source_type` | `audit_source_type` | Yes | Standard value | Originating component |
| `source_job_id` | `UUID` | No | Background-job identifier | Job correlation |
| `correlation_id` | `UUID` | No | — | Cross-service correlation |
| `request_id` | `VARCHAR(100)` | No | — | Request tracing reference |
| `ip_address` | `INET` | No | — | Network context |
| `user_agent` | `VARCHAR(500)` | No | Sanitized | Client description |
| `metadata` | `JSONB` | No | Sanitized and allowlisted | Contextual values |
| `occurred_at` | `TIMESTAMPTZ` | Yes | Required | Activity time |
| `recorded_at` | `TIMESTAMPTZ` | Yes | Current time | Persistence time |

Actor types:

- `CUSTOMER`
- `ADMIN`
- `SYSTEM`
- `SERVICE`
- `ANONYMOUS`

Outcomes are `SUCCESS`, `FAILURE`, and `DENIED`.

Severity values are `INFO`, `WARNING`, and `CRITICAL`.

Source types:

- `APPLICATION`
- `AUTHENTICATION`
- `ADMIN_API`
- `BACKGROUND_WORKER`
- `SCHEDULED_JOB`
- `DATABASE_CONTROL`

The deduplication key is unique. Background workers can derive it from the job
ID, handler, and audit action.

#### CRUD operations

- **Create:** Authorized workflows and audit workers append records.
- **Read:** Audit Log search and details.
- **Update:** Never.
- **Delete:** Approved retention only.

### Table: `audit_record_changes`

Stores allowlisted before-and-after values for state-changing actions.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Change-row identifier |
| `audit_record_id` | `UUID` | Yes | Foreign key to `audit_records.id` | Parent record |
| `field_name` | `VARCHAR(100)` | Yes | Allowlisted | Changed field |
| `change_type` | `audit_change_type` | Yes | Standard value | Change classification |
| `before_value` | `JSONB` | No | Sanitized | Permitted previous value |
| `after_value` | `JSONB` | No | Sanitized | Permitted resulting value |
| `data_classification` | `audit_data_classification` | Yes | Standard value | Access classification |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Creation time |

Change types:

- `CREATED`
- `UPDATED`
- `REMOVED`
- `STATUS_TRANSITION`

Data classifications:

- `INTERNAL`
- `RESTRICTED`
- `HIGHLY_RESTRICTED`

Only explicitly allowlisted fields may be stored. Passwords, credential hashes,
tokens, session secrets, encryption keys, payment credentials, complete job
payloads, and unnecessary personal information are
prohibited.

For state transitions, safe fields such as `status`, `reason_code`, and
operational identifiers may be stored. Financial corrections record references
and permitted amounts without copying or rewriting ledger history.

#### CRUD operations

- **Create:** Audit producer inserts changes with the parent audit record.
- **Read:** Authorized audit-detail view.
- **Update:** Never.
- **Delete:** With approved parent-record retention only.

### Table: `audit_log_accesses`

Records who searched, viewed, or exported audit information. This table remains
separate from business-activity records.

| Field | PostgreSQL type | Required | Constraints/default | Purpose |
|---|---|---:|---|---|
| `id` | `UUID` | Yes | Primary key | Access identifier |
| `accessed_by_user_id` | `UUID` | Yes | Foreign key to `users.id` | Administrator |
| `access_type` | `audit_access_type` | Yes | Standard value | Access action |
| `target_audit_record_id` | `UUID` | No | Foreign key to `audit_records.id` | Record viewed |
| `query_fingerprint` | `VARCHAR(128)` | No | Non-reversible hash | Normalized search |
| `result_count` | `INTEGER` | No | Non-negative | Records returned |
| `reason` | `VARCHAR(500)` | No | Required for restricted/export access | Explanation |
| `ip_address` | `INET` | No | — | Network context |
| `user_agent` | `VARCHAR(500)` | No | Sanitized | Client description |
| `accessed_at` | `TIMESTAMPTZ` | Yes | Current time | Access time |
| `created_at` | `TIMESTAMPTZ` | Yes | Current time | Row creation time |

Access types:

- `SEARCH`
- `VIEW_DETAILS`
- `VIEW_RESTRICTED_CONTEXT`
- `EXPORT`

Search filters are represented by a non-reversible fingerprint rather than
copying sensitive query values.

#### CRUD operations

- **Create:** Audit API automatically appends access records.
- **Read:** Security and compliance review only.
- **Update:** Never.
- **Delete:** Approved retention only.

### Reused table: `users`

The page reads user `id`, `full_name`, `role`, `status`, `created_at`, and
`closed_at` to resolve safe actor information. Historical interpretation uses
`actor_reference` when current user data has changed or is unavailable.

#### CRUD operations

- **Create:** None.
- **Read:** Resolve safe actor context and authorize administrators.
- **Update:** None.
- **Delete:** None.

### Reused table: `background_jobs`

Job correlation reads `id`, `job_type`, `resource_type`, `resource_id`,
`status`, `created_at`, and `completed_at` using
`audit_records.source_job_id`. The Audit Log does not expose the complete job
payload by default.

#### CRUD operations

- **Create:** None from Audit Log.
- **Read:** Background-job correlation.
- **Update:** None.
- **Delete:** None from Audit Log.

### Resource resolution

`resource_type` and `resource_id` form a controlled polymorphic reference.
Supported types include:

- `USER_ACCOUNT`
- `WALLET`
- `TRANSFER`
- `FUNDING_TRANSACTION`
- `LEDGER_TRANSACTION`
- `RECONCILIATION_FINDING`
- `LEDGER_ADJUSTMENT`
- `BACKGROUND_JOB`
- `BACKGROUND_JOB_RETRY_REQUEST`
- `AUTH_SESSION`

The page may resolve a safe current display value from the corresponding
business table. Historical meaning remains in the audit record even when the
source resource later changes, closes, or moves to offline retention.

Resource resolution uses an explicit resolver for each supported type.
Unrestricted dynamic SQL based on `resource_type` is prohibited.

### Audit creation transactions

For synchronous administrator actions:

1. Authenticate and authorize the actor.
2. Perform the controlled business operation.
3. Insert `audit_records`.
4. Insert permitted `audit_record_changes`.
5. Commit the business and audit changes in the same database transaction.

For asynchronous background jobs:

1. Process the job idempotently.
2. Sanitize the job data.
3. Create the audit record using a unique deduplication key.
4. Insert permitted change rows.
5. Commit the audit record and job-processing result atomically.

A failed business transaction may still create a separate `FAILURE` or `DENIED`
audit record, but that record must not claim the business mutation succeeded.

### Search and access rules

Search supports audit ID, actor type and user ID, action type, resource type and
ID, outcome, severity, source type and job ID, correlation ID, request ID, and
occurrence range.

Free-text search across complete metadata is avoided unless a measured
operational requirement justifies it. Restricted change values require elevated
authorization and a reason. Export requires elevated authorization, an
explanation, and an `audit_log_accesses` record.

### Indexes, partitioning, and pagination

Recommended indexes:

- Unique `audit_records(deduplication_key)`
- `audit_records(occurred_at DESC, id DESC)`
- `audit_records(actor_user_id, occurred_at DESC)`
- `audit_records(action_type, occurred_at DESC)`
- `audit_records(resource_type, resource_id, occurred_at DESC)`
- `audit_records(outcome, severity, occurred_at DESC)`
- `audit_records(source_job_id)`
- `audit_records(correlation_id)`
- `audit_record_changes(audit_record_id)`
- `audit_log_accesses(accessed_by_user_id, accessed_at DESC)`
- `audit_log_accesses(target_audit_record_id)`

For high volume, `audit_records` and `audit_log_accesses` are time-partitioned,
for example monthly by `occurred_at` and `accessed_at`.

Search uses cursor pagination ordered by `occurred_at DESC, id DESC`.

### Retention and integrity rules

- Application roles have no `UPDATE` permission on audit tables.
- Ordinary administrators have no direct `DELETE` permission.
- Retention removes complete expired partitions through a controlled job.
- Active legal or investigation holds prevent deletion.
- Backups and archived partitions follow the same access policy.
- Metadata and change values are validated against an allowlist before insert.
- Export requires elevated authorization, a reason, and access logging.

### Audit Log loading operation

1. Authenticate and authorize an active administrator.
2. Validate filters and record a non-reversible search fingerprint.
3. Read a cursor-paginated audit-record page.
4. Resolve safe actor and resource display context.
5. If permitted, read allowlisted change rows for a selected record.
6. Append the appropriate `audit_log_accesses` row.
7. Return the restricted audit response.

### Audit Log CRUD summary

| Table | Create | Read | Update | Delete |
|---|---:|---:|---:|---:|
| `audit_records` | Authorized workflows | Yes | Never | Retention only |
| `audit_record_changes` | Audit producer | Restricted details | Never | With parent retention |
| `audit_log_accesses` | Audit API | Compliance only | Never | Retention only |
| `users` | No | Safe actor context | No | No |
| `background_jobs` | No | Job correlation | No | No |
| Business resource tables | No | Safe resource context | No | No |

The `/admin/audit` route performs reads only. Its access logging is an automatic
security side effect rather than an administrator-editable operation.

## Navigation

### Customer

- Dashboard
- Send Money
- Transactions
- Statement
- Analytics
- Notifications
- Settings

### Administrator

- Overview
- Users
- Wallets
- Transfers
- Ledger
- Jobs
- Audit Logs
