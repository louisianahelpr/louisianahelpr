# restate-guard handoff (lane H, session 2, written 2026-10-17 ~05:50Z)

## State
- Worktree ~/.lh-wt/restate-guard, local branch ready/restate-guard @ 1e6079996 (one commit on origin/main 64948824e). Clean tree.
- PUSHED: origin/wip/restate-guard @ 1e6079996.
- origin/ready/restate-guard is STILL the old pre-rebase e7c6ea9fa. Once all checks below are green, force-push:
  `git -c core.hooksPath=/dev/null push --force-with-lease=ready/restate-guard:e7c6ea9fa origin HEAD:ready/restate-guard`
  then report "restate-guard ready <sha>". Do NOT run land.sh. The lead wants this branch landed NEXT.
- The local branch's upstream is now origin/wip/restate-guard (a side effect of `push -u`).

## Rebase (e7c6ea9fa -> 1e6079996)
- Clean, no conflicts. `git log e019bcde0..origin/main -- scripts/land.sh .github/workflows/migration-lint.yml` was EMPTY:
  neither file changed on main in the ~232 commits since, so the land.sh call (after the typesCoverMigrationFunctions/nullArgNeverAllows twins block)
  and the migration-lint.yml step + `diff_base` output sit exactly where they were. Nothing re-placed, nothing changed in the commit.

## Checker on main
- `node scripts/check-out-of-order-restatements.mjs --base origin/main --head origin/main` -> rc 0, "0 migration(s) added ... 0 conflict(s)" (trivial: nothing added).
- Whole-history replay (~/.lh-wt/restate-guard-history.mjs <worktree>; ~4.5 min): for each of the 1,062 main migrations with a first-parent arrival commit,
  prod order is modelled as arrival-push order (push group = same committer timestamp; version order inside a group), against replay = version order.
  190 out-of-order arrivals, 445 objects touched by them, 1 "divergence": public.notify_business_approvers(), where BOTH the prod-last and
  replay-last files only DROP it (20260831232522 vs 20260901004926). Absent either way, so it is NOT a real overwrite. Real unreconciled overwrites: 0.
  Caveat: this is an arrival-order model from git, not a reading of prod; batching by db-deploy only moves prod closer to version order.
- Per-push CLI run for every one of the 24 push groups since 2026-10-01 that carried an out-of-order migration (`--base <first commit of the group>^ --head <last>`):
  all rc 0, 0 conflicts. This includes the declutter push 2026-10-16T01:37:00Z (61c02d214^..c482e75e9: 7 added, 6 out of order).
- The reconcile is recognised: ~/.lh-wt/restate-guard-recon.mjs <worktree> 61c02d2145ab4fb6dd08ec5fbce39d2086aed36c^ c482e75e922a96f6da655ab45d47c0d79cc90159
  -> with all 7 added files: [] ; without 20261015084728_export_my_data_declutter_reconcile.sql: 3 conflicts on public.export_my_data(uuid)
  (210518, 224914, 042253 vs 20261015052622). So no checker change was needed. 084728 mentions category_suggestions 3 times (grep), i.e. it restates the union.

## Checks
DONE (green, under the heavy lock):
- `npx vitest run src/test/outOfOrderRestatements.test.ts`: 19/19 passed.
- `npm run typecheck`: rc 0 (tsc -b, plus edge 234 files with 0 errors).
- parsecheck on the .mjs and the test: OK.
NOT RUN (the lock was held by "lander A recheck+land.sh" from 05:13Z through at least 05:43Z):
- `npx eslint --quiet scripts/check-out-of-order-restatements.mjs src/test/outOfOrderRestatements.test.ts`
- land.sh vitest run 1: `node ~/.lh-tools/allchunks.mjs ~/.lh-wt/restate-guard` (--changed origin/main, every chunk)
- land.sh vitest run 2: the 35 files in ~/.lh-wt/restate-guard-named-tests.txt (basename greps + landPathReaders for the 5 changed files + land.sh's 6 fixed guards),
  in one chunk: `npx vitest run $(cat ~/.lh-wt/restate-guard-named-tests.txt)`
- the guards in ~/.lh-tools/ci-only-guards.txt (map each name to src/test/<name>.test.ts)
- `node scripts/check-generated-current.mjs --skip-post-merge` (check:generated) and `npm run check:counts`. A new test file may move the
  generated burn-down/inventories: if check:generated is red, run `npm run inventories:refresh`, commit the regenerated files, then re-check.
Run each as its own `if mkdir ~/.lh-heavy.lock; then ...; rm -rf ~/.lh-heavy.lock; fi` command, and never while ~/.lh-heavy.landing-waiting exists. NODE_OPTIONS=--max-old-space-size=3584.

## Traps
- zsh does not word-split unquoted vars: build NAMED_TESTS under `bash -c`, or the list comes out empty.
- My background lock waiter was killed once (exit 144). Re-arm it with run_in_background rather than a foreground loop.
