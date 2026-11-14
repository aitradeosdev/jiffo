# Security audit

The code on `main` at commit 87a57cf (14 November 2026), checked against `docs/security-plan.md`. No code was changed for this audit.

**Status**:

- **done**: met, with the test that shows it where there is one
- **partly**: some of it is met
- **missing**: none of it is met
- **n/a**: the feature it applies to doesn't exist
- **owner**: a person does it outside the code
- **after launch**: the plan puts it after launch

**Decision**:

- **implement**: the work is planned below
- **keep**: the plan differs from a deliberate choice already built, and the build stays, for the reason given
- **owner**: a person does it
- **after launch**: deferred, as the plan says

Paths are relative to `apps/api/src/` unless they start with `apps/`, `packages/` or `test/` (meaning `apps/api/test/`).

## Progress

The tables below stay as they were at the audit. What has been fixed since:

| Fix | Pull request | State |
|---|---|---|
| 1. Payouts and reconciliation | aitradeosdev/jiffo#38 | merged |
| 2. Ledger guards | aitradeosdev/jiffo#39 | merged |
| 3. The errand money path | aitradeosdev/jiffo#40 | merged |
| 4. Deposits | aitradeosdev/jiffo#41 | merged |
| 5. Rules and access | aitradeosdev/jiffo#42 | merged |
| Rules from fixes 1 to 5 moved into Settings | aitradeosdev/jiffo#43 | merged |
| 6a. Identity checks: I1, I2 (links), findings 3, 9, 12, 19, 22, and the sandbox half of 10 | this branch, `sec/identity-checks` | open |
| 6b. Identity: separate keys and field encryption (I5, I6, finding 21) | | next |
| 6c. Identity: near name matches to review (I4) | | next |

## Summary

The money core is sound:

- One service writes the ledger.
- Amounts are whole kobo.
- Accounts are locked in key order.
- A database check stops negative balances.
- Journals, deposits, payouts and webhook events have unique keys.
- Fees, commission and splits are worked out on the server from settings.

Paystack webhooks are checked on the raw body with a constant-time comparison, and every deposit is re-read from the provider before it is credited.

The serious gaps are in the flows around that core:

- **A withdrawal can be paid twice.** Two runs can send the same withdrawal at once. The one that loses can refund the agent while the bank pays.
- **An agent can be paid without the hand-off PIN.** They can mark an errand delivered from anywhere and send a drop-off photo at once, and both escrows pay out after 24 hours unless the customer acts. Nothing checks distance or the wait time set in settings.
- **Identity checks leak names.** They return the legal name on the ID record even when the selfie doesn't match, with no limit on tries. Anyone can look up a stranger's name from their NIN.
- **Some areas are wide open.** There are no rate limits on most routes, CORS is open by default, and live connections outlive the sessions behind them.
- **The plan's account protections don't exist yet.** There is no device binding, app PIN, attestation, two-person approval or passkeys. A one-time SMS code alone controls an account.

## Where the plan and the build differ

The owner asked for anything in the plan that contradicts what was built to be compared, and ignored where a change isn't needed. Each difference is settled here.

| Plan | Built | Decision | Why |
|---|---|---|---|
| Secrets in AWS Secrets Manager (R9, P11, S2) | Provider keys are entered in the admin panel and stored encrypted under `SECRETS_KEY`. Core secrets come from environment variables. | keep | The owner chose to manage provider keys in the panel. They are encrypted at rest and never shown again. At deploy time the host's secret store supplies the environment variables (owner). |
| `ValidationPipe` with whitelist and forbid (R3) | Zod schemas through `ZodBody` that list each endpoint's fields | keep Zod, implement rejection of unknown keys | Same protection. Zod strips unknown keys today; rejecting them closes the gap. |
| Clients never send amounts (R3) | Customers propose their fee, agents send counter-offers and item amounts, and people choose top-up, withdrawal and tip amounts | keep | These are proposals the other side confirms, or the sender's own money, which L8 allows. |
| Keep the BVN's last 4 digits; encrypt NIN, BVN and selfies (I5, I6) | None of these are stored | keep | Stricter than the plan: the owner's rule is that ID numbers go to the provider and are not kept. |
| Selfie in the provider's native SDK (I2) | The providers' own pages, opened in the phone's system browser, not a web view | keep | The providers' native SDKs need native builds and their own licences. The system browser can't be read by the app. Picking a provider with the liveness certification is the owner's task. |
| Delete manual-mode ID photos (I7) | There is no manual mode, and no ID photos are stored | n/a | |
| Agora call tokens (C5) | Masked phone calls through Twilio or Africa's Talking | keep | The plan's aim is met: calls go only between the errand's two parties, and real numbers never appear. |
| Process webhooks from a queue (P3) | Processed inline; stored first, so a repeat does nothing; a failure answers non-200 so the provider retries | keep | Just as safe, and simpler. |
| Credit deposits only through `dedicated_nuban` (P5) | One-time account numbers and each customer's own account number, admin's choice | keep both, and tighten the second | The owner asked for both. Each path re-verifies with the provider and credits once. |
| Hand-off PIN stored only as an HMAC (E4) | Encrypted, so the customer's app can show it again | keep reversible, and implement a key per errand plus an HMAC for checking | A hash can't be shown again. |
| Fresh selfie on every new device (A4, X4) | Customers verify once | implement for agents; keep for customers | A customer's wallet can't be paid out to a bank, so a takeover can't take the money out of Jiffo directly. Revisit if customers ever get withdrawals or refunds to a bank. |
| Refunds through support to a bank (L14) | Customers can't withdraw; support only adjusts wallets | n/a | Adjustments get the two-person rule under D4. |
| Referrals and promos (F1–F4, X5) | Not built | n/a | The rules apply when the feature is built. |

