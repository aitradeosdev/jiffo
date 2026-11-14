# Dependencies and known advisories

How Jiffo keeps track of the code it uses from others (docs/security-plan.md, R11).

## The checks

- **Lockfile.** `pnpm-lock.yaml` pins every package. CI installs with `--frozen-lockfile`, so a build never
  picks up a version nobody reviewed.
- **Audit in CI.** `pnpm audit --prod --audit-level=high` runs on every push and pull request
  (`.github/workflows/ci.yml`). It fails on a high or critical advisory in anything the apps ship. Build and
  test tools are left out of this gate: they never reach a phone, the panel or the API's servers.
- **Dependency review.** On a pull request, `actions/dependency-review-action` fails when the change adds or
  updates a package the apps ship to a version with a high or critical advisory (`.github/workflows/security.yml`).
- **Dependabot.** Opens weekly pull requests for npm packages and for the GitHub Actions the workflows use
  (`.github/dependabot.yml`). Build and test tools come grouped in one pull request.
- **Code and secret scanning.** CodeQL (security-extended queries) and gitleaks run on every push, every pull
  request and once a week (`.github/workflows/security.yml`). GitHub's own secret scanning, with push
  protection, is on for the repository.

## Advisories we've accepted for now

Each one is listed under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` and `allow-ghsas` in
`security.yml`, so the gates pass. Take it off both lists once it's fixed.

| Advisory | Package | Why it doesn't reach Jiffo today | Fix |
| --- | --- | --- | --- |
| [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) | `drizzle-orm` < 0.45.2 | It's about SQL identifiers built from untrusted input. Jiffo's table and column names come only from the schema and constants in the code, never from a request. Values always go through parameters. | Upgrade to 0.45.2 or later in its own pull request. The query builder changed between 0.36 and 0.45, so every query needs retesting. |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | `zod` < 4.6.6 | Zod can use a lot of memory checking a very large list against a size limit. JSON request bodies are capped at Express's 100 kB before zod sees them, so no list can be large, and every route is rate limited. | Upgrade to zod 4 in its own pull request. It's a major version, with changes to error messages and some schema methods. |

The test tools (`vitest` and what it pulls in, `vite` and `tinypool`) also have advisories. `vitest` is on 3.2.7,
the newest 3.x. The rest goes away with the move to `vitest` 4. None of them is in what the apps ship.

## Adding a package

Before adding one, check the list in [sdks.md](sdks.md) and whether something already there does the job. If it
doesn't, add the package to that list in the same pull request, with what it's for and what it can reach.
