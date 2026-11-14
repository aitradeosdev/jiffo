# Jiffo security plan

This is the one document for adding security to the Jiffo build. Most of the app already exists, built from the Jiffo product spec. This document holds:

- the rules every change follows
- the full security plan, area by area
- the features already built that change because of it

Where this document and the product spec disagree, this document wins. Every number here is a default stored in admin settings per country, not a value written into the code.

The stack it assumes, from the spec:

- two React Native (Expo) apps, Customer and Agent
- a Next.js admin panel
- a NestJS backend
- PostgreSQL with PostGIS
- Redis with BullMQ
- Socket.IO
- S3, on AWS Cape Town
- Paystack for payments, Agora for calls, Termii for SMS

Where this plan differs from what was deliberately built, `docs/security-audit.md` records which way each point was settled and why.

## How to use this document

1. **Audit first.** Check the existing code against every requirement below, by its ID (R1, A1, L1 and so on). Write the result to `docs/security-audit.md` as a table: ID, status (done, partly, missing), files involved, and what is missing. Change no code during the audit.
2. **Fix in the order under "Order of work"**, one area per pull request.
3. **Tests first.** For each fix, write the abuse cases as failing tests: wrong user, repeated request, 50 identical requests at once, tampered amount. Then change the code until they pass.
4. **Human review.** Label every pull request that touches login, money, admin or webhooks `security-review`. It is not merged until a person has reviewed it. Ledger and payout changes need two reviewers.
5. **Stop and explain** when a requirement can't be met with the current design. Don't work around it.

## Order of work

1. **Before any real money moves:** Ledger, wallet and escrow (L); Paystack (P); Rules for every change (R); ownership checks (E1, E2, C4).
2. **Before public launch:** everything else, except items marked *after launch*.
3. **After launch, within 3 to 6 months:** the items marked *after launch*.

## Rules for every change (R)

- **R1** Every endpoint, and every Socket.IO connection, room join and event, checks that the caller owns or is a party to the object it touches: errand, offer, chat, photo, receipt, dispute, wallet. Random UUIDs are not a substitute for this check.
- **R2** Take the user ID from the verified session only, never from the request body or query string.
- **R3** Clients can never set `status`, `amount`, `fee`, `commission`, `role`, `tier` or any balance. Use NestJS `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`, and DTOs that list only the fields each endpoint accepts.
- **R4** Responses return only the fields each role needs.
- **R5** Admin endpoints use their own authentication and check the staff role and permission on every request. App user tokens are never accepted on admin routes.
- **R6** Parameterised queries only. No SQL built from strings.
- **R7** Escape all user text in the admin panel and any web view. Never render user text with `dangerouslySetInnerHTML`.
- **R8** Error messages to clients are generic. Details go to the logs.
- **R9** No secrets in code, config files or the apps. Use AWS Secrets Manager.
- **R10** Never log ID numbers, selfies, tokens, one-time codes, PINs or bank details. Scrub them in Sentry before events are sent.
- **R11** Add only well-known packages. Check that each package name exists and is the intended one before adding it. Commit lockfiles.
- **R12** Never disable TLS certificate checks. No open CORS. No debug endpoints in production.
- **R13** Claude Code works only against local and staging environments, never with production credentials or data.
- **R14** For each new feature, write a short threat model first: who could abuse it, how, and what stops them.

## Accounts and login (A)

- **A1 One-time codes:**
  - 6 digits, valid 5 minutes, single use.
  - 5 wrong tries per code; resend after 60 seconds.
  - At most 3 sends per number per 15 minutes, and 10 a day.
  - Limits count per number, per device and per IP, using atomic Redis counters (`INCR` with expiry), so many requests sent at once can't beat them.
- **A2** Block premium-rate and unexpected international number prefixes for codes. Alert admin when SMS spend spikes.
- **A3 Device binding:**
  - At sign-up the phone creates a key pair in Android Keystore or the iOS Secure Enclave, and the public key is stored in `devices`.
  - Money actions are signed with the private key over a single-use server nonce, and the server checks the signature.
  - This needs a native module in an Expo development build; it can't run in Expo Go.
- **A4** On a new device, the user enters the code and takes a fresh liveness selfie before any wallet action.
- **A5** An SMS code alone never moves money or recovers an account.
- **A6 48-hour hold:**
  - Triggered by a new phone number, email, app PIN or payout account, or a login on a new device.
  - It pauses agent withdrawals and customer refunds through support for 48 hours.
  - Store `hold_until` on the account, and check it in payouts, the Paystack approval URL (P7) and refund approval.
  - Tell the user by SMS and email.
