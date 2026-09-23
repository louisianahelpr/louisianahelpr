# Open list

<!-- generated: everything-open (node scripts/scoreboard.mjs --write) -->
**Everything open — start here** (Q58). Every tracker, its live count, and where to look.
Numbers for everything we test: **[docs/SCOREBOARD.md](SCOREBOARD.md)**.

- **Queue (this file):** 103 done, 10 partly done (fixed, protection pending), 91 open. Source of truth for work.
- **Audit bus:** 165 open, 8 open launch blockers — `node scripts/audit-bus.mjs list --blockers` · [ROLLUP](audit/launch-2026-09/ROLLUP.md).
<!-- live: carried forward verbatim offline; refreshed by node scripts/scoreboard.mjs --write -->
- **Ops alert ledger:** 19 open (6 critical, 12 error, 1 warning), 0 verifying — `node scripts/ops-alert-ledger.mjs list` · /admin?view=health. _(2026-09-23T06:09Z)_
- **nightly-red issues:** 8 open — `gh issue list -l nightly-red`. _(2026-09-23T06:08Z)_
- **Workflows on main:** 10 red, 8 stale, 1 unknown, 27 green of 46 — [SCOREBOARD](SCOREBOARD.md). _(2026-09-23T06:08Z)_
- **Remote branches:** 34 carry patches not on main, 26 fully merged, of 63 (Q79). _(2026-09-23T06:08Z)_
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
**Queue: 204 items — 103 done, 10 partly done (fixed, protection pending), 91 open.**
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
- [ ] **Q2 Test runs raise real alerts.** E2E/seed jobs trigger stuck-payment
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
- [~] **Q3 Stripe test balance empty. Top-up DONE 2026-09-23 (Q145: $500 TEST charge, available $0 -> $485.20); the balance monitor is still open.** Scheduled payouts and transfers fail
  with "insufficient available funds" (09-22). Top it up with the 0077 test
  card, then add a balance monitor so this alerts BEFORE the payouts fail.
- [x] **Q4 DONE 2026-09-23 (measured read-only, cron.job_run_details): today's digests all SUCCEEDED: daily-match-digest 13:12:00Z, sweep-daily-job-digest 14:00:00Z, ops-daily-digest 14:40:00Z (also stalled-completion-reminder 14:00Z, expiring-jobs-push 14:14Z); check_ops_digest_delivery() = {ok:true} at 14:42Z. Recurrence guard: Q30 catch-up (src/test/cronCatchUpPolicy.test.ts + src/test/pglite/cronCatchUp.pglite.mjs). Was: Q4 CAUSE FOUND 2026-09-23 (measured, cron.job_run_details): all three daily digests (daily-match-digest 13:12, sweep-daily-job-digest 14:00, ops-daily-digest 14:40 UTC) failed 2026-09-22 with "job startup timeout" during the DB outage (Q53); last success 2026-09-21. Nothing re-runs a missed slot — that is Q30. Verifying today's 2026-09-23 runs succeed (check at 14:50 UTC).** "Daily ops digest not delivered in 30h" fired twice on 09-22.
  Check whether it has run since, find the cause, and verify tomorrow's
  digest arrives.
