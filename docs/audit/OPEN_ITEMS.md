# Open items — reconciled ledger (pre-audit baseline)

## STATUS STAMP — 2026-09-23, reconcile before the exhaustive all-systems audit (Q35)

**Read this first; this is the current state.** The launch-audit Wave 0 pre-flight
(step 6) stopped because this file was last stamped 2026-09-06 and ~930 commits
touching `src/` or `supabase/` had landed since. Everything below was re-checked
against `origin/main` and live prod (read-only SQL, `supabase secrets list`,
`curl`, `gh`) on 2026-09-23. A row is "fixed" only with a commit sha AND the
row's own condition now absent in current code/DB; rows that could not be
settled stay open and say why.

**What this file is now.** A short baseline, not a backlog:

- **The findings ledger is the audit bus** (`node scripts/audit-bus.mjs list`,
  `docs/audit/launch-2026-09/ROLLUP.md`). Reconciled the same day: 334 open ->
  **163 open** (142 fixed, 17 obsolete, 11 duplicate, 1 retracted; every status
  record carries its evidence in its note, `--by reconcile-2026-09-23`).
- **The only open-work list is `docs/OPEN.md`** (CLAUDE.md). This file does not
  compete with it: the still-open rows below are the 2026-09-02 ledger's
  leftovers, each with a one-line current status, so a lane does not re-derive
  them. New work goes to OPEN.md or the bus, never here.
- **The 2026-09-02 compile** (347 lines: every original row, its evidence, and
  the "already fixed, do not re-derive" list) is preserved verbatim at
  [`docs/archive/OPEN_ITEMS-2026-09-02.md`](../archive/OPEN_ITEMS-2026-09-02.md).

**Counts, measured 2026-09-23 (the 89 numbered rows of the 2026-09-02 compile, §1-§5 + Amendment):**
46 fixed · 1 obsolete · 42 still open (about 15 of them owner-only or needing a
device/browser session that a read-only reconcile cannot settle).

