# Scoreboard — everything we test or track

<!-- generated: scoreboard (node scripts/scoreboard.mjs --write) — do not hand-edit -->

**What this is (Q59).** One row per signal we test or track: its status, pass / fail /
skipped / total, when it was measured and the run or source it came from. A row that
cannot be measured says **UNKNOWN** and why — never green. A CI result older than
8 days says **STALE**. Open work in one list: [docs/OPEN.md](OPEN.md).

Statuses: PASS · FAIL · WARN (open work, not a failure) · STALE · UNKNOWN · INFO (a number, no verdict).

## From the repo at this commit

Recomputed from committed files and diffed on every push by
`scripts/check-generated-current.mjs`, so these cannot be stale.

| group | signal | status | pass | fail | skipped | total | measured at | source | note |
|---|---|---|---|---|---|---|---|---|---|
| open work | OPEN.md queue (done / partly / open) | **WARN** | 59 | 82 | 10 partly | 151 | HEAD (diffed every push) | [docs/OPEN.md](OPEN.md) · scripts/queue-count.mjs | 59 done, 10 partly done (fixed, protection pending), 82 open |
| open work | audit bus findings (open / launch blockers) | **FAIL** | 205 | 165 | — | 429 | HEAD (diffed every push) | [ROLLUP.md](audit/launch-2026-09/ROLLUP.md) · `node scripts/audit-bus.mjs list --blockers` | 165 open, 8 open launch blockers; 205 fixed, 14 retracted, 28 duplicate, 0 wontfix, 17 obsolete |
| guards | vacuity: guards proven able to fail / exempt / owed | **PASS** | 750 | 0 | 8 exempt | 758 | HEAD (diffed every push) | [GUARD-BURNDOWN.md](GUARD-BURNDOWN.md) · `npm run vacuity` | registered @mutate per guard; whether each mutation is KILLED is the full-sweep row below |
| number currency | dead-code baseline (unused exports / types ceiling) | **INFO** | — | — | — | 97 exports, 11 types | HEAD (diffed every push) | scripts/deadcode-baseline.json · src/test/deadcodeRatchet.test.ts | a ratchet ceiling; whether knip stays under it is the test.yml Dead code step (live section) |
| number currency | undated stated counts (baselined, may only shrink) | **WARN** | — | 413 | — | 413 | HEAD (diffed every push) | scripts/stated-counts-baseline.json · `npm run check:counts` | each is a number in prose with no date; new ones already fail check:counts |
| notes | Zod v4 `script-src eval` CSP report per page | **INFO** | — | — | — | — | 2026-09-23 (Q13 note) | node_modules/zod/v4/core/schemas.js (`jit && allowsEval.value`) | harmless: Zod's allowsEval probe tries `new Function` once per page and the CSP blocks it, so each page logs one violation. `z.config({ jitless: true })` short-circuits the probe (measured in zod 4.5.4 source) — queued as Q83 |

## Measured live

GitHub Actions, prod (read-only SQL), git remotes and the local gate record. Refreshed by
`node scripts/scoreboard.mjs --write` and daily (19:17 UTC) by
`.github/workflows/scoreboard.yml` (job summary + artifact until Actions may commit, Q57).
`scripts/check-staleness.mjs` fails nightly when this section is older than 72h.

<!-- live: carried forward verbatim offline; refreshed by node scripts/scoreboard.mjs --write -->
**Live rows measured at 2026-09-23T06:08Z.**