- [x] **Q5 DONE 2026-09-23 — owner chose DELETE; ReuploadIdDialog removed.** (Correction 2026-09-23, Q26: the server-side `request_id_reupload` action is still used, by AdminIDVReview's "Another try".) Was: Nothing opens ReuploadIdDialog. No button leads to it. OWNER GUARD: src/test/deadcodeRatchet.test.ts (a new unreachable export fails) + e2e/prod-audit/messyInputForms.ts coverage (a form no control opens fails the coverage test).
  DECISION: should admins be able to request an ID re-upload? Then wire it up
  or delete it.
- [x] **Q6 DONE: the admin Stripe-Identity badge now has an honest label for every idv_status.** Owner clarified 2026-09-23 that users never send an ID to us; Stripe Identity collects it. "ID Not Submitted" was wrong twice: Stripe mid-check (pending/processing) now shows "Stripe Checking", and not started/skipped/none shows "Not Verified". Stripe Verified / ID Verified / Admin Verified / Stripe Flagged are unchanged. Guard adminIdBadgeStates.test.tsx walks every status in profiles_idv_status_check (red on old code: 2 of 3). The seed profiles' id_document_url is legacy data (see Q40). Was: Admin People badge says "ID Not Submitted" on profiles that have
  an id_document_url. It reads a different column. Fix it to use one source
  of truth, and add a check for this class.
- [ ] **Q7 WebKit only: the bottom nav isn't frosted.** Verify on the iOS 26.1
  simulator or a device; fix it if it's real.
- [~] **Q8 Unused exports — ratchet DONE (baseline now 97 exports / 11 types, enforced by deadcodeRatchet.test.ts; red if it rises). Remaining: review the 97 with the owner.** Was: 160 at baseline, 63 dropped by e16ebdcc3.
  Lower scripts/deadcode-baseline.json to match. The ratchet test fails if the
  count rises. Review the rest with the owner (a report, not auto-delete).
- [ ] **Q9 The required review of money/authz/data-model diffs is skipped.**
  Agents skipped it (that is how the javascript: href reached main). Add
  something that CATCHES a data-model/authz commit landing without a recorded
  review, e.g. a review-log entry that CI checks for commits touching
  supabase/migrations or RLS-sensitive files. It reports; it does not block.
- [ ] **Q10 Owner-side, carried over:** release dispute 9756a585's payout;
  **ANSWERED 2026-09-23:** dispute 9756a585 (seed): Claude settles it in TEST mode (work item Q148); Stripe payouts: MANUAL — DONE 2026-09-23 by Claude in the owner's Chrome (Settings > Payouts > Manual payouts, saved, re-read after reload; no test-mode banner, so the live account); sales tax: Stripe collects it (create-payment already sends automatic_tax enabled; Louisiana IS registered and collecting (checked in the Stripe dashboard 2026-09-23: Tax > Locations, 1 registration, collecting); filing is NOT set up there ('Set up filing') — OWNER: decide whether Stripe files the returns); right-panel overlap: owner asked Claude to audit it (Q151).
  set Stripe payouts to manual; decide Louisiana sales tax; send a screenshot
  or window width for the right-panel overlap.
- [x] **Stored-XSS class: user-writable URL column -> raw href** (follow-up to
  3c81624d0). 8 sinks fixed via safeDocumentUrl (HelperWorkPhotos on public
  profiles, JobCardPhotoStrip, admin JobDetailDialog, DocumentsTab x3,
  DetailHeader, MarketingQueue); DB CHECKs on profiles.avatar_url /
  portfolio_urls / jobs.photos (migration 20260923042014); class check
  `src/test/navigationSinksAreClassified.test.ts` (red on 737821bfa) + eslint
  rule. Still open below.
- [ ] **Admin DocumentsTab can't open a portfolio STORAGE PATH.**
  complete-signup stores portfolio uploads as `user-documents` paths; the tab
  now shows them as "Link withheld (not https)" (before: a broken relative
  link). Sign them at display time like id_document_url. 0 such rows on prod
  2026-09-23.
- [ ] **`blankComments()` desyncs on a regex literal containing `'`**
  (src/test/helpers/blankNonCode.ts; e.g. src/lib/chunkReload.ts:27): every
  comment after that point in the file is kept as code, so guards built on it
  can see comment prose as calls. Found 2026-09-23; not fixed (shared helper,
  report only). navigationSinksAreClassified uses the TS AST instead.

## QUEUE (cont.) — gaps measured 2026-09-23 (owner: "anything at all")

- [ ] **Q11 Sentry issues are "resolved" while they keep firing.** JAVASCRIPT-1H
  "socket closed: 1005": 66 events, 4 users, last seen 1h ago, status resolved.
  The 09-22 profile-timeout issues -> "We couldn't load your account" error
  screen are also resolved with no fix recorded. Find out what resolves them
  (auto-resolve setting? a script?). Feed Sentry into the Q1 ledger; a regression
  must reopen it.
- [x] **Q12 DONE (measured 2026-09-23): not recurring; PROTECTED since Q39 landed (b3891a7d2): a real person seeing this screen is now an open ops-alert-ledger item (source_kind user-error-screen), and the owner's 2026-09-22 occurrence is that item (backfilled, count 4). GUARD: src/test/errorSurfacesReport.test.tsx + src/test/pglite/userErrorScreenLedger.pglite.mjs.** 14 days of error_logs: 1 non-seed occurrence, the OWNER's account at 2026-09-22 15:10Z, right after the pg_cron/DB outage window (14:00-15:00Z). The rest were E2E test accounts (09-13, 09-15). Follow-up is Q39. Was: A real user saw "We couldn't load your account" (Sentry 2F/2E/2G, protection built by Q39 (was: PROTECTION NOT YET BUILT).
  09-22, profile request timed out). Was it the pg_cron outage window, or does it
  still happen? Measure the profile-fetch timeout rate.
- [x] **Q13 DONE (2026-09-23): script-src has no `'unsafe-inline'`** in vercel.json,
  index.html's Capacitor meta or public/_headers. Measured inventory (built dist/):
  3 inline scripts in index.html (storage probe, boot watchdog, pre-paint theme),
  1 in offline.html, 1 in tools/apple-jwt.html, 2 JSON-LD data blocks (not
  executed, not governed), and ONE inline handler: the async-CSS
  `onload="this.media='all'"` from vite.config.ts. That handler was the trap:
  dropping 'unsafe-inline' alone left the whole app UNSTYLED (media=print, Times)
  in Chromium and WebKit. It is now a hashed swap `<script>`. Each inline script
  is allowed by its sha256. No runtime inline scripts (MapKit is loaded by
  src=; Stripe is a redirect; PostHog external loading is off). Verified on a
  prod build served with the vercel.json headers, both engines: boot, /login,
  /browse, /dashboard (authed), /profile, MapKit map, Upgrade to Stripe sandbox
  checkout, boot watchdog reload, offline.html retry; a `javascript:` href, a
  script-inserted inline script and an `onerror=` handler are all blocked.
  Guards: `src/test/cspScriptSrc.test.ts` (source) and
  `scripts/check-csp-inline-scripts.mjs` (end of `npm run build` and `build:ios`,
  so Vercel refuses a bundle whose inline script lost its hash).
  Left open: (a) style-src still has `'unsafe-inline'`. React `style=` props and
  the boot shell need it; lower risk (no script execution). (b) Every page logs
  one `script-src eval` violation, and it was already there before this change:
  zod v4's `allowsEval` probe (`Function("")` in try/catch, forms chunk). It is
  harmless, and `z.config({ jitless: true })` would silence it. (c) public/_headers
  is Netlify-format and Vercel ignores it. It was kept in sync, but it is dead config.
  (d) Not device-tested in a native WKWebView. The Capacitor build's meta CSP was
  checked in desktop WebKit over http only.
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
  - Leaked-password protection is OFF (Auth setting). It may need a paid plan,
    so check the free tier first.
- [ ] **Q15 Realtime "socket closed: 1005"**: 66 events, the top Sentry issue.
  Recovery works (it's reported as recovered), but decide whether it's noise to
  handle quietly or a real reconnect storm.
- [ ] **Q16 This file is 7,600+ lines with ~205 open checkboxes.** The one
  open-work list has become unreadable. Triage it: close what's done (verified),
  archive history to docs/archive/, keep OPEN.md to live items.
- [x] **Q17 DONE: npm audit --omit=dev = 0 vulnerabilities.** The 3 were one chain, @capacitor/cli -> xcode -> uuid <11.1.1 (buffer bounds check when a buf is passed). @capacitor/cli is a build-time CLI, never bundled, and is now a devDependency, as Capacitor's own setup has it. The dev-tree uuid is unreachable: xcode only calls uuid.v4() with no buf (pbxProject.js:90). Was: npm audit (prod deps): 3 moderate: @capacitor/cli, uuid, xcode. GUARD: .github/workflows/security-audit.yml fails on MODERATE prod advisories (was critical-only).
  Upgrade or document why each is unreachable.
- [ ] **Q18 Agent isolation leak.** A worktree-isolated agent reported its cwd was
  swapped to the SHARED main checkout mid-task (FormSpec lane, 2026-09-23). It
  noticed and moved, but a less careful one would have committed from the shared
  tree. Detect it: the commit hook refuses when the committing process's worktree
  isn't the one it started in, or at least warns.
- [ ] **Q19 Wider product/UX gap pass.** Run lh-suggester (core-loop friction,
  missing product, growth) and an lh-audit pass on the screens touched tonight,
  then queue what they find.

## QUEUE (cont.) — added 2026-09-23 late

- [x] **Q20 DONE (9a0f7e61f): outside Central time, helpers saw TWO primary
  buttons ("I'm On My Way" + "I'm Still On") or NONE for hours around midnight.**
  HelperTrackerPanel measured the job day from device-local midnight, while
  JobConfirmation measured it from Central midnight. Affected: UTC devices
  19:00-24:00 Central, New York 23:00-24:00, Los Angeles none 00:00-02:00 the
  next day. Class check helperTrackerPrimarySweep.tz.test.tsx runs 72h x 4
  zones. vitest.config.ts now has a `tz-sweep` project on the forks pool; its
  first full CI run is the proof.
- [x] **Q21 DONE: the two remaining job-date sites that used the device zone now use Central.** (1) The browse feed hid a job once the READER's calendar passed its date, so a UTC-set phone dropped every Louisiana job dated today from 19:00 Central. It now uses jobDayHasEnded (src/lib/jobDate.ts: next Central midnight). (2) The "add to calendar" tile anchored the event at the reader's midnight; it now uses jobDateMs. Class check: src/lib/jobDayHasEnded.tz.test.ts sweeps 5 device zones x 6 instants (tz-sweep project; red 5/6 when mutated). The other parseLocalDate callers are not job-time math (date picker, birthday, display formatting). Was: Other `parseLocalDate(date_needed)` "time until job" math may
  have the same device-timezone bug (not searched). Sweep src/, then extend the
  tz-sweep test to each site.
- [x] **Q22 DONE: independent review (lh-authz-rls, verified live) found NO remaining or new XSS sink**; grants, constraints and every writer check out. Was: Independent review of the href-class commits (3c81624d0, GUARD: src/test/navigationSinksAreClassified.test.ts + src/test/storagePathRenderIsAllowlisted.test.ts + migration 20260923042014 CHECKs.
  dd4713c00, 724cb5a67, 5e7cc4832, migration 20260923042014). In progress
  (lh-authz-rls, review only).
- [x] **Q23 FOLDED INTO Q40 2026-09-23 (measured): the ONLY writer of bare storage paths into profiles.portfolio_urls is complete-signup's `portfolioFiles` (supabase/functions/complete-signup/index.ts:539,723), which no client sends; REMOVED 2026-09-23 with Q40; the profile editor (usePortfolio.ts / portfolioStorage.ts) stores public URLs, which DocumentsTab already opens. Live: 0 profiles have any portfolio_urls entry, 0 non-URL entries. NO-GUARD: nothing writes storage paths once Q40 removes the only writer, and Q40's own guard covers that writer. Was:** Admin DocumentsTab can't open portfolio STORAGE PATHS. They need
  signing at display time. 0 such rows exist on prod today.
- [x] **Q24 DONE 2026-09-23: the shared comment scanner (src/test/helpers/blankNonCode.ts) recognises regex literals, so a lone `'` in a regex no longer swallows later comments; 61 guards using it pass; also moved src/test/fundedOpenJobPlan.test.ts job dates out of the present era (a pre-existing jobDayFixtureTimezone red). Guard: src/test/blankNonCodeRegexLiteral.test.ts (red on the old scanner). Was:** Shared test helper bug: blankComments() (src/test/helpers/blankNonCode.ts)
  loses track after a regex literal containing `'` (src/lib/chunkReload.ts:27),
  so guards built on it read later comments as code. Fix it, and add a fixture.
- [x] **Q25 DONE (2026-09-23): a dispatch now diffs from the head SHA of the last SUCCESSFUL db-deploy run on main** (read through the Actions API; `actions: read` added to migration-lint.yml and to db-deploy's call of it), so it lints exactly what landed since the last good deploy, each file in full. No base found, or a base that is not an ancestor of HEAD, still falls back to linting ALL migrations, never none. The whole-history fallback is still red on settled history (check-migration-grants and check-trigger-timing, which judge files in isolation; documented in the step). GUARD: src/test/migrationLintRls.test.ts runs the workflow's own "Find changed migrations" shell in a scratch repo with a fake `gh` (last-good base -> only the new file; failed/empty/unknown/non-ancestor base -> lint all), 4 @mutate lines killed. Was: db-deploy on MANUAL dispatch lints all 756 migrations instead
  of the new ones (its diff base is wrong for workflow_dispatch), so a manual
  re-run is always red (35818674216). Fix the diff base for dispatch.
- [x] **Q26 CLOSED 2026-09-23: NOT dead code (measured).** `request_id_reupload` is called by src/components/admin/AdminIDVReview.tsx ("Another try": resets IDV to not_started for a fresh Stripe Identity attempt, lines 93/158/377), and _shared/email-templates/admin-action.tsx renders its email. It never belonged to the deleted ReuploadIdDialog. NO-GUARD: nothing to prevent; the report's premise was wrong. Was: Server-side ID re-upload action + email template are unused** now
  that ReuploadIdDialog is gone (Q5). This is a report: count the callers, then
  let the owner decide.
- [x] **Q27 DONE (de19e4b14, e31b23c4d, 726dba74a, 801555189, 5152014f3): all 37 triaged.** Real fixes: aria-pressed on 18 selected-option buttons (selectedStateIsExposed guard); "Edge Function returned a non-2xx" replaced by the server message at 8 sites (edgeFunctionErrorReachesTheUser guard); "Finish Paying" now behind the sweep payment gate; auto-tip Save confirms; Add-Admin search disabled when empty; create-payment 500 no longer echoes raw Stripe text. Everything else fixed in the harness. NEXT: re-dispatch press after prod-audit finishes. Was: Press sweep: 37 left (from 126). Triage in progress: about 25 are the GUARD: src/test/selectedStateIsExposed.test.ts, src/test/edgeFunctionErrorReachesTheUser.test.ts, src/test/pressRun35813177418.test.ts, and the nightly press-every-control.yml.
  sweep re-pressing the already-selected option; real candidates are the
  /complete-profile checkbox, admin Manual Override > Re-open, silent auto-tip
  Save, and the create-payment 429.
- [ ] **Q28 Vacuity found a hollow MONEY guard.** ALSO (2026-09-23, twice in one night): "pre-guard baseline" tests (raceClassGuard, and others built on latestDefinition(name, [EXCLUDED_VERSIONS])) break every time a later migration restates the whole function, and each needs its exclusion list hand-extended. Derive the baseline as "the newest definition OLDER than the guard-adding migration" instead of an exclusion list, so restatements can't break it. ALSO (2026-09-23): cronFailureAlertDoesNotDependOnCron parsed only `$fn$` bodies, so it silently read the PREVIOUS definition when 20260923050055 used `$function$` (409 migrations use $function$, 379 use $$, 40 $fn$, 4 $body$), and a revert of the Q33 fix stayed green. Fixed (any tag, plus a "reads the newest definition" test). The class to close: every migration-reading guard shares one parser that handles any dollar tag and fails if it can't parse the newest definition. disputeClosedWithoutPayment
  matched a comment (FIXED d8f71e47d). Look for the same "toContain matches a
  comment" shape in other source-scanning guards. A shared code-only reader
  would close the class (ties to Q24).
- [x] **Q29 DONE (measured 2026-09-23): all 51 archived DLQ messages were addressed to TEST accounts.** 50 tx to helpr-e2e-helper-0902 / helpr-seed-heavy-0912 @mailinator (is_seed), 1 auth to helpr-e2e-poster-0902 (is_seed). No real user lost an email. Follow-up moved to Q2: (a) why seed/mailinator mail dead-letters at all; (b) archiving a DLQ satisfies the ledger's depth check, so archiving a REAL user's email would close the alert silently. Make the DLQ verify rule require an audit row per non-seed recipient. Was: 51 dead-lettered emails were ARCHIVED, not resent (pgmq archive, PROTECTION BUILT 2026-09-23 (migration 20260923052520, live): ops_alert_condition('email-dlq-*') is cleared only when every dead letter to a NON-seed recipient, queued or ARCHIVED, has a later 'sent' email_send_log row to that recipient for that template; seed-only DLQs report as 'email-dlq-*-seed' to the digest. Proven in PGlite (~/.lh-pglite/pgl-q2-seed.mjs): real recipient archived with an empty queue -> still failing; earlier 'sent' only -> still failing; later 'sent' -> cleared. Guard: src/test/alertingDetectorsDeclareSeedPolicy.test.ts.
  2026-09-22 16:25 UTC): 1 auth email (sign-in, signup confirmation or password
  reset) and 50 app emails. Find the recipients. Resend to any real (non-seed)
  user whose email still matters, and record what happened. Then make archiving
  a DLQ without resending impossible to do silently: the Q1 ledger gets a line.
- [x] **Q30 DONE (2026-09-23, migration 20260923133021, live): a missed daily/weekly cron slot is re-run ONCE when the DB is healthy, or it opens a ledger item.** Inventory (live cron.job 2026-09-23): 23 daily/weekly jobs (22 daily + weekly-helper-report); every-few-minutes/hours jobs self-heal and are out of scope. cron_catchup_policy holds all 23 with a reason each: 18 catch-up-safe (digests, monitors, read-only money-reconciliation, TTL prunes, self-deduping nudges; max_late 20h, 6h for user-facing sends), 5 never re-run (charge-recurring-visits, expire-subscriptions, subscription-reconciliation, cleanup-abandoned-accounts, weekly-helper-report). run_missed_cron_catch_up() (cron 'cron-missed-slot-catch-up' '9-59/10 * * * *', liveness 1h): the latest slot is >= 10 min old, no run succeeded or is running since, and the job provably existed -> safe + within max_late + healthy (>= 1 success and < 3 failures in 15 min) EXECUTEs the job's own command once and writes a 'cron-caught-up' warning (ledger item, closes when the next regular run succeeds); anything else writes a 'cron-missed-slot' error (manual ledger item). A daily job with no policy row is treated as unsafe. cron_catchup_runs (PK job+slot) = never twice; pg_try_advisory_xact_lock + lock_timeout 200ms = never waits. GUARDS: src/test/cronCatchUpPolicy.test.ts (inventory parsed from the migrations incl. cron.alter_job re-timings, equal to live on 2026-09-23; floor; policy == inventory and safe set == allowlist, both two-way; money/delete names never safe; function claims before EXECUTE; 5 @mutate, all killed; 6/7 tests red without the migration) and src/test/pglite/cronCatchUp.pglite.mjs (applied 3x; ALL PASS: a safe missed slot runs once over 3 ticks, money/unclassified/too-late are not run, unhealthy defers without claiming, a raising catch-up is not retried; SKIP_MIGRATION=1 -> 67 FAILED). LIVE: function/policy/cron/grants verified (proacl postgres+service_role only, search_path public,pg_temp, RLS on both tables, 23 rows/18 safe, bodies md5-equal to the migration). FIRST TICK 13:39:00Z: sweep-old-error-logs (03:45Z today, "connection failed") CAUGHT UP; the 4 slots lost on 09-22 (ops-daily-digest, sweep-daily-job-digest, stalled-completion-reminder, expiring-jobs-push) filed as alerted_too_late ledger items (manual; their message says "the database was not healthy again within its window", which is imprecise for these four: the catch-up did not exist yet). Needs an lh-silent-failure REVIEW-ONLY pass. Was: ops-daily-digest (14:40 UTC) fell inside the 09-22 pg_cron outage (14:00-15:00), so no digest ran from 09-21 14:40 until the next slot, 38h+.
- [x] **Q188 DONE 2026-09-23: the function skips any helper with a report in the last 6 days and fails closed (500, no sends) if that read errors; it now joins the catch-up-safe set (migration 20260923145117, PGlite 3x: 25 rows, 21 safe). GUARD: src/test/edge/weekly-helper-report.test.ts (2 new cases red on the old function; @mutate) + src/test/cronCatchUpPolicy.test.ts. Was:** weekly-helper-report has no send-dedupe of its own (found by Q30, 2026-09-23).** No sent-marker in supabase/functions/weekly-helper-report (grep for sent_at/dedupe/already: none), so any second invocation in a week (manual re-run, retry) emails every Helpr twice; that is why Q30 lists it as NOT catch-up-safe. Add a per-helper per-week sent marker, with a test that a second run sends nothing, then it can join the catch-up allowlist.
- [x] **Q31 DONE (measured 2026-09-23 05:00Z): healthy since the 30s timeout change.** 0 cron-http/cron-dead failures after 22:35Z (last 20:15Z, during the timeout era); pg_cron failures only 08:00-14:00Z (the outage). All 79 cancelled jobs with a PaymentIntent are payment_status refunded (4) or cancelled (75): 0 live holds IN THE DB. Stripe side verified 07:20Z (Q50): all 79 PIs captured then refunded, 0 requires_capture. Ongoing coverage: the ledger cron-dead condition + money-reconciliation, which since 78a88a861 compares every settled job's PaymentIntent with Stripe (guard: src/test/edge/money-reconciliation-stripe.test.ts, 4 @mutate killed). Was: void-cancelled-payments (MONEY: releases card holds on cancelled
  jobs):** 14 "cron-dead: last 3 runs failed" and 46 HTTP 5s timeouts in 24h.
  Check whether it's healthy since the 30s timeout change. If not, customers'
  card holds on cancelled jobs aren't being released. Verify with the count of
  cancelled jobs whose payment intent is still requires_capture.
- [ ] **Q32 10 open PRs are stranded, the oldest from 09-07.** They include
  #1621 (lazy-load Sentry, 71 kB off cold start), #1639 (Sentry error
  normalisation), #1607 (role-neutral copy) and several dependency bumps.
  Land, rebase or close each. Nothing auto-merges green dependency PRs (see
  memory dep-bumps-enable-auto-merge).
- [x] **Q33 DONE (20260923050055): confirmed NOTHING alerted on the 19:00Z burst** (error_logs 19:00-21:00 had no cron row). sweep_cron_startup_failures matched only "startup timeout", and cron-dead needs 3 consecutive failures of one job. It now counts ANY failed run (floor 3 in 20 min, same window dedupe, same source, so the ledger close rule still holds) and names the failure kinds. PGlite: applied 3x; a simulated 18x "connection failed" burst pages fatal; the repeat is deduped; 1 failure stays quiet. The mutation moved to the new migration. Was: A "connection failed" burst: 18 crons at 2026-09-22 19:00 UTC. GUARD: src/test/cronFailureAlertDoesNotDependOnCron.test.ts (red when the fix is reverted, after its parser fix e307ffa9e).
  Not a startup timeout. Confirm whether cron-dead / sweep_cron_startup_failures
  alerted on it; if nothing did, it's a hole in the cron monitoring.
- [ ] **Q34 Press leftovers:** "Copy Mon to all" stays red (the test accounts
  have no availability rows): add fixture data, don't skip. Screenshot AutoTip
  "Saved" and the disabled Add-Admin search at 375. Punctuation: a server
  message ending "?"/"!" gets ". Please try again." appended.
- [ ] **Q35 Exhaustive all-systems gap audit (owner, 2026-09-23: "make sure all
  systems are checked exhaustively for gaps").** Run the launch-audit fleet
  (39 lanes) in waves. Every finding lands in this queue with a check or a
  tracker entry.
- [x] **Q36 DONE (2026-09-23): every monitoring number is generated, bound to its
  measuring run, two-way baselined, or dated — enforced per push.** Owner: "nothing
  at all should ever be stale" and "every number we track ... must always be current".
  Checks (all red-proven on a planted gap, all registered with vacuity @mutate, KILLED):
  `npm run check:generated` (scripts/check-generated-current.mjs — re-runs every
  CI-runnable generator and diffs; registries checked both ways against three scans:
  38 file-writing scripts, 6 self-declared generated files, every timestamped JSON);
  `npm run check:counts` (scripts/check-stated-counts.mjs — 2,260 count claims in 368
  files on 2026-09-23: 172 generated, 891 in dated records, 611 dated, 586 undated,
  the undated ones in an exact two-way baseline that may only shrink);
  `npm run check:staleness` (age only where nothing better proves currency; workflow-bound
  for browser baselines); src/test/baselinesAreTwoWay.test.ts (68 KNOWN_/ALLOWLIST
  constants + 11 baseline JSONs, each must name its stale-entry check; 36 out of scope with
  reasons; 38 stale entries removed). Wired into test.yml, staleness-watch.yml (now also
  on every push, so docs-only commits are covered; added to main-red-watch) and
  `npm run gate`. One-command refresh: `npm run inventories:refresh`.
  Was STALE and is now current (2026-09-23): COVERAGE.md (generated 2026-09-02: "5 of 39
  lanes reported" → 38 of 46; surface "unknown" and 12 of 13 class counts "?" — parser
  bugs); ROLLUP.md vs COVERAGE.md disagreed on open findings (397 vs 284: two folds, one
  counted fixed as live) → one fold, 334 open / 29 open blockers; SURFACE.md prose 139/109
  overlays vs its own table 151/117, notification types 21 vs prod's 18 (parser read
  unrelated statements); form-inventory 119/22 → 118/24; GUARD-BURNDOWN score was hand-typed
  → generated block; lh-audit SKILL "/profile has 18 tabs" (25; list wrong); lh-verifier and
  lh-copy-content surface counts (802 → 1,064 etc.); edge functions 66 → 73; workflows 24 →
  45; happy-path specs 26 → 28; "~20 sweep functions" → 54 active pg_cron jobs; "~108 tables"
  → 81; redirect-only routes 14 → 17; check-staleness REFRESH named audit:press for a ledger
  it never writes; measurements.json invisible to the age scan (`at` key).
  Inventory (2026-09-23; `node scripts/check-generated-current.mjs --list` prints it live):
  | file | generator | how refreshed | how checked |
  |---|---|---|---|
  | launch-2026-09/SURFACE.md | audit-surface.mjs | committer (`inventories:refresh`) | regenerate-and-diff, every push + nightly |
  | launch-2026-09/ROLLUP.md | audit-bus.mjs rollup | committer | regenerate-and-diff |
  | launch-2026-09/COVERAGE.md | audit-coverage.mjs | committer | regenerate-and-diff |
  | audit/form-inventory.md | form-inventory.mjs | committer | regenerate-and-diff |
  | public/sitemap.xml | generate-sitemap.mjs | committer | regenerate-and-diff (+ sitemap-drift.yml) |
  | audit/vacuity-report.json | vacuity --report --no-mutate | committer | regenerate-and-diff (timestamp normalised) |
  | GUARD-BURNDOWN.md score block | burndown-score.mjs | committer | regenerate-and-diff |
  | loading-states/measurements.json | measure-loading-states.mjs (browser, prod) | loading-states-refresh.yml daily 16:17 UTC (artifact) | check-loading-state-shape on the fresh set in that run; staleness: last success ≤ 2 days |
  | write-contract.snapshot.json | write-contract.mjs (prod) | write-contract-refresh.yml weekly | --check-drift |
  | supabase/types.ts | db:types (prod) | committer after a migration | check-types-fresh (db-deploy, db-drift-detect) |
  | overlay-sweep.baseline.json | overlay-sweep.spec.ts (browser, prod) | ui-sweep.yml Friday cron | staleness: last Friday scheduled success ≤ 8 days |
  | vacuity.baseline.json, controlInteractionLedger.json, loading-states/baseline.json, stated-counts-baseline.json, and every list in baselinesAreTwoWay | hand-lowered | same commit as the fix | own two-way guard, every push |
  STILL OPEN from this item: (a) **owner setting** — GitHub Actions may not push to main or
  open PRs here (`can_approve_pull_request_reviews=false`), so a nightly refresh cannot land
  its snapshot in git by itself; currency is proven by the run instead, and landing the
  artifact is a manual commit. (b) 583 undated counts are baselined, 153 of them in this
  file — burn down by dating or deleting. (c) docs/audit/OPEN_ITEMS.md is 935 commits
  behind (staleness red): superseded by this file, needs a reconcile-or-retire decision.
  (d) overlay-sweep's stale check is only the deterministic half (spec header, 2026-09-21).
  (e) vacuity is red on main from two other-lane registrations (adminIdBadgeStates
  unescaped `|`, helperWorkPhotos find-string gone).
- [x] **Q37 DONE: not reachable today, and it can no longer render broken.** No client sends portfolioFiles to complete-signup, and prod has 0 portfolio elements. HelperWorkPhotos now renders only safeDocumentUrl-displayable entries: a bare private path or an unsafe scheme is dropped, never shown as a broken tile. Test added (red on the old code: 2 of 5). The dead portfolioFiles path in complete-signup (private user-documents, "1-year signed URL" comment that no longer matches the code) folds into Q40. Was: Portfolio photos from signup render BROKEN on the public profile. GUARD: src/test/helperWorkPhotos.test.tsx (red on the old component).
  complete-signup stores portfolio_urls as bare storage paths
  (index.ts:516,700); HelperWorkPhotos.tsx:45 uses them directly as <img src>,
  which resolves against the app origin. Sign them at display time (ties to
  Q23), with a check that every portfolio reader resolves paths. Found by the
  Q22 review.
- [x] **Q38 DONE: scripts/check-unvalidated-constraints.mjs runs after every db-deploy and nightly in db-drift-detect.** Live 2026-09-23: 281 public constraints, all validated (the only NOT VALID one on prod is Supabase-owned realtime.messages). --inject-fake exits 1; a read under 50 constraints refuses to report clean. Was: No watch for NOT VALID constraints on user-written tables. If a
  VALIDATE ever fails, the migration only logs a WARNING, and every later
  UPDATE of that row fails with an opaque check_violation. Add a live check
  (pg_constraint.convalidated = false on public tables) to db-deploy post-apply
  and to the drift detector.
- [x] **Q103 DONE 2026-09-23. (1) Re-measured ON PROD (edge_logs, get_my_pending_direct_offers per user_blocks request, hourly): ~1.9 from 00:00-10:00Z (pre-change builds), ~1.0 from 11:00Z on (14:00Z: 1814/2299). (2) Unread-messages pair deduped: useNavUnreadCount is now one reference-counted store per user (one query + one realtime channel), and DesktopSidebarNav reads it instead of running its own copy. GUARD: src/test/hotQueryLoad.test.ts "useNavUnreadCount" block (3 cases red on the old code; @mutate on the store lookup). Was:** Re-measure the nav-badge cut ON PROD, then dedupe the unread-messages pair the same way (Q53 follow-up).
  Q53 halved useActivityBadgeCounts per page load (fake-transport count
  2 rpc / 2 counts / 2 channels -> 1/1/1), but no prod session built from
  82c0f6992 or later had run by 09:30Z 2026-09-23: every 127.0.0.1:4173 /
  :4298 session still showed ~2.0 get_my_pending_direct_offers per
  user_blocks request (press run 35837735324 is on e96adc16d, pre-change).
  Re-run the edge_logs ratio (offers / user_blocks per referer) after the next
  press or journeys run on new code; expect ~1.0. Then: on desktop MobileNav's
  useNavUnreadCount AND DesktopSidebarNav's mirrored unread query both run
  (messages: 24,549 CI requests in 24 h) — same shared-store treatment, and add
  it to src/test/hotQueryLoad.test.ts.
- [ ] **Q104 CI browser suites are ~94% of prod REST traffic; give each a measured load budget (Q53 follow-up, ties to Q60).**
  24 h to 09:00Z 2026-09-23: 105,824 of >=112,356 badge requests came from
  127.0.0.1:4173 (CI preview builds); REST from that referer peaked at
  104,445 requests in the 03:00Z hour (~29/s) with no real users. One press
  admin session made 18,035 REST calls in 29 min. Record requests/min per
  workflow run (edge_logs by run window), set a ceiling below the level the
  db-saturation-check thresholds trip at, and fail the run that exceeds it.
- [ ] **Q105 Realtime is the largest DB cost; measure and cut it (Q53 follow-up).**
  pg_stat_statements 15:23Z 09-22 -> 08:54Z 09-23: realtime.list_changes
  121,403 calls / 1,124 s (35% of all 3,200 s of SQL time) plus the
  publication scan 271,282 calls / 211 s; 136 live realtime.subscription rows
  at ~09:10Z, nearly all CI sessions (notifications 41, jobs 37,
  applications 32, messages 21). Q53 halved the nav-badge channels; re-count
  subscriptions after Q103's re-measure, check which of the 10 published tables
  any client still subscribes to, and drop the rest from supabase_realtime.
  Also noticed: sweep_dead_crons() costs 1.0 s per hourly run (17 calls,
  17.1 s) — EXPLAIN it the way Q53 did sweep_silent_cron_failures.

## MORNING QUESTIONS (held overnight 2026-09-23 while the owner sleeps)

1. **Sentry read token (Q11).** The existing SENTRY_AUTH_TOKEN is an upload
   token (403 on reading issues), so the alert ledger can't sync Sentry. You
   said "you can do it", but creating and copying an API token is a credential
   step I'm not allowed to do. It takes about 2 minutes: Sentry -> Settings ->
   Auth Tokens (or Custom Integrations) -> new token with `project:read` +
   `event:read` -> `gh secret set SENTRY_READ_TOKEN`. I'll wire the sync to
   that name, so it closes the "Sentry not synced" ledger item on the next hourly run.
- [x] **Q39 DONE (2026-09-23, b3891a7d2 + migration 20260923085642, live): a real person's error screen is an ops alert ledger item.**
  Every error surface sends `tags.kind = "user-error-screen"` (ErrorState, the
  three boundaries, the boot watchdog, and via `<ReportErrorScreen>` the four
  hand-drawn pane cards that reported nothing before: ChatTimeline,
  ApplicantsErrorState, SavedSearches, NotificationPanel).
  `trg_error_logs_zz_user_error_screen` records non-seed rows (guest / no
  profile = real) under source_kind `user-error-screen`, fingerprint = screen +
  normalised message, severity fixed `error`; a new item is refused past 5
  screens/person/hour or 20 new items/hour and counted on ONE overflow item.
  Close rule `ops_alert_condition('user-error-screen')`: still failing while
  error_logs holds a real person's row for it < 24h old. Measured live
  2026-09-23 09:13Z: backfill opened 1 item (the owner's 09-22 /profile
  screen, count 4, condition TRUE until 15:10Z); a rolled-back probe showed a
  guest row opens an item and a seed user's row does not; all 5 new functions
  proacl = postgres + service_role only. GUARDS: src/test/errorSurfacesReport.test.tsx
  (kind on every render; source inventory of error-copy files, floor > 40;
  4 @mutate, all KILLED) and src/test/pglite/userErrorScreenLedger.pglite.mjs
  (3x apply; real/seed/flood/cap/24h; red on 4 planted defects). The synthetic
  route-check half of the close rule is Q94. Found while measuring Q12.
- [ ] **Q94 The user-error-screen close rule has no synthetic half (Q39 follow-up).**
  Owner spec: close only when the screen went 24h without a real person seeing
  it AND a synthetic check of that route passes. Only the 24h half exists:
  nothing that probes routes (press-every-control, prod-audit, the journeys)
  writes a per-route pass/fail where SQL can read it. Needs a small
  `ops_route_probe(route, passed_at)` written by the press run, and the
  condition requiring a pass after last_seen for the item's screen.
- [x] **Q95 DONE: vacuity + typecheck reds fixed (2026-09-23).** Each find-string is now unique (multi-line `\n` context), `|` escaped, the queue guard's mutation strips Q21's only guard path, and the EF-5 mutation drops the whole exemption. Measured: `node scripts/vacuity/index.mjs` 15/15 killed on the five guards. The e2e skip files were added to tsconfig.app.json include (TS6307 gone). Guard: scripts/vacuity/index.mjs refuses an ambiguous or malformed @mutate (vacuity.yml on every push). Was:
  dbRestoreDrill.test.ts ("FAIL=1" occurs 9x in db-restore-drill.sh),
  edge/error-leak-EF5.test.ts (find-string occurs 2x), edge/includeSeedAlertRouting.test.ts
  ("seed: seedJobIds.has(job.id)," occurs 8x), edge/money-reconciliation.test.ts
  (unescaped `|`). Each needs a unique find-string or `\|`.
  Also on main at efdfea573 (Vacuity run 35841787397): queueItemsNameTheirGuard.test.ts
  SURVIVED its own @mutate (appending "(no guard)" to Q21's title removes no
  guard name, so it cannot fail); and Test run 35841787312 is red on
  typecheck: src/test/e2eSkipsAreJustified.test.ts imports e2e/*.ts files
  outside the tsconfig include (TS6307). Neither is from the Q39 change.
- [x] **Q96 A user can keep an error-screen alert open for ever (MEDIUM, Q39 review 2026-09-23).** ops_alert_record_user_error_screen (20260923085642:148-176) rate-limits only NEW items (5/hr per person, 20/hr global). Repeats of an existing fingerprint are unlimited, so one account looping POST /rest/v1/error_logs grows error_logs + ledger count without bound and holds the item open (close rule = a real row in the last 24h). Fix: cap repeats per account per fingerprint per window; guard with a PGlite test that is red on the uncapped function. DONE 2026-09-23 (20260923092838): a repeat of a known screen bumps the ledger only while that account hit that normalised fingerprint <= 5 times in the hour (guests share 20); over the cap the row is still stored and the close rule (error_logs, 24h) is unchanged, so genuine recurrence keeps it open. Guard: src/test/userErrorScreenAbuseCaps.test.ts (4 @mutate, all killed; 4 of 9 red on the unfixed definitions); behaviour: src/test/pglite/userErrorScreenRepeatCap.pglite.mjs (30 hits -> count 5, was 30).
- [x] **Q97 error_log_is_seed trusts the client's tags.seed (LOW, Q39 review 2026-09-23).** A real account tagging {"seed":"true"} hides its own genuine error screens from the ledger and Slack routing (20260923052520:49-59). Fix: for client-origin rows derive seed from profiles.is_seed, not the tag; guard red on the current function. DONE 2026-09-23 (20260923092838): error_log_is_seed ignores tags.seed / a '-seed' source when tags.origin = 'client'; user_error_screen_is_real decides from profiles.is_seed. Server rows keep the tag (its two server callers return for client rows first). Guard: src/test/userErrorScreenAbuseCaps.test.ts; behaviour: src/test/pglite/userErrorScreenRepeatCap.pglite.mjs.
- [x] **Q98 Client error_logs inserts have no rate limit (LOW, found fixing Q96 2026-09-23).** Q96 stops a looping account bumping the ledger, but every row is still stored: one authenticated or anon client looping POST /rest/v1/error_logs grows the table without bound (live 2026-09-23: error_logs has 4 triggers, none throttles; stamp_error_log_origin, notify_slack_on_error_log, ops_alert_ledger_from_error_log, ops_alert_ledger_from_user_error_screen). Needs a per-user/per-IP insert cap or a retention prune, with a guard red on the uncapped path. DONE 2026-09-23 (20260923094457): new BEFORE INSERT trg_error_logs_01_throttle -> throttle_client_error_log (SECURITY DEFINER, runs after the origin stamp) silently drops (RETURN NULL, never raises; own failures keep the row) a client-origin row once that account has 60 client rows in the last minute, or all guests together 120; server rows are never throttled. Caps from prod, 30 days to 2026-09-23: peak 20 rows/account/minute (15 among origin-stamped client rows), peak 7 guest browser rows/minute. The origin stamp now also re-stamps created_at := now() on client rows (a client could send created_at and back-date out of any window). Bounded counts (LIMIT cap, 1-minute window; EXPLAIN: index scan on idx_error_logs_created, 0.09 ms). Guard: src/test/errorLogClientIdentityAndThrottle.test.ts (@mutate); behaviour: src/test/pglite/userErrorScreenRepeatCap.pglite.mjs (70 -> 60 stored, one-by-one and batch; guests 120; 400/400 server rows stored).
- [x] **Q110 DONE: a guest with a stale stored session lost its whole error batch (found by the Q106 lane, 2026-09-23).** src/lib/errorLogger.ts sent user_id read from localStorage; under the anon role a non-null id fails RLS, the insert is refused and supabase-js does not throw, so the batch vanished. The client now always sends null and the server stamps the caller from the token (stamp_error_log_origin, Q106). Guard: src/lib/errorLogger.test.ts "never sends a user_id" (red on the old logger: expected the stored id to be null).
- [ ] **Q111 Removing a sent credential hides the picker the dialog promises (Q99 review, 2026-09-23; pre-existing).** On /profile?tab=credentials, pressing X on a sent or rejected document and confirming says "so you can attach a new one", but removeSentDoc sets intent off and the row comes back is_licensed=false, so the whole attach area disappears until the switch is flipped on again. Fix together with MORNING QUESTIONS 6 (what the switches become); guard: a component test that confirms removal and expects the attach picker.
- [x] **Q112 DONE: profileProtectedColumnWrites.test.ts resolved variable payloads by text proximity (Q99 review).** It found `key:` tokens between a payload's declaration and the call, so a spread of a const built elsewhere, a helper or an imported constant could hide a protected column (measured: the old resolver passed `{ ...EMPTY, insurance_url: null }` in CredentialsTab.tsx and a `{ ...BASE }` fixture in src/lib). It now resolves payloads with the TypeScript AST (object literals, spreads, ternaries both branches, `&&`/`||`/`??`, in-file identifiers plus later `x.col =`/`Object.assign`), and anything it cannot follow is UNRESOLVED and fails unless in the exact two-way KNOWN_UNRESOLVED (empty: 0 of 23 writes unresolved on 2026-09-23). Guard: src/test/profileProtectedColumnWrites.test.ts "resolves every payload it inspects" + "payload resolver fixtures (Q112)" (spread, ternary, helper, import, computed key); new @mutate `...EMPTY` spread killed.
- [x] **Q113 DONE (2026-09-23, migration 20260923100454, live): one anonymous caller can no longer blind guest error logging, and drops are visible.** Measured on prod over 30 days of guest client rows: 145 rows in 78 active minutes; peak 7 rows/minute; peak 6 rows of ONE fingerprint/minute (p99 6); peak 5 distinct fingerprints/minute. Caps: 20 per guest fingerprint per minute (normalised message + normalised url path, stored as tags.guest_fp, client value overwritten) under a guest bucket raised 120 -> 300; account cap unchanged at 60. Every drop is counted in error_log_throttle_drops (minute x backend pid x kind; record_error_log_throttle_drop: lock_timeout 50ms + lock_not_available fallback, never raises; RLS on, no anon/authenticated grants). check_error_log_throttle (pg_cron */5, cron_work_expectations 20 min) writes source error-log-throttled when drops land in >= 2 of the last 10 complete minutes (at most every 15 min) -> ops_alert_ledger (sql_condition); ops_alert_condition closes it only when the latest COMPLETE minute began after the occurrence and was clean (NULL before that). HONEST LIMIT: a caller who varies the WORDS of each message can still fill the 300 bucket (15+ fingerprints); it can no longer do it silently. A per-client (IP) cap would need a trustworthy client address in PostgREST request headers, which was not verified -> not built. Guards: src/test/errorLogClientIdentityAndThrottle.test.ts (15 @mutate on 20260923100454, all killed by scripts/vacuity), src/test/errorLogTriggersNeverWait.test.ts (reaches record_error_log_throttle_drop; @mutate on its lock_timeout killed), src/test/pglite/userErrorScreenRepeatCap.pglite.mjs (ALL PASS; NEW_MIGRATION=skip-q113 -> 8 FAILED). Needs an lh-authz-rls REVIEW-ONLY pass.
- [x] **Q114 DONE (2026-09-23): the Q106 PGlite proof now runs under RLS.** src/test/pglite/userErrorScreenRepeatCap.pglite.mjs enables RLS on error_logs and creates anyone_can_insert_errors exactly as live pg_policies shows it (PERMISSIVE INSERT TO anon, authenticated, service_role WITH CHECK `((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid)))`). Proven: authenticated user_id NULL passes and is stamped (30/30 stored under the caller); authenticated claiming another uid passes and is stamped to the caller; anon with a non-null user_id is REFUSED ("new row violates row-level security policy"). Able to fail: MUTATE=no-stamp (the Q106 `NEW.user_id := auth.uid();` line replaced) -> 6 FAILED, incl. the other-uid insert refused by RLS. Guard: src/test/pglite/userErrorScreenRepeatCap.pglite.mjs.
- [x] **Q115 DONE (2026-09-23): the happy-path mock and the prod-audit harness no longer describe the actionless credential row Q102 made impossible.** e2e/happy-path/seedData.ts's helper_credentials 68000000-…-0003 (trade_license, 'submitted') now carries a document_url, and its mocked get_pending_credentials RPC filters to trade_license/insurance rows in unverified/submitted WITH a document and returns license_url/insurance_url from the row's own document instead of a hardcoded null (mirrors migration 20260923101130). e2e/prod-audit/harness.ts's ensureMessyInputState() dropped the "attach a document to a document-less pending credential" branch — the CHECK guarantees any row its query returns already has one — and its now-illegal undo (document_url back to NULL). messyInputForms.ts's admin-credential-reject spec still reaches its form from scripts/audit/prod-seed.mjs's seeded trade_license (already carries document_url: PIXEL, unaffected). GUARD: src/test/helperCredentialsPendingDocument.test.ts walks every helper_credentials-shaped literal under e2e/ and scripts/ (floor: 6 rows found, 3 pending) and fails on any trade_license/insurance row in unverified/submitted missing or nulling document_url — fixtureSchemaContract.test.ts deliberately skips this multi-column CHECK, so nothing else caught it. Proven red by reverting seedData.ts's document_url to null (1 offender), green restored; @mutate line included. Not re-run against prod (no browser run in this task) — messyInputForms.ts's admin-credential-reject reachability was verified by reading prod-seed.mjs, not by driving the browser; a prod-audit re-run would confirm it end to end but is not required to close this item.
- [x] **Q117 DONE (2026-09-23): SOURCE FOUND — the Supabase GitHub integration, not an agent. GUARD: scripts/check-migration-provenance.mjs (db-deploy after push + db-drift-detect nightly) fails on any prod migration newer than 20260923103737 without a db-deploy receipt in public.migration_deploy_ledger (migration 20260923103737; tests src/test/migrationProvenance.test.ts, src/test/pglite/migrationProvenance.pglite.mjs). The writer itself is NOT stopped yet: that is Q121 (owner, dashboard).** Measured in prod workflow_run_logs (Supabase Branching, branch 'main' id d604a554-ded1-4193-b8cf-35d01823433c, is_default, created 2026-05-02; `supabase branches list`): it clones main on every push and ran "Applying migration... file=20260923100454_..." at 10:14:19Z and "...20260923101130_..." at 10:21:06Z; postgres_logs show those sessions (6ab3a67b.19258, 6ab3a812.1932f) as user postgres, no application_name. db-deploy's push jobs were not running then (35847561964 push skipped; 35848043318 push 10:21:16-10:21:34, pre-flight failed because its 22444bab4 checkout lacked 101130; 35848225652 push 10:24:14, found nothing). Correction to the report above: 101130 WAS on main when applied (ded04a005, pushed ~10:20:27Z; the integration cloned main at 10:21:00Z). All 24 migrations in the 24h to 10:59Z were applied by the integration, before db-deploy's gates finished. The Q102 lane's claim holds (its only write-shaped statement, 10:25:24Z via MCP, was the refused insert inside a rolled-back transaction). Was: **Q117 A migration reached prod OUTSIDE db-deploy (found by the Q113 lane, 2026-09-23).** 20260923100454 was in supabase_migrations.schema_migrations while its own db-deploy run (35847561964) was red at migration lint and its "Push migrations to prod" job was SKIPPED; 20260923101130 (Q102) was on prod before its file was on main, which then failed db-deploy 35848043318 ("Remote migration versions not found in local migrations directory"). Some session ran `supabase db push` from a local tree (both rows have created_by NULL; no Actions run applied them). Find the writer and stop it (CLAUDE.md: no manual pushes, no side channels); a guard could compare schema_migrations versions against db-deploy runs that reached "Push migrations".
- [x] **Q118 DONE (2026-09-23): Rule 1 is now scripts/check-migration-rls.mjs**, which blanks `--` and (nested) `/* */` comments before matching and keeps string literals, quoted identifiers and dollar-quoted bodies readable (a CREATE TABLE inside EXECUTE '...' is still checked); names now take digits (the 'helper_w' hit was `helper_w9_records` cut at the 9, not a comment). Measured over all 768 migrations: old grep 2 false positives (helper_w, will) + the Q113 original header (IF) = 3; new script 0, with 121 real CREATE TABLEs read. GUARD: src/test/migrationLintRls.test.ts (comment ignored, real DDL caught, `--` in a string not a comment, whole history clean, workflow calls the script), 4 @mutate lines on the script + 1 on the workflow, all killed. Was: migration-lint Rule 1 reads SQL comments as DDL. A header comment "CREATE TABLE IF NOT EXISTS, ..." failed db-deploy 35847561964 as "Table 'IF' created but RLS not enabled"; the whole-history pass (Q25) already flags 'helper_w' (20260609180000) and 'will' (20260915034822) the same way. Strip `--` comments before the CREATE TABLE grep in .github/workflows/migration-lint.yml and prove it on those three.
- [x] **Q120 DONE (2026-09-23, migration 20260923104534): a blank or whitespace-only license_url/insurance_url is absent, not a document.** auto_pending_credentials() now normalises a URL with no non-whitespace character (`!~ '[^[:space:]]'`, a superset of nullif(btrim(..),''): btrim keeps tabs/newlines) to NULL on write; a write that normalises back to the old value is a no-op (so ' ' over a badge review_credential verified from helper_credentials, profile URL NULL, leaves it alone, as a NULL write does); a real path is stored as written and still gives 'pending'. Layers read LIVE: CredentialsTab.tsx writes only the storage path / NULL; tr_prevent_self_escalation fires first (name order) and resets the status columns for a member; the trigger (pg_trigger WHEN on url/business_name change); get_pending_credentials (btrim compensation, unchanged); review_credential, complete-signup (service role, writes 'pending' only with an uploaded path), and readers CredentialBadge, RecognitionRow, AccountPending, useApplicantComparison, useProfileLandingDerived, AdminCredentialQueue, helpr-pass-wallet. Prod before the fix (read-only): 0 of 60 profiles had a blank/whitespace URL, a 'pending' status without a URL, or a flag without a URL (all 60 are none/none), so no data repair. GUARDS: src/test/pglite/blankCredentialUrlIsAbsent.pglite.mjs (live prevent_self_escalation + live trigger verbatim, migration 3x: ALL PASS; NEW_MIGRATION=skip -> 5 FAILED, incl. a member ' ' demoting a verified badge to 'pending') and src/test/blankCredentialUrlIsAbsent.test.ts (newest definition, any dollar tag, comments stripped; 8 @mutate lines, 8/8 killed; 8 FAILED with the migration removed). Was: the trigger treated a URL as present with an untrimmed `<> ''`, so ' ' set license/insurance_status 'pending' and is_licensed/is_insured true with nothing to review; only get_pending_credentials()'s btrim hid it from the admin queue.
- [ ] **Q121 OWNER (dashboard; 2026-09-23 Claude tried in Chrome but Supabase was signed out, and signing in is the owner's step): the Supabase GitHub integration deploys to prod on every push to main, bypassing db-deploy's gates and functions-deploy.yml (found by Q117, 2026-09-23).** Measured: prod workflow_run_logs show it applying all 24 migrations of the 24h to 10:59Z and deploying edge functions ("Deploying Function... slug=...") on each push; branch 'main' d604a554-ded1-4193-b8cf-35d01823433c. Turning off its production deploy (Dashboard > Project Settings > Integrations > GitHub; exact toggle label not verified) is a dashboard action, and I was read-only on prod. Until it is off, the Q117 guard turns db-deploy and db-drift-detect red for every NEW migration (each needs an entry in scripts/audit/migration-provenance.json 'acknowledged', exact). Also stale: two preview branches (fix/migration-timestamp-collision-1779274123, perf/db-hot-path-indexes-pass2) in MIGRATIONS_FAILED since 2026-05-20. Guard for the functions half: none yet.
- [x] **Q122 DONE (2026-09-23, migration 20260923105333, live): error_log_throttle_drops.kind is now drop_kind, so fixtureSchemaContract no longer grades `{ kind: ... }` test literals against it. GUARD: src/test/fixtureSchemaContract.test.ts (the class: red with 40 literals at 0ff197995, green with the rename) + src/test/errorLogClientIdentityAndThrottle.test.ts "Q122: the drop column is drop_kind" (migration, CHECK and types.ts; @mutate-killed) + src/test/pglite/userErrorScreenRepeatCap.pglite.mjs (red with NEW_MIGRATION=skip-q122 and MUTATE=q122-rename-only).** Live 2026-09-23 ~11:07Z: columns minute,backend_pid,drop_kind,dropped,first_at,last_at; CHECK error_log_throttle_drops_drop_kind_check; PK (minute, backend_pid, drop_kind); record_error_log_throttle_drop and check_error_log_throttle name drop_kind, proacl postgres + service_role EXECUTE only, search_path public, pg_temp; ops_alert_condition md5 b3b61466 unchanged (its branch never named the column); cron error-log-throttle-check succeeded at 11:05:00 after the 11:00:27Z apply; a rolled-back record call wrote 1 row. Applied by the Supabase GitHub integration (Q121), acknowledged in scripts/audit/migration-provenance.json. Was: **Q122 Vitest main-red: fixtureSchemaContract grades every `{ kind: ... }` test literal against error_log_throttle_drops (found 2026-09-23).** src/test/fixtureSchemaContract.test.ts "finds no literal a CHECK constraint would refuse" reports 39 literals (40 at 0ff197995, measured 2026-09-23): migration 20260923100454 (Q113) made public.error_log_throttle_drops the only table with a `kind` column, so distinctiveColumns (src/test/helpers/schemaConstraints.ts) attributes every `{ kind: "custom", ... }` literal in src/test and e2e to it and grades it against CHECK kind IN ('guest','guest_fp','account'). Two guard-side rules measured and rejected (half-own-columns left 12 false positives; >=2 own columns cut graded values 840 -> 614). Fix at the source: rename the column to drop_kind (new migration + record_error_log_throttle_drop, check_error_log_throttle).
- [x] **Q129 Vitest main-red at f19d4e53d (run 35852468421, found by the Q122 lane 2026-09-23): 3 guards fail, none from Q122.** (1) src/test/guardsDoNotDeleteSource.test.ts: src/test/blankCredentialUrlIsAbsent.test.ts (Q120) uses a deleting comment stripper; import blankNonCode/blankComments. (2) src/test/guardsReadTheNewestMigration.test.ts: src/test/migrationLintRls.test.ts "pins" 20200101000000_settled.sql, 20500101000000_side.sql, 20990101000000_new.sql, which are synthetic fixture names inside the test, not real migrations: the pin detector or the test needs to tell them apart. (3) src/test/liveCheckScriptsFailClosed.test.ts: scripts/check-migration-provenance.mjs (Q117) is a live-reading script with no HERMETIC case and no NOT_HERMETIC reason. DONE 2026-09-23: (1) blankCredentialUrlIsAbsent now blanks SQL comments with blankSqlComments (all 8 @mutate lines still killed); guard: src/test/guardsDoNotDeleteSource.test.ts. (2) guardsReadTheNewestMigration now excuses a migration name only when the test itself writes it (writeFileSync/writeFile/appendFileSync on the same line) AND no such file exists in supabase/migrations, so a real pin is never hidden; its new case "a fixture a test CREATES is not a pin, and that exemption cannot hide a real one" + @mutate prove it; guard: src/test/guardsReadTheNewestMigration.test.ts. (3) check-migration-provenance.mjs `check` now fails closed by name on an empty schema_migrations read, and is in HERMETIC with 3 cases (no credentials, Management API 500, Management API []), 2 new @mutate lines killed; guard: src/test/liveCheckScriptsFailClosed.test.ts. (4) After rebasing, src/test/credentialUrlIsOwnDocument.test.ts (Q127, landed meanwhile) tripped guard (1) the same way; same fix, its 13 @mutate lines still killed; likewise credentialDocumentExtAgreement.test.ts and helperCredentialDocumentIsOwn.test.ts (Q130/Q133). Environmental issues found on the way: Q135, Q136.
- [x] **Q124 DONE 2026-09-23 (3b8fb67ec): snapshot refreshed from prod; the refresh query never collected column-level SELECT grants, so after jobs moved to per-column SELECT every jobs write that reads back or filters its row was reported REJECTED (22 false rejects; prod created jobs normally). Now collects SELECT (109 jobs columns) and accepts a column SELECT grant for read-back; 3 baseline entries for functions that now exist on prod removed. Guard: src/test/writeContract.test.ts ("the snapshot records column-level SELECT grants"). Was:** write-contract.snapshot.json may be stale on function grants (Q120 lane, 2026-09-23). scripts/audit/write-contract.snapshot.json (last committed 2026-09-15) marks auto_pending_credentials `authenticated: true`; live has_function_privilege('authenticated', ...) is false. The other 176 functions it marks true are unchecked. Re-derive the snapshot from prod, diff, and make whatever check reads it fail when it disagrees with live grants.
- [x] **Q125 DONE: db-deploy's push filter now covers every gate it runs (2026-09-23).** An acknowledgement added to scripts/audit/migration-provenance.json did not re-run db-deploy, because the provenance script, its lib, its config and check-types-fresh.mjs were not in on.push.paths. Added all four. Guard: src/test/dbDeployPathsCoverGates.test.ts (inventory = every `node scripts/...` the workflow runs + each script's ./lib imports and scripts/audit/*.json; red on the old workflow naming exactly those 4 files).
- [x] **Q126 DONE: queue numbers can no longer collide silently (2026-09-23).** Parallel lanes picked the same next number three times tonight (Q103, Q113, Q122), and queueCounts (keyed by number) merged each pair, so the count under-reported too. `node scripts/queue-count.mjs` now prints the next free number and exits 1 on a duplicate; .claude/AGENT-BRIEF.md tells lanes to take the number from it. Guard: src/test/queueItemsNameTheirGuard.test.ts "every queue number is used once" (vacuity killed).
- [x] **Q127 DONE (2026-09-23, migration 20260923110759, a161f37aa): a credential URL must be the member's own uploaded document, and a submitted one cannot be swapped in storage.** Was: auto_pending_credentials accepted any license_url/insurance_url with one non-[:space:] character, so U+200B/U+FEFF/U+2060, a URL, a bare file name or another member's path reached 'pending' + is_licensed; and four member UPDATE/DELETE policies on user-documents let a member upsert over, or delete-and-reupload, a verified object. Now a changed non-NULL URL must match ^<user_id>/credentials/<kind>-<13 digits>.<pdf|png|jpe?g|webp|heic>$ (the shape CredentialsTab and complete-signup write; kind = column; ext = the bucket's allowed types, case-insensitive for older clients) AND name an existing user-documents object (public.credential_document_path_ok), else the write is REFUSED (22023) rather than NULLed, so the member's PATCH never returns 200 over a row that silently says "no document"; blank stays Q120's absent; applies to service role too. Storage: one UPDATE + one DELETE policy (own folder AND NOT public.is_submitted_credential_object(name)) replace the four; the object named by the caller's own profile URL is frozen until withdrawn. CredentialsTab now takes the extension from the MIME type. Measured before: 0 profiles rows with a non-NULL license_url/insurance_url (none can fail the shape; the trigger's WHEN fires only on a URL/business_name change), 3 credential objects, all on shape. Live after: helper true on a real object, false on U+200B/U+FEFF/U+2060, another uid, URL, bare name, trailing ZWSP, missing object; pg_policies shows only the two guarded UPDATE/DELETE policies; null-uid-trust query returns 0. **Guards:** src/test/credentialUrlIsOwnDocument.test.ts (13 @mutate, all killed) and src/test/pglite/credentialUrlIsOwnDocument.pglite.mjs (live trigger chain + live storage policies, applied 3x: ALL PASS 31; NEW_MIGRATION=skip: 17 FAILED); Q120's guard mutations retargeted to the new newest definition (8/8 killed). Needs an lh-authz-rls REVIEW-ONLY pass (storage policies + two new SECURITY DEFINER helpers). Same class on the sister table is Q130. **Real app path re-verified on prod (2026-09-23, helper-e2e, anon key + user JWT, CredentialsTab's order and MIME map):** upload 200; PATCH license_url 200 -> pending/is_licensed true; upsert and update of the submitted object 400 (body statusCode 403, RLS); delete 200 [] (filtered, bytes intact); withdraw 200 -> none/false; delete after withdraw 200 (1 row); U+200B (license and insurance), another user's folder, right shape with no object: each 400 22023. Helper row restored to its starting md5, 0 objects left. Evidence ~/.lh-shots/q127-realpath/run.log. complete-signup's latent coupling filed as Q133.
- [x] **Q130 DONE (2026-09-23, migration 20260923113829, 9d96d1dba): helper_credentials.document_url must be the member's own uploaded user-documents object, and a member can no longer swap a credential's document or type. GUARDS: src/test/helperCredentialDocumentIsOwn.test.ts (14 @mutate, all killed) and src/test/pglite/helperCredentialDocumentIsOwn.pglite.mjs (live trigger chain, policies and grants, applied 3x: ALL PASS 44; NEW_MIGRATION=skip: 25 FAILED).** Now: helper_credential_document_ok() allows only ^<user_id>/credentials/<trade_license|insurance|bond>-<13 digits>.<pdf|png|jpe?g|webp|heic>$ naming an existing user-documents object, for every writer (service role and admin too). New trigger trg_helper_credential_document_is_own (BEFORE INSERT OR UPDATE; blank is absent): a member may not INSERT identity or background_check (the verification provider records those; stripe-webhook's service-role background_check insert with no document still works); identity/background_check carry no document; a member change of document_url or credential_type on an existing row is REFUSED, not re-armed (the row is already in review and review_credential() approves whatever the row names, so a swap could land after the admin opened the old document; resubmitting is a new INSERT; no client flow updates the table). Also: column UPDATE on document_url/credential_type revoked from authenticated (the trigger still refuses if it comes back); the UPDATE policy has WITH CHECK; a pending bond needs a document (CHECK helper_credentials_pending_bond_needs_document); is_submitted_credential_object() now also freezes the storage object a caller's helper_credentials row names. Unchanged values are never re-checked, so an existing row survives unrelated updates. The seed fixture now uploads a real object: scripts/audit/prod-seed.mjs (fixed name <helper>/credentials/trade_license-1757721600000.png, removed on --teardown) and e2e/prod-audit/harness.ts (uploads as the helper, undo deletes row then object); e2e/happy-path/seedData.ts uses the path shape. **Live, 2026-09-23 ~11:55Z:** migration in schema_migrations; both new functions SECURITY DEFINER, search_path=public, proacl postgres+service_role only; trigger present; UPDATE policy WITH CHECK ((SELECT auth.uid()) = user_id); authenticated UPDATE columns = expiration_date, issuing_authority, license_number, license_state, trade_category, updated_at; bond CHECK validated; helper_credential_document_ok false on U+200B and on a data: URL. **Real app path on prod (helper-e2e, anon key + user JWT only):** upload 200 then INSERT trade_license 201 'submitted'; license_number edit 200; document_url swap 403 42501; credential_type change 403 42501; overwrite of the submitted object 400 (RLS); delete 200 [] with bytes intact; INSERT with U+200B, data: URL, another member's folder, or right shape with no object 400 22023; bond without a document 400 23514; background_check and identity as a member 403 42501; unrelated edit of the existing seed row 200. 16/16 PASS. Proof row and 2 objects removed with the service role; the seed row re-pointed from its data: URL to a real object (rows whose document fails the helper: 1 before, 0 after). Evidence ~/.lh-shots/q130/. Needs an lh-authz-rls REVIEW-ONLY pass (trigger, revoked column grants, policy WITH CHECK, storage freeze).
- [x] **Q131 DONE (2026-09-23): offline mid-apply lost its confirmation, not its application — a stale-chunk recovery reload wiped "Application sent!".** Measured on prod as helper-e2e (evidence ~/.lh-shots/q131/, logs before*/after*): back online, Apply Now sent exactly ONE `apply_to_job` (200, row id returned) and exactly one applications row landed; then onSuccess's `track()` lazily imported the posthog chunk, whose fetch had failed while offline (the browser keeps a failed module fetch for the document's life), so `vite:preloadError` fired while online and main.tsx's recovery reloaded to `/dashboard?_v=…` ~100ms after the 200 — toast gone, and the reloaded feed still listed the job the helper had just applied to. Second defect on the same path: the `critical` "You're offline … Retry" toast outlived the offline state (still up after reconnect, covering Apply Now at 375; its Retry offered a second submit). Fix: `backgroundImport()` in src/lib/chunkReload.ts holds the existing speculative-import gate for analytics/observability imports (analytics.ts posthog + supabase client, errorLogger.ts, useLoginTracking.ts), so their failure can never reload the page; ApplyBody dismisses its offline toast when `online` returns. The spec was right; the product was wrong. After: 1 write, 1 row, no `_v` navigation, "Application sent!" on screen at +1.5s…+40s (375 and 1440, before/after screenshots reviewed). **Guards:** e2e/prod-audit/interruptions.spec.ts "offline mid-apply" now PASSES on prod and was shown FAILING ("no success message after the back-online retry") with the analytics fix reverted; src/lib/backgroundImport.test.ts (3 @mutate, all red) and the Q131 block in src/components/dashboard/ApplyConfirmDialog.test.tsx (1 @mutate, red). Collateral, measured: two leftover diag applications made ensureFundedOpenJob retire fixtures e3e08fd1 and 12239e0e through retireFundedJob (cancel_escrow, refunded); current fixture 1bb36551 is open+escrow with 0 applications. Card-overlap seen after the optimistic removal is Q154.
- [x] **Q154 DONE (2026-09-23): dashboard feed cards overlapped after a job was optimistically removed — VirtualizedJobList cleared its own row-size cache.** Measured on prod as helper-e2e with the funded fixture 1bb36551 (local build, evidence ~/.lh-shots/q154/): before the fix, applying from the job sheet (useApplyFlow onMutate drops the card) moved the row pitch from 110px to 92px at 375 and 114px to 92px at 1440, a 10px card overlap where there had been an 8px/12px gap, unchanged at +40s. Cause: `useEffect(() => virtualizer.measure(), [items.length])` in src/components/dashboard/VirtualizedJobList.tsx. In @tanstack/virtual-core 3.17 `measure()` CLEARS the per-key size cache, and rows that stay mounted are never re-measured (same node, same size: neither the ref callback nor the ResizeObserver fires), so every surviving row fell back to `estimateSize={92}`. Fix: the call is removed; sizes are cached by stable job id, so a new count re-lays the rows out on its own. No style changes. After: pitch 110 (375) / 114 (1440) held at +1.5s, +4s and +40s, gaps intact; before/after screenshots at both widths reviewed and recorded. Both test applications withdrawn (fixture back to 0 applications, open/escrow). **Guard:** src/components/dashboard/VirtualizedJobList.test.tsx renders the real virtualizer, removes an item and asserts every surviving row sits at least one measured row-height below the previous one (1 @mutate re-adding the `measure()` call; red: "expected 92 to be greater than or equal to 110").
- [ ] **Q132 The other 5 UNJUSTIFIED skips of prod-audit run 35844514386 need their own fixtures or a re-run (found by Q100, 2026-09-23).** messy-input.spec.ts:406 post-job price rule ("no price field reached with the generic stepper"), explore disputedJob-poster and disputedJob-helper (no disputed job between poster-e2e and helper-e2e), and explore openJob-helper / openJob-poster, which Q100's fixture now feeds but which were not re-run locally (messy-input is a ~55-minute run).
- [x] **Q133 DONE (2026-09-23, 9d96d1dba): complete-signup checks a credential file's type before it uploads anything, so a file the credential triggers would refuse gets a clear 400 instead of a 500 after upload that leaves the account unapproved. GUARD: src/test/credentialDocumentExtAgreement.test.ts (8 @mutate, all killed): the user-documents bucket's allowed_mime_types (newest migration, 20260921092104; live {jpeg,png,webp,heic,pdf}) == the content types CREDENTIAL_DOCUMENT_EXT_MIME stores; its extensions == the extension sets of both credential_document_path_ok() and helper_credential_document_ok(); every bucket type round-trips; every other type or fallback extension safeDocumentExt knows (gif, heif, tiff, tif, bin) gives null; CredentialsTab's ALLOWED_TYPES/DOC_EXT_BY_TYPE fit inside both; complete-signup calls credentialDocument() and returns 400 before its first .upload(, and builds the paths from what that call returned.** Choice: validate before upload (a 400 naming the accepted types; nothing written), not approve-and-drop-the-credential (the person would believe they had submitted a licence) and not a second UPDATE (would still orphan the object). Uploads now use the canonical MIME for the chosen extension, so an older client that sends no type but a .pdf name still uploads as application/pdf. Not run end to end (signup cannot run on prod). Deployed: prod complete-signup version 1254, updated 2026-09-23 11:55:49Z, contains credentialDocument() and the 400 refusal (get_edge_function).
- [x] **Q134 DONE (2026-09-23): a 'bond' credential has no reviewer — closed by Q141 removing the type (migration 20260923130457, live: 0 bond rows, bond refused by helper_credentials_credential_type_check). GUARD: src/test/noBondCredentialType.test.ts.** Was: Read, not run: get_user_credential_tier() counts a verified bond as insured, and members may submit a bond (with a document, since Q130), but get_pending_credentials() lists only trade_license/insurance and review_credential() takes only license/insurance. So a submitted bond sits 'submitted' forever with no admin action. Either add bond to the queue and review_credential, or stop members from submitting bonds. Prod today: 1 bond row (seed, rejected).
- [x] **Q135 A plain whole-repo `npx vitest run` deadlocks on its own gate lock (found by the Q129 lane 2026-09-23).** src/test/gateLockGlobalSetup.ts is the root `globalSetup`, and both projects in vitest.config.ts (`unit`, `tz-sweep`) `extends: true`, so it runs twice in ONE process: the first call takes ~/.lh-gate.lock with this pid, the second finds the owner pid alive (itself) and waits (log printed "acquiring the gate lock" twice, then "waiting for pid 70270" = its own pid; hung 30+ min, killed). `npm run test:unit` / `node scripts/gateLock.mjs -- npx vitest run` are unaffected (LH_GATE_LOCK_HELD=1). Fix: make acquireGateLock re-entrant for `owner.pid === process.pid` (and release only on the last teardown), with a case in src/test/gateLockGlobalSetup.test.ts that calls setup() twice in-process. DONE 2026-09-23 (cloud/q135-q136): scripts/gateLock.mjs acquireGateLock is re-entrant: when owner.pid === process.pid it counts another hold instead of waiting, with the count kept per process on globalThis (each vitest project may load its own copy of the module); releaseGateLock removes the lock only on the LAST release. The lock path is now resolved per call, and LH_GATE_LOCK_PATH overrides it so the test never touches ~/.lh-gate.lock (a worker thread's process.env.HOME does not reach os.homedir()). Guard: src/test/gateLockGlobalSetup.test.ts "setup() twice in-process acquires twice and releases only on the last teardown" + 2 @mutate lines. RED on the old acquire/release logic (origin/main gateLock.mjs, only its path made lazy): "[gate-lock] waiting for pid 1209" = its own pid, then "Gate lock ... held by pid 1209 ... past the wait limit"; RED with early release (lock gone after the first teardown); GREEN 3/3.
- [x] **Q136 arbitraryWidthVariantsCompile races vacuityGate's temp fixture in a whole-repo vitest run (found by the Q129 lane 2026-09-23).** src/test/vacuityGate.test.ts writes then deletes src/test/fixtures/vacuitySelfTest-<pid>-<rand>/planted.spec.ts inside the repo; src/test/arbitraryWidthVariantsCompile.test.ts runs Tailwind over the tree concurrently and threw ENOENT stat on that file (full run 2026-09-23 04:50, ~/.lh-shots/q129/full-vitest.log); alone it passes. Fix: vacuityGate writes its fixture outside Tailwind's content globs (or tailwind content excludes src/test/fixtures/vacuitySelfTest-*), with a case proving the glob excludes it. DONE 2026-09-23 (cloud/q135-q136): the fixture must stay under src/ (vitest only discovers src/**), so tailwind.config.ts content now excludes "!./src/test/fixtures/vacuitySelfTest-*/**" beside the existing src/test/edge exclusion. Guard: src/test/vacuityGate.test.ts "Tailwind's content globs never read the planted fixture (Q136)": it plants a unique w-[Npx] class in a real vacuitySelfTest-<pid>-<rand>/ dir and a control class in an ordinary src/test/fixtures file, compiles with the app's own config, and asserts the control is emitted and the fixture's class is not. + 1 @mutate. RED on origin/main tailwind.config.ts and under the mutation ("expected ... not to contain '4321px'"); GREEN.
- [~] **Q137 A seed subject can notify a REAL person (money/trust review of Q100, 2026-09-23). FIXED at the choke points (migration 20260923121354 + send-notification-email + create-notification); GUARDS: src/test/seedNeverNotifiesReal.test.ts (14 @mutate, all killed) and src/test/pglite/seedNeverNotifiesReal.pglite.mjs (live chain, applied 3x: ALL PASS 30; NEW_MIGRATION=skip: 17 FAILED). Partly done: 45 producers still do not carry their subject (Q139).** Was: when the Q100 funded fixture job (is_seed, e3e08fd1-3449-40f7-a99d-f5d49dbe53df) became escrowed at 11:35Z, notify_helpers_on_job_post sent "New job in your parish" (job_match) to two East Baton Rouge accounts and POSTed send-notification-email; producers skipped a seed job only while seed_jobs_hidden_publicly() (the launch switch, FALSE on prod) was true. Measured before (prod, 30 days to 2026-09-23 ~12:00Z): 105 notifications reached a NON-seed account about a seed job (message 46, job_updates 21, application 12, admin_alert 12, job_update 6, payment 3, work_status 2, warning/expired/new_offers 1 each); ALL to the owner's own two admin accounts (76b07824 99, 7f65ef12 6); prod has 3 non-seed profiles, all the owner's; no other person. A floor: many rows carry no job reference. Email: 350 emails to non-seed accounts in 30 days, none attributable (send-notification-email never logged a job_id). Now: a seed job (is_seed) or a seed actor (named in the link as userId=/offerTo=/user=, or create-notification's signed-in caller) never produces an in-app row, push or email to a NON-seed recipient, whatever the switch; seed-to-seed unchanged; the switch still controls browse only. Choke points: notifications BEFORE INSERT trg_notifications_seed_boundary (drops the row, so the AFTER INSERT push fan-out never fires; sorts after trg_notifications_fill_job_id); match_digest_queue BEFORE INSERT; send-notification-email and create-notification ask notification_crosses_seed_boundary() first (email fails closed on a check error, PGRST202 falls through for the deploy window); sweep_daily_job_digest counts seed jobs only for seed recipients. Suppressions are logged in notification_logs (status 'suppressed_seed'). Inventory (from source, = live): 44 SQL functions insert into notifications, 72 edge + 3 client insert sites, 3 SQL email producers, 1 SQL push path (the fan-out), 12 email-sending files. HEADS-UP for the owner: your own non-seed accounts stop receiving notifications about seed jobs you are a party to, and admin alerts about seed jobs; that is the rule as specified. **Live 2026-09-23 ~12:40Z:** schema_migrations has 20260923121354 (applied 12:27:59Z by the GitHub integration, acknowledged in scripts/audit/migration-provenance.json); the three functions SECURITY DEFINER, search_path=public, pg_temp, proacl postgres+service_role only; BEFORE INSERT order on notifications = suppress_exact_duplicate_notification, trg_notifications_fill_job_id, trg_notifications_seed_boundary; trg_match_digest_queue_seed_boundary present; sweep_daily_job_digest has the seed filter; notification_crosses_seed_boundary: owner account about the Q100 fixture true (by job_id and by link), a seed account false, seed actor true, real actor false. Real insert on prod (the fixture's own link, one statement): owner account 0 rows landed + 1 notification_logs 'suppressed_seed' row; a seed EBR account 1 row landed (removed after; 0 left). Deployed: send-notification-email v2382 and create-notification v60 contain the check (get_edge_function; functions-deploy 35860574449 green). Not run end to end: a real email POST (the PGlite proof asserts the sender's answer for every POST the SQL producers make). Needs an lh-authz-rls or lh-silent-failure REVIEW-ONLY pass (new SECURITY DEFINER trigger on every notification insert; fail-closed drop).
- [ ] **Q139 45 notification producers do not carry their subject, so the Q137 seed boundary cannot judge them (found by Q137, 2026-09-23).** Listed exactly in KNOWN_GAP in src/test/seedNeverNotifiesReal.test.ts (two-way): 23 edge sites (arrival-confirm-reminder, auto-expire-jobs x2, charge-recurring-visits, check-pro-subscription, create-payment, execute-dispute-split, payment-confirm-reminder, process-scheduled-payouts x2, release-payout x3, review-nag-cron, stalled-completion-reminder, stripe-idv-webhook admin alert, chargeDisputeClosed x2, chargeDisputeCreated, checkoutSessionCompleted tip + gift credit, void-cancelled-payments x2) and 22 SQL sites (check_referral_bonus x4, track_revision_scope_creep x2, notify_poster_on_status_change, notify_helper_on_tip, notify_helper_on_direct_offer, notify_helper_application_viewed, respond_to_direct_offer, expire_unanswered_offers x2, sweep_dayof_confirm_reminders x3, apply_job_denial_consequence, sweep_release_last_chance, helper_abort_job x2, apply_low_rating_flag, apply_consequence_ladder admin alert), plus the gift-card email (names the donor). Each is about a job or a counterpart but inserts no job_id and no job/actor link. Fix per site: add job_id (or a job/actor link) to the insert, then delete its KNOWN_GAP line (the guard fails until you do). Their risk is lower than Q137's fan-outs: most notify a PARTY to the job.
- [ ] **Q128 Triage press-every-control run 35837735324 (e96adc16d, red, 2026-09-23).** Classes seen: (1) 429 on Sentry `envelope/` counted as a control failure (earnings, signup, schedule, home_history) — our own telemetry rate limit, not a product defect; the harness must not blame the control, and 429s from our own reporter need their own look; (2) "Copy Mon to all" on /profile?tab=availability: no observable change for customer AND helper — real defect or harness blind spot, measure; (3) /jobs/:id "Done — <date>" timeline buttons NOT CLICKABLE (16s timeout, 3 rows) — something covers them or they are disabled-looking-enabled; (4) /admin?view=credentials "Open" no observable change; (5) apay-us.amazon.com 500 (third party); (6) admin Refund Poster not found on reload (transient DOM); (7) GoTrue refused test sessions mid-run and parts were cancelled on time budget (a cancelled run is a hidden red). Fix real defects with guards, reclassify harness noise with a guard that each class stays classified, and re-dispatch press.
- [x] **Q138 DONE: a test importing an unlisted e2e file can no longer turn typecheck red unseen (2026-09-23).** tsconfig.app.json is composite, so every e2e file a src/test file imports must be listed; lanes run only targeted vitest, so TS6307 surfaced only in the Test workflow (twice tonight: e2eSkipsAreJustified, then fundedOpenJobPlan since 8f6256c2a). Listed e2e/prod-audit/fundedOpenJobPlan.ts. Guard: src/test/e2eImportsInAppTsconfig.test.ts (follows each import's e2e closure; red on the old tsconfig naming exactly that file; typecheck clean after).
- [x] **Q140 DONE (2026-09-23, migration 20260923123701): a NULL argument never makes an allow/validity check say yes.** Was: helper_credential_document_ok / credential_document_path_ok (Q130/Q127) are chains of `IF <cond> THEN RETURN false` ending in `RETURN EXISTS(object)`; a NULL kind made every condition NULL, plpgsql skipped them, and each returned TRUE live for another member's real document (false with a real kind). Unreachable (literal kinds; credential_type NOT NULL and not member-updatable): a latent trap. Class sweep (live, read-only, 2026-09-23): 47 boolean functions in public (pg_proc) = 17 allow, 2 absent-is-valid (is_safe_media_url, are_safe_media_urls), 5 deny, 6 classify, 3 no-arg, 14 volatile actions; each allow function called on a real allowed tuple with each argument NULL vs a garbage value. Offenders (NULL non-false where garbage is false): the two above, check_dispute_velocity(NULL)=TRUE, identity_is_verified(NULL,false)=NULL, job_is_funded(NULL)=NULL (the last two only matter in an `IF NOT f()` caller; today display/RLS). All five now return exactly false (explicit IS NULL / IS NOT NULL / IS NOT DISTINCT FROM / COALESCE, not STRICT); non-NULL behaviour and ACLs unchanged. Noted, not changed: is_category_taxable(NULL)=NULL (classifier; jobs.category NOT NULL; export CASE reads it as Exempt); notification_crosses_seed_boundary(NULL recipient)=false (deny polarity; notifications.user_id NOT NULL). **Guards:** scripts/ci/null-arg-validators.sql in db-smoke (every public boolean function classified two-way against pg_proc, floor 47/17; each allow case TRUE on a fixture, exactly false with each argument NULL; CI proof on branch q140-null-arg-proof: run 35863225090 green, 47 classified; run 35863237243 with 20260923123701 excluded red naming exactly the five); src/test/pglite/nullArgNeverAllows.pglite.mjs (newest migration definitions, applied 3x: ALL PASS 17; NEW_MIGRATION=skip: 6 FAILED); src/test/nullArgNeverAllows.test.ts (two-way inventory vs migrations, case per argument, wiring, fixed definitions; 13 @mutate, all killed). Q127/Q130 guard mutations retargeted to the new newest definition (34/34 killed). Live after (applied by the Supabase integration 12:59:55Z, acknowledged in scripts/audit/migration-provenance.json; db-deploy 35863972610 red only at provenance): all five return false for the NULL argument (and job_is_funded for a missing job); real calls still true: helper_credential_document_ok on helper-e2e's trade_license object, credential_document_path_ok on 76b07824's insurance object, check_dispute_velocity, identity_is_verified('verified',false) and (NULL,true), job_is_funded on an escrowed job; proacl unchanged for all five; 47 boolean functions in public. Needs an lh-authz-rls REVIEW-ONLY pass.
- [x] **Q141 DONE (2026-09-23, migration 20260923130457): the unused 'bond' credential type is removed (OWNER DECISION 2026-09-23). Live 2026-09-23 ~13:15Z: applied 13:13:07Z by the Supabase GitHub integration (acknowledged in scripts/audit/migration-provenance.json; db-deploy 35865476342 red only at the provenance step, all gates green); helper_credentials bond rows 1 -> 0 (the prod-seed row, profiles.is_seed; now insurance=1, trade_license=1); public functions whose body names 'bond' 2 -> 0; constraints naming bond 2 -> 0 (pending_bond CHECK dropped; type CHECK = identity/background_check/trade_license/insurance, validated); proacl unchanged (get_user_credential_tier postgres+authenticated+service_role, helper_credential_document_ok postgres+service_role), search_path=public on both; helper_credential_document_ok(<seed>, 'bond', <path>) = false. Seed writers (prod-seed.mjs, seedData.ts) no longer write bond. GUARDS: src/test/noBondCredentialType.test.ts (newest function bodies + every CHECK that ever admitted bond; 4 @mutate, all killed) and src/test/pglite/removeBondCredentialType.pglite.mjs (applied 3x: ALL PASS 18; NEW_MIGRATION=skip: 5 FAILED).** Was: No screen or edge function mentions bond (grep of src/ and supabase/functions: 0 hits); it lives only in helper_credentials.credential_type (20260612140000), the credential-tier function (counts a verified bond like insurance), the Q130 trigger/CHECK (20260923113829), and one seed row (helper-e2e, rejected, no document) from scripts/audit/prod-seed.mjs + e2e/happy-path/seedData.ts. Remove it from the type CHECK, every function that names it, the seed scripts and fixtures; delete the seed row; closes Q134 (bond has no reviewer). Starts after the NULL-arg validator lane lands (same functions).
- [ ] **Q142 Credentials: replace the Licensed/Insured switches with "Add license" / "Add insurance" buttons (owner decision 2026-09-23, MORNING QUESTIONS 6 option b).** Each button goes straight to upload-for-review; no control looks like it sets the badge. Also resolves Q111 (removing a sent document must leave the add button). Before/after screenshots at 375 + 1440, light + dark; guard that no member-facing control writes is_licensed/is_insured.
- [ ] **Q143 Messages search below 360px opens on its own line (owner decision 2026-09-23, Q48 option D).** Where the tab strip sits, full width; 375+ unchanged. Proof: expanding-search-geometry.spec.ts @320 goes green (it is the failing prod-audit test).
- [ ] **Q144 LAUNCH CHECKLIST: stop real email to is_seed accounts at launch (owner decision 2026-09-23: keep sending until launch).** At launch, skip sending to is_seed recipients (log skipped_seed in email_send_log) with an allowlist for delivery-asserting journeys, so test mail stops spending the Resend daily quota real users need.
- [~] **Q145 DONE 2026-09-23 12:51Z; protection pending = the Q3 balance monitor (not built yet). Was: Top up the Stripe TEST balance by $500 and re-run the failed test payouts (owner approved 2026-09-23).** Key mode proved first by a temporary admin-JWT-only edge function (tmp-q145-test-topup) that refused unless STRIPE_SECRET_KEY starts sk_test_/rk_test_ and balance.livemode is false: key_mode test, livemode false; the key was never returned or logged. Balance before: available $0.00, pending $616.48. One $500.00 charge with pm_card_bypassPending (the 0077 card): pi_3UIpdrKp2H4b7tEC1666cTsf / ch_3UIpdrKp2H4b7tEC1hb5f1Ec, succeeded, livemode false; available then $485.20 (net of the $14.80 Stripe fee). Failed payouts (error_logs + payout_transfers): (1) seed job dd9e4db7, payout_transfers d3f4276b failed 09-22 16:35Z: re-run via the admin release-payout path (what AdminPayoutBatches invokes), 200, tr_3UGKk7Kp2H4b7tEC08kZA5SQ, 2200c, job released; (2) seed job e7e09075 "transfer failed" 09-22 17:46Z: since cancelled + refunded, nothing owed, not re-run. Balance after both Q145/Q148 transfers: available $428.00 (48520 - 2200 - 3520 = 42800c, exact). Temporary function deleted 12:52Z: absent from `supabase functions list`, POST returns 404. Ledger: "scheduled payout failed" (b7bd5c7f) did not close on `ops-alert-ledger sync` (a companions item with no companion rows), so closed with ops_alert_close after re-query 12:54Z: 0 failed payout_transfers on payout_pending jobs. NOT done here: 26 other seed jobs sit in payout_pending that no failure was recorded for; process-scheduled-payouts skips seeds unless ?include_seed=1.
- [x] **Q146 DONE (measured 2026-09-23 ~12:10Z): marketing_settings.channels_enabled.facebook = false live; 0 marketing errors in the prior 12h. NO-GUARD: a setting the owner flips in Admin → Social; marketing-publish already treats a disabled channel as an outcome, not a defect. NOTE: auto_publish_enabled is TRUE again (changed 10:50Z, no audit row; 0 posts scheduled) — left as is, presumably the owner. Was: Turn the Facebook marketing channel off until the Page token exists (owner decision 2026-09-23).** Stops marketing-publish failing every 15 min (meta_secrets_missing) at the source. OWNER TO-DO kept: add META_PAGE_ACCESS_TOKEN + META_PAGE_ID, then turn it back on.
- [ ] **Q147 Back up uploaded files except id-documents (owner decision 2026-09-23).** Buckets proof-photos, job-photos, message-attachments, user-documents, avatars (~150 objects, ~10 MB) into the existing encrypted db-backup artifact; id-documents excluded for privacy. Extend the weekly restore drill to prove the files restore.
- [x] **Q148 DONE 2026-09-23 12:52Z (TEST mode). Guard: src/test/disputeClosedWithoutPaymentIsWatched.test.ts (the sweep_disputes_closed_without_payment detector for this class). Was: Settle seed dispute 9756a585 in Stripe TEST mode (owner approved 2026-09-23).** Dispute 9756a585 (job e6979a12, split helper 1 / poster 0, execution_status executed but moved nothing). The admin split path execute-dispute-split refuses it (409 "already executed", no write), and admin_release_dispute needs job.status disputed (it is completed), so it was settled the way the detector says: admin release-payout on job e6979a12 as the admin-e2e seed account: 200, tr_3UCwOtKp2H4b7tEC1UMtZPxp, 3520c ($40 less 12%), payout_transfers 95a1648f paid, job payout_pending -> released. No rows written by hand. Detector re-run 12:52:50Z: sweep_disputes_closed_without_payment() reported 0 and its WHERE clause matches 0 disputes; ledger item f5ea2f13 (dispute-unsettled-seed) closed with that evidence. Follow-up: Q153.
- [ ] **Q149 (needs the owner to sign in to the Supabase dashboard in Chrome; then Claude flips it) Turn on leaked-password (HIBP) protection (owner decision 2026-09-23, Pro plan).** Supabase Auth password security setting; verify the advisor clears and a breached password is refused at signup with a clear message.
- [x] **Q150 DONE 2026-09-23 (owner: "Ok to delete those"): 63 -> 11 remote branches. Deleted 27 fully merged + 25 unmerged (WIP, hole-hunt report branches, apple-iap, old fixes). Every deleted commit is pinned locally under refs/archive/deleted-2026-09-23/* and saved in ~/.lh-backups/deleted-branches-20260923.bundle (25 heads, verified) plus sha lists in ~/.lh-backups/. Kept: the 11 with open PRs (dependabot + lockfile). NO-GUARD: one-off cleanup; stale local worktrees/branches are pruned automatically by scripts/prune-git-hygiene.mjs.** Triage stale remote branches (owner decision 2026-09-23). PROGRESS 2026-09-23: deleted 27 of 63 (26 fully merged + visual/vn-33a-nudge, zero unique patches); shas in ~/.lh-backups/merged-remote-branches-20260923T0547.txt. 36 remain; table (unique commits, date, files, subject) in ~/.lh-backups/unmerged-branch-triage-20260923.txt. chore/lockfile-normalize + chore/lockfile-resync-2026-09-20 have OPEN PRs (zero unique patches: close the PRs, then delete). feat/apple-iap: do NOT merge (memory: booby-trapped). Hole-hunt report branches (7): fold findings into this queue, then delete. Remaining: prove whether fix-refund-double-pay / fix-jobs-completion-columns / sec-hardening / db-block-offer-rearm / audit-function-body-drift landed by other commits. Delete the 26 fully merged; for each of the 34 with patches not on main (git cherry), say what it holds and whether it is worth landing; list for the owner; delete the rest only after that list.
- [ ] **Q151 Audit the right-side panel overlap on every signed-in page (owner 2026-09-23: "you audit it and check"; carried from Q10).** With the desktop rail open, measure every signed-in route at 1024, 1280, 1440 and 1920: nothing under the rail, .app-shell-frame inset exactly --desktop-sidebar-w, zero horizontal overflow, column centred in the post-rail area. Screenshot each failure plus a sample, record reviews, fix at the shared layer only.
- [x] **Q153 DONE 2026-09-23 15:15Z. Guard: src/test/edge/release-payout-dispute-stamp.test.ts (14 tests, 5 @mutate lines, all killed by npm run vacuity). Was: A dispute settled by a manual release-payout still says it moved no money (found by Q148).** Layers read: release-payout, process-scheduled-payouts, create-payment admin_release_dispute -> settle_dispute_record (live def: only writes a dispute still 'open', so it could never stamp a decided row), disputes columns + CHECKs + trg_enforce_dispute_opener_column_whitelist (server context passes), payout_transfers, readers DisputeCard (admin), DisputeTimelineDialog, AdminDisputes, detector sweep_disputes_closed_without_payment. Before (prod, measured before the push): 9756a585 execution_transfer_id NULL / execution_helper_cents NULL, so DisputeCard rendered 'Settled: $0.00 to the Helpr · $0.00 refunded' and DisputeTimelineDialog hid the amount; it was the only executed dispute in that state (the other, 28c4943d, is a refund). Fix: _shared/disputePayoutStamp.ts stamps the newest decided+executed dispute with no transfer, helper amount or refund id recorded (never overwrites; by id; .select('id'); zero rows = 'raced'); release-payout calls it after the flip and on the heal retry; process-scheduled-payouts for single-helper jobs. Chose stamping over reader-side derivation because the poster cannot read payout_transfers (live pg_policies: SELECT only for the helper and admins) and three readers + the detector already key on execution_*. Backfill: migration 20260923150534 pinned to 9756a585 and jobs.is_seed (seed job e6979a12), figures from payout_transfers 95a1648f. After (prod 15:15:24Z): tr_3UCwOtKp2H4b7tEC1UMtZPxp / 3520. Reviews: lh-money-escrow + lh-silent-failure, nothing blocking; fixed: stamp moved after the flip, heal path stamps, refund-settled disputes excluded, seed routing on the alert, raced logged, migration row-count NOTICE.
- [ ] **Q152 LAST STEP: cut the TestFlight build (`bundle exec fastlane ios beta`) only after every other queue item is done (owner, 2026-09-23: "wait on test flight until everything in Que is done").** Claude runs it from main; then the owner installs it, signs in, and taps Enable -> Allow on the notifications pill (MORNING QUESTIONS 5 / Q82), and push_tokens gets its first real device row.
- [x] **Q155 DONE 2026-09-23: conflict markers can no longer reach main unnoticed.** A rebase stopped on a conflict in generated docs; a follow-up `git commit -a` recorded the conflicted files and the --no-verify push put `<<<<<<<`/`>>>>>>>` into docs/OPEN.md, docs/SCOREBOARD.md and docs/audit/vacuity-report.json (invalid JSON) at 88ee54f74; repaired in 6dc6a5e0b. Guard: src/test/noConflictMarkers.test.ts (every tracked text file, floor 1500; red on a planted marker naming docs/OPEN.md).
- [x] **Q156 DONE 2026-09-23: the 12:43:27Z signature failure was a REAL Stripe delivery that did not come from the sandbox endpoint, and every unverified Stripe delivery is now REFUSED (non-2xx) instead of acknowledged.** Measured (temporary admin-only, read-only, sk_test-gated edge fn tmp-q156-stripe-events, deleted 13:27Z: absent from `supabase functions list`, POST 404): the request had User-Agent Stripe/1.0 from 3.130.192.231 (in stripe.com/files/ips/ips_webhooks.json), 3524 bytes, hit deployment v2440, answered 200. The sandbox has ONE endpoint on this URL (we_1U8AbhKp2H4b7tEC, events_from self) plus upbeat-voyage (we_1U5fInKp2H4b7tEC) on stripe-idv-webhook. No sandbox event was created in 12:41:40-12:43:40, and none of the 319 sandbox events in the prior 74h is 3524 bytes (API raw length matched the delivered length for every other delivery); in 24h to 13:24:46Z the sandbox had 113 handled-type events, stripe_webhook_events has 113 rows, and stripe-webhook took 115 POSTs (113 + one duplicate redelivery + this one). So it was signed by another Stripe account or mode whose endpoint points at this URL; scripts/e2e/stripe-sandbox-off.sh documents a LIVE endpoint on it, the likely source (not provable with a test key; see Q163). Nothing to replay in the sandbox. Redeploys were not the cause: no stripe-webhook code change in that window, and the secret is env, not code. Separately found: evt_1UIPUPKp2H4b7tECb12rdVVL (checkout.session.expired, 09-22 08:55Z) still has pending_webhooks=1 after three 500s at 08:57/08:57/09:57Z, each an idempotency insert that got a Cloudflare 522 from PostgREST; its job d67ec4f9 no longer exists, so nothing to replay. POLICY: signature failure, missing header -> 400; missing key/secret/Supabase env -> 500, in stripe-webhook AND stripe-idv-webhook (supabase/functions/_shared/stripeWebhookReject.ts has the reasoning: Stripe retries per event on a bounded schedule, so no storm; a 200 is the only answer that loses the event). The alert names the claimed (unverified) event id/type/livemode and signature schemes (v0 = test mode), is critical (opens a ledger item) and pages once per UTC day. GUARDS: src/test/edge/stripe-webhook.test.ts + stripe-idv-webhook.test.ts (behaviour through the real function source), src/test/stripeWebhooksRefuseUnverified.test.ts (class: every fn calling constructEventAsync, no 2xx before verification); 16 new @mutate lines, 16/16 killed by `npm run vacuity`. LIVE CHECK: scripts/check-stripe-webhook-events.mjs part C (stripe-webhook-guard.yml, daily + on push) fails on any handled-type event with pending_webhooks > 0 created 26h..1h ago, i.e. Stripe's own failed-delivery count; red on scripts/fixtures/stripe-webhook-endpoints/undelivered-event-q156.json in CI's static job.
- [x] **Q157 DONE (2026-09-23, migration 20260923130621): an admin action on a seed job with a REAL party no longer says "could not be notified".** GUARDS: src/components/admin/adminJobs/adminJobsNotifications.test.tsx (Q157 block: asks admin_notification_crosses_seed_boundary with the trigger's own arguments; TRUE = no insert, honest toast, no error report; FALSE + zero rows is still a rejection; 3 @mutate, killed), src/test/seedNeverNotifiesReal.test.ts (Q157 block, newest definition + client order) and src/test/pglite/seedBoundaryHonestSkips.pglite.mjs (admin answer == trigger verdict on 4 shapes; non-admin and NULL caller refused 42501; applied 3x: ALL PASS 30; NEW_MIGRATION=skip: FAILED). Was: AdminJobs.notifyJobParty inserted with `.select("id")` + unwrapMutation; the Q137 trigger's deliberate drop returned zero rows and the admin saw "That change is saved, but the poster could not be notified" plus a `mutation_rejected` report. Prod had 13 seed jobs with a real customer_id (1 disputed, 6 in_progress). min was NOT lowered: a zero-row insert after a FALSE answer is still reported. The row now also carries job_id. LIVE (2026-09-23 ~13:25Z, 934573d26): admin_notification_crosses_seed_boundary exists, proacl {postgres,authenticated,service_role}; as an admin (authenticated role, rolled back) it answers TRUE for seed job 5eed0a10-0000-4000-8000-000000000002 to its real customer; as a non-admin it raises 42501 'admin only'. Migration applied by the GitHub integration at 13:22:40Z (acknowledged in scripts/audit/migration-provenance.json).
- [x] **Q158 DONE (2026-09-23): charge-recurring-visits no longer pages for a seed series with a REAL party.** GUARD: src/test/edge/charge-recurring-visits.test.ts (Q158: seed series + real poster -> only the helper row inserted, 200, no Slack; an unanswerable check is a counted defect; 3 @mutate, killed). Was: `notifyRows.length < 2` read the Q137 trigger's by-design drop as a failed write and would have posted "Recurring visit funding had failures" every night. It now asks notification_crosses_seed_boundary per row (same user_id / job_id / link as the trigger) and expects only the rows it allows.
- [x] **Q159 DONE (2026-09-23): send-notification-email fails CLOSED on every seed-boundary check error, loudly, and a deploy cannot ship a function ahead of an RPC it calls.** GUARDS: src/test/seedNeverNotifiesReal.test.ts (Q159 blocks: no PGRST202 fall-through in code, refusal returns 503 before any send, logs the 'seed boundary check failed' prefix, pages Slack once a day; functions-deploy step present before upload) and src/test/liveCheckScriptsFailClosed.test.ts (scripts/check-edge-rpcs-live.mjs exits non-zero on a failed or empty read). Chose REFUSE over send-and-alert: a mail about a fake job cannot be recalled, the in-app row is judged by the DB trigger regardless, and the refusal is itself an alert (Q160 monitor + Slack). The deploy check derives every `.rpc("<name>"` in supabase/functions (32 names on 2026-09-23, all present on prod: 339 public functions) and fails functions-deploy before upload while one is missing, re-reading for up to 5 minutes for a migration in the same push.
- [x] **Q160 DONE (2026-09-23, migration 20260923130621): a seed-boundary check that ERRORED is now an alert, a deliberate suppression is not.** GUARDS: src/test/seedNeverNotifiesReal.test.ts (Q160 block: every writer uses the 'seed boundary check failed' prefix the detector reads; the deliberate text does not match it; ledger branch + hourly cron) and src/test/pglite/seedBoundaryHonestSkips.pglite.mjs (suppression -> ok; errored check drops a real-to-real row and raises ONE error_logs row source 'seed-boundary-check-failed'; no re-raise without a newer failure; email-path prefix re-raises; ops_alert_condition true while < 24h, false after). check_seed_boundary_failures() runs hourly (cron 'seed-boundary-failures', liveness expectation 3h); trg_error_logs_zz_ledger turns its row into an ops ledger item that closes only when the failures stop. LIVE (2026-09-23 ~13:25Z): check_seed_boundary_failures() = {ok:true, failed_24h:0}; ops_alert_condition('seed-boundary-check-failed') = false, probe = true; cron 'seed-boundary-failures' '41 * * * *'; expectation 3h. Q159's deploy check ran in functions-deploy 35866558816 before upload: 'Checked 32 RPC names ... against 341 public functions. OK'.
- [x] **Q161 HIGH (silent-failure review of Q131, 2026-09-23): error reporting and analytics can go permanently dark for the rest of a page session.** src/lib/errorLogger.ts flush() (and fanOutToObservability for sentry/posthog), src/lib/analytics.ts and src/hooks/useLoginTracking.ts load their clients through backgroundImport() with a bare catch that drops; the browser caches a failed dynamic import() for the life of the document, so one transient chunk failure drops every later report()/track() (worst case: the supabase-client chunk fails and the reports that would explain it are the ones lost). Q131 correctly removed the self-healing preloadError reload. Also LOW: backgroundImport's gate stays held if load() never settles. Fix: errorLogger persists via plain fetch to /rest/v1/error_logs (no lazy chunk); one "background import failed: <name>" row per session for analytics/posthog/sentry failures; gate released on a timeout. DONE 2026-09-23: errorLogger persists via fetch POST /rest/v1/error_logs (anon key or the stored unexpired access token, one anon retry on 401, non-2xx counted never reported); backgroundImport(load, name) counts failures and errorLogger sends one "background import failed: <name>" row per module per session; the gate is released after BACKGROUND_IMPORT_GATE_TIMEOUT_MS = 15s (prod chunk loads measured 19-218 ms). Guards: src/lib/errorLoggerSurvivesFailedChunks.test.ts (6 @mutate, all killed) and the gate-timeout test in src/lib/backgroundImport.test.ts (killed). Live: prod with the client chunk aborted landed 0 rows (before); the local build landed the report row plus exactly one posthog row per session with the client chunk never requested (after); test rows deleted.
- [x] **Q162 DONE 2026-09-23: analytics_events persist by plain fetch (shared src/lib/restInsert.ts, also now used by errorLogger), so a failed supabase-client chunk no longer drops the session's events; a batch sent without a session carries user_id null so the insert policy (user_id null or auth.uid()) cannot refuse it. Guards: src/lib/errorLoggerSurvivesFailedChunks.test.ts ("an analytics batch persists by fetch while the supabase-client import is failing"), src/lib/backgroundImport.test.ts, src/lib/analyticsCampaign.test.ts. Was:** analytics_events are lost for the page session when the supabase-client chunk fails (found by Q161, 2026-09-23). Q161 moved error_logs to a plain fetch; src/lib/analytics.ts still flushes through backgroundImport(supabase-client), so a failed chunk drops every analytics batch for the session (now VISIBLE as one 'background import failed: supabase-client' error row, but still lost). Move the analytics insert to the same fetch path, with a test that a batch persists while the client import rejects.
- [ ] **Q163 OWNER (Stripe LIVE dashboard): identify the 2026-09-23 12:43:26Z delivery to /functions/v1/stripe-webhook, and check the live endpoint stays enabled until launch.** Q156 showed it was a real Stripe delivery that no sandbox event matches; the live endpoint documented in scripts/e2e/stripe-sandbox-off.sh is the likely sender, and a test key cannot see live mode. Since Q156 a live event hitting this URL during sandbox is answered 400, so Stripe retries it and may email about, or eventually disable, the live endpoint. LAUNCH DAY: after stripe-sandbox-off.sh, confirm in the live dashboard that the endpoint is enabled and resend any live events it failed.
- [ ] **Q164 A temporary edge function vanished within a minute of a successful deploy (2026-09-23 13:19Z).** `supabase functions deploy tmp-q156-stripe-events` printed Deployed; about a minute later POST returned 404 twice and `supabase functions list` had no such function; a redeploy came back as version 1 of a new function (13:19:59) and stayed. Unexplained: check whether the Supabase GitHub integration (Q121) or a hygiene job deletes functions that are not in the repo, before any lane relies on a temporary function. EVIDENCE 2026-09-23 (Claude, workflow_run_logs + function_edge_logs 13:10-13:30Z): the GitHub integration logged NO delete of any function in that window, only 'Deploying Function'/'No change found' lines. It started a run at 13:18:03 ('Cloning git repo... git_ref=main') that ended with no function deploys; the two 404s were at 13:19:14 and 13:19:33 and the redeploy served 200 from 13:20:08 on. So the timing fits a race with that integration run, but no log shows the integration removing it: the cause is NOT proven. Next step: re-test once Q121 turns the integration's deploy off (deploy a temp function, list it at +1/+3/+5 min). Until then a lane using a temporary function must `supabase functions list` and probe it immediately before use.
- [ ] **Q165 Stale reports: archive what no longer describes the app (owner asked 2026-09-23).** Measured: 30 of 41 docs/audit/*.md not updated since before 2026-09-16 (oldest 2026-06-19: 01-screens, 03-journeys, 04-security-money, 05-trust-discovery); TODO.md 807 lines last touched 2026-09-01 (a second backlog, see Q84); AGENTS.md 2026-09-05; launch-2026-09/ROLLUP.md 2026-09-22. For each: carry any still-open finding into this file (verified live, not copied), then move it to docs/archive/ with a one-line 'historical, superseded by docs/OPEN.md' banner; keep dated records (morning/, evidence) where they are. Guard: extend scripts/check-staleness.mjs so a non-dated, non-archived report older than 14 days fails staleness-watch.
- [x] **Q166 DONE 2026-09-23: the prod presser flipped admin settings (it turned marketing auto-publish ON).** Measured from edge_logs: 17 PATCHes to `marketing_settings` as admin@louisianahelpr.com from press-every-control runs 35761400822, 35768341847, 35805671843, 35813177418, 35822080143 and 35837735324; the 10:50:07Z one set auto_publish_enabled = true. Cause: a control counted as mutating only by label vocabulary (DESTRUCTIVE_RX / PAYMENT_RX / type=submit); switches are labelled with the setting's name ("Auto-publish", "Instagram") and the confirm says "Turn on". Fix: `isAdminStateToggle` (scripts/audit/pressProdSafety.mjs) makes any switch/checkbox/radio, or a turn on/off / enable / disable label, pressed as admin a mutating control, so mutationGate skips it unless it acts on a test-owned row; ENUMERATE now records the role. Guard: src/test/pressNeverFlipsAdminSettings.test.ts (3 @mutate, all red when applied by hand: 6/9, 1/9 and 1/9 failing). The setting itself was left as found: MORNING QUESTIONS 8.
- [x] **Q167 DONE 2026-09-23: both pruners scheduled daily (cleanup-stripe-webhook-events 04:25, cleanup-observability-tables 04:35 UTC) with liveness rows and catch-up rows; migration 20260923143321, replayed 3x in PGlite (25 policy rows, 20 catch-up-safe). GUARD: src/test/prunersAreScheduled.test.ts (every cleanup_/prune_/sweep_ function is in a cron.schedule or listed manual; red by its @mutate). Before: 9 stripe_webhook_events >30d, 221 analytics_events >90d; re-measure after the first 04:25/04:35 UTC run on 2026-09-24. Was:** Two DB pruners were never scheduled, and three code comments say they run (found by Q41, 2026-09-23).** `cleanup_stripe_webhook_events()` and `cleanup_observability_tables()` have 0 callers (no cron.job among 59, no trigger, function, client or edge call), yet stripe-webhook/index.ts:267, stripe-idv-webhook/index.ts:205 and verification-webhook/index.ts:269 say "prunes at 30 days". Live: 9 stripe_webhook_events rows older than 30 days (oldest 2026-07-08), 221 analytics_events older than 90 days (oldest 2026-05-03); error_logs is already pruned by sweep_old_error_logs. Fix: schedule them (with a cron_work_expectations liveness row) or drop them and correct the comments; guard: every public prune/cleanup/sweep function is either in cron.job or listed as deliberately manual, red on today's state.
- [x] **Q168 DONE 2026-09-23 (owner ask): footer Company / Legal / Follow share one row at phone width.** Measured in a production build: headings at the same y from 360px up (360, 375, 390, 430, 500), 0px overflow; 320 keeps two rows (needs ~321px, has 288). Screenshot ~/.lh-shots/footer/after-375.png reviewed. Guard: src/test/footerLinkGroupsOneRow.test.ts.
- [x] **Q169 DONE 2026-09-23 (owner priority): pages no longer jump or arrive in waves while they load.** Measured with scripts/audit/measure-page-settle.mjs (CLS via PerformanceObserver, content waves via a 50ms item-count timeline, time to settle) on a production build against prod, every non-redirect App.tsx route, 375 + 1440, guest for public routes and poster-e2e for protected ones. Before: 15 of 110 route/width measurements at CLS >= 0.02 (unthrottled), worst /post-job 375 CLS 0.319, /profile?tab=referral 0.097, notifications 0.055, earnings 0.048, /browse 375 0.042, desktop /dashboard 0.045. After: every route CLS < 0.02 and one content wave at both widths on a returning device (page-settle.spec green, 2 tests, 7.5 min); throttled Fast 3G + 4x CPU at 375 on 8 key routes: max CLS 0.004, one wave each. Root causes fixed at shared layers: JobCard's per-card stagger fade (cards popped in one by one and replayed on re-sort); /browse painted then re-sorted when poster tiers landed (new useArrivalGate, capped 1500ms, also used by post-job, earnings, security); second, differently-shaped skeletons after each profile tab's chunk skeleton (now ProfileTabBodyReserve once: referral, notifications, saved Helprs, schedule, security); JobCardSkeleton price bone 36px vs 27px chip; GuestBrowseSkeleton drew a native header + search + chips the web page lacks (now the real PageHeader + the shell's own spacer/nav box, identical rects at 375/1440); desktop /dashboard loading frame drew the phone title card; the virtualized feed rendered zero rows on its first pass (empty panel ~500ms on Fast 3G); account Senior Mode applied only after the profile loaded (now cached per device, first visit = Q200); SaveHelperButton loading size; reviews skeleton reused as the list node. Guards: e2e/prod-audit/page-settle.spec.ts (routes from deriveRouteSet with a floor of 40, exact two-way KNOWN, runs in prod-audit.yml on the preview build; proven red: with the EntryChoice gate removed it failed on exactly "375 /post-job: cls=0.3505") + src/test/listArrivesInOneWave.test.ts (15 @mutate, each run by hand: 15/15 red). Evidence ~/.lh-shots/cls/ (before-none.json, after2-none.json, after2-fast3g.json, before/after sheets, reviews recorded).
- [ ] **Q200 First-visit text-size jump for accounts with Senior Mode, and BOTH shared test accounts have senior_mode = true (found by Q169, 2026-09-23).** Account Senior Mode is now cached per device (src/lib/simpleMode.ts), so every visit after the first paints at the right size; a device's FIRST signed-in visit still paints small and grows when the profile lands (measured /payment-success 375 CLS 0.062, /my-jobs 0.035, /messages 0.015 before the cache). Live 2026-09-23: profiles.senior_mode = true for poster-e2e (71c56dfb, updated 14:52Z) and helper-e2e (437de07d, 14:24Z), 2 of 60 profiles; nobody decided that, so every audit screenshot and journey is running in Senior Mode. Likely the press sweep toggling the Accessibility switch (Q166 only stopped ADMIN switches). Fix: confirm the writer from edge_logs, reset both to false, extend isAdminStateToggle's rule to any account-setting switch pressed as a shared test account; for the first visit, carry senior_mode in the session (user_metadata) so it is known before first paint. Guard: pressNeverFlipsAdminSettings extended to profile settings.
- [ ] **Q201 Route skeletons that are not the page's shape. PROGRESS 2026-09-23: owner chose (a) PLAIN BACKGROUND for the generic chunk wait (pop-up); RouteSuspenseFallback now draws nothing (sr-only "Loading…", reserved height), guard src/components/RouteSuspenseFallback.test.tsx "draws nothing but the page background" (red on the bones version). STILL OPEN: EarningsPageSkeleton and ProfileRouteSkeleton shapes, the loading-states baseline re-measure, and the rect check in page-settle.spec. Was:** Route skeletons that are not the page's shape (owner 2026-09-23: "most of the skeletons are not even the page shape", "why are there so many"), measured at 375 by holding each page chunk (~/.lh-shots/cls/skel/, skeleton vs loaded PNGs).** Match: /browse (fixed, identical rects), /login (title 4px off), /dashboard (cards 309x104 vs 301x102), /my-posts + /my-jobs (header card + list, close). Do NOT match: the generic RouteSuspenseFallback used by /post-job, /messages, /help, /support, /terms and every ProtectedRoute wait (title bone + two big blocks at 16,92 343x160, vs the real header title at y24/y82 and cards at 20,72/20,128 335 wide, public pages without their nav); EarningsPageSkeleton (no header title, first block y124 h318 vs Earned card y202 h291); ProfileRouteSkeleton (centred title bone vs left title, identity bone 104px vs ~180px card). OWNER DECISION NEEDED for the generic one: (a) plain page ground, as '/' now uses (the 2026-07-08 Cowork audit had flagged a blank body on slow networks), (b) per-route fallbacks in each page's real frame (touches App.tsx skeleton imports, coordinate with Q178), or (c) hold the boot splash until the first route chunk lands (lazyWithPreload + main.tsx) so a cold load shows no route fallback at all. Also: docs/audit/loading-states/baseline.json still allows 65 mismatches measured 2026-09-20; re-measure after this lands. Guard (for whichever is chosen): extend page-settle.spec with a skeleton-vs-loaded rect check (title + first block within 4px) per route, holding the page chunk.
- [ ] **Q202 Card-dispute (chargeback) protection (owner decisions 2026-09-23 by pop-up).** Measured by the lead: stripe-webhook/handlers/chargeDisputeCreated.ts blocks payout only while the job is still `escrow`/`payout_pending`; once `released` the Helpr keeps the money and the platform eats amount + ~$15 fee (no transfers.createReversal anywhere in supabase/functions). Charges are separate charges + transfers with transfer_group job_<id>. No 3D Secure is requested. Max job budget is $5,000 (src/lib/moneyLimits.ts MAX_JOB_BUDGET_DOLLARS + a DB check, migration 20260819235000). Standard payout: auto-complete 24h after done, then paid 24h later (~48h). Owner decisions: (1) "CLAW BACK: on charge.dispute.created for an already-released job, reverse the Helpr's transfer(s) for that job (idempotency key per dispute+transfer, ledger row, never double-reverse, handle partial/insufficient-balance errors loudly via the alert ledger). On charge.dispute.closed WON, re-pay the Helpr (idempotent). LOST: stays reversed. Tell the Helpr in-app (role-neutral copy)." (2) "3D SECURE on charges >= $300: request_three_d_secure 'any' (or 'challenge') on those PaymentIntents/Checkout sessions; make sure the client flow handles requires_action on web AND native." (3) "MAX JOB PRICE $1,000: client constant, server validators, the DB CHECK (replay-safe migration; existing rows above $1,000: measure first, only test data expected; do not break them), copy that states the cap." (4) "STANDARD PAY 3 DAYS after the job is done (instead of ~48h), with the existing paid INSTANT PAYOUT still available for Helprs who want it sooner; update every user-facing sentence that states the timing." In progress.
- [ ] **Q174 sweep_cron_http_failures files agents' manual pg_net probes as cron failures (found working Q42, 2026-09-23).** It reads every net._http_response row (pg_net does not record which cron sent a request) and names a body-less timeout by proximity to the nearest HTTP cron. Measured: the 23 Sep 08:00Z "arrival-confirm-reminder … Timeout of 400 ms" row cannot be the cron (its command uses timeout_milliseconds 30000); the "money-reconciliation returned 500" rows at 08:00Z/08:15Z were manual `?include_seed=1` POSTs at 07:52, 07:54 and 08:12Z (function_edge_logs). Both ledger items closed with that evidence. Fix: have cron commands tag their requests (e.g. an `x-cron-job` header or `?cron=<jobname>`) and have the sweeper skip untagged responses, or have probes use a marker; guard red on a planted untagged 500.
- [ ] **Q175 functions-deploy red on fabef1905 for functions that commit did not touch (run 35870499227, 2026-09-23 14:00Z).** Its "Verify every deploy actually landed" step reported "stored bundle hash did not change" for auto-expire-jobs, auto-resolve-disputes, mapkit-token, verify-apple-iap and weekly-helper-report; after 2 retries weekly-helper-report was still not landed (functions list: updated 13:46:59, before the run). The function the commit changed, marketing-publish, did land (version 808, 14:00:44). Not yet measured: whether those five had source changes in the diff base, i.e. whether this is a real lost deploy or the verifier expecting a new hash for an unchanged bundle.
- [x] **Q170 HIGH (silent-failure review of Q157-Q161, 2026-09-23): Q161's 15s gate timeout could reopen Q131.** backgroundImport() released the recovery gate after BACKGROUND_IMPORT_GATE_TIMEOUT_MS while load() was still pending, and main.tsx's vite:preloadError handler reads the gate live, so a sentry/posthog import still in flight past 15s that THEN rejected triggered the destructive stale-chunk reload (the Q131 class: wipes what the user just did). DONE 2026-09-23: the handler moved to src/lib/chunkReload.ts handleVitePreloadError (main.tsx only registers it). A background load pending past its timeout is counted LATE; while one is, the handler does not preventDefault and decides after a macrotask: an error backgroundImport's catch marked background-owned (Vite rethrows the very payload object) is ignored, anything else still calls recoverFromChunkError, so the timeout still stops a stalled load from suppressing recovery for unrelated chunks. GUARDS: src/lib/backgroundImport.test.ts "a background import that fails AFTER its gate timeout (Q170)" (fake timers; late background rejection -> no recovery; unrelated route chunk after the timeout -> recovery; red on the pre-fix handler logic and on dropping the ownership check), src/test/prefetchCannotEatNavigation.test.ts (reads the handler from chunkReload.ts and checks main.tsx registers it).
- [x] **Q171 MEDIUM-HIGH (silent-failure review of Q157-Q161, 2026-09-23): send-notification-email's seed-boundary check did not retry PGRST002.** It asked notification_crosses_seed_boundary once and failed closed (503) on ANY error, so PostgREST's schema-cache reload right after a migration deploy (PGRST002) permanently dropped a REAL email; the same file already retried PGRST002 3x for its preference reads (2026-09-08 incident). DONE 2026-09-23: the check retries PGRST002 up to 3 attempts (400/800 ms backoff), any other error still fails closed at once, and 3 PGRST002s still fail closed. GUARD: src/test/edge/send-notification-email-seed-retry.test.ts (real function source through the edge harness: PGRST002 x2 then OK -> sent, queued; PGRST002 x3 -> 503 + 'seed boundary check failed, not sent: PGRST002' log; PGRST202 -> one call, 503; red on the pre-fix function). The harness now serves the real _shared/safe-strings.ts.
- [x] **Q172 LOW (silent-failure review of Q157-Q161, 2026-09-23): the once-per-session 'background import failed' row was marked reported BEFORE it persisted.** src/lib/errorLogger.ts claimBackgroundFailureReport wrote the sessionStorage flag at claim time, so a failed POST lost the report for the session. DONE 2026-09-23: the in-memory claim stops duplicates while queued or in flight; the session flag is written only after a 2xx; a failed POST keeps the row for the next flush (it rides along with the next report(), never schedules its own), at most 3 sends per module per document. GUARD: src/lib/errorLoggerSurvivesFailedChunks.test.ts "a failed background-import report is retried, bounded (Q172)" (first POST 503, a later report() re-sends, exactly one row lands; a never-accepting server gets it at most 3 times; red on the pre-fix errorLogger).
- [x] **Q173 DONE 2026-09-23: deadcodeRatchet back to 97 (WEBHOOK_REJECT_STATUS in supabase/functions/_shared/stripeWebhookReject.ts was exported but only used in its own file; un-exported). Guard: src/test/deadcodeRatchet.test.ts. Was:** main is RED on src/test/deadcodeRatchet.test.ts (found 2026-09-23 by the Q170-Q172 lane): unused exports 98 vs baseline 97 on origin/main 7a7664808 itself** (measured in a detached origin/main worktree; not from Q170-Q172, whose new exports are all consumed). Likely candidate, not confirmed: `WEBHOOK_REJECT_STATUS` in supabase/functions/_shared/stripeWebhookReject.ts (added by d7295a8ef, Q156), exported but referenced only inside its own file. Fix: run `npx knip --include exports,types`, diff against the baseline, remove the new unused export; the guard is deadcodeRatchet.test.ts itself.
- [x] **Q176 OWNER PRIORITY (UI): phone-width page shells have too much space above and below the title (owner, 2026-09-23, 375 screenshot of public /browse).** Large gap between the header and the "← Browse Jobs" title row, and another before the first job card. Fix in the SHARED shells only (PublicHeaderPage, AppShell/PageScaffold/AppPage, document-scroll wrapper + PageHeader, AuthShell): one phone spacing rhythm, public and signed-in; 1440 unchanged unless inconsistent; landing hero untouched. Measure before/after per route at 320/375/390/430 (+1440), evidence in ~/.lh-shots/shell-spacing/. Guard: route-inventory measurement check + unit check that shells use shared tokens. DONE 2026-09-23: two tokens in src/index.css, `--shell-gap` (12px, taken from PageScaffold's `pt-3`/`gap-3` on Dashboard, My Jobs and Messages) and `--public-nav-h` (the Navbar bar height). PageHeader, PageScaffold, AuthShell, the PublicLayout/AuthShell nav spacer (now exactly the nav's height, no extra 12px band), Navbar, and the two skeletons that mirror them read them. Measured on the built app against prod, every catalog route, header→title/title→content at 375 (320/390/430 identical): public PageHeader pages 28/16 → 12/12 (/browse title 16px higher, first card 20px higher), signed-in PageHeader pages 16/16 → 12/12, AuthShell 24/16 → 12/12, PageScaffold 12/12 unchanged. 1440: public pages 28 → 24 (now equal to signed-in 24); nothing else moved. Zero horizontal overflow at 320-1440 before and after. Evidence: ~/.lh-shots/shell-spacing/{before,after}.json + shots, reviews recorded. GUARDS: e2e/prod-audit/shell-spacing.spec.ts (every audit-catalog route at 320/375/390/430 must sit at --shell-gap ±2 above and below its title, 1440 title rows at 24, no overflow; exact-value exceptions; vacuity leg; red on the pre-fix build with 377 violations, green after) and src/test/shellSpacingTokens.test.ts (shells read the tokens, every nav spacer in src uses --public-nav-h; 10/10 red on the pre-fix shells). Page-owned leftovers: Q190.
- [x] **Q177 DONE 2026-09-23 (owner asks): no H loader before the landing page, and no square/clipped H anywhere (commit dac0ea314's parent).** Owner chose a plain background. index.html #boot-loader keeps its role/label and boot-failure hook but no image; '/' loads behind a plain fallback instead of the dashboard-shaped skeleton; HelprSpinner sizes the 96x82 mark by height. WebKit 375 guest load: boot(plain) -> plain-fallback -> landing. Guard: src/test/noBrandLoaderBeforeLanding.test.ts.
- [ ] **Q178 LOAD SPEED: find what the ~4.5s on a slow phone connection is spent on (owner 2026-09-23: 'make sure everything is loading as fast as possible').** Measured (production build, 375, ~1.6Mbps/150ms): /, /browse and /login each take ~4.5s from navigation to real content, identical across routes. The entry bundle is small (index js 12KB gz, css 32KB gz), and starting the route chunk at module load did NOT move the number (4492->4502ms, reverted). So the time is a request WATERFALL (chained modulepreloads/vendor chunks, fonts, auth/session calls, first data fetch). WATERFALL MEASURED 2026-09-23 (landing, 375, throttled): 100 requests before the H1; the landing page's own chunk (Index) is requested only at ~3.8s, LAST. Ahead of it on the critical chain: ~20 route skeletons App.tsx imports statically (Dashboard/Activity/Earnings/Profile skeletons, NotificationPanel, tabs), app-shared 137KB, supabase 53KB (~2.2s), sentry 69KB (~3.5s), framer-motion proxy 38KB, MobileNav/DesktopSidebarNav/dialogs/sheet — in ~8 dependent rounds (0.6, 1.2, 1.4, 1.5, 1.7, 2.0, 2.1, 3.0s...). A preload at App module scope cannot help (App evaluates only after its static graph). Fix: make the shell's static graph minimal (route fallbacks and chrome lazy or per-route), keep sentry/framer/supabase off the landing critical path, and start the entry route's chunk before the shell graph (e.g. main.tsx kicks it off before importing App, or a modulepreload for it). Then re-measure; record a network waterfall per route, cut the chain (parallelise, inline critical, defer non-critical, preconnect/early-hint Supabase), and prove each route's number moves. Guard: a CI performance budget per entry route on the throttled profile.
- [ ] **Q179 FULL VISUAL WALK of every public and signed-in screen (owner 2026-09-23: 'walk through all public and authed screens to check everything visually so everything is fixed and runs how it should').** Per the lh-audit skill: every route at 375 and 1440, light and dark, guest and the shared test accounts, pressing every control (npm run audit:press) plus the core journeys; screenshot every failure and a sample, record each review, fix what is wrong at the shared layer with guards. Runs AFTER the in-flight CLS (jumping) and phone page-shell spacing fixes land, so it judges their result.
- [x] **Q180 DONE 2026-09-23: the email gate now runs on EVERY protected route (allowPending and allowUnapproved included) and fires before the profile loads; an unconfirmed account goes to /account-pending (Check your email + Resend), which now holds it there instead of forwarding an `approved` account to /dashboard (would have looped), refreshes the session every 15s so a link clicked on another device lets it in, and resends land on /account-pending; the nav dock is hidden while unconfirmed; AccountDenied no longer mentions photo/ID. Server side measured: /auth/v1/settings `mailer_autoconfirm:false` (confirm-email ON); lh-authz-rls review measured 0 unconfirmed auth.users and 0 unconfirmed sessions on prod. Screens: ~/.lh-shots/q180/ (verify-email + signup-pending at 375/1440, reviewed; all 5 dock destinations bounce back).** GUARD: src/test/emailGateEveryProtectedRoute.test.tsx (routes derived from App.tsx; 14/20 red on the old ProtectedRoute; @mutate) + src/test/accountPendingUnverifiedStays.test.tsx (red on the old AccountPending; @mutate). Was: Q180 OWNER RULE (2026-09-23): nobody enters the app until their email is verified.** Owner: 'in order to actually finish sign up they must verify their email ... they can't enter until they verify email.' Measured: src/components/ProtectedRoute.tsx:392 skips the email gate for allowPending routes (dashboard, my-jobs, my-posts: 'progressive activation ... browse while they wait'), which contradicts the rule. Live: 60/60 auth users confirmed, 0 unconfirmed signed in; whether Supabase's 'confirm email' blocks unconfirmed sessions server-side is unverified (needs the dashboard or a Management token). Fix: the email gate applies to EVERY protected route (unverified -> the verify-email screen with Resend); confirm the signup flow ends on 'check your email' and verifying lands them in the app; guard with a component test (unverified user on each allowPending route is redirected) + a signup journey. Also: AccountDenied.tsx copy still says 'sign up again with a new photo, ID' (ID upload is gone, Q40).
- [ ] **Q192 Q180 follow-ups from the lh-authz-rls review (2026-09-23).** (a) DONE 2026-09-23 (Q193, measured, no dashboard needed): the landing is now https://www.louisianahelpr.com/signup-pending (/account-pending was deleted). A real admin generate_link for a seeded test account with that redirect_to 303s to exactly https://www.louisianahelpr.com/signup-pending#access_token=… (so it IS allow-listed); https://evil.example.com/steal falls back to the Site URL (not open). Probe: ~/.lh-shots/q193/landing-probe.mjs. (b) The server enforces email confirmation ONLY by GoTrue refusing unconfirmed sessions; no RLS policy or RPC checks auth.jwt() email_verified, so a session minted another way (admin createUser without email_confirm) could write. Decide whether Q180 needs a server half (data-model change, own review). (c) An unconfirmed account that is also banned can land on /signup-pending (the email gate fires before the profile loads) rather than /account-banned, until it confirms (0 such rows live; the denied state no longer exists since Q193). (d) Not checked: whether the desktop right rail renders for an unconfirmed user on public pages (/help, /support, legal).
- [ ] **Q189 Review + wording follow-up for Q30 (2026-09-23).** (b) DONE 2026-09-23: migration 20260923145516 restates the function with the too-late message stating the rule (slot older than its window); PGlite proof src/test/pglite/cronCatchUp.pglite.mjs now applies both migrations and checks the wording (red on the old one). (a) STILL OPEN: run lh-silent-failure REVIEW ONLY on run_missed_cron_catch_up() (migration 20260923133021): it EXECUTEs each job's own cron command. (b) Its too-late alert says 'the database was not healthy again within its window', which was wrong for the four 09-22 slots (the catch-up did not exist yet); say the actual reason (slot older than max_late). Those 4 ledger items were closed 2026-09-23 with the next day's successful run as evidence.
- [ ] **Q190 Page-owned gaps under the title that the shared shells cannot set (found by Q176, 2026-09-23).** With every shell on `--shell-gap` (12px) at phone width, three pages still sit further from their first content, each because of the page's own first element: /legal (and /terms, /privacy, /rules) 20px — its sticky tab band carries `py-2` so pinned policy text has somewhere to disappear; /profile?tab=legal 16px; /profile?tab=wrapped 20px (its own padded hero). Owner decision: fold them into the 12px rhythm (a per-page change) or keep them. They are listed with their EXACT values in e2e/prod-audit/shell-spacing.spec.ts TITLE_TO_CONTENT_EXCEPTIONS, so any change fails there until the list is updated.
- [ ] **Q191 OWNER (2026-09-23): tighten spacing at EVERY phone width, inside pages too, and nothing hand-rolled.** Owner: 'update the spacing on every other phone width. Like all the profile tabs everything that you think needs to be tighter. Also make sure nothing is hand rolled. Most things should use the same component or shell.' Q176 fixed the SHELL gaps (header->title->content 12/12 via --shell-gap). Remaining: in-page spacing at 320/375/390/430: profile tabs (every tab), tab bands, section gaps, card padding, list gaps, and Q190's three page-owned gaps (/legal 20, Profile Legal 16, Wrapped 20). Static scan 2026-09-23: at page level only src/pages/Admin.tsx (and activity/BulkDismissBar) build a layout without a shared shell; the rest is inside pages (per-page padding/gap classes that should be shared tokens/primitives). Fix: one spacing scale for in-page sections (tokens or a shared Section/Stack primitive), applied everywhere; guard: a measured spec across the audit catalog at the four phone widths plus a static check that pages do not set their own section spacing outside the shared primitive, both red first; before/after screenshots looked at.
- [ ] **Q203 16 long-lived signed proof-photo URLs are committed (found by Q75, 2026-09-23).** docs/backups/test-debris-backup-2026-09-11.json (b7bc81eb7, on main) holds 16 Supabase storage signed-URL tokens for proof-photos objects, valid to 2027-09-09: anyone with the repo can fetch those objects. They are test-debris rows, but verify on prod (`storage.objects` for the 16 paths, read-only) whether the objects still exist; if they do, delete the test-owned objects (is_seed rows only) so the tokens point at nothing. Rotating the project JWT secret would also kill them but logs every user out: not recommended. Guard for new ones: src/test/secretScanGate.test.ts (rule lh-supabase-signed-storage-url).
- [x] **Q193 DONE 2026-09-23: the approval-pending (/account-pending) and account-denied (/account-denied) screens and states are deleted; every unverified account lands on /signup-pending ("Check Your Email", 3 steps).** Layers: ProtectedRoute (email gate -> /signup-pending; approval + denied gates removed; ban gate kept; allowPending/allowUnapproved now ignored), SignupPending (names the signed-in session's address when router state/sessionStorage are empty, and the session wins over a stale stored one; refreshSession at most every 15s so another device's click lets the tab in; confirmed -> postAuthDestination()), Signup + both resends -> one helper getSignupConfirmRedirect() = <origin>/signup-pending; pages, routes, prefetch/lastRoute/nativeLaunch/shake/nav lists, robots, sitemap, AASA (NOT /signup-pending), Dashboard denied screen + pending banner, useDashboardData denied redirect, nav Post-FAB pending hide; admin Approve/Deny/Move-to-Pending, DenyUserDialog, Pending/Denied tabs, approval/denial email controls, pending-approvals badge + alert; send-account-status-email now 'verified' only; stripe-idv-webhook no longer writes 'denied' (the ban it re-applies is the lockout) and its under-review notification links /profile; help-center answer no longer promises approval. DB: prod measured 58 approved / 1 pending / 1 denied, both non-approved are is_seed audit fixtures (prod-seed.mjs now seeds them approved); migration 20260923153703 settles them and adds CHECK approval_status IN ('pending','approved') (PGlite 3x: rows settled, audit rows written once, 'denied' insert/update -> 23514, an unknown real denied row fails the migration loudly). The column stays: 15 SQL functions + the profiles INSERT RLS policy + cleanup-abandoned-accounts read it (Q205). Email landing PROVEN: real generate_link with redirect_to=https://www.louisianahelpr.com/signup-pending 303s there with tokens (allow-listed; evil.example falls back to Site URL); in the browser the fragment is consumed and the page continues to /dashboard; an unverified session with refresh allowed reached /dashboard in 6.7s. Screenshots ~/.lh-shots/q193/ (375/1440 + landing + other-device) reviewed and recorded. lh-authz-rls REVIEW ONLY: no server-side hole (no policy/definer function used pending/denied to keep anyone out); stale-address finding fixed; its Medium (old builds' links) filed as Q204. CLAUDE.md "four account-state screens" line, rule inventory, lessons, lh-audit SKILL, 3 agent docs updated. GUARD: src/test/retiredAccountStateScreens.test.ts (source-tree scan: no code names either path, pages gone, robots/AASA, one redirect helper for every signUp/resend, no 'denied' writer, newest constraint statement) + src/test/emailGateEveryProtectedRoute.test.tsx (route-table-derived: unverified -> /signup-pending and pending/denied admitted on all 11 protected routes) + SignupPending.test.tsx; red on 40fd919ff: 6/6, 41/42 and 5 cases; @mutate registered.
- [ ] **Q204 Installed native builds still send new signups' confirmation links to /account-pending, which now 404s (found by the Q193 lh-authz-rls review, 2026-09-23).** App Store 1.0.x bundles the old Signup.tsx, whose emailRedirectTo is <public origin>/account-pending; the web now serves the catch-all 404 there. supabase-js still consumes the fragment, so the user IS signed in, just on a not-found page. Measured: 0 unconfirmed auth users on prod right now (no link in flight), 0 notifications rows linking either path. OWNER DECISION (conflicts with Q194 "no redirects"): add a thin /account-pending -> /signup-pending route until old builds age out, or ship a TestFlight/App Store build and accept the 404 for stragglers. Guard to adjust if a redirect is added: src/test/retiredAccountStateScreens.test.ts.
- [ ] **Q205 Q193 follow-ups (2026-09-23).** (a) Strip the ignored allowPending/allowUnapproved props from src/App.tsx once the Q194 lane has landed (ProtectedRoute accepts and ignores them). (b) Decide whether to drop profiles.approval_status: read by 10 SQL readers (`= 'approved'`), 5 trigger functions, the profiles INSERT RLS policy (WITH CHECK 'pending'), cleanup-abandoned-accounts ('pending' = complete-signup never ran), engagement-automations (approval-resend series + admin digest pending count) and several edge fns; a data-model change with its own review. (c) Dead 'denied' reads now unreachable: complete-signup (resubmission branch), admin-update-email, enforce_referral_credit_eligibility, adminAnalyticsHelpers + AdminAnalytics "Pending Approval"/"Denied" rows + UsersDrillDown filter (labels now misleading). (d) Pre-existing, from the review: a ban is profile-only (no RLS reads ban_status; auth.users.banned_until null for the banned profile), so a banned JWT can still write wherever no RPC/trigger checks ban_status: needs an lh-trust-safety token-swap probe.
- [ ] **Q194 OWNER (2026-09-23): old addresses must not be redirects; every link goes DIRECT to the current page.** Owner: "The old address shouldn't be redirects it should be direct." Redirect routes in src/App.tsx: /availability /earnings /gift-card /help-center /saved-helpers /saved-helprs /schedule /settings /warnings /activity /data-rights (plus ShortLinkRedirect /j /u /m /messages/:id /legal/:tab /post-job/*, which are share links: decide per route and say why). Still EMITTED 2026-09-23 by: app code (FilterSheet, GiftCardTeaser, SaveHelperButton, mobileNavHelpers, desktopNavRoutes, LegalTab, ProtectedRoute, DesktopSidebarNav), live DB functions that write /warnings links into notifications (migrations 20260824243000, 20260824257000, 20260825183000, 20260826040000), 75 stored notifications linking /earnings on prod, emails (check supabase/functions templates), sitemap, audit route lists. Do: point every emitter at the current URL, rewrite stored notification links (replay-safe migration), then delete the redirect routes; guard: no source/DB function emits an old address and App.tsx has no Navigate-only legacy route (red first).
- [x] **Q195 DONE 2026-09-23: main was red on 3 checks (found by the Q135/Q136 cloud lane on e992a4901 and 49747af6b).** (1) `npm run typecheck`: src/test/stripeWebhooksRefuseUnverified.test.ts:86 used `Array.prototype.at` (not in the app lib); now index arithmetic. (2) offeredHelperPrivacy: e2e/prod-audit/fundedOpenJob.ts:212 named its columns only in the 2nd half of a split URL, which the guard reads as `SELECT *`; `select=` moved to the first segment. (3) workflowFalseGreenShapes SET_PLUS_E: the new Q156 negative self-test step in stripe-webhook-guard.yml re-reads its code like its two siblings; the allowlist match now covers all three. GUARD: those three checks themselves (npm run typecheck, src/test/offeredHelperPrivacy.test.ts, src/test/workflowFalseGreenShapes.test.ts), all green again locally.
- [x] **Q40 DONE 2026-09-23: the retired "upload your ID to us" path is gone from every layer (owner: "Remove id"; Stripe Identity collects the ID).** Client: Profile.tsx handleIdUpload, uploadProfileFiles idFile, CompleteProfile, AccountPending idDone, the public-profile select. Admin: People -> Documents "ID Document" section and its id-documents signer. Edge: complete-signup idBase64 and portfolioFiles (the only writer of bare paths into portfolio_urls, so Q23 closes with it); a DENIED account is now refused (403 denied_resubmission) where a raw call with idBase64 used to re-approve it over the admin's denial, and the approving UPDATE carries a not-denied WHERE (authz review L1). DB (migration 20260923145614, PGlite 3x): purge_user_data rebuilt without the column (md5-identical to live otherwise), the 4 id-documents storage policies dropped (bucket kept, private, closed to clients), profiles.id_document_url emptied, pinned NULL by CHECK profiles_id_document_url_retired, client UPDATE revoked. NOT dropped: shipped app builds still select it on every public profile (silent-failure review F1), so the DROP is Q196. Measured before: 53 rows with a value (52 is_seed placeholders + the owner's), 1 object in id-documents (the owner's). The owner's file was deleted via the Storage API (service role) and re-listed: 0 objects. GUARD: src/test/retiredIdUploadStaysGone.test.ts (source + migration halves; red on the old code: 14 hits in 9 files; 7 @mutate killed) + src/test/edge/complete-signup-retired-id-upload.test.ts (red on the old function: 2 of 2; 4 @mutate killed). Was: Legacy upload paths the product no longer has: (a) "upload your ID to us" (b) complete-signup portfolioFiles.
- [ ] **Q196 Drop profiles.id_document_url once no shipped build selects it (Q40 follow-up).** Q40 emptied the column and pinned it NULL (CHECK profiles_id_document_url_retired) instead of dropping it, because the pre-Q40 useUserProfileData names it in an explicit select on every public profile view: a DROP makes that query 42703 on shipped iOS/Android builds and cached web bundles and silently degrades their trust signals (Sentry warning user_profile.trust_signals only). When the store builds in use were cut after Q40: a migration with DROP COLUMN (+ DESTRUCTIVE-DDL-ACK), drop the constraint with it, remove the id_document_url lines from types.ts and the write-contract snapshot, remove the optional id_document_url key from GateProfile in src/components/ProtectedRoute.tsx and its KNOWN_READERS entry. GUARD: src/test/retiredIdUploadStaysGone.test.ts already accepts "dropped" and fails on a re-add.
- [ ] **Q197 complete-signup uploads a denied account's files before refusing it (Q40 authz review, Info).** The denied-resubmission 403 runs after the avatar/license/insurance uploads (index.ts step 1-2b), so a denied user can still put objects into storage (bounded by signupRateLimitPerHour). Move the currentProfile read + refusal above the uploads; edge test that a denied call stores nothing even with avatarBase64/licenseBase64.
- [x] **Q198 DONE 2026-09-23: the sitemap lists canonical URLs only (owner: 'make sure the site map is 100% accurate').** Measured live (Playwright on www.louisianahelpr.com): all 10 listed URLs answered 200 with real pages, but /terms, /privacy and /rules each declare a /legal URL as canonical, so every legal page was advertised twice. The generator now drops aliases of <Legal>; public/sitemap.xml is 7 URLs (/, /browse, /help, /support, /legal, /legal?tab=community, /legal?tab=privacy), each loading with its own canonical. Deliberately NOT listed (unchanged): sign-in/account screens (NOINDEX in the script), redirect routes, authed routes, and /jobs/:id + /user/:id (parameterised; most jobs are test data and jobs expire). GUARD: src/lib/sitemap.test.ts 'lists canonical URLs only' (red on the old sitemap) + sitemap-drift.yml (--check).
- [ ] **Q199 A visitor on the site during a deploy can get 'Helpr couldn't load' (seen 2026-09-23 ~15:15Z).** A Playwright walk of the live sitemap during a Vercel deploy got the error screen on /support (after the chunk-reload `?_v=` retry), /legal and two /legal tabs; a re-run a minute later loaded all of them. The stale-chunk recovery (src/lib/chunkReload.ts) should land the visitor on the working page after one reload, never on the error screen. Reproduce by loading a page, deploying, then navigating; guard with a spec that serves a missing chunk.
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
   Measured from the API gateway's edge_logs: press-every-control run
   35837735324 PATCHed `marketing_settings` at 10:50:07Z on 2026-09-23 as
   admin@louisianahelpr.com (referer 127.0.0.1:4173, the CI runner), and every
   press run since 2026-09-22 17:52Z had been flipping the Auto-publish and
   channel switches the same way (17 PATCHes in 6 runs). The sweep can no
   longer press admin switches (Q166). Live now: auto_publish_enabled = true,
   Instagram on, Facebook off; the Meta secrets are missing, so nothing posts
   and marketing-publish now reports this once a day as an owner to-do instead
   of a critical page every 15 minutes. Pick one: (a) **off** until you add the
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
- [x] **Q45 Prove the database backup can be RESTORED.** DONE 2026-09-23.
  Guard: `src/test/dbRestoreDrill.test.ts` pins `.github/workflows/db-restore-drill.yml`
  (weekly, Tue 14:17 UTC; restores the newest db-backup artifact into a
  throwaway local Supabase stack via `scripts/db-restore-drill.sh`, fails on
  any unlisted restore error, on a key or money-ledger table missing, empty or
  off by more than max(50, half of prod), on anon EXECUTE above the backup's
  own grants, and on missing cron schedules or storage policies; reports via
  nightly-issue-sync). Red on 3 mutations. The first restore (run 35836045277)
  was red: every function came back anon-executable (306/306; prod 17/321), 0/55
  cron schedules, no pgmq queues, no `ensure_rls`. The drill now carries those
  repairs, and db-backup now also exports `cron.sql` and
  `storage-policies.sql` and retries the dump. Green: run 35837914689 (4 s
  restore, 0 errors, all counts match the backup). Runbook:
  `docs/runbooks/restore-from-backup.md`. Two facts contradict older docs, both
  measured: the org plan is **pro** with 7 daily platform backups (no PITR),
  and artifacts are kept **14 days**, not 90 (repo retention cap). Owner
  decisions: MORNING QUESTIONS 7.
- [ ] **Q46 Test data is seed data from birth.** E2E/press/prod-audit write to
  prod (by design: no mock mode). Every fixture writer must set is_seed at
  insert time, and every alerting detector must state how it treats is_seed.
  Add a guard that scans the test writers and the detectors. This is Q2's
  structural half.
  DETECTOR HALF DONE 2026-09-23: src/test/alertingDetectorsDeclareSeedPolicy.test.ts
  (every SQL/edge detector that alerts about jobs/payments references is_seed
  in code or declares `seed-policy:`; red on origin/main 741e9d3a6 with 14).
  OPEN: the fixture-writer half (is_seed set at insert time).
- [ ] **Q47 Sessions work in their own worktree, not the shared checkout.** On
  2026-09-23 two sessions' commits made each other's trees lag, and an agent
  found itself in the shared checkout mid-task. Make the session-start hook
  create or enter a per-session worktree (or warn loudly), and treat the main
  checkout as read-only for sessions.
- [~] **Q48 Messages search: the close ✕ overlaps where the magnifier returns**
  (prod-audit run 35817028797 on 3c81624d0): by 28px at 320 and 26px at 375.
  Pressing ✕ to dismiss puts the next tap on the re-open control. Found by
  e2e/prod-audit/expanding-search-geometry.spec.ts:559. Fix the geometry,
  re-run that spec, and screenshot at 320/375 before and after.
  **375 AND UP FIXED (2026-09-22)**, guard e2e/prod-audit/expanding-search-geometry.spec.ts
  (messages@375 red before: ✕ 192…220 vs magnifier 194…238 = 26px; green after:
  ✕ 144…172 = 0px, field 141px vs floor 120, slot-deleted vacuity back to 26px;
  1440 unchanged 0px). ConversationList holds the hidden chevron's 44px box while
  search is open from 360px up, so the cluster no longer shifts 48px right
  (the hamburger also stopped jumping 242 → 290). Full spec locally, prod
  backend + local build: 15 passed, 1 failed (messages@320). Shots ~/.lh-shots/q48/.
  **320 STILL RED — OWNER DECISION, the two clauses cannot both hold there.**
  Resting magnifier left edge is x139, the row starts at x41, the row gap is
  8px: a ✕ that clears the magnifier caps the field at 90px, under the 120px
  floor (d) that e794385ab restored. Measured both: box held → field 90px, ✕
  clear ("Se" visible); box not held (shipped) → field 138px, ✕ overlaps 28px.
  Options: (A) accept a 90px field at 320 and pin `minFieldPx` for messages
  with the reason; (B) keep the 28px overlap at 320; (C) reorder the resting
  cluster so the magnifier is rightmost below 360 (changes VN-35's order);
  (D) open the field on its own line under the title below 360 (it is where
  the tab strip sits, which search already hides).
- [x] **Q49 DONE 2026-09-23: the messy-input FormSpecs that failed on prod now reach their forms.**
  GUARD: e2e/prod-audit/messy-input.spec.ts itself (its per-form field floor
  plus the coverage test), run LOCALLY against prod (`PLAYWRIGHT_WEB_SERVER=1
  npx playwright test --project=prod-audit e2e/prod-audit/messy-input.spec.ts`).
  RED on the original: all 7 sweeps failed exactly as in run 35817028797
  (before.log), and the coverage test failed on 14 unaccounted files (the same
  14 CI named plus DisputeDialog). GREEN after (second full run, 55 min): 113 passed, 2 failed; the
  7 sweeps and 7 new FormSpecs pass; the coverage test's unaccounted list is empty (67 exercised, 51
  gaps, 118 inventory). The 2 that did not: `explore: admin-health` (Q101, a
  detector false positive on data, passed in the first full run) and the
  coverage test's stale-gap half, which was ALREADY red under the first failure
  (DateRangeBar.tsx listed as a gap but credited by `explore: admin`) - gap
  removed, coverage re-run green on the same credits. Causes, per form: the
  report dialog opens on a reason picker (press "Something else"); both
  helper-card chips are named by their ariaLabel and Cancel Job sits behind the
  card's More overflow; the poster "Dispute" chip only exists on an expired
  revision, so DisputeDialog is opened from the helper's "Report a problem"
  (and `covers` now names DisputeDialog.tsx, not ActivityDialogs.tsx, which the
  inventory does not list); the disputed/confirmed/en-route fixtures are
  resolved from the HELPER's own jobs (any poster; harness.ts
  `helperDisputedJob` etc.) because poster-e2e had no disputed job; cards are
  opened with the app's own `?job=` deep link, so the right bucket is shown;
  Admin Reports widens to "All" and skips the disabled "Message Reported";
  the credential queue's only row had no document, so the helper attaches one
  to its own pending credential for the run (harness.ts
  `ensureMessyInputState`, restored in afterAll with a fresh session) and
  prod-seed.mjs now seeds it with one. CI re-dispatch of prod-audit NOT done
  (GitHub API rate-limited this session). Evidence ~/.lh-shots/q49/.
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
- [x] **Q107 CredentialsTab saveBusinessName has no `.select()` (Q99 follow-up).**
  `update({business_name})` checked only `error`, so a zero-row update showed
  "Saved." and patched the cache from the request. Fixed: chains
  `.select(SELECT_COLS)` and unwraps through `unwrapMutationRow`
  (src/lib/mutationResult.ts), same pattern the rest of the file uses since
  2a1964cc5; the local cache patch now mirrors the RETURNED row via
  `setFromRow`, not the request. Guard:
  src/test/businessNameSaveObservesRowCount.test.ts (source-scan, 1 @mutate),
  proven red on the unfixed code (missing `.select()` on the business_name
  write), green on the fix. `patchCache` became dead code as a direct result
  of this fix (its only caller was the code this replaced) and the
  `no-unused-vars` pre-commit lint blocked the commit on it, so it was
  removed rather than left; the one remaining mention is a historical
  comment, unaffected.
- [x] **Q109 useActivityBadgeCounts' debounce timer didn't re-check visibility
  at fire time.** `scheduleLoad()` checked `isHidden()` only when a wake-up
  arrived; if the 400 ms timer started while visible and the tab was hidden
  before it fired, `loadCounts()` still ran both reads while hidden —
  contradicting the file's own comment ("nobody can see a badge on a hidden
  page"). Fixed: the timer callback re-checks `isHidden()` and defers to
  `onVisibility` the same way the schedule-time path does. Guard:
  src/test/hotQueryLoad.test.ts's new behavioural test ("re-checks visibility
  when the timer fires…", fake timers + controllable
  `document.visibilityState`, 1 @mutate), proven red on the unfixed code (1
  read while hidden instead of 0), green on the fix.
- [x] **Q108 DONE: the sent-document link is no longer cut off at 375.**
  "View the License You Se..." on /profile?tab=credentials after a license is
  sent. The button now wraps (`min-w-0 break-words` instead of `truncate`);
  copy, icon, X and the 44px row are unchanged. Measured on prod data (helper
  test account, license + COI sent, then withdrawn and objects deleted): 375
  License label scrollWidth 171 > clientWidth 169 before, 169 <= 169 after
  (COI 169/169 both); 1440 978/978 both; light and dark. The rejected state
  uses the same JSX branch (code read; not screenshotted). Evidence ~/.lh-shots/q108/{before,after}-{375,1440}-{light,dark}.png.
  Guard: src/test/truncatedActionLabel.test.ts (every a/button/Button/Link/
  Radix Trigger in src/components/profile, TS AST: no truncate/text-ellipsis/
  line-clamp on the control or a descendant without title/aria-label; exact
  two-way KNOWN list), red on the old `truncate`.
- [x] **Q116 Two clipped labels inside controls in src/components/profile (found by the Q108 guard, 2026-09-23).**
  Guard: src/test/truncatedActionLabel.test.ts, widened from src/components/profile
  to all of src/ (112 -> 828 controls, 501 files; 37 new offenders, 39 total).
  Measured on prod as poster-e2e 2026-09-23 (~/.lh-shots/q116): LegalTab tab labels
  sw==cw at 320/375/1440 and SettingsSection descriptions sh==ch at all three, so
  both stay on the exact allowlist with that measurement as the reason. /messages
  at 375: job title sw241>cw231 and preview sw261>cw231 with no full text; 15 user-data
  truncations (names, job titles, previews, file names, locations) now carry a
  `title` with the full text, layout unchanged. The other 22 are Q119.
- [ ] **Q119 22 clipped control labels the Q116 widening found, not yet measured on screen.**
  Listed as UNMEASURED in KNOWN in src/test/truncatedActionLabel.test.ts
  (DatePickerField, DesktopSidebarNav, SavedSearches summary, TimeRangeField,
  JobCardMetaRow city, BrowseSearchBar, JobDetailFooter x3, NavQuickMenu x2,
  CollapsedPolicy x2, AddressAutocomplete x2, PetPicker breed line,
  ActivitySectionedView, PetCard, PetRailRow meta, EntryChoice x2, FormStep).
  For each: measure scrollWidth/clientWidth (line-clamp: scrollHeight) at 320/375/1440
  on prod; clipped UI copy wraps or gets its full text, clipped user data gets a
  `title`, unclipped stays with a dated measurement as its reason.
- [~] **Q100 A funded open job fixture for the four poster-side forms (Q49
  follow-up).** PARTLY DONE 2026-09-23: e2e/prod-audit/fundedOpenJob.ts
  (`ensureFundedOpenJob`, exported from harness.ts) makes "an open, escrowed
  job of poster-e2e helper-e2e has not applied to" through the app's own path
  (poster JWT jobs INSERT, is_seed -> create-payment escrow -> hosted Stripe
  TEST Checkout, 4242, cs_test_ only -> stripe-webhook checkout.session.completed
  sets escrow), reuses it across runs, refreshes it through create-payment
  cancel_escrow at <7 days runway, and THROWS (never skips) on a refused
  checkout, a webhook that does not land in 90s, or a fixture the helper still
  cannot see after the 20-minute early-access window. deep-links,
  interruptions and messy-input call it in beforeAll. Measured locally on
  prod: those 10 UNJUSTIFIED skips from run 35844514386 -> 0 skipped, 33 passed,
  1 failed (Q131); one payment across three runs (idempotent), teardown proven
  (refund re_3UInyYKp2H4b7tEC14Eya1Kl, 2500c, job cancelled/cancelled). Guard:
  src/test/fundedOpenJobPlan.test.ts (plan cases + every spec reading openJob
  calls ensureFundedOpenJob before resolveFixtures; 3 @mutate, all killed).
  STILL OPEN, the original ask: EditJobDialog, CancellationDialog, ApplicantsPanel and
  DeclineApplicantSheet open only from a FUNDED open job of poster-e2e with a
  pending applicant; My Posts hides unfunded open jobs
  (activityFilters.ts `jobIsUnfundedDraft`) and on 2026-09-23 every open job
  poster-e2e had was unpaid/abandoned. They are GAPS in messyInputForms.ts
  (`FUNDED_OPEN_JOB_GAP`) until a fixture posts one through a Stripe test
  checkout, has the helper apply, and tears down with cancel_escrow; the
  coverage test's stale-gap check fails the day they are credited.
- [x] **Q101 The error-screen detector reads QUOTED error copy as an error
  screen.** `explore: admin-health` failed "broken before any input" on the
  second local run because /admin?view=health lists recent error_logs rows,
  one of which reads "Error screen shown: We couldn't load your account."
  (4 rows, 2026-09-22 15:10Z), and findErrorScreen matches body text. It
  passed on the first run (timing of that list). admin-views.spec.ts reads the
  same way. Exclude quoted log text from the check (e.g. a data attribute on
  the health rows, stripped before matching) with a guard that stays red on a
  real ProtectedRoute failure. DONE 2026-09-23: AdminHealth's Open Alerts
  (ops_alert_ledger) and Scheduled Jobs (error_logs) rows carry
  `data-quoted-log`; e2e/errorScreens.ts `readScreenText` returns those spans
  and `findErrorScreen` drops them before matching (the same copy outside the
  marker still fires). Every caller (sweepCore, admin-views.spec, prod-audit
  harness, journeys fixtures) reads via `page.evaluate(readScreenText)`;
  press-every-control strips them in `screenErrorText`. Guards:
  src/test/quotedLogRenderersMarked.test.ts (inventory of every src/ SELECT
  on error_logs/ops_alert_ledger/ops_alert_pending -> hooks -> consumers ->
  renders, floor >1; plus every findErrorScreen caller; 3 @mutate, all
  killed) and the detector cases in
  src/test/errorScreenPatternsVsAppProse.test.ts (quoted -> null, unquoted
  and quoted+real -> "account load failure"; @mutate killed). Not yet
  re-run: the admin-health explore itself (needs the browser).
- [x] **Q102 The admin credential queue can show a row with no Approve or
  Reject.** `get_pending_credentials` lists any helper_credentials row in
  unverified/submitted, but AdminCredentialQueue renders the actions only
  when that row has a document (license_status pending AND license_url).
  RLS lets a member INSERT a helper_credentials row with no document_url, so a
  pending row can sit in the queue with nothing for an admin to act on
  (prod's seeded one still does outside a messy-input run, until prod-seed.mjs
  is re-applied). Either require a document server-side or
  render the row as "no document yet". DONE 2026-09-23 (20260923101130):
  VALIDATED CHECK helper_credentials_pending_review_needs_document (a
  trade_license/insurance row in unverified/submitted needs a non-blank
  document_url; background_check stays exempt because stripe-webhook inserts
  it 'submitted' with no document), and get_pending_credentials() reads only
  documented rows, reports 'pending' only with a document (either store) and
  lists a person only when one credential is actionable. Prod violators before
  the change: 0 of 3 rows. Guards: src/test/pendingCredentialNeedsDocument.test.ts
  (7 @mutate, all killed; 5 of 7 red on the chain without the migration) and
  src/test/pglite/pendingCredentialNeedsDocument.pglite.mjs (3x apply, ALL
  PASS; NEW_MIGRATION=skip -> 8 FAILED). Needs an lh-authz-rls REVIEW-ONLY pass.
- [x] **Q106 A signed-in client can log error rows as a guest (MEDIUM, review
  of 469cf4e3f, 2026-09-23).** Live policy anyone_can_insert_errors checks
  `user_id IS NULL OR user_id = auth.uid()`, so an authenticated session may
  insert user_id NULL. trg_error_logs_zz_user_error_screen then passes NULL to
  ops_alert_record_user_error_screen, which applies the guest repeat cap (20)
  instead of the per-account cap (5) and spends the shared guest budget. Fix:
  stamp_error_log_origin (BEFORE INSERT) sets NEW.user_id := auth.uid() for
  role authenticated, so a signed-in client cannot erase its identity; guard
  red on the unstamped definition. DONE 2026-09-23 (20260923094457, from the
  live pg_get_functiondef): stamp_error_log_origin sets NEW.user_id :=
  auth.uid() for role authenticated (still SECURITY INVOKER). The only client
  writer, src/lib/errorLogger.ts, sends the id from the localStorage session
  blob or null when it cannot read one; either way the row is now the JWT's.
  Guard: src/test/errorLogClientIdentityAndThrottle.test.ts (@mutate);
  behaviour: src/test/pglite/userErrorScreenRepeatCap.pglite.mjs (auth insert
  with user_id NULL -> stored as the caller, ledger count 5, was 20).
- [x] **Q50 Verify card holds on cancelled jobs on STRIPE's side, not just ours.**
  DONE 2026-09-23 07:20Z. A temporary read-only edge function (deployed, run,
  deleted; key mode test) read all 79 cancelled jobs' PaymentIntents: every
  one succeeded (capture_method automatic_async: charges are captured at
  checkout, there are no holds), amount_capturable 0, 0 requires_capture,
  0 livemode. Each was captured then partly refunded (77 x $28->$25, 1 x
  $44->$40, 1 dispute refund $28->$26.89), and Stripe's amount_refunded
  equals each job's payment_refunds sum. No held or un-refunded money. Kept
  from recurring by money-reconciliation (78a88a861), which now reads every
  settled job's PI from Stripe (30-day window, read only) and pages on a live
  hold / processing payment, a cancelled job refunded less than the fee
  ceiling, a ledger/Stripe refund mismatch, or a missing PI. Guard:
  src/test/edge/money-reconciliation-stripe.test.ts (11 tests, 4 @mutate
  killed). Live run 07:31Z (request 581): 200, all four checks in
  checks_run, 0 Stripe reads, because the real scope (is_seed = false)
  holds 0 settled jobs with a PaymentIntent today; every Stripe-touching job
  is seed.
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
- [ ] **Q89 Q52 area 1 remainder: vacuity SURVIVED list (2026-09-23).** CI full
  sweep 35822511272 was still in_progress at 07:50Z (log unreadable until it
  ends). Local non-Playwright sweep scored ~825 of 1093 registrations before it
  was stopped: SURVIVED = src/test/emailDlqIsWatched.test.ts (both
  registrations on 20260922155258_email_dlq_alerting.sql — the guard likely
  reads an older or different definition; make it read the NEWEST definition)
  and everyScheduledWorkflowReportsItsResult (FIXED in Q52). RED BEFORE ANY
  MUTATION (inconclusive): src/test/edge/create-payment.test.ts ("admin only"
  expectation), src/test/deadcodeRatchet.test.ts and baselinesAreTwoWay (both
  green after the Q52 rebase), generatedInventoriesCurrent (burndown refresh).
  TODO: read 35822511272's full log when it ends, finish the remaining ~270
  unit registrations + the 56 Playwright ones, fix every SURVIVED, prove killed.
- [x] **Q53 DONE 2026-09-23 (82c0f6992, 21bf0bb0a, af66b2f51): saturation is now DETECTED before it tips over, and the measured hot spots are cut. The exact root cause stays a hypothesis (below); proving a capacity ceiling is Q60.**
  GUARDS: src/test/dbSaturationMonitor.test.ts (newest-definition wiring:
  both ledger sources, 5-min schedule + liveness row, prod-errors feeds the
  log count before the ledger sync, no correlated re-scan in
  sweep_silent_cron_failures; 6 @mutate killed, red with the migration
  removed), src/test/hotQueryLoad.test.ts (exact inventory of every client
  network poller with a 15 s floor, no refetchIntervalInBackground, and the
  nav badge hook shares one store / coalesces / holds while hidden; 7 @mutate
  killed, red on the old hook), src/test/pglite/dbSaturation.pglite.mjs (3x
  apply; thresholds pinned from outside; hourly dedupe; close rule NULL /
  true / false; same streaks as the old sweep; 5 planted defects red).
  DETECT: public.check_db_saturation() every 5 min (cron db-saturation-check,
  expectation 20 min) samples client conns / max_connections, non-idle
  backends, longest active statement, idle-in-transaction > 5 min, and a
  window from pg_stat_statements (calls/s, SQL ms/s, app-role calls-weighted
  p95) into public.db_saturation_samples; thresholds in
  db_saturation_thresholds() (90% conns, 15 active, 120 s, 1 idle-in-xact,
  1000 ms/s, p95 100 ms; timeouts 5/h vs 19-42/h on 09-22). Breach -> one
  error_logs row per hour, source db-saturation -> ledger. Statement timeouts
  (postgres_logs only) come in hourly from prod-errors.yml via
  scripts/db-saturation-check.mjs, source db-statement-timeouts; the step
  fails the run if the DB or logs cannot be read. ops_alert_condition closes
  either only on a NEWER clean sample. Two scoreboard rows (STALE if the
  sample is late); the connection row now counts client backends.
  BEFORE/AFTER (measured): sweep_silent_cron_failures cron run 2,676 ms
  (08:47Z) -> 412 ms (09:47Z); its detect query 2,552 ms -> 20 ms (EXPLAIN
  ANALYZE, identical per-job output on prod's cron_run_log). Nav badges per
  page load (two consumers, fake transport counting calls): 2 RPC + 2 counts
  + 2 realtime channels -> 1 + 1 + 1; the PROD re-measure is Q103 (no browser
  run on new code had hit prod by 09:30Z). New cost: check_db_saturation()
  90-452 ms per 5-min run (~0.5 ms/s). A whole-DB calls/s comparison is not
  meaningful: load is set by which CI suites are running (baseline 32 calls/s
  and 51 ms/s over 17.5 h; 5-min windows 09:25-09:45Z 53-123 calls/s, 71-196
  ms/s, app p95 7.1-12.9 ms, during a press run + push suites). Live monitor
  verified: samples every 5 min since 09:20Z, all clean; prod-errors run
  35845088930 fed "0 statement timeouts in 60 min" (workflow sample stored).
  Near-miss worth knowing: 09:40Z had 14 active backends (threshold 15) and
  85-87% connections during CI bursts. Owner compute-tier decision: NOT raised
  now — no breach since the restart; the monitor will say if one comes.
  Hypothesis for 09-22 (unproven): sustained CI browser load on a small
  instance; Q60/Q104 measure the ceiling.
  CORRECTIONS to the evidence below (measured 2026-09-23 ~09:00Z):
  "client polling" was not polling — src/ has one refetchInterval (admin
  broadcasts, 15 s) and three gate-screen timers. The applications count and
  get_my_pending_direct_offers are the nav badges, fired on every page load
  TWICE (MobileNav and DesktopSidebarNav both mount useActivityBadgeCounts;
  edge logs 1.89-2.0 offer RPCs per user_blocks request) and on every
  realtime wake-up. Of at least 112,356 such requests in the 24 h to 09:00Z,
  105,824 (94%) came from CI preview builds (referer 127.0.0.1:4173, mostly
  HeadlessChrome from Azure), most of the rest from other localhost ports, 690
  with no referer, and 687 (0.6%) from louisianahelpr.com. The "29 s CI live check" is not CI: 2 calls total, as
  postgres, no source in the repo (scripts/check-live-privileges.mjs runs a
  different query) — an ad-hoc information_schema.column_privileges read. The
  "256 statement timeouts after the restart" were the outage hours: postgres_logs
  shows 0 from 16:00Z 09-22 to 09:10Z 09-23.
  EVIDENCE GATHERED 2026-09-23 ~05:40Z (Supabase logs + pg_stat_statements):
  - Timeline: 08:00-15:00Z, 22-42 "canceling statement due to statement timeout"
    per hour plus connection/SSL resets; then at 15:00 "the database system is
    shutting down" / "terminating connection due to administrator command".
    pg_postmaster_start_time = 2026-09-22 15:23:42Z: a RESTART ended it.
  - What timed out was NOT app SQL: 92 PostgREST schema-cache introspections,
    47 `pg_timezone_names`, ~60 postgres_exporter metrics queries. Trivial
    catalog reads starving means the INSTANCE was resource-starved, not one bad query.
  - Load since the restart (14h, 1.46M statements, ~29/s, 30 of 60 connections
    in use, pre-launch with no real users): realtime WAL polling (97k calls,
    897s) + publication scans (186k); client polling of applications+jobs
    (30k, 310s); storage.objects lookups (41k, 249s);
    get_my_pending_direct_offers (32k); OUR OWN CI live check (column
    privileges query, 29s EACH); sweep_silent_cron_failures (2.4s each).
  - HYPOTHESIS (not proven; no CPU/memory graphs available through these
    tools): the smallest compute tier + constant realtime/polling load +
    prod-hitting sweeps + dozens of migration deploys on 09-22 (each forcing a
    PostgREST schema reload, 92 of which timed out).
  - TO DO: (a) monitor saturation BEFORE it tips over: statement-timeout rate
    from postgres_logs, connection use as a % of max, and slow-query p95, into
    the alert ledger; (b) cut the load: audit client polling (refetchInterval
    etc.), realtime subscription count, the 29s CI privileges query, and the
    2.4s cron sweep; (c) OWNER DECISION: compute size vs the free tier (a paid
    upgrade is the owner's call; see memory free-tier-no-paid-upgrades).
  Original item: ROOT-CAUSE the 2026-09-22 database outage. 457 pg_cron jobs never
  started (08:00-15:00Z "job startup timeout"); uptime reported "database: no
  answer in 10000ms"; profile loads timed out (the owner saw the error screen at
  15:10Z); "connection failed" bursts followed at 19:00Z. It was detected and
  alerted, but WHY is unknown: free-tier resource limits, connection
  exhaustion, a long lock, a runaway query, or a Supabase incident. Read
  Supabase logs (MCP get_logs postgres/pooler), pg_stat_statements, the
  connection counts, and the platform status history for that window. Name
  the cause, fix it or add a guard (connection-count / CPU / slow-query alert
  BEFORE it tips over), and record the evidence.
  SCOREBOARD SAMPLE 2026-09-23 05:53Z (read-only, scripts/scoreboard.mjs):
  52 of 60 connections in pg_stat_activity (87%; 43 client backends), vs
  30 of 60 in the note above — one instantaneous sample, not a trend; the
  scoreboard's DB-health rows now re-sample it on every refresh.
- [ ] **Q54 Front/back PARITY sweep: every rule enforced in two places must
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
- [ ] **Q55 Three real errors in the 09-22 postgres logs, unrelated to the outage:**
  (a) `invalid input syntax for type uuid: "user-1"` x120: something sends a
  fixture/placeholder id to prod (a test with a fake id, or a client
  default); (b) "invalid column for filter customer_id" x12: a realtime
  postgres_changes subscription whose filter the server rejects, so the
  channel silently never delivers; (c) "permission denied for table jobs"
  x14 at 15:00Z: a role reading jobs it no longer may (after the column
  revokes?). Find each source, fix it, and add a check for the class
  (realtime filters validated against the publication/columns; no
  placeholder ids reach prod).
  RE-MEASURED 2026-09-23 ~14:45Z (logs, last 24h): (a) STILL LIVE, 4,190 in 24h. Source found: user-agent `node`, requests `GET /rest/v1/thread_archives?...&user_id=eq.user-1` (232 in 12h) and `thread_pins?...user_id=eq.user-1` (227), i.e. UNIT TESTS: vitest.config.ts `test.env` points VITE_SUPABASE_URL at PROD, so any test that renders Messages without mocking src/lib/pinnedConversations.ts / archivedConversations.ts sends real requests. Fix: a setup.ts fetch guard that refuses *.supabase.co in unit tests (opt-in for the few live tests) plus mocks for the leaking specs; guard red on a spec that calls supabase unmocked. (b) 0 in 24h (gone). (c) STILL LIVE, 768 in 24h: user-agent `node`, `GET /rest/v1/jobs?select=*&limit=1` and `jobs_helper_safe?select=*&limit=1` returning 401 (~60 each in 12h). Source not yet pinned: likely a deliberate anon-denied probe (scripts/probes/*, db-smoke), unconfirmed; if deliberate, make it not log as a Postgres ERROR, or exclude it from the error counts.
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
- [ ] **Q57 Nightly refresh jobs can PROVE a file is stale but can't UPDATE it.**
  GitHub Actions here cannot push to main or open PRs
  (can_approve_pull_request_reviews=false; found by Q36). So re-measured
  evidence (loading states, press ledger, overlay baseline) must be committed
  by hand, which is exactly how numbers went stale. OWNER SETTING: Repo ->
  Settings -> Actions -> General -> Workflow permissions -> "Read and write" +
  "Allow GitHub Actions to create and approve pull requests". Then wire the
  refresh workflows to open an auto-merging PR with the regenerated files.
3. **Let GitHub Actions commit the nightly re-measurements (Q57).** One
   setting: Settings -> Actions -> General -> Workflow permissions -> "Read
   and write permissions" + tick "Allow GitHub Actions to create and approve
   pull requests". Without it, stale numbers can only be fixed by hand.
- [x] **Q58 DONE 2026-09-23 (a, b, c, e; d split out as Q85): ONE place for everything open.**
  GUARDS: (b) the GENERATED "Everything open" block at the top of this file is
  written by scripts/scoreboard.mjs and regenerated-and-diffed on every push by
  scripts/check-generated-current.mjs (entry `scoreboard`, after `queue-count`;
  shown RED by ticking Q60 without regenerating: `--only scoreboard` exits 1);
  its live lines (ledger, nightly-red, workflows, branches) are carried forward
  and aged out by scripts/check-staleness.mjs (72h) and refreshed daily by
  .github/workflows/scoreboard.yml. (c) .claude/hooks/session-start.sh prints
  that block first (`scoreboard.mjs --open-block`: ledger + nightly-red counts
  re-measured live with 6s caps, 2.4s measured; never fails). (e)
  src/test/onlyOneOpenList.test.ts fails when any other tracked doc (except
  docs/archive/) declares itself a todo/open-items/backlog list or carries a
  `- [ ]` line; two-way allowlist with reasons (9 entries 2026-09-23, incl.
  TODO.md pending Q84 and the retired OPEN_ITEMS.md pointer); RED when a
  `- [ ]` is planted in docs/GUARD-BURNDOWN.md (its @mutate). (a) was Q16.
  Was: ONE place for everything open (owner, 2026-09-23: "all tracked in 1
  place so new sessions can easily pick up and leave"). Tonight open work
  lived in five places: this file; docs/audit/OPEN_ITEMS.md (stale 935
  commits); the audit bus findings.jsonl (334 open); the ops_alert_ledger
  table (35 open alerts); GitHub nightly-red issues; plus handoff notes in
  memory. Make docs/OPEN.md the single entry point:
  (a) retire OPEN_ITEMS.md (fold its live rows into the audit bus or here,
  then leave a one-line pointer);
  (b) a GENERATED "Everything open" block at the top of OPEN.md with the live
  count and link for each source: queue items, audit-bus open findings and
  blockers, ledger open alerts, open nightly-red issues. A scheduled refresh
  plus check:generated keep it current;
  (c) session-start hook prints that same block first;
  (d) handoff memories POINT here instead of carrying their own lists, and the
  session end (pause/handoff) updates this file;
  (e) a guard that fails if a new doc declares itself an open/todo list or
  grows unchecked checkbox lists outside docs/OPEN.md (allowlist with reasons,
  two-way).
- [x] **Q59 DONE 2026-09-23: docs/SCOREBOARD.md, generated by scripts/scoreboard.mjs.**
  GUARDS: src/test/scoreboardNeverGreenWithoutMeasurement.test.ts (every row
  has a known status + measured-at stamp, every UNKNOWN a reason; an old
  success is STALE, a missing run UNKNOWN; the log parsers read real `gh`
  log shapes and return null, never zeros; RED when the STALE rule is
  removed, its @mutate); scripts/check-generated-current.mjs diffs the LOCAL
  rows every push; scripts/check-staleness.mjs fails when the LIVE section is
  older than 72h (RED at --now +90h); .github/workflows/scoreboard.yml
  re-measures daily 19:17 UTC and publishes job summary + artifact (it cannot
  commit until Q57); schedule-heartbeat.yml watches that it runs. Rows it
  cannot measure yet are UNKNOWN with the reason: `npm run gate` (per-machine
  record ~/.lh-gate/last.json, written by scripts/gate.mjs from now on) and
  the Postgres-log statement-timeout count (needs the Management API token,
  so only the workflow measures it). Every workflow file gets its own row.
  Was: A live SCOREBOARD of everything we test or track (owner,
  2026-09-23: "it should show numbers of we test this this is what's passing
  / failing"). A generated docs/SCOREBOARD.md, linked from the top of this
  file (built together with Q58). One row per signal, each with pass / fail /
  total, when it was last measured, and the link to the run:
  - Vitest (files and tests, last main run); lint and typecheck; `npm run gate` steps
  - Vacuity: guards proven / exempt / owed; mutations killed / survived
    (weekly full sweep — stays weekly on cost, owner 2026-09-22; see Q52)
  - press-every-control: controls found / pressed / failed; session deaths
  - prod-audit, e2e-journeys, e2e-real-backend, nightly-webkit, ui-sweep: specs passed / failed / SKIPPED
  - every scheduled and push workflow: last result, and red for how long
  - ops alert ledger: open / verifying / closed, by severity
  - audit bus: open findings and open blockers
  - this queue: done / partly done / open
  - numbers: deadcode baseline, undated counts, stale evidence, types freshness, migration drift
  - DB health (from Q53): statement-timeout rate, connection use %, slowest queries
  Built by scripts/scoreboard.mjs from gh run data + local generators +
  read-only SQL, refreshed by a scheduled workflow (commits via Q57) and at
  session start, with each row's "measured at" stamp covered by the
  staleness watch. A row that can't be measured shows UNKNOWN, never green.
- [ ] **Q60 LOAD TEST before launch.** The DB starved on 2026-09-22 with ZERO real
  users (Q53). Nobody knows how many concurrent users the current tier holds.
  Simulate realistic mixes (browse, post, apply, message, realtime, test-mode
  pay) with a test-account pool against prod at a quiet hour, stepping up
  until p95 or errors break. Record the ceiling and what gives first, and set
  alert thresholds below it. Owner decision after: tier, or optimisation.
- [ ] **Q61 Hourly canary on the core loop.** Full journeys run nightly, so a
  broken core loop can go 20+ hours unseen. An hourly lightweight synthetic
  run on prod (sign in -> browse -> open a job -> apply -> message ->
  test-mode checkout start, then clean up) that pages through the ledger on
  failure.
- [ ] **Q62 Expiry monitor.** Things that die silently on a date: the Apple APNs
  key and distribution certificate/profiles, the Stripe webhook secret, API
  tokens (Supabase access token, GitHub PAT, Resend, Sentry), the domain
  registration, SSL. Inventory each with its expiry, alert 30 days ahead,
  and add each to the scoreboard.
- [ ] **Q63 Quota and limit monitor, before any free-tier limit bites.**
  Supabase (DB size, egress, connections, edge invocations, realtime
  messages; supabase-usage.yml covers part of it), Vercel (deploys,
  bandwidth, function time), GitHub Actions minutes, Resend send volume,
  Sentry quota. Alert at 70% and 90%, and show each on the scoreboard.
- [ ] **Q64 User-reported problems become tracked items.** In-app "report a
  problem" / support messages / App Store reviews mentioning a bug create
  an alert-ledger item (source `user-report`), so they're fixed and
  verified like any alert.
- [ ] **Q65 Test-data hygiene on prod.** E2E/press/prod-audit write to prod by
  design. Measure how many is_seed jobs, users, messages, notifications and
  storage objects have built up; purge anything past a retention window on
  a schedule (dry run first); prove no real user ever sees seed data (the
  browse views already exclude it; verify every other surface).
- [ ] **Q66 Targets ("SLOs") on the scoreboard.** Define "working" as numbers:
  p95 page load (web + app), API error rate, uptime, payment success rate,
  notification delivery rate, time to a payout. Show each with its target on
  the Q59 scoreboard, red when missed.
- [ ] **Q67 An automatic morning page.** Generated daily: what shipped (commits
  grouped), what's red (scoreboard), new alerts, and the decisions waiting on
  the owner. The owner should never have to ask "what happened overnight".
- [ ] **Q68 Slow and patchy networks (rural Louisiana).** Run the core journeys
  (sign in, browse, post, apply, message, pay) on throttled 3G, and with
  the connection dropping mid-action. Every wait shows progress, retries are
  safe (no double post or pay), and nothing hangs silently. Add a CI budget
  (Playwright network throttling) so it can't regress.
- [ ] **Q69 Rollback drill.** Practise and time the three undo paths: a Vercel
  rollback to the previous deploy, reverting a migration (write the down
  migration, apply it in PGlite, and document the prod steps), and pulling or
  expediting an app build. Write the runbook, and re-drill quarterly.
- [ ] **Q70 Privacy requests end to end, monthly.** Account deletion and data
  export run against a test account on a schedule: every table the user
  touched is anonymised/deleted per policy, the export contains everything,
  and a job outliving its poster still renders (CLAUDE.md "a job can outlive
  its poster").
- [ ] **Q71 Accessibility on every route.** An automated axe scan across the full
  route inventory in CI (both themes, 375 + 1440), failing on
  serious/critical issues, plus a real VoiceOver pass on iOS each release,
  recorded with review:record.
- [ ] **Q72 Analytics that silently stop.** Key product events (signup, job
  posted, application, message sent, payment completed, review left) should
  never fall to zero for a day without an alert. Add volume monitors to the
  ledger, and verify the events fire in a journey test.
- [ ] **Q73 Email deliverability.** Verify SPF/DKIM/DMARC for the sending domain,
  seed-inbox placement (inbox vs spam), bounce and complaint rates from
  Resend, and why test mail dead-letters (Q29/Q2). Show them on the scoreboard.
- [ ] **Q74 App crash rate.** iOS/Android crash-free sessions from Sentry native
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
- [ ] **Q76 Admin audit trail is complete.** Every admin action (ban/suspend,
  strike reverse, refund, release payout, manual status override, remove
  job, delete user, credential approve/reject, dispute decision) writes an
  audit row (who, what, target, when, reason). Inventory the admin
  RPCs/edge functions from code, prove each logs one (live test on a seed
  target), and add a guard that fails when a new admin action has no audit write.
- [ ] **Q77 Finished agents' worktrees pile up.** Every worktree-isolated agent
  leaves a LOCKED worktree under .claude/worktrees/, and prune-git-hygiene
  never touches locked ones (by design, since running agents lock theirs). Add a
  safe rule: a worktree whose agent has finished (its branch is merged into
  origin/main or has no commits, no process has cwd there, and it's older
  than 2h) is unlocked and removed; anything unmerged is reported, never deleted.
- [x] **Q78 DONE 2026-09-23: morning reports 2026-09-21/22 committed as dated records; the gift-live Stripe checkout screenshot moved to ~/.lh-shots/gift-live/ (evidence, not repo content). Session-start hygiene (scripts/prune-git-hygiene.mjs via scripts/lib/staleUntracked.mjs) now reports untracked docs/ files older than 2 days (shown firing on a planted file). Guard: src/test/staleUntrackedDocs.test.ts. Was:** Untracked leftovers in the repo: docs/audit/gift-live/,
  docs/audit/morning/2026-09-21.md and 2026-09-22.md have sat untracked for
  days. Decide keep (commit as dated records) or scratch (delete), and add
  a staleness rule so untracked files older than N days in docs/ are flagged.
- [x] **Q79 SUPERSEDED by Q150 (2026-09-23): the owner chose triage; 27 of 63 remote branches already deleted with shas backed up; the rest is tracked in Q150. NO-GUARD: duplicate item, the work lives in Q150. Was:** Stale REMOTE branches. MEASURED 2026-09-23 06:10Z: 63 remote branches; 26 fully merged (safe to delete); 34 carry patches NOT on main by patch-id (git cherry)**, incl. sec-hardening (17 files, +4259), role-neutral-copy (60 files), feat/apple-iap (booby-trapped per memory: rebuild, never merge), wip/race2-terminal (+3439), fix-refund-double-pay (9 files), fix-jobs-completion-columns, 7 holes-* audit branches (single docs files), 9 wip/* agent branches, 5 dependabot. Full list: ~/.remote-unlanded.txt (regenerate: git cherry per branch). Each needs a verdict: landed differently (close), still needed (land), or abandoned (report to the owner before deleting). origin holds old branches (e.g.
  **ANSWERED 2026-09-23: triage** — delete the 26 fully merged now; an agent reviews the 34 unmerged, lists anything worth landing for the owner, deletes the rest (work item Q150).
  fix-iap-cashout-errorleak, rpc-error-map); hygiene cleans local only. List
  every remote branch with ahead/behind counts vs main. A branch fully merged
  can be deleted; one with unlanded commits is REPORTED to the owner (it may
  be lost work: memory orphan-branch-leak). Never delete unmerged.
- [x] **Q80 DONE 2026-09-23: MEMORY.md 145 -> 113 lines. 28 superseded handoff lines folded into memory/handoff-history-index.md; overlapping rules grouped into one line each (pings, visual proof, never-guess, throughput) with every file still linked; backup ~/.lh-backups/memory-20260923T*. NO-GUARD: memory lives outside the repo; no CI check can read it.** Memory index hygiene. MEMORY.md (loaded into EVERY session) has
  100+ entries, including many superseded HANDOFFs (July to mid-September) and
  overlapping feedback rules. Archive the superseded handoffs (keep the file,
  drop the index line, or fold them into one "history" pointer), merge duplicate
  rules, verify each remaining entry still matches the code, and keep the index
  short. Add a check that flags index entries whose file is missing or whose
  handoff is older than the newest handoff.
- [x] **Q81 DONE: .claude/AGENT-BRIEF.md + a CLAUDE.md rule that every spawn reads it.** GUARD: scripts/check-claude-md.mjs checks the CLAUDE.md line exists (a CLAUDE.md claim). NO-GUARD for brief CONTENT beyond that: it's prose; keeping it current is the lead's job each time a lapse is found. Was: One shared agent brief. Every agent spawned on 2026-09-23 needed the
  same rules pasted in: commit in the worktree and rebase/push to main
  --no-verify, never stash, parsecheck + targeted vitest (the lead serializes
  the gate), `npm run inventories:refresh` + check:generated + check:counts
  before pushing, `// @mutate` + an inventory floor on new guards, evidence
  under ~/.lh-shots (not the worktree), prove each check RED on the broken
  state, tick OPEN.md items with their guard and re-run queue-count. Lapses
  caused two broken @mutate lines and lost screenshots. Put it in one file
  (e.g. .claude/AGENT-BRIEF.md) that CLAUDE.md tells every spawn to read, and
  keep it current.
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
4. **FYI, found overnight, a launch blocker: push notifications reach nobody.**
   push_tokens has 0 rows and thousands of pushes were skipped for having no
   device. CLAUDE.md's "push-token bug is FIXED" was only true for the native
   half. The JS boot code dropped registration on every cold launch that
   redirected. Fixed in code (Q82). Getting a phone onto the fix is
   MORNING QUESTIONS 5.
- [x] **Q83 DONE 2026-09-23: zod runs jitless (src/lib/zodConfig.ts, imported first by every module that imports zod). MEASURED with a securitypolicyviolation listener on /, /login, /browse: prod 1 eval violation per page -> local production build 0 per page. Guard: src/test/zodIsJitless.test.ts (config().jitless true after the schemas load; every zod importer loads zodConfig first). Was:** Silence Zod's per-page `script-src eval` CSP report (2026-09-23).
  Zod v4 probes `new Function("")` once per page (its `allowsEval` check,
  used for the JIT object parser); the CSP blocks it, so every page logs one
  CSP violation (harmless, but noise in every console/CSP report — the Q13
  note). In zod 4.5.4 (node_modules/zod/v4/core/schemas.js) the probe is
  `jit && allowsEval.value`, so `z.config({ jitless: true })` at app start
  short-circuits it. Do: set it once in the entry file before any schema
  parses; prove it by counting CSP reports on one page before/after; add a
  guard that the config call stays (and that nothing re-enables JIT).
- [x] **Q84 DONE 2026-09-23: TODO.md retired to a one-line pointer; the file is archived at docs/archive/TODO-2026-08-31.md. GUARD: src/test/onlyOneOpenList.test.ts (the TODO.md allowlist entry is removed, so any unchecked box in TODO.md fails CI).** Each of its 44 open rows was checked against main/prod on 2026-09-23:
  - DONE, measured: F-MONEY-03 (admin_release_dispute rethrows on transfer failure, create-payment/index.ts ~1683-1701); F-SEC-06/07 (live: 0 public SECURITY DEFINER fns without search_path, 0 volatile public fns anon can EXECUTE); F-SEC-05 (partner_applications no longer exists, to_regclass null); F-TRUST-01 (the equivalence test is src/lib/messageScanner.test.ts); F-PERF-03 (Activity chunk 39 KB, was 220 KB); Coverage/e2e fixture (vitest.yml on main, nightly e2e-real-backend, two-account harness); Supabase GitHub secrets (present in `gh secret list`); PR #29 (MERGED); F-SEC-08 HIBP (= Q149); iOS build #17+ (superseded by Q152); skeleton screens (= Q169); `npm run sync:ios` (a process note, not work).
  - CARRIED as Q181–Q187 below.
- [ ] **Q181 Accessibility gate: WCAG 2.2 AA + best-practice axe run in CI (from TODO.md, 2026-08-31).** No workflow runs axe with the `wcag22aa` tag (grep on e2e/ and .github/ 2026-09-23: none). Overlaps Q71; do them together.
- [ ] **Q182 `open_jobs_browse` is still a SECURITY DEFINER view (F-SEC-04, from TODO.md).** Live 2026-09-23: reloptions `security_invoker=false`. Either document in the view's migration why definer is required (anon browse of an RLS'd table) and pin its column list with a test, or recreate it `security_invoker` with the policies it needs.
- [ ] **Q183 Trust tuning (from TODO.md F-TRUST-02/03, auto-restrict, fraud).** A spelled-number evasion heuristic for the off-platform scanner; the fixed 2-flag/24h auto-suspend → warn-first; check whether `cash` tokens over-fire; retune the 1/2/3 auto-restrict ladder after 2-3 weeks of real data; fraud signals beyond burst-job. Post-launch data needed for the tuning half.
- [ ] **Q184 Code health (from TODO.md).** `any` in non-test src/: 164 on 2026-09-23 (was 385), burn down money/auth paths first; keep extracting god components; move Profile/Dashboard/Messages to `useProfile()` (0 call sites today); raise test coverage; fix `~/.npm/_cacache` ownership on the dev box.
- [ ] **Q185 OWNER launch-store tasks (from TODO.md).** App Store metadata refresh (docs/APP_STORE_REVIEW_SUBMISSION.md) and the review submission when the owner says go; logo uploads to Stripe branding, the Google OAuth consent screen and Gmail sender avatar (docs/LOGO_UPDATE_RUNBOOK.md); revoke the old GitHub PAT `claude-cli-codeql-fixes-2026-05-11`; Stripe DNS records for branded receipts; notification copy decisions; real name vs first-name+initial display (`formatName()`); paste the 5 Sentry alert rules.
- [ ] **Q186 Native polish (from TODO.md).** Alternate app icon for small notification thumbnails (rasterise with scripts/generate-ios-icons.mjs, add to Xcode); Apple Sign-In native iOS rewire (re-check whether it shipped before starting); Leaflet → Apple MapKit spike (F-PERF-02; owner roadmap picked MapKit).
- [ ] **Q187 Post-launch product ideas (from TODO.md).** BusinessTeam seats/roles/invoicing; recurring job templates; notification cadence review of sweep-daily-job-digest. Ideas, not defects; feed them to Q19 (lh-suggester).
- [x] **Q85 DONE 2026-09-23: every superseded handoff memory (29 files) now opens with "SUPERSEDED: history only; open work lives ONLY in docs/OPEN.md"; the 2026-09-23 START-HERE handoff already points only to OPEN.md. NO-GUARD: memory lives outside the repo, so no CI check can read it; the rule is in CLAUDE.md ("docs/OPEN.md is the only open-work list") and the brief. Was:** Handoffs POINT to docs/OPEN.md (Q58d, split out 2026-09-23).
  Handoff memories under ~/.claude/projects/.../memory still carry their own
  open lists. Each should say "open work: docs/OPEN.md (Everything-open block
  at the top)" and nothing else open; the pause/handoff routine updates this
  file instead of writing a list into memory. Guard idea: a check over the
  memory dir (outside the repo, so a session-start hook warning rather than
  CI) that flags `- [ ]` or "open:" lists in handoff-*.md.
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
- [x] **Q88 money-reconciliation Stripe checks: review fixes (lh-money-escrow
  review of Q50, 2026-09-23).** (1) The under-refund ceiling skipped every job
  with any dispute_status, but a WITHDRAWN dispute leaves dispute_status
  'resolved' forever and the job then cancels normally: now only a disputes
  row status 'decided' + execution_status 'executed' exempts a job (read
  failure falls back to the old skip and marks the run degraded). (2) The one
  ledger warning is split: Stripe refunded LESS than payment_refunds =
  `stripe_refund_recorded_not_at_stripe` (critical, poster owed money); MORE
  = `stripe_refund_untracked` (warning); both carry direction and cents.
  (3) Run time measured (see Q86c); 20s budget on the Stripe phase, a stop is
  a truncated scan. (4) latest_charge must have captured the PI's
  amount_received, else `stripe_charge_not_the_payment` (warning, not graded).
  (5) block_user_and_settle priced the fee, late flag and strike on
  helper_id IS NOT NULL, not commitment (live pg_get_functiondef); fixed by
  migration 20260923075415 (PGlite 3x: uncommitted -> fee 0, no strike;
  committed -> 25%, strike). Prod had 0 rows of that shape (the block path
  has never cancelled a job) but 6 seed jobs were in the reachable state;
  cancellation_fee_mismatch (critical) would have flagged a stored fee.
  Guards: src/test/edge/money-reconciliation-stripe.test.ts (16 tests, 8
  @mutate killed) and src/test/cancelFeeSqlUsesCommitment.test.ts (class:
  every SQL caller of cancellation_fee_percent/is_late_cancellation; red on
  96ae77309 naming block_user_and_settle).
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

## CARRIED — still open from the sections archived 2026-09-23

Every unchecked box and every section marked OPEN / STILL OPEN / HEADS-UP /
NEEDS in the old file was re-checked on 2026-09-23 against main and live prod.
What was fixed or obsolete is closed in the archive's reconcile log with
evidence; what follows is still open ("not reached" means nobody could settle
it read-only; treat it as open).

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
- [ ] Detector sweep shipped (1e79f1ebc); dispute 9756a585/job e6979a12 still needs a manual admin release-payout — Detection sweep shipped and tested; one is_seed dispute (9756a585/job e6979a12) still needs a manual admin release-payout — owner action. (archive L631)

### CLOSED 2026-09-22 — functions-deploy called eight discarded edge-function deploys a success
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Upstream Supabase intermittently drops 5-12% of function-deploy uploads; retry masks but does not cure it — Deploy-verification/retry fixed (2400aca14/3470ad103); upstream Supabase still drops ~5-12% of function uploads intermittently — masked by retry, not cured (BR-025). (archive L714)
- [ ] Upstream Supabase deploy-upload drop rate (BR-025) — Same item as line 705 — upstream Supabase deploy uploads intermittently dropped, masked by retry. (see also line 705) (archive L750)

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

### OPEN — /my-posts' new row height is not yet measured in a browser (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] /my-posts placeholder row-height fix not yet confirmed with a real browser measurement — Code fix landed for /my-posts placeholder height but the predicted 150px/151px numbers have not been confirmed with an actual browser run. (archive L1546)

### PARTLY DONE — 44 signed URLs in prod are stored with an `exp`, and they all die in Sept 2027 (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] PhotoProof persisted-signed-URL bug fixed; 4 other call sites (DisputeDialog, DisputeTimelineDialog, CompletionChoiceSheet, SupportInline) still store long-TTL signed URLs — PhotoProof.tsx fixed (path-based storage, sign at display time); DisputeDialog.tsx, DisputeTimelineDialog.tsx, CompletionChoiceSheet.tsx and SupportInline.tsx still mint long-TTL persisted signed URLs (pinned in noPersistedSignedUrls.test.ts). (archive L1569)

### OPEN — `docs/audit/loading-states/measurements.json` is stale for /my-jobs (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] measurements.json/baseline.json not regenerated after the /my-jobs loading fix, so the check is green on outdated evidence — /my-jobs loading fix shipped but the committed measurements.json/baseline.json evidence is stale; needs the same full re-measure tracked at line 162. (see also line 162) (archive L1674)

### HEADS-UP — three duplicate reads on every Activity page load (2026-09-21)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] useActivityBadgeCounts mounted by both DesktopSidebarNav and MobileNav causes 3x/2x duplicate prod round trips — Reported only: duplicate badge-count/application-count/avatar reads fire from both nav components on every Activity load; not de-duplicated via React Query. No fix landed. (archive L1686)

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
- [ ] Three live AA failures found outside the lane's list (job dialog pitch, /messages banner, /my-posts badge) — Open, not reached: three specific AA contrast failures reported 2026-09-20, no fix commit found. (archive L2248)
- [ ] Four changed contrast sites never photographed in their own state — Open, not reached: 4 contrast fixes still unverified by screenshot. (archive L2254)

### DONE 2026-09-20 — Profile tab gutter + every Profile loading state
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Section: OPEN, found in this lane, NOT fixed — Section holds 4 distinct unresolved sub-items from the Profile tab-gutter lane. (archive L2295)
- [ ] TAB_TITLES.wrapped drifts from rendered h1 (Helpr Wrapped vs Your 2026 so far) — Open: Wrapped tab title still drifts from its rendered heading; needs a decision. (archive L2297)
- [ ] Profile LANDING sits at a different gutter than its own tabs — Open, owner decision needed: Profile landing gutter [40,40]/[36,36] vs tabs [24,24]/[20,20]. (archive L2304)
- [ ] /my-jobs applied-card pitch unverified against a populated list — Open, not reached: applied-card skeleton pitch still unverified against real data. (archive L2310)

### VN-33(b) bad-pin exception — follow-ups from its reviews
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Design notes for the owner re: near-miss job staying 'accepted' — Open (owner): design notes on near-miss/accepted-state behavior await an owner read, not code. (archive L2617)

### Owner decisions 2026-09-15 morning (pop-up) — building as branches
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Backend role strings: change all user-facing (edge + SQL trigger copy) — Partly fixed: edge-function copy is role-neutral; SQL trigger notification copy still says 'the poster'. (archive L2622)

### HANDOFF — visual-notes session paused on usage (2026-09-14 late)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Owner decisions VN-33 follow-up: nudge/escalate poster confirm, bad-pin fallback, new build later — Open: poster-confirm nudge/escalate and bad-pin Confirm fallback not found implemented. (archive L2638)
- [ ] VN-37 page gutter design decision; VN-52 group jobs fix+turn-on — Mixed: VN-37 gutter fixed; VN-52 group jobs still off (flag false), blockers (b)/(d) unresolved. (see also line 3070 (VN-37 section)) (archive L2643)
- [ ] "Test" workflow on main red on knip (pre-existing) — Open, not reached: knip failure status on the Test workflow unconfirmed. (archive L2644)

### Role words out of user-facing copy — branch role-neutral-copy-v2
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Needs lead's eyes at 375 for copy-length regressions in tight spots — Open, not reached: 375 visual check of lengthened role-neutral copy not confirmed done. (archive L2649)
- [ ] Trigger-written notification copy still says 'the poster' (needs a migration) — Still open: trigger-written cancellation notifications still say 'the poster', no role-neutral migration found. (archive L2650)
- [ ] Judgement calls to confirm or reverse (badge captions, tier badge, arrivalStateLabel wording) — Open (owner): wording judgement calls from the copy pass await owner confirmation. (archive L2652)

### Discarded PostgREST builder calls — branch discarded-query-filters
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] npm run typecheck:edge not verified in this container (no Deno) — Open, not reached: edge typecheck verification status unconfirmed. (archive L2867)

### HANDOFF 2026-09-15 — map notes + nightly reds (session closed)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Decide (3): the 9 auth-timeout presses; Browse header (unfinished session note) — Open, not reached: 3 pending decisions from 2026-09-15 auth-timeout presses list. (archive L2882)

### holes-2026-09-15 (authz-rls) — storage buckets
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] GAP: scope-video uploads have no client-side size/duration guard — Still open: no VIDEO_UPLOAD_MAX_BYTES-style guard found for scope-video uploads. (archive L2889)

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
- [ ] GAP: client DELETE on message-attachments needs SELECT visibility too; 5MB bucket cap below 10MB voice-note cap — Open, not reached: uploader-DELETE visibility gap and 5MB/10MB bucket-cap mismatch unconfirmed. (archive L3129)

### Alerting: few, critical-only, reaching the owner (2026-09-14)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] OWNER: enable Slack #ops-alerts notifications for all new messages, confirm correct account — Open (owner): cannot confirm #ops-alerts Slack notification settings from the repo. (archive L3134)
- [ ] OWNER: delete 3 stale Sentry alert rules — Open (owner): cannot confirm the 3 Sentry alert rules were deleted. (archive L3135)
- [ ] Known and accepted (lh-silent-failure F5): contact-support await chain can add ~20s under Supabase/Slack brownout — Open but accepted-as-is: contact-support latency under brownout is a deliberate tradeoff, no fix planned. (archive L3142)

### Money: concurrent release / Quick Release / Quick Refund (2026-09-13)
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] Storage policies let uploader UPDATE/DELETE dispute evidence after admin sees it — A party can still swap/delete dispute-evidence photos post-submission via storage policy; not fixed. (see also line 3183) (archive L3179)
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
- [ ] OWNER: delete stale user-documents/76b07824.../avatar.png (byte-identical duplicate of the owner's ID document) — Owner action still pending: the duplicate ID-document file at user-documents/76b07824.../avatar.png is still in storage as of this check (owner-only, needs dashboard delete). (archive L4940)

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
- [ ] 19 of 20 error_logs RouteErrorBoundary entries on /browse, /my-jobs, /my-posts still unexplained; /browse never churned — Partially investigated: a plausible mechanism (realtime churn + rapid UI churn) is now driven for /my-posts and /my-jobs, but /browse is still never churned and the field trigger remains unreproduced. (archive L5184)

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
- [ ] Real candidate: the Notifications panel renders an error boundary for the customer role on /dashboard and one /jobs/:id — Still open: nightly-red issue #1582 (press-every-control) remains open; no targeted fix for the customer-role Notifications-panel error boundary found. (archive L5345)
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
- [ ] Hide seed/demo jobs publicly (seed_jobs_hidden_publicly()) — Hide seed/demo jobs publicly (seed_jobs_hidden_publicly()) (archive L5631)

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
- [ ] Supabase storage audit: orphaned files in the 10 buckets (after the release proof; light prod reads — Supabase storage audit: orphaned files in the 10 buckets (after the release proof; light prod reads only) (archive L5761)
- [ ] Hallie avatar re-upload path: prove on prod (owner asked) — Hallie avatar re-upload path: prove on prod (owner asked) (archive L5764)
- [ ] Signed-in press-every-control full run on prod (owner: run just before final re-check) — Signed-in press-every-control full run on prod (owner: run just before final re-check) (see also 5734) (archive L5765)
- [ ] Supabase Pro: owner will decide later (not before launch prep) — Supabase Pro: owner will decide later (not before launch prep) (archive L5766)
- [ ] Group job screenshots: BUILT, apply+screenshot pending (prod has 0 group jobs, only local render pro — Group job screenshots: BUILT, apply+screenshot pending (prod has 0 group jobs, only local render proven) (archive L5773)
- [ ] QUEUED: land + prove completion-race (2608b2585) with before/after probe numbers, re-enable race-run — QUEUED: land + prove completion-race (2608b2585) with before/after probe numbers, re-enable race-runner.yml (archive L5774)
- [ ] STILL OPEN: screenshot the poster's group card on /my-posts at 375 light+dark, record with review:re — STILL OPEN: screenshot the poster's group card on /my-posts at 375 light+dark, record with review:record (see also 5764) (archive L5778)
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
- [ ] Empty /my-jobs desktop header shows bare magnifier, no title/tabs — owner to pick a/b/c — Owner decision still pending: empty My Jobs/Posts desktop header shows bare magnifier with no title or tabs. (see also line 6604 / line 7413) (archive L6387)

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
- [ ] Desktop Browse search drops focus to <body> on close (/my-posts is correct) — Not confirmed fixed — desktop Browse search focus-loss on close not mentioned again as resolved. (archive L7421)
- [ ] TabFallback uses one 230px placeholder for all 23 Profile tabs; needs per-tab reserved heights — Not reached / still open: TabFallback's single 230px placeholder still misfits tabs like home_history (3359px) and gift_card (1230px). (archive L7423)
- [ ] Two different components both named JobCardSkeleton render two unrelated skeletons in sequence on /dashboard — Not reached / still open per doc. (archive L7426)
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
- [ ] /my-jobs applied-card pitch unverified — both test accounts had zero live applications — Not reached — needs a live journey with a real applied-card to verify. (archive L7497)
- [ ] vacuityGate.test.ts races discardedQueryFilters.test.ts over a fixture in src/ — Not reached — test-flakiness claim not re-verified (vitest excluded from this pass). (archive L7498)

### OPEN — three visual findings from the 2026-09-23 verification pass
Reconciled 2026-09-23; detail in the archive at the line shown.
- [ ] WebKit only: bottom nav is not frosted (feed text shows sharp under icons) — Not reached — needs device/simulator check; may be a headless-WebKit rendering artifact, not confirmed as a real app bug. (archive L7587)

## CARRIED — the 2026-09-02 ledger (docs/audit/OPEN_ITEMS.md, retired 2026-09-23)

Re-checked 2026-09-23; the full compile is at docs/archive/OPEN_ITEMS-2026-09-02.md.
- [ ] **LIVE DEFECT #5**: Storage keys built from client-supplied file extension (complete-signup + Profile.tsx). Partially fixed: edge-fn 4 fields fixed; Profile.tsx id-upload still keys off client filename ext.
- [ ] **LIVE DEFECT #6**: 173 orphaned rows in prod, some carrying PII (notification_logs, login_history). OPEN, larger: live 2026-09-23 notification_logs has 1,935 rows whose user_id has no auth.users row, 1,888 still carrying recipient_email; ALL 1,888 emails match mailinator/seed/test/example (lead query) — test-account churn, not real users. login_history 482 orphans with ip_address; analytics_events 830. purge coverage for deleted TEST accounts is the gap.
- [x] **LIVE DEFECT #9**: str-ical-sync creates jobs invisible to every helper (payment_status defaults unpaid). Closed 2026-09-23 (lead): same defect as bus LTF-001, fixed in ef3550115 ("let the host publish them": UnfundedJobNotice + useFundExistingJob); a calendar job stays hidden only until the host funds it, by design.
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
- [ ] **OWNER-ONLY #9**: Purge three orphaned avatar storage objects. Not reached — no evidence of the one-off deletion having run.
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
| OA-001 | HIGH ⚑ | Signup still non-atomic: complete-signup failure strands account with no consent/approval and no recovery sweep |
| OBS-001 | HIGH ⚑ | 0 of 3 admins have a push token; admin safety alerts still fan into the void |
| CC-006 | HIGH ⚑ | Open: fileToBase64 in signup still hangs forever on an aborted FileReader (no onabort/timeout). |
| BR-005 | HIGH ⚑ | Not independently reverified — GoTrue email rate limit is a dashboard-only config value, no SQL/CLI read available this session. |
| NB-017 | HIGH ⚑ | Same listenersAttached/cancelled code pattern as filed; device repro not re-run (static check only). |
| OA-009 | HIGH ⚑ | Consent (legal_acceptances / terms_version_accepted) still lost if complete-signup fails; no reconciliation |
| BD-008 | HIGH ⚑ | Header job count still overstates vs list when a Nearby radius filter is active (documented known gap, unresolved). |
| ME-006 | HIGH | OPEN: tip fee still deducted from helper's payout; Terms '100% to Helpr' claim still false. Owner-approved gross-up fix unshipped. |
| DH-001 | HIGH | Poster's own share link still routes into apply flow with no owner branch (JobDetail.tsx). |
| NB-013 | HIGH | /reset-password + /account-pending still safely excluded from AASA; setSession() precondition still not implemented. |
| N-003 | HIGH | Quiet Hours still enforced in UTC vs a local-time UI; unaffected today only because 0 prefs rows have quiet_start set (re-check after N-001 backfill). |
| DR-004 | HIGH | Open / not fully reached: storage objects + edge-function secrets still outside the DB backup's scope; not re-measured live this pass. |
| EJ-001 | HIGH | Toast copy for signup rate-limit fixed; underlying email-rate-limit cap on signups not verified as raised. |
| AM-001 | HIGH | AM-001 open: past-deadline disputes with missing/unsucceeded PI still silently left with no admin reminder |
| OA-002 | HIGH | Create Account button still double-tappable during the phone-validation round-trip |
| TS-006 | HIGH | No report/block control on applicant/bid rows — still open, not reached in full depth |
| TS-007 | HIGH | SOS button still poster-only, no helper-side safety control or 911 path |
| S-002 | HIGH | Partially open: parish + email channels fixed, but push_tokens is still 0 rows in prod — push channel still dead. |
| OA-017 | HIGH | /account-pending still describes a review process that does not exist, with no working self-service exit |
| IB-002 | HIGH | Narrowed: title/description gated live (2b0528f9f); special_requirements still unscanned |
| NB-018 | HIGH | analytics_events shows 0 permission_denied/permission_skipped_guest rows ever; push ask still unexercised in prod. |
| PD-005 | HIGH | Sentry chunk still loads on every passive page load via useAuthReady's auth-ready breadcrumb, defeating the interaction gate. |
| PD-020 | HIGH | Not re-measured this pass - /my-posts's fine-grained chunk splitting cost is unverified post-PD-018/019 fixes. |
- [x] **Q87 DONE: reviewed (lh-money-escrow). No raw detail in any PublicError; the gift redeem P0001 path only carries 5 static sentences; nothing that should stay hidden became public. Fixed from the review: the EF-5 exemption now requires the REAL imported helper plus a LITERAL fallback (a same-named wrapper or publicErrorMessage(err, err.message) goes red), and the one non-admin message that showed Stripe's pi.status is now a fixed sentence.** GUARD: src/test/edge/error-leak-EF5.test.ts (abuse tests; red when the exemption is loosened) + src/test/edge/create-payment.test.ts. Was: REVIEW-ONLY pass owed on 96ae77309.
  76 `throw new Error` became `throw new PublicError`; the catch returns
  publicErrorMessage(err, fixed); the EF-5 detector exempts that call. Check that
  no PublicError can carry raw Stripe/PostgREST detail (gift redeem passes
  redeemErr.message only for P0001; some messages interpolate pi.status and
  job.status), that nothing that should stay hidden became public, and that the
  exemption can't be abused. lh-money-escrow or lh-appsec, REVIEW ONLY.
- [x] **Q90 DONE 2026-09-23: ledger c974c7b3 closed (ops_alert_close, re-run net req 623 08:29:37Z: HTTP 200, defects 0, real findings [], seed findings to error_logs f86718c0 `ops-alert-seed`, ledger untouched; before: reqs 592/609 HTTP 500, defects 3, paged).** GUARDS: src/test/includeSeedRunsNeverPage.test.ts (every edge fn reading include_seed that alerts must pass `seed:`; red on 46413558e) + src/test/edge/money-reconciliation.test.ts "seed findings (?include_seed=1)" (seed-only hit: 200/no page/no defect; a real hit on the same run still pages naming only the real job; red on 46413558e). Fix a7522133e. Per job:
  - 11 cancellation_fee_mismatch (+ the same 11 late flag / fee status),
    `[E2E DO NOT ACCEPT]` jobs 14746e64 9bac62d3 f1951694 fde2605b 8594e809
    4e39701c 0c8fcc0c 09d34912 a22c2df1 868f182b 9185bd75: REAL CODE BUG,
    already fixed. Each was cancelled 2026-09-13/15 by the poster through
    create-payment `cancel_escrow` (payment_refunds.source = cancel_escrow,
    full $25 refunded) on a HIRED, helper-confirmed job, which skipped the
    fee ladder. f0b29c522 (2026-09-15 04:11Z) made cancel_escrow an allowlist
    (open, no Helpr); guard create-payment.test.ts "cancel_escrow" hired
    cases; live 2026-09-23: hired job 5eed0a20-...04 answered 409
    useCancelJob, row xmin unchanged. The rows are left as a true record
    (fee 0 is what Stripe did); 0 non-seed jobs have this shape.
  - 5eed0a10-...13 fee mismatch: FIXTURE DRIFT (hand-inserted tracker
    fixture, docs/audit/launch-2026-09/inbox/seeded-tracker-fixtures.md, no
    writer in the repo). Corrected: cancelled_at moved to 63h before start,
    so fee 0 / late false are what the ladder gives. Gone from the re-run.
  - released_without_payout_transfer 5eed0a10-...10, 5eed0a20-...10 and
    payout_pending_stranded 5eed0a10-...11: FIXTURE DRIFT, same hand-inserted
    set, no PaymentIntent at all, so no app path could have produced them
    and nothing can settle them. Left in place: they sit on the owner's own
    account and carry the owner's tip rows; see Q92.
  - payout_pending_stranded 67e8ccfe ([SWEEP], PI pi_3UDE4C...) and e6979a12
    (EJLOOP, PI pi_3UCwOt..., auto-resolved dispute 9756a585): not a code
    bug. Both payout crons skip is_seed by design (process-scheduled-payouts
    :84, auto-release-payment :521), so no seed payout is ever swept. For a
    real job the same shapes pay: auto-release Phase 2 is on
    (autoPayoutEnabled true, 08:05Z run) and release-payout allows
    dispute_status resolved/auto_resolved. Settling them needs test balance
    (Q3); e6979a12 is Q10. See Q92.
  - The 6th check on the re-run, dispute_flag_without_row (warning)
    5eed0a10-...12 / 5eed0a20-...12: FIXTURE DRIFT (the "Disputed" tracker
    stage was inserted with has_active_dispute and no disputes row).
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
- [x] **Q91 Three more include_seed functions still page for seed subjects.**
  auto-release-payment, process-scheduled-payouts and
  subscription-reconciliation read `?include_seed=1` and post per-job alerts
  with no `seed:` flag, so a manual seed run of any of them pages
  #ops-alerts. Route each alert by its subject's is_seed (as
  money-reconciliation now does), then remove it from KNOWN_UNROUTED in
  src/test/includeSeedRunsNeverPage.test.ts (the list is exact and
  shrink-only). Money-moving code: REVIEW ONLY pass required.
  DONE 2026-09-23: each per-job alert carries `seed: <the job's own
  is_seed>` (a profile's for subscription-reconciliation); per-job defects on
  seed jobs go to `seedDefects`/`seed_findings` + one digest alert and never
  count; unknown => real. A subscription-level hit is never seed by
  association. subscription-reconciliation's dry-run note no longer posts
  "ran degraded". Guards: src/test/includeSeedRunsNeverPage.test.ts
  (KNOWN_UNROUTED now EMPTY) and src/test/edge/includeSeedAlertRouting.test.ts
  (16 tests, incl. seed-vs-real parity of results, writes and Stripe calls;
  5 red on the unfixed code, every @mutate red). lh-silent-failure REVIEW ONLY
  still owed on the diff.
- [ ] **Q93 Seed jobs still reach admins' in-app inbox from DECISION (lead, 2026-09-23, after the review of a7f660642): (b) a failed repair WRITE on a seed profile KEEPS counting as a defect. It is the mechanism failing (the same write path real profiles use), not a finding about fixture data, so muting it could hide a real write breakage. TODO: include the seed flag in that defect's text so it reads as seed-context, not unexplained. (a) is still open: stop in-app admin notifications for seed jobs in process-scheduled-payouts.
  process-scheduled-payouts.** Q91 routed the Slack pages and defects, but
  the `admin_alert` notifications (pi_not_succeeded, "Scheduled payout
  failed") insert for every admin regardless of `jobs.is_seed`, so an
  `?include_seed=1` run still fills /admin notifications with fixture noise.
  Decide: skip the insert for seed jobs, or tag it. Also: a failed profile
  REPAIR write on a seed profile in subscription-reconciliation still counts
  as a defect (500) — a broken write, deliberately left counted; confirm.