**Standing facts, re-verified 2026-09-23:**
- `supabase/.temp/project-ref` = `fncmgoasalhdgfwzhsqa` (prod). There is no staging.
- Stripe is in **test mode** until launch (CLAUDE.md, owner 2026-09-12).
- Prod has 0 real (non-seed) open jobs; the board is fixture data (OWNER-ONLY #8).
- `push_tokens` has 0 rows: push is dead for every user and every admin (bus
  NB-004, NB-018, OBS-001, S-002). The AppDelegate fix is in code; no device
  has registered.
- `RESEND_WEBHOOK_SECRET` IS set and suppression works (a batch verifier said
  otherwise; the lead re-checked, see OWNER-ONLY #1 below).

**Corrections made during the reconcile (batch-verifier claims the lead overturned):**
- IB-002: prod DOES scan job title/description (`trg_reject_contact_leak_in_job`,
  2b0528f9f); only `special_requirements` is unscanned. Stays open, narrowed.
- BD-005: RETRACTED. `louisiana_zip_parishes` grants writes to `authenticated`, but
  RLS allows writes only to admins (`Admins can manage zip parishes`); a grant
  with no matching policy is not writable.
- ST-006 is LTF-001's duplicate (fixed ef3550115). SI-008 obsolete (broadcasts are
  a live feature; PROTOCOL.md corrected in 4966de762). O-001/O-002 as filed by
  lh-observability are duplicates of OBS-001.
- LIVE DEFECT #6 orphan PII: the 1,888 orphaned `notification_logs` rows that still
  carry an email are ALL test/seed/mailinator addresses (test-account churn).

## Open audit-bus findings — HIGH or launch-blocker (24 of 163)

⚑ = launch blocker. Full list: `node scripts/audit-bus.mjs list`. Open by
severity: 24 HIGH · 88 MEDIUM · 50 LOW · 1 POLISH.

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

## Still open from the 2026-09-02 ledger

| Was | What | Current status (2026-09-23) | Tracked in |
|---|---|---|---|
| LIVE DEFECT #5 | Storage keys built from client-supplied file extension (complete-signup + Profile.tsx) | Partially fixed: edge-fn 4 fields fixed; Profile.tsx id-upload still keys off client filename ext. | — |
| LIVE DEFECT #6 | 173 orphaned rows in prod, some carrying PII (notification_logs, login_history) | OPEN, larger: live 2026-09-23 notification_logs has 1,935 rows whose user_id has no auth.users row, 1,888 still carrying recipient_email; ALL 1,888 emails match mailinator/seed/test/example (lead query) — test-account churn, not real users. login_history 482 orphans with ip_address; analytics_events 830. purge coverage for deleted TEST accounts is the gap. | — |
| LIVE DEFECT #9 | str-ical-sync creates jobs invisible to every helper (payment_status defaults unpaid) | Still open by design — deliberately deferred product decision, documented in code as unfixed. | — |
| LIVE DEFECT #25 | Senior mode .truncate amputates visible characters (193 occurrences) | Still open by design: per-component fix explicitly not done; global attempt was reverted. | — |
| LATENT #1 | Group jobs broken in 5 places (message, accept/complete, Activity, reviews, dispute split) | 3 of 5 sub-defects fixed pre-compile; (b)/(d) still open, control still gated off (GROUP_JOBS_ENABLED=false). | docs/OPEN.md VN-52 'Group jobs — inventory + turn-on plan', Phase 1 landed 2026-09-19, flag still false |
| LATENT #5 | charge-recurring-visits charges an arbitrary saved card (resolves customer by email) | Unchanged: still resolves the Stripe customer/card by email rather than the checkout-authorised method. | none found |
| LATENT #6 | charge-recurring-visits Stripe idempotency keys expire inside the funding window | Unchanged; mitigated by a unique index per the doc but the 24h key-expiry residual risk is still present and self-documented. | none found |
| LATENT #7 | No FK protects the ten no-FK tables (orphans possible outside app code) | Still open and WORSE: orphan analytics_events rows grew from 63 to 830 since the doc was compiled; no FK added. | docs/OPEN.md:4294 notes 'no-FK tables are handled in code by choice' |
| LATENT #8 | Three edge functions have no verify_jwt=false block in config.toml | Still open; config.toml's own comment (2026-09-10) confirms daily-match-digest/saved-helper-availability-push/str-ical-sync still lack the stanza, by acknowledged omission not a fix. | none found |
| LATENT #10 | OfflineBanner is lazy() — can fail to load on cold offline boot | Unchanged; still lazy-loaded with a null Suspense fallback, deliberate per the row's own note. | none found |
| LATENT #11 | Twelve bare <Navigate> redirects drop search/hash | Not fully re-verified; original doc itself already characterizes this as sanctioned/low-risk (no query currently reaches these routes) — treat as open pending a fresh check, not reached. | none found |
| LATENT #12 | Ten retired marketing routes 404 with no redirect stub | Unchanged: routes still intentionally 404 with no redirect; RW-002 reference not locatable in OPEN.md now. | filed as RW-002 by the launch fleet per the row's own text; RW-002 string not found via grep in current docs/OPEN.md |
| UNVERIFIED #1 | Entire native iOS surface never verified (WKWebView-specific bug class) | Not reached — requires TestFlight/simulator pass, outside this read-only reconcile's tooling. | none found |
| UNVERIFIED #2 | Universal-link association on a device (AASA CDN cache) | Not reached — device-only settlement, unchanged. | none found |
| UNVERIFIED #3 | Cold-start push tap (real APNs to a force-quit app) | Not reached — device-only settlement, unchanged. | none found |
| UNVERIFIED #4 | helpr:// custom-scheme branch has zero test coverage | Partially settled: unit test now exists (fixed that half); the SFSafariViewController device drive remains not reached. | none found |
| UNVERIFIED #5 | A group job end to end (post -> accept x3 -> work -> complete -> payout) | Still blocked upstream; not reached, consistent with LATENT #1's continued open (b)/(d). | docs/OPEN.md VN-52 |
| UNVERIFIED #6 | A recurring series end to end (create -> visit charges -> cancel) | Not reached — needs a Stripe test-mode fixture, unchanged. | none found |
| UNVERIFIED #7 | A dispute end to end on live accounts (file -> evidence -> escalate -> admin resolve) | Not reached — needs a browser session, unchanged. | docs/OPEN.md has extensive dispute-money guard work (money-escrow reviews) but no end-to-end UI drive recorded |
| UNVERIFIED #8 | cancelStripeSubscription on a real subscription (delete-own-account) | Not reached — owner/credential settlement, unchanged. | none found |
| UNVERIFIED #9 | No Stripe call was ever made in either mode by any lane (customer dedup, portal scoping, accounts.del balance refusal) | Not reached — still rests on recorded findings and Stripe docs, not a live call. | none found |
| UNVERIFIED #12 | Three write paths never driven: /availability weekly-hours SAVE, available-now toggle, /str-settings | Not reached — needs a browser session, unchanged. | none found |
| UNVERIFIED #13 | The /complete-profile avatar UPLOAD path never exercised with a fresh account | Not reached — needs a browser session, unchanged. | none found |
| UNVERIFIED #14 | Whether GoTrue's own rate limit backs the client-side login lockout | Not reached — owner/dashboard-only settlement, unchanged, verdict note: owner. | none found |
| OWNER-ONLY #2 | CAN-SPAM postal address empty in email footer | Code unchanged; still an empty literal awaiting owner value. | — |
| OWNER-ONLY #3 | Switch Stripe from test to live mode | Deliberately deferred to launch day per standing owner order; still open. | docs/OPEN.md launch checklist (stripe-sandbox-off.sh) |
| OWNER-ONLY #4 | Native iOS rebuild + TestFlight for push/AppDelegate fix | Owner action; not reached for a fresh build in this check. | — |
| OWNER-ONLY #5 | Archive stale Stripe products/prices + orphan seat secrets | Owner-only dashboard/API action; unverifiable from repo, stays open. | — |
| OWNER-ONLY #6 | Resolve the App Store ID (dead listing) | App Store listing still 404 / resultCount 0 as of this check; unchanged. | — |
| OWNER-ONLY #8 | Seed-job cold start — board is 100% fixture data | Still 0 real open jobs on the board; flip-the-switch decision remains unmade. | — |
| OWNER-ONLY #9 | Purge three orphaned avatar storage objects | Not reached — no evidence of the one-off deletion having run. | — |
| OWNER-ONLY #10 | Early Access delay past match alert (up to 20 min) | Still an open product decision; no code change found. | — |
| OWNER-ONLY #11 | Enable HaveIBeenPwned in Supabase Auth (F-SEC-08) | Owner dashboard action; unverifiable from repo, stays open. | TODO.md (F-SEC-08) |
| OWNER-ONLY #12 | Decide the Android question (dead FCM branch, no client) | Still no android/ directory or assetlinks.json; decision not made. | — |
| HYGIENE #3 | axe workflow (a11y-axe.yml) not a required branch-protection check | Branch protection still lists only 3 required checks; axe/a11y still not required. | — |
| HYGIENE #5 | handleIdUpload / idUploading / onIdUpload dead prop chain | Still present unchanged — dead chain not removed. | — |
| HYGIENE #6 | Inline translucent nav pill/curtain fills survive prefers-reduced-transparency | Not reached in enough depth to confirm change; treated as unresolved. | — |
| HYGIENE #8 | helpr-pass-wallet edge function unreferenced, 501s | Still unreferenced from the client and still on the known-dead list; unchanged. | scripts/check-dead-edge-functions.mjs (known-dead list) |
| HYGIENE #9 | submit-partner-application function absent; write path revoked | Still a dead end on both sides; no build-or-drop decision made. | — |
| HYGIENE #10 | .text-display-eyebrow is display:none while call sites and docs still emit/mandate it | Still display:none with active call sites; doc references reduced from 7 to 1 but not resolved. | — |
| HYGIENE #11 | platform_settings.feature_flags carries 4 unread keys | All 4 keys still present in the live row and still unread by any code path. | src/components/admin/adminHealth/useConfigChecks.ts (warns) |
| Amendment #O-003 | zz-runtime-probe AASA assertions failing (HTTPS+paths, apex no-redirect) | Still open: `curl -sI https://louisianahelpr.com/.well-known/apple-app-site-association` = HTTP 307 (2026-09-23). Bus O-003 open. Owner Vercel-dashboard step (memory: apex-universal-links). | — |

## Closed since 2026-09-02 — do not re-derive

| Was | What | Outcome | Evidence sha |
|---|---|---|---|
| LIVE DEFECT #1 | rate-limit.ts keyed on client-supplied header, in-memory Map | **fixed** — Fixed: durable DB-backed rate limiter replaced the spoofable in-memory one. | `3058fe6f9` |
| LIVE DEFECT #2 | money-reconciliation has never completed a run | **fixed** — Fixed: 17 recorded runs live, most recent yesterday, sha not located. | not located (current-state evidence) |
| LIVE DEFECT #3 | payment-confirm-reminder daily schedule misses half of eligible jobs | **fixed** — Fixed: cron now every 6h and has fired at least once in prod. | not located (current-state evidence) |
| LIVE DEFECT #4 | Portfolio photo removal never deletes the storage object | **fixed** — Fixed: portfolio removal now reconciles storage with a verified delete. | `e9a58f8cb` |
| LIVE DEFECT #7 | normalizeDeepLinkUrl drops url.hash, breaking reset-password/account-pending deep links | **fixed** — Fixed: url.hash is now preserved through deep-link routing. | not located (current-state evidence) |
| LIVE DEFECT #8 | Five AASA-claimed paths 404, two real routes unclaimed (/forgot-password, /rules) | **fixed** — Fixed: both previously-unclaimed routes now registered in App.tsx. | not located (current-state evidence) |
| LIVE DEFECT #10 | str-ical-sync drops today's checkout (UTC/local date compare bug) | **fixed** — Fixed: date window rewritten to whole-day UTC comparison; today's checkout no longer dropped. | `800d6b88e` |
| LIVE DEFECT #11 | Review nag links to a read-only screen with no write affordance | **fixed** — Fixed: nag now links to /my-posts or /my-jobs, the real review-writing surfaces. | `e15779346` |
| LIVE DEFECT #12 | helper_preferred_parishes has no writer; parish fan-out loops zero times | **fixed** — Fixed: dead table removed, fan-out now falls back to profiles.parish server-side. | not located (current-state evidence) |
| LIVE DEFECT #13 | 11 realtime channels never resubscribe after a socket drop | **fixed** — Fixed: shared realtimeRecovery.ts wired into all named channels and more. | `e15779346` |
| LIVE DEFECT #14 | admin-update-email rewrites a third party's email with no audit/notification to them | **fixed** — Fixed: denied account now gets its own audit row and in-app notification. | `800d6b88e` |
| LIVE DEFECT #15 | admin-user-actions: discarded notifications, no rate limit, non-idempotent ban | **fixed** — Fixed: rate limit added, notifications now checked via notifyUser, ban made idempotent per commit message. | `800d6b88e` |
| LIVE DEFECT #16 | process-email-queue can double-send; delete/dequeue errors dropped | **fixed** — Fixed: failed queue deletes now recorded as defects surfaced via cronResult. | `ede91b57e` |
| LIVE DEFECT #17 | set_available_now/clear_available_now report success unconditionally | **fixed** — Fixed and confirmed live: both RPCs now check row count and raise on 0 rows. | not located (current-state evidence) |
| LIVE DEFECT #18 | HelprWrapped: 6 defects (spend tile, Math.max rating, undisclosed $/hr, unreached reviewsGiven, format mismatch, double-share) | **fixed** — Fixed: all six named defects addressed in current HelprWrapped.tsx. | not located (current-state evidence) |
| LIVE DEFECT #19 | HomeHistory: wrong helper-resolution predicate, budget mislabeled, no export | **fixed** — Fixed: helper resolution now covers group jobs/direct-offers, and a PDF export exists. | not located (current-state evidence) |
| LIVE DEFECT #20 | ?job= deep link on posted tab doesn't highlight/scroll | **fixed** — Fixed: posted tab now supports the same highlight/scroll as the applied tab. | not located (current-state evidence) |
| LIVE DEFECT #21 | SeriesStrip quotes the visit date instead of the actual funding date | **fixed** — Fixed: funding date now correctly shifted by the real lead time. | not located (current-state evidence) |
| LIVE DEFECT #22 | axe heading-order: h1 then h3 with no h2 on two profile tabs | **fixed** — Fixed: both tabs now have a proper h1->h2 sequence. | not located (current-state evidence) |
| LIVE DEFECT #23 | axe nested-interactive on saved_helpers card (div role=button wrapping focusable children) | **fixed** — Fixed: card rebuilt on a stretched-link pattern, removing the nested-interactive violation. | not located (current-state evidence) |
| LIVE DEFECT #24 | axe color-contrast serious on /analytics (olivewood/0.62 text) | **fixed** — Fixed and verified by contrast math: opacity raised to pass AA (6.06:1 and 5.18:1 vs 4.08:1 before). | `ad315368f` |
| LIVE DEFECT #26 | Ops Slack alert for a filed dispute always 401s (browser JWT vs service-role gate) | **fixed** — Fixed: alert now fires server-side via pg_net from rpc_open_dispute, dead browser path deleted. | not located (current-state evidence) |
| LIVE DEFECT #27 | send-push-notification click_action inference is dead code (wrong path assumptions) | **fixed** — Fixed at the inference layer; iOS-side UNNotificationCategory registration remains a separate open gap per the fix commit itself. | `800d6b88e` |
| LIVE DEFECT #28 | /help has no primary CTA and FAQ anchors link nowhere | **fixed** — Fixed: FAQ anchors are real destinations and a glossy primary CTA now links to /support. | not located (current-state evidence) |
| LIVE DEFECT #29 | Password reset success is silent (no toast/confirmation before redirect) | **fixed** — Fixed: a rendered success state now precedes the redirect. | not located (current-state evidence) |
| LIVE DEFECT #30 | JobDetailDialog corner icons are 32x32, below the 44px HIG floor | **fixed** — Fixed: dialog corner icons now sized to the 44px HIG floor. | not located (current-state evidence) |
| LATENT #2 | process-scheduled-payouts counts a departed (NULL helper_id) helper as paid | **fixed** — Fixed: numerator and denominator now both exclude redacted (NULL helper_id) roster members. | `c538e3185` |
| LATENT #3 | saved-search funded trigger has a NULL payment_status hole | **fixed** — Fixed same commit as the payout-NULL bug; dedicated migration now guards the NULL payment_status case. | `c538e3185` |
| LATENT #4 | send-marketing-blast reads suppression/opt-out lists unbounded (1000-row PostgREST cap) | **fixed** — Fixed: unbounded PostgREST reads replaced with full pagination via _shared/paginate.ts. | `9f29a7aab` |
| LATENT #9 | GroupJobHelpers types helper_id as non-null while column is nullable | **fixed** — Fixed: type now matches the nullable column and the departed-member label was corrected. | `ede9db4cb` |
| UNVERIFIED #10 | No cron handler was ever driven over HTTP (bearer key mismatch, sb_secret_* vs legacy JWT) | **fixed** — Settled: live cron_run_log shows the handler running and succeeding daily; not blocked on a bearer mismatch in practice. | not located (current-state evidence) |
| UNVERIFIED #11 | money-reconciliation's root cause: not firing vs firing-and-never-answering | **fixed** — Settled by the row's own prescribed query: the job is active and has succeeded daily for at least the last 5 runs — it is firing and answering, contradicting the original 'never completed a run' claim (which is now stale). | not located (current-state evidence) |
| OWNER-ONLY #1 | Set RESEND_WEBHOOK_SECRET in prod | **fixed** — Fixed: RESEND_WEBHOOK_SECRET is set in prod (`supabase secrets list`, 2026-09-23) and suppressed_emails holds a live bounce row (2026-09-21) — the pipeline runs. (Batch verifier said unset; lead re-checked.) | not located (current-state evidence) |
| OWNER-ONLY #7 | Decide the two stuck disputes (open, execution_status NULL) | **fixed** — Both previously-stuck disputes are now decided/executed or withdrawn; row condition no longer holds. | not located (current-state evidence) |
| HYGIENE #1 | e2e-happy-path required check was red (5 failures) | **fixed** — Workflow is currently green on main across multiple consecutive runs; the prior red state is resolved. | not located (current-state evidence) |
| HYGIENE #2 | 645/946 e2e tests gated off by RUN_* env vars only e2e-happy-path sets | **fixed** — Sweep specs moved to a dedicated ui-sweep.yml that runs on every push/PR, not just on-demand. | not located (current-state evidence) |
| HYGIENE #4 | Dead avatarBroken/setAvatarBroken prop chain (6 files) | **fixed** — The dead prop chain is gone from all six named files; only comments referencing the old behavior remain. | `ede9db4cb` |
| HYGIENE #7 | compactClose prop is dead | **fixed** — The compactClose prop itself has been removed; only explanatory comments remain. | `a46d6bdc5` |
| HYGIENE #12 | TODO.md carries 2 stale entries (F-MONEY-01, F-DISC-01) whose code moved on | **fixed** — TODO.md already reflects the current code state for both entries; nothing stale left to fix. | not located (current-state evidence) |
| HYGIENE #13 | CLAUDE.md says AccountPending uses AppShell; code uses AuthShell | **fixed** — CLAUDE.md already states AuthShell; doc/code now agree. | not located (current-state evidence) |
| HYGIENE #14 | FULL-SURFACE doc asserts scripts/test-signin-link.mjs does not exist (it does) | **fixed** — The stale doc line has already been struck through and corrected. | not located (current-state evidence) |
| HYGIENE #15 | Login.tsx's ?redirect= is written and never spent | **fixed** — ?redirect= is now stored via rememberSignupRedirect and spent through postAuthDestination; no longer dead plumbing. | not located (current-state evidence) |
| HYGIENE #16 | /str-settings route comment vs code disagree (ProtectedRoute wrap, no guest bypass) | **obsolete** — The standalone /str-settings route this row describes no longer exists; it is now a Profile tab, so the described contradiction is moot. | not located (current-state evidence) |
| HYGIENE #17 | src/integrations/supabase/types.ts needs regenerating after nullable actor columns | **fixed** — types.ts is confirmed fresh against the live prod schema right now. | not located (current-state evidence) |
| Amendment #O-002 | /my-posts renders no job card for an authed customer (contests HYGIENE #1) | **fixed** — The workflow containing these 3 specs is currently green on main; the blocker no longer reproduces in CI. | not located (current-state evidence) |
| Amendment #O-004 | earnings tab renders one view at a time — spec fails on main | **fixed** — Workflow containing this spec is currently green on main. | not located (current-state evidence) |
| Amendment #RW-003 | /admin?view=map and ?view=parishtax not in VIEW_LABELS; stale header renders undefined title | **fixed** — isRealView guard now coerces unknown/deleted views (including parishtax) to home; fixed by 51002401e. | `51002401e` |