| group | signal | status | pass | fail | skipped | total | measured at | source | note |
|---|---|---|---|---|---|---|---|---|---|
| tests | `npm run gate` (last local run) | **UNKNOWN** | — | — | — | — | attempted 2026-09-23T06:08Z | scripts/gate.mjs | UNKNOWN: no ~/.lh-gate/last.json on this machine — the gate runs locally only (scripts/gate.mjs writes it) |
| tests | test.yml steps (push to main) | **FAIL** | 9 | 1 | 13 | 23 | 2026-09-23T06:03Z | [run 35824971110](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971110) | failed: Committed inventories are current (regenerate and diff) |
| tests | ESLint (test.yml) | **UNKNOWN** | — | — | — | — | 2026-09-23T06:03Z | [run 35824971110](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971110) | UNKNOWN: step skipped (an earlier step failed) |
| tests | TypeScript type check (test.yml) | **UNKNOWN** | — | — | — | — | 2026-09-23T06:03Z | [run 35824971110](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971110) | UNKNOWN: step skipped (an earlier step failed) |
| tests | dead code / knip under baseline (test.yml) | **UNKNOWN** | — | — | — | — | 2026-09-23T06:03Z | [run 35824971110](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971110) | UNKNOWN: step skipped (an earlier step failed) |
| tests | Vitest (tests; files in note) | **FAIL** | 6675 | 32 | 1 | 6708 | 2026-09-23T06:04Z | [failure, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824485139) | counts from run 35824485139 (push, failure); files: 657 passed, 9 failed of 666 |
| suites on prod | prod-audit specs | **FAIL** | 198 | 10 | 17 | 225 | 2026-09-23T05:20Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35817028797) | counts from run 35817028797 (workflow_dispatch, failure) |
| suites on prod | e2e-journeys specs | **PASS** | 66 | 0 | 18 | 84 | 2026-09-22T23:37Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35796081270) | counts from run 35796081270 (workflow_dispatch, success) |
| suites on prod | e2e-real-backend specs | **PASS** | 62 | 0 | 0 | 62 | 2026-09-22T16:49Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35756239864) | counts from run 35756239864 (workflow_dispatch, success); 1 flaky |
| suites on prod | nightly-webkit specs | **PASS** | 159 | 0 | 689 | 848 | 2026-09-22T14:12Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35737622803) | counts from run 35737622803 (schedule, success); 1 flaky |
| suites on prod | ui-sweep specs | **PASS** | 140 | 0 | 0 | 140 | 2026-09-22T13:10Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35731685976) | counts from run 35698008762 (push, success); newer without counts: run 35731685976 (push, success) has no summary line, run 35711930729 (push, success) has no summary line |
| suites on prod | loading-states-refresh surfaces | **FAIL** | 88 | — | 57 | 145 | 2026-09-23T05:34Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35821128979) | counts from run 35821128979 (workflow_dispatch, failure); pass = surfaces measured, skipped = not measured; checker: 164 breaches (65 baselined debt, 26 by design) |
| suites on prod | press-every-control (controls) | **FAIL** | 828 | 6 | 215 | 1049 | 2026-09-23T04:05Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35813177418) | counts from run 35813177418 (workflow_dispatch, failure); found 1049, pressed 834 (skipped = not pressed), 0 unpressed WITHOUT a documented reason, coverage 100.0%, session deaths 0 |
| guards | vacuity full sweep (mutations killed) | **FAIL** | 368 | 1 | 0 | 369 | 2026-09-21T13:08Z | [failure, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35601005794) | counts from run 35601005794 (schedule, failure); counted from per-guard verdict lines (no summary line: a guard survived, or the sweep was cut off — then a floor); skipped = inconclusive/not run |
| alerts | ops alert ledger (open / verifying / closed) | **FAIL** | 39 | 19 | 0 verifying | 58 | 2026-09-23T06:09Z | public.ops_alert_ledger · `node scripts/ops-alert-ledger.mjs list` | open by severity: 6 critical, 12 error, 1 warning; verifying: none |
| alerts | open nightly-red issues | **FAIL** | — | 8 | — | 8 | 2026-09-23T06:08Z | `gh issue list -l nightly-red` | #1655 main: Supabase DB Deploy (0.0d); #1654 loading-states-refresh (0.0d); #1651 staleness-watch (0.0d); #1650 main: Staleness watch (0.0d); #1645 main: Vitest (0.1d); #1644 main: Test (0.1d); #1618 prod-audit (5.9d); #1582 press-every-control (10.0d) |
| alerts | push notifications can reach a device (check_push_token_health) | **FAIL** | 0 | 351 | — | — | 2026-09-23T06:08Z | public.check_push_token_health() (read-only) · OPEN.md Q82 | pass = device tokens, fail = pushes skipped for no device in 7d; 0 registered in 14d, 1 native users signed in in 14d |
| number currency | staleness watch (evidence age, workflow-bound baselines) | **FAIL** | — | — | — | — | 2026-09-23T06:08Z | [staleness-watch.yml failure](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35825352566) | scheduled run of scripts/check-staleness.mjs; red since 2026-09-23T05:14Z |
| number currency | migration drift + types.ts freshness vs prod | **PASS** | — | — | — | — | 2026-09-23T03:33Z | [db-drift-detect.yml success](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35814772848) | db-drift-detect.yml nightly (supabase migration list + check-types-fresh.mjs) |
| open work | remote branches (merged / carrying patches not on main) | **WARN** | 26 | 34 | 3 patch-equivalent | 63 | 2026-09-23T06:08Z | `git branch -r --merged origin/main` + `git cherry` | queue item Q79 lands or deletes each |
| DB health | connection use (all backends / max_connections) | **PASS** | — | — | — | 34 / 60 (57%) | 2026-09-23T06:08Z | pg_stat_activity (read-only) | 25 client backends; one instantaneous sample — Q53 wants a trend |
| DB health | statement timeouts reported to error_logs (24h) | **PASS** | — | 0 | — | 183 | 2026-09-23T06:08Z | public.error_logs (read-only) | client-reported only; a timeout nobody reported is invisible here — the Postgres-log row below is the server's count |
| DB health | slowest query, mean ms (pg_stat_statements, >50 calls) | **INFO** | — | — | — | 424.6 | 2026-09-23T06:08Z | extensions.pg_stat_statements (read-only) | cumulative since the last stats reset |
| DB health | statement timeouts in Postgres logs (24h) | **UNKNOWN** | — | — | — | — | attempted 2026-09-23T06:08Z | — | UNKNOWN: needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (the scheduled workflow has them; a local run does not) |
| CI | all workflows on main (last conclusive run) | **FAIL** | 27 | 10 | 8 stale, 1 unknown | 46 | 2026-09-23T06:08Z | `gh api .../actions/workflows/<id>/runs?branch=main` | one row per workflow below |
| CI | workflow a11y-webkit-prod.yml | **PASS** | — | — | — | — | 2026-09-21T16:13Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35621896278) | — |
| CI | workflow asc-iap.yml | **STALE** | — | — | — | — | 2026-09-07T00:25Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/34069736853) | last conclusive run 16.2d ago (limit 8d) |
| CI | workflow broken-links.yml | **PASS** | — | — | — | — | 2026-09-22T13:50Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35736086100) | — |
| CI | workflow bundle-size.yml | **PASS** | — | — | — | — | 2026-09-23T06:03Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971162) | — |
| CI | workflow db-backup.yml | **PASS** | — | — | — | — | 2026-09-23T02:26Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35810165938) | — |
| CI | workflow db-deploy.yml | **FAIL** | — | — | — | — | 2026-09-23T06:05Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35825018173) | red since 2026-09-23T05:49Z (0.0d) |
| CI | workflow db-drift-detect.yml | **PASS** | — | — | — | — | 2026-09-23T03:33Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35814772848) | — |
| CI | workflow db-smoke.yml | **STALE** | — | — | — | — | 2026-09-15T04:56Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/34930646351) | red since 2026-09-15T04:54Z (8.1d); last conclusive run 8.0d ago (limit 8d) |
| CI | workflow deploy.yml | **STALE** | — | — | — | — | 2026-04-26T20:51Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/24966624946) | last conclusive run 149.4d ago (limit 8d) |
| CI | workflow e2e-abuse-notifications.yml | **PASS** | — | — | — | — | 2026-09-22T15:45Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35747894821) | — |
| CI | workflow e2e-happy-path.yml | **PASS** | — | — | — | — | 2026-09-23T06:07Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824721597) | — |
| CI | workflow e2e-journeys.yml | **PASS** | — | — | — | — | 2026-09-22T23:37Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35796081270) | — |
| CI | workflow e2e-real-backend.yml | **PASS** | — | — | — | — | 2026-09-23T06:04Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971101) | — |
| CI | workflow edge-function-smoke.yml | **PASS** | — | — | — | — | 2026-09-17T15:32Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35240830253) | — |
| CI | workflow functions-deploy.yml | **PASS** | — | — | — | — | 2026-09-23T05:53Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824010580) | — |
| CI | workflow ios-beta.yml | **STALE** | — | — | — | — | 2026-09-02T18:33Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/33667110800) | last conclusive run 20.5d ago (limit 8d) |
| CI | workflow ios-icon-sync.yml | **STALE** | — | — | — | — | 2026-05-11T18:00Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/25687792067) | red since before 2026-05-11T17:58Z (134.5d); last conclusive run 134.5d ago (limit 8d) |
| CI | workflow ios-metadata.yml | **STALE** | — | — | — | — | 2026-04-26T22:40Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/24968560931) | last conclusive run 149.3d ago (limit 8d) |
| CI | workflow lighthouse.yml | **PASS** | — | — | — | — | 2026-09-20T10:35Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35505380760) | — |
| CI | workflow loading-states-refresh.yml | **FAIL** | — | — | — | — | 2026-09-23T05:34Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35821128979) | red since before 2026-09-23T05:07Z (0.0d) |
| CI | workflow main-red-watch.yml | **PASS** | — | — | — | — | 2026-09-23T06:08Z | [success, workflow_run](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35825388805) | — |
| CI | workflow migration-guard.yml | **PASS** | — | — | — | — | 2026-09-23T06:00Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824721561) | — |
| CI | workflow migration-lint.yml | **STALE** | — | — | — | — | 2026-09-03T03:27Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/33711377764) | last conclusive run 20.1d ago (limit 8d) |
| CI | workflow mobile-viewports.yml | **PASS** | — | — | — | — | 2026-09-23T06:04Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971196) | — |
| CI | workflow nightly-red-age.yml | **FAIL** | — | — | — | — | 2026-09-23T06:08Z | [failure, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35825352578) | red since before 2026-09-23T05:13Z (0.0d) |
| CI | workflow nightly-webkit.yml | **PASS** | — | — | — | — | 2026-09-22T14:12Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35737622803) | — |
| CI | workflow press-every-control.yml | **FAIL** | — | — | — | — | 2026-09-23T04:05Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35813177418) | red since before 2026-09-13T03:18Z (10.1d) |
| CI | workflow prod-audit.yml | **FAIL** | — | — | — | — | 2026-09-23T05:20Z | [failure, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35817028797) | red since before 2026-09-13T05:00Z (10.0d) |
| CI | workflow prod-errors.yml | **PASS** | — | — | — | — | 2026-09-23T04:51Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35820017287) | — |
| CI | workflow prod-freshness.yml | **PASS** | — | — | — | — | 2026-09-23T06:08Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35825352552) | — |
| CI | workflow race-runner.yml | **PASS** | — | — | — | — | 2026-09-23T06:04Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824721613) | — |
| CI | workflow schedule-heartbeat.yml | **PASS** | — | — | — | — | 2026-09-22T15:32Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35748027853) | — |
| CI | workflow scoreboard.yml | **UNKNOWN** | — | — | — | — | attempted 2026-09-23T06:08Z | — | UNKNOWN: GitHub has no workflow for this file yet |
| CI | workflow security-audit.yml | **PASS** | — | — | — | — | 2026-09-21T14:50Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35614818361) | — |
| CI | workflow sentry-release.yml | **PASS** | — | — | — | — | 2026-09-23T06:03Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971233) | — |
| CI | workflow sitemap-drift.yml | **PASS** | — | — | — | — | 2026-09-22T19:48Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35776077583) | — |
| CI | workflow slack-test.yml | **STALE** | — | — | — | — | 2026-09-14T19:06Z | [success, workflow_dispatch](https://github.com/louisianahelpr/louisianahelpr/actions/runs/34884904362) | last conclusive run 8.5d ago (limit 8d) |
| CI | workflow staleness-watch.yml | **FAIL** | — | — | — | — | 2026-09-23T06:08Z | [failure, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35825352566) | red since before 2026-09-23T05:14Z (0.0d) |
| CI | workflow stripe-webhook-guard.yml | **PASS** | — | — | — | — | 2026-09-23T02:40Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35811242023) | — |
| CI | workflow supabase-usage.yml | **FAIL** | — | — | — | — | 2026-09-19T05:55Z | [failure, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35425157146) | red since 2026-09-19T05:53Z (4.0d) |
| CI | workflow test.yml | **FAIL** | — | — | — | — | 2026-09-23T06:03Z | [failure, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824971110) | red since before 2026-09-23T04:06Z (0.1d) |
| CI | workflow ui-sweep.yml | **PASS** | — | — | — | — | 2026-09-22T13:10Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35731685976) | — |
| CI | workflow uptime.yml | **PASS** | — | — | — | — | 2026-09-23T05:01Z | [success, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35820648142) | — |
| CI | workflow vacuity.yml | **PASS** | — | — | — | — | 2026-09-23T05:28Z | [success, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35822427023) | 8 cancelled/skipped run(s) since |
| CI | workflow vitest.yml | **FAIL** | — | — | — | — | 2026-09-23T06:04Z | [failure, push](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35824485139) | red since before 2026-09-23T04:06Z (0.1d); 1 cancelled/skipped run(s) since |
| CI | workflow write-contract-refresh.yml | **FAIL** | — | — | — | — | 2026-09-19T14:29Z | [failure, schedule](https://github.com/louisianahelpr/louisianahelpr/actions/runs/35448880116) | red since 2026-09-19T14:29Z (3.7d) |
<!-- /live -->

<!-- /generated: scoreboard -->
