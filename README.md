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

A new agent fills in the application before seeing the board: their state and area, identity (NIN, BVN and a selfie), address and an emergency contact, a payout account, errand preferences, and the agent terms. In development the identity provider is a stand-in: a NIN ending in 1111 sends the selfie to review, 1818 is someone under 18, 0000 fails the NIN, and any other passes. With `FAKE_PAYMENTS_AUTOPAY_SECONDS` set, the fake bank also takes any account number to be in the agent's name.

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

| Area              | Routes                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in           | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-others`                                                                                                                                                                                                                                  |
| Profile           | `GET /me`, `PATCH /me`, `PUT /devices/current/push-token`                                                                                                                                                                                                                                                                                                 |
| Agent profile     | `GET /agent/profile`, `PATCH /agent/profile`: categories and purchase errands the agent takes; the tier is set by admin                                                                                                                                                                                                                                   |
| Calls             | `POST /errands/:id/call` (rings the caller's phone, then connects them to the other side of the errand)                                                                                                                                                                                                                                                   |
| Agent application | `GET /agent/application`, `PATCH /agent/application` (state and area), `POST /agent/application/identity` and `/identity/finish` (NIN, BVN and selfie through the identity provider), `PUT /agent/application/address`, `POST /agent/application/terms`, `POST /agent/application/submit`. Agents see the board, go online and accept only once approved. |
| Country config    | `GET /config/:country`: currency, states, categories and the public settings                                                                                                                                                                                                                                                                              |
| Photos            | `POST /uploads`: a signed link to upload a receipt, item, drop-off or chat photo for an errand. Events and messages accept only photos their sender uploaded for that errand.                                                                                                                                                                             |
| Ratings           | `POST /errands/:id/rating`: once each way after completion                                                                                                                                                                                                                                                                                                |
| Places            | `GET /places/autocomplete`, `GET /places/:id` (with the state it is in)                                                                                                                                                                                                                                                                                   |
| Errands           | `POST /errands/quote` (distance and suggested fee), `POST /errands`, `GET /errands`, `GET /errands/board` (agent app), `GET /errands/:id`, `GET /errands/:id/events`, `GET /errands/:id/pin` (customer, once delivered), `POST /errands/:id/events`                                                                                                       |
| Chat              | `GET /errands/:id/messages`, `POST /errands/:id/messages` (text or a photo)                                                                                                                                                                                                                                                                               |
| Wallet            | `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/deposits` and `GET /wallet/deposits/:id` (customer app), `POST /wallet/withdrawals` (agent app), `POST /errands/:id/tip`                                                                                                                                                                         |
| Payouts           | `GET /banks`, `GET /payout-account`, `PUT /payout-account` (agent app)                                                                                                                                                                                                                                                                                    |
| Webhooks          | `POST /webhooks/paystack`: signature-checked, stored, applied once                                                                                                                                                                                                                                                                                        |
| Realtime          | Socket.IO namespace `/realtime`, with the access token in `auth.token`. Emit `errand.subscribe`; receive `errand.updated` and `message.created`.                                                                                                                                                                                                          |
| Admin             | Under `/admin`, for the admin panel only: sign-in (`auth/sign-in`, `auth/setup`, `auth/code`, `auth/sign-out`, invites), `me`, `overview`, `team`, `audit`, `errands` (search and full history), `disputes` and `errands/:id/actions` (step in, redelivery, settle). Admin sessions are separate from app sessions.                                       |

Every errand change goes through one endpoint, `POST /errands/:id/events`, with an event name such as `accept`, `send_offer`, `start`, `send_item_amount`, `mark_delivered` or `confirm_pin`. Who is acting comes from the session (customer app or agent app), never from the request. Each errand view lists the `allowedEvents` for the caller, so the apps show only the actions that are possible.

### Adapters

Outside services are chosen by environment variable, one implementation per port:

| Port          | Now                                          | Variable             |
| ------------- | -------------------------------------------- | -------------------- |
| SMS codes     | Termii, or console for development           | `MESSAGING_PROVIDER` |
| Push          | Firebase Cloud Messaging, or console         | `PUSH_PROVIDER`      |
| Chat          | Built-in (Postgres and the realtime socket)  | `CHAT_PROVIDER`      |
| Errand timers | BullMQ on Redis                              | `TIMER_PROVIDER`     |
| Payments      | Paystack, or fake for development            | `PAYMENTS_PROVIDER`  |
| Maps          | Google (Places and Routes), or fake          | `MAPS_PROVIDER`      |
| Files         | S3 (private bucket, signed links), or memory | `STORAGE_PROVIDER`   |

Calls between a customer and their agent use the same pattern (`CALLS_PROVIDER`: `fake` or `none`). Jiffo's provider rings the caller's own phone and connects them to the other person, so neither sees the other's number, and the chat notes that they called. Calls aren't recorded. They work while an agent is on the errand, until it ends; in a dispute, support talks to each side. Only a fake exists until a provider's keys are in, and it never runs in production.

Identity checks for agents use the same pattern (`IDENTITY_PROVIDER`: `fake` or `none`). Only a fake provider exists until the real one's keys and SDK are set up; in production the fake is never used, so no agent can be approved without a real check, and with `none` agents can't send applications.

With the fake payment provider, set `FAKE_PAYMENTS_AUTOPAY_SECONDS` to have top-ups land by themselves, so the apps can be tried end to end without moving money. The fake maps provider knows a handful of Lagos places (search for Shoprite, Medplus, Circle Mall, Admiralty Way, Adeola Odeku or Ikeja).

### Money

Every balance lives in a double-entry ledger (`ledger_accounts`, `journal_entries`, `postings`) in whole kobo. Each movement debits one account and credits another, every journal sums to zero, and each one has a unique key so it can never be applied twice. Balances that belong to people (wallets, earnings, escrows) can't go below zero.

- **Top-ups:** the customer asks for an amount and gets a one-time account number from Paystack. The wallet is credited with what actually arrived, only after Paystack confirms it, from the webhook or when the app checks the top-up.
- **Escrow:** the fee and service fee are held when an agent accepts, adjusted when a new price is accepted, and returned if the agent leaves or the errand is cancelled. Item money is held separately when the customer locks the item amount.
- **Hand-off:** item money goes to the agent untouched and withdrawable at once. The fee, less the commission for the agent's tier (set by admin), goes to the agent; Bronze earnings are held for 24 hours. The service fee and commission go to platform revenue.
- **Withdrawals:** agents only, to an account in their own name. One free scheduled withdrawal a day, or instant for a fee. A bounced transfer puts the full amount back.
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

- **Overview:** today's errands, agents online, revenue, top-ups and the fees Jiffo absorbs, withdrawals, and anything that needs attention.
- **Errands and disputes:** search every errand, read its full history (timeline, chat, photos, money), and settle disputes, the standard way or by splitting the money held.
- **People:** customers and agents, with their activity and money; set agent tiers, suspend and reactivate accounts, and adjust balances.
- **Applications:** agent applications by state. The ones whose checks didn't all pass wait in review, longest first; operations approves or declines each from the agent's page, seeing the provider's results and what the agent typed, never their documents. A decline's reason is shown to the agent.
- **Money:** what Jiffo holds and earns, top-ups, withdrawals and the nightly check against the payment provider.
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
