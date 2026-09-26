# Rollback runbook: the three undo paths (Q69)

Script: `scripts/rollback/rollback.mjs`. Guard: `src/test/rollbackDryRunNeverMutates.test.ts`
(a dry run of every path calls only read commands; shown red on three mutations).

**Written 2026-09-23. No live drill has been run yet; the lead runs the first one.**
Every timing below is empty until that drill records one. The script appends each
step's duration to `~/.lh-rollback/timing.jsonl`; paste the totals into the drill log
at the bottom.

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

## The app build (not scripted)

Nothing can pull a build off a user's phone. The options are App Store Connect
actions (owner only): pause a phased release, remove the version from sale, or ship a
fixed build through `deploy.yml` (lane `release`) and ask App Review for an expedited
review. `docs/IOS_BUILD_RUNBOOK.md` has the build steps. A backend rollback (paths 2
and 3) does reach native users, because the app calls the same Supabase project.

## Drill log

| Date | Path | Who | Dry-run total | Live total | Notes |
|---|---|---|---|---|---|
| 2026-09-26 | plan (all three) | cloud session (cloud/open-audits) | 29 ms (vercel/supabase CLIs absent: reads fell back to placeholders, as designed) | — | `node scripts/rollback/rollback.mjs plan`: 16 steps printed, 0 mutating calls. |
| 2026-09-26 | migration | cloud session (cloud/open-audits) | — | PGlite 11.9 s wall (15 ms of SQL) | Drilled on the newest migration, 20260925155322 (run_missed_cron_catch_up): down SQL = 20260923172145's body + its REVOKE/GRANT; bad x1 then revert x3, all applied. Not pushed (a drill, not an incident). |
| (web + function live drills pending: they move PRODUCTION traffic / code, so the owner or lead runs them in a quiet hour) | | | | | |

Re-drill quarterly (docs/OPEN.md Q69).
