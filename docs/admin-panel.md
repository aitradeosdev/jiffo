# Admin panel

`apps/admin` is the web panel Jiffo staff use. Setting it up is in the [README](../README.md#admin-panel); this page covers what it does, who can do what, and how it is protected.

## What's in it

- **Overview:** today's errands, agents online, net revenue (revenue less payment provider costs), top-ups and the fees Jiffo absorbs, withdrawals, and anything that needs attention.
- **Errands and disputes:** search every errand, read its full history (timeline, chat, photos, money), and settle disputes, the standard way or by splitting the money held.
- **People:** customers and agents, with their activity and money; set agent tiers, suspend and reactivate accounts, and adjust balances.
- **Applications:** agent applications by state. The ones whose checks didn't all pass wait in review, longest first; operations approves or declines each from the agent's page, seeing the provider's results and what the agent typed, never their documents. A decline's reason is shown to the agent.
- **ID checks:** customers' ID checks by state. Those the provider couldn't settle wait in review, longest first; operations verifies or declines each from the customer's page (never with an ID another customer holds), or reopens a declined one so they can check again. The decline's reason is shown to the customer. The providers page says which IDs each identity provider checks.
- **Money:** what Jiffo holds, earns and pays providers (net revenue), top-ups by way of paying in, customers' own account numbers and what issuing them cost, withdrawals and the nightly check against the payment provider.
- **Settings:** prices, fees, commission, timers, limits and identity rules as versioned settings, plus categories and states. Identity has a switch each for customers' and agents' ID checks (docs/security/controls.md, Identity checks). Sign-in codes can be switched to Test per country (Settings, Security): no texts are sent and the app shows each code, and every page warns while one is on.
- **Team and audit log:** who can use the panel, and every change anyone made in it.

## Roles

| Role         | Can                                                                |
| ------------ | ------------------------------------------------------------------ |
| Owner        | Everything, including the team, settings, providers and audit log  |
| Operations   | Errands, disputes, the Risk and Safety queues, suspending accounts and agent tiers |
| Disputes     | Settling disputes                                                  |
| Verification | Agent applications, customers' ID checks and shared-account flags  |
| Finance      | Money: refunds, wallet adjustments, payout accounts and the checks |
| Safety       | The Safety queue, and suspending accounts that put people at risk  |
| Support      | Look at everything, change nothing                                 |

## Signing in

A new teammate opens their invite link to choose a password. The first sign-in sets up an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), and every sign-in after that needs its code.

Five wrong passwords for one email from one network, or five wrong codes for one admin, pause sign-in for 15 minutes; a reset lifts the pause.

### Passkeys

Owners, Operations, Disputes, Finance and Verification move money, settle disputes (refunding customers) or see ID data, so they sign in with a passkey: the fingerprint, face or PIN on their phone or laptop. After their first sign-in with the app's code, they add one before they can do anything else, and from then on sign in with it instead of the code. Passkeys work only on the panel's own address (`ADMIN_URL`), so a look-alike site can't use one. Anyone else may add one too. Adding a passkey needs a recent confirm, as money actions do, so a stolen session can't add its own; a reset removes the teammate's passkeys along with the password and app.

### Sessions

A session ends after 15 minutes without activity and 8 hours in all. Money actions (adjustments, payout accounts, the nightly checks, settling a dispute, approving a request, changing a provider) also need the admin to have confirmed it's them in the last 5 minutes, with their passkey or a fresh code; the panel asks, then sends them back to do it again. Set these with `ADMIN_IDLE_MINUTES`, `ADMIN_SESSION_HOURS` and `ADMIN_CONFIRM_MINUTES`.

## Inviting the team

