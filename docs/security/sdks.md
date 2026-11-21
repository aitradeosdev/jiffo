# Third-party code in the apps

Jiffo uses only a few vetted SDKs (docs/security-plan.md, MB6). This is the full list of what each app ships.
A pull request that adds to it says why here. Test and build tools aren't listed; they don't ship.

Providers (payments, SMS, identity, calls, maps, push, Resend and Postmark email) are reached with plain HTTPS calls from the API
(`apps/api/src/adapters`), not through their SDKs. Their keys stay on the server, calls time out, redirects
aren't followed, and only their own hosts are allowed.

The one exception is Smile ID's SDK in the agent app, for selfie checks (docs/security-plan.md, I2, I8). A selfie
with liveness has to be taken in the provider's own native code, not a web view. The app never holds Smile ID's
API key. For each check, the server gives it a token Smile ID issued for that agent's enrolled face and
SmartSelfie Authentication only, valid 15 minutes. The verdict goes from Smile ID to the server. Both store
builds link the SDK, since its native modules can't yet be left out of the customer build; only the agent app
uses it.

## Mobile apps (`apps/mobile`)

| Package | What it's for | What it can reach |
| --- | --- | --- |
| `expo`, `expo-router`, `@expo/metro-runtime`, `expo-constants`, `expo-status-bar`, `expo-splash-screen`, `expo-font`, `@expo-google-fonts/figtree` | The app itself: screens, navigation, start-up, fonts | Nothing beyond the app |
| `react`, `react-native`, `react-native-screens`, `react-native-safe-area-context`, `react-native-svg`, `react-dom`, `react-native-web` | Drawing the screens | Nothing beyond the app |
| `expo-screen-capture` | Blocking screenshots and screen recording on the PIN, wallet, ID and selfie screens (A9) | Nothing beyond the app |
| `expo-secure-store` | Keeping the sign-in tokens in the phone's keychain or keystore, and the agent's app PIN behind their fingerprint or face when they turn that on | The keychain, Face ID or fingerprint |
| `expo-crypto` | The random key that names this install as a device, and the hash of a signed money request's body | Nothing beyond the app |
| `modules/app-attest` (Jiffo's own), with Google's `com.google.android.play:integrity` on Android and Apple's DeviceCheck framework on iOS | App checks (MB3): a Play Integrity token or an App Attest assertion over each checked request, for the server to verify | Google Play services or Apple's App Attest service |
| `modules/device-key` (Jiffo's own) | The agent app's signing key in the Secure Enclave or Android Keystore, for money requests (A3). No third party | The secure hardware |
| `expo-dev-client` | Development builds only, to try the native key before a store build; the store builds don't include its launcher | Nothing beyond the app |
| `expo-device` | The phone's model, for the list of signed-in devices, and whether it's a real phone before asking for push | Device model |
| `expo-location`, `expo-task-manager` | An agent's live location while on a job, and the customer's own location when they choose it | Location, with the person's permission |
| `react-native-maps` | Maps for errands and live tracking | The platform's map service |
| `expo-image-picker` | Photos in chat, receipts, proof of delivery and selfies | Camera and photos, with permission |
| `expo-image-manipulator` | Saving each photo as a JPEG no larger than the server keeps, before it is sent (C1). Smile ID's SDK needs it too | The photo being sent |
| `expo-notifications` | Push notifications | The platform's push service |
| `expo-web-browser`, `expo-linking` | Opening an identity provider's page and coming back to the app | The browser |
| `expo-clipboard` | Copying an account number for a top-up | The clipboard, when the person taps copy |
| `socket.io-client` | Live errand updates and chat | The Jiffo API only |
| `@jiffo/shared` | Jiffo's own shared rules and types | — |
| `@smileid/usesmileid` 12.3.0 (with its `@smileid/*` bridge, kamera camera engine and platform interface) | The agent's selfie check against the face Smile ID kept from their ID check (A4, I2, I8, P8, X4): Smile ID's own screens, camera and liveness. Crash reporting to Smile ID is off | The camera, with permission. Smile ID's API, with a token for that check alone. It sends Smile ID the selfie, liveness frames and its own device metadata |
| `@smileid/usesmileid_mlkit_face`, `@smileid/usesmileid_vision_face` | Finding the face in the selfie camera: Google's ML Kit on Android, Apple's Vision on iOS, on the phone | Nothing beyond the phone |
| `react-native-quick-crypto`, `react-native-quick-base64`, `react-native-nitro-modules` | Required by Smile ID's SDK, which signs its own requests to Smile ID | Nothing beyond the app |
| `lottie-react-native` | Required by Smile ID's SDK, for its animations | Nothing beyond the app |
| `react-native-ssl-public-key-pinning` 1.2.6, with TrustKit on iOS | Certificate pinning for the app's requests (MB7), shipped off until its build settings are set (docs/security/pinning.md). OkHttp's certificate pinner on Android, TrustKit on iOS. Its last release was in July 2025; it builds with React Native 0.88 (checked with a release build) | Nothing beyond the app: it only checks the API's certificates |
| `modules/socket-pinning` (Jiffo's own), with SocketRocket on iOS | The same pins for the live connection's WebSocket, which the library doesn't cover | Nothing beyond the app |
| `@noble/curves` 2.4.0 | Checking the Ed25519 signature on the pinning switch (MB7), in JavaScript. Audited, no native code | Nothing beyond the app |
| `expo-brightness`, `expo-file-system`, `expo-haptics`, `expo-keep-awake`, `expo-screen-orientation` | Required by Smile ID's SDK: screen brightness and orientation while the selfie is taken, the selfie file until it is sent, haptics | The screen and the app's own files |

Smile ID's optional peers that only add device metadata (`expo-battery`, `expo-cellular`, `expo-network`, `expo-sensors`, `@react-native-async-storage/async-storage`) aren't installed.

### Keep rules for R8 (MB7)

Android release builds are shrunk and obfuscated with R8 (`expo-build-properties` in `app.config.ts`, a build setting that ships no code). R8 renames and removes whatever nothing in the Java and Kotlin reaches, so code reached only by name, from C++ or from JavaScript, needs a keep rule. Each library ships its own, applied to the app's build automatically:

| Library | Its keep rules |
| --- | --- |
| Expo's modules, including Jiffo's `modules/app-attest` and `modules/device-key` | `expo-modules-core`'s rules keep every module's constructor and definition, records, shared objects and views. Jiffo's modules reach nothing else by name. |
| React Native, `react-native-screens`, `react-native-svg`, `react-native-safe-area-context` | Their own consumer rules, and React Native's `@DoNotStrip` |
| `react-native-nitro-modules`, `react-native-quick-crypto` | Nitro marks the classes its C++ reaches with `@Keep` and `@DoNotStrip`; quick-crypto's are in C++ |
| Smile ID (`usesmileid_bridge`, `usesmileid_mlkit_face`, kamera) and Google's ML Kit | Smile ID's own consumer rules, which keep their module and analyser classes, and ML Kit's in its library |
| Play Integrity, Google Maps, Lottie | Their own consumer rules, in their libraries |
| `expo-notifications`, `expo-location`, `expo-task-manager` | Their own consumer rules |
| Room, through WorkManager (which `react-native-maps` uses for map tiles) | Ours: Room makes each database's generated class through its no-argument constructor, by reflection, as the app starts, and its own rules left R8 free to remove it. The first release build closed at once on a real phone until `ANDROID_KEEP_RULES` kept it |

A library added later is checked the same way: its rules, or one added to `ANDROID_KEEP_RULES` in `app.config.ts`, with a release build tried on a phone before it ships.

## Admin panel (`apps/admin`)

| Package | What it's for |
| --- | --- |
| `next`, `react`, `react-dom`, `server-only` | The panel itself. Pages are drawn on the panel's server; the browser gets no API keys. |
| `qrcode` | The QR code shown when an admin sets up their authenticator app. Drawn on the server. |
| `@simplewebauthn/browser` | Asking the browser to make or use a passkey, for roles that sign in with one |
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
| `@simplewebauthn/server` | Checking admins' passkeys (WebAuthn) |
| `zod` | Checking every request body |
| `libphonenumber-js` | Reading and checking phone numbers |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | Photo storage, with links that expire |
| `sharp` 0.35.5 (libvips, from its prebuilt binaries) | Opening every uploaded photo and writing it again as a plain JPEG, without location or camera details (C1). Runs on the server only | Nothing beyond the server |
| `heic-decode` 2.1.0 (with `libheif-js`, libheif built to WebAssembly) | Opening HEIC photos, as iPhones save them, which `sharp`'s prebuilt binaries can't, on a worker thread (C1) | Nothing beyond the server |
| `@aws-sdk/client-sesv2` | Admin team emails through Amazon SES, when that's the email provider chosen in the panel |
| `@jiffo/shared` | Jiffo's own shared rules and types |
