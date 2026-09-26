# Open list

<!-- generated: everything-open (node scripts/scoreboard.mjs --write) -->
**Everything open — start here** (Q58). Every tracker, its live count, and where to look.
Numbers for everything we test: **[docs/SCOREBOARD.md](SCOREBOARD.md)**.

- **Queue (this file):** 261 done, 44 partly done (fixed, protection pending), 116 open. Source of truth for work.
- **Audit bus:** 21 open, 2 open launch blockers — `node scripts/audit-bus.mjs list --blockers` · [ROLLUP](audit/launch-2026-09/ROLLUP.md).
<!-- live: carried forward verbatim offline; refreshed by node scripts/scoreboard.mjs --write -->
- **Ops alert ledger:** 15 open (14 error, 1 warning), 0 verifying — `node scripts/ops-alert-ledger.mjs list` · /admin?view=health. _(2026-09-25T22:28Z)_
- **nightly-red issues:** 10 open — `gh issue list -l nightly-red`. _(2026-09-25T22:26Z)_
- **Workflows on main:** 10 red, 8 stale, 0 unknown, 39 green of 57 — [SCOREBOARD](SCOREBOARD.md). _(2026-09-25T22:26Z)_
- **Remote branches:** 66 carry patches not on main, 3 fully merged, of 73 (Q79). _(2026-09-25T22:26Z)_
<!-- /live -->
<!-- /generated: everything-open -->

**This is the ONLY open-work list** (owner, 2026-09-12). Handoff memories, the
audit-bus ledger and agent reports are evidence, not backlogs: anything still
open from them gets a line here, with the check that guards it once one exists.

**Layout (reconciled 2026-09-23, Q16):** (1) the live QUEUE, verbatim, first;
(2) every item still open from older sections, one line each with its current
status and a pointer into the archive; (3) the 2026-09-02 ledger's leftovers
(docs/audit/OPEN_ITEMS.md is retired to a pointer); (4) the audit bus, by
reference. History (closed sections, narratives) is verbatim in
[docs/archive/OPEN-history-2026-09.md](archive/OPEN-history-2026-09.md),
with a reconcile log of every item closed and its evidence. Nothing was deleted.
**Done items leave this file (Q16, 2026-09-26):** a ticked `- [x]` item is moved
verbatim to the dated archive docs/archive/OPEN-done-YYYY-MM.md by
`npm run inventories:refresh` (scripts/archive-done.mjs); check:generated fails
while one is left here. The queue score, next free number and the done-item
guard check read this file AND the archives, so archiving never changes a count.

**Priority among the open queue items (lead's order, 2026-09-23 — money and
security first, then alerting, then the audit, then hygiene):** Q53 (DB outage
root cause), Q50 (card holds on cancelled jobs, Stripe side), Q3 (Stripe test
balance + monitor), Q30 (missed daily crons never catch up), Q2 (test runs raise
real alerts), Q42 (open alert-ledger items), Q9 (skipped money/authz review),
Q14 (Supabase security advisors), Q45 (prove a restore), Q58 (one place
for everything open), Q52 (false-green hunt), Q54 (front/back parity), Q35 (exhaustive
audit), Q44 (partial gates turn main red), Q11/Q15/Q39 (Sentry + error
screens), Q10 (owner-side), then the rest in number order. An item's own line
is the source of truth for its state; this sentence only orders them.

## QUEUE — owner-approved 2026-09-23 ("add all 10"): gaps found tonight

<!-- generated: queue-count (node scripts/queue-count.mjs --write) -->
**Queue: 421 items — 261 done, 44 partly done (fixed, protection pending), 116 open.**
<!-- /generated: queue-count -->

RULE (owner, 2026-09-23): an item is [x] DONE only when it names the GUARD that stops it recurring (a test, check script, workflow or migration that exists), or states NO-GUARD: <reason>. Fixed but unprotected = [~]. Enforced by src/test/queueItemsNameTheirGuard.test.ts.

Owner order: every alert, from anywhere, is fixed AND verified fixed (CLAUDE.md).
Nothing here gets muted: every failure still fails loudly; the work is making
sure someone hears it and closes it.

- [ ] **Q1 Alert ledger.** BUILT 2026-09-23 (migration 20260923043402,
  `public.ops_alert_ledger`; CLI `scripts/ops-alert-ledger.mjs`; hourly sync in
  prod-errors.yml; Open Alerts card on /admin?view=health; session-start hook
  prints the open list; guard src/test/opsAlertLedgerCoverage.test.ts, red on
  the old tree with 12 bypasses). Left open until: (a) lh-authz-rls review of
  the migration, (b) first hourly sync shows nightly-red issues in the ledger,
  (c) Sentry syncs (needs SENTRY_AUTH_TOKEN/ORG/PROJECT repo secrets — the sync
  says SKIPPED otherwise), (d) more `sql_condition` verify hooks: cron-http,
  cron-silent, dispute-unsettled, rls-escalation-refused and every edge
  `ops-alert:*` item are `manual`/`companions` today.
  REVIEW FOLLOW-UP 2026-09-23 (migration 20260923050059): HIGH fixed — the
  error_logs trigger's ledger upsert could stall a concurrent caller until its
  COMMIT (measured 3004 ms vs a 3000 ms hold; prod lock_timeout=0). Now
  ops_alert_record bounds the wait to 100 ms and, if the row is busy, queues
  the occurrence in `ops_alert_pending`; ops_alert_verify() folds it in (hourly).
  Measured after: 103 ms / 104 ms (existing row / brand-new fingerprint), both
  transactions commit, caller's lock_timeout untouched
  (scripts/probes/ops-alert-ledger-concurrency.embedded-pg.mjs; class guard
  src/test/errorLogTriggersNeverWait.test.ts, red on the original). MEDIUM
  fixed — normalise v2 keeps [1-5]xx codes after http/status/returned/
  responded/code/error and digits glued to a name (v2, job_7); ids, amounts,
  timestamps, signed numbers still stripped; provable existing rows re-keyed
  (merged where two v1 items are now one; open wins). LOW fixed —
  check_ops_digest_delivery() is ok:false when the ops-daily-digest
  expectation row is missing (row exists live, registered 2026-09-14); the
  side effect is commented at the ops_alert_condition call site.
  lh-silent-failure review of the fix: re-key merge chain lost counts/open
  status (fixed: row re-read per iteration, PGlite chain case red without it);
  one bad pending row stopped every fold (fixed: per-row sub-block, row stays
  queued); 6+ digit numbers were `<id>` (fixed: hex ids need a letter).
  STILL OPEN: (e) no watchdog on `ops_alert_pending` — if the hourly `ledger`
  job stops, queued occurrences never fold and nothing says so (alert on
  oldest queued_at age from something other than that job); the brief
  (ops-alert-ledger.mjs) reads the ledger without folding, so it undercounts
  during a storm.
  One tracked item per distinct alert fingerprint,
  from error_logs (server rows, every severity), Slack posts that bypass
  error_logs, Sentry, nightly-red issues and CI. Auto-opened, and closed only
  after that alert's own detector has been re-run and shows it cleared. A
  guard ensures no code path posts to Slack without a ledger entry. The
  session-start check reads it first.
