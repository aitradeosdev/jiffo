## What this changes

## Why

## Security checklist

Tick what applies, and say how in the description. A pull request that touches sign-in, money, admin or webhooks
gets the `security-review` label.

- [ ] New feature: a short threat model is written ([template](../docs/security/threat-model.md)).
- [ ] New or changed routes: `docs/api/openapi.json` is regenerated (`pnpm --filter @jiffo/api openapi`), and
      every new route says who may call it and has a fitting rate-limit class.
- [ ] Requests are checked with a zod schema; unknown fields are refused.
- [ ] Anyone can only see or change their own things (errand, wallet, chat, account) — tested with another
      person's IDs.
- [ ] Money moves only through the ledger, and every new path has a test that it balances.
- [ ] No secrets, keys, ID numbers or bank details in code, logs, tests or messages.
- [ ] Limits and amounts come from country settings, not the code.
- [ ] Abuse cases have tests, written before the fix.
- [ ] New packages are added to [docs/security/sdks.md](../docs/security/sdks.md) with what they're for.
