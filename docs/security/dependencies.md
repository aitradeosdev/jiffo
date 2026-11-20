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
  It needs GitHub's dependency graph: turn it on under Settings, Advanced Security, then add the repository
  variable `DEPENDENCY_REVIEW` with the value `on` (Settings, Secrets and variables, Actions, Variables).
  Until then the job is skipped, and the audit in CI is the gate.
- **Dependabot.** Opens weekly pull requests for npm packages and for the GitHub Actions the workflows use
  (`.github/dependabot.yml`). Build and test tools come grouped in one pull request.
- **Code and secret scanning.** CodeQL (security-extended queries) and gitleaks run on every push, every pull
  request and once a week (`.github/workflows/security.yml`). GitHub's own secret scanning, with push
  protection, is on for the repository.

## Advisories we've accepted for now

None. To accept one for a while, list it under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` and `allow-ghsas`
in `security.yml`, so the gates pass, with a row here saying why it doesn't reach Jiffo and how it will be fixed.
Take it off all three once it's fixed.

The test tools (`vitest` and what it pulls in, `vite` and `tinypool`) also have advisories. `vitest` is on 3.2.7,
the newest 3.x. The rest goes away with the move to `vitest` 4. None of them is in what the apps ship.

## Patched packages

Each one is a file in `patches/`, listed under `patchedDependencies` in `pnpm-workspace.yaml`, and applied on every install. The package is pinned to the exact version the patch is for, so an upgrade (a Dependabot one too) fails to install until the patch is made again for the new version with `pnpm patch`, or dropped if it's no longer needed.

| Package | What the patch changes | Why |
| --- | --- | --- |
| `drizzle-orm` 0.45.4 (pinned exactly, so the patch always matches) | A failed query's message is the database's reason followed by the query (with `$1`-style placeholders), not the query followed by every value sent with it. For a value the database couldn't read (SQLSTATE class 22, such as invalid input syntax), whose reason quotes it, only the code is given. The values stay on the error's `params`, which the server never logs: it logs messages and stacks only. | Since 0.44 drizzle puts the values in the message, so any logged database error would carry people's phone numbers, names or places into the logs, which must have none (R10, S7). Test: `db-errors`, which fails if the patch is missing. |

## Adding a package

Before adding one, check the list in [sdks.md](sdks.md) and whether something already there does the job. If it
doesn't, add the package to that list in the same pull request, with what it's for and what it can reach.