## Rules for every change (R)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| R1 | partly | `errands/access.ts`, `errands/errands.service.ts` (`roleFor`), `realtime/realtime.gateway.ts`; tests: `errands`, `chat-realtime`, `files-ratings` | Any agent-app account, approved or not, can open a waiting errand by its ID: the full addresses with coordinates, the description and the customer's name. Socket rooms are not re-checked after joining. Suspension doesn't drop live connections. With no Redis adapter, leaving a room or signing out only reaches connections on the same server. | implement (fix 5) |
| R2 | done | `auth/auth.guard.ts`; the user ID comes only from the verified token | | |
| R3 | partly | `common/zod-body.ts`, `calls/calls.controller.ts` | Unknown keys are stripped rather than refused. The calls callback body isn't validated. | implement (fix 5) |
| R4 | partly | `errands/errand-view.ts`, `errands/errands.service.ts` (board) | The board and the waiting-errand view show the exact drop-off address, its coordinates and the description before anyone accepts. The board takes any location the app sends. The event list carries former agents' IDs. Push previews include chat text. | implement (fix 5) |
| R5 | done | `admin/admin.guard.ts`, `admin/admin-auth.service.ts`; test: `admin.e2e` (app token refused) | The admin API shares a host with the app API (see D1). | |
| R6 | done | Drizzle query builder throughout; the one `sql.raw` is over a constant | | |
| R7 | done | The admin panel relies on React escaping; the one `dangerouslySetInnerHTML` draws the server-made sign-in QR code | A lint rule banning it, and a content security policy on the panel and the API's HTML pages. | implement (fix 8) |
| R8 | partly | `common/errors.ts` | Unknown errors are generic, but provider error text reaches users: withdrawal failure reasons, own-account failure reasons. | implement (fix 5) |
| R9 | partly | `providers/secret-box.ts`, `config/app-config.ts` | Core secrets are environment variables; how they are injected is a hosting matter. | keep (see differences); owner |
| R10 | partly | `adapters/messaging.ts` (development only), `money/webhooks.controller.ts` | No Sentry and no log redaction. Provider messages are logged as they come. Full webhook bodies are stored in `provider_events`. The calls callback secret sits in the URL path. | implement (fix 5) |
| R11 | partly | `pnpm-lock.yaml`, CI installs with a frozen lockfile | No dependency scanning. | implement (fix 8) |
| R12 | partly | `config/app-config.ts`, `app.setup.ts`, `realtime/realtime.gateway.ts` | CORS defaults to any origin and production doesn't require a list. Socket CORS is any origin. Production doesn't require an https public URL. | implement (fix 5) |
| R13 | owner | | A working rule: local and staging only. | owner |
| R14 | missing | | A threat-model template and a pull request checklist. | implement (fix 8) |

