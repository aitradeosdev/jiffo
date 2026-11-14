# Jiffo

Jiffo is an errand marketplace for Nigeria. Customers post an errand (groceries, parcels, pharmacy runs, queues and more), a verified agent nearby accepts it, and the money is held in escrow until hand-off. The customer releases it with a PIN or by approving a drop-off photo.

The product is built from day one with adapters, so new countries, states and outside providers (payments, identity checks, maps, chat, calls, SMS, push, storage) plug in without changing the core.

## What's here

| Path                     | Contents                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/`           | The Customer and Agent apps (Expo, React Native). One codebase builds both store apps; see below.                                                                                                                                 |
| `apps/admin/`            | The admin panel (Next.js) for Jiffo staff. See below.                                                                                                                                                                             |
| `apps/api/`              | The backend (NestJS). Accounts and phone sign-in, country settings, the errand lifecycle, chat, push and the realtime socket. See below.                                                                                          |
| `packages/shared/`       | Code the backend and the apps share: the errand state machine, money in kobo, the country settings schema and ID types.                                                                                                           |
| `docs/prototypes/`       | Clickable HTML prototypes of the customer app (`customer.html`) and the agent app (`agent.html`). Open either file in a browser. The panel beside the phone jumps to every screen and lets you play the other side of the errand. |
| `docs/prototypes/src/`   | The prototype source files and build scripts. Run `sh build.sh` and `sh build-agent.sh` from this folder to rebuild the two HTML files.                                                                                           |
| `docs/prototype-sheets/` | One overview image per app, showing every prototype screen, numbered and labelled.                                                                                                                                                |
| `brand/`                 | The Jiffo logo set: wordmark, app icons and the small j mark as SVG, plus PNG exports. See `brand/README.md`.                                                                                                                     |

## Agreed build stack

- **Apps:** React Native with Expo (TypeScript). One codebase, two store apps: Jiffo (customers) and Jiffo Agent.
- **Admin panel:** Next.js (TypeScript).
- **Backend:** Node.js with NestJS, one deployable app split into modules.
- **Data:** PostgreSQL with PostGIS; Redis with BullMQ for live locations, rate limits and timers.
- **Real-time:** WebSockets (Socket.IO over Redis) and Firebase Cloud Messaging.
- **Files:** S3 private storage with signed links.
- **Hosting:** AWS Cape Town (af-south-1), pending legal confirmation for data residency.

Money is kept in a double-entry ledger in whole kobo, with idempotent webhooks and daily reconciliation against the payment provider.

## Running the apps

`apps/mobile` builds both store apps from one codebase. `APP_VARIANT` picks which one: `customer` (Jiffo, the default) or `agent` (Jiffo Agent). Each has its own name, icon, bundle identifier and screens.

With the backend running locally:

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your computer's LAN address>:3000 pnpm start
```

Open it in Expo Go, or press `w` for the web version. The web version draws a stand-in map; phones show real maps (Apple Maps on iOS, Google Maps on Android). Android builds need `GOOGLE_MAPS_ANDROID_API_KEY` set to a key with the Maps SDK for Android enabled. Use `pnpm start:agent` for the agent app. Switching between the two needs the bundler cache cleared, which both scripts do.

A new customer checks their ID right after giving their name: their NIN or BVN and a selfie, once, with the identity provider in use; they can look around first, and adding money and requesting errands open once they are verified. A new agent fills in the application before seeing the board: their state and area, identity (one of the IDs admin accepts for agents, their BVN when required, and a selfie), address and an emergency contact, a payout account, errand preferences, and the agent terms. In development the identity provider is a stand-in: an ID number ending in 1111 sends the selfie to review, 1818 is someone under 18, 0000 fails the ID, and any other passes. With `FAKE_PAYMENTS_AUTOPAY_SECONDS` set, the fake bank also takes any account number to be in the agent's name.

While an agent is online or on an errand, the agent app keeps sending their location when they switch to their maps app or lock the phone, if they chose "Allow all the time" (the app explains why before the phone asks). On Android a notification shows while it does. It stops when they go offline with nothing running. This needs a development or store build; Expo Go and the web version send the location only while the app is open.

`pnpm --filter @jiffo/mobile export:web` builds both apps for the web, the same way CI does.