Owners invite everyone else from the Team page. Invite and reset links are emailed only to the teammate, never shown to whoever made them, so set up an email provider (Resend, Postmark or Amazon SES) under Settings, Providers first. On your own machine they're printed in the API's log; on a shared server outside production, such as staging, set `EMAIL_PROVIDER=none` so links never reach a log. The provider's Test button sends you a test email. If the only owner loses their phone, `pnpm admin reset --email ... --reason ...` prints a new link on the server. Both commands are recorded in the audit log as from the command line, with their reason.

## Staff and their own accounts

Every teammate gives their own phone number when invited: the number of the Jiffo customer or agent account they hold, or would hold. Nobody can change their own account from the panel, or an errand it is part of: not crediting or adjusting it, suspending or reactivating it, deciding its application or ID check, revealing its details, settling its dispute, or asking for or approving any of those. Someone else on the team must. It holds for every route, since the check is made where each change is recorded.

A teammate with no number yet can't change anyone's account until one is added; the Team page says who. Setting or changing a teammate's number waits for a second owner, who sees it, as an invite's does: one owner alone could otherwise choose a number that links nothing. A request whose asker has since lost their number won't run; reject it. Nobody changes their own number: another owner does, or `pnpm admin phone --email ... --phone ... --reason ...` on the server, for a team made before numbers were asked for.

## Two-person approval

These changes wait on the Approvals page until a second admin whose role allows them approves:

- every wallet adjustment and refund (finance or an owner)
- a dispute split paying the agent more than the set amount (Settings, Security; disputes, operations or an owner)
- every settings change, including fees, timers and limits (an owner)
- a new teammate, a role change, or giving a disabled teammate their access back (an owner)
- suspending an agent with at least the set number of completed errands (Settings, Security)
- switching a provider, or changing the keys of the one in use (an owner); the new keys wait sealed

The person who asked can never approve their own request, and the database refuses it too. An approved change runs as the person who asked, and the audit log shows both. When nobody else on the team has ever held the permission (a new team with a single owner, say), the change goes ahead at once and is marked as approved by the person who asked. Teammates who were disabled or reset still count, so nobody can go it alone by switching the others off; a team that has lost its other approvers adds one with `pnpm admin invite` on the server. Disabling a teammate always happens at once. Requests lapse after the hours set in Settings, Security (default 72).

## Disputes

The disputes team settles a dispute as complete or cancelled, the standard way or by splitting the money held: the fee between the agent, Jiffo and the customer, the item money between the agent and the customer, and, when the customer never locked the item amount, up to that amount from their wallet for the agent. Every action needs a reason, which stays in the timeline and the audit log and is never shown to the customer or agent.

## Audit log

Every change needs a reason of a few words, which the panel asks for beside it; the API refuses a change without one. The log keeps who made the change, when, from which network and browser, why, and for balances and account status the value before and after. The database refuses any edit, deletion or emptying of it, from the app or a stray query; whoever owns the database could still switch that off, which is why a copy outside it matters. Commands run with `pnpm admin` on the server are logged as from the command line, with their reason. A write-once copy kept outside the app (such as S3 Object Lock in a separate account) is for whoever runs the hosting.

## Personal details

Applications and ID checks show legal names, dates of birth, home addresses and emergency contacts masked, as `A••• O•••` and the year of birth. Anyone with the reveal permission (every role but support) can show one person's full details with a reason, which goes in the audit log, and can search those lists by legal name. Each staff member can reveal up to 20 people a day in each country; owners change that in Settings, Security. Payout accounts waiting for review show the legal name in full only to finance and owners, who compare it with the bank's. ID numbers and selfies aren't stored, so there is nothing of them to show.

## Its own address

In production the API answers admin routes only on `ADMIN_API_PORT`, and the apps' routes only on its public port, however a path is spelled. Put the admin port behind the team's access control (single sign-on, such as Cloudflare Access or Google IAP), not on the open internet, and point the panel's `API_URL` at it. The load balancer's `/health` check answers on both.

## In the browser

Every page gets a content policy with a fresh nonce: only the panel's own scripts run, and pages can't be framed. HTTPS is insisted on in production.
