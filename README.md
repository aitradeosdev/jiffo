# Jiffo

Jiffo is an errand marketplace for Nigeria. Customers post an errand (groceries, parcels, pharmacy runs, queues and more), a verified agent nearby accepts it, and the money is held in escrow until hand-off. The customer releases it with a PIN or by approving a drop-off photo.

The product is built from day one with adapters, so new countries, states and outside providers (payments, identity checks, maps, chat, calls, SMS, push, storage) plug in without changing the core.

## What's here

| Path | Contents |
| --- | --- |
| `docs/prototypes/` | Clickable HTML prototypes of the customer app (`customer.html`) and the agent app (`agent.html`). Open either file in a browser. The panel beside the phone jumps to every screen and lets you play the other side of the errand. |
| `docs/prototypes/src/` | The prototype source files and build scripts. Run `sh build.sh` and `sh build-agent.sh` from this folder to rebuild the two HTML files. |
| `docs/prototype-sheets/` | One overview image per app, showing every prototype screen, numbered and labelled. |
| `brand/` | The Jiffo logo set: wordmark, app icons and the small j mark as SVG, plus PNG exports. See `brand/README.md`. |

## Agreed build stack

- **Apps:** React Native with Expo (TypeScript). One codebase, two store apps: Jiffo (customers) and Jiffo Agent.
- **Admin panel:** Next.js (TypeScript).
- **Backend:** Node.js with NestJS, one deployable app split into modules.
- **Data:** PostgreSQL with PostGIS; Redis with BullMQ for live locations, rate limits and timers.
- **Real-time:** WebSockets (Socket.IO over Redis) and Firebase Cloud Messaging.
- **Files:** S3 private storage with signed links.
- **Hosting:** AWS Cape Town (af-south-1), pending legal confirmation for data residency.

Money is kept in a double-entry ledger in whole kobo, with idempotent webhooks and daily reconciliation against the payment provider.
