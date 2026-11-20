# Security controls

How Jiffo protects people, money and data, area by area. What is required is in the [security plan](../security-plan.md), and where each requirement stands is in the [security audit](../security-audit.md). Settings named here, such as Settings, Security, are in the admin panel.

## Access rules

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

## Server defences

- **Rate limits:**
  - Every route is limited a minute, counted in Redis so every server shares the counts. A signed-in person is counted as themselves, so many customers behind one mobile-network address don't add up.
  - Anyone not signed in is counted by address, against the route's limit and an overall one. A made-up token doesn't change that.
  - Refreshes count per session.
  - Paid lookups (places, quotes), the board, chat, presence, sign-in and webhooks have their own limits, and new live connections are limited per person.
  - Set them with `RATE_LIMITS` (for example `paid=20,auth=60`).
- **Headers:**
  - Every answer says not to sniff, frame or refer, with a content policy that lets nothing load. HTTPS is insisted on in production.
- **Provider calls:**
  - Every call to a provider has a timeout and never follows a redirect.
  - Provider addresses typed in the panel must be the provider's own https hosts.
  - Live payment keys are refused outside production, and test keys in it. This holds for keys from the environment too.
  - A refused redirect says where it pointed, so a provider that moved is easy to tell from one that is down.
- **Paystack:** with `PAYSTACK_WEBHOOK_IPS` set, Paystack's calls are taken only from those addresses.
- **Development storage:** serves only photos as images. Anything else comes down as a file. Its file routes don't exist in production.
- **Route list:** `docs/api/openapi.json` lists every route: who may call it, its rate-limit class, and the parameters and body it takes. It's read from the controllers, and a test fails when it's out of date. Rewrite it with `pnpm --filter @jiffo/api openapi`. There is one API version, `/v1`.
- **Reporting a security problem:** `/.well-known/security.txt` and the `/security` page give the contact in `SECURITY_CONTACT`, required in production.

## Signing in

- **Codes:** each number and each phone may ask for 3 codes in 15 minutes and 10 in a day (Settings, Limits). A phone already signed in to the number isn't held to the number's limits, so a stranger asking for codes to it can't lock the owner out.
- **Network addresses:** limited too (`OTP_PER_IP_PER_HOUR`, `OTP_PER_IP_PER_DAY`), but higher, since mobile networks put many customers behind one address.
- **Bursts:** each request is counted one at a time, so a burst can't slip past. One that arrives while another for the same number, phone or address is being counted is told to try again at once, not queued.
- **SMS spend:** every 10 minutes, finance gets an alert if a country has sent more codes in the last day than the set level (Settings, Security), since each is a paid SMS. It fires once per day.
- **A new phone:** signing in on one signs the others out of that app, and they get a push saying so.
- **Copied refresh tokens:**
  - A refresh token used twice ends every session of the account, in both apps.
  - The one exception is the app sending it again within a minute while the token it got back is unused, which means the answer was lost on the way.
- **Session length:** however often it is refreshed, a session ends `SESSION_MAX_DAYS` (default 90) after sign-in.
- **Where tokens live (MB2):** in the phone's keychain or keystore, readable after the first unlock and only on that phone. They are never in an iCloud or iTunes backup, and the Android app is left out of backups, so a session is never restored onto another phone. The apps' web builds, which keep tokens in the browser, are for development: in production the API refuses their sign-in. The app says which platform it is, so this stops Jiffo's own web builds, not a script that claims to be a phone; app attestation (MB3) is what will prove a sign-in comes from the store app.

## App checks (MB3)

Google Play Integrity on Android and Apple App Attest on iOS show that a request comes from our store app on a real phone.

