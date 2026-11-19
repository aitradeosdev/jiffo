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
  - Identity widget pages run only their own scripts, by a fresh nonce.
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
- **Pages Jiffo serves for a provider:**
  - Links expire after an hour.
  - They work only while the app session that started the check is signed in.
  - They work only in the browser that first opened them, so a forwarded link doesn't open.
  - Opens are limited per check each hour, counted across all servers.
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