## Accounts and login (A)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| A1 | partly | `auth/otp.service.ts`, `packages/shared/src/settings.ts`; test: `auth.e2e` | **Already done:** codes are 6 digits from a secure generator, stored hashed, valid 5 minutes and single use, with 5 tries and a 60-second resend wait. **Missing:** the limit is 5 an hour per number, not 3 per 15 minutes and 10 a day. There is no per-device limit. The per-IP count isn't serialised, so a burst across many numbers beats it. | implement (fix 7) |
| A2 | partly | `auth/phone.ts` | Premium-rate and toll-free numbers are refused, and the country must be enabled. No alert on SMS spend. | implement (fixes 7, 8) |
| A3 | missing | `apps/mobile/src/auth/session.tsx` | A key pair in the phone's secure hardware, and signed money requests. Needs a native development build. | implement (fix 10) |
| A4 | missing | `auth/auth.service.ts` | Selfie on a new device before wallet actions. | implement for agents (fix 10); keep for customers |
| A5 | missing | | An SMS code alone can withdraw money and change the payout account. | implement (fix 10, through A3, A4 and A7) |
| A6 | missing | `money/payouts.service.ts` | A 48-hour hold on agent withdrawals after a new payout account, a new device or a new PIN, with SMS and email. The phone number can't be changed at all. | implement (fix 10) |
| A7 | missing | | App PIN or biometric for wallet actions. | implement (fix 10) |
| A8 | partly | `auth/auth.service.ts`, `auth/tokens.service.ts`; test: `auth.e2e` | Access tokens last 15 minutes and refresh tokens rotate. **Missing:** a reused refresh token ends only that session, not all of them. Session expiry slides forward with no absolute limit. Signing in on a new device leaves other devices signed in. | implement (fix 7) |
| A9 | missing | | Block screenshots on wallet, ID and PIN screens. | implement (fix 10) |
| A10 | after launch | | | after launch |

## Identity (I)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| I1 | partly | `identity/identity-checks.service.ts`, `identity/customer-identity.service.ts`, `agents/application.service.ts` | Verified only when both the ID and the selfie pass. **But** the legal name from the ID record is saved and shown even when the selfie fails, and starting a check is unlimited. That makes a name lookup by NIN or BVN. | implement (fix 6) |
| I2 | partly | `adapters/identity-providers.ts`, `apps/mobile/src/identity/check.tsx` | Hosted pages in the system browser (see differences). Their links never expire and aren't tied to the account's session, so a link can be forwarded to someone else. | keep hosted pages; implement link expiry and binding (fix 6); owner picks a certified provider |
| I3 | partly | fingerprints and unique indexes in `db/schema.ts`; tests: `agent-application`, `admin-id-checks`, `identity-types` | The same ID on two accounts is caught. Missing: flags for the same face on different IDs, and for devices or payout accounts shared between accounts. | implement (fix 11) |
| I4 | partly | `money/payouts.service.ts` (`setAccount`), `common/names.ts`; test: `money.e2e` | Payout names must match the legal name exactly, word by word. Near matches are refused rather than sent to review, and a later account change isn't re-reviewed. | implement (fix 6) |
| I5 | partly | `identity/identity-checks.service.ts` | ID numbers are kept only as an HMAC, but its key comes from `PIN_KEY`, which also encrypts admin sign-in secrets and hand-off PINs. No BVN digits are kept (stricter than the plan). | implement separate keys (fix 6); KMS is hosting (owner) |
| I6 | partly | `db/schema.ts` | NIN, BVN and selfies are not stored. Stored unencrypted: legal name, date of birth, home address, emergency contacts and full payout account numbers. | implement field encryption (fix 6) |
| I7 | n/a | | No manual mode. | |
| I8 | missing | `agents/presence.service.ts` | Agent selfie before going online, daily and at random. The `selfieTries` setting is never used. | implement (fix 10) |

## Ledger, wallet and escrow (L)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| L1 | done | `money/ledger.service.ts` is the only writer of accounts, journals and postings | A database guard (L3) to keep it so. | implement (fix 2) |
| L2 | done | `bigint` columns; safe-integer checks in `money/ledger.service.ts` | | |
| L3 | missing | `drizzle/*.sql` | A trigger rejecting UPDATE and DELETE on `journal_entries` and `postings`, with a test. | implement (fix 2) |
| L4 | done | `money/ledger.service.ts`, `drizzle/0003_money.sql`; tests: `money.e2e` | The balance check can be switched off per row by an `allow_negative` flag. Tighten it. | implement (fix 2) |
| L5 | partly | unique keys on journals, deposits, payouts and provider events; test: `admin-money.e2e` | No idempotency key on `POST /wallet/withdrawals` or `POST /wallet/deposits`. Reusing an adjustment's request ID for another person or amount silently posts nothing. | implement (fix 1) |
| L6 | partly | `db/schema.ts` | All the plan's accounts exist except promo and referral spending (no promos yet). Commission shares one revenue account with other fees and is told apart by journal kind, which the money page reports. | keep the revenue account; promo account when promos are built |
| L7 | partly | `packages/shared/src/errands.ts`, `errands/errands.service.ts` | Escrow state follows the errand's status and version under a row lock. Admin can freeze only from three states. A locked hand-off PIN doesn't freeze anything. No test tries to move a frozen escrow. | implement (fixes 2, 3) |
| L8 | done | `errands/errands.service.ts`, `money/wallet.service.ts`; tests: `money.e2e` | The new-customer and new-agent item limits in settings are never enforced. | implement (fix 3) |
| L9 | partly | `auth/otp.service.ts`, `errands/errands.service.ts` | Counters are read and written under row locks, which holds. The per-IP code count isn't. | implement (fix 7) |
| L10 | missing | | Tests that fire 50 identical requests at every money endpoint. | implement (fix 2) |
| L11 | partly | trial balance asserted in `money.e2e` | Checks that every journal sums to zero and that released or refunded escrows are empty, run after every test file. | implement (fix 2) |
| L12 | partly | `money/reconciliation.service.ts` | It compares the provider balance only, and a gap only logs a warning. Missing: comparing transaction lists, pausing instant withdrawals on a gap, and clearing it in a Finance queue. | implement (fix 1) |
| L13 | missing | | Low-balance alert. | implement (fix 1) |
| L14 | n/a | | See differences. | |

