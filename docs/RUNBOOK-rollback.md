# Rollback runbook: the three undo paths (Q69)

Script: `scripts/rollback/rollback.mjs`. Guard: `src/test/rollbackDryRunNeverMutates.test.ts`
(a dry run of every path calls only read commands; shown red on three mutations).

**Written 2026-09-23.** Live drills since: web (2026-09-27) and edge function
(2026-10-07); see the drill log at the bottom. The script appends each step's
duration to `~/.lh-rollback/timing.jsonl` (or `--log <file>`); paste the totals into
the drill log.

## The rule of the script

- **Dry run is the default.** It prints every command in order, marked `[WOULD ]`, and
  runs only the reads (`vercel list/inspect/rollback status`, `supabase migration list`,
  `supabase functions list`, `git log`) so the plan names real deployment URLs and SHAs.
  `--offline` prints the reads too instead of running them.
- **Live needs two switches:** `--execute` AND `LH_ROLLBACK_CONFIRM=<path>` in the
  environment (`web`, `migration` or `function`). With only one, it refuses and runs dry.
  `plan` never runs live.
- **Every step is timed**, dry or live, into the timing log (`--log <file>` to move it).

```sh
node scripts/rollback/rollback.mjs plan                  # all three, dry
node scripts/rollback/rollback.mjs web                   # dry: shows the target deploy
LH_ROLLBACK_CONFIRM=web node scripts/rollback/rollback.mjs web --execute
```

Needs on the machine running it: `vercel` CLI logged in to team
`team_UQHppAVoPIPQbyh2b43y21BG` (or `VERCEL_TOKEN`), `supabase` CLI with
`SUPABASE_ACCESS_TOKEN` and the project linked to `fncmgoasalhdgfwzhsqa`, and push
rights to `main`.

## Which path do I need?

| Symptom | Path | Why this one |
|---|---|---|
| The web app is broken after a deploy, the data is fine | **1. Web** | Instant, no rebuild, nothing in the DB changes |
| A migration broke a query, RPC, policy or trigger | **2. Migration** | Migrations only reach prod through `db-deploy.yml`, so the undo is a NEW forward migration |
| One edge function misbehaves (payments, webhooks, email) | **3. Function** | Redeploys one function from an earlier commit |
| The iOS/Android app is broken | none of these | The native app bundles its own `dist/` (`capacitor.config.ts` has no `server.url`), so a Vercel rollback does not reach it. See "The app build" below |

A bad release often needs two of these at once: roll the web back first (it takes
seconds), then revert the migration or function.

## 1. Web: Vercel instant rollback

1. `node scripts/rollback/rollback.mjs web`. The dry run lists production deployments
   and picks the one BEFORE the current one (use `--to <url>` to choose another).
   Check the target in the output: `vercel inspect` must say READY.
2. `LH_ROLLBACK_CONFIRM=web node scripts/rollback/rollback.mjs web --execute` runs
   `vercel rollback <target> --yes`, then `vercel rollback status` to wait for it.
3. Verify: `curl -s https://louisianahelpr.com | grep build-commit` must show the
   TARGET deployment's commit (the `<meta name="build-commit">` stamp that
   `prod-freshness.yml` reads). Expect prod-freshness to go RED while rolled back:
   prod is deliberately serving a commit older than main. It clears when the fix is promoted.
4. Ship the fix: land it on `main` as usual (pushes do not deploy; `.github/workflows/prod-deploy.yml`
   ships main within ~20 min, or run `gh workflow run prod-deploy.yml`), then `vercel promote <fixed-deployment-url>`.
   Promoting explicitly is right however Vercel treats new deploys after a rollback.
   The first drill should record whether the next push went live on its own.

Only production traffic moves. Nothing in Supabase changes.

## 2. Migration: revert with a new forward migration

**Never** delete, rename or edit an applied migration file, and never use MCP
`apply_migration` (CLAUDE.md). Prod's `schema_migrations` holds the version, so the
undo goes forward like any other change.

1. Write the down SQL to `supabase/rollbacks/<version>.down.sql` (or pass
   `--down <file>`). Every statement must be replay-safe: `DROP ... IF EXISTS`,
   `IF to_regprocedure(...) IS NOT NULL`, and `CREATE OR REPLACE` of the PREVIOUS
   function body, copied from the newest migration before the bad one. Grants go back
   `FROM PUBLIC, anon`.
2. `node scripts/rollback/rollback.mjs migration --version <14-digit>` (dry run). It
   checks `supabase migration list --linked` and lists recent migrations, so a revert
   never undoes a later lane's work on the same objects.
3. `LH_ROLLBACK_CONFIRM=migration node scripts/rollback/rollback.mjs migration --version <v> --execute`:
   - stamps `<new>_revert_<v>.sql` with `npm run migration:new` (never a hand-typed timestamp),
   - writes the down SQL into it,
   - runs `scripts/rollback/pglite-apply.mjs`: the bad migration once, then the revert 3×
     in PGlite (`~/.lh-pglite`; `--prelude <schema.sql>` if it needs real tables),
   - commits, then `git push origin HEAD:main`, which lets `db-deploy.yml` apply it.
