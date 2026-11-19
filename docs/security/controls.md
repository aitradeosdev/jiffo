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
- **Smile ID's token:** the SDK needs one, so the server gets a token from Smile ID for that check alone: for the agent's enrolled face and SmartSelfie Authentication only, valid 15 minutes, never allowing a new enrolment (so the kept face can't be replaced), with Jiffo's callback address fixed in it.
- **The verdict:** comes only from Smile ID's signed callback, never from the app. It must be a SmartSelfie Authentication for this check, confirmed with Smile ID's status API for the agent's own enrolled face, made after the check started, and one job decides one check. Anything else run under the check, such as a compare of two photos the app chose, fails. A job still running when its callback comes is kept with the check, and its status is asked when the app finishes it. The callback's body isn't covered by Smile ID's signature: as for ID checks, the verdict and the person come from the status API, and a signature is good for one body only.

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