## Paystack (P)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| P1 | done | `adapters/payments.ts` (HMAC-SHA512 of the raw body, `timingSafeEqual`), `main.ts` (`rawBody`); tests: `adapters`, `money.e2e` | | |
| P2 | partly | `money/deposits.service.ts`, `money/fixed-accounts.service.ts`; tests: `money.e2e`, `fixed-accounts.e2e` | Status, currency and ownership are checked, and each reference is credited once. What arrives is credited even if it differs from the amount asked; that is kept, since it is the customer's money. The own-account path doesn't check the channel in the verify answer. | implement the channel check (fix 4) |
| P3 | done differently | `money/webhooks.controller.ts` | | keep (see differences) |
| P4 | missing | | An optional allow-list of Paystack's addresses, from a setting. | implement (fix 8) |
| P5 | done | both deposit paths re-verify and credit once | Refuse our own one-time references on the own-account path. | keep both; implement (fix 4) |
| P6 | partly | `money/payouts.service.ts`; tests: `money.e2e` | Our own reference, retried with the same reference, and failures and reversals paid back. **But** sending takes no claim, so two sends can overlap, and an unclear answer can refund a transfer that went through. | implement (fix 1) |
| P7 | missing | | The transfer approval endpoint. Registering it in the Paystack dashboard is the owner's. | implement (fix 1); owner |
| P8 | partly | `money/payouts.service.ts` | Recipients come only from a name-checked account. Missing: the hold and a fresh selfie when it changes. | implement (fix 10) |
| P9 | partly | `money/payouts.service.ts` | Only new (Bronze) agents have a daily cap. Missing: an instant-withdrawal cap for every agent, and one for the whole platform. | implement (fix 1) |
| P10 | owner | | Fixed outgoing addresses (hosting). | owner |
| P11 | done differently | `providers/secret-box.ts` | Nothing stops live keys outside production. | keep; implement the live-key check (fix 8) |
| P12 | done | only bank transfers are offered | | |

## Errands, PIN and disputes (E)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| E1 | partly | see R1 | Unapproved agents can open waiting errands; live connections. | implement (fix 5) |
| E2 | done | random UUIDs; a malformed ID gets 404; test: `errands.e2e` | | |
| E3 | partly | `packages/shared/src/errands.ts`; test: `errands.e2e` | Prices change only through confirmed offers, and chat never sets one. No limit of 5 offers a minute. | implement (fix 3) |
| E4 | partly | `common/crypto.ts`, `errands/errands.service.ts`; tests: `errands.e2e` | **Already done:** a secure random PIN, shown only to the customer once the errand is delivered, single use, locked after 5 wrong entries, and the app warns the customer. **Missing:** the PIN is encrypted under one global key and kept after the errand ends. A lock sends the agent to the photo route, which pays out after 24 hours, and the photo route is open without any PIN attempt. There is no 200 m check, and wrong entries aren't logged. | implement (fix 3) |
| E5 | missing | `errands/errand-input.ts` | Flags for cash delivery, "send money to my account", and pickup equal to drop-off. | implement (fix 11) |
| E6 | missing | | Collusion flags and a Risk queue. | implement (fix 11) |
| E7 | missing | `admin/errands-admin.service.ts` | A second admin for splits above a set amount. | implement (fix 9) |
| E8 | partly | `admin/errands-admin.service.ts` | The admin errand page shows events, chat (up to 1,000 messages), photos, money and ratings. Missing: wrong PIN entries, the call log, the GPS trail, and a fixed snapshot. | implement (fix 11) |
| E9 | missing | | Emergency button and a Safety queue. | implement (fix 11) |