- **A7** Every wallet action needs the app PIN or biometric: paying, locking item money, withdrawing, changing the payout account. The PIN or biometric unlocks the device key, and the server checks the signed request.
- **A8 Sessions:**
  - Access tokens last 15 minutes.
  - Refresh tokens change on every use. A refresh token used twice ends every session for that user.
  - A new phone number, PIN or device signs out all other devices.
- **A9** PIN, wallet and ID screens block screenshots and screen recording (`expo-screen-capture` on those screens).
- **A10** *After launch:* risk scoring at sign-up and login, from emulator signals, many accounts on one device, and VPN or data-centre IP addresses.

## Identity (I)

- **I1** Treat NIN and BVN numbers as public: they are sold online in Nigeria. What ties the person to the account is the selfie matched to the photo on the ID record.
- **I2** The identity adapter runs selfie capture in the provider's native SDK, never in a web view. The chosen provider must hold ISO/IEC 30107-3 liveness certification (iBeta Level 2 or higher) and show testing against injection attacks (CEN/TS 18099).
- **I3 Face de-duplication:** flag the same face on two different ID numbers, and flag devices and payout accounts shared between accounts. Flags go to the verification review queue.
- **I4** For agents, the names on the NIN, the BVN and the payout account (from Paystack's account-name check) must match, within a fuzzy-match threshold. Near matches go to the verification review queue.
- **I5** Store ID numbers only as a keyed hash (HMAC, key in AWS KMS) for the one-account-per-ID check. Keep BVN only as the check result and its last 4 digits.
- **I6** Encrypt NIN, BVN, selfies and bank details field by field, using envelope encryption with AWS KMS. Keys are never in the database.
- **I7** Manual-mode ID photos and proof of address are deleted once admin decides.
- **I8** Agents pass a selfie check before going online, daily and at random times, with liveness every time. Three failures suspend the account until admin reviews it.

## Ledger, wallet and escrow (L)

- **L1** Money moves only through the ledger service. No other code writes balances, escrows or journal rows.
- **L2** Amounts are integers in kobo, never floats or decimals.
- **L3 Append-only:**
  - Journal rows are never updated or deleted. A mistake is fixed with a reversing entry.
  - Enforce this in the database: revoke `UPDATE` and `DELETE` on journal tables from the app's role, or add a trigger that rejects them.
- **L4** Every money action runs in one database transaction that locks the wallet row (`SELECT ... FOR UPDATE`). Balances carry a `CHECK (balance >= 0)` constraint.
- **L5** Every money-moving request has a unique idempotency key enforced by a unique index. So does every outside reference: Paystack transaction, transfer and webhook.
- **L6 Ledger accounts:**
  - a wallet for each customer and agent
  - a fee escrow and an item escrow for each errand
  - agent earnings
  - platform commission
  - promo and referral spending
  - payouts in progress
  - the pooled Paystack account
- **L7 Escrow states:**
  - The allowed moves are locked to released, refunded, split or frozen, and frozen to released, refunded or split by admin only.
  - A version column blocks two moves at once. Every other move is rejected.
- **L8** Fees, commission and totals are calculated on the server from settings. The only amounts the app may send are proposals: the customer's errand price, an agent's counter-offer, an item amount. Each takes effect only when the other side confirms it in the app.
- **L9** Every counter that limits attempts (code tries, PIN tries, promo uses, referral rewards) is an atomic database or Redis update, never read-then-write.
- **L10 Concurrency tests:** for every money endpoint, fire 50 identical requests at once and assert the money moved exactly once. These run in CI on every change.
- **L11 Invariant tests:** all postings sum to zero, no escrow goes below zero, and a released or refunded escrow is empty.
- **L12 Reconciliation:**
  - A daily job compares the ledger with Paystack's balance and its transaction and transfer lists, and live alerts watch for drift.
  - Any unexplained gap pauses instant payouts automatically until finance clears it in the Finance queue.
- **L13** A low-balance alert on the Paystack balance keeps payouts from ever exceeding the pooled money.
- **L14 Refunds through support:**
  - They go only to a bank account in the customer's own name, confirmed by Paystack's account-name check.
  - Each needs a second staff member's approval and a reason code, and respects the 48-hour hold (A6).

## Paystack (P)

- **P1** Verify `x-paystack-signature` as HMAC-SHA512 of the **raw** request body, using the secret key. Turn on `rawBody: true` in NestJS, and compare with `crypto.timingSafeEqual`. Reject on mismatch.
- **P2** After the signature check, call `GET /transaction/verify/:reference`. Confirm the status is success, the amount and currency (NGN) match, and the dedicated account belongs to that customer. Each reference is credited once, enforced by a unique constraint.
- **P3** Reply 200 at once and process the webhook from a BullMQ queue.
- **P4** Optionally accept webhooks only from Paystack's published IP addresses: 52.31.139.75, 52.49.173.169 and 52.214.14.220. Confirm the current list in Paystack's docs.
- **P5** Deposits are credited only on a verified `charge.success` through `dedicated_nuban` that maps to that customer's own account.
- **P6 Payouts:**
  - We set our own transfer reference on every payout.
  - Retry only after a final status (success, failed or reversed), and with the same reference.
  - `transfer.failed` and `transfer.reversed` credit the agent back through the ledger.
- **P7 Transfer approval URL:**
  - A POST endpoint that Paystack calls before every payout.
  - It returns 200 only if the payout exists in the ledger as in progress, the amount matches, the recipient is the agent's verified recipient, the caps allow it and no hold applies. Otherwise it returns 400.
  - It must answer fast, with no slow outside calls.
- **P8** Transfer recipients are created only from the verified own-name account. Changing it starts the 48-hour hold (A6) and needs a fresh selfie.
- **P9** Instant payouts have daily caps per agent and for the whole platform (admin settings).
- **P10** All Paystack API calls leave through fixed IP addresses (a NAT gateway with Elastic IPs), so the secret key can be locked to those addresses in the Paystack dashboard.
- **P11** The secret key lives only in Secrets Manager, never in the apps or the admin frontend. Test and live keys are kept apart.
- **P12** Cards are not accepted. If cards are ever switched on, handle `charge.dispute.create`: freeze the linked wallet or escrow and alert finance, because Paystack accepts unanswered disputes after 16 hours.

## Errands, PIN and disputes (E)

- **E1** Only an errand's customer, its agent and authorised staff can see or change the errand, its offers, chat, photos, receipts and disputes. Check this on every request and every socket event (R1).
- **E2** Errand and related IDs are random UUIDs, and the ownership check still runs.
- **E3 Prices:**
  - Prices change only through offer cards that both sides confirm. Chat text never sets a price.
  - Offers are limited to 5 a minute per errand (admin setting) and stay unlimited in total.
- **E4 Hand-off PIN:**
  - Generated on the server with a secure random generator, stored only as an HMAC with a per-errand secret, and used once.
  - Shown only in the customer's app, after the agent marks the errand delivered.
  - Five wrong entries lock it and freeze both escrows for admin. Nothing is released or refunded automatically on lock.
  - The server accepts the PIN only when the agent's latest location is within 200 m of the drop-off pin.
  - The app tells customers never to share the PIN before they have everything.
- **E5** Moderation also flags errands to deliver cash or "send money to my account", and errands whose pickup and drop-off are the same place.
- **E6 Collusion flags** go to the Risk queue:
  - a customer and an agent who share a device, IP address, Wi-Fi network or payout bank account
  - the same customer and agent pairing again and again
  - errands with no GPS movement
  - high-value errands finished unusually fast

  Machine-learning scoring comes *after launch*.
- **E7** A dispute split above an admin-set amount needs a second admin's approval.
- **E8** Each dispute's evidence pack is assembled automatically: chat, offers, receipts, photos, PIN events and the GPS trail.
- **E9** The emergency button dials the emergency number from the phone and logs the event, with live location, to the Safety queue.

## Chat, calls and uploads (C)

- **C1 Uploads:**
  - Allowed types only: JPEG, PNG and HEIC photos; AAC and Opus voice notes. Size limits apply.
  - Every image is re-encoded on the server, which strips location data and broken files.
  - Files are stored in a private S3 bucket and served through signed links that expire after 5 minutes.
- **C2** Receipt, item and drop-off photos come only from the in-app camera, stamped with server time, and are kept as dispute evidence.
- **C3** Chat flags links, phone numbers, bank account numbers and "pay outside the app" wording with a warning banner. Link previews never fetch internal or private IP addresses.
- **C4** Socket.IO connections authenticate with the access token. A user joins an errand's room only as one of its two parties, and every message re-checks this.
- **C5** Agora call tokens are issued by the server for each errand's channel, only to its two parties, and expire when the errand closes. Real phone numbers never appear in any API response.
- **C6** The admin panel shows chat as escaped text only (R7), so a message can't run code in a staff member's browser.
- **C7** *After launch:* show "Jiffo will never ask for your PIN or code" in both apps.

## Location (G)

- **G1 Fake GPS:**
  - On the phone: check for mock locations (`isMock` on Android), spoofing apps such as Lockito, and rooted phones.
  - On the server: check for impossible speeds, sudden jumps and perfectly straight trails.
- **G2** A customer sees an agent's location only during their own active errand, never while the agent is offline or off duty.
- **G3** Location is collected only while the agent is online or on an errand.
- **G4** GPS trails are deleted after 90 days by a scheduled job, unless a dispute or investigation is open.

## Referrals and promos (F)

- **F1** Promo and referral limits are enforced by unique database constraints: one redemption per user per code, and one referral reward per verified ID hash.
- **F2 Agent referral bonus:**
  - Paid only after the new agent completes the set number of errands for at least the set number of different verified customers (admin settings).
  - Paid 14 days after that, by a delayed job, and capped per referrer.
  - Reversed through the ledger if fraud is found.
- **F3** Errand counts that admin sees for tier decisions leave out errands flagged for fraud.
- **F4** *After launch:* map referral chains to find shared devices, IP addresses and payout banks.

## Admin panel and staff (D)

- **D1** The admin panel and admin API sit behind zero-trust access, such as Cloudflare Access or Google IAP, with single sign-on. They are not reachable from the open internet.
- **D2** Passkeys (WebAuthn) for every role that can move money, approve refunds or see ID data. An authenticator app is the minimum for every other role.
- **D3 Roles:**
  - Separate roles for support, verification, disputes, finance, safety, operations and super-admin, each with the least access it needs.
  - The server rejects any approval where the approver is the person who made the request.
- **D4 Two-person approval on:**
  - every support refund and wallet adjustment
  - dispute splits above the set amount
  - changes to fees, timers and limits
  - role changes
  - bans of high-volume agents
- **D5** NIN, BVN and selfies are masked by default. Revealing one needs a reason, is logged, and is capped per staff member per day.
- **D6** Admin sessions end after 15 idle minutes and after 8 hours in total. Money actions ask staff to sign in again.
- **D7 Audit log:**
  - Records who, what, when, from which IP, the values before and after, and the reason.
  - It is append-only and copied to write-once storage (S3 Object Lock) in a separate AWS account that admins can't change.
- **D8** *After launch:* alerts on unusual ID reveals, adjustments to accounts linked to staff, and money actions out of hours.

## Servers and data (S)

- **S1** Separate AWS accounts for production and staging, MFA on every console login, infrastructure written as code, and the database in private subnets with no public address.
- **S2** Secrets live in Secrets Manager. Leaked keys are caught by secret scanning before each commit and in CI, and an exposed key is rotated at once.
- **S3** TLS 1.2 or higher and HSTS everywhere. Field encryption as in I6.
- **S4 Backups:**
  - Automatic, encrypted and locked against deletion, in a separate account.
  - A restore is tested every month.
  - For the ledger, lose at most 15 minutes of data and be back within 4 hours.
- **S5** A WAF and DDoS protection in front of the API, plus rate limits on every route (`@nestjs/throttler` with Redis storage).
- **S6 Live money alerts on:**
  - reconciliation gaps
  - payouts well above normal
  - one bank account receiving from several agents
  - failed webhook signatures
  - payouts rejected by the approval URL
  - admin wallet adjustments
  - refunds out of hours
  - SMS spend spikes
- **S7** Logs are kept in one place for at least a year, with no secrets or personal data (R10).
- **S8** Every endpoint is listed in an OpenAPI document, old API versions are switched off, and there are no debug endpoints in production.
- **S9** Responses from Paystack, the identity provider and every other outside service are validated like user input, with timeouts, and redirects are never followed blindly.
- **S10** CI runs on every change: Semgrep or CodeQL, dependency scanning, secret scanning and container image scanning. OWASP ZAP runs against staging.
- **S11** Publish `security.txt` and a page for reporting security bugs.

## Mobile apps (MB)

- **MB1** No secrets in the apps, only public keys.
- **MB2** Tokens are stored only in Keychain or Keystore (`expo-secure-store`). Nothing sensitive goes into logs or phone backups.
- **MB3 App attestation:**
  - Google Play Integrity on Android and App Attest on iOS, checked on the server with a single-use nonce.
  - Required for login, payouts, payout-account changes and going online.
  - A doubtful result asks for extra checks, such as a selfie, rather than blocking everyone.
- **MB4** Rooted or jailbroken phones, emulators, hooking tools such as Frida and virtual cameras are detected and sent to the server as risk signals.
- **MB5** Deep links are validated, and no screen can be opened without login.
- **MB6** Only a few vetted SDKs are used.
- **MB7** *After launch:* certificate pinning with a backup pin and a remote switch, plus code obfuscation.
- **MB8** Targets: OWASP MASVS level 2 plus resilience, the OWASP Mobile Top 10 (2024) and the OWASP API Security Top 10 (2023).

## Changes to features already built (X)

These came with the security plan. They change features already built from the product spec.

- **X1 Auto-release stays at 24 hours** for drop-off photos, for both the errand fee and the item money. Push and SMS reminders go out 2, 12 and 20 hours after the photo (admin setting).
- **X2 New admin queue: drop-off photos awaiting approval**, each with its 24-hour timer. Admin can:
  - pause the timer
  - freeze the escrow
  - decide early: release, refund or split

  An admin decision replaces the automatic outcome.
- **X3 Notifications:** the auto-release reminder becomes three reminders at 2, 12 and 20 hours, each by push and SMS.
- **X4 Login on a new device** needs the code plus a fresh selfie before any wallet action, and starts the 48-hour hold (A4, A6).
- **X5 Agent referral bonus** follows F2. Admin referral settings become:
  - bonus amount
  - errands required
  - different verified customers required
  - days before it's paid (default 14)
  - cap per referrer
- **X6 Staff login** uses passkeys for money and ID roles (D2), not plain two-factor.
- **X7 Two-person approval** covers everything in D4, not only refunds and wallet adjustments.
- **X8 Hand-off PIN** gets lock-and-freeze after 5 wrong entries and the 200 m distance check (E4).
- **X9 New ledger accounts** for promo and referral spending and payouts in progress (L6).
- **X10 New admin settings group, Security.** Per country, versioned, and changed only with two-person approval. It holds:
  - code tries and sends (5 tries; 3 sends per 15 minutes, 10 a day)
  - account-change hold (48 hours)
  - PIN tries (5) and PIN distance (200 m)
  - auto-release reminder times (2, 12 and 20 hours)
  - offer limit (5 a minute)
  - instant-payout caps per agent and platform-wide
  - the dispute-split amount that needs a second admin
  - daily ID reveals per staff member
  - signed-link expiry (5 minutes)
  - GPS trail retention (90 days)

## Done means

- `docs/security-audit.md` shows every requirement as one of:
  - done, with its test
  - an owner's task (below)
  - marked *after launch*
- The concurrency, invariant and access tests pass in CI.
- Findings from the independent penetration test are fixed.

## Owner's tasks (not for Claude Code)

Claude Code prepares what each task needs, as noted, but a person completes it.

- **Paystack dashboard:**
  - lock the secret key to our fixed IP addresses
  - register the transfer approval URL
  - turn on 2FA for every team member
  - give each member the least access they need

  Claude Code provides the IP addresses and the endpoint URL.
- **Identity provider:** pick one that shows the certification and testing in I2.
- **Penetration test** by an independent firm, before launch, then yearly and after big changes to money flows. Scope:
  - many requests at once on every money and limit action
  - access across two test accounts per role
  - forged and replayed webhooks
  - admin privilege escalation
  - app tampering
- **Legal:**
  - the CBN licence opinion on the pooled wallet
  - a Data Protection Officer
  - NDPC registration
  - the data protection impact assessment
  - data processing agreements with every provider
- **Incident plan** with an incident lead and reports drafted in advance:
  - the NDPC within 72 hours of a personal-data breach
  - ngCERT within 72 hours of a cyber incident, under the Cybercrimes (Amendment) Act 2024, which fines ₦2 million for not reporting

  Claude Code makes sure alerts and logs give the detail these reports need.
- **Staff:** background checks, confidentiality agreements, access removed on the day someone leaves, and access reviews every quarter.
