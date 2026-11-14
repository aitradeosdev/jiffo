# Third-party code in the apps

Jiffo uses only a few vetted SDKs (docs/security-plan.md, MB6). This is the full list of what each app ships.
A pull request that adds to it says why here. Test and build tools aren't listed; they don't ship.

Providers (payments, SMS, identity, calls, maps, push, Resend and Postmark email) are reached with plain HTTPS calls from the API
(`apps/api/src/adapters`), not through their SDKs. Their keys stay on the server, calls time out, redirects
aren't followed, and only their own hosts are allowed.

## Mobile apps (`apps/mobile`)

| Package | What it's for | What it can reach |
| --- | --- | --- |
| `expo`, `expo-router`, `@expo/metro-runtime`, `expo-constants`, `expo-status-bar`, `expo-splash-screen`, `expo-font`, `@expo-google-fonts/figtree` | The app itself: screens, navigation, start-up, fonts | Nothing beyond the app |
| `react`, `react-native`, `react-native-screens`, `react-native-safe-area-context`, `react-native-svg`, `react-dom`, `react-native-web` | Drawing the screens | Nothing beyond the app |
| `expo-secure-store` | Keeping the sign-in tokens in the phone's keychain or keystore | The keychain |
| `expo-crypto` | The random key that names this install as a device | Nothing beyond the app |
| `expo-device` | The phone's model, for the list of signed-in devices, and whether it's a real phone before asking for push | Device model |
| `expo-location`, `expo-task-manager` | An agent's live location while on a job, and the customer's own location when they choose it | Location, with the person's permission |
| `react-native-maps` | Maps for errands and live tracking | The platform's map service |
| `expo-image-picker` | Photos in chat, receipts, proof of delivery and selfies | Camera and photos, with permission |
| `expo-notifications` | Push notifications | The platform's push service |
| `expo-web-browser`, `expo-linking` | Opening an identity provider's page and coming back to the app | The browser |
| `expo-clipboard` | Copying an account number for a top-up | The clipboard, when the person taps copy |
| `socket.io-client` | Live errand updates and chat | The Jiffo API only |
| `@jiffo/shared` | Jiffo's own shared rules and types | — |

## Admin panel (`apps/admin`)

| Package | What it's for |
| --- | --- |
| `next`, `react`, `react-dom`, `server-only` | The panel itself. Pages are drawn on the panel's server; the browser gets no API keys. |
| `qrcode` | The QR code shown when an admin sets up their authenticator app. Drawn on the server. |
| `@fontsource-variable/figtree` | The font, served from the panel itself |
| `@jiffo/shared` | Jiffo's own shared rules and types |

## API (`apps/api`)

| Package | What it's for |
| --- | --- |
| `@nestjs/*`, `reflect-metadata`, `rxjs` | The web framework |
| `socket.io`, `@socket.io/redis-adapter` | Live connections, shared between servers through Redis |
| `pg`, `drizzle-orm` | The database |
| `ioredis`, `bullmq` | Redis: rate limits, timers and background jobs |
| `jose` | Signing and checking tokens |
| `zod` | Checking every request body |
| `libphonenumber-js` | Reading and checking phone numbers |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | Photo storage, with links that expire |
| `@aws-sdk/client-sesv2` | Admin team emails through Amazon SES, when that's the email provider chosen in the panel |
| `@jiffo/shared` | Jiffo's own shared rules and types |

## Scripts loaded from providers

The identity pages the API serves load one provider script each, and only scripts with that response's nonce can
run (`common/security-headers.ts`).

| Script | Checked how |
| --- | --- |
| `https://unpkg.com/youverify-liveness-web@1.2.3/…` (Youverify liveness) | Pinned version and an integrity hash |
| `https://widget.dojah.io/widget.js` (Dojah) | Served from Dojah's own host. Dojah updates it in place and publishes no hash, so it can't be pinned. |