4. Watch db-deploy to green, then verify by OBJECT STATE (`pg_get_functiondef`,
   `to_regclass`, `pg_proc.proacl`), never by run colour.

Data warning: a revert of `ADD COLUMN` is a `DROP COLUMN`, and
`scripts/check-destructive-ddl.mjs` fails it unless the three `DESTRUCTIVE-DDL-ACK`
lines sit right above the statement. That is intended: rows written since the bad
migration are lost with the column, and getting them back means a database restore
(`docs/runbooks/restore-from-backup.md`), which is a much bigger operation.

## 3. Edge function: redeploy a previous version

1. `node scripts/rollback/rollback.mjs function --name <fn>` (dry run). It picks the
   commit before the latest change to `supabase/functions/<fn>` or `_shared`
   (`--to <sha>` to choose another) and shows what prod runs now.
2. `LH_ROLLBACK_CONFIRM=function node scripts/rollback/rollback.mjs function --name <fn> --execute`
   checks that SHA out in a temporary worktree, runs
   `supabase functions deploy <fn> --project-ref fncmgoasalhdgfwzhsqa --workdir <tree>`,
   then removes the worktree.
3. **Also land `git revert <bad-sha>` on `main`.** `functions-deploy.yml` redeploys
   main's copy on the next push that touches the function or `_shared/`, which would
   quietly undo the rollback.
4. Verify with `edge-function-smoke.yml`, or by calling the function and checking the
   version and `updated_at` in `supabase functions list`.

## The app build: ship the fix, then ask for an expedited review (owner, 2026-10-07)

Nothing can pull a build off a user's phone, and the app is never hidden from the
App Store (owner, 2026-10-07: "no need to hide from app store ever"; Remove from
Sale is not a rollback path here). Most breakage is fixed faster by paths 1-3: a web
or backend rollback reaches native users at once, because the app loads the same
Supabase project. When the fix has to be in the binary:

1. Fix it on `main` the normal way (`bash scripts/land.sh`).
2. Ship it: `bundle exec fastlane ios release` (bumps the build, archives, uploads
   and submits for review with `automatic_release: true`), or the `release` lane of
   `deploy.yml`. `docs/IOS_BUILD_RUNBOOK.md` has the build steps.
3. Request an expedited review (OWNER, App Store Connect): open the submission's
   page in App Store Connect; on the App Review contact page
   (developer.apple.com/contact/app-store/?topic=expedite) choose "Request an
   expedited app review", pick the app and the version just submitted, and write in
   two or three sentences what is broken for customers right now, since which
   version, and what the fix changes, e.g. "Version 1.0.7 crashes on launch for every
   user on iOS 26 because <cause>; 1.0.8 fixes only that crash. Customers cannot
   open the app until it is approved." Apple grants a limited number of expedited
   reviews per year, so use it ONLY for real customer-facing breakage (a crash, a
   broken sign-in, payments failing), never for a test build or a drill: there is
   no timing drill for this step on purpose.

## Drill log

| Date | Path | Who | Dry-run total | Live total | Notes |
|---|---|---|---|---|---|
| 2026-09-26 | plan (all three) | cloud session (cloud/open-audits) | 29 ms (vercel/supabase CLIs absent: reads fell back to placeholders, as designed) | — | `node scripts/rollback/rollback.mjs plan`: 16 steps printed, 0 mutating calls. |
| 2026-09-26 | migration | cloud session (cloud/open-audits) | — | PGlite 11.9 s wall (15 ms of SQL) | Drilled on the newest migration, 20260925155322 (run_missed_cron_catch_up): down SQL = 20260923172145's body + its REVOKE/GRANT; bad x1 then revert x3, all applied. Not pushed (a drill, not an incident). |
| 2026-09-27 | web (LIVE) | rollback-drill.yml run 36357336613 (workflow_dispatch, repo VERCEL_TOKEN) | — | rollback request→live 6 s; promote-back request→live 5 s; job ~12 s of drill | Live served 60ca5b6c2 (dpl_6qyhVSZeeTn49VH9JU9YA9j5Fwkg); rolled back to 268beee84 (dpl_AFJBz1feXcPTvKrMsTfueMYxL1cG), then promoted the original back. After restore the project showed `{"lastRollbackTarget":null}`, and the next batched deploy (308da8fe8, committed 23:09Z) went live on its own, so auto-assignment was not left off. |
| 2026-10-07 | function (LIVE) | money lane A, local Mac (supabase CLI 2.119.0, no Docker) | — | 4.0 s total: worktree add 0.87 s, `supabase functions deploy` 2.0 s, worktree remove 0.27 s (prod list read 0.86 s) | Owner-approved same-code drill (Q835): brand-asset redeployed at main 6c159488d, so nothing changed for users. Prod version 178 → 179 (`supabase functions list`), `brand-asset?health=1` answered 200 image/png after. The local CLI bundled without Docker; the bundle hash differs from CI's (ezbr_sha256 e922cf84… → ad212802…), so expect that after a hand rollback until functions-deploy redeploys main. |
| 2026-10-07 | App Store | — | — | — | No timing drill by design (owner): an expedited review is spent only on real customer breakage. The step is written above under "The app build". |

Re-drill quarterly (docs/OPEN.md Q69).