- **What is checked:** each check is over a single-use code from the server (`POST /v1/attestation/challenge`, good for 5 minutes, for that install only), and covers the request's method, path and body, as a signed money request does.
  - **Android:** Google decodes the token and says whether the app is ours as Play installed it, signed with our key, on a genuine phone.
  - **iOS:** the phone makes a key in its Secure Enclave and Apple attests it once (`POST /v1/attestation/apple-key`, checked against Apple's root certificate, our App ID and the code). Each request after that is signed by that key, with a counter, so nothing is used twice.
- **Where:** sign-in, withdrawals, payout account changes, and going online (not the position updates while online).
  - **Sign-in:** checked once the sign-in code is right, so nobody can make Jiffo ask Google or Apple without one. A refused check uses that code up.
  - **Money actions and going online:** checked after everything the app answers by sending the same request again, which is the PIN, a new phone's selfie, a payout change's selfie and the day's selfie. Those answers don't use the check up. Each attempt after that carries a fresh check.
- **Settings, Security, App checks:**
  - **Record only** (the default) keeps every result, with the reasons, and refuses nothing. It is checked alongside the request, so a slow provider never holds the request up.
  - **Enforce** refuses a failed, missing or unavailable check: not our app, a changed one, a code for another request or install, or a check not set up for that platform. A doubtful phone isn't refused: rooted, an emulator, a development build, or Google not answering. An agent on an errand who is refused the check while going online stays offline but keeps sharing their position for that customer. For a doubtful phone, the agent takes a selfie first, at most 10 minutes before the money action or going online, and a doubtful sign-in to the agent app marks the phone as needing one.
- **What is kept:** each verdict and its reasons (`device_attestations`), for staff and the risk signals of MB4. No token is kept.
- **Development:** builds and tests use a stand-in (`fake:<verdict>`), which production never accepts.
- **In the apps:** `modules/app-attest` asks Google or Apple for the check, and `src/auth/attestation.ts` builds it over the request, as the server hashes it. It is sent at sign-in, with withdrawals and payout account changes, and when going online, made fresh for each attempt. An iPhone makes its App Attest key and registers it once. Expo Go and the web build can't make a check and send none.

## Risk signals (MB4)

- **What the apps look for:**
  - a rooted or jailbroken phone (su binaries, Magisk, jailbreak files, writing outside the sandbox);
  - an emulator or simulator;
  - a hooking tool (Frida's libraries or server, Xposed, Substrate);
  - an attached debugger;
  - on Android, a known fake-location app installed, such as Lockito (G1). The app names those apps in its manifest, so Android lets it see only them, not the rest of what is installed.

  They send what they find with each app check (`x-jiffo-risk`), even when no check can be made. The check covers what is sent, so it can be neither dropped nor changed on the way.
- **On the server:** a phone with signals counts as doubtful. On Enforce, that means a selfie first, as for a phone Google or Apple doubts. Each check keeps the signals (`device_attestations.signals`), the account's device keeps the latest, and staff see them on the person's page under Devices.
- **Mock locations:** the agent app sends the phone's own word that a position is mocked (Android). A mocked position can't place an agent at a drop-off: marking an errand delivered, the hand-off PIN and the drop-off photo are refused until a real position comes in. It isn't shown or sent to the customer, isn't counted among agents nearby, and doesn't open the board.
- **Limits:** these are the app's own word, so a changed app could leave them out (though not without failing the check, which covers them). They add to Google's and Apple's checks (MB3), which run outside the app. Virtual cameras are for Smile ID's liveness and injection checks to catch (I2).

## Fraud flags (E5, E6, I3, F3)

A flag asks a person to look; it refuses nothing by itself. Each check runs beside the request that set it off, so the person waits for nothing and an error in a check only goes to the log.

- **Moderation (E5):** a new errand is flagged for the Risk queue when it asks the agent to carry or withdraw cash, asks for money to be sent to an account (an account number counts, but not a phone number with the country code), or ends where it starts (pickup and drop-off nearer than Settings, Risk flags say). The flag keeps the words found, never an account number.
- **Collusion (E6), when an agent accepts or finishes an errand:**
  - the customer and the agent have used one phone: the same install of an app, the same phone key, or the phone's own id;
  - the customer's wallet was topped up from a bank account whose holder isn't the customer and is named as the agent's payout account is;
  - the same pair has paired up as many times as Settings say within so many days; their later errands join the flag while it stands;
  - a high-value errand was delivered faster than Settings allow, or than its stops can be driven between at 60 km/h;
  - the customer's and agent's phones used one Wi-Fi network or address within the days Settings give.

  A flag about a pair stands for all their errands: a pair a reviewer cleared isn't flagged for sharing again, and a cleared run of repeat errands is counted afresh.
- **Shared accounts (I3), to the verification queue:** two accounts used on one phone, when at least one has started an agent application (one phone's key on two agent accounts included; starting an application looks at the phone again), and one bank account saved by two agents, with every account they share on the one flag. Customers' accounts sharing a phone aren't flagged: families do, and there are no promotions to abuse yet.
- **The same face (I3):** the identity port can give, with a check's result, the earlier checks the provider found to be of the same person (the same face, the same ID number, or both), by our references. A face found on another account's check is flagged for verification, found by every check's reference, kept for a little over a year; the same ID number alone is the one-account-per-ID check's to stop. Smile ID's adapter fills this from Smile Secure, which Smile ID switches on for the account; another provider's adapter can fill the same field.
- **Networks (E6):** the apps say what each request's connection is (`x-jiffo-network`), read for each request. The server keeps a keyed hash of the address, at most every quarter hour per account, and forgets it 90 days after last use. It counts Wi-Fi and wired addresses that the two used around the same time (within a day of each other). A phone network's address is kept only to mark it as a carrier's: a MiFi or a hotspot looks like Wi-Fi to the phones on it but comes out at the carrier's address, which thousands share, so an address anyone reached over a phone network isn't counted. Neither is a VPN's, an unknown one, or one more accounts used than Settings allow (a shop's or an office's Wi-Fi). For IPv6, the network's half of the address is used; a home whose phones reach Jiffo over IPv4 and IPv6 both isn't matched across the two.
- **The phone's id:** both apps send it at sign-in (iOS's id for the vendor, Android's id for apps signed with one key). The server keeps only a keyed hash, as it does for payout accounts (`phone_fingerprint`, `account_fingerprint`, with keys derived from the ID fingerprint key).
- **Deciding:** the Flags page has the Risk queue, for operations (the `risk` permission), and shared accounts, for the verification team. Each flag is cleared, confirmed as fraud, or reopened, with a reason in the audit log; a button must be pressed, so Enter in the note decides nothing. Nobody decides a flag about their own app account. The errand's page shows its flags, and the person's page links to theirs.
- **Tier counts (F3):** the counts on a person's page, and the errand count in the People list, leave out errands with a flag that isn't cleared, and show them as Flagged.
- **GPS (G1, E6):** see "The GPS trail" below for impossible jumps, trails along a ruler and agents who never moved.

## The GPS trail (G1, G3, G4, E6)

- **What is kept:** each position the agent's phone reports while they are out on an errand is kept for the errands whose customer follows them then (`errand_trail`): an errand held while they carry out another gets none until it is under way (G2). Mocked positions are kept but marked. With each position the app sends when the phone took the fix and how far off it might be. Being online on no errand leaves no trail; only the latest position is kept then, as before (G3). A trail point that can't be written is logged; it never fails the agent's report.
- **Impossible jumps (G1):** each reported position is compared with the one before. A move of at least 1 km faster than 150 km/h (Settings, Risk flags) is flagged for the Risk queue: on each errand that follows the agent, or for the agent once a day (by the country's day) when on none.
  - The time is when the phone took each fix, when both reports say and the phone's clock is believable (within ten minutes of ours), so reports held up on the network don't look like jumps.
  - How far off each fix might be is taken off the distance: a cell tower's fix can be a kilometre or more out.
  - Smaller moves are a phone's GPS wandering, however fast they look. A move to or from a mocked position isn't judged, as the phone already said it was mocked (MB4).
- **When an errand is finished,** on the finishing agent's own positions only (an agent who gave the errand back left theirs on it too):
  - **No movement (E6):** the trail stayed within 150 m of where it started, over at least three positions and five minutes, while the pickup and drop-off are more than twice that apart. Only a trail that covers the errand from accepted to delivered with no gap of more than three minutes is judged: positions that stopped coming say nothing about where the agent went meanwhile.
  - **Along a ruler (G1):** eight positions in a row over at least 300 m, every one within a metre and a half of the straight line, at a speed even to within 3%. A phone's GPS wanders a few metres and a driver's speed changes; an app faking a route doesn't.
- **Deleted after the days in Settings, Security (G4, X10):** 90 unless changed, between 30 and 365. A daily job deletes older positions, country by country, except for an errand in dispute or with a flag still open.
- **Shown to staff:** the errand's page draws the latest positions to scale with the stops, a line for each agent who was out on it, mocked positions in red.
- **Limits:** the positions, their times and their accuracy are the phone's own word. These checks catch the ways faking usually shows, and with the app checks (MB3) and the mock flag (MB4) make it harder; they don't prove where someone was.

## Dispute evidence packs (E8)

- **When:** a pack is made in the same transaction that puts the errand into dispute, however that happens: a side opening one, too many wrong PINs, the item amount or the customer's answer running out of time, or staff stepping in. So it is the errand exactly as it was at that moment. If the pack can't be made, the dispute still opens, the team is alerted (`evidence_failed`), and the errand's page asks staff to take one. Staff who handle errands or disputes can take another at any time, for instance after more was said in the chat: logged with a reason, read as of one moment.
- **What it holds:** the errand and its stops; every event in order, with offers, item amounts and PIN entries (also listed on their own); the chat; the receipts and photos (which file, who sent it, when); the calls through Jiffo (who called whom, when; nothing of the call itself); the flags; and the money that moved, signed as the errand's page shows it (money into an account is positive).
- **The GPS trail is fingerprinted, not copied:** the pack holds how many positions there were, the first and last, and a SHA-256 of them as kept then. The trail itself stays with the errand for as long as G4 allows, so a pack doesn't keep where someone was for longer.
- **Fixed:** the database refuses any change to a pack, or its deletion (`dispute_evidence`, append-only, as the audit log is). Each pack carries a SHA-256 of its content as canonical JSON (keys in order): download it from the errand's page, and anyone can work the hash out again to show nothing changed since.

## The emergency button and Safety queue (E9)

- **In the apps:** both apps have an Emergency row in an errand's Help sheet and on the Account tab. Pressing it dials the country's emergency number from the phone at once (Settings, Safety: 112 in Nigeria); nothing waits on the network first.
- **Then the app tells Jiffo, at once:** who pressed, from which app, and on which errand. The report waits on nothing, not a location and not a permission prompt, and is tried again for about four minutes on a weak signal; if Jiffo is never reached, the person is told to give the emergency service their location themselves.
- **Where they are:** as soon as the phone can say, asking for location permission once if it hasn't been asked, then every 30 seconds for ten minutes while the app runs, never asking again.
- **One emergency:** a double tap is one press. Presses within half an hour of the latest are one emergency, which keeps the errand a later press names, and is followed for half an hour from the latest press. A press is never refused: an errand that isn't the person's own is left off.
- **The Safety queue:** the panel's Safety page lists open emergencies oldest first, with the person, their errand, a map of where they were last and how many positions came after. Opening one raises an alert, which stays off the money pages and is closed only from the Safety queue. The safety team (and operations, and owners) mark it handled with what they did, in the audit log, once; nobody handles one about their own account.
- **Limits:** the app can only send where the person is while it runs; the emergency call itself is the phone's.

## Uploads (C1)

- **Types:** the apps may send JPEG, PNG and HEIC photos, up to 10 MB each. WebP, GIF, SVG and anything else is refused when the upload is asked for. The apps save every photo as a JPEG no larger than 2,560 pixels on its longest side before sending it, so a picture from the gallery is never refused for its type.
- **Checked by its bytes:** the name and type the app gives only label the upload. The first time a photo is sent with something (a receipt, an item or drop-off photo, a chat photo), the server reads the file and tells JPEG, PNG and HEIC apart by their first bytes. Anything else, a cut-off or damaged file, or one with more than 100 million pixels (a "pixel bomb"), is refused as `photo_unreadable`, and the person is asked to take it again. The pixels are counted from the header before the photo is opened.
- **Re-encoded:** the server opens the photo (HEIC on a worker thread, so other requests don't wait), turns it the way the camera held it, makes it no larger than 2,560 pixels on its longest side, and writes it again as a plain JPEG with nothing but its pixels. Location, camera details and anything hidden in the file are gone. At most two photos are opened at once in each API process.
- **Two places in the store:** the apps upload to `incoming/`. Nobody is ever shown anything there, and the server deletes each original once it has kept its copy under `errands/`, which is all anybody sees. Set the bucket to expire anything under `incoming/` after a day, for uploads never sent with anything.
- **Fingerprinted:** each upload's row keeps when it was checked and its copy's SHA-256 and size. Dispute evidence packs list them, so a photo shown later can be shown to be the one that was sent (E8). The admin errand page shows only checked photos.
- **Seen through short links:** the bucket is private. The apps and the panel get a signed link each time they show a photo, which lasts the minutes Settings, Security give (5; at most 60).

## Drop-off photos awaiting approval (X1–X3)

- **Approved by itself:** when an agent leaves the items with a drop-off photo, the errand is approved automatically after 24 hours (Settings, Timers), for both the errand fee and the item money, unless the customer approves it, or reports a problem, first.
- **Reminders:** the customer is reminded by push and SMS at 2, 12 and 20 hours after the photo (Settings, Security: the hours). Each says how long is left, and the SMS fits in one text, as each is paid for. None is sent once the customer has acted, support has stepped in, or the timer is paused, and none at or after the automatic approval. Photos already waiting when this went live keep their automatic approval but get no reminders.
- **The Drop-offs queue:** the panel's Drop-offs page lists every drop-off photo waiting, with its photo, its timer, the customer, the agent and the money. Paused ones come first, so they never fall off a long list, then the soonest to be approved. Past 200 it says how many more there are.
- **In the apps:** both apps show when the photo approves itself, or that support has paused that, from the time the server gives.
- **Pause:** staff who handle errands can pause the automatic approval, with a reason, in the audit log. Nothing is approved or reminded while it is paused, and the customer can still approve it. Resuming starts it again with the time that was left, and the reminders still to come. Both sides are told each time.
- **Freeze and decide:** stepping in moves the errand into dispute, which freezes the money and makes its evidence pack. Staff then decide on the errand's page: release to the agent, refund the customer, or split. A split above the set amount needs a second admin's approval (D4). Staff's decision replaces the automatic one.
- **Timers:** each timer acts only on the errand exactly as it was when the timer was set. A pause, a resume, the customer's answer or a dispute leaves the old timers doing nothing.

## Jiffo never asks for a code or PIN (C7)

- Wherever a sign-in code or PIN is entered or shown, both apps say Jiffo will never ask for it: on the sign-in code screen, when an agent creates their app PIN or enters it for a money action, and on the customer's hand-off PIN, which goes to the agent in person and nobody else. The sign-in text message says never to share the code too.

## Chat warnings (C3)

- **What is flagged:** a message whose text (or a photo's caption) has:
  - a link (with or without `http` or `www`, short links such as `wa.me` and `bit.ly` too);
  - a phone number (Nigerian with or without `+234`, with spaces, dashes or brackets, or any number written with a `+`), even with another number just before it;
  - a bank account number (ten digits, with or without spaces);
  - wording that asks to be paid outside the app ("pay me directly", "transfer to my account", "send it to my OPay", "outside the app", "don't pay in the app").
- **Decided by the server:** the server checks each message as it is sent, with the rules in `packages/shared/src/chat-warnings.ts`, and keeps the answer with the message. The apps can't set or clear it.
- **Shown, not blocked:** both apps show a warning under the message, on both sides of the chat. For example, "Only pay through Jiffo. Money paid outside the app isn't protected and can't be refunded." The words are common enough in honest errands that nothing is refused.
- **Staff:** the errand's page in the panel marks each warned message ("Warned: account number, pay outside the app"). Dispute evidence packs keep the warnings with the chat.
- **Limits:**
  - Numbers written in words, or split across messages, aren't caught.
  - Prices, times and quantities are left alone, but any ten-digit number (an order reference, say) reads as an account number.
  - An agent paying the shop in cash or by transfer isn't warned about: only paying "me", "us" or "you", or into "my" or "our" account or wallet, is.
- **No link previews:** links in chat are plain text. Neither the apps nor the server ever open one, so nothing can be fetched from an internal or private address.

## The apps on the phone

- **No screenshots (A9):** the PIN, wallet, top-up, withdrawal, payout account and ID check screens, the hand-off PIN (the customer's and the agent's), and the selfie check block screenshots and screen recording while they are in front (Android also hides them in the app switcher). An identity provider's own page opens in the phone's browser, outside the app, so the app can't block it there.
- **Links into the apps (MB5):** a link from another app, a web page or a QR code opens only the start or the identity check's way back (`identity-done`), with no parameters. Anything else opens the start when it opens the app, which asks a signed-out visitor to sign in, and changes nothing when the app is already open. Screens check the parameters they read: an errand's id must be an id before it goes into an API path, and the others must be one of their own values.
- **Logs:** the apps log nothing (MB2).

## Identity checks

- **The name on an ID:**
  - Kept only for a check that didn't fail, so a failed selfie can't turn a check into a way to look up whose ID a number is.
  - Shown to the person only once they are verified, or for agents approved.
- **Starting checks:** each account may start a set number a day (default 3, Settings, Identity), whatever the results, since each is a paid check.
- **Smile ID:** its callback signature covers only a timestamp. The verdict is re-read from Smile ID, and a signature is accepted with one body only, so it can't be replayed with another.
- **Sandbox mode:** refused for identity providers in production.
- **Approving an agent:** never takes an ID away from another account that proved it with its own checks.

## Keys and personal details

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

## Payout accounts

- **Match:** every word of the bank's name for the account must be in the legal name on the ID record. Otherwise the account is refused.
- **Near match:**
  - When the bank's name is close but not the same (an initial, or a slip of a letter, each word of the ID used once), the account waits for a check, and withdrawals keep going to the approved account meanwhile.
  - Saved during the application, it is decided with the application.
  - Saved later, finance approves or declines it on the Withdrawals tab.
- **Changes:** every change is checked the same way, and the agent gets a push whenever their account changes, so a change they didn't make doesn't go unnoticed.

## Protecting the hand-off

- **At the drop-off:** marking an errand delivered and entering the PIN need the agent's fresh position within the set distance of the drop-off (default 200 m, Settings, Security).
- **Wait before a photo:** a drop-off photo is accepted only after the agent has waited the set minutes there, and only while they are still there.
- **Current settings:** these limits follow the current settings, also for errands made before a change.
- **Last wrong PIN:** freezes the errand for support. Nothing is paid or given back by itself, and each wrong entry is on the errand's record, without the digits.
- **PIN storage:** each PIN is encrypted under its errand's own key and checked by a keyed hash. It is cleared when the errand ends.
- **Limits:** item money is capped for new agents and new customers. Counter-offers are limited per minute, and admin can cap how many errands one agent holds at once.

## Money actions on the phone

- **The phone's own key:** after signing in, the agent app makes a P-256 key in the phone's secure hardware (the Secure Enclave or Android Keystore), which can't be copied off it, and registers the public half, only in the first 10 minutes after a fresh sign-in, so a stolen session can't add a key of its own. A phone that lost its key registers a new one the same way, which pauses withdrawals like a new phone. The agent app only: a customer-app session can't set up a key, a code or the PIN.
- **Signed requests:** a withdrawal and a payout account change are each signed with that key over a single-use code from the server (`POST /v1/devices/current/challenge`, good for 2 minutes), the method, the path and a hash of the body. A code works once and only for the phone it was given to; a changed body or another key is refused.
- **The app PIN:** 4 digits, not a run or one digit repeated, kept as a keyed hash. Money actions carry it and the server checks it after the signature, so guessing it needs the phone. Fingerprint or face can fill it in from the phone's locked storage.
- **Wrong PINs:** counted; at the limit in Settings, Security (default 5) it locks, even for the right PIN, until reset by signing in again on the phone. Changing it needs the current PIN.
- **A new PIN pauses withdrawals** for 48 hours, like a new account or phone: whoever took the number over would reset it that way.
- **Handing a phone on:** a plain log-out keeps the phone known, so the agent can sign back in on it without a hold. "Log out and forget this phone" drops its key from the account and deletes it from the phone: signing in on it again counts as a new phone, with the 48-hour hold, even if it was the agent's only one.
- So an SMS code alone never moves money (A5): it gets a session, but not the key on the owner's phone or their PIN.

## Agents' selfie checks

The person working is the agent who was verified (A4, I8, P8, X4). A selfie is taken in Smile ID's own SDK in the agent app, with liveness, and compared with the face Smile ID kept from the agent's ID check. Jiffo keeps only the outcome, never the selfie.

- **Going online:** the first time each day, in the country's time zone, an agent needs a passed selfie. An agent already online stays online past midnight and is asked the next time they go online. One with an errand running keeps sharing their position for it, offline, until the selfie passes. Admin can add random checks when going online (Settings, Security, off by default); a random check stays asked for until one passes.
- **A new phone:** a sign-in on a phone the account hasn't used, a forgotten one, or a phone whose key was replaced needs a selfie before any signed request: a withdrawal, a payout account change or the app PIN. It is asked for before the request's single-use code is used, then the 48-hour hold applies as before.
- **Changing the payout account:** needs a selfie passed in the last 10 minutes, asked for before the request's single-use code is used. Adding the first one doesn't.
- **Who can take one:** only an agent whose ID check passed, or whom staff approved: until then Smile ID may keep no face to compare with.
- **Failures:** three in a row (Settings, Identity, Selfie tries) suspend the account: signed out everywhere, offline, and its own requests still waiting for an agent closed, as a suspension from the panel does. Staff get an alert listing any errands under way. Reactivating it in the panel starts the count again. An unclear selfie (poor light, say) is taken again without counting; a pass clears the count.
- **Adapters on both sides:** the API reaches the provider through its identity adapter (`startSelfie`, its webhook's verdicts), and the agent app picks the provider's own SDK screens by the name the server sends (`apps/mobile/src/agent/selfie-capture.native.tsx`). Adding a provider means an adapter on each side; the rules stay as they are.
- **In the agent app:** wherever the server asks for a selfie (going online, a money action on a new phone, a payout change, setting the PIN on a new phone), the app says why, the agent agrees by taking it, Smile ID's SDK takes it, and the app waits for the server's verdict before trying the action again. Expo Go and the web build have no selfie camera. The development provider decides without one.
- **Smile ID's token:** the SDK needs one, so the server gets a token from Smile ID for that check alone: for the agent's enrolled face and SmartSelfie Authentication only, valid 15 minutes, never allowing a new enrolment (so the kept face can't be replaced), with Jiffo's callback address fixed in it.
- **The verdict:** comes only from Smile ID's signed callback, never from the app. It must be a SmartSelfie Authentication for this check, confirmed with Smile ID's status API for the agent's own enrolled face, made after the check started, and one job decides one check. Anything else run under the check, such as a compare of two photos the app chose, fails. A job still running when its callback comes is kept with the check, and its status is asked when the app finishes it. A SmartSelfie job that comes without the check's reference is matched to the agent whose enrolled face it was, and their latest check started before it. The callback's body isn't covered by Smile ID's signature: as for ID checks, the verdict and the person come from the status API, and a signature is good for one body only.

## Withdrawals

Agents only, to an account in their own name. One free scheduled withdrawal a day, or instant for a fee. A bounced transfer puts the full amount back.

- **Repeats:** each request carries the app's key, so a repeated tap or a retry makes one withdrawal.
- **Sending:** one run at a time claims a withdrawal before sending it. Only a first try that the provider refuses outright gives the money back. An unclear answer after that raises an alert instead.
- **Suspension:** a suspended agent's withdrawals wait until they are reactivated.
- **Hold after an account change:**
  - A new payout account in place of one in use, or a sign-in to the agent app on a phone the account hasn't used, pauses withdrawals for 48 hours (Settings, Security; it can't be switched off).
  - An agent's first account and first phone don't, nor does the customer app, nor saving the same account again. A nearly matching account pauses them from when support approves it, on its own or with the application.
  - The agent is told by SMS and email, and by push: after a new phone's sign-in, on the phones it signed out, which are the owner's, since the number may now be someone else's. So a change they didn't make is noticed before money can leave.
  - New withdrawals are refused until it ends; one asked for before it waits, then goes as asked. Paystack's transfer approval refuses a held agent's transfer.
  - A later change never shortens a hold. Staff see it on the agent's page.
- **Daily caps (Settings, Security):** instant withdrawals are capped per agent and for all agents together.
- **Paystack's transfer approval URL:** `POST /v1/webhooks/paystack/transfer-approval`, registered in the Paystack dashboard. It approves only a withdrawal Jiffo is sending, for its exact amount and the agent's recipient.

## Nightly check

- **Shortfalls:** if the provider holds less than the ledger beyond the tolerance in Settings, Security, instant withdrawals pause until finance clears the check, with a note, under Money, Nightly checks.
- **Low balance:** checked every 15 minutes.
- **Alerts:** gaps, a low balance, refused or unclear transfers and Paystack's transfer OTP show there and on the overview.

## Reconciliation

every night the ledger's cash is compared with the Paystack balance and the result is saved for finance.
