# Threat model template

Write one for each new feature before building it (docs/security-plan.md, R14). Keep it short: half a page is
usually enough. Put it in the pull request description, or in `docs/security/features/` for a big feature, and
link it from the pull request.

Copy everything below the line.

---

## Feature: <name>

**What it does, in a sentence or two.**

**What it touches.** Tick what applies:

- [ ] Money: balances, top-ups, holds, payouts, fees
- [ ] Sign-in, sessions or devices
- [ ] Personal details: names, phone numbers, ID numbers, bank details, photos, locations
- [ ] Admin powers
- [ ] A provider: payments, SMS, identity, calls, maps, push, storage
- [ ] A webhook or a public route (no sign-in)

**Who could abuse it, and how.** Think of each of these:

| Who | What they might try | What stops them |
| --- | --- | --- |
| A customer | e.g. get an errand done without paying, see another customer's errand | |
| An agent | e.g. get paid for work not done, take more than the fee, see a customer's details after the job | |
| A customer and an agent working together | e.g. move money between them through fake errands | |
| Someone with a stolen phone or a copied session | | |
| A staff member | e.g. pay themselves, look up someone's details without a reason | |
| Anyone on the internet | e.g. call the route without signing in, guess IDs, send it thousands of times, forge a webhook | |

**Limits.** Which rate-limit class the new routes use (`x-rate-limit` in `docs/api/openapi.json`), and any
per-person or per-day limit, kept in country settings rather than in the code.

**Logs and alerts.** What's written to the audit log, and what raises an alert.

**Tests.** The abuse cases above, each as a test that fails without the protection.