- [~] **Q2 Test runs raise real alerts.** E2E/seed jobs trigger stuck-payment
  alerts, the ec3428da "refund refused" alert (a test job paid 09-12, no
  dispute, where something keeps retrying a refund), and user-facing
  notification copy posting into #ops-alerts. Fix it where it starts: tests
  clean up their checkouts, detectors handle is_seed deliberately, and alerts
  from E2E jobs go to their own channel or tag. Nothing silently dropped.
  FIXED 2026-09-23 (commit "fix(alerts): test data stops paging", migration
  20260923052520). ROOT CAUSES, measured on prod:
  (a) the relay: send-push-notification mirrors an admin's push to Slack when
  the admin has no push token, and tested only the ROLE. The owner's account
  (76b07824, admin AND a party to seed job 5eed0a20…08) received its own user
  mail — "Did you finish this job?" x5, "Has this job been finished?" x5,
  "We've asked support to step in" x10, "Job auto-cancelled" x4, chat
  messages — and every one posted as a critical page. Now only operator types
  (admin_alert, system_alert) mirror; a seed subject (job=/user= in the link)
  goes to the digest. The stalled-job admin link now names the job: all of a
  day's stalled jobs shared one once-a-day key, so a real one could be
  swallowed by a seed one.
  (b) detectors: error_log_is_seed() (tags.seed or a '-seed' source) keeps
  seed rows out of Slack and the ledger; they stay in error_logs, so the daily
  digest lists them. detect_stuck_payments -> 'detect_stuck_payments-seed'
  for seed jobs/posters; postSlackOpsAlert({seed}) for edge callers
  (stalled-completion passes it). Guard
  src/test/alertingDetectorsDeclareSeedPolicy.test.ts (red on origin/main
  741e9d3a6: detect_stuck_payments + 13 edge files).
  (c) checkouts: every stuck-payment job was an E2E job the spec had already
  CANCELLED; nothing ever expired its Checkout Session or moved it out of
  'unpaid' (void-cancelled-payments' abandon sweep only read status='open').
  Its new Part B2 expires the session and marks cancelled+unpaid jobs
  'abandoned' (real posters who cancel mid-checkout too — the session could
  still be paid for 24h); detect_stuck_payments gives cancelled jobs 2h for it.
  (d) DLQ: all 51 dead letters (09-12/13) were to is_seed mailinator accounts
  and died of `Resend 429 daily_quota_exceeded` — the 09-13 seed-heavy run
  enqueued 319 emails in a day (email_send_log). The DLQ verify now needs a
  later 'sent' row per NON-seed recipient (archiving no longer clears it);
  seed-only DLQs report to the digest. OPEN: whether seed accounts should get
  mail at all (see MORNING QUESTIONS 4).
  The ec3428da "refund refused" item: that job is now completed/released
  (updated 2026-09-22 22:23Z) and no error_logs row mentions it; nothing to
  re-run. STILL OPEN (follow-up): two operator alerts link to no subject, so
  the mirror cannot tell a seed one — "Ban review needed" (/admin?view=banreview,
  apply_consequence_ladder) and "Scheduled payout failed" (/admin,
  process-scheduled-payouts). They still page for seed (fail loud).
  FOLLOW-UP DONE 2026-09-25 (queue lane, branch queue-fix, not yet deployed):
  "Ban review needed" already links /admin?view=banreview&user=<id> (restated by
  20260923205635). The TS side had SIX operator alerts linking bare "/admin":
  release-payout x3 and process-scheduled-payouts x2 (payout blocked / failed)
  and auto-resolve-disputes "Dispute auto-resolved"; with title+link as the
  mirror's once-per-day key, two different failed payouts on one day also posted
  ONCE. All six now link /admin?view=jobs&job=<id> (AdminJobs opens that job).
  GUARD: src/test/operatorAlertsNameTheirSubject.test.ts (AST of src/ +
  supabase/functions: every admin_alert/system_alert object's link names a
  job/user, or is a parameter every same-file call fills with one; red on the
  pre-fix code with exactly those 6 sites; vacuity 3/3 killed). SQL producers
  stay with Q139. Tick after functions-deploy ships the three functions.
- [ ] **Q7 WebKit only: the bottom nav isn't frosted.** Verify on the iOS 26.1
  simulator or a device; fix it if it's real.
- [~] **Q8 Unused exports — ratchet DONE (baseline 96 exports / 11 types on 2026-09-24, scripts/deadcode-baseline.json, enforced by deadcodeRatchet.test.ts; red if it rises). Remaining: review them with the owner.** Was: 160 at baseline, 63 dropped by e16ebdcc3.
  Lower scripts/deadcode-baseline.json to match. The ratchet test fails if the
  count rises. Review the rest with the owner (a report, not auto-delete).
- [ ] **Q10 Owner-side, carried over:** (from Q242, 2026-09-24: dashboard-only cleanup — Slack #new-channel/#social and the Lovable/"Helpr Op" Slack apps; Checkr/Certificial/Browserbase keys and webhooks in their dashboards; extra Supabase API keys / auth providers; Stripe Connect settings.) release dispute 9756a585's payout;
  **ANSWERED 2026-09-23:** dispute 9756a585 (seed): Claude settles it in TEST mode (work item Q148); Stripe payouts: MANUAL — DONE 2026-09-23 by Claude in the owner's Chrome (Settings > Payouts > Manual payouts, saved, re-read after reload; no test-mode banner, so the live account); sales tax: Stripe collects it (create-payment already sends automatic_tax enabled; Louisiana IS registered and collecting (checked in the Stripe dashboard 2026-09-23: Tax > Locations, 1 registration, collecting); filing is NOT set up there ('Set up filing') — OWNER: decide whether Stripe files the returns); right-panel overlap: owner asked Claude to audit it (Q151).
  set Stripe payouts to manual; decide Louisiana sales tax; send a screenshot
  or window width for the right-panel overlap.
- [ ] **Admin DocumentsTab can't open a portfolio STORAGE PATH.**
  complete-signup stores portfolio uploads as `user-documents` paths; the tab
  now shows them as "Link withheld (not https)" (before: a broken relative
  link). Sign them at display time like id_document_url. 0 such rows on prod
  2026-09-23.

## QUEUE (cont.) — gaps measured 2026-09-23 (owner: "anything at all")

- [ ] **Q14 Supabase security advisors (live 2026-09-23):** NOTE 2026-09-23: the org is on PRO (measured with get_organization), not free. Leaked-password protection IS available; the old "accepted risk" decision assumed free tier. Re-ask the owner (morning).
  **ANSWERED 2026-09-23: turn leaked-password (HIBP) protection ON** (work item Q149).
  - ERROR `security_definer_view` on open_jobs_browse. Confirm it's intentional
    (CLAUDE.md puts browse visibility there) or switch to security_invoker.
  - 10 SECURITY DEFINER functions executable by anon (early_access_cutoff,
    get_open_jobs_for_map, get_parish_for_zip, get_public_open_jobs, and 6 more).
    Review each for data exposure.
  - 103 executable by authenticated. Spot-check the ones that are not RPCs the
    client calls.
  - 6 tables have RLS enabled with no policies (deny-all; fine if server-only).
    Confirm each.
  - [DONE by Q149: leaked-password (HIBP) protection is ON.]
- [ ] **Q19 Wider product/UX gap pass.** Run lh-suggester (core-loop friction,
  missing product, growth) and an lh-audit pass on the screens touched tonight,
  then queue what they find.

## QUEUE (cont.) — added 2026-09-23 late

- [ ] **Q28 Vacuity found a hollow MONEY guard.** ALSO (2026-09-23, twice in one night): "pre-guard baseline" tests (raceClassGuard, and others built on latestDefinition(name, [EXCLUDED_VERSIONS])) break every time a later migration restates the whole function, and each needs its exclusion list hand-extended. Derive the baseline as "the newest definition OLDER than the guard-adding migration" instead of an exclusion list, so restatements can't break it. ALSO (2026-09-23): cronFailureAlertDoesNotDependOnCron parsed only `$fn$` bodies, so it silently read the PREVIOUS definition when 20260923050055 used `$function$` (409 migrations use $function$, 379 use $$, 40 $fn$, 4 $body$), and a revert of the Q33 fix stayed green. Fixed (any tag, plus a "reads the newest definition" test). The class to close: every migration-reading guard shares one parser that handles any dollar tag and fails if it can't parse the newest definition. disputeClosedWithoutPayment
  matched a comment (FIXED d8f71e47d). Look for the same "toContain matches a
  comment" shape in other source-scanning guards. A shared code-only reader
  would close the class (ties to Q24).
- [ ] **Q35 Exhaustive all-systems gap audit (owner, 2026-09-23: "make sure all
  systems are checked exhaustively for gaps").** Run the launch-audit fleet
  (39 lanes) in waves. Every finding lands in this queue with a check or a
  tracker entry.
- [~] **Q104 PARTLY DONE 2026-09-23 (branch cloud/q104-q105): every prod-hitting browser run is now METERED and BUDGETED; per-test budgets await their first measured run. Meter: e2e/requestMeter.mjs counts every Supabase request (rest/rpc/auth/functions/storage/realtime, password sign-ins, GETs repeated within 2 s per context, requests per wall-clock minute) for every context a worker's browser creates, via the metered `test` in e2e/prodTest.ts (27 prod-hitting e2e files switched to it; 0 before) and in press-every-control.mjs / measure-loading-states.mjs. Budget: scripts/e2e/request-budget.mjs runs after the browser step in 11 workflow jobs (e2e-journeys x2, e2e-real-backend x3, prod-audit, a11y-webkit-prod matrix, e2e-abuse-notifications matrix, press-every-control, loading-states-refresh, core-loop-canary; 0 before), prints a per-run table to the job summary and fails the run over e2e/request-budgets.json: ceilingPerMinute 400 on every label (policy; derivation in the file), perTest + signIns two-way (over fails, under half fails as stale) but `null` until calibrated. Trim: Admin.tsx's `jobs` realtime binding now filtered `is_seed=eq.false`, so seed (CI) job writes no longer fire the ~25-query admin stats reload (was every job write anywhere). GUARD: src/test/requestBudget.test.ts (3 of 8 cases red on the pre-change tree: 26 unmetered files, 8 unbudgeted workflow runs; its per-JOB check then found the prod-lifecycle job still unbudgeted). OPEN: (1) the lead writes perTest/signIns per label from the first nightly summaries (the run prints the number to write); (2) trim what the summaries' "Top repeated GETs" and sign-ins columns show; (3) re-measure prod REST from the CI origin after landing (edge_logs by run window). Was:** CI browser suites are ~94% of prod REST traffic; give each a measured load budget (Q53 follow-up, ties to Q60).
  24 h to 09:00Z 2026-09-23: 105,824 of >=112,356 badge requests came from
  127.0.0.1:4173 (CI preview builds); REST from that referer peaked at
  104,445 requests in the 03:00Z hour (~29/s) with no real users. One press
  admin session made 18,035 REST calls in 29 min. Record requests/min per
  workflow run (edge_logs by run window), set a ceiling below the level the
  db-saturation-check thresholds trip at, and fail the run that exceeds it.
  Budgets written (e2e/request-budgets.json), summary groups by endpoint shape (e26631de7, c8b64c666). Re-measured run 35932913760: journeys 5683->5368 req, busiest minute 1692->1503; webkit 1847->2180, 436->461. STILL RED: both legs over the 400/min ceiling. App-side repeated GETs filed as Q329/Q330
- [~] **Q105 PARTLY DONE 2026-09-23 (branch cloud/q104-q105): duplicate realtime subscriptions removed from source, inventory pinned exactly. Counted from source (TypeScript AST, both quote styles): 22 postgres_changes bindings on 10 channel sites -> 17 on 8. Four consumers (nav badges, every bell, Dashboard push, Activity) each opened their own channel with the identical `notifications` INSERT user_id binding and two also duplicated `jobs` customer_id / `applications` helper_id; all now share ONE ref-counted per-user channel, src/lib/userRealtimeBus.ts. Subscription rows per signed-in user, from source: any page (nav + bell) 5 -> 4; Dashboard 6 -> 4; Activity 11 -> 7. Admin.tsx's two bindings were single-quoted and invisible to realtimeBindingsAreScoped's regex; its `jobs` one is now filtered is_seed=eq.false, `reports` stays whole-table (admin only, documented exemption). No channel is opened before an early return that renders nothing (checked by the guard; none found). GUARD: src/test/realtimeChannelInventory.test.ts (exact inventory, every binding user/job-scoped except DELETE and admin, no two channels bind the same table+filter with overlapping events; 5 of 7 cases red before the fix, 16 duplicate pairs) + src/lib/userRealtimeBus.test.ts (one channel per user, topic routing, recovery fan-out, close with last listener). OPEN: (1) the unread-nav `messages *` receiver_id binding still overlaps Messages page's receiver INSERT/UPDATE (listed in KNOWN_OVERLAPS; moving the inbound-message path onto the bus is its own change); (2) `job_checkins` and `platform_settings` are in supabase_realtime (replayed from migrations) but no client subscribes: drop them in a migration; (3) lead re-counts live realtime.subscription rows and realtime.list_changes after landing; (4) sweep_dead_crons() EXPLAIN (below) not done. Was:** Realtime is the largest DB cost; measure and cut it (Q53 follow-up).
  pg_stat_statements 15:23Z 09-22 -> 08:54Z 09-23: realtime.list_changes
  121,403 calls / 1,124 s (35% of all 3,200 s of SQL time) plus the
  publication scan 271,282 calls / 211 s; 136 live realtime.subscription rows
  at ~09:10Z, nearly all CI sessions (notifications 41, jobs 37,
  applications 32, messages 21). Q53 halved the nav-badge channels; re-count
  subscriptions after Q103's re-measure, check which of the 10 published tables
  any client still subscribes to, and drop the rest from supabase_realtime.
  Also noticed: sweep_dead_crons() costs 1.0 s per hourly run (17 calls,
  17.1 s) — EXPLAIN it the way Q53 did sweep_silent_cron_failures.
  LANDED 2bb6c3939 (inbound messages on the shared bus; 17->15 bindings, KNOWN_OVERLAPS empty) + migration 20260923230730 (job_checkins, platform_settings out of supabase_realtime; LIVE verified 2026-09-23: 8 published tables). Guards red-proven per agent. Pending: lh-silent-failure review of the realtime change (running)
  RE-MEASURED 2026-09-25 ~05:40Z (queue lane): supabase_realtime publishes 8 tables (applications, job_tracking, jobs, message_reactions, messages, notifications, reports, reviews), each with a client binding; realtime.subscription 0 rows (no session open, so NOT a re-count; (3) still needs a count while CI or a user is signed in). pg_stat_statements is cumulative since 2026-09-22 15:23Z, so list_changes (382,665 calls / 3,364 s, 40% of 8,308 s) cannot show the change without a reset or two dated snapshots. (4) sweep_dead_crons(): 62 calls, mean 1,161 ms, still ~1.2 s per hourly run; cause read from pg_get_functiondef: four correlated subqueries per expected job over cron.job_run_details (15,036 rows since 2026-09-18, only index is the runid pkey), not yet EXPLAINed or fixed. Still open: (3), (4).
  Review (lh-silent-failure): leading recovery throttle could drop messages received between the two channel recoveries. Fixed 14cd927e3's parent (trailing 750ms settle, cleared on unmount); useMessagesRealtime.recovery.test red 2/3 on the old throttle, vacuity 2/2 killed.
  (4) FIXED 2026-09-25 (queue lane, branch queue-fix, not yet live): EXPLAIN ANALYZE on prod showed the `live` CTE ran 4 correlated subqueries x 61 jobs = 244 full scans of cron.job_run_details (16,002 rows; its only index is the runid key and supabase_admin owns it, so no index can be added): 810 ms of the ~1,185 ms mean call. Migration 20260925140304_sweep_dead_crons_one_scan reads the history in ONE window pass: 36 ms on the same prod data, and the old vs new `live` rows were identical both ways for all 61 jobs (prod read-only SQL). GUARDS: src/test/cronRunHistoryScannedOnce.test.ts (no function may correlate a cron.job_run_details subquery on jobid; exact two-way KNOWN_CORRELATED = cron_dispatch_health 1, run_missed_cron_catch_up 5 -> Q397; red on the tree without the migration: sweep_dead_crons 4 vs 0; its @mutate killed), src/test/cronFailureAlertDoesNotDependOnCron.test.ts CJ-004 case restated on the new shape (3 @mutate), src/test/pglite/sweepDeadCronsOneScan.pglite.mjs (applied 3x; old body and new body file identical error_logs rows, result and Slack page on a fixture reaching all 7 verdicts: ALL PASS). TO RE-MEASURE after db-deploy: pg_stat_statements mean_exec_time for `SELECT public.sweep_dead_crons()` (was 1,185 ms over 71 calls; reset-free, so compare calls after the deploy time). Still open: (3).

## MORNING QUESTIONS (held overnight 2026-09-23 while the owner sleeps)

1. **Sentry read token (Q11).** The existing SENTRY_AUTH_TOKEN is an upload
   token (403 on reading issues), so the alert ledger can't sync Sentry. You
   said "you can do it", but creating and copying an API token is a credential
   step I'm not allowed to do. It takes about 2 minutes: Sentry -> Settings ->
   Auth Tokens (or Custom Integrations) -> new token with `project:read` +
   `event:read` -> `gh secret set SENTRY_READ_TOKEN`. I'll wire the sync to
   that name, so it closes the "Sentry not synced" ledger item on the next hourly run.
- [~] **Q94 The user-error-screen close rule has no synthetic half (Q39 follow-up). BUILT on branch cloud/q94-q128-q132 and landed on main (2026-09-23); live half pending (merge -> db-deploy -> a press run).**
  Migration 20260923182022_ops_route_probe_close_rule: table
  `ops_route_probe(route PK, passed_at, run_ref)` (RLS on), `ops_route_key(text)`
  (pathname only; uuid / numeric segments -> `:id`, so the press run's
  /jobs/<fixture> and a person's /jobs/<theirs> are one screen) and
  `record_route_probe_passes(text[], text)` (SECURITY DEFINER, upsert,
  GREATEST passed_at); all REVOKEd FROM PUBLIC, anon, authenticated, service_role
  only (landed renumbered from 20260923171400, then 20260923181026 and 20260923181653, all of which sorted before main's newest; restated from Q64's 20260923181420 body). `ops_alert_condition` restated from its NEWEST body (20260923181420, Q64)
  with ONE change: the non-overflow user-error-screen branch is still failing
  while a real row is < 24h old (unchanged) OR no probe pass for the item's
  screen is newer than p_since (= last_seen). An item with no screen stays
  failing (nothing to probe); the overflow item keeps the 24h rule alone.
  Writer: scripts/audit/pressRouteProbe.mjs, called once per shard at the end
  of press-every-control: a pathname passes only if >= 1 of its rows was
  measured to the end with 0 failed presses and none of its rows failed /
  errored on load / was cut short (redirect, uncovered, session-lost rows are
  neutral). A failed write prints a ::warning and the rule stays failing
  (fail-safe). GUARDS: src/test/routeProbeCloseRule.test.ts (newest body
  requires the pass; body == prior body outside that branch; grants; writer
  rules; 5 @mutate, all KILLED) and src/test/pglite/routeProbeCloseRule.pglite.mjs
  (3x apply, ALL PASS 30; NEW_MIGRATION=skip: 14 FAILED — a 30h-old real screen
  with no probe is still failing, an older-than-last_seen pass does not count,
  a newer pass on another job id clears it and ops_alert_verify closes it).
  STILL TO DO LIVE: after merge, verify with pg_get_functiondef /
  pg_proc.proacl and read ops_route_probe after the next press run. Needs an
  lh-authz-rls REVIEW-ONLY pass (new SECURITY DEFINER writer).
  LIVE 2026-09-23: ops_route_probe holds 14 rows, last pass 21:07Z; record_route_probe_passes proacl is postgres+service_role only. STILL OWED: an lh-authz-rls REVIEW-ONLY pass.
- [~] **Q132 The other 5 UNJUSTIFIED skips of prod-audit run 35844514386 need their own fixtures or a re-run (found by Q100, 2026-09-23). FIXED on branch cloud/q94-q128-q132 and landed on main (2026-09-23), not yet run on prod (no prod credentials in that lane).** (1) post-job price: NOT a missing fixture: the spec looked for `getByRole("spinbutton")` and the budget is CurrencyInput, `type="text"`, so it could never be found; it now finds it by BudgetSection's aria-label "Job budget in dollars". GUARD: src/test/messyInputPriceField.test.ts (2 @mutate, killed). (2)(3) disputedJob-poster/-helper: the prod-audit now owns a dispute fixture: `ensureDisputedJob` (e2e/prod-audit/fundedOpenJob.ts, plan `planDisputedJob` in fundedOpenJobPlan.ts): a job of its own titled "Prod audit dispute fixture" (never borrows the in-progress/completed pair jobs), funded through the Q100 path, helper-e2e `apply_to_job`, poster-e2e `accept_application`, poster-e2e `rpc_open_dispute`; reused indefinitely, a half-made one resumed without paying twice; throws, never skips; messy-input's beforeAll builds it before resolveFixtures. GUARD: src/test/disputedJobFixture.test.ts (3 @mutate, killed). (4)(5) openJob-helper/-poster: no change needed (Q100's fixture feeds them). ALL FIVE need the next prod-audit / messy-input run to show 0 skipped; a first dispute fixture costs one $25 Stripe TEST checkout and a 20-minute early-access wait. Was: messy-input.spec.ts:406 post-job price rule ("no price field reached with the generic stepper"), explore disputedJob-poster and disputedJob-helper (no disputed job between poster-e2e and helper-e2e), and explore openJob-helper / openJob-poster, which Q100's fixture now feeds but which were not re-run locally (messy-input is a ~55-minute run).
- [~] **Q137 A seed subject can notify a REAL person (money/trust review of Q100, 2026-09-23). FIXED at the choke points (migration 20260923121354 + send-notification-email + create-notification); GUARDS: src/test/seedNeverNotifiesReal.test.ts (14 @mutate, all killed) and src/test/pglite/seedNeverNotifiesReal.pglite.mjs (live chain, applied 3x: ALL PASS 30; NEW_MIGRATION=skip: 17 FAILED). Partly done: 45 producers still do not carry their subject (Q139).** Was: when the Q100 funded fixture job (is_seed, e3e08fd1-3449-40f7-a99d-f5d49dbe53df) became escrowed at 11:35Z, notify_helpers_on_job_post sent "New job in your parish" (job_match) to two East Baton Rouge accounts and POSTed send-notification-email; producers skipped a seed job only while seed_jobs_hidden_publicly() (the launch switch, FALSE on prod) was true. Measured before (prod, 30 days to 2026-09-23 ~12:00Z): 105 notifications reached a NON-seed account about a seed job (message 46, job_updates 21, application 12, admin_alert 12, job_update 6, payment 3, work_status 2, warning/expired/new_offers 1 each); ALL to the owner's own two admin accounts (76b07824 99, 7f65ef12 6); prod has 3 non-seed profiles, all the owner's; no other person. A floor: many rows carry no job reference. Email: 350 emails to non-seed accounts in 30 days, none attributable (send-notification-email never logged a job_id). Now: a seed job (is_seed) or a seed actor (named in the link as userId=/offerTo=/user=, or create-notification's signed-in caller) never produces an in-app row, push or email to a NON-seed recipient, whatever the switch; seed-to-seed unchanged; the switch still controls browse only. Choke points: notifications BEFORE INSERT trg_notifications_seed_boundary (drops the row, so the AFTER INSERT push fan-out never fires; sorts after trg_notifications_fill_job_id); match_digest_queue BEFORE INSERT; send-notification-email and create-notification ask notification_crosses_seed_boundary() first (email fails closed on a check error, PGRST202 falls through for the deploy window); sweep_daily_job_digest counts seed jobs only for seed recipients. Suppressions are logged in notification_logs (status 'suppressed_seed'). Inventory (from source, = live): 44 SQL functions insert into notifications, 72 edge + 3 client insert sites, 3 SQL email producers, 1 SQL push path (the fan-out), 12 email-sending files. HEADS-UP for the owner: your own non-seed accounts stop receiving notifications about seed jobs you are a party to, and admin alerts about seed jobs; that is the rule as specified. **Live 2026-09-23 ~12:40Z:** schema_migrations has 20260923121354 (applied 12:27:59Z by the GitHub integration, acknowledged in scripts/audit/migration-provenance.json); the three functions SECURITY DEFINER, search_path=public, pg_temp, proacl postgres+service_role only; BEFORE INSERT order on notifications = suppress_exact_duplicate_notification, trg_notifications_fill_job_id, trg_notifications_seed_boundary; trg_match_digest_queue_seed_boundary present; sweep_daily_job_digest has the seed filter; notification_crosses_seed_boundary: owner account about the Q100 fixture true (by job_id and by link), a seed account false, seed actor true, real actor false. Real insert on prod (the fixture's own link, one statement): owner account 0 rows landed + 1 notification_logs 'suppressed_seed' row; a seed EBR account 1 row landed (removed after; 0 left). Deployed: send-notification-email v2382 and create-notification v60 contain the check (get_edge_function; functions-deploy 35860574449 green). Not run end to end: a real email POST (the PGlite proof asserts the sender's answer for every POST the SQL producers make). Needs an lh-authz-rls or lh-silent-failure REVIEW-ONLY pass (new SECURITY DEFINER trigger on every notification insert; fail-closed drop).
- [ ] **Q139 45 notification producers do not carry their subject, so the Q137 seed boundary cannot judge them (found by Q137, 2026-09-23).** Listed exactly in KNOWN_GAP in src/test/seedNeverNotifiesReal.test.ts (two-way): 23 edge sites (arrival-confirm-reminder, auto-expire-jobs x2, charge-recurring-visits, check-pro-subscription, create-payment, execute-dispute-split, payment-confirm-reminder, process-scheduled-payouts x2, release-payout x3, review-nag-cron, stalled-completion-reminder, stripe-idv-webhook admin alert, chargeDisputeClosed x2, chargeDisputeCreated, checkoutSessionCompleted tip + gift credit, void-cancelled-payments x2) and 22 SQL sites (check_referral_bonus x4, track_revision_scope_creep x2, notify_poster_on_status_change, notify_helper_on_tip, notify_helper_on_direct_offer, notify_helper_application_viewed, respond_to_direct_offer, expire_unanswered_offers x2, sweep_dayof_confirm_reminders x3, apply_job_denial_consequence, sweep_release_last_chance, helper_abort_job x2, apply_low_rating_flag, apply_consequence_ladder admin alert), plus the gift-card email (names the donor). Each is about a job or a counterpart but inserts no job_id and no job/actor link. Fix per site: add job_id (or a job/actor link) to the insert, then delete its KNOWN_GAP line (the guard fails until you do). Their risk is lower than Q137's fan-outs: most notify a PARTY to the job.
  - **STATUS (cloud lane, 2026-09-23, branch cloud/q139-v2, NOT on prod; the lead verifies and ticks). Supersedes cloud/q139-notification-subjects, which must NOT land:** its migration 20260923162545 restated 16 functions from their newest CREATE FUNCTION TEXT, but 20260831232514 and 20260901021929 had rewritten eight of them IN PLACE (pg_get_functiondef + regexp_replace + EXECUTE), so it would have reverted 14 direct links on prod (the '/my-…?job=' || id links back to bare '/posts' / '/jobs' or a fixed ?filter=scheduled / needs_you / direct_offer / offered) in track_revision_scope_creep x2, notify_poster_on_status_change x2, notify_helper_on_direct_offer, respond_to_direct_offer, expire_unanswered_offers x2, sweep_dayof_confirm_reminders x3, sweep_release_last_chance, helper_abort_job x2 (found by a review against live pg_get_functiondef). NOW: migration 20260923182915 restates the same 16 functions (check_referral_bonus, track_revision_scope_creep, notify_poster_on_status_change, notify_helper_on_tip, notify_helper_on_direct_offer, notify_helper_application_viewed, respond_to_direct_offer, expire_unanswered_offers, sweep_dayof_confirm_reminders, apply_job_denial_consequence, sweep_release_last_chance, helper_abort_job, apply_low_rating_flag, apply_consequence_ladder, notify_on_payment_escrowed, open_dispute_as) from their EFFECTIVE definitions (newest text + the in-place rewrites, replayed from the migrations; not re-read from prod in this lane) with only job_id / &user=<id> added; every direct link kept. The edge-function and src changes of the old branch are carried over unchanged (KNOWN_GAP 45 -> 0, _shared/seedBoundary.ts, zero-row producers ask the boundary; see the old branch's commit 6365cf570). GUARD: src/test/notificationRestatementsKeepLinks.test.ts with src/test/helpers/effectiveFunctionDefs.ts (replays every migration incl. the regexp rewrite tuples; (a) each function the Q139 migration restates = its effective prior body plus only `, job_id` / `, <id>` / '&user=' || <id>; (b) every notification producer restated by any migration since Q194 keeps its links two-way, INTENDED_LINK_CHANGES two-way; (c) every migration that EXECUTEs a rewritten pg_get_functiondef is parsed or listed). RED with the old branch migration in place: (a) 8 functions, (b) the same 8 (14 links); GREEN now; 4 @mutate, all killed. PGlite src/test/pglite/notificationProducersCarrySubject.pglite.mjs now builds the previous state the way prod got it (newest text, then the two real rewrite migrations executed at their point in the timeline) and checks each function keeps every link: applied 3x ALL PASS 94; NEW_MIGRATION_FILE=<old branch migration>: 8 FAILED (exactly those 8); NEW_MIGRATION=skip: 22 FAILED. everyLinkIsARealRoute (then its predecessor) + seedNeverNotifiesReal green; src/test/edge 67 files / 968 tests green. NOT RUN here: anything on prod, typecheck:edge (deno). For the lead after db-deploy: pg_get_functiondef of the 8 functions must still show '?job=' links, and all 16 the job_id / &user=. Needs an lh-silent-failure REVIEW-ONLY pass (zero-row branches in 7 cron/webhook producers).
  - **OWNER INFO (by design of Q137, the rule as specified):** once this lands, the owner's own (non-seed) account stops getting notifications about the 23 fixture (is_seed) jobs it posted or worked (count from the prod review of this change), and admin in-app alerts about seed jobs / seed members are dropped (logged as suppressed_seed); the Slack #ops-alerts pages and the ops alert ledger still get them.
- [~] **Q128 Triage press-every-control run 35837735324 (e96adc16d, red, 2026-09-23). HARNESS CLASSES FIXED on branch cloud/q94-q128-q132 and landed on main (2026-09-23); press not re-dispatched (the lead lands the branch first).** Measured from the run's own logs (4 shards, 10 failed presses in shard 2, 7 more in the three cancelled shards). New scripts/audit/pressFailureClass.mjs, one rule per class, each listed in coverage.md instead of counted: (1) Sentry/PostHog responses and Chrome's "Failed to load resource" mirror of them are `telemetry` (6 presses: earnings x2, signup, schedule, home_history) — follow-up Q296; (5) a 5xx from a known vendor host is `vendor-5xx` (apay-us.amazon.com 500 under Stripe's sheet); a vendor 4xx, an unknown host or a status-less DNS failure (the /jobs/:id "Photos" ERR_NAME_NOT_RESOLVED) stays a failure; (6) a control missing on reload behind an `[E2E DO NOT ACCEPT]` row (another sweep's live fixture, both admin Refund Poster rows) is a documented skip, never behind the harness's own `[PRESS DO NOT ACCEPT]`; (3) NOT CLICKABLE now leads with Playwright's own reason (covered by X / not visible / not stable …) — the 600-char slice was all selector; (7a) routine token expiry is not a session death: a token within 15 min of exp is re-minted before the row and before clean-up (the clean-up's 11 "HTTP 401 JWT expired" cleaned nothing), and only a refusal of an unexpired token counts as a death; (7b) the sweep stops itself at TIME_BUDGET_MIN=135 (job timeout 150), marks the rows it did not reach, writes coverage.md and FAILS with that reason, instead of three shards being cancelled with no report. Still real, not harness: (2) "Copy Mon to all" is Q34 (measured from source: with no rows the week defaults to every day available 09:00-17:00, so copying Monday changes nothing: a silent no-op on the default week); (3) the "Done — <date>" buttons are Q294; (4) credentials "Open" is Q295. GUARD: src/test/pressFailureClass.test.ts (one case per class incl. the neighbour that must stay red; wiring pinned; 7 @mutate, all KILLED). Was: Classes seen: (1) 429 on Sentry `envelope/` counted as a control failure (earnings, signup, schedule, home_history) — our own telemetry rate limit, not a product defect; the harness must not blame the control, and 429s from our own reporter need their own look; (2) "Copy Mon to all" on /profile?tab=availability: no observable change for customer AND helper — real defect or harness blind spot, measure; (3) /jobs/:id "Done — <date>" timeline buttons NOT CLICKABLE (16s timeout, 3 rows) — something covers them or they are disabled-looking-enabled; (4) /admin?view=credentials "Open" no observable change; (5) apay-us.amazon.com 500 (third party); (6) admin Refund Poster not found on reload (transient DOM); (7) GoTrue refused test sessions mid-run and parts were cancelled on time budget (a cancelled run is a hidden red). Fix real defects with guards, reclassify harness noise with a guard that each class stays classified, and re-dispatch press.
- [ ] **Q144 LAUNCH CHECKLIST: stop real email to is_seed accounts at launch (owner decision 2026-09-23: keep sending until launch).** At launch, skip sending to is_seed recipients (log skipped_seed in email_send_log) with an allowlist for delivery-asserting journeys, so test mail stops spending the Resend daily quota real users need. LAUNCH DAY ALSO (from Q163): after scripts/e2e/stripe-sandbox-off.sh, open Stripe LIVE > Workbench > Webhooks and confirm charming-euphoria and elegant-oasis are still Active (live events answered 400 during sandbox can make Stripe pause an endpoint), and Resend any failed live deliveries.
- [ ] **Q147 Back up uploaded files except id-documents (owner decision 2026-09-23).** Buckets proof-photos, job-photos, message-attachments, user-documents, avatars (~150 objects, ~10 MB) into the existing encrypted db-backup artifact; id-documents excluded for privacy. Extend the weekly restore drill to prove the files restore.
- [ ] **Q151 Audit the right-side panel overlap on every signed-in page (owner 2026-09-23: "you audit it and check"; carried from Q10).** With the desktop rail open, measure every signed-in route at 1024, 1280, 1440 and 1920: nothing under the rail, .app-shell-frame inset exactly --desktop-sidebar-w, zero horizontal overflow, column centred in the post-rail area. Screenshot each failure plus a sample, record reviews, fix at the shared layer only.
- [ ] **Q152 LAST STEP: cut the TestFlight build (`bundle exec fastlane ios beta`) only after every other queue item is done (owner, 2026-09-23: "wait on test flight until everything in Que is done").** Claude runs it from main; then the owner installs it, signs in, and taps Enable -> Allow on the notifications pill (MORNING QUESTIONS 5 / Q82), and push_tokens gets its first real device row.
- [ ] **Q164 A temporary edge function vanished within a minute of a successful deploy (2026-09-23 13:19Z).** `supabase functions deploy tmp-q156-stripe-events` printed Deployed; about a minute later POST returned 404 twice and `supabase functions list` had no such function; a redeploy came back as version 1 of a new function (13:19:59) and stayed. Unexplained: check whether the Supabase GitHub integration (Q121) or a hygiene job deletes functions that are not in the repo, before any lane relies on a temporary function. EVIDENCE 2026-09-23 (Claude, workflow_run_logs + function_edge_logs 13:10-13:30Z): the GitHub integration logged NO delete of any function in that window, only 'Deploying Function'/'No change found' lines. It started a run at 13:18:03 ('Cloning git repo... git_ref=main') that ended with no function deploys; the two 404s were at 13:19:14 and 13:19:33 and the redeploy served 200 from 13:20:08 on. So the timing fits a race with that integration run, but no log shows the integration removing it: the cause is NOT proven. Next step: re-test once Q121 turns the integration's deploy off (deploy a temp function, list it at +1/+3/+5 min). Until then a lane using a temporary function must `supabase functions list` and probe it immediately before use. RE-TEST 2026-09-24 (lead): deployed tmp-q164-probe at 04:23:31Z and POSTed it every 15s for 5 min (04:23:42-04:28:30Z). All 20 returned 200, and it survived two pushes to main in that window (176f9c91a docs, then the Q61 tick). It was then deleted, and `functions list` confirms it is gone. So the vanish did NOT reproduce; the cause is still unproven. Keep the list-and-probe rule. Tick when Q121 lands and one re-test there also holds.
- [ ] **Q201 Route skeletons that are not the page's shape. PROGRESS 2026-09-23: owner chose (a) PLAIN BACKGROUND for the generic chunk wait (pop-up); RouteSuspenseFallback now draws nothing (sr-only "Loading…", reserved height), guard src/components/RouteSuspenseFallback.test.tsx "draws nothing but the page background" (red on the bones version). STILL OPEN: EarningsPageSkeleton and ProfileRouteSkeleton shapes, the loading-states baseline re-measure, and the rect check in page-settle.spec. Was:** Route skeletons that are not the page's shape (owner 2026-09-23: "most of the skeletons are not even the page shape", "why are there so many"), measured at 375 by holding each page chunk (~/.lh-shots/cls/skel/, skeleton vs loaded PNGs).** Match: /browse (fixed, identical rects), /login (title 4px off), /home (cards 309x104 vs 301x102), /posts + /jobs (header card + list, close). Do NOT match: the generic RouteSuspenseFallback used by /post-job, /messages, /help, /support, /terms and every ProtectedRoute wait (title bone + two big blocks at 16,92 343x160, vs the real header title at y24/y82 and cards at 20,72/20,128 335 wide, public pages without their nav); EarningsPageSkeleton (no header title, first block y124 h318 vs Earned card y202 h291); ProfileRouteSkeleton (centred title bone vs left title, identity bone 104px vs ~180px card). OWNER DECISION NEEDED for the generic one: (a) plain page ground, as '/' now uses (the 2026-07-08 Cowork audit had flagged a blank body on slow networks), (b) per-route fallbacks in each page's real frame (touches App.tsx skeleton imports, coordinate with Q178), or (c) hold the boot splash until the first route chunk lands (lazyWithPreload + main.tsx) so a cold load shows no route fallback at all. Also: RE-MEASURED 2026-09-24 (loading-states-refresh run 35969110155, prod, 375, customer+helper+anon): of the 65 mismatches allowed since 2026-09-20, 61 no longer breach and 4 still do; 44 breaches the old measurement never saw (it predated the helper persona and the consent-at-mint fix) are now baselined, so baseline.json allows 48 (+26 byDesign). Those 48 are this item's remaining work. UNSTABLE (measured 2026-09-24 09:10Z): the last three loading-states-refresh runs (35910881322, 35969110155, 35970927275) failed with 282, 44 and 13 breach lines and NO breach common to all three. ROOT CAUSE (2026-09-25, from the logs of 35970927275, 36055191338, 36069105982): (1) the loading frame was taken at the first poll instant any placeholder showed, so the SAME surface was captured at different stages run to run (helper /post-job cl=1/1 in 35970927275 vs cl=2/2 in 36055191338; customer /user/71c56dfb cl=4/4 vs cl=2/2; helper /profile?tab=security row 736px -> 74px in 36055191338 only), and the ordinal cluster keys (#0, #1) then named different boxes; (2) the key carried the measured job's id, and the job is the newest on prod (a6425b68, fb65945e, ca7ae96f in those runs), so baseline entry `customer /jobs/c9b3bd7a... #0|jump` could never match again and read as stale on every run; (3) 36069105982 went red on the request budget (perTest 3323 over 3271) and its baseline check step was SKIPPED, having no `if:`. FIXED IN CODE (branch lsr-fix): measure-loading-states.mjs holds every data request at a gate and takes the frame at a settled stage (nextStage: capture / release one wave / empty); check-loading-state-shape.mjs keys /jobs/<id> as /jobs/:id (stableUrl) and prints every stale entry; the workflow judges the baseline whenever the measure step succeeded; loading-states perTest budget 3323 (highest measured, 36069105982). GUARDS: src/test/loadingStatesRepeat.test.ts (6 of 7 red on the pre-fix tree, the 7th red when the fixed checker reads the id-keyed baseline) and requestBudget.test.ts "a red budget step never skips a later step" (red on the pre-fix workflow). OPEN: the staged capture measures a different frame from the instant capture, so baseline.json must be re-derived from a fresh PROD run: dispatch loading-states-refresh.yml (workflow_dispatch) on the landed commit, rewrite `allow` from that run's check output (new breaches in, stale out), and re-dispatch to confirm two consecutive green runs; the dispatch's budget line also re-checks perTest 3323. Guard (for whichever is chosen): extend page-settle.spec with a skeleton-vs-loaded rect check (title + first block within 4px) per route, holding the page chunk.
- [ ] **Q192 Q180 follow-ups from the lh-authz-rls review (2026-09-23).** (a) DONE 2026-09-23 (Q193, measured, no dashboard needed): the landing is now https://www.louisianahelpr.com/signup-pending (/account-pending was deleted). A real admin generate_link for a seeded test account with that redirect_to 303s to exactly https://www.louisianahelpr.com/signup-pending#access_token=… (so it IS allow-listed); https://evil.example.com/steal falls back to the Site URL (not open). Probe: ~/.lh-shots/q193/landing-probe.mjs. (b) The server enforces email confirmation ONLY by GoTrue refusing unconfirmed sessions; no RLS policy or RPC checks auth.jwt() email_verified, so a session minted another way (admin createUser without email_confirm) could write. Decide whether Q180 needs a server half (data-model change, own review). (c) An unconfirmed account that is also banned can land on /signup-pending (the email gate fires before the profile loads) rather than /account-banned, until it confirms (0 such rows live; the denied state no longer exists since Q193). (d) Not checked: whether the desktop right rail renders for an unconfirmed user on public pages (/help, /support, legal).
- [ ] **Q206 Q178 follow-ups: bytes still on every cold load (2026-09-23, measured on the Q178 build).** (a) The app shell's static graph is 15 chunks / 315 KB gzip before ANY page can render (scripts/perf/critical-path.mjs --files): app-shared alone is ~138 KB because vite.config.ts's app-shared group captures its members' dependencies recursively (react-router, tailwind-merge, sonner, @capgo social-login inside it), plus supabase 53 KB and forms/zod 22 KB that the landing's H1 does not need (App shell hooks useCurrentUser / useLoginTracking pull Supabase). At 1.6 Mbps that is ~1.6 s of the 2.66 s landing. (b) /browse: the first card waits on the jobs query, which is issued only when DashboardGuest mounts (~2.7 s); the card lands at ~4.2 s. Issuing it from the entry would overlap it with the bundle. Guard for either: tighten scripts/perf/critical-path-budget.json (its KB band fails a stale budget) and add a data-start check to scripts/perf/measure-load.mjs.
- [ ] **Q210 Q202 follow-ups, not built (2026-09-23).** (a) A GIFT-CARD donation whose inquiry escalates to a chargeback is not revoked (the revoke runs only on charge.dispute.created; a second call re-pages); (b) off-session charges (auto-tip-charge, charge-recurring-visits) cannot request 3D Secure (no cardholder present), so a recurring visit of $300+ carries no 3DS; (c) DONE 2026-09-23 (owner: cap the urgent bonus at $250): MAX_URGENT_FEE_DOLLARS = 250 in _shared/jobBudgetLimits.ts (was = the budget ceiling), re-exported by src/lib/moneyLimits.ts. Layers read: posting form BudgetSection (label "$5 minimum, $250 maximum" from the constants, input max, inline warning above it), submit validator useJobSubmit (already refused above the constant), create-payment escrow (new urgentFeeOverCap() refusal before any Checkout Session; the old Math.min clamp stays behind it), DB CHECK jobs_urgent_fee_ceiling <= 250 (migration 20260923175412: unfunded is_seed rows above $250 lowered to it, then ADD ... NOT VALID + VALIDATE, RAISE naming the count if any real or funded row is above $250; PGlite 3x: 250 in, 250.01 refused on insert and update, a real $300 row or funded seed $1,000 row fails the migration and leaves the old CHECK, log ~/.lh-shots/q210/pglite-q210c.txt). NEEDS LIVE CHECK: prod rows with urgent_fee > 250 were not measured (no prod access); db-deploy fails loudly if a non-seed or funded one exists. No bonus edit UI exists: urgent_fee is in locked_everyone of the jobs column-lock trigger. Seeds (seedDataHeavy.ts) now post $250. GUARD: src/test/urgentBonusCap.test.tsx + the two $250/$250.01 cases in src/test/edge/create-payment.test.ts (red on bf4007bed: 4/6 and 1/2; 7/7 @mutate red); jobBudgetCapIsOneConstant.test.ts no longer ties the bonus to the budget cap. (d) DONE 2026-09-23 (owner: bump so every account re-accepts): Terms version "Jun 2026" -> "Sep 2026" in all three copies (src/lib/consent.ts LATEST_TERMS_VERSION, _shared/legalVersions.ts LEGAL_TERMS_VERSION, legalSections.ts LAST_UPDATED.terms) and the two seed scripts that pin it (prod-seed.mjs, create-app-review-demo-account.mjs); Privacy and Community stay "Jun 2026". Every approved, confirmed account whose terms_version_accepted is older sees the non-dismissible TermsReconsentDialog; e2e/prod-audit/harness.ts clearConsentGate() accepts it for the audit accounts. NOT FIXABLE IN CODE, needs a native release: installed iOS/Android builds bundle the old web code ("Jun 2026", stale on any mismatch), so a tester who accepts on web and then opens an old build is asked again and the old build writes "Jun 2026" back (lh-money-escrow review, 2026-09-23); harmless before launch, gone once a build carrying this commit ships. GUARD: src/test/termsReconsentOnBump.test.tsx (three copies agree, which legalVersions.parity.test.ts never checked for consent.ts; version past Jun 2026; seed scripts pinned; render: a Jun 2026 or blank account is prompted and I Agree writes the new version, a current one is not; red on bf4007bed 2/5, 4/4 @mutate red). (e) DONE 2026-09-23: adminJobsHelpers.ts flags a budget above MAX_JOB_BUDGET_DOLLARS ("Budget above the $1,000 cap") and the CollapsedPolicy.tsx comment names the constant. GUARD: src/test/noRetiredPriceCapLiteral.test.ts (every non-test .ts/.tsx/.mjs/.js under src, supabase/functions, scripts, e2e, comments blanked: no "$5,000" string and no budget/price compared with or set to 5000; red on bf4007bed with exactly the adminJobsHelpers.ts:105 hit; 3/3 @mutate red). STILL OPEN: (f) NOT VERIFIED IN STRIPE TEST MODE: a reversal against a connected account whose balance is empty (fails, or drives the Express balance negative), and the full dispute -> clawback -> won/lost path on a real test charge (no Stripe key on this machine; the webhook cannot be driven without its signing secret); (g) a partial dispute on an existing group job is taken oldest transfer first, not pro rata; the WON flip back to released also fires the existing 'Payout released' notice beside 'Disputed payment returned to you'. Guard for (a)-(b) when built: extend src/test/edge/chargebackClawback.test.ts and src/test/threeDSecureOnLargeCharges.test.ts. LANDED 2026-09-23 from cloud/q210-bonus-terms (money review APPROVED; migration re-timestamped 20260923192217). Lead check before landing: TermsReconsentDialog is mounted app-wide and its Terms/Privacy links open /terms and /privacy in a new tab, so it covered the page it asks the user to read; it now stays closed on /legal, /terms, /privacy (RECONSENT_EXEMPT_PATHS), GUARD src/test/termsReconsentOnBump.test.tsx (3 route cases, red with the list emptied). is_seed profiles set to terms_version_accepted = "Sep 2026" after deploy so nightly suites do not meet the dialog.
- [ ] **Q272 The press sweep's end-of-run profile "restore" races its own shards (found by Q200, 2026-09-23).** press-every-control snapshots each shared account's profile once PER SHARD at start and PATCHes every differing column back at that shard's end (cleanup() in scripts/audit/pressProdSafety.mjs). Four shards run concurrently, so a shard that snapshotted after another shard's press (or after a cancelled run that never restored) writes the wrong value back: run 35837735324 shard 2 at 11:02Z "restored senior_mode, available_until" to the flipped value. Q200 stops toggles reaching the profile, but any other profile column a press can change is still restored from a racy snapshot. Fix: one snapshot per RUN (taken before any shard starts, e.g. a preflight job artifact) and one restore after all shards finish; or restore only columns this shard itself changed. Guard: a test that two interleaved shard snapshots cannot restore a value neither started from.
- [ ] **Q213 List rhythm and card padding are still per-page (found by Q191, 2026-09-23).** Q191 unified the gaps BETWEEN a page's sections; two neighbouring scales were measured and left alone. (a) The same job card sits at three list pitches on a 375 phone: Home feed 8px (BrowseTasksFeed `pb-2`, coupled to the virtualizer's row estimate, so a change must move both), guest /browse 10px (GUEST_FEED_GRID_CLASS `gap-2.5`), Activity lists 12px (`space-y-3`). (b) liquid-glass cards split p-4 (39 sites) vs p-5 (37 sites). Decide one list pitch and one card padding and apply through tokens like --section-gap. Guard: shell-spacing.spec.ts SECTION_EXCEPTIONS lists the 8/10 feeds exactly, so unifying them fails there until the list shrinks.
- [ ] **Q215 /profile?tab=gift_card at 1440 showed content running under the right rail (seen in Q191's desktop shots, 2026-09-23).** Identical before and after Q191. The shots came from a scratch context with a mobile user agent at 1440, so it may be that context; shell-spacing.spec's real desktop context passed its past-the-right-edge check. Not verified either way: re-shoot in a desktop context and fix if real.
- [ ] **Q217 /legal search at 1440: the desktop right rail intercepts the magnifier click (found by the Q143 lane, 2026-09-23).** e2e/prod-audit/expanding-search-geometry.spec.ts "legal ... @1440" failed on a local build (this lane's code, which does not touch /legal or the rail): page.click on `button[aria-label="Search all policies"]` timed out because a button inside `nav[aria-label="Primary"]` (the fixed right rail) "subtree intercepts pointer events". Either the legal page's search trigger sits under the rail (a rail-inset defect, CLAUDE.md "desktop rail") or the spec clicks a covered point. Not investigated further; the shell lane (Q191) was editing shells at the time, so re-run on main first. Log: ~/.lh-shots/q142-q143/after.log. Guard to name when fixed: the same spec's legal@1440 case going green.
2. **Stripe TEST balance top-up (Q3).** Payouts and transfers fail with
   **ANSWERED 2026-09-23 (owner pop-up): yes, top up $500 in TEST mode and re-run the failed test payouts. Work item Q145. DONE 12:51Z (see Q145).**
   "insufficient available funds" (sandbox). The fix is test-mode charges with
   the 4000 0000 0000 0077 card, which funds available balance immediately.
   That's fake money, but it is still creating charges, so I held it for your
   yes: reply "top up" and I'll do $500 and re-run the failed payouts. The
   balance MONITOR (alerts before payouts fail) doesn't need you. It's being
   built overnight.
3. **Facebook posting credentials (Q42).** `marketing-publish` fails every 15
   **ANSWERED 2026-09-23 (owner pop-up): turn the Facebook channel off now; adding META_PAGE_ACCESS_TOKEN + META_PAGE_ID stays on the owner to-do list. Work item Q146.**
   minutes (7 times since 22:29Z on 2026-09-22, last 2026-09-23 04:00Z) with
   `aborted: meta_secrets_missing — facebook: META_PAGE_ACCESS_TOKEN,
   META_PAGE_ID`. A Facebook post is queued and the function has no page
   token. Either add the two secrets (`supabase secrets set ...`, a credential
   step only you can do) or tell me to turn the Facebook channel off until
   you do; the alert then stops at the source.
4. **Should seed/test accounts receive real email? (Q2/Q29)** Every dead
   **ANSWERED 2026-09-23 (owner pop-up): keep sending to test accounts until launch; stop at launch (on the launch checklist as Q144).**
   letter so far went to a test account, and the cause was Resend's DAILY
   QUOTA: the 2026-09-13 seed-heavy run enqueued 319 emails in one day. Test
   mail spends the same quota real users' sign-in and receipt mail needs. The
   option: skip sending to is_seed recipients (log it as `skipped_seed` in
   email_send_log), with an allowlist for the journeys that assert delivery.
   Your call, because it changes what the E2E journeys can check.
5. **Push notifications (Q82): three things only you can do.** The code
   cause is fixed and pushed (see Q82), but no phone has the fix yet.
   (a) **Cut a TestFlight build from main** (at or after the Q82 fix commit)
   and install it on your iPhone. The only builds with the AppDelegate
   forwarding are ce4d38d59 (2026-09-02) and later, and every build so far
   also has the boot race (it depends on timing, so it may not hit every
   launch). (b) **On that build: sign in, go to Home, tap "Enable" on the
   notifications pill, then Allow.** The pill only shows after you've posted
   or applied, or on a later launch more than an hour after install. If you tapped "Don't
   Allow" on any earlier build, iOS will not ask again: turn it on in
   Settings > Helpr > Notifications first, then cold-launch the app. Within
   seconds `select count(*) from push_tokens` should be 1 and
   analytics_events should show `push_token_saved`. If it doesn't, the
   analytics events say which step failed. (c) **Only if you run the app
   straight from Xcode on your phone:** those builds get SANDBOX APNs tokens,
   and prod sends to the production APNs host (`APNS_USE_SANDBOX` is unset),
   so APNs rejects them with BadDeviceToken and the sender deletes the row.
   TestFlight/App Store builds are unaffected. Leave this alone unless you
   test from Xcode. APNs credentials are fine: APNS_KEY_ID, APNS_TEAM_ID
   (digest matches P85MCK558V), APNS_BUNDLE_ID (digest matches com.Helpr)
   and APNS_AUTH_KEY are all set in Supabase secrets. Whether the .p8 key
   itself is valid can't be checked without a real token to send to.
6. **The "I Am Licensed" / "I Am Insured" switches (Q99).** Only our team can
   **ANSWERED 2026-09-23 (owner pop-up): (b) replace each switch with an "Add license" / "Add insurance" button that goes straight to upload-for-review. Work item Q142.**
   set those two flags; a member's own write is undone by the database. Since
   Q99 the switch only opens the attach area and turns on for real once a
   document is sent. Pick one: (a) keep the switches as they are now;
   (b) replace each switch with an "Add license" / "Add insurance" button that
   goes straight to upload-for-review; (c) remove the switches and show the
   attach areas all the time.
8. **Should marketing auto-publish be ON? (Q42/Q166)** You did not turn it on.
   **ANSWERED 2026-09-24 (owner pop-up): (a) turn it OFF until the Meta secrets exist. Work item Q365.**
   Measured from the API gateway's edge_logs: press-every-control run
   35837735324 PATCHed `marketing_settings` at 10:50:07Z on 2026-09-23 as
   admin@louisianahelpr.com (referer 127.0.0.1:4173, the CI runner), and every
   press run since 2026-09-22 17:52Z had been flipping the Auto-publish and
   channel switches the same way (17 PATCHes in 6 runs). The sweep can no
   longer press admin switches (Q166). Live now: auto_publish_enabled = true,
   Instagram on, Facebook off; the Meta secrets are missing, so nothing posts
   and marketing-publish now reports this once a day as an owner to-do instead
   of a critical page every 15 minutes. (2026-09-24: marketing-token-health also stopped
   paging CRITICAL + 500 for the same missing secret; it defers to that to-do.) Pick one: (a) **off** until you add the
   Meta secrets (I switch it off in Admin -> Social); (b) leave it on, so
   scheduled Instagram rows post as soon as the secrets exist.
- [~] **Q41 REPORTED 2026-09-23: docs/audit/dead-code-report-2026-09-23.md (NO-GUARD: a report; deletions wait on MORNING QUESTIONS 9).** Measured: knip 0 unused files, 97 exports + 11 types; 5 files only tests reach (production-entry knip); 4 unrendered components; 2 routes with no link; 1 edge function nothing calls (helpr-pass-wallet); 5 DB functions with 0 callers anywhere (+4 test-only group-job RPCs); 2 tables with no writer; 9 unreferenced scripts, 12 docs-only scripts, 12 unlinked top-level docs (overlaps Q165). Grouped (a) safe / (b) owner call / (c) keep. Was: **Q41 Morning report: everything the design no longer uses (owner,
  2026-09-23: "we can likely delete it").** REPORT ONLY, no deletion; the owner
  decides. Inventory with evidence for each item (call-site counts,
  reachability from a route or control, live DB reads and writes):
  - UI: components and dialogs no route or control can open (ReuploadIdDialog
    was one); tabs and views not linked from anywhere.
  - Code: the 97 unused exports and 11 unused types (knip); unused files.
  - Server: edge functions nothing invokes (scripts/check-dead-edge-functions.mjs);
    edge-function request fields no client sends (complete-signup portfolioFiles).
  - DB: RPCs no client/edge/cron calls; tables and columns nothing reads;
    triggers on dead columns; storage buckets with no writer (id-documents?).
  - Flows the product retired: ID upload to us (Q40), anything tier/role-gated
    that CLAUDE.md now forbids.
- [ ] **Q42 Work down the open items in the alert ledger (43 at backfill,
  2026-09-23).** The owner's order applies to them too: each one gets a root
  cause and a fix (or an owner ask), and closes only when its own verify
  passes. Group them first: stuck-payment x36 / job-stalled x30 / "asked
  support" x10 are mostly E2E and seed jobs (ties to Q2); nightly-red x5;
  detect_stuck_payments + ops-digest still failing; 24 manual error_logs items
  (cron-http timeouts from before the 30s change, email-dlq, dispute-unsettled).
  WORKED 2026-09-23 05:40-06:15Z. Open items 36 -> 14 (live ledger, 06:17Z; 23 closed with re-runs, 1 new from another lane).
  CLOSED with their own re-run (evidence in closed_evidence):
  - 8 alert items from test data (Q2): did-you-finish, has-this-job-been-
    finished, asked-support, job-auto-cancelled (probe notification to a
    tokenless seed admin: no ops-alert row, no ledger row), stuck payment +
    detect_stuck_payments (re-run: 14 flagged, all seed, 0 admin
    notifications; ops_alert_verify closed it), job stalled + job stalled
    with escrow held (all 11 escalated jobs are is_seed), new member joined
    (probe account since deleted).
  - subscription-reconciliation 500 x2: a seed profile's subscription was
    reported paid_but_no_tier every day (the real-only scope dropped seed on
    the DB side only). Dry-run re-run 05:55Z: clean, 0 findings.
  - 11 cron-http timeout items: all before the 30s timeout change; 7-89 runs
    each since 22:29Z with zero timeouts (sweep-cron-http-failures alive).
  - ops-digest-undelivered: the 09-22 run died in the pg_cron startup-timeout
    outage. Re-ran send_ops_daily_digest() 05:54Z (Slack 200 ok);
    check_ops_digest_delivery() ok, closed by ops_alert_verify.
  - void-cancelled-payments B2 went live at 06:10Z: all 9 cancelled+unpaid
    seed jobs with a session are now 'abandoned' (0 left).
  STILL OPEN, with owner:
  - marketing-publish 500: Meta secrets missing (MORNING QUESTIONS 3).
  - (closed 12:54Z by Q145) scheduled payout failed: test Stripe balance empty (MORNING QUESTIONS 2 /
    Q3); links to /admin, no subject, so it cannot be seed-routed yet.
  - Sentry not synced (MORNING QUESTIONS 1).
  STILL OPEN, not mine to close yet:
  - ban review needed (Strike Probe Poster, a probe): link
    /admin?view=banreview names no subject; needs the subject in the link
    (apply_consequence_ladder) — see Q2 follow-up.
  - (closed 12:54Z by Q148) dispute-unsettled-seed (dispute 9756a585, seed, payout_pending — the
    release is owner item Q10). New seed rows no longer reach the ledger.
  - (closed 06:17Z) charge-recurring-visits DNS failure: the 06:06Z run was
    clean per the 06:15Z watcher.
  - nightly-red x7 and db-deploy: other lanes' red CI (main Vitest/Test red
    from UI tests + create-payment.test.ts, 32 failures in run 35822129589;
    db-deploy lint on 75d24ab1d; prod-audit messy-input/expanding-search
    since 09-17; press-every-control since 09-13). Their workflows close them.
  - push-tokens-empty: new today, Q82's own monitor.
  - "subscription reconciliation ran degraded": raised by the fix's first
    dry run, because ANY note made a clean run post "degraded"; seed skips no
    longer go into notes (ea4f758bf). Closed 06:14Z: real run clean, notes [].
  WORKED again 2026-09-23 13:40-14:10Z (28 open at start). Shipped: marketing-publish
  treats "channel enabled, Meta secret missing" as one warning owner-action item,
  Slack once a day, HTTP 200 (guard src/test/marketingSecretGapIsOwnerAction.test.ts;
  deployed v808 14:00:44Z); the presser that turned auto-publish on (Q166,
  MORNING QUESTIONS 8); ledger sync closes nightly_red items that lost their issue
  ref (guard src/test/opsLedgerNightlyItemsCanClose.test.ts). Closed with re-runs:
  money-reconciliation 500 and arrival-confirm-reminder timeout (both manual
  probes, Q174), nightly-red main: staleness watch. Left open, with reason:
  the 4 "missed cron slot not re-run" items are the 22 Sep outage slots (Q53)
  found by Q30's first pass at 13:39Z; each job dedupes itself, so the right
  close is its next regular run succeeding (today 14:00 / 14:14 / 14:40Z), then
  `close` with that run; /profile error screen was the owner during the 22 Sep
  outage (Profile request timed out + Failed to fetch at 15:10Z), and its own
  condition clears at 15:10Z today; db-deploy red is 20260923133021 (Q30's
  migration, live on prod) awaiting its provenance ack.
- [ ] **Q43 LOOK at the alert ledger's surfaces.** The new "Open Alerts" card
  on /admin?view=health has never been screenshotted, and the session-start
  hook's open-alert summary hasn't been re-run since deploy. Screenshot at
  375 and 1440, record the review, and confirm the hook prints the real
  count within its time cap.
- [ ] **Q44 Stop main going red from partial gates.** On 2026-09-23 main went red
  4 times (Vitest, Vacuity, DB Deploy lint/types) because agents pushed after
  running only targeted tests. main-red-watch catches it; nothing prevents it.
  Add a serialized landing step: a commit touching src/test/**, vitest config,
  supabase/migrations/** or scripts/vacuity/** runs `npm run gate` (or the
  relevant CI job) before it lands. Measure it: count main-red runs per day
  before and after.
- [ ] **Q46 Test data is seed data from birth.** E2E/press/prod-audit write to
  prod (by design: no mock mode). Every fixture writer must set is_seed at
  insert time, and every alerting detector must state how it treats is_seed.
  Add a guard that scans the test writers and the detectors. This is Q2's
  structural half.
  DETECTOR HALF DONE 2026-09-23: src/test/alertingDetectorsDeclareSeedPolicy.test.ts
  (every SQL/edge detector that alerts about jobs/payments references is_seed
  in code or declares `seed-policy:`; red on origin/main 741e9d3a6 with 14).
  OPEN: the fixture-writer half (is_seed set at insert time).
- [~] **Q99 "I Am Licensed" / "I Am Insured" switches do nothing on prod, and the
  screen says they worked.** FIXED 2026-09-23 except the owner decision
  (MORNING QUESTIONS 6). Measured as helper-e2e: before, pressing the switch
  sent `PATCH {is_licensed:true}` (200, row returned `is_licensed:false`) and
  after a reload the switch was still ON over `is_licensed=false`
  (~/.lh-shots/q99/before-*.png). Class, from the newest
  prevent_self_escalation (20260915101102; 52 reset columns, identical to live
  pg_get_functiondef): 4 non-admin client writes named a reset column, all in
  CredentialsTab (switch: is_licensed/is_insured; send-for-review: the same;
  withdraw: those plus *_status/*_rejection_reason) and Profile.tsx
  handleIdUpload (idv_status). Upload path SURVIVES: tr_prevent_self_escalation
  fires before trg_auto_pending_credentials (name order), which sets
  is_<kind>=true and 'pending' from the url change (probe: url-only PATCH
  returned is_licensed:true, pending; url:null returned false, none). Fix: the
  switch writes nothing (it opens the attach area for the visit; a row-set flag
  with no document refuses to switch off, with a toast); send and withdraw send
  only the url and put the RETURNED row in the cache. After: 0 PATCHes on
  press, switch OFF after reload = row; send/reload/withdraw/reload on the
  fixed build matched the row each step; helper state restored and the probe
  file deleted (~/.lh-shots/q99/after-*.png, flow-*.png, *-log.json).
  Guard: src/test/profileProtectedColumnWrites.test.ts (list read from the
  newest migration, exact two-way KNOWN_OFFENDERS, 3 @mutate all killed; red
  with 4 offenders on the unfixed code, ~/.lh-shots/q99/guard-red-prefix.txt).
  Remaining offender: Profile.tsx handleIdUpload (idv_status), which no UI
  reaches (ProfileEditForm reads `_onIdUpload`); it goes with Q40.
  Needs an lh-silent-failure REVIEW-ONLY pass.
- [ ] **Q119 22 clipped control labels the Q116 widening found, not yet measured on screen.**
  Listed as UNMEASURED in KNOWN in src/test/truncatedActionLabel.test.ts
  (DatePickerField, DesktopSidebarNav, SavedSearches summary, TimeRangeField,
  JobCardMetaRow city, BrowseSearchBar, JobDetailFooter x3, NavQuickMenu x2,
  CollapsedPolicy x2, AddressAutocomplete x2, PetPicker breed line,
  ActivitySectionedView, PetCard, PetRailRow meta, EntryChoice x2, FormStep).
  For each: measure scrollWidth/clientWidth (line-clamp: scrollHeight) at 320/375/1440
  on prod; clipped UI copy wraps or gets its full text, clipped user data gets a
  `title`, unclipped stays with a dated measurement as its reason.
- [ ] **Q51 A regression check for the notification-panel jump.** It was fixed
  (f40193ae7: largest one-frame move 100px -> 13px) but only measured once, by
  hand; nothing fails if it comes back. Add a Playwright geometry spec (the
  per-frame rAF sampling from ~/.lh-shots/notif-panel-jump/measure.mjs) to the
  prod-audit/visual suite: open the panel with a short list, dismiss a row,
  and assert that no single frame moves the panel edge more than ~40px, in
  Chromium and WebKit.
- [~] **Q52 FALSE-GREEN HUNT (owner, 2026-09-23: "nothing is a false positive
  or going green if it's not truly green").** Areas 2-4 DONE with guards; area 1
  PARTLY done (see Q89). GUARDS:
  2. Workflows — src/test/workflowFalseGreenShapes.test.ts (SWALLOW `|| true`/
     `|| echo`/`|| exit 0`, early `exit 0`, continue-on-error without an
     `.outcome` read (and any `.conclusion` read of one), nightly-issue-sync
     status that ignores a `needs` leg, a check piped without pipefail,
     `set +e`, a custom shell without -e; two-way allowlists with reasons; 9
     @mutate, all killed). FIXED: nightly-red-age read failure = "None open";
     `git diff … || true` -> "nothing to lint/deploy" in migration-lint,
     db-deploy, functions-deploy; deploy.yml console.log guard passed with no
     bundle; db-smoke grep exit 2 swallowed; prod-audit exit 2 ("could not read
     prod") was a warning; press-every-control missing key -> exit 0 and notify
     ignored the cleanup job; e2e-real-backend status ignored the scheduled
     `authenticated` leg; 4 e2e teardown token-mint failures exited 0.
     ALLOWLISTED: 43 swallows, 15 early exits, 2 continue-on-error, 5 notify
     needs, 4 set +e — each with its reason.
     Also src/test/everyScheduledWorkflowReportsItsResult.test.ts matched a
     COMMENT (vacuity SURVIVED): it now reads `uses:` lines, which exposed
     nightly-red-age.yml and prod-errors.yml as never reporting their own red —
     both now have a notify job.
  3. Live check scripts — src/test/liveCheckScriptsFailClosed.test.ts (21
     live-reading scripts inventoried from source; 11 run hermetically with a
     failed and an empty read, 10 in a two-way NOT_HERMETIC list, 6 of those
     pinned). 9 fixed (stripe webhook 0 endpoints passed; strikes 1-of-6
     accounts passed; write-contract --refresh overwrote the snapshot with an
     empty catalog; cross-account-authz / two-account-journey always exit 0;
     prod-seed --verify, rail-overlap-probe, walk-every-control,
     function-body-drift floors). press-every-control.mjs now fails on 0
     controls found, UNCOVERED personas and clean-up residue.
  4. E2E skips — e2e/reporters/skipReporter.ts prints SKIPPED: N + table in the
     step summary and fails the run on any skip not justified in
     e2e/skipAllowlist.ts; guard src/test/e2eSkipsAreJustified.test.ts (63
     sites from source: 22 justified, 41 now FAIL the run incl. every
     prod-audit GAP skip such as interruptions double-apply; every workflow
     `playwright test --reporter=` line must name the reporter). EXPECT
     prod-audit / journeys / a11y-prod to go RED where a fixture or credential
     is missing — that is the point.
  Cadence: the full vacuity sweep stays WEEKLY (owner cost decision
  2026-09-22; a full sweep runs for hours); every "nightly" claim corrected
  and the "weekly workflow called nightly" check lives in
  workflowFalseGreenShapes.test.ts.
- [~] **Q54 Front/back PARITY sweep: every rule enforced in two places must agree. STATUS 2026-09-26 (cloud/open-process):** matrix docs/audit/parity-matrix-2026-09-26.md (dated measurement, read from migrations + edge source, NOT live pg_constraint: the Supabase MCP could not connect from the cloud container): 80 client/server pairs, 42 already tested, 36 newly tested, 2 still untested. GUARDS: src/test/textLimitParity.test.ts, src/test/enumRangeParity.test.ts, src/test/amountBoundsParity.test.ts, src/test/aiJobBuilderBoundsParity.test.ts (shared reader src/test/helpers/parityReaders.ts reads the NEWEST constraint/function); 36 @mutate lines, all 36 re-run by the lead and killed. REAL MISMATCH F1 (recorded, not changed): supabase/functions/ai-job-builder/sanitize.ts is looser than the post-job form on 6 bounds (description 4000 vs 1000, special requirements 1000 vs 500, budget 0..100000 vs 10..1000, group helpers 1..20 vs 2..10), assigned verbatim by src/pages/post-job/useJobEntry.ts applyAiJob; pinned exactly in KNOWN_DRIFT. RECOMMENDATION: lower the sanitizer to the form's bounds (server side is stale) and delete the KNOWN_DRIFT entries; it needs a lh-silent-failure review-only pass because it's an edge function. STILL OPEN: (1) upload MIME allow-lists vs bucket allowed_mime_types as one class guard; (2) saved-search radius vs saved_searches_radius_miles_positive; (3) one-sided client limits with NO server bound (jobs.title 32 / description 1000, pitch 500, decline note 200, report detail 10-500) listed in the matrix. OWNER DECISION: should those get DB CHECKs (recommended: yes for jobs.title/description)? Was: **Front/back PARITY sweep: every rule enforced in two places must
  agree.** Tonight's mismatches were one class: device-zone vs Central day
  (2 bugs), types.ts 59 differences behind prod, RPC error codes with no client
  copy, an admin badge reading a different column than verification uses, a
  static guard's exemption list missing from the live check. Inventory, from
  code, every rule the CLIENT enforces that the SERVER also enforces (budget
  min/max and pricing modes, text lengths and required fields, allowed
  status/enum values, fee/tip/refund math, time windows such as the cancel
  fee / day-of / auto-release, who-can-do-what gating, file size and type
  limits, rate limits), and every server value the client DISPLAYS (labels
  per status, error codes). For each pair: a parity test that fails when the
  two sides drift. Some exist (moneyFigures.parity, tierPerks.parity,
  earlyAccess.parity, cancellationFee.parity). Find the pairs that have no
  test and add one. Report the matrix.
- [ ] **Q56 Morning report: what should improve, and how to make it LOAD
  QUICKER (owner, 2026-09-23).** Measure first, recommend second: cold-load
  timings on prod at 375 (phone) and 1440 (TTFB, FCP, LCP, time to
  interactive, on web and WebKit); the critical-path JS/CSS (353 kB gz after
  d498580fb) and the largest route chunks; the number and duration of API
  calls a signed-in dashboard makes on load (the 09-22 load data shows
  heavy polling: applications+jobs 30k calls/14h, get_my_pending_direct_offers
  32k); images (formats, sizes, lazy loading); fonts; the DB side (slowest
  queries a page waits on). Deliver a ranked list: what it costs now, what
  the change is, the expected gain. Each speed fix ships with a budget check
  (e.g. bundle-size budgets, a Lighthouse/LCP budget in CI) so it can't regress.
- [~] **Q57 Nightly refresh jobs can PROVE a file is stale but can't UPDATE it.** STATUS 2026-09-23: OWNER SETTING DONE (verified via API: default_workflow_permissions=write, can_approve_pull_request_reviews=true). WIRED (branch cloud/q57-refresh-prs): shared composite .github/actions/refresh-pr rebuilds ONE bot branch per refresh (bot/refresh/<id>) from latest main, commits only its declared paths, skips when nothing changed (and closes a leftover PR), else opens or updates ONE PR and runs `gh pr merge --auto --squash`; never pushes main. Used by a `land` job (the workflow's only contents/pull-requests write) in scoreboard.yml (SCOREBOARD.md + the OPEN.md Everything-open block, rebuilt on latest main via `scoreboard.mjs --live-from`), loading-states-refresh.yml (measurements.json), write-contract-refresh.yml (snapshot; drift now lands instead of failing, a reject still fails), staleness-watch.yml (schedule/dispatch: `npm run inventories:refresh` on latest main) and morning-page.yml (docs/morning/, Q67). Not landed, with reasons in the guard: ui-sweep.yml (overlay baseline is a findings ratchet), vacuity.yml (same report staleness-watch lands), db-drift-detect.yml (types drift needs code fixes). GUARD: src/test/refreshWorkflowsOpenPrs.test.ts (set derived from scheduled workflows running a generator registered in scripts/check-generated-current.mjs, two-way; red on main before wiring: 3 of 6 failed, 4 workflows unwired; 5 @mutate, each killed). OWNER/LEAD WATCH: (1) with github.token a PR triggers no pull_request workflows, so the step dispatches `vars.REFRESH_PR_CHECK_WORKFLOWS` (default test.yml vitest.yml) on the bot branch; those must cover main's required checks, or add a `REFRESH_PR_TOKEN` secret (PAT/app token) so PRs trigger normally; (2) auto-merge needs Settings -> General -> Allow auto-merge (the land job fails loudly if not); (3) a merge made with github.token triggers no push workflows on main. TICK [x] when the first bot PR auto-merges.
  GitHub Actions here cannot push to main or open PRs
  (can_approve_pull_request_reviews=false; found by Q36). So re-measured
  evidence (loading states, press ledger, overlay baseline) must be committed
  by hand, which is exactly how numbers went stale. OWNER SETTING: Repo ->
  Settings -> Actions -> General -> Workflow permissions -> "Read and write" +
  "Allow GitHub Actions to create and approve pull requests". Then wire the
  refresh workflows to open an auto-merging PR with the regenerated files.
  **2026-09-24 re-measured:** no bot PR has merged. #1722 (scoreboard) sat with auto-merge on for 5 h: its pull_request runs are parked 'action_required' (github.token), and the default dispatch list (test.yml vitest.yml) produced only 1 of main's 3 required checks — and that one (Vitest) was cancelled on its 10-min limit (Q350), Test failed on a then-main lint error. FIXED: default now adds e2e-happy-path.yml + mobile-viewports.yml; guard src/test/refreshPrDispatchCoversRequiredChecks.test.ts (hosting workflow derived from required job names; vacuity 1/1 killed). Still TICK when the first bot PR auto-merges.
  2026-09-24 03:23Z bot PR #1722: dispatch now produced all 3 required checks (Mobile green; Vitest red on deadcode 97; E2E red on stale AASA pins). Both fixed on main in the commit after 7b13b7da9. Tick when the next refresh run's PR auto-merges.
3. **Let GitHub Actions commit the nightly re-measurements (Q57).** One
   setting: Settings -> Actions -> General -> Workflow permissions -> "Read
   and write permissions" + tick "Allow GitHub Actions to create and approve
   pull requests". Without it, stale numbers can only be fixed by hand.
- [ ] **Q60 LOAD TEST before launch.** The DB starved on 2026-09-22 with ZERO real
  users (Q53). Nobody knows how many concurrent users the current tier holds.
  Simulate realistic mixes (browse, post, apply, message, realtime, test-mode
  pay) with a test-account pool against prod at a quiet hour, stepping up
  until p95 or errors break. Record the ceiling and what gives first, and set
  alert thresholds below it. Owner decision after: tier, or optimisation.
- [ ] **Q62 Expiry monitor.** FIRST RUN 2026-09-23 23:40Z (run on expiry-monitor.yml) FAILED on 2 items it expects to read, measured from its log: (1) Sign in with Apple web client secret: the Management API returns it masked, so no exp can be read; Apple caps these at 6 months and Apple sign-in breaks when it lapses. OWNER: record when it was generated (Apple Developer > Keys / wherever the JWT was minted) as a dated entry in scripts/audit/expiry-inventory.json. (2) Vercel API token: GET /v5/user/tokens/current answered 404 (endpoint confirmed correct in Vercel docs), so the stored VERCEL_TOKEN is not a token that endpoint can describe; not yet diagnosed. Everything else read OK: certs to 2026-12-04, domain 2026-11-13 (auto-renews), Apple dist cert/profile 2027-04-26. STATUS 2026-09-23 (landed from cloud/q62-expiry-monitor): inventory scripts/audit/expiry-inventory.json (25 items), reader scripts/expiry-check.mjs, daily .github/workflows/expiry-monitor.yml (ledger + nightly-red + Slack at 30 days; unreadable items reported loudly), guard src/test/expiryMonitor.test.ts. First local read (lead, Mac): SSL www 2026-12-04, apex 2026-12-06; DOMAIN louisianahelpr.com 2026-11-13 (51 days, Squarespace: owner to confirm auto-renew); MapKit token 2027-02-14. Tick after the first CI run is green. Things that die silently on a date: the Apple APNs
  key and distribution certificate/profiles, the Stripe webhook secret, API
  tokens (Supabase access token, GitHub PAT, Resend, Sentry), the domain
  registration, SSL. Inventory each with its expiry, alert 30 days ahead,
  and add each to the scoreboard.
- [~] **Q63 Quota and limit monitor, before any free-tier limit bites.**
  Supabase (DB size, egress, connections, edge invocations, realtime
  messages; supabase-usage.yml covers part of it), Vercel (deploys,
  bandwidth, function time), GitHub Actions minutes, Resend send volume,
  Sentry quota. Alert at 70% and 90%, and show each on the scoreboard.
  **STATUS 2026-09-23 (cloud/q63-q72-monitors; built and stub-verified, NOT yet run on prod, so [~]):**
  `.github/workflows/quota-monitor.yml` (daily 23:17 UTC, prod-load slot) runs
  `scripts/check-quota-usage.mjs` (limits + maths in `scripts/lib/quotaMonitor.mjs`). READS: Supabase DB
  size (pg_database_size vs 8 GB Pro), client connections vs the LIVE max_connections, file storage
  (storage.objects bytes vs 100 GB), edge invocations (function_edge_logs 24h x 30 vs 2M/month, logs.all);
  Vercel deployments in 24h (GitHub deployments API, all environments, vs the Hobby cap of 100/day; a floor,
  CLI deploys make none); Resend sends month-to-date and 24h (email_send_log 'sent' vs ASSUMED free plan
  3,000/month, 100/day; a floor, Auth SMTP mail is not logged); Sentry accepted errors 30d (stats_v2, falls
  back to project stats on 401/403; vs ASSUMED Developer plan 5,000). NOT MONITORED, ::warning every run:
  Supabase egress and Realtime messages (no API; Management API usage routes 404, measured 2026-09-14).
  ALERTS through the ops alert ledger (warning at 80%, error at 100%, verify-ref quota-monitor.yml);
  UNREADABLE quota = ledger error + red run (nightly-issue-sync). Limits were NOT re-read from vendor
  pricing (egress-blocked in the cloud session); each has an LH_QUOTA_* override. GUARD:
  src/test/quotaMonitor.test.ts (maths, unreadable -> red, empty read -> red, no-API rows never "ok"; 6
  @mutate lines, each shown red) + both scripts in src/test/liveCheckScriptsFailClosed.test.ts. SQL executed
  in PGlite on a prod-shaped schema. FIRST PROD RUNS DONE: scheduled run 36082385383 (2026-09-25 03:20Z) green, 11 rows read (DB 74.5 MB of 8 GB, connections 26/60, storage 8.9 MB, edge invocations 313,980/2M projected, Vercel deploys 26/100 a day, Resend 811/3,000 month and 32/100 day, Sentry errors 255/5,000, Sentry replays 652/50 OVER; egress and Realtime messages NOT-MONITORED). STILL OPEN:
  GitHub Actions minutes (no API with GITHUB_TOKEN); 70/90% two-step and per-quota scoreboard rows (the
  workflow's own row is on the scoreboard); stale limits in supabase-usage.yml -> Q221.
- [~] **Q64 User-reported problems become tracked items.** In-app "report a
  problem" / support messages / App Store reviews mentioning a bug create
  an alert-ledger item (source `user-report`), so they're fixed and
  verified like any alert.
  STATUS 2026-09-23 (cloud/q64-q70, BUILT, NOT YET LIVE — the lead lands it and runs the first live pass):
  surfaces found in source: ReportDialog (job/message/user/review), the Profile support tab
  (SupportInline), /support (contact-support, signed in AND guest), and four `/support?topic=`
  entry points (shake-to-report, both dispute cards, the ban appeal); NPS is a survey, listed as
  not-a-report. Routing: migration 20260923181420 puts trg_reports_zz_ledger (AFTER INSERT) on
  public.reports -> one `user-report` ledger item per normalised title (dedupe: double-taps and
  repeats count, ids stripped), severity by kind (safety reports critical, issue reports error,
  messages warning, suggestions info), sample_ref = report id + link to /admin?view=reports|support;
  closes (sql_condition, hourly ops_alert_verify) only when every matching report is
  resolved/dismissed in its admin queue; seed reporters skipped. Flood cap (authz review M1): a
  NEW item is refused past 5 per reporter / 20 overall per hour and counted on ONE overflow item
  (closes when every open real report has its own item or is resolved). Guests (no reports row)
  are recorded by contact-support itself, ONE item per topic (the subject rides in sample_ref, so
  an unauthenticated caller cannot mint items; verify manual; link = the support-inbox subject
  line). morning-page no longer prints user-report titles (user-typed text, published). The
  old per-topic Slack companion item now closes when no user-report item is open. PGlite proof
  src/test/pglite/userReportsLedger.pglite.mjs: ALL PASS (39) x3 applies; 31 FAIL with
  NEW_MIGRATION=skip, 5 FAIL with the flood cap removed. GUARD: src/test/userReportsReachTheLedger.test.ts
  (two-way surface inventory from source; 4 FAIL on the unfixed tree, 7/7 @mutate red). Reviewed:
  lh-authz-rls REVIEW ONLY (M1, M2, L1, L2 fixed; L3 keyword severity accepted with the cap;
  verifier fairness is Q291). LIVE PASS TO DO (lead): after
  db-deploy, `pg_get_functiondef('public.ops_alert_condition'::regproc)` has the 'user-report'
  branch, `pg_proc.proacl` of the six new functions has no anon/authenticated, the backfill count
  (`select count(*) from ops_alert_ledger where source_kind='user-report'`) equals the open real
  reports of the last 90 days, and one /support guest message lands as a 'contact-support-guest'
  item after functions-deploy. App Store reviews are NOT ingested anywhere in source: Q289.
  LIVE PASS 2026-09-25 ~14:00Z (queue lane, read-only SQL): pg_get_functiondef(ops_alert_condition) has the 'user-report' branch; trigger trg_reports_zz_ledger on reports (fn ops_alert_ledger_from_report) present; all six new functions (that one, ops_alert_record_user_report, user_report_is_open/_is_real/_severity/_title) proacl = postgres + service_role only; backfill: 1 user-report ledger item (closed) and 0 open real reports in 90 days, which agree; contact-support deployed v2069 contains the 'contact-support-guest' path (get_edge_function). STILL OPEN: the end-to-end guest /support message (not sent: it emails the real support inbox and opens a ledger item; the lead or owner should send one and watch the item open and close).
- [ ] **Q65 Test-data hygiene on prod.** E2E/press/prod-audit write to prod by
  design. Measure how many is_seed jobs, users, messages, notifications and
  storage objects have built up; purge anything past a retention window on
  a schedule (dry run first); prove no real user ever sees seed data (the
  browse views already exclude it; verify every other surface).
- [ ] **Q66 Targets ("SLOs") on the scoreboard.** STATUS 2026-09-23 (landed from cloud/q66-q67-slo-morning): scripts/slo.mjs defines each target with its source; live rows on the scoreboard (not-measured metrics say why); guard src/test/sloTargetsTwoWay.test.ts. Tick after the scoreboard workflow measures them on CI. Define "working" as numbers:
  p95 page load (web + app), API error rate, uptime, payment success rate,
  notification delivery rate, time to a payout. Show each with its target on
  the Q59 scoreboard, red when missed.
- [ ] **Q67 An automatic morning page.** STATUS 2026-09-23 (landed): scripts/morning-page.mjs + .github/workflows/morning-page.yml write docs/morning/YYYY-MM-DD.md daily (shipped / red / new alerts / owner decisions); guard src/test/morningPage.test.ts. The lead ran it locally and it produced a correct page. Tick after the first scheduled run commits one (needs Q57 wiring). Generated daily: what shipped (commits
  grouped), what's red (scoreboard), new alerts, and the decisions waiting on
  the owner. The owner should never have to ask "what happened overnight".
- [ ] **Q68 Slow and patchy networks (rural Louisiana).** Run the core journeys
  (sign in, browse, post, apply, message, pay) on throttled 3G, and with
  the connection dropping mid-action. Every wait shows progress, retries are
  safe (no double post or pay), and nothing hangs silently. Add a CI budget
  (Playwright network throttling) so it can't regress.
  STATUS 2026-09-23 (cloud/q68-q69, BUILT, NOT YET RUN LIVE: that session had no prod access): e2e/slow-network/slow-network.spec.ts runs the six steps (e2e/slow-network/steps.ts: sign-in, browse, post, apply, message, pay-start) twice each: `3g` (Chrome DevTools "3G" via CDP; every wait over 1s must show progress within 1s, none may hang 90s) and `drop` (offline when pressing → the app must say so and write nothing; then the write's RESPONSE is lost after the server processed it and the user retries → the row must exist exactly once). Reuses the journey fixtures, the J2 post-job form (moved to e2e/journeys/postJobForm.ts, J2 now calls it) and prod-audit's ensureFundedOpenJob. Nightly 23:17 UTC, 1 worker: .github/workflows/slow-network.yml (project `slow-network`). GUARD: src/test/slowNetworkCoversEverySteps.test.ts (two-way: this item's journey list ⇄ steps.ts ⇄ the spec's tests; 5 @mutate lines, all red; its first run caught pay-start·drop missing its offline leg). FOUND BY CODE READ (not yet by a live run; each is now a failing assertion in the spec): post·drop and pay-start·drop are expected RED (Q267), message·drop RED (Q268); apply·drop expected green on the row count (DB UNIQUE(job_id, helper_id) + apply_to_job) with a copy defect (Q269); Q270 the post error toast. NEXT (lead): dispatch slow-network.yml, read the `wait`/`idempotency` annotations, record the measured numbers here, then tick with the guard.
- [ ] **Q69 Rollback drill.** Practise and time the three undo paths: a Vercel
  rollback to the previous deploy, reverting a migration (write the down
  migration, apply it in PGlite, and document the prod steps), and pulling or
  expediting an app build. Write the runbook, and re-drill quarterly.
  STATUS 2026-09-23 (cloud/q68-q69, BUILT, FIRST DRILL IS THE LEAD'S): scripts/rollback/rollback.mjs scripts the three undo paths: `web` (vercel rollback to the previous production deployment + rollback status), `migration` (a NEW forward revert migration stamped by migration:new, proved in PGlite by scripts/rollback/pglite-apply.mjs bad×1 + revert×3, pushed to main for db-deploy; the applied file is never touched) and `function` (redeploy one edge function from the previous commit in a temp worktree; also revert on main or functions-deploy undoes it). Dry run is the default and prints every command; live needs `--execute` AND LH_ROLLBACK_CONFIRM=<path>; every step is timed into ~/.lh-rollback/timing.jsonl. Runbook: docs/RUNBOOK-rollback.md (also covers the app build: App Store Connect actions, owner only). GUARD: src/test/rollbackDryRunNeverMutates.test.ts (recording shims for vercel/supabase/git/npm/node: every dry-run path, with and without a lone --execute, calls only allowlisted reads; a live control proves the detector fires; 3 @mutate lines, all red). NEXT (lead): run `node scripts/rollback/rollback.mjs plan`, then one live `web` drill, and fill the runbook's drill log with the timings.
- [~] **Q70 Privacy requests end to end, monthly.** Account deletion and data
  export run against a test account on a schedule: every table the user
  touched is anonymised/deleted per policy, the export contains everything,
  and a job outliving its poster still renders (CLAUDE.md "a job can outlive
  its poster").
  STATUS 2026-09-23 (cloud/q64-q70, BUILT, FIRST LIVE RUN NOT YET DONE — the lead dispatches it):
  e2e/privacy/privacy-requests.spec.ts (Playwright project `privacy`, this commit's local build,
  prod backend) creates a DISPOSABLE seed account (helpr-privacy-journey-<run tag>@mailinator.com,
  is_seed), gives it two jobs (one the shared helper applied to), an avatar + a user-documents
  object (both listed first, as a positive control), a support report and notification
  preferences; presses "Download My Data" and checks every section, the profile and both jobs,
  and that the seeded tables left out are exactly KNOWN_NOT_EXPORTED; presses Delete Account -> Continue -> DELETE ->
  Delete Forever; asserts every purge step BY NAME ok (stripe, storage, avatar_pointer,
  retain_ban, database, job_media, message_attachments), purge_user_data's counters, auth user +
  profile gone, every identity bucket (accountPurge.ts IDENTITY_BUCKETS) empty at <uid>/, the unhired job deleted, the applied-to
  job kept but ownerless/redacted with status preserved, the report anonymised, the prefs deleted;
  then the applicant's Activity (/jobs) renders healthy (/jobs/:id cannot show an ownerless job
  by design: quick-apply reads open_jobs_browse). Cleanup reads every delete back; residue fails. Never a real account: scripts/lib/privacyJourney.mjs
  assertDisposable (this run's address, not a shared account, is_seed, created this run) runs
  fresh from the DB right before the irreversible press and before any cleanup, which goes
  through delete-own-account itself. Monthly: .github/workflows/privacy-journey.yml (weekly cron
  Wed 01:17 UTC + a first-7-days gate, since prodWorkflowSpacing refuses day-of-month; dispatch
  always runs; missing secrets = red), red -> the nightly-red issue, which the hourly ledger sync
  turns into a ledger item that closes only when a DUE run goes green (a `record --verify-ref`
  item would close on the next gated no-op week). GUARD: src/test/privacyJourneyCoversPurge.test.ts (purge steps, identity buckets and
  export sections two-way with accountPurge.ts / DataExportCard.tsx, counters vs the newest
  purge_user_data, the fail-closed allowlist; 8/8 @mutate red). Reviewed: lh-silent-failure REVIEW
  ONLY (H1 avatar gate, H2 outlive surface, H3 ledger close, M4-M6, L8-L10 fixed; M7 is Q293). The export OMITS rows the account
  has (KNOWN_NOT_EXPORTED: reports, notification_preferences; and messages, notifications etc.
  beyond what the journey seeds): Q290. LIVE RUN TO DO (lead): `gh workflow run
  privacy-journey.yml`, then read the run and confirm no helpr-privacy-journey-* account remains.
- [ ] **Q71 Accessibility on every route.** An automated axe scan across the full
  route inventory in CI (both themes, 375 + 1440), failing on
  serious/critical issues, plus a real VoiceOver pass on iOS each release,
  recorded with review:record.
- [ ] **Q73 Email deliverability.** Verify SPF/DKIM/DMARC for the sending domain,
  seed-inbox placement (inbox vs spam), bounce and complaint rates from
  Resend, and why test mail dead-letters (Q29/Q2). Show them on the scoreboard.
  MEASURED 2026-09-24 (lead): DNS: SPF, DKIM and DMARC all resolve OK. email_send_log over 30d:
  856 sent, 54 dlq, 33 failed, 45 pending. All 45 pending were written 2026-09-13 02:11-03:30Z
  to 2 is_seed accounts, so they are stale log rows, not a stuck queue. Every dlq/failed row in
  the last 3 days went to an example.com test address ("Resend 422 Invalid `to`", then "Max
  retries (5)"). That is test noise, and Q144's seed skip removes it. Bounces ARE recorded:
  resend-webhook is deployed and suppressed_emails holds 1 bounce (2026-09-21). email_send_log
  never gets a 'bounced' status by design, so rates come from suppressed_emails. Still open:
  seed-inbox placement and the scoreboard row.
- [ ] **Q74 App crash rate.** FOUND 2026-09-24 (Q296 work): the NATIVE apps never reported to Sentry. beforeSend dropped every event with hostname 'localhost' outside DEV, and iOS loads from capacitor://localhost, Android from https://localhost; Sentry had 0 error events with a capacitor:// or https://localhost URL in 90 days (search_events, helpr-4m). errorLogger.ts had the same bug fixed with isNativePlatform; Sentry had not. Fixed by isLocalBuildHost (http-only loopback) — takes effect in the next native build (Q152). Then measure crash-free sessions here. iOS/Android crash-free sessions from Sentry native
  + App Store Connect, on the scoreboard with a target (e.g. >= 99.5%), and
  a crash spike creates a ledger alert.
- [ ] **Q75 Secret scanning, repo + full git HISTORY.** Many agent sessions have
  committed here; a key committed once stays in history after deletion. Scan
  every commit (gitleaks/trufflehog, or GitHub secret scanning via the MCP
  run_secret_scanning), rotate anything live that's found (owner, for
  credentials), and add a pre-commit + CI secret scan so a secret can never land.
  **STATUS 2026-09-23 (cloud/q75-secret-scan; gate built, rotation is the owner's step, so not ticked):**
  SCANNED every commit on all 68 origin branches + 1,270 GitHub PR refs (12,100 non-merge
  commits, incl. this branch) with gitleaks 8.28.0 (default rules, `--redact`) and a second pass decoding every
  JWT for its role. NO service_role JWT, sb_secret_, sbp_, Stripe sk_/rk_/whsec_, Resend re_,
  Sentry token, GitHub token, Google/AWS key or real .p8/.pem ever committed; no key file
  (.p8/.pem/.key/.p12) ever added. Findings (sha, type):
  (1) b7bc81eb7 docs/backups/test-debris-backup-2026-09-11.json, 16 lines: Supabase storage
  SIGNED-URL tokens (proof-photos, exp 2027-09-09), still on main, LIVE-LOOKING (bearer read of
  16 test proof-photo objects if they still exist; prod not checked from this session) -> Q203.
  (2) 57c3aed68 src/test/edge/verify-apple-iap.test.ts:69 PEM P-256 key: test-only fixture.
  (3) 71a53f43c .env.example:41 MapKit JS token (VITE_, public by design; no `origin` claim).
  (4) anon JWTs (71a53f43c, 3c55f3029, 63e58de50, 1cd2d9367, 35a1e6e63; old ref steigdwrpkosbiycshwz
  + prod) and sb_publishable_ (22 lines) incl. the committed `.env` (63e58de50, 0f01f9e3e,
  a626414be, 0a8b381ec: only VITE_SUPABASE_URL/PROJECT_ID/PUBLISHABLE_KEY): public by design.
  (5) false positives: curl `-u "$SK:"` env refs (f2b31d310, 35baa978c), PEM header-only
  (b794db997, a44a65f3d), test values (774b15c2e, acae4c06f, b7ed6e10e, 45ef80957, d7c4e078b, 65676a7ad).
  GATE: .gitleaks.toml (default rules + 11 repo shapes + public allowlist) and .gitleaksignore
  (triaged fingerprints only); .husky/pre-commit runs scripts/secret-scan.mjs --staged (node shapes
  from scripts/lib/secretShapes.mjs, + gitleaks when installed); .github/workflows/secret-scan.yml
  scans every push/PR's new commits with both engines, red on a finding. Guard:
  src/test/secretScanGate.test.ts. Shown red on a planted fake of all 14 shapes (hook and CI range)
  and green on the repo + full history.
  OWNER ROTATION LIST: nothing found requires a rotation. Optional: re-mint the MapKit JS token
  with an `origin` claim (Apple Developer, owner only). Also install gitleaks locally
  (`brew install gitleaks`) so the hook runs the full rule set, not only the repo shapes.
- [~] **Q77 FIXED 2026-09-23 (branch cloud/q77-q89-retry), live effect on the Mac not yet measured. Finished agents' worktrees pile up.** Every worktree-isolated agent
  leaves a LOCKED worktree under .claude/worktrees/, and prune-git-hygiene
  never touches locked ones (by design, since running agents lock theirs). Add a
  safe rule: a worktree whose agent has finished (its branch is merged into
  origin/main or has no commits, no process has cwd there, and it's older
  than 2h) is unlocked and removed; anything unmerged is reported, never deleted.
  DONE: rule in scripts/lib/worktreeHygiene.mjs, called by
  scripts/prune-git-hygiene.mjs. A LOCKED worktree under <main>/.claude/worktrees/
  is unlocked and removed (`git worktree remove`, never --force) when HEAD is in
  origin/main (rev-list 0, or every commit upstream by patch-id via `git cherry`),
  status is clean, no process cwd is inside (lsof; unknown = remove nothing), the
  pid in its lock reason (if any) is not running, and it is older than 2h. Unmerged
  or dirty ones are REPORTED in the hygiene output/log, never removed. Main is never
  a candidate; locks elsewhere are still skipped. GUARD:
  src/test/pruneAgentWorktrees.test.ts (fixture repo: bare origin + clone + 7 linked
  worktrees; plan AND apply; 11 @mutate, all killed, incl. restoring the old
  "skip every locked worktree" rule). TO TICK: the next session-start hygiene log
  (~/.lh-hygiene/hygiene.log) on the owner's Mac shows the .claude/worktrees count
  falling; the Claude Code lock-reason format (pid or not) was not observable here.
- [~] **Q82 No device has a push token: push notifications reach nobody
  (launch blocker).** MEASURED 2026-09-23: push_tokens 0 rows
  (n_tup_ins 0 since the 2026-09-22 restart); notification_logs push
  'skipped: no_registered_devices' x3,532 across 87 users since 2026-09-01.
  The owner's iPhone (iOS 18.7, native) signed in 10x between 09-03 and 09-09
  on TestFlight build ce4d38d59, which already has the AppDelegate
  forwarding. No push error was ever logged. NOT "never held a row":
  notification_logs shows 2 token rows deleted on 09-01/02 after APNs
  BadDeviceToken. Their users have no profile, so they look like synthetic
  probes; real-device rows: unknown.
  LAYERS: native AppDelegate forwarding + entitlements + SPM plugin: correct
  (code read). Server: upsert/select/delete own row as helper-e2e via PostgREST
  201/200/200, another user's row 403 (RLS correct); no trigger or cron prunes
  rows (only purge_user_data, sign-out, and the sender on BadDeviceToken). APNs
  secrets present, bundle/team digests match. **CLIENT (the break):**
  useNativePushSetup's effect depended on `navigate`, whose identity changes
  on every pathname change in react-router 7. A native cold launch at "/" is
  redirected at once by NativeLaunchRouter, so the setup aborted before
  register() and before the appUrlOpen listener. That kills token registration,
  Universal Links and the helpr:/// Stripe return for the whole session. Also,
  sign-out followed by sign-in in the same session never re-saved the token.
  FIXED in src/lib/nativePush.ts. GUARDS: src/lib/nativePush.bootRegister.test.tsx
  (red 6/7 on the old code, green 7/7; 3 @mutate lines, all killed) +
  LIVE MONITOR migration 20260923055631 (check_push_token_health, daily cron
  push-token-health: ledger item 'push-tokens-empty' while no real user has a
  token, closed only by ops_alert_verify re-asking; PGlite proof
  src/test/pglite/pushTokenHealth.pglite.mjs). Stays [~] until a real device's
  row lands, which needs the owner (MORNING QUESTIONS 5). Scoreboard: Q59
  doesn't exist yet. When it does, it reads check_push_token_health()
  (tokens, registered_14d, native_users_14d, skipped_no_device_7d).
  RE-MEASURED 2026-09-25 13:59Z (queue lane): check_push_token_health() = tokens 0, registered_14d 0, native_users_14d 0, skipped_no_device_7d 427. No native build has signed in for 14 days, and Q387 shows the one installed on the owner's iPhone predates months of fixes. OWNER: install the current TestFlight build on the iPhone, sign in, allow notifications; then push_tokens should hold a row (the push-tokens-empty ledger item closes itself).
4. **FYI, found overnight, a launch blocker: push notifications reach nobody.**
   push_tokens has 0 rows and thousands of pushes were skipped for having no
   device. CLAUDE.md's "push-token bug is FIXED" was only true for the native
   half. The JS boot code dropped registration on every cold launch that
   redirected. Fixed in code (Q82). Getting a phone onto the fix is
   MORNING QUESTIONS 5.
- [ ] **Q181 Accessibility gate: WCAG 2.2 AA + best-practice axe run in CI (from TODO.md, 2026-08-31).** STATUS 2026-09-23 (landed from cloud/q181-axe-wcag22): the route sweep and journey spot checks share ONE tag set (e2e/happy-path/axeTags.ts: wcag2a/2aa/21a/21aa/22aa + best-practice); sweepCore classifies violations against a two-way baseline (e2e/happy-path/axe-known-violations.json) and a MISSING baseline fails loud and writes axe-baseline-generated.json as a CI artifact. GUARD: src/test/axeGateCoversWcag22aa.test.ts (red when wcag22aa is dropped). NEXT (lead): dispatch a11y-webkit-prod.yml, review the generated baseline from both engines, commit it + register it in baselinesAreTwoWay JSON_TWO_WAY, confirm green, tick. No workflow runs axe with the `wcag22aa` tag (grep on e2e/ and .github/ 2026-09-23: none). Overlaps Q71; do them together.
- [ ] **Q183 Trust tuning (from TODO.md F-TRUST-02/03, auto-restrict, fraud).** [DONE: spelled-number evasion heuristic shipped, 20260915020258 line 84 (Q266)]; the fixed 2-flag/24h auto-suspend → warn-first; check whether `cash` tokens over-fire; retune the 1/2/3 auto-restrict ladder after 2-3 weeks of real data; fraud signals beyond burst-job. Post-launch data needed for the tuning half.
- [~] **Q184 Code health (from TODO.md). STATUS 2026-09-26 (cloud/open-process), re-measured:** `any` in non-test src/ 67 -> 47 by the TypeScript parser (21 -> 9 files), types only, two hidden type lies fixed (reviewPanel Review.reviewer_id is nullable; EditJobDialog category narrowed to job_category). Left: useUserProfileData 21, useMapKitJs 6, CurrentLocationPill 5, useVoiceDictation 4, useDashboardData 3 (dropping its casts exposes nullable open_jobs_browse columns incl. ownerless customer_id; needs behaviour decisions), others 8. GUARD: src/test/anyRatchet.test.ts + scripts/any-baseline.json. GOD COMPONENTS: GUARD src/test/componentSizeRatchet.test.ts + scripts/component-size-baseline.json (every non-test .tsx over 600 lines pinned at exact wc -l, two-way; a new crossing fails; 3 @mutate lines, re-run by the lead, all killed); 45 files over 600 (was 46): FilterSheet 922 -> 759 by extracting its display rows to src/components/dashboard/filterSheet/FilterSheetRows.tsx (new test FilterSheetRows.test.tsx, 2 @mutate killed). Biggest: JobTracking 2768, ConversationList 1873, BrowseMap 1241, NotificationPanel 1073, Dashboard 1033. useProfile(): the old '0 call sites' was WRONG, measured 2 (BrowseTasksFeed, Support); Profile/Dashboard/Messages read the profile through useCurrentUser (one shared cached query: select *, timeout + orphan reuse, admin tri-state), so moving them to useProfile's narrower slice would change behaviour; sub-item dropped. COVERAGE: nothing measures it today; measured once with @vitest/coverage-v8 installed OUTSIDE the repo: src/lib lines 64.47% (70 of 203 files at 0%), src/hooks lines 52.74%. STILL OPEN: shrink the 45 pinned files, the last 47 `any`, a coverage floor. OWNER DECISIONS: (a) add @vitest/coverage-v8 to devDependencies so CI can enforce a floor (recommended: yes, floor at today's number); (b) on the Mac run `sudo chown -R $(id -u):$(id -g) ~/.npm` (fixes ~/.npm/_cacache ownership). Was: **Code health (from TODO.md).** STATUS 2026-09-23 (landed from cloud/q184-any-burndown, merged with Q193 by the lead): `any` in non-test src/ 154 -> 67 by the TypeScript parser (48 -> 21 files); money/auth/admin files at 0 except one deliberate `as any` in AdminJobs.tsx (race-class scanner). GUARD: src/test/anyRatchet.test.ts + scripts/any-baseline.json (exact per file, both ways; shown red on a planted `as any`). STILL OPEN: god-component extraction, useProfile(), coverage, the npm cache. `any` in non-test src/: 164 on 2026-09-23 (was 385), burn down money/auth paths first; keep extracting god components; move Profile/Dashboard/Messages to `useProfile()` (0 call sites today); raise test coverage; fix `~/.npm/_cacache` ownership on the dev box.
- [ ] **Q185 OWNER launch-store tasks (from TODO.md).** App Store metadata refresh (docs/APP_STORE_REVIEW_SUBMISSION.md) and the review submission when the owner says go; logo uploads to Stripe branding, the Google OAuth consent screen and Gmail sender avatar (docs/LOGO_UPDATE_RUNBOOK.md); revoke the old GitHub PAT `claude-cli-codeql-fixes-2026-05-11`; Stripe DNS records for branded receipts; notification copy decisions; real name vs first-name+initial display (`formatName()`); paste the 5 Sentry alert rules.
- [ ] **Q186 Native polish (from TODO.md).** Alternate app icon for small notification thumbnails (rasterise with scripts/generate-ios-icons.mjs, add to Xcode); Apple Sign-In native iOS rewire (re-check whether it shipped before starting); [Leaflet → Apple MapKit: done, no leaflet in package.json (Q266)] (F-PERF-02; owner roadmap picked MapKit).
- [ ] **Q187 Post-launch product ideas (from TODO.md).** BusinessTeam seats/roles/invoicing; recurring job templates; notification cadence review of sweep-daily-job-digest. Ideas, not defects; feed them to Q19 (lh-suggester).
- [ ] **Q86 Cancellation money: two labels for one outcome, and a timeout
  that will bite at volume (found by Q50, 2026-09-23).** (a) A captured
  charge refunded minus the service fee is payment_status 'cancelled' when
  create-payment cancel_escrow settles it (75 prod jobs) but 'refunded' when
  void-cancelled-payments does (3 jobs); 'cancelled' also means "hold voided,
  nothing charged". Q31 read "0 live holds" off that label. Pick one meaning
  per value (or add 'refunded_partial'), migrate, and add a check that every
  writer uses it. (b) The one admin dispute refund (job e7e09075) withheld only
  Stripe's $1.11, not the $3 service fee the cancellation paths keep: decide
  whether that is policy, and pin it. (c) The money-reconciliation cron posts
  with pg_net timeout 30000ms; its Stripe comparison reads up to 300 PIs at
  10 in parallel, so a busy month could time the cron's HTTP call out (a
  cron-http failure, not a silent pass). Measure run time once real
  cancellations exist; raise the timeout or split the Stripe check out.
  (c) MEASURED 2026-09-23 07:52Z (Q88): 79 Stripe reads = 2.2s whole run;
  the runtime finishes and records its alert even after pg_net hangs up
  (400ms timeout test); a 20s Stripe-phase budget now reports truncation as
  a defect. (c) is closed; (a) and (b) stay open.
6. **Messages search at 320px (Q48): pick one.** It's fixed at 375 and up. At
   **ANSWERED 2026-09-23 (owner pop-up): (D) below 360px, search opens on its own line where the tab strip sits. Work item Q143.**
   320 a close-✕ that clears the magnifier leaves the field only 90px (below
   the 120px minimum that e794385ab restored). (A) accept 90px at 320;
   (B) keep the 28px overlap at 320 (shipped now); (C) put the magnifier
   rightmost below 360 (changes the VN-35 button order); (D) open search on
   its own line below 360, where the tab strip sits. Screenshots in
   ~/.lh-shots/q48/.

7. **Turn off Supabase's GitHub auto-deploy to production (Q121). Top priority.**
   On every push to main, Supabase's GitHub integration applies new migrations
   (and deploys edge functions) to prod within about a minute. Our deploy
   workflow's safety checks (lint, replay test, destructive-DDL stop) run after
   that, so for the last 24h (24 migrations) they have not blocked anything.
   Measured from prod's own logs 2026-09-23 (Q117). What you do: Supabase
   dashboard > Project Settings > Integrations > GitHub, and switch off
   automatic deploys to the production branch (exact toggle name not verified).
   Until then, each new migration turns db-deploy red by design (the new
   provenance check), so the side channel stays visible.

7. **Backups (Q45): the restore is proven weekly now; five things are yours.**
   **ANSWERED 2026-09-23 (owner pop-ups): (a) yes, Pro is paid and intended; (b) keep 14-day retention; (c) back up uploaded files EXCEPT id-documents, encrypted (work item Q147); (d) no PITR (no paid upgrade); (e) BACKUP_PASSPHRASE and ban_fingerprint_salt go in the owner's password manager (owner to-do).**
   Measured 2026-09-23. Nothing below is needed for the drill to stay green.
   (a) **Is the Supabase org really on Pro?** The API says `plan: "pro"`, and
   `supabase backups list` shows 7 daily platform backups. Every doc said
   "free tier". If you are paying $25/mo, you already have in-place daily
   restores for 7 days. If you did not mean to be on Pro, that is a bill.
   (b) **Backup retention is 14 days, not 90.** The repo caps artifacts and
   logs at 14 days (`maximum_allowed_days` 90). Raising it to 90 is one
   setting, but it lengthens EVERY workflow's artifacts, and on the free
   GitHub plan that can go past the artifact-storage quota (billed). The
   alternative is a monthly copy somewhere else. Your call.
   (c) **Storage files (photos, ID documents) are in NO backup**: 152 objects,
   about 10 MB (proof-photos 64, job-photos 61, message-attachments 18,
   user-documents 4, avatars 4, id-documents 1). The platform backup excludes
   them too. Backing them up needs a service-role key as an Actions secret and
   puts ID documents (encrypted) into a GitHub artifact: a privacy trade-off.
   (d) **PITR** (restore to the minute) is a paid add-on, about $100/mo plus
   Small compute. Without it, worst-case loss is about 24 h (platform) or
   24 h + GitHub's up-to-7 h schedule delay (ours). You said no paid upgrades,
   so this is only the measured gap.
   (e) **Two secrets that no backup holds.** `BACKUP_PASSPHRASE`: is there a
   copy outside GitHub? If not, losing the GitHub account also loses every
   backup. `ban_fingerprint_salt` (vault): it cannot be re-created, and
   without it every stored ban fingerprint stops matching after a restore.
   Want it (encrypted) in the backup, or kept in your password manager?

9. **Things the app no longer uses (Q41): approve group (a), decide group (b).**
   **ANSWERED 2026-09-24 (owner pop-up): approve ALL of group (a). Group (b) still undecided. Work item Q364.**
   Full list with the evidence for each: docs/audit/dead-code-report-2026-09-23.md.
   (a) **Safe to delete, nothing anyone sees changes** (about 1,200 lines): the
   second "recent reviews" wall you removed from public profiles (VN-15), three
   badges/pickers no screen shows any more, a 14-line duplicate file, 1 unused
   database function, and dropping the "shared" mark from 97 names nothing
   imports. Approve all of (a)? (b) **Your call, item by item:** the weekly
   schedule strip taken off Earnings (show it elsewhere or delete?); the W-9 tax
   form flow (nothing can switch it on; keep for launch or remove?); Apple
   Wallet pass and Apple in-app purchase code; the retired group-job buttons
   (1 group job still exists); an unused strikes table; two old redirect links
   (/help-center, /settings); 21 old one-off scripts and 12 unlinked docs
   (delete or archive? the docs overlap Q165). Background checks, idle sign-out
   and the Q40 ID-upload leftovers are listed as KEEP. Found on the way: two
   database clean-up jobs were never switched on (Q167).
10. **Your own test report is the one critical alert left open (ledger 6c3679bc, 2026-09-24).**
   Report 83792937 was filed from YOUR account on 2026-08-30 ("Harassment or
   abuse", text "dfhfghjfgtj") against user 11111111-…-103, who no longer
   exists (0 rows in auth.users and profiles, measured 04:40Z). It is still
   'investigating', so the alert stays open. It's your record, so I didn't
   touch it. Dismiss it on /admin?view=reports and the next hourly sync closes
   the alert. (Q317, the fatal cron alert, is no longer yours: with the owner's OK the lead
   set PostgREST db_pool=14 and pooler default_pool_size=14 at 2026-09-24 ~04:36Z via the
   Management API, re-read 14/14, and quota-monitor's connection-budget job then went green
   (run 35956432434). Cron had 0 'connection failed' runs from 23:30Z to 04:59Z. The alert
   closes once a heavy prod suite runs clean.)

11. **Tips: confirm your 2026-09-02 decision before I ship it (ME-006, CC-003).**
   **ANSWERED 2026-09-24 (owner pop-up): (a) the poster pays the card fee on top, and the tip minimum rises to $3. Work item Q362.**
   The Terms say "100% of tips go to the Helpr", but today the card fee (2.9% + 30c)
   comes out of the tip, so a $5 tip pays the Helpr $4.55. On 2026-09-02 you decided
   the POSTER pays the card fee on top, so the Helpr gets the whole tip and we keep
   nothing. That makes a $5 tip cost the poster $5.46, a $20 tip $20.91, and a $1 tip
   $1.34 (34% extra, which looks like a bug). Reply: (a) ship it and raise the tip
   minimum to $3 (my recommendation), (b) ship it and keep the $1 minimum, or
   (c) keep today's behaviour and change the Terms to "minus card processing".
   The urgent bonus (CC-003) has the same question: Post Job says it "goes straight
   to the Helpr", but 2.9% comes off it ($20 pays about $19.42).
12. **Safety buttons on bids and active jobs (TS-006, TS-007, 2026-09-24).**
   **ANSWERED 2026-09-24 (owner pop-up, re-asked because there are no bids, only applications): add Report + Block on every APPLICATION card AND the Helpr SOS button on an active job. Work item Q366.**
   Today a bid/application has no Report or Block button (you must open the
   person's profile first), and a Helpr on an active job has no safety/SOS button
   at all (only the poster has one). Want me to add Report + Block on every
   bid card, and the same SOS button for the Helpr on an active job? Yes/no is enough.
13. **Backups for photos and settings (DR-004, 2026-09-24).** A database restore
   **ANSWERED 2026-09-23 by MQ7(c): back up uploaded files EXCEPT id-documents, encrypted (Q147).**
   brings back the rows but not the 24 uploaded files (~19 MB: photos, IDs,
   documents) or the edge-function secrets. Options: (a) a nightly GitHub job
   copies the files to a private GitHub artifact (free, 90-day keep), or (b) leave
   as-is until launch. I recommend (a).

14. **What to call a person whose account was deleted (AL-011, 2026-09-24).** The
   **ANSWERED 2026-09-24 (owner pop-up): (a) users see "Former member", admin sees "Deleted account", everywhere. Work item Q369.**
   app uses 16 different labels for the same thing: "A neighbor", "Helpr",
   "Former Helpr", "Deleted user", "Unknown", "No name" and more. Admin can't tell
   a deleted account from a missing name. Options: (a) users see "Former member"
   and admin sees "Deleted account", everywhere; (b) pick different words. I
   recommend (a). It changes copy on about 15 screens.

15. **Tax forms (W-9) after a Helpr deletes their account (CS-003, 2026-09-24).**
   **ANSWERED 2026-09-24 (owner pop-up): keep 4 years after signing, then delete automatically. Work item Q370.**
   Deleting an account leaves the Helpr's W-9 record (typed legal name, signing IP)
   in place forever. The IRS expects a business to keep W-9s for about 4 years, so
   deleting them at once may be wrong too. Options: (a) keep them 4 years after
   deletion, then delete automatically; (b) delete them with the account; (c) keep
   forever. I recommend (a), but it is a legal call. No W-9s exist in prod yet.

16. **Opening the profile of someone you blocked (TS-011, 2026-09-24).** The Block
   **ANSWERED 2026-09-24 (owner pop-up): (a) show "You blocked this person" + Unblock, and hide their details. Work item Q367.**
   screen promises "You won't see their … profile", but /user/<their id> still
   shows the full profile. (Saved Helprs now hides them. Messages, applications
   and offers were already refused by the server.) Options: (a) the profile page
   says "You blocked this person" with an Unblock button, and their details stay
   hidden; (b) show the profile as now, and change the Block screen's wording. I
   recommend (a).

17. **Test rows in the admin queues (AM-012, 2026-09-24).** The admin home page
   **ANSWERED 2026-09-24 (owner pop-up): (a) keep them in the lists with a "Test" tag; home shows "0 (+2 test)". Work item Q368.**
   and the sidebar badges leave out test (seed) rows, but the Disputes, Users and
   Reports lists show them. So home can say "0 disputes" while the Disputes list
   holds 2 with live Refund / Release buttons. The automated admin tests need to
   reach those test rows. Options: (a) keep them in the lists with a "Test" tag
   on each card, and home shows "0 (+2 test)"; (b) hide them from the lists too
   (the admin tests would need another way in). I recommend (a).

18. **W-9 forms after a Helpr deletes their account (CS-003, 2026-09-24).** When
   **ANSWERED 2026-09-24: same as MQ15, keep 4 years then delete (Q370).**
   a Helpr signs a W-9 (typed name and the IP address they signed from), deleting
   their account leaves it in place forever. Today there are 0 of them. The
   privacy policy says tax records the law requires are kept, and the IRS says
   to keep W-9s for 4 years. Options: (a) keep them for 4 years after signing,
   then delete them automatically; (b) delete them as soon as the account is
   deleted. I recommend (a).

19. **Delete the Broadcasts feature's code? (S-004, 2026-09-24).** You removed
   **ANSWERED 2026-09-24 (owner pop-up): (a) delete the banner, the admin screen and its menu item now; drop the two tables in a later migration. Work item Q363.**
   Broadcasts on 2026-09-01, but the code is still there: the Dashboard runs two
   database reads for the banner on every load (both tables hold 0 rows), and
   Admin still has a Broadcasts screen that can create banners. My automatic
   permission check stopped me deleting a whole feature without you. Options:
   (a) delete the banner, the admin screen and its menu item now, and drop the
   two tables in a later migration; (b) keep it. I recommend (a).

20. **Paging for Activity lists (PD-002, 2026-09-24).** Posted Jobs and Applied
   **ANSWERED 2026-09-24 (owner pop-up): (a) add "Show older" after 50 per section NOW. Work item Q372.**
   Jobs load every row at once. The largest account today has 202 posted jobs
   (a test account); real accounts are far smaller. Capping the list would hide
   old jobs, so the fix is a "Show older" button (a visible change). Options:
   (a) add "Show older" after 50 per section; (b) leave it until an account
   gets big. I recommend (b) for now; it is not a launch risk.

21. **Louisiana sales tax is $0 on every job (ME-043, 2026-09-02, still true).**
   **ANSWERED 2026-09-24 (owner: "you decide"): lead's decision is to change nothing in code before a CPA answer. The launch checklist carries a CPA review of a Louisiana Stripe Tax registration + taxable categories + service-fee taxability (with MQ24). Work item Q374.**
   Stripe Tax computed $0.00 on an assembly job billed to a Baton Rouge address,
   although the code marks assembly and handyman as taxable. Stripe only charges
   tax in a state where the account has a tax registration, so this is a Stripe
   dashboard setting, not code. Options: (a) add a Louisiana registration in
   Stripe (Tax → Registrations) before launch, after checking with your
   accountant which job types are taxable; (b) collect no sales tax. I cannot
   choose this for you; it is a legal and tax call.
22. **What to call someone who deleted their account (AL-011a, 2026-09-24).**
   **ANSWERED 2026-09-24: same as MQ14 (Q369).**
   The app uses 16 different words for the same thing: "A neighbor" and "a
   neighbor", "Helpr", "Former Helpr", "Name not on file", and in admin
   "Unknown", "User", "Unnamed", "No name", "Deleted user", "Deleted account".
   I fixed the two that were plainly broken (a gift card read "from A"; admin
   referrals showed a raw ID). Pick one word for users and one for admin, e.g.
   users see "a former member", admin sees "Deleted account"?
23. **Old signup rows in the admin Audit Log (AM-004, 2026-09-24).** New
   **ANSWERED 2026-09-24 (owner pop-up): KEEP the 742 rows. Nothing to do.**
   signups and deletions no longer write "role granted/revoked" rows to the
   Audit Log. 742 old rows of that kind are still there (about 44% of the
   log). Should I delete them? It is audit history, so I left them.
24. **Is the service fee taxable in Louisiana? (ME-019, 2026-09-24).** Today
   **ANSWERED 2026-09-24: folded into Q374 (the CPA review on the launch checklist).**
   checkout charges sales tax on the job itself (for taxable categories) but
   NOT on the poster's service fee; the code says "non-taxable until the LA
   Department of Revenue clarifies". In April both were taxed. If the answer is
   "taxable", the platform owes roughly 1.3% of every job budget it did not
   collect. This needs your CPA, not code: when they answer, I switch one line
   (create-payment/index.ts:631) and add a check.
25. **Archive three old Stripe products? (SC-015, 2026-09-24).** Your LIVE
   **ANSWERED 2026-09-24 (owner pop-up): the lead archives them via the API. Work item Q373.**
   Stripe account had (audit read 2026-09-07; I cannot re-read live Stripe
   from here) Crew, Team and Enterprise seat plans ($20/$30/$40 a
   month, plus yearly) from the business plans that were removed in August.
   Nothing in the app can sell them, but a checkout on one would take money and
   grant nothing. Archiving them in the Stripe dashboard (Products -> ... ->
   Archive) is safe and reversible. Want me to do it through the API, or will
   you click it?

26. **When was the "Sign in with Apple" website secret made? (expiry monitor, 2026-09-24).**
   **ANSWERED 2026-09-24 (owner pop-up): (b) the owner makes a fresh secret now; the lead records today + 6 months. VERCEL_TOKEN expiry still unknown. Work item Q375 (owner to-do).**
    Apple sign-in on the website uses a secret that Apple lets live at most 6
    months; when it runs out, "Sign in with Apple" on the website stops working
    with no warning. Supabase only shows a scrambled copy of it, so the monitor
    cannot read its date (checked today). Either (a) tell me roughly when you
    made it with tools/apple-jwt.html and I will record its expiry so the
    monitor warns 30 days ahead, or (b) make a fresh one now (you need the .p8
    key from the Apple developer site) and paste it into Supabase > Auth >
    Apple, and I will record today + 6 months.
    Same kind of question for the Vercel token GitHub uses to deploy (the
    VERCEL_TOKEN secret): Vercel will not tell the monitor its expiry. What
    does Vercel > Account Settings > Tokens show as its expiration ("No
    Expiration" is a fine answer)?
27. **The landing page shifts slightly on the CI computer (2026-09-24).** The
   **ANSWERED 2026-09-24 (owner pop-up): YES, change only how the hero font LOADS. Font, colour and copy stay locked; take before/after screenshots. Work item Q371.**
   page-settle check measured a layout shift of 0.0315 at desktop width on the
   Linux test machine (limit 0.02); on this Mac it is 0.0006. The moving piece
   is hero text about 0.2 s after load, most likely the headline font swapping
   in over a fallback with different letter sizes. Fixing it means changing how
   the hero font loads (e.g. preloading Bodoni Moda or matching the fallback's
   size). The hero font is locked, so: may I change how it LOADS, without
   changing the font, colour or words?
28. **Where the /messages "N unread conversations aren't in Active" bar goes (Q384(5), nightly-red #1754, 2026-09-25).**
    Held for the morning (owner: "I'll decide tom"). Screenshot: ~/.lh-shots/msg-notice/helper-e2e-375.png
    (prod, helper-e2e, 375). The beige bar only appears after the list loads, so every
    conversation under it jumps down (~66px at 375, ~52px at 1440; CLS 0.0558 / 0.0216).
    Options: (a) below the rows; (b) a small chip in the header; (c) keep it on top and hold
    a blank band for it while loading; (d) leave it and accept the red. PR #1825 only keys the
    skeleton so the number reads zero while the rows still jump: not landed, for that reason.
    Class guard for the fix is in PR #1832 (noLoadedOnlyChromeAbovePlaceholder).

## CARRIED — still open from the sections archived 2026-09-23

Every unchecked box and every section marked OPEN / STILL OPEN / HEADS-UP /
NEEDS in the old file was re-checked on 2026-09-23 against main and live prod.
What was fixed or obsolete is closed in the archive's reconcile log with
evidence; what follows is still open ("not reached" means nobody could settle
it read-only; treat it as open).

### REPORT (not a task) — Browse hides search + filters until the feed loads (2026-09-24)
e2e-journeys run 35957628804 (slow row: every backend call held 3-8s, 1440): at 20s after
/home the helper's Browse card was still four skeleton rows with an EMPTY header: no
job count, no search, no filters (screenshot ~/.lh-shots/2026-09-24/journeys-35957628804/…/test-failed-2.png).
The journey now waits 60s like its other slow-row steps. Showing the toolbar over the skeleton
would be a visual change, so it is left for the owner to ask for.

### NEXT TOP 10 (lead, 2026-09-23 ~22:45Z; after the partly-done items). Live defects first.
1. Q311 Sentry recorded zero errors for about 17h (monitoring blind).
2. Q294 /jobs/:id "Done" timeline buttons not clickable.
3. Q260 Returning users hit a 404 on Browse/Login (service worker suspected).
4. Q231 A dispute decision writes status before money moves.
5. Q301 block_user_and_settle refuses a banned blocker.
6. Q308 Two admin fan-outs have never delivered.
7. Q320 + Q319 Accept on an unfunded job gives no feedback; W-9 IP capture blocked by CSP.
8. Q291 ops_alert_verify can be starved by volume.
9. Q262 + Q282 Missing foreign keys (messages, notification_preferences).
10. Q239 + Q259 The applicants panel's 7 s waterfall; React warnings on dashboard mount.

### PAUSED 2026-09-23 ~19:10Z (owner: 50% usage). Only the TOP 10 below; everything else waits.
1. DONE 2026-09-23 (re-probe matched). Q281 ban enforcement: on main (fbb1e181a); after db-deploy run `node scripts/check-ban-gate-coverage.mjs` and `~/.lh-shots/q281/probe.mjs run after`, record + tick.
2. LANDED 2026-09-23. Q210 (c,d,e) $250 urgent-bonus cap + terms bump: cloud/q210-bonus-terms, money review APPROVED; before landing check the /terms-under-the-reconsent-gate lead and update is_seed profiles' terms_version.
3. LANDED 2026-09-23 (verify live after db-deploy, then tick). Q139 seed notifications carry their subject: cloud/q139-v2, needs a lh-silent-failure review, then land.
4. LANDED 2026-09-23 (verify live after db-deploy). Q274 / Q244 / Q235 money-path gaps: cloud/q274-q244-q235, money review before landing.
5. LANDED 2026-09-23. Q223 / Q255 / Q182 security: cloud/q223-q255-q182, authz review before landing.
6. (Q292 DONE; Q219+Q288 LANDED; Q290 export NOT in the branch, still open) Q290 / Q292 / Q288 / Q219 account deletion + data export (App Store 5.1.1(v)): Q292 fix on main (77e03db35), privacy run 35907558297 must go green; rest in cloud/q290-q288-q219.
7. Q82 + Q152 push notifications + TestFlight (launch blocker, needs the owner's phone; LAST step).
8. Q60 load test before launch.
9. Q280 press every control + journeys on prod: runs 35905268411 / 35905284660; read failures, fix.
10. LANDED 2026-09-23 (re-measure after deploy). Q275 / Q15 / Q11 Sentry quota + noise: cloud/q275-sentry.
Paused mid-flight: lead/q32-wip (lands 8 stranded PRs + fixes why refresh PR #1713 can't merge; rebase, re-verify, push, close PRs), lead/q226-wip (admin-refund/ban/no-show journeys). Cloud branches to land later (each needs its review): q282-q262-q224, q287-q298-q291, q232-admin, q286-client, q297-tooling, q283-q225-q289, q272-press, q228-copy, q265-layout (needs 375/1440 screenshots), q206-perf.

### OPEN (report for the owner, not a task) — 160 unused exports + 22 unused types (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Owner decision needed on removing 160 dead exports / 22 dead types — Report stands; owner has not yet decided whether to spend a pass verifying/removing the 160 exports + 22 types. (archive L20)

### OPEN (RETRACTED as an upload bug; 33 dangling seed rows remain) — the press sweep's proof-photo 400s are failed SIGNING (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 33 dangling is_seed proof-photo references still 400 on sign, no nightly guard wired — 33 dangling is_seed proof-photo refs still uncleared as of this entry; nightly wiring for the checker not confirmed done. (see also line 379 (#1582, says cleared to 62 refs 0 on real jobs)) (archive L30)

### CLOSED 2026-09-22 — the Messages disclosure chevron is SHIPPED BUT UNSEEN (2026-09-22, e28d5f55f)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Chevron code shipped but before/after screenshots, fit-proof, and full typecheck/vitest never done — Code (e28d5f55f) is on main; required before/after screenshots, fit-proof, and full repo-wide typecheck/vitest were never completed. (archive L64)

### OPEN — a rebuild of `dist/` under a live preview leaves the happy-path app PERMANENTLY BLANK (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Rebuilding dist/ under a live preview blanks the app (2/18 repro rate) — Root cause identified (shared dist/checkout with a live preview); no fix shipped yet — needs isolated HAPPY_PATH_PORT + no shared checkout with a building lane. (archive L121)

### OPEN — the loading-state baseline needs a full re-measure, and 37 of its entries are not debt (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Full-catalog loading-state re-measure not run; harness double-counts ancestor/body/nav clusters — ProfileRouteSkeleton fix shipped (3225ea26b); full re-measure of baseline.json and the harness double-counting defect are still open. (archive L171)

### OPEN — the three red nightlies, diagnosed 2026-09-22 (re-runs pending)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Three nightlies diagnosed; re-runs to confirm green were pending at time of writing — Diagnoses landed for #1618/#1582/#1595 causes; confirming green re-runs pending — see consolidated table at line 1948. (see also line 1948) (archive L359)
- [ ] #1595 e2e-journeys — single failure's fix (6fb3335fa) landed after the run; re-run pending — Fix 6fb3335fa landed after the failing run; the actual re-run (with new findings) is tracked at line 1275. (see also line 1275) (archive L405)

### OPEN — press is fixed enough to see REAL defects now; 199 remain (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 199 press failures remain: 2 unexplained session deaths, unclickable bottom-nav on job pages, proof-photo 400s, 'job not available' error; shard 2 unlooked-at — 199 press failures remain: 2 unattributed session deaths, bottom-nav unclickable on job detail pages (highest-value lead), proof-photo 400s, and an unreviewed shard 2 (90 failures). (archive L412)

### OPEN — three more things on the critical path, measured 2026-09-22
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Critical-path bundle: ~39 sub-2kB shell chunks (25kB) not consolidated; forms-*.js (21.7kB, actually zod) not lazy-loaded — Two bundle-size opportunities identified but not implemented: consolidating ~39 small shell chunks, and lazy-loading zod schemas (21.7kB) out of the critical path. (archive L519)
- [ ] A live realtime row entering/exiting the open notification panel not yet eyeballed post-framer-defer change — Static open/close of the notification panel was screenshotted; the live realtime-row enter/exit animation after the framer-defer change has not been eyeballed. (archive L545)

### OPEN (detector shipped; ONE live row still needs a human) — an auto-resolved dispute leaves a job no cron will ever pay (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.

### CLOSED 2026-09-22 — functions-deploy called eight discarded edge-function deploys a success
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Upstream Supabase intermittently drops 5-12% of function-deploy uploads; retry masks but does not cure it — Deploy-verification/retry fixed (2400aca14/3470ad103); upstream Supabase still drops ~5-12% of function uploads intermittently — masked by retry, not cured (BR-025). (archive L714)

### OPEN — no REAL (non-seed) user has ever been paid out (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] No non-seed job has ever reached payout_pending/released; first real payout is untested by construction — Confirmed live: zero non-seed jobs have ever reached payout_pending/released; the automatic payout path has never executed against real money — owner decision on how to rehearse it before launch. (archive L844)

### CLOSED — the money loop was red for 15 days and a push closed the report each time (fixed 2026-09-22, a17f27d92; loop green 17:23 and 17:25 UTC)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Money loop's own completion (release-payout assertions) still needed one clean re-dispatch to observe — Notify-gate bug fixed (a17f27d92); this section's own still-open ask (observe a full clean loop completion) appears satisfied by run 35756239864 described elsewhere (line ~824), but not explicitly cross-referenced here. (archive L929)

### OPEN — CI should run against a separate database from real users, not before launch (owner, 2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] CI still hits prod DB directly; owner deprioritized a separate Supabase branch until after launch — Owner-deferred, not a launch blocker. No persistent Supabase branch stood up yet; CI still hits prod directly, mitigated only by schedule spacing + the prod-load lock. (archive L1005)

### CLOSED — PROD WAS DOWN 2026-09-22 07:57-14:40 UTC; recovered by restart, nothing alarmed (that half fixed in uptime 079d03194)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] uptime.yml's 10-min cron is throttled by GitHub to hours-apart runs; needs an off-GitHub heartbeat — The zero-rows-is-down half of uptime detection is fixed (079d03194); GitHub still silently throttles the 10-min cron to hours apart, and no off-GitHub heartbeat or self-watchdog exists yet. (archive L1138)

### DONE 2026-09-22 — #1595's six, attributed: one product rule change, one Stripe outage, three that were prod being slow
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Deep link opened while a lazy chunk is in flight can be eaten by stale-chunk recovery reload — reproduction needed before a fix is written — Product-level race (deep link vs. stale-chunk recovery reload) confirmed once in WebKit but not reproduced in 3 local rounds; fix intentionally not attempted without a repro. (archive L1272)

### OPEN — #1595's ORIGINAL four failures are fixed; three NEW ones now block it (2026-09-22)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] e2e-journeys: original 4 failures fixed; 6 new cross-engine failures found (inbox listing, sign-back-in, time-travel chip, WebKit Checkout, notification redirect) — Original 4 e2e-journeys failures fixed; of 6 newly surfaced failures, later tracking (line 1958) says 2 real defects remain open (browse fixture / time-travel-class items). (see also line 1948) (archive L1284)

### OPEN — /posts' new row height is not yet measured in a browser (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] /posts placeholder row-height fix not yet confirmed with a real browser measurement — Code fix landed for /posts placeholder height but the predicted 150px/151px numbers have not been confirmed with an actual browser run. (archive L1546)

### PARTLY DONE — 44 signed URLs in prod are stored with an `exp`, and they all die in Sept 2027 (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] PhotoProof persisted-signed-URL bug fixed; ONE call site left: SupportInline.tsx. RE-READ 2026-09-25 (queue lane): DisputeDialog, DisputeTimelineDialog and CompletionChoiceSheet were fixed on 2026-09-22 and are out of PINNED in src/test/noPersistedSignedUrls.test.ts (read the file); only components/profile/SupportInline.tsx is still pinned (a 30-day signed URL pasted into reports.description). Prod has 0 reports with a 'Screenshot: ' line (of 11). Fix needs two layers: SupportInline files the user-documents PATH, and AdminSupport (which renders description as plain text today, so the URL is not even clickable) gets a 'View screenshot' control that signs at click (admins can SELECT user-documents: pg_policies 'owner or admin read'). Visual change on the admin view, so it needs a screenshot before closing; then drop it from PINNED. (archive L1569)

### OPEN — `docs/audit/loading-states/measurements.json` is stale for /jobs (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] measurements.json/baseline.json not regenerated after the /jobs loading fix, so the check is green on outdated evidence — /jobs loading fix shipped but the committed measurements.json/baseline.json evidence is stale; needs the same full re-measure tracked at line 162. (see also line 162) (archive L1674)

### HEADS-UP — three duplicate reads on every Activity page load (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.

### CLOSED 2026-09-22 — hired-and-funded journey leftovers accumulate in escrow
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] prod-lifecycle-sweeper.mjs can settle forward but no CI workflow passes it HELPER_ACCESS_TOKEN yet — Escrow-leftover leak fixed and backlog cleared; prod-lifecycle-sweeper.mjs's settle-forward capability is still not wired into any of the four e2e-* CI workflows (needs HELPER_ACCESS_TOKEN). (archive L1750)

### CLOSED — two writers owned `helper_availability` and disagreed (fixed 2026-09-22, 2619ee9e6; seeder now owns all 7 days, guard on the disagreement)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] prod-seed.mjs vs the journey's save_weekly_availability disagree on row ownership; will re-break on next seed run — Data repaired and 03-account journey green again (2619ee9e6), but the underlying dual-writer disagreement (seeder vs. journey save) is a still-open design decision that will re-break on the next prod-seed run; no drift guard yet. (archive L1850)

### HEADS-UP — seven of `interruptions.spec.ts`'s twelve tests run nowhere (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 7 of 12 interruption tests still skip on a permanent fixture gap (no funded un-applied job); prod-audit.yml still runs no seeder — Skip-message honesty fixed and guarded; the actual fix — a funded un-applied job fixture via real Stripe checkout — is not built, and prod-audit.yml still runs no seeder, so all 7 tests remain permanently skipped. (see also line 1875 / same as 01-browse funded-fixture decision) (archive L1856)

### HEADS-UP — the explore now reaches four screens it never reached (2026-09-20)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Explore now covers 4 previously-blocked screens; watch for stale GAPS entries in messy-input coverage test — Advisory, unresolved: four previously-blocked screens are now explored for real; nobody has confirmed whether the stale GAPS entries in messy-input.spec.ts were removed. (archive L1910)

### CLOSED — `messages-thread.spec.ts` (c) flaked on a STUCK state, not a slow one (fixed 2026-09-22, 78d1b475b)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] A second, different messages-thread flake (openFirstThread stuck-inbox timeout) surfaced and is not fixed — The history-pop back-gesture flake is fixed (78d1b475b); a separate openFirstThread stuck-inbox timeout (seen once in 20 runs) is unreproduced and unfixed. (archive L1922)

### OPEN — the four long-red nightlies, diagnosed 2026-09-20 (issues #1582 #1595 #1597 #1618)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Consolidated status table for #1618/#1582/#1597/#1618 — mostly fixed by 2026-09-22, two rows still open — Consolidated: #1618 fixed+verified; #1582 false-red fixed but real stall unmeasured; #1597(a) done, (b) fixed later (f148bb5c6), (c) still open (h-7 renders 29.6px); #1595 has 2 open defects (line 2124). (archive L1957)

### STILL RED, and why — prod-audit is not green
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] prod-audit blocked by prod API outage + auth 504 bursts (transient), stale coverage-test residue number, and 3 unexamined spec failures — prod-audit still not green as of 2026-09-22: transient prod outage/504 bursts aside, three specific spec failures (disputedJob-helper explore, interruptions.spec.ts:256, reaction-chip-clearance) are unexamined, and the coverage-test residue count is stale. (archive L2042)

### Still open under #1618 — the coverage test's non-admin residue
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] ~22 non-admin files (message composer, activity dialogs, dispute/report/block dialogs, SavedSearches, AiJobBuilder, etc.) still have no sweep/explore/gap entry — ~22 non-admin files (ChatView, RichMessageInput, EditJobDialog, ApplicantsPanel, DisputeDialog, ReportDialog, SavedSearches, AiJobBuilder, etc.) still lack sweep/explore coverage or a stated gap in the coverage test. (archive L2081)

### Still open from #1595 / #1582
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 01-browse has no durable funded fixture (owner decision needed: real Stripe checkout per run vs. durable is_seed row); /jobs:id + /user:id stall still undiagnosed; press-every-control self-heal dispatch verification owed; e2e-journeys clean-dispatch verification owed; push 'Not Now' toast fix still needed at the signal level — Multiple open items: 01-browse funded-fixture is an owner decision (0173ae6be only added a diagnostic, real fixture not built); /jobs:id+/user:id request-fan-out stall undiagnosed; press self-heal fix (aa81799a2) and a clean e2e-journeys dispatch both still owed for verification; push 'Not Now' declined-vs-denied signal bug remains a real product defect (not code-fixed). (archive L2133)

### Low-alpha AA batch — landed 8aff7b8cc, three things left open (2026-09-20)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] TrustRow's separator never renders (dead code, single-chip call site) — Still open: TrustRow separator dead because JobPosterCard only passes one signal. (archive L2236)
- [ ] Contrast inventory scanner misses Tailwind slash-opacity syntax — Open, not reached in depth: slash-opacity contrast blind spot likely still present. (archive L2242)
- [ ] Three live AA failures found outside the lane's list (job dialog pitch, /messages banner, /posts badge) — Open, not reached: three specific AA contrast failures reported 2026-09-20, no fix commit found. (archive L2248)
- [ ] Four changed contrast sites never photographed in their own state — Open, not reached: 4 contrast fixes still unverified by screenshot. (archive L2254)

### DONE 2026-09-20 — Profile tab gutter + every Profile loading state
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Section: OPEN, found in this lane, NOT fixed — Section holds 4 distinct unresolved sub-items from the Profile tab-gutter lane. (archive L2295)
- [ ] TAB_TITLES.wrapped drifts from rendered h1 (Helpr Wrapped vs Your 2026 so far) — Open: Wrapped tab title still drifts from its rendered heading; needs a decision. (archive L2297)
- [ ] Profile LANDING sits at a different gutter than its own tabs — Open, owner decision needed: Profile landing gutter [40,40]/[36,36] vs tabs [24,24]/[20,20]. (archive L2304)
- [ ] /jobs applied-card pitch unverified against a populated list — Open, not reached: applied-card skeleton pitch still unverified against real data. (archive L2310)

### VN-33(b) bad-pin exception — follow-ups from its reviews
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Design notes for the owner re: near-miss job staying 'accepted' — Open (owner): design notes on near-miss/accepted-state behavior await an owner read, not code. (archive L2617)

### Owner decisions 2026-09-15 morning (pop-up) — building as branches
Reconciled 2026-09-23; detail in the archive at the line shown.
- [~] Backend role strings: change all user-facing (edge + SQL trigger copy) — FIXED 2026-09-25 (queue lane, branch queue-fix, not yet live): migration 20260925143327_notification_copy_names_the_person rewords 13 sentences in 11 SQL producers in place (pg_get_functiondef + regexp_replace, no body retyped): notify_on_job_update and poster_cancel_job x3 ('cancelled by the person who posted it'), notify_helper_application_viewed, notify_helper_on_direct_offer ('Someone'), track_revision_scope_creep, check_referral_bonus x2 (no 'as a helper'), expire_pending_direct_offers and respond_to_direct_offer ('open to everyone'), sweep_no_show_alerts ('message the customer'), helper_cancel_booking x2 and helper_abort_job hints. NotificationPanel's pill already matched both phrasings (stored rows keep 'cancelled by the poster'). GUARDS: src/test/sqlNotificationCopyRoleNeutral.test.ts (every string literal in every SQL function whose EFFECTIVE body writes notifications; role nouns, 'helper', 'as a ...'; exact two-way KNOWN = notify_helper_on_tip only, the tips lane's; red without the migration: 11 producers; vacuity 4/4 killed) + src/test/pglite/sqlNotificationCopyRoleNeutral.pglite.mjs (bodies loaded, applied 3x through the real EXECUTE path: ALL PASS; unfixed: 27 FAILED; only copy lines change). TO VERIFY ON PROD after db-deploy (no prod read this session): select proname from pg_proc where pronamespace='public'::regnamespace and prosrc ~ '(cancelled by the poster|The poster viewed|The poster has requested|visible to all helpers|open to all helpers|message the customer|Message the poster|contact the poster|Tell the poster|as a helper|''A poster'')' -- expect only notify_helper_on_tip; the deploy log shows a WARNING per pattern that did not match. (was: Partly fixed: edge-function copy is role-neutral; SQL trigger notification copy still says 'the poster'. (archive L2622))

### HANDOFF — visual-notes session paused on usage (2026-09-14 late)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Owner decisions VN-33 follow-up: nudge/escalate poster confirm, bad-pin fallback, new build later — Open: poster-confirm nudge/escalate and bad-pin Confirm fallback not found implemented. (archive L2638)
- [ ] VN-37 page gutter design decision; VN-52 group jobs fix+turn-on — Mixed: VN-37 gutter fixed; VN-52 group jobs still off (flag false), blockers (b)/(d) unresolved. (see also line 3070 (VN-37 section)) (archive L2643)
- [ ] "Test" workflow on main red on knip (pre-existing) — Open, not reached: knip failure status on the Test workflow unconfirmed. (archive L2644)

### Role words out of user-facing copy — branch role-neutral-copy-v2
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Needs lead's eyes at 375 for copy-length regressions in tight spots — Open, not reached: 375 visual check of lengthened role-neutral copy not confirmed done. (archive L2649)
- [~] Trigger-written notification copy still says 'the poster' (needs a migration) — FIXED 2026-09-25 (queue lane, branch queue-fix, not yet live): migration 20260925143327_notification_copy_names_the_person rewords 13 sentences in 11 SQL producers in place (pg_get_functiondef + regexp_replace, no body retyped): notify_on_job_update and poster_cancel_job x3 ('cancelled by the person who posted it'), notify_helper_application_viewed, notify_helper_on_direct_offer ('Someone'), track_revision_scope_creep, check_referral_bonus x2 (no 'as a helper'), expire_pending_direct_offers and respond_to_direct_offer ('open to everyone'), sweep_no_show_alerts ('message the customer'), helper_cancel_booking x2 and helper_abort_job hints. NotificationPanel's pill already matched both phrasings (stored rows keep 'cancelled by the poster'). GUARDS: src/test/sqlNotificationCopyRoleNeutral.test.ts (every string literal in every SQL function whose EFFECTIVE body writes notifications; role nouns, 'helper', 'as a ...'; exact two-way KNOWN = notify_helper_on_tip only, the tips lane's; red without the migration: 11 producers; vacuity 4/4 killed) + src/test/pglite/sqlNotificationCopyRoleNeutral.pglite.mjs (bodies loaded, applied 3x through the real EXECUTE path: ALL PASS; unfixed: 27 FAILED; only copy lines change). TO VERIFY ON PROD after db-deploy (no prod read this session): select proname from pg_proc where pronamespace='public'::regnamespace and prosrc ~ '(cancelled by the poster|The poster viewed|The poster has requested|visible to all helpers|open to all helpers|message the customer|Message the poster|contact the poster|Tell the poster|as a helper|''A poster'')' -- expect only notify_helper_on_tip; the deploy log shows a WARNING per pattern that did not match. (was: Still open: trigger-written cancellation notifications still say 'the poster', no role-neutral migration found. (archive L2650))
- [ ] Judgement calls to confirm or reverse (badge captions, tier badge, arrivalStateLabel wording) — Open (owner): wording judgement calls from the copy pass await owner confirmation. (archive L2652)

### Discarded PostgREST builder calls — branch discarded-query-filters
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] npm run typecheck:edge not verified in this container (no Deno) — Open, not reached: edge typecheck verification status unconfirmed. (archive L2867)

### HANDOFF 2026-09-15 — map notes + nightly reds (session closed)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Decide (3): the 9 auth-timeout presses; Browse header (unfinished session note) — Open, not reached: 3 pending decisions from 2026-09-15 auth-timeout presses list. (archive L2882)

### holes-2026-09-15 (authz-rls) — storage buckets
Reconciled 2026-09-23; detail in the archive at the line shown.

### press-every-control — re-run 2026-09-15, 237 failed presses in 4 shards
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Handful of 'control not found on freshly loaded page' (transient or real) — Open, not reached: unclassified transient/real control-not-found presses. (archive L2987)

### Nightly reds — worked 2026-09-15, what is left
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] REPORT: Activity screen is expensive to composite (15 backdrop-filter layers) — Open (owner report): Activity's 15-layer backdrop-filter cost still awaits an owner call. (archive L3007)
- [ ] REPORT: ErrorBoundary/SectionBoundary render error copy during in-flight recovery reload — Open: ErrorBoundary/SectionBoundary still show error copy during a recovery reload. (archive L3008)
- [ ] REPORT: 02-marketplace chain stalls on Stripe Pay button w/ Google autocomplete open — Open: local-only Stripe Pay/Google-autocomplete interaction, unresolved (third-party). (archive L3009)
- [ ] REPORT: stale-deploy cold-load can race its own start page — Open, low-priority: rare local-only navigation race on stale-deploy cold load. (archive L3010)

### Owner visual notes 2026-09-14 (53 entries)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Work through docs/audit/visual-notes-2026-09-14.md tracker (medium/large VN items) — Open: large batch of 2026-09-14 visual notes, several items still unconfirmed/not started. (archive L3013)
- [ ] Dispute follow-ups still open after table-door fix (5 sub-findings) — Open, not reached: 5 dispute-field editability follow-ups from the table-door fix. (archive L3020)
- [ ] Visual-notes side-findings (Worked-together count, disputed-card ask, App.tsx comment drift, manifest dupe, favicon, VN-45 referral credits, VN-54) — Mostly open (VN-54 closed inline); other side-findings not independently reconfirmed. (archive L3022)
- [ ] Done is final — TABLE door: poster can still edit dispute_reason/status/disputed_at directly — Narrowed (lead, live 2026-09-23): trg_dispute_markers_server_owned locks disputed_at and zz_jobs_completion_server_owned locks completion; dispute_reason is in neither trigger body, so that direct-write door is still open. (archive L3024)
- [ ] Visual-notes follow-ups found while fixing (JobConfirmation copy, dispute-copy contradiction, unused code, RecognitionRow chips, VN-2 blank poster name) — Open, not reached: several small reported-not-changed copy/dead-code items from 2026-09-14. (archive L3030)

### Browse header count disagrees with the rendered list — REPORT, not fixed (2026-09-14)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Decide: subtract client-only predicates server-side (own posts/blocked) for the browse header count — Open: browse header count vs rendered-list mismatch still needs a server-side fix decision. (archive L3109)

### Failed list loads rendered "nothing here" + storage audit (2026-09-14)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] VERIFY after db-deploy applies 20260914200051: run message-attachments-authz.prod.mjs and record green — Open, not reached: prod verification of message-attachments authz probe not confirmed run. (archive L3128)

### Alerting: few, critical-only, reaching the owner (2026-09-14)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] OWNER: enable Slack #ops-alerts notifications for all new messages, confirm correct account — Open (owner): cannot confirm #ops-alerts Slack notification settings from the repo. (archive L3134)
- [ ] OWNER: delete 3 stale Sentry alert rules — Open (owner): cannot confirm the 3 Sentry alert rules were deleted. (archive L3135)
- [ ] Known and accepted (lh-silent-failure F5): contact-support await chain can add ~20s under Supabase/Slack brownout — Open but accepted-as-is: contact-support latency under brownout is a deliberate tradeoff, no fix planned. (archive L3142)

### Money: concurrent release / Quick Release / Quick Refund (2026-09-13)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [~] Storage policies let uploader UPDATE/DELETE dispute evidence after admin sees it — FIXED 2026-09-25 (queue lane, branch queue-fix, not yet live): migration 20260925141905_dispute_evidence_immutable_to_parties restates the proof-photos UPDATE and DELETE policies with `(storage.foldername(name))[2] IS DISTINCT FROM 'disputes'`, so no party can overwrite, delete or rename-into `<uid>/disputes/<job>/…`; INSERT/SELECT, own before/after proof photos, the e2e teardown's `<jobId>/…` delete and the service role (purge, orphan sweep) are unchanged. Measured live before: both policies allowed any `<uid>/…` object (pg_policies); 0 objects under */disputes/* and 0 evidence paths on disputes, so nothing existing moves. GUARDS: src/test/disputeEvidenceImmutable.test.ts (evidence buckets derived from client `/disputes/` uploads; every surviving party UPDATE/DELETE policy on them must exclude the folder; red on the tree without the migration, 2 open policies; vacuity 3/3 killed) + src/test/pglite/disputeEvidenceImmutable.pglite.mjs (live policies and helpers, applied 3x: ALL PASS 11; NEW_MIGRATION=skip: 3 FAILED). TO VERIFY LIVE after db-deploy: pg_policies qual of both policies contains the disputes exclusion. Needs an lh-authz-rls REVIEW-ONLY pass. Not in scope: the legacy jobs.dispute_evidence_urls mirror (archive LOW). (see also line 3183) (archive L3179)
- [ ] Transfer-group checks miss pre-branch untagged transfers and cap destination list at 100 — checkUnrecordedTransfers still blind to pre-branch untagged transfers and only lists the 100 most recent. (archive L3181)
- [ ] OPEN LOW-2 (pre-existing): void-cancelled-payments fee transfer writes no payout_transfers row — Fee transfer in void-cancelled-payments still lacks a payout_transfers ledger row — reconciliation blind spot documented, not fixed. (archive L3190)
- [ ] OPEN LOW-3 (pre-existing): payout_transfers_one_live_per_job_helper NULL-distinct on helper_id disagrees with claimPayout read — Redacted-helper (NULL helper_id) rows still escape claim arbitration; zero such rows on prod but the code disagreement is unfixed. (archive L3191)
- [ ] OPEN LOW-4 (pre-existing): jobs.dispute_evidence_urls legacy mirror still party-writable, unvalidated server-side — Legacy jobs.dispute_evidence_urls column still directly party-writable with only a client render guard; server-side validation not added. (see also line 3171) (archive L3192)
- [ ] OPEN LOW-7 (pre-existing): process-scheduled-payouts step 4b leaves an orphaned claim row on payout>escrow exit — A payout-exceeds-escrow exit still leaves a permanent pending claim row with a null transfer id. (archive L3193)
- [ ] OPEN (test tooling): prod-lifecycle-sweeper / pressProdSafety leave a HIRED funded leftover job — Test harness still leaves a hired/funded seed job in place when cancel_escrow 409s; leftovers accumulate until manually released. (archive L3194)
- [ ] OPEN (LOW): confirm SQL watchers' slack-ops-alert posts actually return 200 — sweep_dead_crons / check_ops_digest_delivery / stale-claim page Slack posts have not been confirmed to succeed via net._http_response. (archive L3197)
- [ ] OPEN: 2026-09-14 lifecycle-writes CAS fixes have no prod race proof yet — Eight fixed lifecycle-writes CAS guards (auto-release-payment, auto-resolve-disputes, escrow stamp, revisions, cancel_escrow, chargeback) still have zero prod concurrency proof. (archive L3201)
- [ ] QUEUED: replay chargeback dispute-hold fix (N4) on Stripe test-mode seed jobs, prod slot — Chargeback dispute-hold conditional writes still unproven on live Stripe test-mode seed jobs; replay not run. (archive L3206)

### Disk: git history carries 322M of dead media — REWRITE QUEUED (2026-09-13)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Rewrite git history to drop 322M of dead media blobs — History rewrite still not done; pack size is 377.83 MiB (grew, not shrank) — no force-push/rewrite has happened. (archive L3215)

### 18 `wip/` branches on origin — triaged 2026-09-13, none deleted
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Triage/dispose of 18 unmerged wip/ branches blocking the history rewrite — 12 of the original 18 wip/ branches still exist on origin, unmerged; some (wip/gift-card-rename, wip/helpr-naming-fixes, wip/combobox-terminal, wip/lexilombas-.lh-combobox-ws, wip/unplus-tier-removal-20260829, wip/postjob-doubletap-driver) appear to have been cleaned up since. (archive L3220)

### Mocked Playwright specs → prod (owner: NO MOCK MODE, EVER) — IN PROGRESS 2026-09-13
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Migrate 36 mocked Playwright spec/helper files to drive prod — Mocked->prod Playwright migration still in progress; BASELINE debt register down from 36 to ~35 files. (archive L3235)

### Cleanup candidates — dead code found 2026-09-13 (`npx knip`, call sites counted)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 62 unused exports — drop surplus `export` keyword (cosmetic), one real dead file already cut — Bulk of the 62 over-exported symbols still carry their surplus `export` keyword; not cleaned up (cosmetic, low priority). (archive L3308)
- [ ] 3 unlisted dependencies (playwright, @typescript-eslint/parser) not declared in package.json — Not reached; unlisted-dependency fix not verified. (archive L3321)

### Job card (BOTH sides) — IN PROGRESS, lane `step-components`
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] One shared job-card shell for poster/helper; poster-name two treatments, DisputedSection old card, misplaced before-photo panel, inconsistent action row — Job-card shell unification still in progress; poster-name double-treatment, old DisputedSection photo card, and inconsistent action-row layout not yet fixed. (archive L3399)

### Performance — audit done, NO fixes applied yet
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Prefetch check-pro-subscription / stripe-connect status; raise React Query gcTime past 5min; dedupe raw supabase.rpc calls — Performance fixes (prefetch, gcTime, query dedupe) for the 395-893ms Stripe-hop delays still not applied, per the heading itself. (archive L3421)

### Messages screen
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Selected thread should be the full page (not side-by-side, cut off); replace Cancel text button with an X icon in search — Messages list+thread still side-by-side rather than full-page-with-back per owner ask; search Cancel-text button not yet replaced with an X icon. (archive L3439)

### Profile
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Avatar has a square/rectangle showing behind the circular avatar — Square/rectangle artifact behind the 88px profile avatar not yet root-caused or fixed. (archive L3446)

### Race conditions — proven on prod 2026-09-13 (terminal 3, seed accounts, all fixture rows deleted)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] OPEN: RichMessageInput send has a same-frame double-send risk (sync onSend + stale text closure) — RichMessageInput double-send guard (different shape from the fixed apply/release races) still not applied. (archive L3463)

### Bugs found but not fixed
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] chunkReload follow-ups: retrying state not shown/reported, pending timer not cancelled on navigate, mocked stale-deploy spec needs prod rewrite, recoverFromChunkError bail/hang risk, markChunkLoadSucceeded cleanup-only reset — 5 chunkReload silent-failure follow-ups (retrying UI state, timer cancellation, mocked spec rewrite, bail/hang risk, cleanup-only reset) remain unaddressed. (archive L3507)
- [ ] AdminHelperTiers crashes on any unknown tier string; /admin?view=support shows a load error — AdminHelperTiers still crashes on an unrecognized tier string (report only); /admin?view=support load failure unverified. (archive L3513)
- [ ] No pre-expiry warning shown once a job is accepted (AppliedJobCard only passes expiresAt while pending) — Accepted jobs still give no pre-expiry warning before the ghosting clock fires. (archive L3522)
- [ ] Complete Profile: input values clipped by the check icon at every phone width (ZIP, Last name) — Complete Profile ZIP/Last-name fields still clip against the validation check icon at 320-430px; Edit Profile was fixed but this page was not. (archive L3525)
- [ ] PostJob PhotoUpload focus ring never paints — inline boxShadow style overrides Tailwind focus-within:ring-2 — PhotoUpload's keyboard focus ring is still overridden by an inline box-shadow style; not fixed. (archive L3532)

### Profile badges — "Verified" rung duplicates "Stripe verified"
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Drop the redundant 'Verified' ladder rung under As-a-Helpr (duplicates the Stripe-verified badge above) — Redundant 'Verified' ladder rung under As-a-Helpr still duplicates the Verified-group Stripe badge. (see also line 3636) (archive L3634)

### DECIDED — At-a-glance stat tiles: exactly FOUR
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Cut profile stat tiles from 7 to 4 (Rating, Jobs posted, Jobs completed, Cancelled) per owner decision — Profile stat tiles still render 7, not the owner-decided 4 (drop on-time%, rebooked%, needed-revisions%). (archive L3640)

### CONSISTENCY — identity verification has FOUR renderings
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Unify 4 different identity-verification renderings (Stripe verified pill, ladder-rung Verified, header ID-verified-by-Stripe, uppercase checkmark on JobPosterCard) into one component — Identity verification is still rendered 4 different ways across Profile groups, header, and JobPosterCard; not consolidated. (archive L3645)

### Shells leave a gap on the left and right — fix GLOBALLY
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] AppShell inner card stops short of the frame on both sides globally (seen on /profile?tab=availability) — AppShell pages still show a narrow-sheet-floating-on-a-wider-surface gap; global shell fix not applied. (archive L3662)

### ### Notification count — ruled out
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Bell abbreviates at '99+' while panel chip prints the true total (minor disagreement) — Bell badge still abbreviates to 99+ while the panel's own chip shows the true unread count. (archive L3829)

### FOR THE OWNER — the dead avatar URL is CLEARED (2026-09-12); the duplicate FILE is still there.
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] OWNER: delete stale user-documents/76b07824.../avatar.png (byte-identical duplicate of the owner's ID document) — OWNER: in the Supabase dashboard, Storage > user-documents > 76b07824-9b41-4741-a4c4-4f8de362f682/, delete avatar.png. Re-measured 2026-09-25: still present (storage.objects, 810,107 bytes). Owner action still pending: the duplicate ID-document file at user-documents/76b07824.../avatar.png is still in storage as of this check (owner-only, needs dashboard delete). (archive L4940)

### Audit gaps — owner, 2026-09-12
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] The post-job double-tap is not covered end to end (generic stepper skips before final submit) — Still open: no purpose-built driver found for the post-job double-tap; not reached in remaining budget for a deeper grep. (archive L5018)
- [ ] Admin queues (AdminExceptionQueue, AdminPayoutBatches, TwoFactorCard, W9CollectionDialog, NpsPrompt) have no seedable state, stay stated GAPS — Still open (by design): these admin queues remain unseedable and stated as GAPS in messyInputForms.ts. (archive L5022)
- [ ] Visual sweep could report '147 passed' with no server actually running — Code fixed (91693fbd8); the item's own remaining bar (a live sweep run with screenshots reviewed) is unverifiable without a browser — open, not reached. (archive L5036)
- [ ] No test moved the clock for auto-expire-jobs step 2, expiring-jobs-push, sweep_* server cutoffs — Partially addressed (client-side time-travel spec exists) but server cutoff sweeps (auto-expire-jobs step2, expiring-jobs-push, sweep_*) still have no clock-moving test. (archive L5045)
- [ ] expiring-jobs-push runs once daily (14:14 UTC) and can never warn a short-lead listing — Still open: expiring-jobs-push remains a once-daily cron; short-lead listings posted after the run still go unwarned. (archive L5076)
- [ ] Lead: a phone clock >1h fast may sign the user out (needs device repro) — Still open — needs a real-device repro before being treated as an app defect; not established either way. (archive L5079)
- [ ] My Posts search only searches the active status tab and tells the user the job doesn't exist — Still open: non-search empty state now names other tabs with matches, but the search-miss copy is still the unchanged generic line with no tab pointer. (archive L5086)
- [ ] A hired, funded job never says the money is held, on either side's card (product call) — Still open: Scheduled cards do not appear to state that payment is held; product decision not evidenced as made. (archive L5102)
- [ ] A rate-limited message shows only "Not Sent — Tap to Retry" with no reason and a retry that can't succeed — Still open: no distinct rate-limit copy/status found; rate-limited sends still fall into the generic 'failed' bucket. (archive L5130)
- [ ] Lead: "Work started — couldn't tell the poster" createNotification 5xx, likely repeated-run pressure — Still open/unconfirmed lead — not established as a real defect or dismissed. (archive L5135)
- [ ] Lead: boot watchdog "Helpr couldn't load." seen once on /profile, possibly mid-deploy — Still open/unconfirmed lead, single occurrence; assertHealthy will catch a repeat if real. (archive L5140)
- [ ] Edit Profile keeps the old avatar (initials) after "Use Photo" until the page is left — Likely improved (Profile.tsx now updates avatar_url in local state immediately after upload) but not conclusively confirmed against the exact header component named in the report — left open pending a visual check. (archive L5146)
- [ ] Skeleton screens (Account Security sessions, Warnings & Strikes, Earnings) pass detectStuckOrBlank without aria-busy/animate-pulse — Not reached — no evidence the named skeletons (sessions, Warnings & Strikes, Earnings) gained aria-busy/animate-pulse markers. (archive L5149)
- [ ] Journey residue accumulates on the shared test accounts; needs the scoped purge prod-lifecycle already asks for — Still open: no evidence a scoped purge for journey-residue jobs/conversations/notifications was implemented. (archive L5153)

### `overlay-sweep` is a report generator wearing a guard's name (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] e2e/happy-path/state-matrix/state-sweep.spec.ts (187 tests) is unopened, doubly exempted via noInventoryFloor — Still open: state-sweep.spec.ts remains on the noInventoryFloor exemption list; no evidence it was opened/reviewed. (archive L5177)
- [ ] error-state-sweep still unproven (272 tests, ~30 min); target unchanged (supabaseResult.ts if(error)) — Still open/not reached: no evidence of a mutation-proof run against the stated target since the item was filed. (archive L5178)

### `replaceState-churn` was hollow twice over (2026-09-21, FIXED)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 19 of 20 error_logs RouteErrorBoundary entries on /browse, /jobs, /posts still unexplained; /browse never churned — Partially investigated: a plausible mechanism (realtime churn + rapid UI churn) is now driven for /posts and /jobs, but /browse is still never churned and the field trigger remains unreproduced. (archive L5184)

### Dashboard three-surface CULL parity is still unguarded (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Data-layer culls (expired/past-dated/ownerless/own-post/funded/credential-tier/direct-offer/seed) have no registry or guard — Still open: no shared registry/guard exists for the data-layer culls; still three independently-expressed rule sets (SQL views, useDashboardData filter, useDashboardJobsCount). (archive L5198)

### Biometric gates — CLOSED 2026-09-21 (was 10 of 12 unobserved)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Still blind: no check proves iOS actually presents a biometric sheet; the whole class is jsdom; adminDisputesFiltering pins the gate to true — Still open, as the section itself states: no check proves iOS presents a real biometric sheet; jsdom-only coverage remains. (archive L5231)

### `useApplyFlow`'s PGRST202 fallback bypasses the rate-limit ladder (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] apply_to_job PGRST202 direct-INSERT fallback trapdoor bypasses minute/hour caps, funding gate, and the advisory lock — deliberately not closed with a test — Still open by design: the PGRST202 fallback trapdoor is unchanged, awaiting an owner decision (delete vs. harden triggers). (archive L5236)

### press-every-control dispatched 2026-09-21 — #1582's symptom is GONE, three new things
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Real candidate: the Notifications panel renders an error boundary for the customer role on /home and one /jobs/:id — Still open: nightly-red issue #1582 (press-every-control) remains open; no targeted fix for the customer-role Notifications-panel error boundary found. (archive L5345)
- [ ] Minor: bottom-nav "Posts" control timed out at 8000ms resolving a long nth-of-type chain; two notification rows non-deterministic — Not reached / still open: minor nth-of-type timeout and date-relative nondeterminism not specifically confirmed fixed. (archive L5349)

### `scrollWidth <= clientWidth` cannot see overflow in THIS codebase (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Guidance: any new fit check must implement BOTH the scrollWidth<=clientWidth clause AND the per-element 'no element wider than viewport' clause — Standing guidance, not enforced by a lint/guard yet — treat as open practice reminder for future fit checks. (archive L5375)

### Two AA contrast failures from the overlay sweep
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Find what actually paints the two composite contrast failures (#83837c, #b95e35) — Find what actually paints the two composite contrast failures (#83837c, #b95e35) (archive L5518)
- [ ] Do NOT change --muted-foreground/--stormy-sky on strength of this finding — Do NOT change --muted-foreground/--stormy-sky on strength of this finding (archive L5520)

### Route catalog overstates coverage (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 7 route names render ONE screen (/profile) but sweep counts them as 7 distinct routes — 7 route names render ONE screen (/profile) but sweep counts them as 7 distinct routes (archive L5525)
- [ ] error-state-sweep is still unproven (272 tests) via supabaseResult.ts unwrap() mutation — error-state-sweep is still unproven (272 tests) via supabaseResult.ts unwrap() mutation (archive L5527)
- [ ] Sweeps structurally cannot exercise the Big 7 completeness gate (buildFakeProfile sets is_legacy_use — Sweeps structurally cannot exercise the Big 7 completeness gate (buildFakeProfile sets is_legacy_user true) (archive L5528)

### Map/list parity — owner report 2026-09-21
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Map/list filter parity fix not yet verified in a browser (no screenshot at 375) — Map/list filter parity fix not yet verified in a browser (no screenshot at 375) (archive L5537)

### App Store screenshots (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] iPad shot '0 jobs' header above 7 cards — unreproduced, recheck at capture time — iPad shot '0 jobs' header above 7 cards — unreproduced, recheck at capture time (see also 5558) (archive L5557)
- [ ] ipad-13 browse shot is flaky — race between waitForTimeout(2500) and MapKit JS — ipad-13 browse shot is flaky — race between waitForTimeout(2500) and MapKit JS (archive L5566)
- [ ] iPad header reads '0 jobs' with seven cards rendered below — count/list disagree, spec still greenli — iPad header reads '0 jobs' with seven cards rendered below — count/list disagree, spec still greenlights it (see also 5548) (archive L5567)
- [ ] Guard proposal: walk MockRule pathnames to catch endpoints no src/ file calls — Guard proposal: walk MockRule pathnames to catch endpoints no src/ file calls (archive L5568)

### Guard burn-down — second front (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 49 comment-stripping guards delete real code; migrate to blankNonCode, each of the 49 has unknown co — 49 comment-stripping guards delete real code; migrate to blankNonCode, each of the 49 has unknown coverage (archive L5572)
- [ ] Edge mock records chained filters but never matches on them (src/test/edge/mocks/supabase.ts) — Edge mock records chained filters but never matches on them (src/test/edge/mocks/supabase.ts) (archive L5573)
- [ ] No guard asserts a Stripe outflow (cash-out-credits) has a durable ledger row — No guard asserts a Stripe outflow (cash-out-credits) has a durable ledger row (archive L5574)
- [ ] verification-webhook has 3 vendor branches; only Checkr is tested (stripe_identity, certificial unte — verification-webhook has 3 vendor branches; only Checkr is tested (stripe_identity, certificial untested) (archive L5575)

### Found while closing the audit gaps (2026-09-12)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Sweep never rendered /complete-profile (seed profile always complete); new complete-profile-incomple — Sweep never rendered /complete-profile (seed profile always complete); new complete-profile-incomplete screen uncommitted (archive L5579)
- [ ] Pre-push check blocks on pre-existing sweep failures; closes when full sweep is green — Pre-push check blocks on pre-existing sweep failures; closes when full sweep is green (archive L5583)

### Queued — start only after several running audit agents finish
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Pre-release gate: run every audit against the exact TestFlight/App Store build; block release on red — Pre-release gate: run every audit against the exact TestFlight/App Store build; block release on red (archive L5593)
- [ ] Production watching: alert on real users hitting error screens/failed requests (Sentry + error_logs) — Production watching: alert on real users hitting error screens/failed requests (Sentry + error_logs) (archive L5594)
- [ ] In-app 'Report a problem' with state: captures screen, route, recent errors automatically — In-app 'Report a problem' with state: captures screen, route, recent errors automatically (archive L5595)

### Findings from paused audit lanes (2026-09-12), to triage on resume
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Keyboard lane: DOB wheel focus ring, focus drops to body, #require-photo-proof switch naming — WIP a — Keyboard lane: DOB wheel focus ring, focus drops to body, #require-photo-proof switch naming — WIP a23bcb847 (archive L5600)
- [ ] Write-contract lane: instant_book_claim dead RPC; 4 open-payload profiles updates unchecked against — Write-contract lane: instant_book_claim dead RPC; 4 open-payload profiles updates unchecked against 11 non-updatable columns (see also 5580) (archive L5602)
- [ ] press-every-control: checkout presses fail in mock mode; dock Home not clickable on /profile; payout — press-every-control: checkout presses fail in mock mode; dock Home not clickable on /profile; payout-check banner does nothing — triage afte (archive L5603)

### Move every audit off mocks and onto prod (owner, 2026-09-12)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Visual sweep against prod as the test accounts; decide empty/error-state sweep replacement honestly — Visual sweep against prod as the test accounts; decide empty/error-state sweep replacement honestly (archive L5609)
- [ ] press-every-control MODE=prod: destructive presses only on test-owned records — press-every-control MODE=prod: destructive presses only on test-owned records (see also 5616) (archive L5610)
- [ ] Paused lanes (keyboard/large text, messy input, interruptions, slow phone, scorecard, explorer) resu — Paused lanes (keyboard/large text, messy input, interruptions, slow phone, scorecard, explorer) resume on prod, migrated not extended (archive L5611)
- [ ] Migrate existing mocked happy-path specs in CI to prod-backed or retire, one at a time — Migrate existing mocked happy-path specs in CI to prod-backed or retire, one at a time (archive L5612)

### REDO on prod — work that was only verified on mocks
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Button geometry + sibling heights (de9d3cd88, admin tiles, fraud select): re-verify on prod screens — Button geometry + sibling heights (de9d3cd88, admin tiles, fraud select): re-verify on prod screens (archive L5619)
- [ ] Keyboard file pickers, aria-label roles, dark contrast (dbed7befd): re-verify on prod screens — Keyboard file pickers, aria-label roles, dark contrast (dbed7befd): re-verify on prod screens (archive L5620)
- [ ] /complete-profile sweep screen needs a real incomplete-profile test account, not a mock rule — /complete-profile sweep screen needs a real incomplete-profile test account, not a mock rule (see also 5570) (archive L5621)
- [ ] Stale-deploy spec (2263feec8): routes loaded with the prod backend — Stale-deploy spec (2263feec8): routes loaded with the prod backend (archive L5622)
- [ ] New-tab destination check (f5e0e104f): sweep side re-run on prod — New-tab destination check (f5e0e104f): sweep side re-run on prod (archive L5623)
- [ ] Messy-input, deep-link interruptions, keyboard journeys: migrate to prod before extending — Messy-input, deep-link interruptions, keyboard journeys: migrate to prod before extending (archive L5624)
- [ ] press-every-control full run: MODE=prod, destructive presses only on test-owned records — press-every-control full run: MODE=prod, destructive presses only on test-owned records (see also 5601) (archive L5625)
- [ ] Mock seed (59a92d362) and mock-only harness pieces: retire once prod equivalents pass — Mock seed (59a92d362) and mock-only harness pieces: retire once prod equivalents pass (archive L5626)

### Launch checklist (owner decisions that flip at launch)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Switch Stripe to live (stripe-sandbox-off.sh) — Switch Stripe to live (stripe-sandbox-off.sh) (archive L5630)
- [ ] At the same moment: confirm the LIVE webhook endpoint on /functions/v1/stripe-webhook is still enabled and resend any live events it failed while the sandbox key was in place (Q163: since Q156 those are answered 400, so Stripe may have disabled it).
- [ ] At the same moment: retarget the Stripe webhook-endpoint check (scripts/check-stripe-webhook*, now fail-closed on 0 endpoints; Q52 area 3) and money-reconciliation's Stripe reads to the LIVE key/account, and confirm both run green against live. The sandbox green does not carry over.
- [ ] Upgrade Vercel to Pro before launch (owner 2026-09-23: not before it's needed). Vercel's Hobby plan is for non-commercial use; once on Pro, optionally switch production back to deploy-on-every-push (vercel.json git.deploymentEnabled + prod-deploy.yml, Q271) and update src/test/prodDeployDebounce.test.ts in the same commit
- [ ] After the live-key switch: delete the 12 Supabase secrets STRIPE_PRICE_{BASIC,PLUS,PRO,ELITE}_{MONTHLY,ANNUAL,ONETIME} (proTiers.ts honours them only with an sk_test_ key; Q241)
- [ ] Hide seed/demo jobs publicly (seed_jobs_hidden_publicly()) — Hide seed/demo jobs publicly (seed_jobs_hidden_publicly()) (archive L5631)
- [ ] OWNER (App Store Connect > App Privacy, before the next submission): mark Product Interaction and Crash Data as "Linked to You" (CS-004, 2026-09-24). The app's PrivacyInfo.xcprivacy now says linked, because PostHog identify() sends the user id and Sentry setUser() sends id + email; Apple compares the label to the manifest.

### Routine consolidation (2026-09-12)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] OWNER: delete the 8 disabled cloud routines at claude.ai/code/routines (API cannot delete) — OWNER: delete the 8 disabled cloud routines at claude.ai/code/routines (API cannot delete) (archive L5657)

### Unshipped branches (owner review)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Find which session deleted ~150 local branches on 2026-09-12 without logging tip shas — Find which session deleted ~150 local branches on 2026-09-12 without logging tip shas (archive L5664)

### Agent queue (2026-09-13, max 3 at once)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Release/Accept + other money double-tap refs (worktree agent-aaec88c069873cd52, commit 75448970c) — Release/Accept + other money double-tap refs (worktree agent-aaec88c069873cd52, commit 75448970c) (archive L5669)
- [ ] Admin follow-ups: unknown-tier fallback, support view, admin role indeterminate (worktree agent-a9c2 — Admin follow-ups: unknown-tier fallback, support view, admin role indeterminate (worktree agent-a9c25acab110f3ea5, bb9a529fe) (archive L5670)
- [ ] Full customer/helper -> poster/Helpr internal rename, NO aliases (after gift card rename lands) — Full customer/helper -> poster/Helpr internal rename, NO aliases (after gift card rename lands) (archive L5692)
- [ ] Race fixes: settle_dispute_record, DisputeDialog, JobTracking helper_completed_at — partial WIP on w — Race fixes: settle_dispute_record, DisputeDialog, JobTracking helper_completed_at — partial WIP on wip/race2-terminal c983eb2a9 (archive L5699)

### PROD DB OVERLOAD (2026-09-14) — cause found
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] RISK: GitHub keeps one pending run per concurrency group; a run outlasting its 2h slot cancels the n — RISK: GitHub keeps one pending run per concurrency group; a run outlasting its 2h slot cancels the next prod-errors run silently (archive L5717)
- [ ] Not moved into prod-load: race-runner, ui-sweep; press-every-control/e2e-abuse-notifications lost th — Not moved into prod-load: race-runner, ui-sweep; press-every-control/e2e-abuse-notifications lost their shared-accounts lock (archive L5718)

### MAIN IS RED (found 2026-09-13) — do these first
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] E2E happy-path smoke 34746217548 red: dashboard axe contrast 3.75:1 + activity-card-density count mi — E2E happy-path smoke 34746217548 red: dashboard axe contrast 3.75:1 + activity-card-density count mismatch; e2e-real-backend cancelled, nigh (archive L5724)
- [ ] Open PRs: dependabot #1580, #1579, #1550, #1549, #1529 — land green ones in one batch, close stale — Open PRs: dependabot #1580, #1579, #1550, #1549, #1529 — land green ones in one batch, close stale (archive L5725)

### Gaps found 2026-09-13 night
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Make every harness that can add a strike delete its user_violations/user_strikes rows and restore ba — Make every harness that can add a strike delete its user_violations/user_strikes rows and restore ban_status in cleanup (archive L5730)
- [ ] After Vercel limit resets: re-count 'admin role indeterminate' rows in error_logs (fix e9fcac710); c — After Vercel limit resets: re-count 'admin role indeterminate' rows in error_logs (fix e9fcac710); close nightly-red #1591 (archive L5738)
- [ ] press-every-control: 84 'control not found' are Notifications panel rows + /account-pending nav — ad — press-every-control: 84 'control not found' are Notifications panel rows + /account-pending nav — address by stable id not label+ordinal (archive L5740)
- [ ] press-every-control: 11 'no observable change' presses are selected-segment/self-route/native-valida — press-every-control: 11 'no observable change' presses are selected-segment/self-route/native-validation — classify as documented skips (archive L5741)
- [ ] Verify on prod when healthy: Notifications panel silent-failure vs true empty state for a poster wit — Verify on prod when healthy: Notifications panel silent-failure vs true empty state for a poster with Unread=313 during 09-13 outage (archive L5742)
- [ ] Re-run press-every-control once prod is steady; authed coverage unproven until #1582 gets a healthy — Re-run press-every-control once prod is steady; authed coverage unproven until #1582 gets a healthy run (archive L5743)
- [ ] ~20 finished .claude/worktrees/agent-* worktrees: remove one at a time after confirming merged/pushe — ~20 finished .claude/worktrees/agent-* worktrees: remove one at a time after confirming merged/pushed (archive L5746)
- [ ] OWNER: STRIPE_TEST_SECRET_KEY secret; reconnect Supabase/Slack/Canva connectors — OWNER: STRIPE_TEST_SECRET_KEY secret; reconnect Supabase/Slack/Canva connectors (see also 5692) (archive L5749)
- [ ] Git history rewrite (322 MB dead media) — only after every agent/terminal stopped — Git history rewrite (322 MB dead media) — only after every agent/terminal stopped (archive L5750)
- [ ] 14 remote branches kept with unshipped work: resolve each (land/fold/record why abandoned) then dele — 14 remote branches kept with unshipped work: resolve each (land/fold/record why abandoned) then delete (archive L5753)
- [ ] Alerts to one Slack channel: prod down, deploy failed, nightly-red, Stripe webhook failures, DB near — Alerts to one Slack channel: prod down, deploy failed, nightly-red, Stripe webhook failures, DB near free-tier limits — PARTLY DONE (archive L5755)
- [ ] OWNER: create Slack Incoming Webhook, add as SLACK_WEBHOOK_URL secret — OWNER: create Slack Incoming Webhook, add as SLACK_WEBHOOK_URL secret (archive L5758)
- [ ] [Q266: covered by scripts/storage-orphan-sweep.mjs; only its latest log needs reading] Supabase storage audit: orphaned files in the 10 buckets (after the release proof; light prod reads — Supabase storage audit: orphaned files in the 10 buckets (after the release proof; light prod reads only) (archive L5761)
- [ ] Hallie avatar re-upload path: prove on prod (owner asked) — Hallie avatar re-upload path: prove on prod (owner asked) (archive L5764)
- [ ] Signed-in press-every-control full run on prod (owner: run just before final re-check) — Signed-in press-every-control full run on prod (owner: run just before final re-check) (see also 5734) (archive L5765)
- [ ] Supabase Pro: owner will decide later (not before launch prep) — Supabase Pro: owner will decide later (not before launch prep) (archive L5766)
- [ ] Group job screenshots: BUILT, apply+screenshot pending (prod has 0 group jobs, only local render pro — Group job screenshots: BUILT, apply+screenshot pending (prod has 0 group jobs, only local render proven) (archive L5773)
- [ ] QUEUED: land + prove completion-race (2608b2585) with before/after probe numbers, re-enable race-run — QUEUED: land + prove completion-race (2608b2585) with before/after probe numbers, re-enable race-runner.yml (archive L5774)
- [ ] STILL OPEN: screenshot the poster's group card on /posts at 375 light+dark, record with review:re — STILL OPEN: screenshot the poster's group card on /posts at 375 light+dark, record with review:record (see also 5764) (archive L5778)
- [ ] QUEUED: race proofs for fa107a92f fixes (auto-release vs dispute, auto-resolve vs escalate/withdraw, — QUEUED: race proofs for fa107a92f fixes (auto-release vs dispute, auto-resolve vs escalate/withdraw, gift-card vs card payment, revision dou (archive L5780)
- [ ] MIGRATION DRIFT: jobs.boost_auto_extended exists in prod but no migration creates it (pinned in KNOW — Open (lead, live 2026-09-23): jobs.boost_auto_extended exists in prod but no migration creates it; still listed in KNOWN_UNMIGRATED_COLUMNS (offeredHelperPrivacy.test.ts:308). (archive L5784)
- [ ] VERIFY after this push: first nightly of each switched workflow (journeys, journeys-webkit, prod-aud — VERIFY after this push: first nightly of each switched workflow (journeys, journeys-webkit, prod-audit, a11y-webkit-prod, e2e-real-backend, (archive L5788)
- [ ] RESIDUAL: a paid journey leg still lands one page load on prod (Stripe success_url = prod getAppUrl( — RESIDUAL: a paid journey leg still lands one page load on prod (Stripe success_url = prod getAppUrl()); needs WebKit-proven route fix (archive L5789)
- [ ] BUILT on branch vercel-usage-alert; VERCEL_TOKEN added; lead must land + dispatch to verify — BUILT on branch vercel-usage-alert; VERCEL_TOKEN added; lead must land + dispatch to verify (archive L5790)
- [ ] OWNER: set Deployment Retention to shortest in Vercel dashboard (34 GB of deployment storage is depl — OWNER: set Deployment Retention to shortest in Vercel dashboard (34 GB of deployment storage is deploy history) (archive L5791)
- [ ] RESIDUAL: installed iOS/Android builds bundle the old client phone-number regex until a new native b — RESIDUAL: installed iOS/Android builds bundle the old client phone-number regex until a new native build ships (archive L5796)
- [ ] Native build needed to pick up all client-side scanner changes (phone regex, neutral-toast, location — Native build needed to pick up all client-side scanner changes (phone regex, neutral-toast, location-share) — owner decides when to cut it (archive L5799)
- [ ] LAST: independent re-check by a different model (sonnet) of ALL work landed 2026-09-13 — full vitest — LAST: independent re-check by a different model (sonnet) of ALL work landed 2026-09-13 — full vitest, CI green per push, re-run each fix's o (archive L5809)
- [ ] OWNER: allow Stripe connector write tool + reconnect Stripe, add transfer.failed to live webhook, cl — OWNER: allow Stripe connector write tool + reconnect Stripe, add transfer.failed to live webhook, close #1462/#1521 (archive L5810)

### ASK THE OWNER AFTER THE PUSH
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Empty /jobs desktop header shows bare magnifier, no title/tabs — owner to pick a/b/c — Owner decision still pending: empty My Jobs/Posts desktop header shows bare magnifier with no title or tabs. (see also line 6604 / line 7413) (archive L6387)

### OPEN, reported not built (owner decisions)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] After admin marks stalled job reviewed, next step undefined (no link into refund/status dialog) — Still open: reviewing a stalled job leaves the admin to navigate manually to refund/status-override dialogs. (archive L6436)
- [ ] No rail badge count on the Stuck Jobs admin queue — Still open: Stuck Jobs queue has no live rail badge count. (archive L6440)

### REVERTED — a deploy-lag heuristic that masked a real defect
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] write-contract.snapshot.json needs appliedMigrations metadata so pending vs missing RPC is exact — Still open: write-contract snapshot lacks migration metadata, so deploy-lag can't be distinguished from a real missing RPC. (see also line 6579) (archive L6501)

### STILL OPEN from the checking work
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Unfloored guards (classA_noInventoryFloor) not closed down — Still open: 25 guards (was 20) still pass on an empty inventory per current vacuity-report.json. (archive L6582)
- [ ] 38 mount-wiring gaps reported, not gated — Still open: mount-wiring gaps (incl. PostedJobCard/AppliedJobCard) remain reported, not gated. (archive L6583)
- [ ] Class (e) literal-vs-semantic mutation quality is not statically decidable — Open by design: a weak mutation can still 'kill' a guard; not mechanically detectable. (archive L6586)
- [ ] write-contract.snapshot.json carries no metadata for deploy-lag detection — Duplicate — see line 6492. (see also line 6492) (archive L6588)
- [ ] 7 edge functions still leak error detail (EF5 ratchet) — Still open: 7 edge functions still leak error detail into responses (ratcheted, unfixed). (archive L6590)

### NEW — LOW (from the same pass)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Seed rot: two proof-photo storage URLs on job e7e09075 return HTTP 400 — Not verified; likely still open (minor seed-data rot). (archive L6636)

### NEW — PATTERN: seed fixtures create states the app cannot reach
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Decision needed: stamp fixtures realistically or add a CHECK constraint forbidding the fixture-only state — Owner decision still needed: seed producers bypass accept_job/respond_to_direct_offer, creating states real jobs never reach. (archive L6660)

### NEW — user-facing: Not Now on push prompt tells user notifications are off
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] pushPermissionNudge.ts treats dismissed dialog as browser-denied, misinforming any user who ever blocked notifications — Still open per doc: 'Not Now' on the push prompt incorrectly claims notifications are off. (archive L6722)

### NEW — prod profile load really is over budget
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 6237.9ms profile load vs 6000ms budget; auto-heal fires only after error card paints — Open: profile-load auto-heal still runs after the error card paints; decision on budget vs pre-empt not recorded. (archive L6729)

### BREAKAGE (d) — reviews. OWNER DECISIONS NEEDED
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Crew jobs: review model undefined (one review per crew vs per member, tier weighting, blind-window timing) — Open, owner decision needed: crew review semantics (N reviews vs 1, tier weighting, blind-window close) undecided; blocks group jobs launch. (see also line 6801) (archive L6789)

### NEW — pre-existing, unrelated to crews: the review gate disagrees with itself
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] can_review_job requires payment_status='released' but INSERT policy also allows payout_pending — Not reached for live re-verification; reported still open in doc — UI may hide a review control the DB would accept. (archive L6805)

### STILL REQUIRED before GROUP_JOBS_ENABLED can flip
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 5 prerequisites (reviews decision, per-member payout release, crew UI, drop reject_new_group_jobs, prod xmin race proof) all still outstanding — Confirmed open: GROUP_JOBS_ENABLED is still false; none of the 5 prerequisites built. (archive L6810)

### NEW — the 320 truncation gate has a hole
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] activity-card-density.spec.ts inventory misses Directions/SOS/Share/capture-chip controls (no data-job-action-chip hook) — Not independently reverified; reported still open — self-drawing row controls lack the density-gate hook. (archive L6871)

### TIGHTEST ROW IN THE APP — needs the lead's eyes at 320
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Helper Disputed-with-photo-owed row: 'Withdraw' measures ~50px in a ~56px primary slot, inside by 4px — Not reached — needs a browser-lane look; margin was measured at only 4px. (archive L6877)

### NEEDS AN OWNER LOOK / DECISION
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Chip order hides Message in overflow on both dispute rows at 320 — Open: overflow ordering still buries the Message chip on dispute rows at 320; not reordered pending owner call. (archive L6969)
- [ ] 'Try My Location Again' is the widest primary label, forces zero visible chips at 320 on-site — Open: widest-label collapse at 320 remains; a copy change ('Retry Location') was proposed but not made. (archive L6969)
- [ ] The overflow 'More' popover is entirely unverified visually — Not reached — More popover placement/width/grid never visually verified. (archive L6969)

### NEW — 37 seed rows pass the address check and still go nowhere
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Fake '100 Audit Way...99999' addresses satisfy hasStreetAddress() but resolve nowhere for Directions — Open: 37 seed rows have unresolvable fake addresses; fix deferred to E2E lane. (archive L7005)

### NEW — three real prod jobs are actually fixtures
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 3 cancelled, town-only, pre-flag jobs (4c44aa1b, c4d3df74, 24dd5b6b) are miscounted as real user data — Not independently reverified live; reported open, worth flipping/deleting before launch. (archive L7013)

### NEW — the address runtime check cannot be credential-free
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] seedFixtureAddressRealism-style check needs the service-role leg of e2e-real-backend.yml — Not independently reverified; reported as needing placement on the credentialed CI leg. (archive L7018)

### NEW — HIGH (fairness): profile stat tiles use THREE different denominators
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Jobs completed / Jobs posted / Cancelled use inconsistent, non-reconciling denominators; 32/35 cancellations are helper-side but counted against the person — Open, owner decision needed: profile stat tiles' three denominators still don't reconcile. (archive L7042)

### NEW — [SWEEP] prefixes are stranded prod data
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 14 of 17 prod reviews carry leftover [SWEEP]/[E2E DO NOT ACCEPT]/SEED prefixes with no live writer remaining — Not independently reverified; reported as needing a one-off cleanup or the seed-flag flip. (archive L7055)

### NEW — quick-tags are concatenated into the review body (write-path)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Durable fix needs a tags text[] column; two byte-identical write-path implementations to converge — Open: quick-tags still concatenated into feedback text; schema fix not built. (archive L7060)

### NEW — same origin-trust family, reported not fixed
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] JobTracking 'X mi from job' refusal distance and BrowseTasksFeed discarding `approximate` are same family, left alone by design — Open by design/deferred: origin-trust-family distance displays (refusal distance, BrowseTasksFeed approximate flag) left unaddressed. (see also line 7320) (archive L7119)

### FOLLOW-UP — is_flexible_schedule is IMMUTABLE after posting
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] EditJobDialog.tsx omits is_flexible_schedule from updateData, so a poster who forgets the box must delete and repost — Confirmed still open: EditJobDialog.tsx never writes is_flexible_schedule, so it remains immutable after posting. (archive L7211)

### FOR THE VISUAL PASS: the unread dot is now the ONLY unread signal, and it is 8px
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] 8px unread dot needs an eyeball check at 375 and 1440 now it's the sole unread signal — Not reached — needs visual review; the 8px unread dot was called 'subtle' but not changed. (archive L7270)

### STILL OPEN from this correction
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] A feed-level 'you're far from these jobs' line was never built (only per-job detail shows real distance) — Open: no feed-level distance banner built; still per-card/per-job only. (archive L7325)
- [ ] BrowseTasksFeed.tsx:323-328 drops the `approximate` flag, now live signal again — Duplicate — see line 7110/7115. (see also line 7110) (archive L7329)

### Handed back / still open
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Stale @mutate find-strings failing vacuity in job-card WIP (3 guards) — Not independently reverified; reported as still-stale @mutate strings in 3 guards. (archive L7380)

### STILL OPEN after the 2026-09-19 late session
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Desktop Browse search drops focus to <body> on close (/posts is correct) — Not confirmed fixed — desktop Browse search focus-loss on close not mentioned again as resolved. (archive L7421)
- [ ] TabFallback uses one 230px placeholder for all 23 Profile tabs; needs per-tab reserved heights — Not reached / still open: TabFallback's single 230px placeholder still misfits tabs like home_history (3359px) and gift_card (1230px). (archive L7423)
- [ ] Two different components both named JobCardSkeleton render two unrelated skeletons in sequence on /home — Not reached / still open per doc. (archive L7426)
- [ ] ApplicationCardSkeleton vs JobCardShell mismatch (-52px); /user/:id IdentityHeroSkeleton reserves 326px, 141px arrives — Not reached / still open per doc. (archive L7429)
- [ ] At 320 the wrapped address is centered while the date beneath it is left-aligned — Not reached / still open per doc — minor address/date alignment mismatch at 320. (see also line 7395) (archive L7431)
- [ ] Dialog-corner WIP was RED and not committed; backed up as a local patch file — Confirmed still open: dialog-corner WIP patch sits unapplied at ~/lh-dialog-corner-WIP-2026-09-19.patch. (archive L7432)

### 2026-09-20 lead visual verification of the overnight lanes
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] activityTabLabelsFitAPhone guard is green even when the tab row isn't visible (measures width, not visibility) — Not reached / likely still open: guard gap (measures width of a possibly-hidden element) not confirmed fixed. (archive L7449)
- [ ] Messages empty inbox hides its tabs and search trigger (same shape as the Activity bug) — Open: Messages empty inbox still hides tabs/search; owner positions conflict, no fix built. (see also line 7479) (archive L7457)

### Still open for the owner
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Profile LANDING sits at a different gutter (x=145) than its own tabs (x=72) — Open: Profile landing gutter still differs from its tabs; deliberately not changed pending being named. (archive L7485)
- [ ] TAB_TITLES.wrapped drifts ("Helpr Wrapped" vs "Your 2026 so far") — Not reached / still open per doc. (archive L7495)
- [ ] /jobs applied-card pitch unverified — both test accounts had zero live applications — Not reached — needs a live journey with a real applied-card to verify. (archive L7497)
- [ ] vacuityGate.test.ts races discardedQueryFilters.test.ts over a fixture in src/ — Not reached — test-flakiness claim not re-verified (vitest excluded from this pass). (archive L7498)

### OPEN — three visual findings from the 2026-09-23 verification pass
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] WebKit only: bottom nav is not frosted (feed text shows sharp under icons) — Not reached — needs device/simulator check; may be a headless-WebKit rendering artifact, not confirmed as a real app bug. (archive L7587)

## CARRIED — the 2026-09-02 ledger (docs/audit/OPEN_ITEMS.md, retired 2026-09-23)

Re-checked 2026-09-23; the full compile is at docs/archive/OPEN_ITEMS-2026-09-02.md.
- [ ] **LIVE DEFECT #5**: Storage keys built from client-supplied file extension (complete-signup + Profile.tsx). Partially fixed: edge-fn 4 fields fixed; Profile.tsx id-upload still keys off client filename ext.
- [ ] **LIVE DEFECT #6**: 173 orphaned rows in prod, some carrying PII (notification_logs, login_history). OPEN, larger: live 2026-09-23 notification_logs has 1,935 rows whose user_id has no auth.users row, 1,888 still carrying recipient_email; ALL 1,888 emails match mailinator/seed/test/example (lead query) — test-account churn, not real users. login_history 482 orphans with ip_address; analytics_events 830. purge coverage for deleted TEST accounts is the gap.
- [ ] **LIVE DEFECT #25**: Senior mode .truncate amputates visible characters (193 occurrences). Still open by design: per-component fix explicitly not done; global attempt was reverted.
- [ ] **LATENT #1**: Group jobs broken in 5 places (message, accept/complete, Activity, reviews, dispute split). 3 of 5 sub-defects fixed pre-compile; (b)/(d) still open, control still gated off (GROUP_JOBS_ENABLED=false). (also: docs/OPEN.md VN-52 'Group jobs — inventory + turn-on plan', Phase 1 landed 2026-09-19, flag still false)
- [ ] **LATENT #5**: charge-recurring-visits charges an arbitrary saved card (resolves customer by email). Unchanged: still resolves the Stripe customer/card by email rather than the checkout-authorised method. (also: none found)
- [ ] **LATENT #6**: charge-recurring-visits Stripe idempotency keys expire inside the funding window. Unchanged; mitigated by a unique index per the doc but the 24h key-expiry residual risk is still present and self-documented. (also: none found)
- [ ] **LATENT #7**: No FK protects the ten no-FK tables (orphans possible outside app code). Still open and WORSE: orphan analytics_events rows grew from 63 to 830 since the doc was compiled; no FK added. (also: docs/OPEN.md:4294 notes 'no-FK tables are handled in code by choice')
- [ ] **LATENT #8**: Three edge functions have no verify_jwt=false block in config.toml. Still open; config.toml's own comment (2026-09-10) confirms daily-match-digest/saved-helper-availability-push/str-ical-sync still lack the stanza, by acknowledged omission not a fix. (also: none found)
- [ ] **LATENT #10**: OfflineBanner is lazy() — can fail to load on cold offline boot. Unchanged; still lazy-loaded with a null Suspense fallback, deliberate per the row's own note. (also: none found)
- [ ] **LATENT #11**: Twelve bare <Navigate> redirects drop search/hash. Not fully re-verified; original doc itself already characterizes this as sanctioned/low-risk (no query currently reaches these routes) — treat as open pending a fresh check, not reached. (also: none found)
- [ ] **LATENT #12**: Ten retired marketing routes 404 with no redirect stub. Unchanged: routes still intentionally 404 with no redirect; RW-002 reference not locatable in OPEN.md now. (also: filed as RW-002 by the launch fleet per the row's own text; RW-002 string not found via grep in current docs/OPEN.md)
- [ ] **UNVERIFIED #1**: Entire native iOS surface never verified (WKWebView-specific bug class). Not reached — requires TestFlight/simulator pass, outside this read-only reconcile's tooling. (also: none found)
- [ ] **UNVERIFIED #2**: Universal-link association on a device (AASA CDN cache). Not reached — device-only settlement, unchanged. (also: none found)
- [ ] **UNVERIFIED #3**: Cold-start push tap (real APNs to a force-quit app). Not reached — device-only settlement, unchanged. (also: none found)
- [ ] **UNVERIFIED #4**: helpr:// custom-scheme branch has zero test coverage. Partially settled: unit test now exists (fixed that half); the SFSafariViewController device drive remains not reached. (also: none found)
- [ ] **UNVERIFIED #5**: A group job end to end (post -> accept x3 -> work -> complete -> payout). Still blocked upstream; not reached, consistent with LATENT #1's continued open (b)/(d). (also: docs/OPEN.md VN-52)
- [ ] **UNVERIFIED #6**: A recurring series end to end (create -> visit charges -> cancel). Not reached — needs a Stripe test-mode fixture, unchanged. (also: none found)
- [ ] **UNVERIFIED #7**: A dispute end to end on live accounts (file -> evidence -> escalate -> admin resolve). Not reached — needs a browser session, unchanged. (also: docs/OPEN.md has extensive dispute-money guard work (money-escrow reviews) but no end-to-end UI drive recorded)
- [ ] **UNVERIFIED #8**: cancelStripeSubscription on a real subscription (delete-own-account). Not reached — owner/credential settlement, unchanged. (also: none found)
- [ ] **UNVERIFIED #9**: No Stripe call was ever made in either mode by any lane (customer dedup, portal scoping, accounts.del balance refusal). Not reached — still rests on recorded findings and Stripe docs, not a live call. (also: none found)
- [ ] **UNVERIFIED #12**: Three write paths never driven: /availability weekly-hours SAVE, available-now toggle, /str-settings. Not reached — needs a browser session, unchanged. (also: none found)
- [ ] **UNVERIFIED #13**: The /complete-profile avatar UPLOAD path never exercised with a fresh account. Not reached — needs a browser session, unchanged. (also: none found)
- [ ] **UNVERIFIED #14**: Whether GoTrue's own rate limit backs the client-side login lockout. Not reached — owner/dashboard-only settlement, unchanged, verdict note: owner. (also: none found)
- [ ] **OWNER-ONLY #2**: CAN-SPAM postal address empty in email footer. Code unchanged; still an empty literal awaiting owner value.
- [ ] **OWNER-ONLY #3**: Switch Stripe from test to live mode. Deliberately deferred to launch day per standing owner order; still open. (also: docs/OPEN.md launch checklist (stripe-sandbox-off.sh))
- [ ] **OWNER-ONLY #4**: Native iOS rebuild + TestFlight for push/AppDelegate fix. Owner action; not reached for a fresh build in this check.
- [ ] **OWNER-ONLY #5**: Archive stale Stripe products/prices + orphan seat secrets. Owner-only dashboard/API action; unverifiable from repo, stays open.
- [ ] **OWNER-ONLY #6**: Resolve the App Store ID (dead listing). App Store listing still 404 / resultCount 0 as of this check; unchanged.
- [ ] **OWNER-ONLY #8**: Seed-job cold start — board is 100% fixture data. Still 0 real open jobs on the board; flip-the-switch decision remains unmade.
- [ ] **OWNER-ONLY #9** [Q266: scripts/storage-orphan-sweep.mjs now does this; read its latest log, e.g. docs/audit/storage-orphans-deleted-2026-09-14.log, before acting]: Purge three orphaned avatar storage objects. Not reached — no evidence of the one-off deletion having run.
- [ ] **OWNER-ONLY #10**: Early Access delay past match alert (up to 20 min). Still an open product decision; no code change found.
- [ ] **OWNER-ONLY #11**: Enable HaveIBeenPwned in Supabase Auth (F-SEC-08). Owner dashboard action; unverifiable from repo, stays open. (also: TODO.md (F-SEC-08))
- [ ] **OWNER-ONLY #12**: Decide the Android question (dead FCM branch, no client). Still no android/ directory or assetlinks.json; decision not made.
- [ ] **HYGIENE #3**: axe workflow (a11y-axe.yml) not a required branch-protection check. Branch protection still lists only 3 required checks; axe/a11y still not required.
- [ ] **HYGIENE #5**: handleIdUpload / idUploading / onIdUpload dead prop chain. Still present unchanged — dead chain not removed.
- [ ] **HYGIENE #6**: Inline translucent nav pill/curtain fills survive prefers-reduced-transparency. Not reached in enough depth to confirm change; treated as unresolved.
- [ ] **HYGIENE #8**: helpr-pass-wallet edge function unreferenced, 501s. Still unreferenced from the client and still on the known-dead list; unchanged. (also: scripts/check-dead-edge-functions.mjs (known-dead list))
- [ ] **HYGIENE #9**: submit-partner-application function absent; write path revoked. Still a dead end on both sides; no build-or-drop decision made.
- [ ] **HYGIENE #10**: .text-display-eyebrow is display:none while call sites and docs still emit/mandate it. Still display:none with active call sites; doc references reduced from 7 to 1 but not resolved.
- [ ] **HYGIENE #11**: platform_settings.feature_flags carries 4 unread keys. All 4 keys still present in the live row and still unread by any code path. (also: src/components/admin/adminHealth/useConfigChecks.ts (warns))
- [ ] **Amendment #O-003**: zz-runtime-probe AASA assertions failing (HTTPS+paths, apex no-redirect). Still open: `curl -sI https://louisianahelpr.com/.well-known/apple-app-site-association` = HTTP 307 (2026-09-23). Bus O-003 open. Owner Vercel-dashboard step (memory: apex-universal-links).

## AUDIT BUS — findings live in the ledger, not here

`node scripts/audit-bus.mjs list` is the findings list; ROLLUP.md and COVERAGE.md
print its counts. Reconciled 2026-09-23 (334 open to 163 open, every status
record carries its evidence). The HIGH / launch-blocker ones as of 2026-09-23
(⚑ = blocker):

| ID | Sev | Current status (2026-09-23) |
|---|---|---|
| NB-004 | HIGH ⚑ | push_tokens still 0 rows live; APNs fix is in code but no device has ever registered (see NB-018). |
| OA-001 | HIGH ⚑ | FIXED 2026-09-24: complete-signup is time-bounded and a failure after signUp routes to Check Your Email; first sign-in recovers profile + consent. Guard signupCompletionFailureNotDeadEnd.test.ts, proven red. |
| OBS-001 | HIGH ⚑ | 0 of 3 admins have a push token; admin safety alerts still fan into the void |
| CC-006 | HIGH ⚑ | FIXED 2026-09-24 (0ed5f317a): onabort rejects; Signup toasts and continues. Guard signupHelpers.test.ts, proven red. |
| BR-005 | HIGH ⚑ | CLOSED 2026-09-24: dashboard shows emails 100/h, sign-ups 30/5min per IP; the '2/hour' was observed volume, not the limit. |
| NB-017 | HIGH ⚑ | CODE FIX 2026-09-25 (Q427): one router (deepLinkRouter.ts) for getLaunchUrl + appUrlOpen, cold-start twin de-duplicated, started independent of push setup. Guard deepLinkOneRouter.test.ts, proven red. Device verification still owed: steps in Q427 (gated on the Q152 TestFlight build). |
| OA-009 | HIGH ⚑ | FIXED 2026-09-24 (4d0c79b99): the non-dismissible re-consent gate captures pin + legal_acceptances event before any use (test proves both); the one live pin-without-event row was made by the press firewall, now fixed. |
| BD-008 | HIGH ⚑ | FIXED (fa95a3ab0, 2026-09-07): header falls back to the rendered count under client-only filters. Guard dashboardCountNeverOverstates.test.ts (78c388d5a), proven red. |
| ME-006 | HIGH | FIXED on branch me006 (2026-09-25), not yet on main or deployed: both tip charge paths charge tip + card fee from `_shared/tipFees.ts` and the Helpr's transfer is the whole tip; tip dialogs show the fee first. Guard src/test/tipFeesOneDefinition.test.ts, proven red. Verify on prod in Stripe test mode after deploy (Q362). |
| DH-001 | HIGH | Poster's own share link still routes into apply flow with no owner branch (JobDetail.tsx). |
| NB-013 | HIGH | /reset-password + /account-pending still safely excluded from AASA; setSession() precondition still not implemented. |
| N-003 | HIGH | FIXED 2026-09-23 (1d35ff035): quiet hours evaluated in America/Chicago (no per-user tz column exists) via send-push-notification/quietHours.ts. Guard src/test/edge/quietHoursLocalTime.test.ts (CLASS: no getUTCHours/getHours in any edge fn), proven red. |
| DR-004 | HIGH | Open / not fully reached: storage objects + edge-function secrets still outside the DB backup's scope; not re-measured live this pass. |
| EJ-001 | HIGH | Toast copy for signup rate-limit fixed; underlying email-rate-limit cap on signups not verified as raised. |
| AM-001 | HIGH | FIXED 2026-09-23 (8f637a349): no-PI / PI-not-succeeded disputes send the deduped UNSETTLEABLE admin reminder + claim_skipped. Guard src/test/edge/auto-resolve-disputes.test.ts (CLASS: 20 skip states, none silent), proven red. |
| OA-002 | HIGH | Create Account button still double-tappable during the phone-validation round-trip |
| TS-006 | HIGH | No report/block control on applicant/bid rows — still open, not reached in full depth |
| TS-007 | HIGH | SOS button still poster-only, no helper-side safety control or 911 path |
| S-002 | HIGH | Partially open: parish + email channels fixed, but push_tokens is still 0 rows in prod — push channel still dead. |
| OA-017 | HIGH | /account-pending still describes a review process that does not exist, with no working self-service exit |
| IB-002 | HIGH | Narrowed: title/description gated live (2b0528f9f); special_requirements still unscanned |
| NB-018 | HIGH | analytics_events shows 0 permission_denied/permission_skipped_guest rows ever; push ask still unexercised in prod. |
| PD-005 | HIGH | Sentry chunk still loads on every passive page load via useAuthReady's auth-ready breadcrumb, defeating the interaction gate. |
| PD-020 | HIGH | Re-measured 2026-09-24 from dist (static graph, scripts/perf/critical-path.mjs analyse with /my-posts->Activity): 45 chunks, 361 KB gz, 2 rounds. 12 of the 13 named early chunks are no longer on the static path; forms (zod, ~80 KB raw) still is, via Activity -> app-shared -> forms. Browser request count (was 252 / 2.49 MB) not re-measured (needs the browser lock). |
- [ ] **Q92 Seed money rows no path will ever settle (found by Q90).** (a)
  24 seed jobs sit in payout_pending with payout_scheduled_at still in the
  future (2026-09-23 08:30Z); both payout crons skip is_seed, so each becomes
  a seed payout_pending_stranded tomorrow, and the nightly money journeys
  never prove the transfer leg. Decide: sweep seed payouts on a separate
  cron once Q3 funds the test balance, or have the journeys pay out
  explicitly. (b) The owner-account tracker fixtures 5eed0a10/0a20 (-10, -11,
  -12) claim released / payout_pending / disputed with no Stripe object or
  disputes row. Owner decision: delete them (tips, reviews and messages
  cascade) or keep them as known digest-only seed findings. (c) Unverified
  lead: a GROUP job whose dispute was withdrawn or auto-resolved keeps
  disputed_at, so process-scheduled-payouts (`.is("disputed_at", null)`)
  skips it, and auto-release Phase 2 excludes group jobs. If both hold, its
  payout never runs. Reproduce before fixing.
- [ ] **Q93 Seed jobs still reach admins' in-app inbox from DECISION (lead, 2026-09-23, after the review of a7f660642): (b) a failed repair WRITE on a seed profile KEEPS counting as a defect. It is the mechanism failing (the same write path real profiles use), not a finding about fixture data, so muting it could hide a real write breakage. TODO: include the seed flag in that defect's text so it reads as seed-context, not unexplained. (a) is still open: stop in-app admin notifications for seed jobs in process-scheduled-payouts.
  process-scheduled-payouts.** Q91 routed the Slack pages and defects, but
  the `admin_alert` notifications (pi_not_succeeded, "Scheduled payout
  failed") insert for every admin regardless of `jobs.is_seed`, so an
  `?include_seed=1` run still fills /admin notifications with fixture noise.
  Decide: skip the insert for seed jobs, or tag it. Also: a failed profile
  REPAIR write on a seed profile in subscription-reconciliation still counts
  as a defect (500) — a broken write, deliberately left counted; confirm.
- [ ] **Q225 V-008 (second half) saved-search / job-match notifications go out at funding with no Early Access delay. (Q165 carry-over, 2026-09-23.)** Evidence: supabase/migrations/20260911201653_job_match_notification_preference.sql:159-277 notifies title + budget with no early_access_cutoff(); the public-teaser half is fixed (20260904203654:338). From: docs/archive/launch-2026-09/VERIFIED_REPORT.md. Progress 2026-09-25 (branch v008, not yet on main, NOT verified live): migration 20260925053412 queues each non-digest match until created_at + early_access_delay_minutes(user) (the one tier ladder, shared with early_access_cutoff()) and sends it from the every-minute `saved-search-alert-queue` cron, re-checking job open/funded/visible, user eligible, digest mode and the ST-011 throttle at send time. Guards: src/test/savedSearchAlertsWaitForEarlyAccess.test.ts, src/test/pglite/savedSearchAlertsWaitForEarlyAccess.pglite.mjs. Stays open until verified on prod after deploy (a free test account's alert lands ~20 min after funding). Review follow-up (same branch): the trigger now only queues (it runs inside stripe-webhook's escrow write, so it must take no saved_searches lock that could deadlock with the sweep); only the sweep sends, locking in (user_id, id) order with the job row NOWAIT and a 5s lock_timeout.
- [ ] **Q226 TC-004 remainder: no journey drives admin refunds (Quick Refund / admin_refund_general) or ban enforcement on writes. (Q165 carry-over, 2026-09-23.)** Evidence: grep e2e/ for admin_refund / "Quick Refund" = 0; the ban gate is only unit-tested (src/test/applyErrorCodeCoverage.test.ts). Account deletion is Q70. From: docs/archive/launch-2026-09/VERIFIED_REPORT.md.
- [ ] **Q229 A boot-watchdog failure is invisible unless the same device boots again, yet the screen says "We've logged it". (Q165 carry-over, 2026-09-23.)** Evidence: index.html:407-412 (localStorage only, no beacon), copy at index.html:423. From: docs/archive/prod-monitoring.md.
- [ ] **Q230 notifications.spec.ts says untestable legs are "annotated uncovered", but direct offer, saved-search match, job-match fan-out, tip and cron notifications have neither an annotation nor live coverage. (Q165 carry-over, 2026-09-23.)** Evidence: e2e/journeys/notifications/notifications.spec.ts:39 vs the only uncovered calls at :100/:114/:168/:188. From: docs/archive/notification-inventory.md.
- [ ] **Q233 Admin console mixes seed rows into Subscriptions/Payouts/Disputes/Tiers/Users with no Demo badge; "Payments Collected" counts escrow jobs with no PaymentIntent. (Q165 carry-over, 2026-09-23.)** Evidence: is_seed is read only in AdminAnalytics.tsx and pages/admin/Admin.tsx; src/components/admin/adminAnalyticsHelpers.ts:141. Needs live check: select count(*), sum(budget) from jobs where not is_seed and payment_status in ('escrow','payout_pending','released') and stripe_payment_intent_id is null. From: docs/archive/launch-2026-09/OVERNIGHT-2026-09-07.md.
- [ ] **Q236 Owner decisions never recorded (ask, then record): (a) whole-dollar gross budgets on cards vs cents at checkout; (b) IDV gate only at "Continue to Payment"; (c) keep the cancellation fee on a never-accepted offer while the strike goes; (d) toast titles in Bodoni italic; (e) two page-title sizes; (f) My Posts fifth-tab peek. (Q165 carry-over, 2026-09-23.)** Evidence: src/lib/format.ts:85-100; src/pages/post-job/useJobSubmit.ts:311,337; supabase/migrations/20260914215112 (:226); src/components/ui/sonner.tsx:133; src/components/AuthShell.tsx:288 vs src/index.css:2015. From: docs/archive/launch-2026-09/OVERNIGHT-2026-09-07.md.
- [ ] **Q237 Visual nits that need a screenshot pass: guest filter band header font; /help vs /legal card vocabulary; map pin sheet over MapKit attribution at 375; /browse 1440 empty band with no end-of-list line; attach popover translucency and quick-reply chip clipping; admin "Emails sent 0/3" vs "31 TOTAL"; bulk-approve bar over the last amount at 375; Flagged queue "date passed"; payout-batch Hold. (Q165 carry-over, 2026-09-23.)** Evidence: needs live check: one screenshot per item (recordReview each). From: docs/archive/launch-2026-09/OVERNIGHT-2026-09-07.md.
- [ ] **Q238 Coverage gap: admin views never seen POPULATED (pending credentials, IDV review, exceptions, ban review, fraud flags, support tickets, broadcasts, expired subs) and helper accept-then-cancel (needs a helper fixture with a Stripe payout account). (Q165 carry-over, 2026-09-23.)** Evidence: the report shot these EMPTY only; needs live check with seeded rows. From: docs/archive/launch-2026-09/OVERNIGHT-2026-09-07.md.
- [~] **Q240 Identity-fingerprint backfill never confirmed run. OWNER: run `node scripts/backfill-identity-fingerprints.mjs` with STRIPE_SECRET_KEY set (dry run first, check the three fingerprints differ, then `--apply`). Re-measured 2026-09-25 ~05:30Z: still NOT RUN (3 verified profiles with a session id and identity_sha256 NULL; 0 profiles with a fingerprint). MEASURED 2026-09-23: NOT RUN. 3 of 3 verified profiles with a session id have identity_sha256 NULL (the owner's account and the two shared e2e accounts; sessions from 2026-05-03 and 2026-09-02, all before the 09-08 webhook change); 0 profiles have a fingerprint at all. A migration cannot do it (it needs Stripe's verified_outputs), so the backfill stays the owner's run of the script (STRIPE_SECRET_KEY). CAUTION before --apply: Stripe is in SANDBOX, and test-mode sessions may return synthetic verified_outputs, which could give all three accounts the SAME fingerprint (unmeasured: check with the dry run first). LIVE CHECK: scripts/scoreboard.mjs identityFingerprintRows (FAIL while any verified profile lacks one, UNKNOWN on a failed read); GUARD src/test/identityFingerprintLiveCheck.test.ts (2 @mutate, both red). (Q165 carry-over, 2026-09-23.)** Evidence: needs live check: select count(*) from profiles where idv_status='verified' and idv_session_id is not null and identity_sha256 is null; scripts/backfill-identity-fingerprints.mjs needs STRIPE_SECRET_KEY (owner). From: docs/archive/launch-2026-09/OVERNIGHT-2026-09-07.md.
- [ ] **Q249 MapKit still falls back to the unrestricted build-time token (expires 2027-02-14); the origin-locked token path has never been shown live. (Q165 carry-over, 2026-09-23.)** Evidence: src/hooks/useMapKitJs.ts:295-300; supabase/functions/mapkit-token/index.ts:9,27-33. Needs live check: POST /functions/v1/mapkit-token returns 503 not_configured or 200. Owner sets APPLE_MAPKIT_PRIVATE_KEY/_KEY_ID/_TEAM_ID, then drop the fallback. Q75 covers only the re-mint. From: docs/archive/VISUAL-2026-08-24.md + docs/archive/FABLE-LEAD-2026-08-23.md.
- [ ] **Q252 Dynamic Type and Increase Contrast never captured on the iOS simulator. (Q165 carry-over, 2026-09-23.)** Evidence: needs live check: /posts at content_size accessibility-extra-extra-extra-large vs medium, and increase_contrast enabled (src/lib/accessibility.ts, index.css prefers-contrast: more). From: docs/archive/IOS_COVERAGE.md.
- [ ] **Q253 The no-show journey is declared but never driven on the real backend. (Q165 carry-over, 2026-09-23.)** Evidence: e2e/journeys/scenarios.ts:27 declares "no-show"; e2e/journeys/02-marketplace.spec.ts:231 types outcome as smooth / revision / disputed only. From: docs/archive/03-journeys.md.
- [~] **Q254 No reduced-motion pass has ever run. (Q165 carry-over, 2026-09-23.)** Evidence: no e2e or src/test file references reducedMotion or prefers-reduced-motion. From: docs/archive/FULL-SURFACE-2026-08-31.md. **2026-09-25 (cloud/a11y-q254-q313):** the pass exists, e2e/a11y-prod/reduced-motion.spec.ts: every ANON_SCREENS + AUTHED_SCREENS route at 375 and 1440 with `reducedMotion: "reduce"`, asserting (1) no running CSS animation/transition that is infinite or >20ms, (2) no element whose transform/opacity changes on three samples 300ms apart (framer/WAAPI motion), (3) an injected canary (`animate-spin`, `animate-pulse`, an `::after` loop, an inline infinite animation, an inline transition) computes to ~0 duration and one iteration on that route's real stylesheet; plus a control test with motion allowed that must see the landing chevron bounce (as an animation and as a mover) and all four canary loops. It lives in e2e/a11y-prod/, so a11y-webkit-prod.yml runs it in Chromium AND WebKit. MEASURED locally (Chromium, this commit's build): 35 passed = control + 17 anon routes x 2 widths, 0 offenders; with the catch-all deleted and rebuilt, all 8 routes run failed on the canary (~/.lh-shots/q254/run-catchall-deleted.txt). **No source fix was needed:** src/index.css already has a "GLOBAL REDUCE-MOTION CATCH-ALL" (every element + pseudo, 0.01ms, 1 iteration, `!important`) that the 94 unprefixed `animate-spin`/`animate-pulse` sites in 60 files rely on; nothing pinned it until src/test/reducedMotionCatchAll.test.ts (the rule's selectors and values, and no other `!important` motion value that could out-rank it; red on a raised duration and on a planted `animation: spin 1s infinite !important`). **Why [~]:** the signed-in half (76 tests) and WebKit were NOT run here: this container's test-account env vars are empty and WebKit is not installed. They run on the next a11y-webkit-prod.yml run; tick [x] when that run's reduced-motion tests are green (or fix what it finds).
- [~] **Q256 FIXED 2026-09-24, tick when the first scheduled run (Wed 2026-09-30 05:00Z error sweep) logs phone-dark screens: scheduled ui-sweep runs now resolve VARIANTS to phone-light,phone-dark (push/PR stay phone-light; dispatch input still wins); job timeout 30 -> 60 because the Friday overlay sweep took ~22 min light-only (2026-09-18). Guard src/test/uiSweepScheduledDark.test.ts, shown red on the previous workflow and green on this one. Was: The UI sweep runs phone-light only by default; dark mode is opt-in. (Q165 carry-over, 2026-09-23.)** Evidence: .github/workflows/ui-sweep.yml:203 (|| 'phone-light'); e2e/happy-path/sweepCore.ts:159. From: docs/archive/FULL-SURFACE-2026-08-31.md.
- [ ] **Q258 Signup email latency: the auth hook renders the template twice, then waits for a 5-minute queue drain. (Q165 carry-over, 2026-09-23.)** Evidence: supabase/functions/auth-email-hook/index.ts:211-214; process-email-queue '3-58/5 * * * *' (supabase/migrations/20260831190419_schedule_http_crons_missing_from_migrations.sql:95). Needs live check of cron.job and hook duration. From: docs/archive/FABLE-LEAD-2026-08-23.md.
- [ ] **Q261 "Things need doing twice": the Home filter button does not scroll until clicked out and back. (Q165 carry-over, 2026-09-23.)** Evidence: needs live check: first-interaction repro of /home Filters. From: docs/archive/FABLE-LEAD-2026-08-23.md.
- [ ] **Q265 Bottom-dock clearance is re-implemented per screen instead of owned by AppShell / PageScaffold (the BulkDismissBar part is Q214). (Q165 carry-over, 2026-09-23.)** Evidence: src/pages/jobs/AppliedJobsTab.tsx:287 (negative margin); BrowseMap.tsx:881,899; EmptyState.tsx:116; FormStep.tsx:187; BulkDismissBar.tsx:31; LegalTab.tsx:137; AppShell.tsx:44,120 applies clearance only when scrollable. From: docs/archive/OVERNIGHT-2026-08-18.md + docs/archive/01-screens.md (F-SCR-05).
- [ ] **Q273 EditJobDialog's field column looks clipped at its right edge at 375 after a long value (found by Q100, 2026-09-23).** ~/.lh-shots/q100/edit-job.png (prod, poster-e2e, the Q100 applicant fixture, after the messy-input sweep typed a 200-char word into Job title): the Description, Location, Category and Start time boxes have no right border; they run past the dialog's right edge. Not measured yet (the sweep's overflow check reads documentElement, not the dialog). Measure scrollWidth vs clientWidth of the dialog's scroller at 375 with a long title, then fix or record why it is fine; guard: a dialog-internal overflow assertion in the sweep.
- [~] **Q275 FIXED 2026-09-23 (branch cloud/q275-sentry), re-measure pending (replays resume only when the quota resets). RE-MEASURED 2026-09-25 (queue lane): NOT yet cleared. quota-monitor run 36082385383 (03:20Z): Sentry replays 30d = 58 accepted + 594 dropped by quota, 464 in the last 7 days, newest day with any 2026-09-25, so replays are still being SENT after this fix; the Sentry replay list shows none stored since 2026-09-14T21:16Z (quota refusing). The remaining sender (test profiles in a non-WebDriver browser) is Q379's work; tick this when the quota-monitor replay row's 7-day count reaches 0. MEASURED (Sentry helpr-4m, 30 days): REPLAYS 63, newest 2026-09-14T21:16Z, none since. 39 of 63 carry a Playwright build signature (Chrome/HeadlessChrome 151.0.7922 = Playwright 1.62.1's bundled Chromium 151.0.7922.34; Mobile Safari 16.0 / 26.5 = its iPhone descriptors); by user: 45 shared test accounts, 7 owner, 11 anonymous (3 HeadlessChrome); 24 of 63 had 0 errors (session sample), 39 were on-error. ERRORS 265 (quota monitor: 265 accepted, 5.3% of the assumed 5,000): by UA only 9 HeadlessChrome, by Playwright build signature 93 (35%), by user 140 test accounts (53%), 113 owner, 12 anonymous. So automation was MOST of the replays, not most errors. CHANGE: src/lib/sentry.ts isAutomatedBrowser() (navigator.webdriver): both replay sample rates 0 and Replay never registered; errors still report, tagged automated=true/false so the share is exact from now on. Quota monitor: new row sentry.replays_30d (stats_v2 category=replay, accepted + rate_limited vs 50/month ASSUMED Developer), so a quota already refusing replays reads OVER. GUARDS: src/lib/sentry.test.ts "Session Replay in automated browsers (Q275)" (3 @mutate, all red) + src/test/quotaMonitor.test.ts "replays dropped by the Sentry quota" (2 @mutate, red). NOT covered: test-account sessions driven by a browser that is not WebDriver (e.g. Claude in Chrome: the Chrome 152.0.0 / Chrome Mobile 148.0.0 replays on e2e accounts) still record; re-measure the test-account share after the quota resets and decide then. Was:** Sentry replay quota exhausted; automated browsers may be spending Sentry quotas (seen 2026-09-23). Sentry shows "Replay Quota Exceeded: monitoring and new data are paused until your quota resets" (banner on helpr-4m, 2026-09-23 ~17:35Z). src/lib/sentry.ts initialises Sentry with replaysSessionSampleRate 0.1 / replaysOnErrorSampleRate 1.0 in every PROD build and never checks navigator.webdriver, so CI Playwright sweeps (press-every-control, prod-audit, journeys, a11y, canary) running PROD builds may be recording replays and errors. UNMEASURED: first measure what share of replays/errors in the last 30 days came from HeadlessChrome/automation user agents. If most: skip Sentry (or at least replay) when navigator.webdriver is true, with a guard proven red; if not: lower the session sample rate. Either way the quota monitor (Q63) should also read the replay quota.
  2026-09-24 re-measure: Sentry replays in the last 7d = 0 (search_events replays); quota ledger item still 652 of 50 over 30 days (rolling window), so replays stay quota-blocked and the Playwright filter cannot be observed yet. Re-check when the 30-day window drops below 50.
- [ ] **Q277 15 inline literal-white surfaces are unjudged in dark theme (found by Q179, 2026-09-23).** Ratcheted exactly by src/test/noLiteralWhiteSurfaces.test.ts: Footer 1, PhotoProof 2, PhotoLightbox 5, ShareJobButton 1, MaterialsPanel 1, ScheduleTab 2, TwoFactorCard 1, HelprWrapped 1 (skeleton), CheckoutStepIndicator 1. The lightbox ones sit over photos and are probably right; each of the others needs a dark-theme screenshot and, where it reads as a pale grey block, the surface's own token (hsl(var(--card) / a)) as Q179 did for the Reviews sort chip. Lower the baseline in the same commit.
- [~] **Q280 Q179's interactive half: press every control + core journeys, and open every dialog/sheet (found by Q179, 2026-09-23).** The Q179 lane walked and judged every route visually (read-only); it did not run npm run audit:press or the two-account journeys, and did not open control-triggered dialogs/sheets. Run both on prod with the shared accounts, look at the failures plus a sample, record reviews, fix at the shared layer with guards. Also not covered: iOS sim / WebKit A/B of the Q179 fixes.
  PROGRESS 2026-09-23 (7d12daebf): both e2e-journeys run 35905284660 failures were test defects, fixed: time-travel:115 (shared poster left 'Available now' by a press run; spec now clears it) and 03-account:74 WebKit (navigated while the favorite_helpers POST was held). Guards: src/test/journeySharedAccountStateIsWritten.test.ts and the held-write tracker in e2e/journeys/fixtures.ts (proven red in WebKit). Local passes only; CI journeys not re-run. Press half waits on the Q317 pools; Q294 fixed its /jobs/:id row. Spawned Q325, Q326.
- [ ] **Q286 Q199 follow-ups outside chunkReload.ts (found 2026-09-23, left for a components pass).** (a) The page-level ErrorBoundary (src/components/ErrorBoundary.tsx) and SectionBoundary have no quiet state: since Q199, recoverFromChunkError() returns true while a retry WAITS (up to 40s), and those two skip the report but still render their error card for that wait. RouteErrorBoundary (every lazy route) is quiet and is what the Q199 spec drives; a chunk failing inside a section or above the routes is not. Give both the RouteErrorBoundary quiet state when recoverFromChunkError() is true or isRecoveryReloadInFlight(). (b) Stale comments still say "one-shot" reload: src/main.tsx:64, SectionBoundary.tsx:65, ErrorBoundary.tsx:54 ("at most two"). Guard: extend e2e/happy-path/deploy-stale-chunk.spec.ts with a section-level lazy chunk.
- [ ] **Q289 App Store / Play reviews that report a bug reach nobody (found by Q64, 2026-09-23).** Q64's text names App Store reviews, but no source ingests them: apple-app-store-notifications handles subscription server notifications only, and nothing reads the App Store Connect customer-reviews API or Play's reviews API. Build: a scheduled pull of new reviews (App Store Connect API key is an OWNER credential) that records rating <= 3 reviews as `user-report` ledger items (source app-store-review, verify manual). Guard when built: add the ingester to src/test/userReportsReachTheLedger.test.ts SURFACES.
- [~] **Q290 "Download My Data" omits most of what an account holds (found by Q70, 2026-09-23).** MERGED 2026-09-26 (PR #1812, 9f2021865): the card now calls a new edge function export-my-data, which runs the new SECURITY DEFINER RPC export_my_data() (migration 20260925232153) as the caller and adds 7-day signed links to the person's files (identity buckets under <uid>/ plus the attachments on their exported messages). 61 table sections + exported_at/user_id/email + storage_objects; KNOWN_NOT_EXPORTED is now []. PGlite: applied 3x, 13 assertions (own rows only, staff ids / push token / claim_token / flag_reason stripped, hidden received messages excluded, anon refused). GUARD: src/test/dataExportCoversEveryUserTable.test.ts (every person column from the generated types + migration FKs is exported-by or EXEMPT, two-way; sections scoped to the caller; 10/10 @mutate red; a planted owner_id column goes red). OPEN before [x]: (1) merge, then db-deploy + functions-deploy green and a live export by a test account (the privacy-journey run checks KNOWN_NOT_EXPORTED exactly); (2) DECIDED (owner, 2026-09-26, "export them too"): admin_user_notes, fraud_flags and helper_shadowbans are exported (migration 20260926034548, staff ids stripped; PGlite 19/19); (3) job media (job-photos/proof-photos URLs on job rows) is exported as the stored URL, not re-signed. lh-authz-rls REVIEW ONLY (2026-09-25): H1 reviews-before-reveal and H2 jobs rows wider than user_may_see_job_address FIXED on the branch (guard asserts both; PGlite 15/15); M3 chat attachments now signed with the user's JWT and decoded `..` refused; L4 (Q408) and L5 (Q409) fixed in PR #1818. Original report:  src/pages/info/legal/DataExportCard.tsx exports profile, jobs, applications and reviews only; the card's copy calls it "a complete copy". Not exported (read from purge_user_data's own table list): messages, notifications, notification_preferences, reports filed, saved searches, saved jobs, favorite helpers, helper availability, legal acceptances, referral rows, payout rows, login history, and storage objects (avatar, documents). GDPR Art. 20 / CCPA need the data the person provided. Build the export server-side (one edge function reading every table purge_user_data touches), then shrink KNOWN_NOT_EXPORTED in scripts/lib/privacyJourney.mjs to []. Guard: src/test/privacyJourneyCoversPurge.test.ts (export sections two-way) + the monthly journey's exact KNOWN_NOT_EXPORTED check.
- [~] **Q294 /jobs/:id "Done — <date>" timeline buttons NOT CLICKABLE (press run 35837735324, customer, 3 rows: Sep 22 3:56 PM, Sep 12 7:38 PM, Sep 9 12:23 PM; found by Q128).** 16s timeout on `…div:nth-of-type(8) > button` inside a long job-history list (div 20/31/33). The log's 600-char slice cut off Playwright's reason; since Q128 the press log leads with it ("covered by …", "not visible", …). Re-dispatch press and read that reason, then fix the app or the harness. Guard to name when fixed: the press run's /jobs/:id customer row with 0 NOT CLICKABLE. ROOT-CAUSED 2026-09-26 from press run 36208184593 (branch cloud/nightly-1582-press, shard 2): the reason is "still moving (not stable)" on six "Done — <date>" dots; on a completed job the Done dot is the rail's current step and wore step-current-pulse, an infinite scale animation, so a finished job pulsed as live forever. FIXED on that branch: railStepPulses (jobRailTone.ts) gives no pulse once the rail reached Done (GUARD src/test/finishedJobDoesNotPulse.test.ts, 2 @mutate killed). Tick when a press run's /jobs/:id customer row shows 0 NOT CLICKABLE.
  FIXED 2026-09-23: run 35905268411 gave the reason (covered by JobDetailDialog's open backdrop: /jobs/:id renders the dialog open at load, and the page pass pressed the page behind it, found=16 pressed=0 fail=9). press-every-control.mjs ENUMERATE now scopes the page pass to a modal already open at load. Guard: src/test/pressScopesToLoadModal.test.ts (runs the harness's ENUMERATE in jsdom; red on the pre-fix harness; @mutate killed). PENDING: the /jobs/:id customer row with 0 NOT CLICKABLE on the next press run, which waits on the Q317 pool sizes.
- [ ] **Q295 /admin?view=credentials "Open" scored "no observable change (focus moved, nothing else)" (press run 35837735324, found by Q128).** SignedOpenLink (AdminCredentialQueue.tsx) awaits createSignedUrl and then `window.open(…, "_blank", "noopener")`; the press listens for new pages on the context, so either the popup landed after the after-snapshot, the click lost user activation across the await, or the signed URL failed without a toast. Not measured (needs a live admin session). Guard to name when fixed: the press run's credentials row green, or a unit test on SignedOpenLink's outcome.
- [~] **Q296 FIXED 2026-09-24, tick when the next press-every-control run logs 0 Sentry 429s / 0 envelope requests from 127.0.0.1: beforeSend now drops a prod build served over http on a loopback host (isLocalBuildHost, src/lib/sentry.ts); the old check matched only hostname 'localhost', so the press's 127.0.0.1 traffic went to prod Sentry, and .github/actions/local-preview's comment claiming no Sentry was false (Sentry has a built-in DSN fallback; comment corrected). Guard: src/lib/sentry.test.ts 'isLocalBuildHost (Q296)'. Was: The press sweep's own Sentry events are rate-limited by Sentry (429 on envelope/, 6 presses in run 35837735324; found by Q128).** The press builds the app with the prod VITE_* env, so every sweep error reaches the PROD Sentry project and spends its quota until Sentry answers 429 — which also means a real user's event could be dropped in that window. Now listed in coverage.md ("Request failures that are not the app's", telemetry count, ::warning), no longer counted against the control. Decide: tag or drop sweep events (environment "press"/beforeSend on a test flag), or route them to a separate project. Guard to name when fixed: a test that the press build's Sentry env is not production.
- [ ] **Q298 Harden the Q94 route-probe close rule (lh-authz-rls review of 8e686d57c, 2026-09-23; review verdict PASS).** (a) ops_alert_condition: a user-error-screen item with no screen maps to ops_route_key(null/'') = '/', so any press pass on / would close it, contradicting its own comment; add `IF nullif(p_sample_ref->>'screen','') IS NULL THEN RETURN true; END IF;` before the probe check (0 such open items today). (b) record_route_probe_passes: bound p_routes (cardinality <= 1000, left(r,512)). Restate from the newest body (20260923182022), PGlite red on a screenless item closing via /. Guard: extend src/test/routeProbeCloseRule.test.ts.
- [ ] **Q307 Notification templates check WHO sends, not WHETHER the event happened (Q223 follow-on, 2026-09-23).** Only revision_requested, application_declined and no_show_reported read the database to prove their event (a job_revisions row, a rejected application, a no_show strike). The other nine are gated to the right side of the job but not to its state: the assigned Helpr can send "Dispute withdrawn" on a job with no dispute, and the poster can send "Dispute resolved ✓ … Payment will be released" (type payment) before resolving. The words are all server-built and true-shaped, so the harm is a misleading notice about the sender's own job, not a phishing primitive. Fix: a state predicate per template in supabase/functions/_shared/notification-templates.ts (dispute_status, arrival / working stamps, poster/helper confirmation stamps), or move each notice into the RPC that performs the transition. Guard: extend src/test/edge/create-notification.test.ts with one "state not reached → 409" case per template.
- [ ] **Q436 At 1440 the Activity bulk bar is not centred on the column left of the rail (before and after Q214).** Noticed by the Q303 lane (2026-09-23), carried out of Q313 so it has its own line. Not looked at on 2026-09-25.
- [ ] **Q429 The modal "no scale under Reduce Motion" block in src/index.css is a no-op, and its comment is false (noticed 2026-09-25, Q254 lane; NOT changed).** It pins `--tw-enter-scale` etc. so that "the modal still fades in and out" under Reduce Motion, but the GLOBAL REDUCE-MOTION CATCH-ALL (same media query, `*`, `animation-duration: 0.01ms !important`) out-ranks the dialog's `duration-300`, so under Reduce Motion the modal appears with no fade at all. Design call for the owner: keep instant modals (delete the block, fix the comment) or restore a short opacity fade for `[role=dialog]`/`[role=alertdialog]` (and the overlay) with an explicit `!important` exception.
- [ ] **Q437 e2e/prod-audit/shell-spacing.spec.ts is red before any mutation in the Vacuity gate, on unrelated PRs (noticed 2026-09-26, Q254/Q313 lane; NOT diagnosed).** "Guards shown able to fail" reports it `inconclusive … guard is RED before any mutation` on PR #1814 twice (runs 36202881153 and 36206269944, triggered via src/index.css) and on PR #1809 (run 36202845459, triggered via src/pages/info/Legal.tsx). The two diffs share nothing, so the spec is red on its own. It passed in the last prod-audit nightly (36069316906, on older main). The failing assertion is unknown: scripts/vacuity/run.mjs keeps only the last 3000 chars of a spec's output, and on a Playwright spec those are `[WebServer]` build warnings, so the inconclusive line never shows why. Two things to do: (1) run the spec with the test accounts and fix what it finds; (2) the runner half (the inconclusive line shows only `[WebServer]` noise) is the same defect as Q432 and is tracked there. 2026-09-26: the guest half passes locally on a fresh build of main (17 guest screens hold 12/12 at phones and 24 at 1440; 32 section stacks, 0 wrong), so the failure is in the signed-in half; a grep-scoped prod-audit dispatch on main is queued to read it.
- [ ] **Q321 Applicant row review count disagrees with the reviews table (owed-shots lane, 2026-09-23; unmeasured cause).** The header shows Hallie "5.0 (20)" while public.reviews holds 26 of her reviews. Find which rows the header counts (maybe only helper-side, or those past the blind period) and whether the label says so.
- [ ] **Q322 The prod-load schedule is fully booked under the worst-case model (Q318 lane, 2026-09-23).** Every prod-load fire must be at :17, so rule 3 allows 12 a day and 84 a week, and all 84 are used. Any new schedule or raised timeout fails rule 5. Cheapest room: prod-audit timeout 300 min (measured max 52) and vacuity 300 min (measured max 27). Also measured: GitHub creates scheduled runs about 5h after their cron time, consistently.
- [ ] **Q325 press-every-control wipes the shared accounts' weekly availability grid (found by the Q280 agent, 2026-09-23).** CLEANUP_TABLES in scripts/audit/press-every-control.mjs has ["helper_availability","helper_id"] and deletes rows created since the run began; a save replaces the whole week, so cleanup deletes the entire grid (DELETEs at 21:07Z from run 35905268411, per the agent; not re-measured by me). Suspected too, not verified: press leaves `profiles.available_until` set (a set_available_now at 05:34Z came from cancelled press run 35822080143). Fix: snapshot and restore the week (and available_until) instead of deleting new rows. Guard to name when fixed: a test that press's cleanup restores helper_availability to its pre-run rows.
- [ ] **Q326 e2e-journeys and press-every-control can run at once on the same shared accounts (found by the Q280 agent, 2026-09-23).** e2e-journeys' dispatch concurrency group is per-run (`e2e-journeys-{run_id}`), so a dispatched journey overlaps a press run and each mutates state the other asserts. Fix: a shared lock (group) for every workflow that drives the shared test accounts, dispatch included. Guard to name when fixed: a test over .github/workflows that every shared-account workflow joins the same group on every trigger.
- [ ] **Q327 A ban never settles the banned user's live jobs (found by the Q301 lh-money-escrow review, 2026-09-23).** admin-user-actions/index.ts:563 cancels only pending applications, and no public SQL function that reads ban_status cancels or refunds a job (pg_proc source search, per the reviewer). A counterparty can be left on an accepted job with a banned user. Live exposure measured by the reviewer: 0 live jobs with a banned party. Decide what a ban does to live jobs (cancel with refund, or hand to admin) and add it to the ban path. Guard to name when fixed: a PGlite case where banning a user with an accepted job leaves that job settled.
- [ ] **Q330 Per-screen repeats of account-level reads (2026-09-23, from Q104 run 35932913760).** Per journeys leg: `user_blocks` via getBlockedUserIds 59, `profiles select=*` 49, `user_roles` admin check (useCurrentUser.ts:207) 49, `profiles terms_version_accepted` 49; `/auth/v1/user` up to 212 per press shard (earlier runs). Share one cached query per account; lower the request budgets in the same commit.
- [ ] **Q331 18 public tables keyed by user_id have no foreign key (found by Q282, 2026-09-24).** Measured live 2026-09-24 (pg_constraint), and derived identically from migrations by src/test/userIdForeignKeys.test.ts (KNOWN_NO_FK, exact). purge_user_data DELETES 12 of them (admin_user_notes, broadcast_dismissals, email_tracking, fraud_flags, job_checkins, login_history, notification_logs, push_tokens, referral_credits, saved_jobs, saved_searches, user_violations) and ANONYMISES 4 with nullable user_id (analytics_events, error_logs, legal_acceptances, referral_codes), so any deletion that skips purge orphans them, as it did notification_preferences. notification_dedupe_suppressions is not touched by purge at all (a purge gap); user_bans needs a retention decision (a ban may need to outlive the account). Fix: per table, orphan count, then FK CASCADE / SET NULL matching purge, checking each table's DELETE/UPDATE triggers in service context; remove each from KNOWN_NO_FK in the same commit.
- [ ] **Q332 Offline cold /browse says "Showing the last data we have" over bare skeletons (slow-network browse·drop screenshot, run 35940421547, 2026-09-24).** With no cached data the banner promises data that is not there, and the list shows loading skeletons. Not yet measured: whether the skeletons stay up indefinitely offline. Fix: a designed offline-and-nothing-cached state (lh-audit §3 offline), copy that matches it. Guard to name when fixed: browse·drop asserts no skeleton after N s offline with an empty cache.
- [ ] **Q333 A stale `?jobId=&userId=<deleted id>` message link opens an empty sendable thread (Q262 review, 2026-09-24).** useMessagesData deep-link path + buildDeepLinkPlaceholder (loadConversations.ts): the profile is gone but the job exists, so a placeholder "Say hello" thread opens with a live composer addressed to a deleted id; the send then fails as retryable/"restricted", never saying the account was deleted. Fix: no profile + job exists -> open that job's otherUserId === null thread, else the deleted-account notice. Guard to name when fixed: a messagesReceiverNullable case asserting the deep-link fallback routes a missing profile to the deleted-account thread.
- [ ] **Q334 A thread already open when the other party deletes stays sendable (Q262 review, 2026-09-24).** The SET NULL reaches the open thread via realtime UPDATE but activeConvo.otherUserId keeps the old id, so the composer stays live and the next send shows the retry/"restricted" copy. Fix: on a refused send, a profiles lookup that finds nobody flips otherUserId to null (read-only notice). Guard to name when fixed: a sendHandlers test where the refusal + missing profile yields otherUserId null.
- [ ] **Q335 Deleted-account threads merge per job and can never be hidden; thread_pins/mutes/archives keep rows for deleted users (Q262, 2026-09-24).** Every deleted counterparty on one job groups into one "Deleted account" thread (key `${job}_deleted-account`), and archive/pin/mute need a non-null other_user_id (NOT NULL, no FK), so the thread stays in the inbox forever and those tables orphan rows (not yet counted live). Needs an owner call on hiding (e.g. archive keyed by job for a null party) plus FKs ON DELETE CASCADE on the three thread_* tables. Guard to name when fixed: userIdForeignKeys-style FK check for thread_* other_user_id.
  FIXED (main.tsx boot imports via backgroundImport; guard src/test/bootImportsAreBackground.test.ts, red on pre-fix, 4/4 mutants killed). Repro ~/.lh-shots/q328-repro2.mjs: pre-fix 2/2 hard-reload + field wiped, fixed 2/2 + 3/3 no reload. Residual, stated: after an offline first interaction the sign-out teardown BACKSTOP stays unregistered for that document (failed module cached; retry measured useless); the deterministic signOutWithPushCleanup path is unaffected and the failure is logged to error_logs. Pending: slow-network message·drop green live
- [ ] **Q337 A helper-wins $0-closed dispute job shows status 'completed' beside a "Cancelled" payment badge (Q235 review LOW, 2026-09-24).** Evidence: src/lib/statusLabels.ts:118 maps payment_status 'cancelled' to "Cancelled" regardless of job status. Needs a screenshot on a seeded job, then copy for "closed with no payment".
- [~] **Q340 messages: anon + authenticated hold column-level INSERT on every messages column; only RLS keeps anon out (lh-authz-rls follow-up from Q262, predates it).** Revoke the column grants FROM PUBLIC, anon and restate authenticated to the columns the client writes; verify in information_schema.column_privileges. **Anon half FIXED 2026-09-25, not yet live:** migration 20260925144708 revokes INSERT, UPDATE, DELETE on public.messages FROM PUBLIC, anon (a table-level REVOKE also drops the column grants; PGlite 3x: anon INSERT/column INSERT/UPDATE/DELETE false, authenticated INSERT/DELETE still true). GUARD: scripts/ci/sensitive-anon-grants.sql's WRITE rule now scopes messages (run live after every db-deploy and nightly by scripts/check-anon-table-grants.mjs), and src/test/anonGrantsClassCheck.test.ts pins the scope and the migration (2 new @mutate lines, both shown red). OPEN: restating authenticated to the 10 columns src/pages/messages/messagesData/sendHandlers.ts inserts (client_id, job_id, sender_id, receiver_id, content, attachment_url/mime/size/duration, reply_to_id) waits on the installed native build's insert payload (Q387: an older build is still in use), so narrowing it now could break sends from that build. To verify on prod after deploy: has_table_privilege('anon','public.messages','INSERT') and has_any_column_privilege('anon','public.messages','INSERT') both false; has_table_privilege('authenticated','public.messages','INSERT') true.
- [ ] **Q342 A lost Stripe chargeback on a decided-but-unexecuted dispute leaves the dispute pending forever (lh-money-escrow review of Q231, 2026-09-24).** chargeDisputeCreated.ts:192-230 flips payment_status escrow->chargeback. execute-dispute-split refuses a chargeback job (index.ts ~80, ~290), supersede and retry also refuse, so the dispute sits decided/execution_status='pending' with no terminal state and keeps paging the unsettled detector. Live today: 0 such rows. Needs: a terminal 'executed via chargeback' close (or have chargeDisputeClosed lost mark the dispute), with a guard derived from the chargeback webhook handlers. Money lane: opus plus lh-money-escrow review.
- [ ] **Q343 checkoutSessionCompleted `repay=true` branch looks unreachable; separately, chargeRefunded sets payment_status='refunded' matched on id only (lh-money-escrow review of Q231, 2026-09-24). REPORT, not verified live.** supabase/functions/stripe-webhook/checkoutSessionCompleted.ts:803-812,897-900 (nothing found that creates a repay=true session: count the call sites before removing it); chargeRefunded.ts:71-74 has no compare-and-set on the prior status (safe today because the payers are guarded, see Q231). Also chargeDisputeClosed.ts:325-337 can put a decided job back to payout_pending; safe because payers check unsettled disputes.
- [ ] **Q344 A decided dispute shows 'Dispute resolved' / completed to both parties before any money moves (Q231 follow-on, 2026-09-24).** rpc_decide_dispute sets jobs.status and dispute_status='resolved' and notifies 'Dispute resolved' in the decision transaction; execute-dispute-split moves the money later. Money is safe (Q231 guard). The status and copy claim a settlement that has not happened yet, and the comment at supabase/functions/execute-dispute-split/index.ts:962 says the opposite. Fix: copy that says 'decided, payment processing' until execution_status='executed', or the trigger design in Q231's LIVE note. Needs a trust/copy decision and lh-money-escrow review if status semantics change.
- [ ] **Q348 any signed-in user can call are_users_blocked(x, y) for two third parties (low; Q345 item 5).** proacl grants authenticated; it cannot simply be revoked because three RLS policies call it as the invoking role (applications "Helpers can create applications", applications "Job owners can view applications for their jobs", jobs "Customers can create jobs"; pg_policies 2026-09-24), plus enforce_block_on_message_insert / enforce_application_job_state / can_send_message_to_in_job. The client wrapper src/lib/userBlocks.ts areUsersBlocked has 0 callers (grep src + supabase/functions). Fix direction: inside the function, answer only when auth.uid() is one of the pair or is_server_context() (else false/raise), after proving every caller passes the caller as one argument; or drop the dead wrapper. Guard to name when fixed: are_users_blocked refuses a third-party pair (PGlite).

- [ ] **Q349 One real account's avatar object is stored `Cache-Control: no-cache` and nothing I read wrote it (2026-09-24, Q329 remainder).** storage.objects avatars/7f65ef12-…/avatar.jpg (real, non-seed, not the owner; signed up 2026-05-03), written 2026-09-20 21:52Z with owner_id NULL (service-role). complete-signup is the only edge uploader and runs at signup, not months later; scripts/audit/prod-seed.mjs touches only the helper test account. Find the writer (storage API logs for that minute), then decide with the owner whether to rewrite the object's metadata. Not touched: real user data.
- [~] **Q355 PARTLY DONE 2026-09-25 (branch cloud/q355-ledger-admin-queue-close, migration 20260925155922): every admin-QUEUE post now closes itself; admin posts that name no queue still cannot.** Done: ops_alert_condition gains an 'ops-alert:custom' branch (restated verbatim from 20260923215732) that reads the post's title and link from the mirror's oncePerDayKey (or, for a re-pointed item, sample_ref admin_title/admin_link) and re-asks the queue it was about: Ban review needed (user_violations pending_ban_review), Identity verification needs review (profiles.idv_status manual_review; for the named person also 'failed' until an admin decision in admin_audit_log), User flagged — 3+ reports (open reports on the person or their application), Dispute escalated / Escalated dispute overdue / Dispute stuck (the /admin?view=disputes queue: a job still 'disputed', or a decided dispute not yet executed), Dispute split did not settle (decided, execution NULL or not 'executed'), Job stalled (job_completion_nudges escalated, unresolved), Stuck payment (the detect_stuck_payments branch). Still failing while the named subject OR any real (non-seed) subject has a to-do in that queue, because the ledger keeps one item per title. Existing 'companions' items with those titles re-pointed. GUARDS: src/test/adminQueueAlertsClose.test.ts (two-way inventory: every admin fan-out title in the SQL effective definitions and edge functions, 8 + 19 on 2026-09-25, has exactly one close rule or a stated not-a-queue exemption; 6 @mutate, each shown red) and src/test/pglite/adminQueueAlertsClose.pglite.mjs (ALL PASS, 62 checks; 44 FAIL with NEW_MIGRATION=skip; a ban-review item stays open while pending_ban_review and closes once it leaves it). No credential-review or verification-exception fan-out to admins exists in the source (checked 2026-09-25), so none was added. OPEN: (1) admin posts that name NO queue still keep 'companions' and cannot close themselves: Payout blocked — (x3), Scheduled payout failed, Transfer failed, Cancellation fee transfer failed, Arrival not confirmed in 24h, Arrival near a wrong pin not confirmed, Repeat offender, Auto-restricted (7d/30d), Low rating alert, New member joined, Dispute auto-resolved (the test's EXEMPT_NOT_A_QUEUE lists each with its reason); they need a close rule of their own or an owner decision that they are notices. (2) 'Low rating alert' links /admin?view=fraud, which reads fraud_flags, but apply_low_rating_flag writes user_violations, so that link opens a screen that does not show the flag (read from the migrations' effective definitions, not checked live). (3) after db-deploy, verify live (queries in the PR). Was:** Admin-notification Slack items (verify kind 'companions') can never close themselves (ops alert ledger, 2026-09-24). "ban review needed" (1d617a04, x3 from 2026-09-22 16:35Z) stayed open 36h. Its only error_logs rows are source ops-alert, and the companions rule in ops_alert_verify() (20260924005818) excludes that source, so v_comp = 0 and it never closes. The real question was answerable: user_violations with action_taken = 'pending_ban_review' = 0 rows (04:41Z; the subject was a deleted strike-probe fixture). Closed by hand with that evidence. Fix: give 'Ban review needed' (and the other admin-queue posts) a sql_condition that re-asks its queue, e.g. pending_ban_review rows for the named user. Guard to name when fixed: a PGlite case where a ban-review item closes once its violation leaves pending_ban_review and stays open while it is pending.
- [ ] **Q359 Google sign-in into an existing email account has never run (OA-018, measured 2026-09-24: 0 prod users with more than one identity; Google has produced 0 identities).** Needs a real Google account: sign up with email, sign out, then "Continue with Google" with the same address, and confirm it lands in the same account (same user id, jobs intact). Owner device step, or add a Google test account to the e2e secrets.
- [ ] **Q360 A charged-back or failed-payment job still looks healthy on both parties' job cards (ME-009 remainder, 2026-09-24).** The Helpr is now told by notification (933babe5e), but AppliedJobCard/PostedJobCard steps key on `jobs.status`, not `payment_status`, so a `chargeback`/`failed` job renders like an escrowed one, and ApplyEarningsBreakdown still says "Held securely". Needs a status line on the card for those payment states, screenshots at 375/1440 before and after, and a guard that every non-admin card maps chargeback/failed to visible copy.
- [~] **Q362** (HIGH, money, owner MQ11 2026-09-24; ME-006, CC-003): the poster pays the card fee ON TOP of a tip so the Helpr gets 100%; tip minimum rises to $3. The urgent bonus (CC-003) gets the same treatment. **TIP FEE DONE on branch me006 2026-09-25 (not yet merged):** `supabase/functions/_shared/tipFees.ts` `tipChargeBreakdown` is the one definition; create-payment (tip) and auto-tip-charge charge tip + fee with application_fee_amount = fee, so the destination transfer is exactly the tip; TipDialog, CompletionPrompts and AutoTip quote from the same module; Terms copy says the tipper pays the card fee. Guard src/test/tipFeesOneDefinition.test.ts (3 @mutate), red on the pre-fix code (9 failures). STILL TO DO: (1) the $3 tip minimum (create-payment TIP_MIN_CENTS, TipDialog and CompletionPrompts bounds, AutoTip LIMITS.fixed.min, `profiles_auto_tip_valid`); (2) CC-003 urgent bonus; (3) after deploy, one Stripe TEST-mode tip on a test-owned completed job showing charge = tip + fee and the transfer = tip; (4) an lh-money-escrow REVIEW-ONLY pass by a second model.
- [ ] **Q371** (LOW, owner MQ27 2026-09-24): landing CLS 0.0315 on Linux CI (limit 0.02). Change only how the hero font LOADS (preload or size-matched fallback); font, colour and copy stay LOCKED. Needs before/after screenshots.
- [ ] **Q373** (MEDIUM, owner MQ25 2026-09-24; SC-015): archive the Crew/Team/Enterprise products and prices in LIVE Stripe via the API, then read them back.
- [ ] **Q374** (LAUNCH CHECKLIST, owner MQ21/24 2026-09-24, "you decide"): before launch, the owner's CPA answers (1) whether to add a Louisiana registration in Stripe Tax, (2) which job categories are taxable, and (3) whether the service fee is taxable. No code change until then.
- [ ] **Q375** (OWNER TO-DO, MQ26 2026-09-24): the owner makes a fresh Sign in with Apple web secret (tools/apple-jwt.html + the .p8) and pastes it into Supabase > Auth > Apple; the lead records today + 6 months for the expiry monitor. VERCEL_TOKEN expiry is still unknown.
- [~] **Q378** (alert, nightly-red #1783 privacy-journey + #1772 schedule-heartbeat, 2026-09-24; FENCED: e2e/ is the lead's during the route rename): e2e/privacy/privacy-requests.spec.ts seeds its disposable account with the literal `terms_version_accepted: "Jun 2026"` (lines 202 and 429); since the terms bump to "Sep 2026" the app shows the "Please Take a Moment to Re-Agree" dialog and "Download My Data" is never reachable (run 36066796503, screenshot ~/.lh-shots/alerts-0924/privacy/). schedule-heartbeat is red only because no privacy-journey run has gone green since the month marker was added (Q293, 09-23 21:38Z; the one green run was 19:10Z), so the privacy-journey-marker issue does not exist. Fix: import LATEST_TERMS_VERSION from src/lib/consent.ts in the spec (e2e/happy-path/fixtures.ts already does), dispatch privacy-journey, then schedule-heartbeat. GUARD to add: no literal terms version in e2e/ or scripts/ seeders (scripts/audit/prod-seed.mjs:267 and scripts/create-app-review-demo-account.mjs:174 also hard-code "Sep 2026" and will break at the next bump). The run also reported "privacy: perTest 15 is under half its budget 40.5", which is from the truncated run, not a real budget change. FIXED 2026-09-24: the spec imports LATEST_TERMS_VERSION; prod-seed.mjs and create-app-review-demo-account.mjs use latestConsentVersions(). GUARD: src/test/noLiteralConsentVersionInSeeders.test.ts (no literal terms_/privacy_version_accepted in e2e/ or scripts/; @mutate proven). PENDING: privacy-journey green, then schedule-heartbeat, closes #1783 and #1772. RE-RUN 2026-09-25 (36092612315) got past the terms dialog and failed EARLIER on a second, independent cause: creating the disposable account returned 422 weak_password. The spec password was randomBytes(24).toString("base64url"), which has no symbol about a third of the time (the 09-23 green was luck). FIXED 2026-09-25: src/test/strongTestPassword.ts always carries lower, upper, digit and symbol; the spec uses it. GUARD: src/test/testPasswordsMeetAuthPolicy.test.ts (2000 samples meet the policy; no e2e/ or scripts/ password from raw randomness; red on the old spec; @mutate proven).
- [~] **Q379** (alert, ledger 79f3fe46 + 5b2db99a quota-monitor, 2026-09-24): Sentry replays read 652 of 50/month (62 accepted, 590 dropped by quota). SOURCE ALREADY FIXED by Q275 (b59b7445d, 2026-09-23: no replays from a navigator.webdriver browser). Measured by quota-monitor run 36067912937 with the per-day split added in 26a2ac24d: last 7 days 470, newest day with any replay 2026-09-23, none on 2026-09-24. The alert stays red until the 09-17..09-23 drops leave the trailing 30-day window (about 2026-10-23), because the monitor reads a trailing 30 days while the quota is per billing month. Open: (a) read Sentry's billing-period usage instead of a trailing window (needs the plan's reset day), and (b) Playwright-over-CDP attached to a normally launched Chrome (the two-account harness, claude-in-chrome) reports webdriver=false and would still record; stop replay when the signed-in profile is_seed. No guard yet.
  2026-09-25 (ledger lane): (a) DONE: the replay row now counts from the Sentry usage-period start (GET /api/0/customers/{org}/ onDemandPeriodStart, the record sentry.io's usage page reads) and names its window; an unreadable period falls back to the trailing 30 days, labelled with why, never a red run. That route is not in Sentry's public API reference and no Sentry token is available locally, so whether the read token gets a 200 is UNVERIFIED until the next quota-monitor run: its Window column says which one it used. Guard: src/test/quotaMonitor.test.ts "replays are counted over the Sentry usage period..." (both @mutate red). (b) DONE: a signed-in is_seed profile records no replay (registration skipped; a running replay is stopped without flushing its pending segment); errors still report. src/lib/replayTestProfile.ts, wired in src/main.tsx at both setSentryUser calls. Guards: src/lib/replayTestProfile.test.ts (incl. the main.tsx wiring) and src/lib/sentry.test.ts "Session Replay for a test profile (Q379)" (all @mutate red). CORRECTION to the text above: replays are STILL arriving. Run 36082385383 (2026-09-25 03:20Z): 652 (58 accepted, 594 dropped), last 7 days 464, newest day with any 2026-09-25. Sentry's replay search shows no accepted replay after 2026-09-14, so the senders are invisible (dropped replays are not stored). Which clients send them is NOT measured; see Q382. Ledger 5b2db99a stays open (its detector still fires); 79f3fe46 closed (quota-monitor green in runs 36032787058, 36067912937, 36082385383; its nightly-red issue is closed).
- [~] **Q380** (alert, nightly-red #1719 e2e-journeys, 2026-09-24): 02-marketplace hire-and-message fails at 1440 on the "slow" network profile. The poster presses Message Helpr, which goes to `/messages?jobId=<job>&userId=<helper>` (confirmed in the trace); openConvo fetched the thread's messages, but the page ended on the list at /messages?chat=1 with no reply box. Reads as a race that closes the placeholder thread when the network is slow. The same deep link opens the thread with a reply box for helpr-e2e-poster-0902 on prod at normal speed (checked 2026-09-24). Evidence: the run's artifacts and trace, copied to the session scratchpad. ROOT CAUSE (trace): not a race. The inbox load, a full confirming refetch and then the placeholder lookup ran in series; a just-hired thread has no messages, so the refetch can never return it, and the placeholder's jobs read was still pending at the 30s timeout. FIXED 2026-09-24: the placeholder is built alongside the refetch (src/pages/messages/useMessagesData.ts). GUARD: src/pages/messages/useMessagesData.test.tsx "builds the placeholder while the confirming refetch is still in flight" (@mutate proven). PENDING: an e2e-journeys run green on the slow profile closes #1719.
- [ ] **Q383** (LOW, money, found during ME-006 2026-09-25, code read only): the tip fee covers Stripe's CARD rate (2.9% + 30c). Tip Checkout sessions set no `payment_method_types`, so any other method the account enables (the stripeFees.ts comment lists Klarna/Affirm/Afterpay at 5.99% + 30c) costs more than the fee collected and the platform pays the difference; the Helpr still gets the full tip. Also: no code path refunds a tip, and a Dashboard refund of a tip does not reverse the Helpr's transfer unless `reverse_transfer` is set. Decide: restrict tip sessions to `card`, and write the tip refund rule down.
- [~] **Q384** (alert, nightly-red #1754 prod-audit, 2026-09-25): runs 36003051878 and 36069316906 were red on the suites step AND the budget step, five causes. FIXED on branch pa-fix, not yet run on prod: (1) busiest minute 751 / 871 over the 400/min ceiling (dispatch 36095495499: profile-title-alignment alone, its 2 tests passing, 707): metered runs now pace every navigation and test start on the budget's own minute buckets (1ceb2be41), prod-audit perTest 93.5 / signIns 1 calibrated; GUARD src/test/requestMeterPacing.test.ts. (2) coverage test: DeleteUserDialog.tsx (typed DELETE confirm) had no sweep, credit or gap and cannot be credited (its opener "Delete Account" is NEVER_PRESS): GAP added (78737c04e); GUARD src/test/messyInputCoverageDecided.test.ts (inventory − FORMS − GAPS == EXPLORE_CREDITED, red at commit time). (3) "double-tap Send delivers exactly one message" (36069316906 only): the inserted message (201 at 23:05:19.851Z) was deleted at 23:05:21.4Z by Vacuity 36062275531 replaying interruptions.spec on the same accounts (edge logs); cleanup is now per-run (RUN_MARKER; bare-MARKER sweep only for rows > 6 h old) (78737c04e); GUARD src/test/prodSpecCleanupIsRunScoped.test.ts. STILL OPEN: (4) page-settle "1440 /: cls=0.0315" is Q371 (hero font load, owner-approved, needs a browser lane and before/after screenshots). (5) page-settle "/messages" cls 0.0558 @375 and 0.0216 @1440 (both runs; not in scheduled 35963166238 on a99b7e2a2): the list `div.space-y-2` moves 139→205 (375) / 142→194 (1440) at ~500 ms, before the rows land; not root-caused by code read (no Messages commit between the green and red runs), needs a browser lane. Confirm: `gh workflow run prod-audit.yml --ref pa-fix` (full, no grep): expect the budget step green with a "paced" note, coverage and double-tap green, page-settle red on (4)/(5) until those land.
- [~] **Q385** (alert, nightly-red #1742 e2e-real-backend, 2026-09-25): the scheduled/dispatch-only jobs. Latest dispatch 35987836495 red on two: (1) "Authenticated journeys": all 55+6 tests passed, budget step 929/min (35984980556: 857; 35956548632: 608) over the 400 ceiling: fixed by Q382's pacing (1ceb2be41), GUARD src/test/requestMeterPacing.test.ts. (2) "Full money loop": `release failed: 429`, retry 429 at escrow: the pre-sweep asked cancel_escrow about 9 hired, in-escrow rows (9× 409 useCancelJob, 12:08:48-57Z), spending the poster's 10/min create-payment window the loop needed (escrow 12:09:05 = call 10, release 12:09:27 = call 11); the sweep now skips rows whose columns decide the answer and waits out its window (157a7f6ce); GUARD src/test/sweepSparesCreatePaymentWindow.test.ts. Earlier reds already fixed on main: "before photo came back a different size" (35881722489, 35984980556; 36cff9970) and desktop-fill /browse stale selector (35956548632, 35984980556; green in 35987836495). Not done: `chromium` perTest/signIns stay uncalibrated (one label, three job shapes: authenticated 21.0/test, money loop 39.5/test). Confirm: `gh workflow run e2e-real-backend.yml --ref pa-fix`.
- [ ] **Q386** (alert, ledger 5b2db99a, 2026-09-25): ~66 Sentry replays a day are still sent after Q275 and Q379(b) (last 7 days 464, run 36082385383), all but a few dropped by the quota, so Sentry keeps no record of who sent them. Leads, none measured: (1) a prod build on http://localhost or 127.0.0.1 not driven by WebDriver (beforeSend already drops its ERRORS via isLocalBuildHost, but src/lib/sentry.ts still samples its replays at 10%); (2) the owner's installed iOS build predates Q275/Q379 and records replays on every error (see Q387); (3) a CDP-attached headless Chrome with webdriver=false and no seed login. Next: after the next deploy, re-read the per-day replay split; if it does not fall, add a groupBy=project/outcome/reason read, and gate replay on !isLocalBuildHost with the jsdom URL stubbed in the existing sentry tests. No guard yet.
- [ ] **Q387** (alert, error_logs, 2026-09-25): the owner's iPhone (native, capacitor://localhost, iOS 18.7) logs PGRST205 for the gift-card credits table under its pre-rename name (the old dashboard gift-card count, warning) and public.broadcast_messages (BroadcastBanner.loadActive, error) on every dashboard load: 3 each on 2026-09-24/25, first gift-card-table row 2026-09-19. Neither table exists in prod (to_regclass null) and nothing in src/ reads either one, so the caller is the INSTALLED native bundle, built before the gift-card rename (20260913051340) and the broadcasts drop (20260924174847). Its rows carry no context.release, which errorLogger has attached to every row for weeks, confirming an old build. Fix: ship a new iOS build (owner: TestFlight/App Store). Same blocker as push-tokens-empty. Nothing to change in source. NO-GUARD yet: an error_logs row from a native build older than N days could be flagged in the digest.
- [~] **Q389** (alert, nightly-red #1582 press-every-control, run 36069319716, 2026-09-25): every shard and the clean-up job red. FIXED on branch pec-fix (not pushed), each with its guard shown red: 133 "undocumented" skips were the gate's SKIP_ACCOUNT_SETTING missing from DOCUMENTED_SKIPS (GUARD src/test/pressSkipVocabulary.test.ts); clean-up "personas not minted: incomplete" (GUARD src/test/pressCleanupPersonas.test.ts); 32 rows not reached in 135 min because the admin menu sheet was re-walked on all 25 admin views (GUARD src/test/pressChromeOverlayOnce.test.ts); busiest minute 599/587 over the 400 ceiling (GUARD src/test/pressPacesToLoadCeiling.test.ts); /posts 400 on signing proof photos prod-lifecycle's teardown had deleted under a surviving row (GUARD src/test/proofPhotoTeardownDetaches.test.ts); SavedHelperCard note swallowing the card tap (GUARD src/test/stretchedLinkRaisesOnlyControls.test.ts); /jobs/:id dock inventoried mid-redirect (GUARD src/test/pressLandingSettles.test.ts). OPEN: (a) one-time repair of the 6 is_seed jobs still naming missing proof objects (proof-photo-reference-check in the clean-up job fails until then); (b) not root-caused, need the shard artifacts' screenshots: /admin?view=people 5 (3 "control not found", J3 row NOT CLICKABLE), /admin?view=reports 3 ("Message Seed", "Message Perry", "Dismiss" not found), /admin?view=settings bell row "Stuck payment" no observable change; (c) perTest 26845 will likely read stale after the dedup: recalibrate from the confirming run; (d) SavedHelperCard 375 before/after screenshot not taken. Confirm with `gh workflow run press-every-control.yml` once landed. UPDATE 2026-09-25 (branch cloud/nightly-1582-press, draft PR): (a) FIXED IN CODE, not yet measured live: the clean-up runs `proof-photo-reference-check.mjs --repair-seed-before 2026-09-25T05:42:00Z`, which drops dangling values from is_seed jobs created before the teardown fix only; a real job or a newer seed job stays red (GUARD src/test/proofPhotoSeedResidueRepair.test.ts). (b) ROOT-CAUSED from the logs of 36069319716 AND 35976390920 (same rows both runs): /admin?view=people — every row said "Good" + "Never logged in" until useAdminUserSummaries' un-awaited reads landed (run 36069319716 inventoried "AW Audit W. Active TEST Good East Baton Rouge Never logged in"; 35976390920 the settled "…5.0 (1) East Baton Rouge 8 days ago"), and for good if login_history failed; APP FIX: unknown maps are null, no absence claim from them (row + ActionsTab "Awaiting first login"), list aria-busy until settled (GUARD src/test/adminUserSummaryUnknownIsNotAbsent.test.tsx); J3 NOT CLICKABLE: positional paths into a VirtualList re-address after a scroll, now `[data-index]` (GUARD src/test/pressAddressesVirtualRows.test.ts). /admin?view=reports — "Investigating" (a write) was pressed UNGATED, the card left the pending queue and its later controls were "not found"; "Assign to Me", "Dismiss" (Reports, Support) and "Add" (grant admin) were ungated writes too; now isAdminWrite gates them and ROW_CONSUMED_SKIP excuses a record this run's own write removed (GUARD src/test/pressGatesEveryAdminWrite.test.ts, from the admin source's own writer buttons). /admin?view=settings "Stuck payment" no observable change: NOT root-caused; the reason now logs url/overlays/toasts before→after. Also: every failure and undocumented skip now has its own log line (GUARD src/test/pressLogCarriesEveryFailure.test.ts); the press clean-up and prod-lifecycle-sweeper removed NO storage (user token → "Bucket not found" on every bucket, measured as anon), fixed (GUARD src/test/storageCleanupAsUser.test.ts). (c) still open, needs the confirming run. CONFIRMING RUN 36208184593 (dispatched on the branch 2026-09-26 01:22Z), shard 2: undocumented skips 90 -> 0, every admin view in the shard 0 failures; 7 failures all on /jobs/:id customer (6 = Q294 pulse, above; 1 = 429 on signing a proof photo). Storage requests 1,657 -> 14,095 on that shard: signProofPhotoUrls sent one createSignedUrl POST per photo per gallery mount and never reused the URL; FIXED on the branch (one createSignedUrls batch, shared in-flight, reused while half its life is left; GUARD src/test/proofPhotoSigningIsBatched.test.ts, 3 @mutate killed). Budget on shard 2: busiest minute 634, perTest 32,839 (budget 26,845), both driven by that row; re-measure before recalibrating. Shard 1: 0 failed presses (was 10), 0 undocumented (was 14), but 37 rows not reached (was 14) and busiest minute 455: /home customer 44 min for 81 presses, /home helper 50 min (9.5 and 8 min before pacing) while the shard averaged ~125 req/min. The pacer's burst estimate was the run's all-time largest cycle, so one heavy cycle held every later one to about one a minute; FIXED on the branch (estimate = largest of the last 6 cycles, pace to 85% of the ceiling; GUARD src/test/pressPacingFollowsRecentCycles.test.ts, 2 @mutate killed). Not re-measured: the branch's one dispatch is spent.
- [ ] **Q434 Did press-every-control write to REAL reports / support tickets as admin? (found by #1582 triage, 2026-09-25).** Until branch cloud/nightly-1582-press, "Investigating", "Assign to Me" and "Dismiss" on /admin?view=reports and "Dismiss" on /admin?view=support were pressed ungated on whatever row was in the queue (their labels named no DESTRUCTIVE_RX verb). UNMEASURED: whether any row was not test-owned. Measure from edge_logs (PATCH /rest/v1/reports and support tables with the runner's 127.0.0.1:4173 referer, runs since 2026-09-13), list the rows, restore any real ones to their prior status/assignee. Guard for the cause: src/test/pressGatesEveryAdminWrite.test.ts.
- [ ] **Q435 PR #1804 (loading-states, nightly-red #1773) NOT landed (2026-09-26 landing pass).** Applied on origin/main 8c3f3cbeb its own guards pass, but src/test/loadingStateShape.test.ts goes red: 16 new breaches (JUMP anon /account-banned +277px, MEDIA helper /profile?tab=earnings 5 -> 34, ...) and 32 baseline.json entries that no longer breach; main passes 8/8 without it. Needs measurements.json + baseline.json from a green cold-context prod run of cloud/nightly-1773-1801 committed onto the branch, then land. Guard to name when done: loadingStateShape.test.ts green with the PR applied.
- [ ] **Q428 Admin People "Never logged in" may be false for accounts whose logins are older than the 500 newest login_history rows (found by #1582 triage, 2026-09-25).** useAdminUserSummaries reads `login_history ... .in(user_id, all) .order(created_at desc) .limit(500)`, so heavy accounts (the shared test accounts sign in many times a day) can fill the 500 and push every other user's last login out. UNMEASURED: count login_history rows in the newest 500 by user, and how many profiles with any login read "Never logged in". Fix if true: a per-user max(created_at) read (RPC or view). Guard to name when fixed: a test that one user's many logins cannot hide another user's last login.
- [ ] **Q390** (MEDIUM, OA-004, 2026-09-25): the native Supabase session (access + refresh token) is stored in NSUserDefaults via @capacitor/preferences (an unencrypted plist, in device backups, not passcode-gated) and in WKWebView localStorage. The misleading `keychainStorageAdapter` name is fixed (now `preferencesStorageAdapter`; guard `src/test/secureStorageNamesAreTrue.test.ts`). Open: owner decision whether to move the native mirror to a Keychain-backed plugin (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly); needs a device check that sessions still survive relaunch, Offload App and WebKit localStorage eviction. No guard yet for the storage choice itself.
- [ ] **Q392** (MEDIUM, notifications, found by the V-008 review 2026-09-25, code read only, not checked live): instant-job-match (supabase/functions/instant-job-match/index.ts:310-321) sends 'Match for you' with title/location/budget at funding, ignoring early access, and has no dedupe (poster can re-trigger to all matched users, 20/min/IP). Separate lane; the saved-search half of V-008 is Q225.
- [ ] **Q393** (group jobs, found by the group-jobs lane 2026-09-25; reproduced on prod in DO blocks that rolled back, on the one seed group job def709bf, is_seed, unpaid): a Helpr who leaves or is removed from a crew stays on the job. D1 the poster removes the lead from a staffing crew: jobs.helper_id still names them (address, messaging, party status) and their application stays accepted. D2 crew member #2 cannot leave (helper_cancel_booking not_authorized); the lead who leaves keeps their roster row (still paid by the roster payout fan-out) and the stale row blocks a replacement hire (roster_full). D3 the crew tracker's Working step reads the JOB's before photo, which members 2..N never write. FIXED on branch group-fix, not deployed: migration supabase/migrations/20260925140148_group_roster_departure.sql: AFTER DELETE trigger trg_sync_job_after_roster_departure (every deleter: poster policy, helper_cancel_booking, account deletion) rejects the departed Helpr's accepted application and, when they were the lead, moves the lead to the earliest remaining member the award gate accepts on a FUNDED job, else clears it; helper_cancel_booking (restated from live pg_get_functiondef, md5 edc357c5) gains a crew branch (roster slot, open/accepted, own part not done, start not passed, same reliability consequence, leaves the roster, a booked crew below helpers_needed reopens, poster told "A Helpr left your crew"); enforce_job_tracking_arrival_gate (live md5 92d5e1ad) reads each member's own roster before photo, the job-level photo counting only for the lead. GUARDS: src/test/groupJobRosterLifecycle.test.ts ("leaving the crew leaves the job", 6 @mutate on the migration, each red; the file now grades the newest definitions via effectiveDefs and left GRANDFATHERED in src/test/guardsReadTheNewestMigration.test.ts, which goes red on the old file); behavioural src/test/pglite/groupRosterDeparture.pglite.mjs (before-state md5 = prod, R1-R4 red on prod's functions, A1-A18 green after 3x apply; a one-statement lead re-point fails A8 on the column whitelist). NEEDS LIVE CHECK after db-deploy: pg_get_functiondef + proacl of the three functions and the trigger on group_job_helpers; re-run the D1-D3 rollback probes on def709bf. NEEDS a REVIEW-ONLY lh-money-escrow + lh-authz-rls pass (self-review only so far). **NOT SHIPPED (2026-09-25):** the fix (migration 20260925140148, commits e28bf61a1/f85434722 on branch group-fix) was taken back out of PR #1790 after the lh-money-escrow review found: (1) HIGH, the departure trigger's `UPDATE jobs SET helper_id = NULL` runs as the poster and enforce_poster_jobs_money_lock refuses it once checkout has opened, so removing a funded crew's lead fails outright (reproduced in PGlite with that lock added); (2) MEDIUM, a new lead inherits helper_confirmed_at and the day-of/reminder stamps, so a late poster cancellation pays a committed-tier fee to a Helpr who never confirmed; (3) LOW, the departed lead's job-level before photo carries over; (4) LOW, lock-order inversion between the poster's removal and the member's cancel (deadlock, atomic); (5) LOW, helper_id NULL with a non-empty roster lets cancel_escrow refund a crew with hired members; (6) LOW, a legacy group job with no roster row loses its lead's cancel path. The PGlite harness also lacked the live BEFORE UPDATE triggers on jobs.
- [ ] **Q394** (OWNER QUESTION, group jobs, 2026-09-25): when the poster cancels a booked crew late, the cancellation fee goes to jobs.helper_id (the crew lead) only. Should it be split across the crew (evenly, like the roster payout fan-out), go to the lead, or go to nobody on a crew job? Not built; blocks group-jobs turn-on (VN-52). Guard to name when built: a PGlite proof of the fee path on a 3-member crew.
- [ ] **Q395** (OWNER QUESTION, group jobs, 2026-09-25; same decision as the "Crew jobs: review model undefined" line above): one review per crew or one per Helpr, how a per-Helpr review weighs into tier, and when the blind window closes for a crew. Not built; blocks group-jobs turn-on (VN-52, breakage (d)).
- [ ] **Q396** (group jobs leads, 2026-09-25, NOT reproduced, code read only): (a) accept_application has no is_group_job refusal (the live probe hit the funding gate first; the seed is unfunded); (b) after the first crew hire later hires do not change jobs.helper_id, so enforce_job_funded_before_award does not judge them: a crew could grow on a job whose escrow was since refunded or abandoned; (c) a withdrawn or auto-resolved dispute on a group job keeps disputed_at; (d) when Q393's trigger moves the lead, the job-level helper_confirmed_at / day-of stamps still describe the previous lead. Guard to name when fixed: extend src/test/pglite/groupRosterDeparture.pglite.mjs.
- [~] **Q397** (found by Q105(4), 2026-09-25): run_missed_cron_catch_up() (cron-missed-slot-catch-up, every 10 minutes) costs ~288 ms per call (pg_stat_statements 2026-09-25: 291 calls, mean 287.5 ms, 83.7 s total, as much as sweep_dead_crons) because its candidate query runs 5 subqueries correlated on jobid over cron.job_run_details (no usable index; supabase_admin owns the table) for every active job. Rewrite it to read the run history once (as 20260925140304 did for sweep_dead_crons), prove old vs new pick the same slots in PGlite (it drives catch-up runs, so equivalence matters more than speed), then lower KNOWN_CORRELATED in src/test/cronRunHistoryScannedOnce.test.ts to drop it. FIXED 2026-09-25 (branch cloud/q397-cron-catchup-perf, draft PR, NOT YET LIVE: not merged, so db-deploy has not run): migration 20260925155322_catch_up_candidates_one_scan joins the due jobs (active, daily/weekly, slot past grace and inside its period) to cron.job_run_details ONCE and computes the 5 facts as aggregate FILTERs with the old bounds; the rest of the body is 20260923172145's. Two deliberate refinements: ORDER BY slot, jobid (two jobs on one slot were in plan order) and last_failure ties on start_time broken by runid DESC (only the quoted text can differ). PROOF: src/test/pglite/cronCatchUpOneScan.pglite.mjs (applied 3x; old body vs new body in the same transaction, identical returned jsonb, cron_catchup_runs, error_logs, schedules and commands run, with no policy rows and with every job safe: 37 named edge cases incl. never ran, ran late, a slot missed twice, disabled, changed schedule, all PASS; 150 seeded random histories x 60 jobs around every bound, 150/150 identical; MUTATE=1 (at-slot bound made inclusive) is RED: 4 FAIL, only 73/150 rounds identical); cronCatchUp.pglite.mjs now runs its 55 Q30/Q207 checks against the new body: ALL PASS. GUARDS: src/test/cronRunHistoryScannedOnce.test.ts (KNOWN_CORRELATED = cron_dispatch_health 1 only; red without the migration, 5 vs 0; red with the old entry left in, stale; its new @mutate killed); cronCatchUpPolicy.test.ts regexes made alias-agnostic and its 8 @mutate lines plus cronHttpRequestsAreTagged's 1 re-pointed at the new migration (all 10 killed). TO VERIFY LIVE after db-deploy: pg_get_functiondef('public.run_missed_cron_catch_up()'::regprocedure) contains 'hist AS' and no 'WHERE d.jobid = j.jobid'; pg_proc.proacl for it grants EXECUTE to service_role only; pg_stat_statements mean_exec_time for `SELECT public.run_missed_cron_catch_up()` on calls after the deploy (was 287.5 ms over 291 calls); cron_catchup_runs keeps getting the same kinds of rows.
- [ ] **Q398** (MEDIUM, disputes/authz, found by the lh-authz-rls review of 20260925141905 on 2026-09-25, code read + PGlite only, NOT reproduced live): the legacy `jobs.dispute_evidence_urls` column bypasses the new evidence immutability. DisputeCard.tsx:91-93 shows the admin that column whenever the dispute record has no evidence; the column is client-writable (helper whitelist in 20260915101102, client write at DisputeTimelineDialog.tsx:246-253) and dispute_evidence_url_ok never checks it; src/lib/evidenceUrl.ts accepts `<uid>/DISPUTES/<job>/…` (EVIDENCE_PATH_RE has /i) and any `/sign/proof-photos/` path (legacy branch), so a party can show the admin an object it can still overwrite or delete (an upper-case `Disputes` object stays deletable by its owner, PGlite). Fix: (a) BEFORE UPDATE trigger on jobs.dispute_evidence_urls, append-only with every new element passing dispute_evidence_url_ok(e, auth.uid(), NEW.id) unless a server context (or move the append into an RPC and revoke the column); (b) drop /i from EVIDENCE_PATH_RE; (c) pin the legacy branch to `/sign/proof-photos/<uuid>/disputes/<uuid>/`. Reproduce live first (poster token PATCHes jobs.dispute_evidence_urls on a seed job, then PUT/DELETE a `<uid>/DISPUTES/…` object); needs an lh-authz-rls review at landing. Residual LOW: a party can file a path before uploading the object.
- [ ] **Q399** (LOW, authz class check, found by the same review): messages policy "Users can mark messages as read" is FOR UPDATE with roles {public}, so scripts/ci/sensitive-anon-grants.sql's WRITE rule exempts UPDATE on messages and a future anon UPDATE re-grant would not go red (INSERT and DELETE are covered after Q340). Fix: recreate that policy TO authenticated (its USING already needs auth.uid() = receiver_id), then the WRITE rule covers UPDATE too.
- [~] **Q400** (audit bus SW-001 + SW-002, lh-seo-web, 2026-09-25): before JS, every sitemap route but `/` served the homepage's title, description, og:* and `<link rel=canonical href=https://www.louisianahelpr.com>`. FIXED on branch claude/terminal-session-recovery-asrl00, NOT YET LIVE (not pushed or deployed): vercel.json rewrites /browse, /help, /support, /legal, /terms, /privacy, /rules to api/share.ts `?_og=page`, which fills title, description, og:url/title/description, twitter:* and a self canonical from src/lib/publicPageMeta.mjs, the same table usePageMeta reads after JS (DashboardGuest, HelpCenter, Support, Legal); `/` stays the static index.html. GUARD: src/test/publicRoutesServeOwnHead.test.ts (walks public/sitemap.xml through vercel.json's rewrites into the handler; red on the pre-fix vercel.json, 6 of 7 URLs, and on its 6 @mutate lines). OPEN: verify live after the prod-deploy batch: `curl -s <url> | grep -E '<title>|rel="canonical"|og:url'` for all 7 sitemap URLs plus /terms, /privacy, /rules; each must show its own title and canonical (/terms, /privacy, /rules canonicalise to their /legal URL), and `/legal?tab=privacy` must show the privacy canonical (proves Vercel carries ?tab= through the rewrite).
- [ ] **Q401** (found while fixing Q400, 2026-09-25, code read only): (a) the public non-sitemap routes /login, /signup (no ?ref), /forgot-password, /reset-password, /signup-pending, /account-banned still serve the homepage's canonical and title before JS (the SW-001 finding named /login and /signup too; the fix covered sitemap URLs only). They are out of the sitemap by choice (generate-sitemap.mjs NOINDEX) but carry no noindex meta pre-JS. (b) The landing page's pre-JS description (index.html) and post-JS description (usePageMeta in src/pages/info/Index.tsx) differ: "Helpr connects you with trusted neighbors..." vs "Hire a Helpr or find local work in Louisiana..."; og:description differs the same way. Left alone because the task said keep the landing values; needs an owner call on which copy wins.
- [ ] **Q407** (OWNER DECISIONS, group + recurring jobs, owner 2026-09-25, answered in the session; these settle Q394, Q395 and the recurring lane's owner questions): GROUP: (1) a crew has NO lead: every hired member is equal in access (address, messaging the poster), pay share, cancellation-fee share and review; (2) a late poster cancellation's fee is split EVENLY across the hired crew; (3) one review PER Helpr, each counting toward that Helpr's own score and tier. RECURRING: (4) the poster chooses AT POSTING TIME between 'one person for every visit' and 'OK to split the days'; (5) when split, the first hired Helpr picks the visit dates they want, the poster then offers the remaining dates to the next Helpr they choose, and so on until every date is covered; a date nobody has picked stays offerable while the poster keeps offering it, and if it is still unfilled when it arrives it is not charged; (6) a Helpr giving up one of their dates (or ending their part of a series) gets a reliability strike ONLY within 24 hours of that visit, same as a late single-job cancel, and the date goes back to the poster to offer again; (7) a poster with a running series CANNOT delete their account until the series is ended; (8) after hire, a one-time job's date/time can change only as a request the Helpr accepts; (9) banning an account ends every series it posts or works on (future visits cancelled and not charged, the other party told). Build: group redesign on top of the reviewed roster-departure rework (group-fix 212b6db40); recurring split-days on top of recurring-fix. Each ships with a class guard and a money/authz review.
- [ ] **Q630** (found by the Q54 parity sweep, 2026-09-26, code read only; audit doc docs/audit/parity-matrix-2026-09-26.md finding F1): `supabase/functions/ai-job-builder/sanitize.ts` bounds the model's output more loosely than the post-job form it is poured into verbatim (src/pages/post-job/useJobEntry.ts applyAiJob): description 4000 vs the form's 1000 (and jobs.description has no DB CHECK, so it can post at 4000), special requirements 1000 vs 500, budget clamp 0..100000 vs 10..1000 (form, create-payment, jobs_budget_range), helpers 1..20 vs the group input's 2..10. The poster sees a refusal for numbers they never typed. Pinned exactly by src/test/aiJobBuilderBoundsParity.test.ts KNOWN_DRIFT. FIX: lower DESCRIPTION_MAX to 1000, REQUIREMENTS_MAX to 500, clamp budgets to 10..1000, clamp helpers to 10 and to >= 2 only when is_group_job is true (a non-group job's 1 is correct, so a flat 2..10 would be wrong); delete the matching KNOWN_DRIFT entries in the same commit; lh-silent-failure review-only pass (edge function), recorded as a Sensitive-Review trailer.
- [ ] **Q631** (found by the lh-silent-failure review of the Q228 sweep, 2026-09-26, code read only): admin dialogs that do `if (error) throw error` on `supabase.functions.invoke` never read the response body, so the edge function's own refusal never reaches the admin (e.g. admin-delete-user's 409 "This user has an active job or funds held in escrow…" shows as a generic "try again"): DeleteUserDialog, FormalWarningDialog, ManualVerifyDialog, ResetPasswordDialog, AdminBanReview, AdminIDVReview (x2). FIX: `throw new Error(await functionErrorMessage(error, fallback))` at each site, plus a class guard that no `functions.invoke` result's `error` is thrown raw.
- [~] **Q425** (audit bus DR-004 + DR-006, 2026-09-25): a restore resurrects rows pointing at Storage files no backup holds, and money records diverge from Stripe after a rollback. Code side DONE on branch `cloud/audit-br024-dr004`: scripts/check-storage-refs.mjs (every row whose file is missing or on another project; inventory two-way with types.ts), scripts/check-stripe-restore-drift.mjs (every PaymentIntent/transfer/refund since the restore point looked up by id; read-only, test mode by default), both runnable from .github/workflows/restore-reconcile.yml (dispatch), and docs/runbooks/restore-from-backup.md gained a what-is-backed-up table and §4.1/§5.1/§5.2 reconcile steps. Guards: src/test/storageRefs.test.ts, src/test/stripeRestoreReconcile.test.ts, src/test/liveCheckScriptsFailClosed.test.ts. PENDING (why [~]): neither check has run against prod's database yet (this session had no service-role key; the Stripe half was read live in test mode: 100 PaymentIntents, 49 transfers, 100 refunds in 14 days parsed). After merge, dispatch restore-reconcile.yml with any `since` and record the baseline. STILL OPEN elsewhere: Storage FILES are backed up by nothing (Q147); instant payouts on connected accounts are not listed (manual step in §5.1); edge-function secret VALUES (Q426).
- [ ] **Q426** (OWNER, credentials; DR-004 re-measure 2026-09-25): edge-function secret VALUES live only in Supabase's secret store: no database backup, no repo file, nothing any agent can export. If the project were lost, the STRIPE_PRICE_* ids and the RESEND / APNS / CRON / webhook secrets would have to be re-created from each provider. Ask: keep a copy of every value from `supabase secrets list` (at least STRIPE_PRICE_*, RESEND_API_KEY, APNS_AUTH_KEY, CRON_SECRET, SEND_EMAIL_HOOK_SECRET, the Stripe webhook secrets) in your password manager beside BACKUP_PASSPHRASE. docs/runbooks/restore-from-backup.md §4 is the procedure that uses them.
- [~] **Q410** (alert, nightly-red #1802 db-drift-detect, 2026-09-25; branch cloud/nightly-1802-db-drift): scheduled run 36170225492 red on ONE step, "Prod runs the newest migration's body for every function" (migration VERSIONS were clean: 0 repo-not-in-prod, 0 prod-not-in-repo). 11 functions "unmatched": check_referral_bonus, expire_pending_direct_offers, helper_abort_job, helper_cancel_booking, notify_helper_application_viewed, notify_helper_on_direct_offer, notify_on_job_update, poster_cancel_job, respond_to_direct_offer, sweep_no_show_alerts, track_revision_scope_creep: exactly the targets of 20260925143327_notification_copy_names_the_person.sql, which rewrites copy through pg_get_functiondef + regexp_replace + EXECUTE. Prod applied it exactly as written; scripts/audit/function-body-drift.mjs replayed CREATE statements only and tolerated link-literal differences only, while src/test/helpers/effectiveFunctionDefs.ts already modelled the rewrites (two models of one mechanism). FIXED: one shared parser, scripts/lib/functionRewrites.mjs (rewrite tuples + Postgres regexp_replace in JS), used by both; the detector now applies each tuple to every overload at its point in the replay (pre-rewrite body kept in history, so a prod that never ran the rewrite reads as stale). Measured against a live pg_proc snapshot (read-only execute_sql, 367 rows, 2026-09-26): before exit 1 with 11 unmatched; after exit 0, all 11 an exact normalized-hash match. GUARD: src/test/functionBodyDrift.test.ts "in-place rewrites are replayed" (exact inventory of the 11; detector body == effectiveDefs body for every rewritten function; poster_cancel_job carries the new copy; pre-rewrite body is red as stale; @mutate proven: 2 tests red and the live snapshot back to 11 unmatched). PENDING: merge, then the next scheduled db-drift-detect green closes #1802.
- [~] **Q412** (alert, nightly-red #1719 e2e-journeys, runs 36164148002 and 35905284660; branch cloud/nightly-1719-e2e-journeys, 2026-09-26): the workflow could not go green on any run since the skip reporter made a skip a failure (2026-09-23). Four causes, each with a class guard shown red on main's tree and under its @mutate lines. (1) chromium `02-marketplace.spec.ts:973` "the poster's card never showed the Reviewed badge": the Done card parks Tip/Reviewed in the "More" overflow, a Radix popover portaled to <body>, so a card-scoped locator counts 0. Fix and guard PORTED VERBATIM from PR #1797 (5ad3624b3, Q701 there): `findChip`, GUARD src/test/journeyChipsReachOverflow.test.ts. (2) `trailing-icon-fields.spec.ts:125` skipped UNJUSTIFIED (service-role `.env` mint, never on CI): PORTED from PR #1797 (c085e7c8f): signs in through optionalSession + PLAYWRIGHT_INCOMPLETE_EMAIL/_PASSWORD in both journey jobs, GUARD src/test/journeySessionsReachCi.test.ts. (3) journeys-webkit: Stripe's hosted Checkout answered Playwright's WebKit "Something went wrong" twice across a reload on 3 of 3 webkit runs (35796081270, 35905284660, 36164148002; Chromium paid in each), so the whole WebKit money chain skipped UNJUSTIFIED. The app never shows Stripe in its WKWebView (native: SFSafariViewController via openExternalUrl). FIX: `payCheckoutSession` pays in place on chromium and in a launched Chromium otherwise (e2e/journeys/stripeInChromium.ts), then opens the returned path on the local build; the webkit job installs chromium; Stripe's failed requests and console errors are now printed when its error page shows. GUARD: src/test/journeyStripeEngine.test.ts. (4) five time-travel legs were unconditional `skipUncovered` placeholders: the funded countdown chip now funds, walks and refunds its own job (time-travel.spec.ts), and "Offer expiring" / "Review window" run as "time travel:" steps of 02-marketplace at the moment the chain holds that state. GUARD: src/test/journeyPlaceholderSkips.test.ts (two-way list of the two left, Q413). Also: the notify job reports only from main (a branch dispatch could close main's issue), GUARD src/test/nightlyReportsFromMainOnly.test.ts. PENDING: a green unpinned run on main; the two Q413 placeholders keep it red until they are built or the owner decides otherwise.
- [ ] **Q413** (coverage, nightly-red #1719, 2026-09-26): the two time-travel legs still declared as unconditional placeholders in e2e/journeys/time-travel.spec.ts keep e2e-journeys red in both engines on every run: "Confirm window (day before / day of)" needs an accepted job the Helpr has not confirmed, i.e. an accept landing more than a day before the start; this chain accepts minutes before, and a hired, funded job days out has no strike-free unwind for the shared accounts (cancel_escrow answers 409 useCancelJob once hired; poster_cancel_job files a cancel_with_helper strike; the day-of ladder that settles forward is time-locked). "Subscription expiring" needs a paid tier: a test-mode create-pro-checkout purchase, then a cancel through Stripe's billing portal. OWNER DECISION: build these two harness capabilities, or move the two legs out of the nightly and keep them here only. Listed in src/test/journeyPlaceholderSkips.test.ts, which fails the moment either is built or removed without updating it.
- [ ] **Q414** (CI, found 2026-09-26 while fixing #1719): 34 other workflows (measured 2026-09-26 on this branch) that run nightly-issue-sync report from any ref (list: run the ungated scan in src/test/nightlyReportsFromMainOnly.test.ts over .github/workflows), so a green dispatch on a fix branch can close main's nightly-red issue, and a red probe can comment on it (it happened on #1719: issuecomment-5842376019). Only e2e-journeys is gated so far. Also, chromium journeys return from Stripe to create-payment's APP_URL (default https://www.louisianahelpr.com; the prod secret's value was not read), i.e. the deployed site, after every funding leg; journeys-webkit no longer does (stripeInChromium.ts answers that navigation itself). Not measured: how many Vercel requests that return costs.
- [~] **Q433** (alerts, nightly-red #1819 "main: Vacuity" + #1799 privacy-journey, 2026-09-26; branch cloud/nightly-1799-privacy): #1819's Vacuity run 36215687625 (9f2021865, #1812 merge) had both privacy-requests.spec.ts registrations "RED before any mutation". Cause, measured: functions-deploy run 36215687560 failed its RPC pre-check at 03:49:02Z ("public.export_my_data does not exist on prod, but supabase/functions/export-my-data/index.ts calls it"), because its only wait was check-edge-rpcs-live --wait 300 while db-deploy run 36215687838 for the same commit ran 03:43:36-03:52:13Z. So NO function was uploaded (the push was a deploy-all, _shared changed): POST /functions/v1/export-my-data answered 404 on prod at 03:57Z (delete-own-account 401, i.e. present), while /rest/v1/rpc/export_my_data answered 42501 (exists, anon refused). "Download My Data" was broken for every user and the privacy journey, which exports through the real UI against prod, could not pass. FIXED: functions-deploy.yml waits for the db-deploy run of the SAME commit (gh api …/db-deploy.yml/runs?head_sha=) to finish before the RPC check (up to 45 min; job timeout 15 -> 60; permissions actions: read). GUARD: src/test/functionsDeployWaitsForDbDeploy.test.ts (inventory: every workflow job that runs `supabase functions deploy`; red on origin/main 3/4, both @mutate lines red). Prod was NOT restored by re-running 36215687560: that re-run sat pending behind the runner backlog and was cancelled before it started (so it could not roll functions back over the newer #1811 deploy). #1811's own deploy-all, functions-deploy run 36216404262 (b7c008e88), restored it: export-my-data answered 401 (deployed, JWT required) at 04:18:17Z and again at 04:37:37Z, where a made-up function name answered 404 (corrected 2026-09-26 by the Q254/Q313 lane). A signed-in export end to end has NOT been observed yet. #1799 is a different cause: run 36158780317 (3569359bf, before #1812) passed both tests and failed only the Q104 request budget, "privacy: perTest 42 is over its budget 40.5" (84 requests / 2 tests; the green branch run 36095114530 measured 35; calibration runs 40.5 and 37.5). Landed on main as 3676f7b57 (PR #1828 closed unmerged). OPEN before [x]: a privacy-journey dispatch green on main; Vacuity green on main (closes #1819). The #1799 budget is NOT fixed here: branch cloud/nightly-1799-privacy-journey (0364d4cda, no PR as of 04:20Z) is instrumenting it (the meter records every endpoint shape, privacy-journey uploads its samples); that lane owns attributing and settling the 40.5 budget.
- [ ] **Q432** (found fixing Q433, 2026-09-26, read from run 36215687625): the Vacuity gate's "guard is RED before any mutation" reason is the last 25 lines of the guard's output (scripts/vacuity/run.mjs baselineWhy, `.slice(-25)`), and for a Playwright spec those are the webServer's `[WebServer]` build warnings, so the failing assertion never reaches the log: #1819's two inconclusive privacy-requests.spec.ts entries show only Tailwind/Vite warnings. Fix: drop `[WebServer]` lines (or keep the spec's own error block) before taking the tail. Second gap from the same run: a push that lands a migration + edge function together runs the prod-backed e2e registrations while db-deploy/functions-deploy are still in flight, so they are red for a reason the push itself will fix minutes later; make the e2e registrations of a push wait for that commit's deploy runs (the Q433 wait), or re-run them once deploys finish. Guard to add: a vacuity unit test that a spec output ending in [WebServer] noise still yields its `Error:` line.
- [~] **Q427** (audit bus NB-017 ⚑, native deep links, 2026-09-25; CODE FIX ONLY, NOT verified on a device or simulator — this cloud container has no Xcode/simulator): helpr:// and Universal Links now enter through ONE function, `routeIncomingUrl` in src/lib/deepLinkRouter.ts, fed by both `App.getLaunchUrl()` (read once at boot) and `appUrlOpen`. Measured from code, not device: (a) on iOS `getLaunchUrl()` returns `ApplicationDelegateProxy.lastURL` and the cold-start `appUrlOpen` is retained until a listener attaches (node_modules/@capacitor/app AppPlugin.swift `retainUntilConsumed: true`), so a cold start from a link ran the handler TWICE (two Browser.close(), two navigate()); now the pair is collapsed (same URL, other source, within 10 s), while two real taps still route twice; (b) the appUrlOpen listener sat at the END of useNativePushSetup's one try, behind six push awaits, so any push throw left the process with no deep links; it now starts first on its own chain. The `cancelled`/effect re-run mechanism NB-017 hypothesised was already removed by the Q82 fix (NAVIGATE_REF, 9a06e04ce). AppDelegate.swift application(_:open:options:) and (_:continue:restorationHandler:) both forward to ApplicationDelegateProxy (read, correct; no UIScene manifest in Info.plist, so these are the entry points); Info.plist registers the `helpr` scheme. ANDROID: there is no `android/` project in the repo, so no intent-filter or launchMode exists to check — Android deep links cannot work until one is generated (`npx cap add android`) and given a `helpr` intent-filter + App Links; not done here. Guards: src/test/deepLinkOneRouter.test.ts (appUrlOpen subscribed once and getLaunchUrl read once in all of src/, both into routeIncomingUrl; launch/appUrlOpen twin routes once in either order; every edge-function `buildRedirectUrl` target, bounced through helpr://, normalizes to an App.tsx route) and src/lib/nativePush.bootRegister.test.tsx "attaches appUrlOpen even when push setup throws" (red on origin/main 61b1cb451); all proven red by their @mutate lines. DEVICE STEPS STILL OWED (tick [x] only after these pass): build this code (`npm run build && npx cap sync ios`), install on the iOS 26.1 simulator AND a real iPhone. (1) NB-017's failing condition, 5 runs, baseline 0/5: `xcrun simctl terminate booted com.Helpr; xcrun simctl launch booted com.Helpr; sleep 25; xcrun simctl openurl booted 'helpr:///legal?tab=privacy'` — must land on Legal with Privacy selected every time, and prod `error_logs` must gain one `tags->>'source'='nativeReturn.browserClose'` row per run (the handler-ran marker). (2) Cold start from the URL, 5 runs, baseline 4/5: `xcrun simctl terminate booted com.Helpr; xcrun simctl openurl booted 'helpr:///legal?tab=terms'` — lands on Legal/Terms, and prod `analytics_events` gains exactly ONE `event='app_opened_from_deep_link'` row per launch (before this fix: two), with `properties->>'source'` = 'appUrlOpen' or 'launch'. (3) Warm: two more openurls after (2) both navigate. (4) Real money path on the iPhone, Stripe test mode: open the app from the home screen, pay a seed job with 4242 4242 4242 4242 — the sheet must close by itself and land on /payment-success. (5) Tap https://www.louisianahelpr.com/legal from Notes, app killed and app running: both open Legal in the app. Then `node scripts/audit-bus.mjs status NB-017 --set verified --by <you> --note "<counts>"` and fix NB-001 next (its own sequencing note).
- [~] **Q416** (nightly-red #1794, a11y-webkit-prod run 36148473443, 2026-09-25): the prod a11y sweep renders /jobs/<id> once per job_status from poster-e2e's is_seed jobs, and `accepted` had none ("no is_seed job in status \"accepted\" owned by the poster on prod", an unjustified skip on both engines). Nothing owned that state; `accepted` is a waiting state the product always moves on (auto-expire-jobs re-opens an unconfirmed hire at its deadline). FIXED on branch cloud/nightly-1794-a11y: ensureAcceptedJob (e2e/prod-audit/fundedOpenJob.ts, rules in planAcceptedJob) funds (Stripe TEST), applies, hires and LEAVES a job accepted, dated 30 days out and reused while it has 7 days of runway; run by e2e/job-status-fixtures/accepted.spec.ts (new project job-status-fixtures) in a11y-webkit-prod.yml's `fixtures` job before both read-only sweep legs. GUARD: src/test/acceptedJobFixture.test.ts (plan, wiring, and the class: every status the sweep renders is OWNED or listed in an exact BORROWED list; 5 @mutate, each red; red with accepted unowned). STILL OPEN: (a) the BORROWED statuses cancelled, completed, in_progress, revision_requested have no owner and rely on whatever real-flow run left one for poster-e2e (present in run 36148473443; not checked on prod since): give each an owner or show it terminal, then drop it from BORROWED; (b) the same run also failed the request budget (504/min chromium, 478/min webkit, over 400) on commit 511c83ef9, which predates the per-navigation pacing in e2e/prodTest.ts; confirm on a full run of current main; (c) WebKit fetched the helper avatar `avatars/:id/avatar.jpg` 288 times as exact-URL repeats within 2 s (Chromium 82): a caching question on the storage response or the <img> churn, not investigated.