## Chat, calls and uploads (C)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| C1 | partly | `files/uploads.service.ts`, `adapters/storage.ts`; tests: `files-ratings` | Type and size limits, signed private links, and memory storage refused in production. **Missing:** a check of the file's real bytes, re-encoding and stripping location data, and a 5-minute link setting (it is 15 minutes, fixed in code). | implement (fix 11) |
| C2 | partly | agent app camera screens | The agent app takes these photos with the camera and the server keeps the time; the server can't prove an image came from a camera. | keep, with fix 11's re-encoding and visible server time |
| C3 | missing | `chat/chat.service.ts` | Warning flags for links, phone numbers, bank account numbers and "pay outside the app". There are no link previews. | implement (fix 11) |
| C4 | partly | `realtime/realtime.gateway.ts`; tests: `chat-realtime` | Token checked at connection, and rooms only for the two parties. Missing: the Redis adapter, dropping connections on suspension, re-checking, and CORS. | implement (fix 5) |
| C5 | done differently | `calls/calls.service.ts`, `adapters/calls.ts`; tests: `calls.e2e` | Masked calls between the two parties only, while the errand is live; real numbers never appear. | keep (see differences) |
| C6 | done | the admin panel renders chat as text | A test that markup shows as text. | implement (fix 8) |
| C7 | after launch | | | after launch |

## Location (G)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| G1 | missing | `apps/mobile/src/agent/presence.tsx`, `agents/presence.service.ts` | Mock-location and root checks in the app, and speed and jump checks on the server (these need a trail). | implement (fix 11) |
| G2 | partly | `agents/presence.service.ts`, `errands/errands.service.ts`; test: `presence.e2e` | The customer sees the agent only on their own errand. **But** sharing continues after a drop-off photo, for up to 24 hours. An agent holding two errands is visible to both customers throughout. | implement (fix 5) |
| G3 | done | `apps/mobile/src/agent/background-location.ts`, `agents/presence.service.ts`; test: `presence.e2e` | | |
| G4 | n/a today | only the latest point is kept | Once fix 11 adds a trail, it needs 90-day deletion with a hold for open disputes. | implement with the trail (fix 11) |

