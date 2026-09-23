# Agent brief — read this before you start (every spawned agent)

The lead pastes your task; these rules apply to every task. They exist because
each one was broken at least once on 2026-09-23. CLAUDE.md still wins where it
says more.

## Where you work
- You are in your own git worktree. Work only there. If you ever find your cwd
  is the shared checkout (`/Users/lexilombas/louisianahelpr` itself), stop and
  move into your worktree — never edit or commit from the shared checkout.
- Never `git stash` (refs/stash is shared by every worktree).
- Evidence (screenshots, logs, measurements) goes under `~/.lh-shots/<task>/`,
  NOT inside your worktree — worktrees are deleted when you finish.

## Checks you run (and don't)
- Do NOT run repo-wide `npx vitest run` or `npm run gate` — the lead
  serializes those (8 GB Mac). Use `node scripts/parsecheck.mjs <file>` and
  targeted `npx vitest run <files>`.
- DO run `npm run typecheck` once, right before you push (about a minute; it
  takes the shared gate lock itself). parsecheck cannot see a missing tsconfig
  include, an untyped .mjs import or a lib method: three lanes turned main's
  typecheck red that way on 2026-09-23. New shared module imported by a test?
  List it in tsconfig.app.json. New .mjs imported by TS? Give it a .d.mts.
- Before pushing: `npm run inventories:refresh`, then `npm run check:generated`
  and `npm run check:counts` (a new test moves the generated burn-down score;
  skipping this turned main red on 2026-09-23).
- Browser work: one agent at a time; record every screenshot you judge with
  `cd /Users/lexilombas/louisianahelpr && npm run review:record -- <png> <screen> <checked> <ok|defect> [note]`.

## Guards you write
- Every new guard carries `// @mutate <file> | <find> | <replace>` (escape `|`
  inside it as `\|`) and an inventory floor (`expect(n).toBeGreaterThan(k)`).
- PROVE IT RED on the broken state — revert the fix or plant the defect and run
  it — not only on a synthetic fixture. A parser can silently read the wrong
  file (a `$fn$`-only parser read the old function body and stayed green).
- Migration-reading guards must accept any dollar-quote tag and read the NEWEST
  definition. Source-scanning guards must ignore comments, using the shared
  helpers in src/test/helpers/blankNonCode.ts (`blankComments`,
  `blankSqlComments`), never a regex comment stripper: guardsDoNotDeleteSource
  fails on one, and four new guards did it on 2026-09-23.
- Before pushing ANY new or changed test, also run the repo-wide guards that
  scan every test file; each turned main red at least once on 2026-09-23
  because a lane ran only its own test:
  `npx vitest run src/test/baselinesAreTwoWay.test.ts src/test/guardsDoNotDeleteSource.test.ts src/test/guardsReadTheNewestMigration.test.ts src/test/liveCheckScriptsFailClosed.test.ts src/test/fixtureSchemaContract.test.ts src/test/helprNotHelperInCopy.test.ts src/test/queueItemsNameTheirGuard.test.ts src/test/e2eImportsInAppTsconfig.test.ts src/test/noConflictMarkers.test.ts`

## Data and prod
- Prod (`fncmgoasalhdgfwzhsqa`) is the only database. Read-only SQL is fine;
  writes only to test-owned records, marked `is_seed`, cleaned up after.
- Migrations: `npm run migration:new -- <slug>`, replay-safe, applied 3× in
  PGlite (installed at `~/.lh-pglite`, outside the repo), `REVOKE ... FROM
  PUBLIC, anon`. They auto-deploy on push — watch the db-deploy run to green and
  verify live with `pg_get_functiondef` / `pg_proc.proacl`.
- Money / authz / data-model changes get a REVIEW-ONLY pass (lh-authz-rls,
  lh-silent-failure or lh-money-escrow) — say in your report what needs one.

## Landing
- Commit in your worktree, then
  `git fetch origin && git rebase origin/main && git push --no-verify origin HEAD:main`.
- End commits with the Co-Authored-By line from CLAUDE.md.
- If a rebase stops on a conflict, resolve it (for generated files: take
  origin's version, then regenerate) and `git rebase --continue`. Never
  `git commit` while `git status` says a rebase is in progress.
- Update `docs/OPEN.md`: tick an item `[x]` ONLY with the guard that stops it
  recurring named in its text (else `[~]`), then run
  `node scripts/queue-count.mjs --write`. Anything you notice but don't fix
  becomes a new queue item — nothing lives outside `docs/OPEN.md`.
- A new queue item takes the number `node scripts/queue-count.mjs` prints as
  "next free", read right before you write it (and again after a rebase):
  parallel lanes guessed the same number three times on 2026-09-23.

## Waiting (no orphan shells)
Never run `scripts/vacuity/index.mjs` without `--only <test file>` in a shared checkout: a full run MUTATES source files for 15+ minutes, and if it is killed mid-run the mutation stays (2026-09-23: `/terms` became a redirect and `/settings` pointed at /my-jobs in the main tree). After killing any process, confirm with `ps` that it is gone and `git status` that nothing it touched is left modified.
Wait with ONE `run_in_background` command and let its notification wake you.
Never re-issue a foreground `until`/`sleep` loop: a timed-out foreground call
leaves its shell running (2026-09-23: five identical "until 14:42" loops piled
up). Before your report, `ps` for your own wait loops and kill any still running.

## Your report
State what you MEASURED (numbers, run ids, before/after), what you could not
verify and why, and the red→green proof for each guard. "I don't know" beats a
confident guess.