## Running the backend

You need Node 22, pnpm 10 and Docker.

```bash
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
```

Fill in `JWT_SECRET`, `OTP_SECRET` and `PIN_KEY` in `apps/api/.env` (`openssl rand -hex 32` for each), then:

```bash
pnpm build
cd apps/api && set -a && . ./.env && set +a && pnpm start
```

The API listens on port 3000. `RUN_MIGRATIONS=true` applies the database migrations at start-up, including the Nigeria seed: 37 states, 8 categories and the first settings version. With the console providers, sign-in codes and push notifications are printed to the log instead of being sent.

Tests run against real Postgres and Redis. Each run creates a throwaway database and drops it at the end:

```bash
pnpm test
```

Before opening a pull request, also run `pnpm lint`, `pnpm format:check` and `pnpm typecheck`. CI runs the same checks.

After changing `apps/api/src/db/schema.ts`, run `pnpm --filter @jiffo/api db:generate` and commit the new migration.

### API outline

All routes are under `/v1` except `GET /health`. Errors always look like `{ "error": { "code": "...", "message": "..." } }`.

| Area              | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in           | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-others`                                                                                                                                                                                                                                                                                                                                               |
| Profile           | `GET /me`, `PATCH /me`, `PUT /devices/current/push-token`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Agent profile     | `GET /agent/profile`, `PATCH /agent/profile`: categories and purchase errands the agent takes; the tier is set by admin                                                                                                                                                                                                                                                                                                                                                |
| Calls             | `POST /errands/:id/call` (rings the caller's phone, then connects them to the other side of the errand)                                                                                                                                                                                                                                                                                                                                                                |
| Agent presence    | `GET /agent/presence`, `PUT /agent/presence` (`online` and the position; the position alone, from the background, keeps online as it was)                                                                                                                                                                                                                                                                                                                              |
| Agent application | `GET /agent/application`, `PATCH /agent/application` (state and area), `POST /agent/application/identity` and `/identity/finish` (the chosen ID, the BVN when required, and a selfie, through the identity provider or its own page, whose result arrives at `POST /webhooks/identity/:provider`), `PUT /agent/application/address`, `POST /agent/application/terms`, `POST /agent/application/submit`. Agents see the board, go online and accept only once approved. |
| Customer identity | `GET /me/identity` (status, and the IDs the customer can use), `POST /me/identity` (start with the chosen ID), `POST /me/identity/finish`. Top-ups and errand requests need a verified customer.                                                                                                                                                                                                                                                                       |
| Country config    | `GET /config/:country`: currency, states, categories and the public settings                                                                                                                                                                                                                                                                                                                                                                                           |
| Photos            | `POST /uploads`: a signed link to upload a receipt, item, drop-off or chat photo for an errand. Events and messages accept only photos their sender uploaded for that errand.                                                                                                                                                                                                                                                                                          |
| Ratings           | `POST /errands/:id/rating`: once each way after completion                                                                                                                                                                                                                                                                                                                                                                                                             |
| Places            | `GET /places/autocomplete`, `GET /places/:id` (with the state it is in)                                                                                                                                                                                                                                                                                                                                                                                                |
| Errands           | `POST /errands/quote` (distance and suggested fee), `POST /errands`, `GET /errands`, `GET /errands/board` (agent app), `GET /errands/:id`, `GET /errands/:id/events`, `GET /errands/:id/pin` (customer, once delivered), `POST /errands/:id/events`                                                                                                                                                                                                                    |
| Chat              | `GET /errands/:id/messages`, `POST /errands/:id/messages` (text or a photo)                                                                                                                                                                                                                                                                                                                                                                                            |
| Wallet            | `GET /wallet`, `GET /wallet/transactions`, `GET /wallet/top-up` (the ways to add money on offer, and the customer's own account number), `POST /wallet/fixed-account`, `POST /wallet/deposits` and `GET /wallet/deposits/:id` (customer app), `GET /banks`, `POST /wallet/withdrawals` (agent app), `POST /errands/:id/tip`                                                                                                                                            |
| Payouts           | `GET /banks`, `GET /payout-account`, `PUT /payout-account` (agent app)                                                                                                                                                                                                                                                                                                                                                                                                 |
| Webhooks          | `POST /webhooks/paystack`: signature-checked, stored, applied once                                                                                                                                                                                                                                                                                                                                                                                                     |
| Realtime          | Socket.IO namespace `/realtime`, with the access token in `auth.token`. Emit `errand.subscribe`; receive `errand.updated` and `message.created`.                                                                                                                                                                                                                                                                                                                       |
| Admin             | Under `/admin`, for the admin panel only: sign-in (`auth/sign-in`, `auth/setup`, `auth/code`, `auth/sign-out`, invites), `me`, `overview`, `team`, `audit`, `errands` (search and full history), `disputes` and `errands/:id/actions` (step in, redelivery, settle). Admin sessions are separate from app sessions.                                                                                                                                                    |

Every errand change goes through one endpoint, `POST /errands/:id/events`, with an event name such as `accept`, `send_offer`, `start`, `send_item_amount`, `mark_delivered` or `confirm_pin`. Who is acting comes from the session (customer app or agent app), never from the request. Each errand view lists the `allowedEvents` for the caller, so the apps show only the actions that are possible.

### Adapters and providers

Each outside service is a port with one adapter per provider. **Owners choose the provider in the admin panel** (Settings, Providers): they enter the keys from Jiffo's account with it, test them, and switch it on. The change reaches every API process within 30 seconds, with no restart. Keys are stored encrypted (AES-256-GCM) under `SECRETS_KEY`, a 64-character hex key that production requires and that should be kept apart from the database: whoever has both can read the keys, and changing it means entering them again. The panel never shows a saved key, only its last characters, and the audit log records which fields changed, never their values. A provider can be switched on only after its test passes. Things a provider started finish with it after a switch: a top-up is checked with the provider that issued its account number, an identity check finishes where it began, and a payout goes through the provider in use, which registers the agent's bank account first if it was added under another one. The nightly money check adds up every provider still holding money.

Webhook addresses are shown in the panel, built from `PUBLIC_API_URL`, which must be the API's public address in production.

| Service         | Providers in the panel         |
| --------------- | ------------------------------ |
| SMS codes       | Termii, Africa's Talking       |
| Payments        | Paystack, Flutterwave          |
| Identity checks | Smile ID, Dojah, Youverify     |
| Calls           | Africa's Talking, Twilio       |
| Push            | Firebase Cloud Messaging       |
| Maps            | Google Maps Platform           |
| Files           | S3, or any S3-compatible store |

While no provider is switched on for a service, the environment's choice below is used. In development and tests that is a stand-in (console SMS, a fake bank, and so on); in production a stand-in is never used, and a service set in neither place answers that it isn't set up yet.

| Port          | Now                                          | Variable             |
| ------------- | -------------------------------------------- | -------------------- |
| SMS codes     | Termii, or console for development           | `MESSAGING_PROVIDER` |
| Push          | Firebase Cloud Messaging, or console         | `PUSH_PROVIDER`      |
| Chat          | Built-in (Postgres and the realtime socket)  | `CHAT_PROVIDER`      |
| Errand timers | BullMQ on Redis                              | `TIMER_PROVIDER`     |
| Payments      | Paystack, or fake for development            | `PAYMENTS_PROVIDER`  |
| Maps          | Google (Places and Routes), or fake          | `MAPS_PROVIDER`      |
| Files         | S3 (private bucket, signed links), or memory | `STORAGE_PROVIDER`   |

Calls between a customer and their agent use the same pattern (`CALLS_PROVIDER`: `fake` or `none`). Jiffo's provider rings the caller's own phone and connects them to the other person, so neither sees the other's number, and the chat notes that they called. Calls aren't recorded. They work while an agent is on the errand, until it ends; in a dispute, support talks to each side. In the panel the provider is Africa's Talking or Twilio; the fake never runs in production.

Identity checks, for customers and agents alike, use the same pattern (`IDENTITY_PROVIDER`: `fake` or `none`; Smile ID, Dojah or Youverify in the panel). Each person verifies with one ID, and a selfie matched to the ID's photo. Customers give their NIN or BVN (a number the issuer looks up) and take the selfie once; no document is photographed. Agents may also use an ID document (driver's licence, voter's card, passport). Admin chooses in the settings which IDs each side may use, and the apps offer those the provider in use checks. Smile ID checks all five; Dojah the NIN, BVN, driver's licence and passport, with the steps set up in its dashboard (a separate flow for customers, with only the NIN or BVN and the selfie); Youverify the NIN and driver's licence. When agents must also give their BVN, it is checked alongside their ID (by Dojah and Youverify) or, with Smile ID, which can't, it is their ID. Customers verify when they sign up, and can add money and request errands once verified; one account per ID for each side, and customers must be 18 or older.

With Smile ID, Dojah or Youverify the app opens a web page that asks for the ID and takes the selfie, so the selfie never passes through Jiffo: Smile ID's page is a single-use Smile Link for the chosen ID, and Dojah's widget and Youverify's liveness check run on a page the API serves at an address it signed. Youverify's page sends the numbers and its liveness session to `POST /v1/identity/hosted/youverify/submit`; the API asks Youverify for that session's result and passes Youverify's own link to the selfie into its ID check with face match. The provider sends the result to `POST /v1/webhooks/identity/:provider`, signed with a key saved in the panel; Smile ID's signature doesn't cover the result, so its verdict is also confirmed with Smile ID's status API. The result settles the check at once, which keeps only the outcome of each check, the legal name, the date of birth and a keyed fingerprint of the ID (to catch a second account on it), never the payload, the number or the selfie. Dojah also visits agents' addresses; with Smile ID or Youverify the team confirms addresses at review (Youverify's visits need the address in parts the app doesn't ask for yet). In production the fake is never used, so nobody is verified without a real check, and with `none` nobody can be.

With the fake payment provider, set `FAKE_PAYMENTS_AUTOPAY_SECONDS` to have top-ups land by themselves, so the apps can be tried end to end without moving money. The fake maps provider knows a handful of Lagos places (search for Shoprite, Medplus, Circle Mall, Admiralty Way, Adeola Odeku or Ikeja).

### Money

Every balance lives in a double-entry ledger (`ledger_accounts`, `journal_entries`, `postings`) in whole kobo. Each movement debits one account and credits another, every journal sums to zero, and each one has a unique key so it can never be applied twice. Balances that belong to people (wallets, earnings, escrows) can't go below zero.

- **Top-ups:** admin chooses the ways on offer under Settings, Adding money. With a one-time account number, the customer asks for an amount and gets an account number for that transfer. With their own account number, issued once by the payments provider after the customer gives their BVN (Paystack also checks a bank account in their name first), any transfer into it lands in their wallet, whatever the amount. Either way the wallet is credited with what actually arrived, only after the provider confirms it, from the webhook or when the app checks. The BVN and bank account go to the provider and are not kept.
- **What it costs:** every provider charge is booked to the ledger as it happens: the fee on each top-up (Jiffo pays it, not the customer), the fee on each transfer out, and the fee for issuing an own account number, which is entered on the provider in the panel because providers don't report it per account. The overview and Money pages show revenue, those costs, and net revenue, the difference.
- **Escrow:** the fee and service fee are held when an agent accepts, adjusted when a new price is accepted, and returned if the agent leaves or the errand is cancelled. Item money is held separately when the customer locks the item amount.
- **Hand-off:** item money goes to the agent untouched and withdrawable at once. The fee, less the commission for the agent's tier (set by admin), goes to the agent; Bronze earnings are held for 24 hours. The service fee and commission go to platform revenue.
- **Access rules:**
  - **Request bodies:** a field an endpoint doesn't take is refused at any depth, event data included, not quietly dropped. Provider callbacks opt out with `.passthrough()`.
  - **Waiting errands:**
    - Only approved agents see them.
    - Until an agent accepts, each stop shows only its general area and a point rounded to about a kilometre: no street, house number or label.
    - The event list never names the agents who took or left an errand.
  - **The board:**
    - It searches around the agent's own last position, reported within the set minutes (default 5, Settings, Security).
    - The place the app asks about must be within the set distance of that position (default 5 km, Settings, Security).
    - Phones report their own position, so this limits what a scraper sees but can't prove where a phone is.
  - **Agent's position:** the customer sees it only while the agent is on the way for them, up to the drop-off. An agent holding a second errand they haven't started isn't followed by that customer.
  - **Live connections:**
    - Rooms go through Redis, so sign-out and suspension drop sockets on every server at once.
    - Each server also re-checks its own sockets every 30 seconds, as a safety net.
    - CORS_ORIGINS must list the allowed origins in production. It is checked on every socket connection, WebSocket included, as well as on HTTP.
  - **Provider details and logs:**
    - The apps never get the provider's wording for a failure.
    - Chat pushes never quote the message.
    - Stored webhook bodies have account numbers, phone numbers, emails and names masked.
    - Every log line passes through the same masking. Production logs are JSON.
- **Identity checks:**
  - **The name on an ID:**
    - Kept only for a check that didn't fail, so a failed selfie can't turn a check into a way to look up whose ID a number is.
    - Shown to the person only once they are verified, or for agents approved.
  - **Starting checks:** each account may start a set number a day (default 3, Settings, Identity), whatever the results, since each is a paid check.
  - **Pages Jiffo serves for a provider:**
    - Links expire after an hour.
    - They work only while the app session that started the check is signed in.
    - They work only in the browser that first opened them, so a forwarded link doesn't open.
    - Opens are limited per check each hour, counted across all servers.
  - **Smile ID:** its callback signature covers only a timestamp. The verdict is re-read from Smile ID, and a signature is accepted with one body only, so it can't be replayed with another.
  - **Sandbox mode:** refused for identity providers in production.
  - **Approving an agent:** never takes an ID away from another account that proved it with its own checks.
- **Keys and personal details:**
  - **One key per job:**
    - `ID_FINGERPRINT_KEY` fingerprints ID numbers.
    - `ADMIN_TOTP_KEY` encrypts admin authenticator secrets.
    - `FIELD_KEY` encrypts personal details.
    - `ADMIN_TOKEN_SECRET` signs admin sign-in steps.
    - Production requires each, all different from each other and from the other secrets. In development they are derived from `PIN_KEY`.
    - A deployment that already has data sets the first three to what `pnpm admin derived-keys` prints, so its fingerprints, authenticators and personal details stay readable. A new deployment generates fresh ones.
  - **Encrypted at rest:**
    - What's encrypted: legal names, dates of birth, agents' home addresses and emergency contacts, and payout accounts (number, name and the provider's recipient code, which can carry the number).
    - The database holds only AES-256-GCM ciphertext, bound to its table and column. The API reads and writes plain text.
    - Rows saved before this are encrypted in the background when a server starts.
  - **Searching by legal name:** support finds people by any whole word of their legal name, through a keyed index. Partial words still match the name in the app.
  - **Payout account numbers:** their last four digits are kept readable for lists.
- **Payout accounts:**
  - **Match:** every word of the bank's name for the account must be in the legal name on the ID record. Otherwise the account is refused.
  - **Near match:** when the bank's name is close but not the same (an initial, or a slip of a letter), the account waits for finance to approve or decline it, on the Withdrawals tab. Withdrawals keep going to the approved account meanwhile.
  - **Changes:** every change is checked the same way, and the agent gets a push whenever their account changes, so a change they didn't make doesn't go unnoticed.
- **Protecting the hand-off:**
  - **At the drop-off:** marking an errand delivered and entering the PIN need the agent's fresh position within the set distance of the drop-off (default 200 m, Settings, Security).
  - **Wait before a photo:** a drop-off photo is accepted only after the agent has waited the set minutes there, and only while they are still there.
  - **Current settings:** these limits follow the current settings, also for errands made before a change.
  - **Last wrong PIN:** freezes the errand for support. Nothing is paid or given back by itself, and each wrong entry is on the errand's record, without the digits.
  - **PIN storage:** each PIN is encrypted under its errand's own key and checked by a keyed hash. It is cleared when the errand ends.
  - **Limits:** item money is capped for new agents and new customers. Counter-offers are limited per minute, and admin can cap how many errands one agent holds at once.
- **Withdrawals:** agents only, to an account in their own name. One free scheduled withdrawal a day, or instant for a fee. A bounced transfer puts the full amount back.
  - **Repeats:** each request carries the app's key, so a repeated tap or a retry makes one withdrawal.
  - **Sending:** one run at a time claims a withdrawal before sending it. Only a first try that the provider refuses outright gives the money back. An unclear answer after that raises an alert instead.
  - **Suspension:** a suspended agent's withdrawals wait until they are reactivated.
  - **Daily caps (Settings, Security):** instant withdrawals are capped per agent and for all agents together.
  - **Paystack's transfer approval URL:** `POST /v1/webhooks/paystack/transfer-approval`, registered in the Paystack dashboard. It approves only a withdrawal Jiffo is sending, for its exact amount and the agent's recipient.
- **Nightly check:**
  - **Shortfalls:** if the provider holds less than the ledger beyond the tolerance in Settings, Security, instant withdrawals pause until finance clears the check, with a note, under Money, Nightly checks.
  - **Low balance:** checked every 15 minutes.
  - **Alerts:** gaps, a low balance, refused or unclear transfers and Paystack's transfer OTP show there and on the overview.
- **Reconciliation:** every night the ledger's cash is compared with the Paystack balance and the result is saved for finance.

## Running the admin panel

`apps/admin` is the panel Jiffo staff use. Its server calls the API on each admin's behalf, so the session token stays in an httpOnly cookie and never reaches the browser's scripts.

```bash
cd apps/admin
cp .env.example .env.local
pnpm dev
```

It opens on port 3001. Set `ADMIN_PANEL_SECRET` to the same value in both `apps/api/.env` and `apps/admin/.env.local`, so the API sees each admin's own IP address for sign-in limits and the audit log.

Admins join by invite only. Make the first owner from the API's folder, with the API's environment loaded:

```bash
pnpm admin invite --email you@jiffoapp.com --name "Your Name" --role owner
```

Open the printed link to choose a password. The first sign-in sets up an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), and every sign-in after that needs its code. Owners invite everyone else from the Team page. If the only owner loses their phone, `pnpm admin reset --email ...` prints a new link.

What's in it:

- **Overview:** today's errands, agents online, net revenue (revenue less payment provider costs), top-ups and the fees Jiffo absorbs, withdrawals, and anything that needs attention.
- **Errands and disputes:** search every errand, read its full history (timeline, chat, photos, money), and settle disputes, the standard way or by splitting the money held.
- **People:** customers and agents, with their activity and money; set agent tiers, suspend and reactivate accounts, and adjust balances.
- **Applications:** agent applications by state. The ones whose checks didn't all pass wait in review, longest first; operations approves or declines each from the agent's page, seeing the provider's results and what the agent typed, never their documents. A decline's reason is shown to the agent.
- **ID checks:** customers' ID checks by state. Those the provider couldn't settle wait in review, longest first; operations verifies or declines each from the customer's page (never with an ID another customer holds), or reopens a declined one so they can check again. The decline's reason is shown to the customer. The providers page says which IDs each identity provider checks.
- **Money:** what Jiffo holds, earns and pays providers (net revenue), top-ups by way of paying in, customers' own account numbers and what issuing them cost, withdrawals and the nightly check against the payment provider.
- **Settings:** prices, fees, commission, timers, limits and identity rules as versioned settings, plus categories and states.
- **Team and audit log:** who can use the panel, and every change anyone made in it.

| Role       | Can                                                    |
| ---------- | ------------------------------------------------------ |
| Owner      | Everything, including the team, settings and audit log |
| Operations | Errands, disputes, people and agent applications       |
| Finance    | Money: refunds, wallet adjustments and payouts         |
| Support    | Look at everything, change nothing                     |

Support settles a dispute as complete or cancelled, the standard way or by splitting the money held: the fee between the agent, Jiffo and the customer, the item money between the agent and the customer, and, when the customer never locked the item amount, up to that amount from their wallet for the agent. Every action needs a reason, which stays in the timeline and the audit log and is never shown to the customer or agent.

Sessions end after 30 minutes without activity, or 12 hours after sign-in. Five wrong passwords for one email from one network, or five wrong codes for one admin, pause sign-in for 15 minutes; a reset lifts the pause. Every change an admin makes is written to the audit log.

In production the panel must sit behind a load balancer (`TRUST_PROXY_HOPS` of at least 1), and the API needs `ADMIN_URL` set to the panel's address for invite links.