## Referrals and promos (F)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| F1–F2 | n/a | not built | | Apply when built. |
| F3 | missing | `admin/people-admin.service.ts` | Errand counts for tiers leave out errands flagged for fraud (needs E6's flags). | implement (fix 11) |
| F4 | after launch | | | after launch |

## Admin panel and staff (D)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| D1 | owner | `admin/admin.controller.ts` | Zero-trust access in front (owner). In code, serve the admin API on its own address so it can sit behind that. | implement the split (fix 9); owner |
| D2 | partly | `admin/admin-auth.service.ts`, `admin/totp.ts`; tests: `admin.e2e` | Authenticator app for every role. No passkeys. | implement passkeys for money and ID roles (fix 9) |
| D3 | partly | `packages/shared/src/admin.ts`, `admin/admin.guard.ts`, `admin/team.service.ts`; test: `admin.e2e` | Four roles, checked on every route. Missing: verification, disputes and safety roles, and an approver-is-not-the-requester check. Staff aren't linked to their own app accounts, so they could act on them. Invite and reset links go back to the owner who made them, who could then sign in as the teammate. | implement (fix 9) |
| D4 | missing | `admin/money-admin.service.ts`, `admin/settings-admin.service.ts`, `admin/team.service.ts` | Two-person approval for all of D4. | implement (fix 9) |
| D5 | partly | `admin/people-admin.service.ts`, `admin/applications-admin.service.ts` | No NIN, BVN or selfie to show. Legal name, date of birth, home address and emergency contacts are shown to every role, read-only Support included. | implement masking with reveal-and-reason (fix 9) |
| D6 | partly | `admin/admin-auth.service.ts`; test: `admin.e2e` | 30 minutes idle and 12 hours total, not 15 and 8. No fresh sign-in before money actions. | implement (fix 9) |
| D7 | partly | `admin/audit.service.ts`; tests: `admin.e2e` | Who, what, when, IP and data are recorded. Missing: append-only enforcement, the user agent, before-and-after values for adjustments and suspensions, a reason on every change, and auditing of the admin command line. The write-once copy is hosting (owner). | implement (fix 9); owner |
| D8 | after launch | | | after launch |

## Servers and data (S)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| S1 | owner | `docker-compose.yml` is for local use only | Accounts, MFA, infrastructure as code, private database. | owner |
| S2 | partly | provider keys encrypted; `.env` files ignored by git | Secret scanning before commits and in CI. | implement (fix 8); owner (rotation) |
| S3 | partly | `apps/admin/next.config.ts` | No HSTS or content security policy, and nothing checks https addresses in production. TLS itself is hosting. | implement (fix 8) |
| S4 | owner | | Backups and restore tests. | owner |
| S5 | partly | custom limits for codes, admin sign-in, calls, uploads and top-ups | No rate limit on most routes: refresh, places and quotes (paid Google calls), own accounts, chat, presence, the board, identity starts, webhooks, live connections. The WAF is hosting. | implement (fix 8) |
| S6 | missing | `money/reconciliation.service.ts`, `admin/overview.service.ts` | Alerts for everything in S6; today there are only counts on the overview and a log line. | implement (fixes 1, 8) |
| S7 | owner | Nest logger to stdout | Central storage (hosting). In code: structured logs with redaction. | implement redaction (fix 5); owner |
| S8 | partly | only `/v1` exists; the development file route is off in production | No OpenAPI document. | implement (fix 8) |
| S9 | partly | timeouts on payments, calls, Africa's Talking and identity | No timeouts on Termii, Google Maps, FCM or S3. Redirects are followed. Responses are trusted as typed. Provider addresses can be edited in the panel. | implement (fix 8) |
| S10 | partly | `.github/workflows/ci.yml` | No CodeQL or Semgrep, no dependency or secret scanning, and no permissions block. ZAP against staging is the owner's. | implement (fix 8); owner |
| S11 | missing | | `security.txt` and a reporting page. | implement (fix 8) |

## Mobile apps (MB)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| MB1 | done | `apps/mobile/app.config.ts` | Restrict the Maps key to the app (owner). | owner |
| MB2 | partly | `apps/mobile/src/storage.ts` | Tokens are in secure storage, but on iOS they can be restored onto another device. Web builds use local storage. | implement device-only storage, and refuse web sign-in in production (fix 10) |
| MB3 | missing | | Play Integrity and App Attest. | implement (fix 10); owner (store setup) |
| MB4 | missing | | Root, emulator, hooking-tool and mock-location signals. | implement (fix 10) |
| MB5 | partly | `apps/mobile/app/(app)/_layout.tsx` | Screens need sign-in. Link parameters aren't validated. | implement (fix 10) |
| MB6 | done | Expo modules, maps, socket.io client | A written list of the SDKs used. | implement (fix 8) |
| MB7 | after launch | | | after launch |
| MB8 | owner | | Mapping against MASVS and the OWASP Top 10s, checked by the penetration test. | owner |

## Changes to features already built (X)

| ID | Status | Files | What is missing | Decision |
|---|---|---|---|---|
| X1 | partly | `packages/shared/src/settings.ts` (`autoReleaseHours` 24); test: `errands.e2e` | Auto-release is 24 hours for both escrows. No reminders. | implement (fix 11) |
| X2 | missing | | Drop-off photo queue: pause, freeze, decide. | implement (fix 11) |
| X3 | missing | `adapters/messaging.ts` (codes only) | Reminders at 2, 12 and 20 hours by push and SMS. | implement (fix 11) |
| X4 | missing | | See A4 and A6. | implement for agents (fix 10) |
| X5 | n/a | | Referrals aren't built. | apply when built |
| X6 | missing | | See D2. | implement (fix 9) |
| X7 | missing | | See D4. | implement (fix 9) |
| X8 | missing | | See E4. | implement (fix 3) |
| X9 | partly | `payouts_in_transit` exists | Promo account when promos are built. | |
| X10 | partly | per-country, versioned settings exist | No Security group. Most of its values don't exist yet, and changes aren't two-person approved. | implement (each value with its fix; the group and approval in fix 9) |

## Found outside the plan

| # | Severity | Finding | Files | Fix |
|---|---|---|---|---|
| 1 | high | **A withdrawal can be paid twice.** Sending takes no claim, so two runs can send at once. The one told "duplicate reference" can find nothing on a re-check while the bank is still processing, and refunds the agent. | `money/payouts.service.ts` (`send`, `fail`) | 1 |
| 2 | high | **Paid without the PIN.** "Mark delivered" works from anywhere, and a drop-off photo can follow at once with no PIN attempt; both escrows pay out after 24 hours. The drop-off wait in settings (`dropoffWaitMinutes`) is never used, nor are the dispute time settings. | `packages/shared/src/errands.ts`, `errands/errands.service.ts` | 3 |
| 3 | medium | **Name lookup by NIN or BVN.** The legal name from a found record is shown even when the selfie fails, and tries are unlimited, each a paid provider check. | `identity/customer-identity.service.ts`, `agents/application.service.ts` | 6 |
| 4 | medium | **A double tap makes two withdrawals.** There is no idempotency key. | `money/money.controller.ts`, `money/payouts.service.ts` | 1 |
| 5 | medium | **Suspension doesn't stop payouts.** A suspended agent's queued withdrawals are still sent. | `admin/people-admin.service.ts`, `money/payouts.service.ts` | 1 |
| 6 | medium | **Item limits are ignored.** The new-customer and new-agent item limits, and the strike threshold, are never used; an item amount can be up to ₦1bn. | `errands/errand-input.ts`, `packages/shared/src/settings.ts` | 3 |
| 7 | medium | **Own-account requests test BVNs.** A customer can try any BVN and bank account without limit. The name sent is their self-edited profile name, and Paystack's reason is shown. | `money/fixed-accounts.service.ts` | 4 |
| 8 | medium | **Open errands' addresses can be collected.** Unapproved agents can open waiting errands by ID. Approved agents can ask the board about any location in the country, unlimited, and see exact drop-off addresses. | `errands/errands.service.ts`, `errands/errand-input.ts` | 5 |
| 9 | medium | **Hosted identity links don't expire** and aren't tied to the account's session, so someone else can complete the check. | `providers/providers.service.ts`, `identity/identity.controller.ts` | 6 |
| 10 | medium | **Insider risks.** An owner can take over a teammate's admin account through the reset link. One owner can switch an identity provider to sandbox in production. | `admin/admin-auth.service.ts`, `providers/builders.ts` | 6, 9 |
| 11 | medium | **Live connections outlive sessions.** There's no Redis adapter, nothing is re-checked after connecting, and suspension doesn't disconnect. | `realtime/realtime.gateway.ts` | 5 |
| 12 | low | The Smile ID callback signs only its timestamp, not the body; the result should be re-read from Smile ID. | `adapters/identity-providers.ts` | 6 |
| 13 | low | Admin adjustments need one person. A reused request ID silently posts nothing, with no audit entry. | `admin/money-admin.service.ts` | 1, 9 |
| 14 | low | A top-up event with an unknown reference is closed silently. | `money/webhooks.controller.ts`, `money/deposits.service.ts` | 4 |
| 15 | low | Revenue can go below zero unnoticed, and the balance check can be turned off per row. | `money/ledger.service.ts`, `drizzle/0003_money.sql` | 2 |
| 16 | low | The limit of 3 open top-ups can be raced. Every poll of a pending top-up calls the provider. | `money/deposits.service.ts` | 4 |
| 17 | low | Paystack's `otp` transfer status would leave a withdrawal processing for ever. | `adapters/payments.ts` | 1 |
| 18 | low | Provider addresses can be edited in the panel, and the Test button follows redirects, so a stolen owner session could send keys elsewhere. | `providers/builders.ts`, `admin/providers-admin.service.ts` | 8 |
| 19 | low | The identity page-open limit lives in one process's memory. | `identity/identity-checks.service.ts` | 6 |
| 20 | low | The API's HTML pages have no security headers, and the Dojah script has no integrity hash. | `adapters/identity-providers.ts`, `app.setup.ts` | 8 |
| 21 | low | One key (`PIN_KEY`) does three jobs, and `JWT_SECRET` several. | `config/app-config.ts`, `common/crypto.ts` | 6 |
| 22 | low | Approving an agent can move an ID away from another applicant who proved it. | `agents/application.service.ts` | 6 |
| 23 | low | No cap on how many errands an agent holds at once. | `errands/errands.service.ts` | 3 |
| 24 | low | Development memory storage serves uploaded SVG files from the API's own address. | `files/files.controller.ts`, `app.setup.ts` | 8 |
| 25 | low | The CI workflow has no permissions block, and actions are pinned by tag. | `.github/workflows/ci.yml` | 8 |

## Order of fixes

One area per pull request, abuse tests first. Every one that touches login, money, admin or webhooks is labelled `security-review` and waits for a person's review before merging; ledger and payout changes need two reviewers.

**Before any real money moves:**

1. **Payouts and reconciliation:**
   - an atomic claim on sending, and never a refund on an unclear answer
   - idempotency keys on withdrawals and top-ups
   - suspended agents' withdrawals held
   - the transfer approval endpoint
   - instant caps per agent and for the platform
   - a reconciliation gap pausing instant withdrawals
   - a low-balance alert
   - Paystack's `otp` status

   Covers L5, L12, L13, P6, P7, P9, S6 (money) and findings 1, 4, 5, 13, 17.
2. **Ledger guards:**
   - the append-only trigger and a tighter balance check
   - freeze rules and tests
   - invariant checks after every test file
   - 50-at-once tests on every money endpoint

   Covers L1, L3, L4, L7, L10, L11 and finding 15.
3. **The errand money path:**
   - the drop-off wait before a photo
   - a locked PIN freezing the escrows for admin
   - the 200 m check
   - a per-errand PIN key, plus an HMAC for checking
   - wrong entries logged
   - item limits and the agent errand cap
   - the offer rate limit

   Covers E3, E4, X8, L7, L8 and findings 2, 6, 23.
4. **Deposits:**
   - the own-account path checks the verified channel and refuses our one-time references
   - unknown references kept for review
   - the open top-up limit made atomic
   - own-account requests using the verified legal name, rate-limited, with a generic reason

   Covers P2, P5 and findings 7, 14, 16.
5. **Rules and access:**
   - unknown body keys refused
   - unapproved agents kept out of errands
   - the board tied to the agent's last position, and the drop-off area only until accept
   - live connections: Redis adapter, dropped on suspension and sign-out, re-checked
   - CORS required in production
   - generic provider errors
   - redacted logs and stored webhook bodies
   - location sharing only while the agent travels for that customer

   Covers R1, R3, R4, R8, R10, R12, E1, C4, G2, S7 and findings 8, 11.

**Before public launch:**

6. **Identity:**
   - the legal name shown only once verified
   - limited check starts
   - hosted links that expire and are tied to the session
   - no sandbox in production
   - separate keys
   - the Smile ID result re-read
   - field encryption of personal details and payout account numbers
   - near name matches sent to review

   Covers I1–I6 and findings 3, 9, 10, 12, 19, 21, 22.
7. **Login:**
   - code limits of 3 per 15 minutes and 10 a day, per number, device and IP
   - a reused refresh token ending every session
   - an absolute session limit
   - a new device signing out others
   - SMS spend alert

   Covers A1, A2, A8, L9.
8. **Server hardening:**
   - rate limits on every route
   - security headers and CSP
   - timeouts, no blind redirects, allow-listed provider hosts
   - the live-key check
   - optional Paystack address allow-list
   - OpenAPI
   - CI scanning and a permissions block
   - `security.txt`
   - threat-model template and SDK list

   Covers R7, R11, R14, S2, S3, S5, S8–S11, P4, P11, MB6, C6 and findings 18, 20, 24, 25.
9. **Admin:**
   - verification, disputes and safety roles
   - two-person approvals and the approver-not-requester check
   - staff linked to their own app accounts
   - reset links sent to the teammate
   - 15-minute idle and 8-hour limits, with a fresh sign-in for money actions
   - an append-only audit log with the user agent, before-and-after values and reasons
   - personal details masked, with reveal-and-reason
   - passkeys for money and ID roles
   - the admin API on its own address
   - the Security settings group

   Covers D1–D7, E7, X6, X7, X10 and finding 10.
10. **Agent account security (needs a native development build):**
    - a device key and signed money requests
    - app PIN or biometric
    - new-device selfie and 48-hour hold for agents
    - selfie before going online
    - attestation
    - root, emulator and mock-location signals
    - screenshot blocking
    - device-only token storage
    - link validation

    Covers A3–A7, A9, I8, P8, MB2–MB5, X4.
11. **Operations:**
    - the drop-off photo queue
    - reminders at 2, 12 and 20 hours
    - collusion and moderation flags with a Risk queue
    - emergency button and Safety queue
    - evidence pack snapshot
    - GPS trail with fake-GPS checks and 90-day deletion
    - chat warning flags
    - upload byte checks, re-encoding and location stripping
    - face and shared-account flags
    - tier counts without flagged errands

    Covers X1–X3, E5, E6, E8, E9, C1, C3, G1, G4, I3, F3.

**After launch:** A10, C7, D8, F4, MB7, and referrals and promos (F1, F2, X5) when they are built.

## Owner's tasks

What each needs from the code is provided as noted.

- **Paystack dashboard:**
  - lock the secret key to the API's fixed addresses
  - register the transfer approval URL (fix 1 gives the address)
  - turn on 2FA for every team member, with least access
  - keep the transfer OTP setting off (finding 17)
- **Identity provider:** choose one with the I2 certification and injection testing.
- **Hosting:**
  - separate production and staging accounts, MFA, a private database
  - the WAF
  - fixed outgoing addresses
  - secrets injected from a secret store
  - KMS keys
  - backups with monthly restore tests
  - central logs kept for a year
  - a write-once copy of the audit log
  - TLS
  - zero-trust access with SSO in front of the admin panel and admin API
- **Google and Apple:** Play Integrity and App Attest setup (fix 10), and the Maps key restricted to the apps.
- **Penetration test** before launch, in the plan's scope, then yearly.
- **Legal:**
  - CBN opinion on the pooled wallet
  - Data Protection Officer
  - NDPC registration
  - the impact assessment
  - processing agreements with every provider
- **Incident plan** for NDPC and ngCERT reports within 72 hours.
- **Staff:** background checks, confidentiality agreements, same-day removal, quarterly access reviews.
- **Reviews:** a person reviews every `security-review` pull request, and two review ledger and payout changes.
