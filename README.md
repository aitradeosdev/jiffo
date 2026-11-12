# Jiffo

Jiffo is an errand marketplace for Nigeria. Customers post an errand (groceries, parcels, pharmacy runs, queues and more), a verified agent nearby accepts it, and the money is held in escrow until hand-off. The customer releases it with a PIN or by approving a drop-off photo.

The product is built from day one with adapters, so new countries, states and outside providers (payments, identity checks, maps, chat, calls, SMS, push, storage) plug in without changing the core.

## What's here

| Path                     | Contents                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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

| Area           | Routes                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in        | `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-others`                                                                        |
| Profile        | `GET /me`, `PATCH /me`, `PUT /devices/current/push-token`                                                                                                                                       |
| Country config | `GET /config/:country`: currency, states, categories and the public settings                                                                                                                    |
| Errands        | `POST /errands`, `GET /errands`, `GET /errands/board` (agent app), `GET /errands/:id`, `GET /errands/:id/events`, `GET /errands/:id/pin` (customer, once delivered), `POST /errands/:id/events` |
| Chat           | `GET /errands/:id/messages`, `POST /errands/:id/messages`                                                                                                                                       |
| Realtime       | Socket.IO namespace `/realtime`, with the access token in `auth.token`. Emit `errand.subscribe`; receive `errand.updated` and `message.created`.                                                |

Every errand change goes through one endpoint, `POST /errands/:id/events`, with an event name such as `accept`, `send_offer`, `start`, `send_item_amount`, `mark_delivered` or `confirm_pin`. Who is acting comes from the session (customer app or agent app), never from the request. Each errand view lists the `allowedEvents` for the caller, so the apps show only the actions that are possible.

### Adapters

Outside services are chosen by environment variable, one implementation per port:

| Port          | Now                                         | Variable             |
| ------------- | ------------------------------------------- | -------------------- |
| SMS codes     | Termii, or console for development          | `MESSAGING_PROVIDER` |
| Push          | Firebase Cloud Messaging, or console        | `PUSH_PROVIDER`      |
| Chat          | Built-in (Postgres and the realtime socket) | `CHAT_PROVIDER`      |
| Errand timers | BullMQ on Redis                             | `TIMER_PROVIDER`     |

Payments, identity checks, voice calls, maps and storage arrive in later steps on the same pattern.
