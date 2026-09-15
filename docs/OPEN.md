# Open list

**This is the ONLY open-work list** (owner, 2026-09-12). Handoff memories, the
audit-bus ledger and agent reports are evidence, not backlogs: anything still
open from them gets a line here, with the check that guards it once one exists.

Written 2026-09-11. The point of this file is that the backlog stops living in
chat scrollback. Anything not in here is either done or forgotten, and both of
those are answerable by reading this instead of guessing.

Grouped by SURFACE, not by the order it was noticed — because most of these are
instances of a few shared problems, and fixing them surface-by-surface costs a
fraction of fixing them one report at a time.

---

## Failed list loads rendered "nothing here" + storage audit (2026-09-14)
- [x] CLOSED: bell panel said "Nothing new yet." for a poster with 313 unread during the outage. The error card was reachable only from a resolved `{ error }`: a rejected query, an errored session read (auth down → treated as signed out) and a pending/hung load (postgrest retries in flight) all fell through to the empty state. Fix: one `failLoad` path, a 15 s bound on every read, and a `listLoaded` store flag, so there is a loading row until the first successful load. Guard `src/components/NotificationPanel.failedLoad.test.tsx` was red 4/6, now green 6/6. Prod proof at 375 (poster-e2e, local preview, `rest/v1/notifications` aborted): "Loading notifications…" while retries ran, then the error card with Try again, no empty state, overflow 0 (review-logged).
- [x] CLOSED: My Posts / My Jobs error card required BOTH tabs empty, so a poster's posts hid a failed My Jobs read behind "No applications yet". The check now uses the active tab's count. Guard `src/pages/activity/ActivityEmptyState.loadError.test.tsx` was red 2/3, now green 3/3.
- [x] Messages list and Browse feed already routed failures to ErrorState. Pinned by `src/test/failedListLoadShowsError.test.tsx`; both tests go red when the view's `loadError` guard is inverted.
- [x] Storage audit, report only: `docs/audit/storage-audit-2026-09-14.md`. 10 buckets hold 95 objects, 20.3 MB. 32 orphans, 10.3 MB. `scripts/supabase-usage-check.mjs` now measures bucket bytes weekly through the Storage API (paced, 400-call cap) instead of reporting it unmeasured.
- [x] CLOSED (owner approved "Delete + fix the leaks"): 31 of the 32 orphans deleted on prod through the Storage API, each re-verified orphaned on two reads 10 min apart plus a per-object owner re-read. Log: `docs/audit/storage-orphans-deleted-2026-09-14.log`. Storage went from 95 objects / 21,330,730 bytes to 64 / 10,503,472 (−10,827,258 bytes). The 32nd, `proof-photos/76b07824…/e2e-proof-test.jpg` (784 B), sits under a LIVE user's folder, so its owner exists and it was kept. Post-cleanup dry run with the weekly rules: 0 orphans.
- [x] CLOSED: the leaks. `deleteMessage` removes its attachment first (`src/lib/storageCleanup.ts`); post-job checkout cleanup removes the job's photos first; `accountPurge` removes the media of jobs `purge_user_data()` deletes (`_shared/jobMedia.ts`, capped at 25 jobs, never blocks); the 14 users and the E2E jobs were removed by script teardowns, now fixed in `prod-seed.mjs`, `prod-lifecycle-sweeper.mjs`, `pressProdSafety.mjs` (`scripts/lib/jobMediaRest.mjs`). Guard `src/test/storageDeletionPaths.test.ts` derives every row-delete path from source: red on 028f2e308 (jobs 5 files, messages 2, users 1), green now.
- [x] CLOSED: weekly auto-delete, `scripts/storage-orphan-sweep.mjs` as a step of `supabase-usage.yml` (no new cron): two reads ≥10 min apart, 7-day age floor, identity docs need the owner gone from profiles AND auth.users, >50 files or >5% of a bucket deletes nothing and posts CRITICAL, redacted log artifact, Slack one-liner. Dispute and review photos are never swept for "user gone" (they are evidence on surviving rows). `src/test/storageOrphanSweep.test.ts`: each of two-read / age floor / caps shown red (2 failures each) with the rule removed.
- [x] CLOSED: `business-documents` bucket deleted via the Storage API (verified empty, no code reference, no storage policy left; its policies were dropped in 20260828011811).
- [x] OWNER DECIDED 2026-09-14: the per-bucket cap trips only when a bucket's orphans are BOTH more than 5 files AND more than 5% of the bucket (`checkCaps`, `DEFAULTS.maxBucketFiles = 5`, `scripts/lib/storageOrphans.mjs`). A tiny bucket with 1–5 orphans is cleaned; 6+ that are also over 5% still deletes nothing and alerts CRITICAL. `src/test/storageOrphanSweep.test.ts` new cases red (2 failures: 1 orphan of 4, 5 of 5) on the old rule, 32/32 green now.
- [x] OWNER DECIDED 2026-09-14: `accountPurge` keeps REFUSING the account deletion when identity-file removal fails, as it does now. No change.
- [x] CLOSED (fix): voice notes could neither be uploaded nor deleted. Verified live first: the INSERT/DELETE policies compared `foldername[2]` (the job id in `voice-notes/<jobId>/<senderId>/…`) to `auth.uid()`, prod returned 403 RLS for a voice-notes path, and behind that the bucket allowed no audio MIME at all (415 for `audio/webm;codecs=opus` and `audio/mp4`). Migration `20260914200051`: voice-notes branch on [3], upload also requires `can_message_in_job` on the path's job (so a job id equal to a uid, or a job you are not in, satisfies nothing), bucket allows the four exact MIME strings `useVoiceRecorder.ts` can produce. PGlite 3x: `scripts/probes/message-attachments-authz.probe.mjs` (red on the previous policies, green after).
- [x] CLOSED (fix): SECURITY, cross-user attachment read. Verified live: the `messages` INSERT policy did not constrain `attachment_url`, and on prod helper-e2e inserted a message in its own job naming a file poster-e2e uploaded to a job helper-e2e is not in, then signed and downloaded it (bytes equal). Same migration: the read rule now requires the object's path to be the granting message's own `<job_id>/<sender_id>/` (or voice-notes) folder, and messages INSERT confines `attachment_url` to that folder (all 13 prod attachment rows already match). Prod probe `scripts/probes/message-attachments-authz.prod.mjs` RED before (4 unmet: forged insert 201, B signed + downloaded A's file, both voice uploads 415), clean-up residue 0.
- [x] PROVED on prod 2026-09-14 20:07 UTC (owner asked): `prod-seed.mjs --avatar` re-uploads Hallie Helper's avatar. Original (427,253 B, sha256 5465c33f…) copied to a backup path and verified, original removed (authenticated read 400, public URL 400), `--avatar` printed "was MISSING, uploaded", object back 200 and `profiles.avatar_url` pointing at it. Bytes did NOT equal the backup, by design: the script uploads its generated 256x256 placeholder (957 B), not the old photo. The original bytes were then restored (equal to backup, public URL serves 427,253 B) and the backup deleted (400).
- [ ] VERIFY after db-deploy applies 20260914200051: run `node scripts/probes/message-attachments-authz.prod.mjs` and record GREEN here (it must exit 0).
- [ ] GAP (report only): a client's `DELETE` on a message-attachments object needs SELECT visibility too (storage-api returns the deleted rows), so a file uploaded whose message insert then failed cannot be removed by its uploader; the weekly orphan sweep is the net. Also the bucket's 5 MB `file_size_limit` is below the client's 10 MB voice-note cap (`VOICE_NOTE_MAX_BYTES`), so a >5 MB note fails with the storage error, not the client's message.

## Alerting: few, critical-only, reaching the owner (2026-09-14)
The "31 crons are not running" roll-up was the 09-13 10:03 → 09-14 17:40 UTC outage, not 31 broken crons: sweep-dead-crons ran 13 min after recovery, before any hourly/daily slot. Fixed in 20260914183932 (for jobs healthy going into a 45+ min blackout, tolerance restarts at resume; blackout sweep sees >24 h gaps; error_logs trigger posts only server-written `fatal` rows and 4 money/security sources, since the live CHECK forbids a 'critical' severity; one daily digest at 14:40 UTC, itself paged if undelivered for 30 h). Edge: money/security kinds floor to critical (`alertPolicy.ts`); 17 money call sites moved from `custom`+warning to `money_at_risk`; admin no-token fallback posts once per event (title+link) and unknown titles are critical. Guards: `scripts/probes/alerting.probe.mjs` (red on the old functions), `src/test/slackAlertWorkflows.test.ts`, `src/test/alertPolicy.test.ts`, `src/test/slackAlertsPolicy.test.ts`, `src/test/edge/slack-ops-alert.test.ts`, `src/test/edge/auto-resolve-disputes.test.ts` (seed split).
- [ ] OWNER: add GitHub repo secret `SLACK_WEBHOOK_URL` (same Incoming Webhook URL as the Supabase secret of that name, bound to #ops-alerts). Until then a failed deploy shows a `::warning` on the run and posts nothing.
- [ ] OWNER: in Slack, open #ops-alerts > channel name > Notifications > "All new messages" (on desktop AND the phone app), and make sure you are signed in as the account that is a member (@admin / admin@louisianahelpr.com), or invite your own account to the private channel.
- [ ] OWNER: Sentry (helpr-4m) > Alerts > project `javascript`: delete 3390582 "WARN — Stripe webhook signature mismatch", 3413443 "P1 — edge function 5xx burst", 3413453 "P0 — chat push notification trigger failed" (open each > ⋯ > Delete > confirm). The Sentry connector has no delete/update tool for alert rules.
- [x] DONE 2026-09-14 19:33 UTC (read-only on prod, two queries): the ratelimited loop is closed — last `%ratelimited%` row 2026-09-13 02:30:05 UTC, **0 in the last 24 h**, against 616 in the three days before; and not because the database was quiet, since 34 error_logs rows were written after the outage ended at 17:40 and none of them is one. `ops-daily-digest` is in `cron.job`, `40 14 * * *`, active. It has never fired yet (`cron.job_run_details` 0 runs): it was scheduled at 19:02 UTC, after today's 14:40 slot, so the first digest is 2026-09-15 14:40 UTC — `check_ops_digest_delivery()` pages if none is delivered within 30 h. STILL OPEN: someone has to look at #ops-alerts on 09-15 and see one digest and no per-cron messages.
- [x] CLOSED 2026-09-14 in 20260914192035. Re-read live first (cron.job LEFT JOIN cron_work_expectations): TWO of the three really had no row — `extend-boosts-hourly` ('0 * * * *') and `prune-cron-run-details` ('17 4 * * *'). The third was wrong: `prune-edge-rate-limit-log` has had a 30 h expectation since 2026-09-02, correct for its '56 4 * * *'. Rows added: 3 h hourly, 30 h daily, the same house tolerances as every comparable job. The deeper defect — `sweep_dead_crons` LEFT JOINs cron.job so it sees an expectation with no job and is blind to a job with no expectation — is closed too: a new `unmonitored` verdict reads `cron.job` itself, so a cron added by a future migration OR straight on the database (which is how extend-boosts-hourly exists: no `cron.schedule` for it appears anywhere in supabase/migrations) is reported once a day in the one roll-up. Guards, each shown red on the previous function/file: `scripts/probes/alert-followups.probe.mjs` (PGlite, 26 checks — prev sweep sees nothing, new one reports it, and a registered or disabled job stays quiet), `src/test/cronLivenessCoverage.test.ts` (inventory parsed from every `cron.schedule`/`cron.unschedule` in the migrations, independent of the expectation list).
- [x] CLOSED 2026-09-14 in `scripts/audit/seedDisputeFixture.mjs` + `prod-seed.mjs`. Correcting the record first: `prod-seed.mjs` does NOT create that row — its only dispute fixture goes through `rpc_open_dispute` and stays `open` (verified in the script and live: c7a12050 was decided 2026-09-07 06:44 UTC by hand and has outlived whatever made it). So the fix is ownership, not deletion: `--apply` now retires any dispute on an `is_seed` job left `decided` + `pending`/`executing`, and `--verify` fails while one exists. Retiring UN-DECIDES (status `withdrawn`, execution_status NULL, decision text kept with a `SEED fixture retired` prefix) and never writes `execution_status='executed'` — no transfer/refund id exists on these rows, so no money moved, and faking a settlement is something `money-reconciliation` would read as real. Guard: `src/test/seedDisputeFixture.test.ts` (red against origin/main's prod-seed.mjs), including the cases that must NOT be touched (non-seed job, any transfer/refund id, any cents, already executed). An lh-silent-failure review found three more, all fixed and each shown red: the predicate was NARROWER than the sweeper it silences (it required `status='decided'` and excluded `'failed'` — the state that actually occurs — so `--verify` could read clean while auto-resolve-disputes still counted the row; it now reads the sweeper's own `.in(...)` list and is checked against it); the PATCH matched on `id` alone, so a row `execute-dispute-split` claimed between the read and the write could be retired mid-Stripe-call (now a compare-and-swap carrying the whole predicate); and the response was discarded, so a zero-row write printed success (now asserts exactly one row).
- [ ] NOT YET RUN ON PROD: c7a12050 is still `decided`/`pending` on prod as of 2026-09-14 19:33 UTC. The next `node scripts/audit/prod-seed.mjs --apply` retires it (the sweep already skips it, so nothing is paging meanwhile). Deliberately not run from this lane: prod is a free-tier nano DB and another agent owns prod testing.
- [x] DONE 2026-09-14 in 20260914192035: a browser could forge a paging alert. Live `pg_policy` on error_logs had ONE insert policy, `anyone_can_insert_errors`, polroles NULL (PUBLIC), checking only `user_id`, so any holder of the publishable key could POST `tags.source='rls-escalation-refused'` (or a money source, or `severity='fatal'`) and page #ops-alerts. 20260914183932's defence read `request.jwt.claims ->> 'role'` — a request header, empty when no JWT is sent. The authority is the Postgres role the insert runs as: a new BEFORE INSERT trigger, deliberately SECURITY INVOKER, stamps `tags.origin` from `current_user` ('client' for anon/authenticated, 'server' otherwise, including every SECURITY DEFINER path), moves a paging source to `tags.claimed_source` and clamps a client `fatal` to `error`; `notify_slack_on_error_log` now gates on that stamp and no longer needs its by-name exception for `rls-escalation-refused` (its writer, `prevent_self_escalation()`, is SECURITY DEFINER). Client error logging is unchanged — the row is stored in full and still reaches the digest, it just cannot page. Policy rewritten naming `anon, authenticated, service_role` instead of PUBLIC. Guard: `scripts/probes/alert-followups.probe.mjs` shows the OLD trigger posting a forged security row and a browser `fatal` from role anon, and the new pair posting neither while service_role and SECURITY DEFINER paths still page. The probe runs with **RLS actually enabled** and a settable `auth.uid()` — an lh-authz-rls review caught that without those, every `SET ROLE` insert passes on the raw GRANT and the rewritten policy is never evaluated once; it now also asserts a logged-out browser can still log, a signed-in user can log against their own id, and cannot log against someone else's (42501). The stamp trigger is named `trg_error_logs_00_stamp_origin` so it sorts first among BEFORE INSERT triggers.
- [x] DONE 2026-09-14: support requests no longer wait a day. `contact-support` posted `kind:'custom'`/`severity:'info'`, which from 20260914183932 means "counted in tomorrow's 14:40 digest" — a person asking for help reached #ops-alerts up to 24 h later (the support email was always immediate; this is the channel the owner watches). New kind `support_request` in `ALWAYS_POST_KINDS` (posts now) and deliberately NOT in `CRITICAL_KINDS` (keeps ℹ️ wording and colour, so a page still means something is broken), deduped by `supportRequestKey()` over sender+subject+message so a double-tapped Send is one post. Guards: `src/test/supportRequestAlert.test.ts` (red against origin/main's contact-support) and 8 new cases in `src/test/slackAlertsPolicy.test.ts`, from an lh-silent-failure review that found two defects the first guard was blind to, both fixed and shown red: (a) the once-per-day token is claimed BEFORE the Slack POST, so a 429, a throw, a 5 s timeout or a missing transport burned it — and since `supportRequestKey` is content-derived, a sender who saw nothing and re-sent the same words hit the same key and never reached the channel that day, while the log line said it already had. The token is now RELEASED on every non-delivery (`tags.alert_key` → `undelivered_alert_key`, row kept for the digest). (b) `support_request` is reachable from an unauthenticated form and its key is content-derived, so changing one character is a new post: ~480/day/IP within contact-support's own rate limit, enough to bury the critical pages. Non-critical always-post kinds now have a 12/hour ceiling (fails OPEN on a read error; rows the cap itself writes do not count towards it; CRITICAL is never capped).
- [ ] Known and accepted (lh-silent-failure F5, low): `contact-support` awaits `postSlackOpsAlert`, which for `support_request` is now an insert + a dedupe read + a cap read + the Slack POST, each `AbortSignal.timeout(5000)`. A Supabase/Slack brown-out can add up to ~20 s to the user's "message sent" response. The await is deliberate (an un-awaited fetch is cut off when the isolate is torn down), and the email is already sent by then; revisit if it is ever seen in practice.

## Money: concurrent release / Quick Release / Quick Refund (2026-09-13)
- [x] CLOSED 2026-09-14 (re-measured on prod after deploy of 93237acdf, create-payment v1894): create-payment `release`, `admin_release_dispute`, `admin_refund_dispute` wrote the job flip matched on id only. Prod before (20 rounds each, Stripe test mode): release double-tap 20/20 (payout scheduled twice, duplicate "Job completed!"), release poster+helper crossed 16/20 (job left in_progress with both stamps), Quick Release 20/20 (loser 500 + 3 false "Transfer failed" admin alerts), Quick Refund 20/20 (both calls ran the full resolution, 2 audit rows, duplicate notices). Fix: conditional UPDATE + clean alreadyReleased/alreadyConfirmed/alreadyResolved. Guard: `scripts/check-race-class.mjs` now scans `supabase/functions` (edge inventory, 21 baselined). Probes: `scripts/probes/release-race.prod.mjs`, `admin-dispute-race.prod.mjs` (+ `mint-funded-seed-jobs.prod.mjs`).
  **After (prod, Stripe test mode, per-round is_seed fixture, Promise.allSettled): release double-tap 20/20 → 0/20** (every round one fresh release + one `alreadyReleased`; round 20's duplicate got a transient 500 "Not authenticated" and was re-run — the probe now re-runs any 5xx round instead of scoring it); **release crossed 16/20 → 0/20** (every round one `bothDone:false` + one completion, final completed/payout_pending, notices = control); **Quick Release 20/20 → 0/20** (rounds 1–11 before the 2026-09-13 outage, 12–20 on 2026-09-14: one resolution + one `alreadyResolved`, 1 audit row, 1 payout ledger row, 0 "Transfer failed", no 5xx); **Quick Refund 20/20 → 0/20** (same shape, 1 refund ledger row). All fixtures, notifications, audit/ledger/dispute rows deleted and read back 0 (plus the 2026-09-13 leftovers: round-11 job, 2 unfunded mints, and a stray `cancel_with_helper` strike on poster-e2e from a "[complete] race probe" job). Guard inventory covers all three writes: `src/test/raceClassGuard.test.ts` red on the pre-fix excerpts, green on live (16/16), `check-race-class.mjs` 0 new.
- OPEN: Quick Release vs Quick Refund on the same job at once can move money BOTH ways — each runs its Stripe step (different idempotency keys) before the guarded flip. Needs a claim (disputed → resolving) before any Stripe call. Not yet proven on prod.
- [x] CLOSED 2026-09-14: `src/pages/activity/activityActions/useLifecycleHandlers.ts` keyed the completion moment off `bothDone` alone, so a duplicate release (`alreadyReleased: true, bothDone: true`, or `alreadyConfirmed: true`) replayed the confetti + success-moment + tip prompt for a completion that already fired them on the original call. Fix: `if (data?.alreadyReleased || data?.alreadyConfirmed) { await refresh(); return; }` before the `bothDone` branch, field names confirmed against the `alreadyDone` early-return in `supabase/functions/create-payment/index.ts`. Checked the other handlers in the same file that celebrate or prompt (`resolveRevision`, `confirmArrival`, `confirmWorking`, `handleNoShow`) — none of them read an idempotent "already" response from the server, so none share this defect class. Guard: `src/pages/activity/activityActions/useLifecycleHandlers.duplicateRelease.test.tsx`, red against the pre-fix code (reproduces the exact `alreadyReleased` shape from the original bug report), green after; a control case proves a fresh (non-duplicate) completion still celebrates and still prompts.
- [x] CLOSED 2026-09-14: pre-push a11y-prod sweep red on `/my-jobs` (helper, phone-light): axe `aria-command-name` serious, 2 nodes `.tracking-helper-pin` (a clickable map pin with no accessible name). Root cause: Leaflet gives every marker `role="button"` by default (`keyboard: true`), but only copies the `alt` option onto the icon DOM node `if (icon.tagName === 'IMG')` — a `divIcon` marker is a `<div>`, so the existing `<Marker alt="...">` was a no-op that read like a fix and changed nothing (an unlabelled focusable button stayed in the tab order). Fix: `withAccessibleName()` in `src/components/TrackingMap.tsx` stamps `aria-label` directly onto the marker's DOM node via a wrapped `createIcon`, applied to both the helper pin ("Your Helpr's current location") and destination pin ("The job location"). No visual change. Guard: `src/test/mapMarkerAccessibleName.test.ts` derives its inventory of command-role marker constructs from source across every `*map*` file (`git ls-files src`) — Leaflet `divIcon(...)` calls and manual `setAttribute("role","button"|"link")` — and asserts each has an accessible name; canary tests reproduce the exact original bug shape and prove the checker flags it (also independently confirmed red against the pre-fix `TrackingMap.tsx` blob). `src/components/browseMap/mapMarkers.ts` (BrowseMap's pins/clusters) already did this correctly — checked, not touched.
- [x] AUDITED 2026-09-14 — the 21 edge `jobs` lifecycle writes baselined "not yet re-audited": **11 SAFE, 8 FIXED, 2 DEFERRED** (`docs/audit/lifecycle-writes-audit-2026-09-14.md`). Fixed: auto-release-payment (dispute/revision filed mid-run was overwritten to completed/payout_pending — now `.eq("status", job.status)`), auto-resolve-disputes (escalated or withdrawn dispute auto-paid — now status + dispute_status CAS), create-payment escrow stamp (gift-card funding written back to unpaid — payment_status CAS), `request_revision` / `resolve_revision` (double-tap + stamp on a disputed job — status CAS, `already*` replies), `cancel_escrow` claim + final flip (overwrote a dispute opened mid-refund — status + `cancelling` CAS), `charge.dispute.created` (overwrote a settled payout to chargeback — payment_status CAS + marker-only fallback). SAFE ones moved to a new `safe` list in the baseline with reasons; `check-race-class.mjs` still fails on any new unguarded write. Guard shown red on the pre-fix excerpts (`src/test/fixtures/raceClass/edgeLifecycleWrites.prefix.ts.txt`).
- OPEN: the 2026-09-14 lifecycle-writes fixes have NO prod race proof yet (prod owned by another agent). Seven probes listed at the end of `docs/audit/lifecycle-writes-audit-2026-09-14.md` (auto-release vs dispute, auto-resolve vs escalate/withdraw, gift vs card funding, revision double-taps, cancel_escrow vs dispute, chargeback vs settled payout).
- OPEN (deferred to `dispute-races` branch): `create-payment` `admin_refund_general` flip (`payment_status+status#2`) and `execute-dispute-split` jobPatch — audited, still grandfathered in `allow`. Also for that branch (lh-money-escrow review): `admin_release_dispute` / `admin_refund_dispute` gate on `status` alone — they should refuse `payment_status` in (`cancelling`, `cancelled`, `refunded`).
- OPEN (found in the same audit, not a race): `create-payment` `cancel_escrow` never checks `job.status` — any poster can refund an `in_progress` or `disputed` escrow job, bypassing `poster_cancel_job`'s ladder. No client caller. Needs a status gate (or removal).
- OPEN (LOW, same audit): `chargeDisputeClosed` warning_closed resets `chargeback → payout_pending` even when the chargeback hit an `escrow` job (work not done); no payout (the cron requires `completed`) but the job is stranded outside every sweep. Should restore the pre-chargeback payment_status.

## Stripe webhook endpoints — issue #1586 FIXED 2026-09-12, two items left for the OWNER
Root cause closed: `scripts/e2e/stripe-sandbox-on.sh` now deletes every pre-existing test-mode endpoint on the webhook url before creating exactly one, derives `enabled_events` from the `EVENT_HANDLERS` map (`scripts/stripe-webhook-events.mjs`), keeps the id under `$HOME/.lh-stripe-test-webhook-id` instead of `/tmp`, and re-reads the account afterwards to confirm one enabled endpoint before touching the Supabase secrets. Guard: `scripts/check-stripe-webhook-events.mjs` + `.github/workflows/stripe-webhook-guard.yml` (proven red on the two-endpoint incident state and on the old 8-event list; the workflow re-proves both fixtures red on every run).
- **OWNER ACTION — add the `STRIPE_TEST_SECRET_KEY` repo secret.** A Stripe **test-mode** restricted key with *read* access to Webhook Endpoints is all it needs. Until it exists the `live-secret-present` job in `stripe-webhook-guard.yml` is RED on purpose: that job is the only thing that can see a duplicate endpoint, and a missing key must never look like a pass. This is the one remaining hole in #1586 — the source-side half is guarded, the account-side half is not running yet.
- **CLOSED 2026-09-12 — `customer.subscription.created` unsubscribed.** Verified live against `acct_1RQbAfKp2H4b7tEC` test mode (`livemode:false`), endpoint `we_1U8AbhKp2H4b7tECpsHaYA7D`: it was 16 subscribed vs 15 keys in `EVENT_HANDLERS`, the extra event delivered and dropped as "Unhandled event type". Resolved by dropping the subscription, not by writing a handler: new subscriptions are already granted by `handleCheckoutSessionCompleted` when `session.mode === "subscription"` (sets tier and `subscription_expires_at`), so `customer.subscription.created` was redundant rather than a coverage gap. Endpoint now carries 15 events, matching the handler map exactly in both directions.


## Disk: git history carries 322M of dead media — REWRITE QUEUED (2026-09-13)
- OPEN: **rewrite history to drop 322M of history-only media blobs** (owner approved 2026-09-13, deferred by choice to a quiet window). `git rev-list --objects --all` shows 2,383 media blobs that exist in NO commit's tree at HEAD — worst offenders `src/assets/hero-illustration-v5.jpg` (13.4M across 6 revisions), `assets/splash.png` (6.0M), `hero-porch-garden-2000.webp` (5.1M), `hero-new-3.jpg` (4.1M), `hero-porch-garden.jpg` (4.0M), `public/pwa-192x192.png` (3.4M), `helpr-fb-cover.jpg` (3.1M). `src/assets/` at HEAD holds only `helpr-logo-256.webp` + `helpr-logo-96.webp`, and `git grep -E 'hero-(illustration|photo|porch|new)'` over src/public/index.html returns nothing — the art is already deleted and unreferenced, so only the pack still holds it. `size-pack` is 350.89 MiB today; expect ~100M after. **Also include in the rewrite (2026-09-14):** `docs/audit/storage-orphans-deleted-2026-09-14.log` was committed in ac1791ed9 with 93 full user/job/message UUIDs; the file is now redacted to 8 characters, but that commit's version still carries the full ids in history.
- **Why it is not done yet:** the rewrite changes every commit SHA and needs a force-push to shared `origin/main`. At the time of approval there were **31 worktrees, 22 of them live** (agents committing within the last 2h) and 5 running agent processes, plus **36 local-only branches** with no upstream. Rewriting then would have orphaned every live worktree and killed work in flight.
- **Preconditions before running it:** (1) `git worktree list` down to the main checkout, or every other worktree provably idle and its work pushed; (2) all 36 upstream-less local branches pushed or confirmed disposable — they must be included in the rewrite or they resurrect the blobs; (3) `git-filter-repo` installed (**not present today**); (4) every agent/terminal stopped. Then rewrite, force-push, and have each session re-clone rather than reuse a stale worktree.
- Not urgent: the machine sits at 24% disk use with ~76 GiB free, so this is repo hygiene, not a space emergency.

## 18 `wip/` branches on origin — triaged 2026-09-13, none deleted
Report only, nothing removed. Every one is **unmerged** (checked with `git merge-base --is-ancestor` against main), so none is safely disposable on its own; each also pins the dead media blobs, which is why this list blocks the history rewrite above.
- **Two are largely superseded by work that has since landed on main** — these are the realistic deletions, once someone confirms the remainder is unwanted:
  - `wip/gift-card-rename` (3 commits, 72 files): 49 of its 72 files are now byte-identical to main. The differing 23 are its *legacy alias* approach (edge forwarders, legacy wire keys) — which main explicitly rejected in `0a397aa8a` "Gift card rename, code half: **no aliases**". So the remainder is not a gap, it is a road not taken.
  - `wip/helpr-naming-fixes` (1 commit, 40 files): 28 of 40 now identical to main after `045f5301d` "Helpr naming: 43 copy strings + guard". The 12 differing files need a read before anyone calls them dead.
- **Two are the abandoned-worktree rescues from today's disk cleanup** — pushed so the worktrees could be removed, and carrying real unmerged work: `wip/messaging-lockout-2026-08-30` (24h messaging lockout + migration `20260831053124`, which is NOT in main) and `wip/job-confirmation-2026-08-30` (JobConfirmation / JobTracking / ConfirmedSection).
- **Seven are audit-harness scaffolds paused mid-build**, all 2026-09-12, 1 commit each, opaque agent-hash names: `wip/a3098e1a3d88bb205` (notification delivery audit), `wip/a41e5871ceaa5b039` (press-every-control harness), `wip/a52d1fb23f25cb495` (usability scorecard), `wip/a69d0af0b250db810` (slow-device spec), `wip/ab081703e8d015858` (first-time-user walk), `wip/abf395f466bcf1adf` (interruption journeys), `wip/ac0f5d2ac0f5004a5` (assistive keyboard spec). Several say "unverified" or "not yet green" in their own subject.
- **Three are "WIP from closed terminal, unverified"** dumps: `wip/combobox-terminal` (7 files), `wip/race2-terminal` (8 files), `wip/lexilombas-.lh-combobox-ws` (1 file).
- **Four are older single-purpose WIPs:** `wip/expiry-waiting` (9 files, expired listing stuck at Waiting, countdown says Undefined), `wip/unplus-tier-removal-20260829` (39 files, remove Plus tier), `wip/e2e-jobtab-schedule-fixes-20260829` (2 files), `wip/postjob-doubletap-driver` (1 file).
- Next step is a read, not a delete: for each, either land it, fold it into a live lane, or record here why it is abandoned — then delete it as part of the rewrite's precondition (2) above.

## Admin follow-ups (2026-09-13)
- OPEN: re-measure "AdminRoute: admin role indeterminate" in prod `error_logs` after this deploy (was 121 rows 2026-09-04..13, 83 seed-admin + 34 real admin, all from the report effect firing while the role lookup was loading). Any row after deploy is a real failed lookup; check it. Guard: `src/components/AdminRoute.test.tsx` (no report while loading). Tiers unknown-tier fallback (`AdminHelperTiers.test.tsx`) and the admin-views spec (`e2e/prod-audit/admin-views.spec.ts`, now fails on any error screen incl. "couldn't load" and the access gate) shipped, 27/27 green on prod at 375.


## Mocked Playwright specs → prod (owner: NO MOCK MODE, EVER) — IN PROGRESS 2026-09-13

Inventory taken from source, not declared: a file counts as mocked if it answers
the Supabase origin itself (`route()` on `supabase.co` / `/rest/v1` / `/auth/v1`
/ `/functions/v1` plus a `fulfill`, or the shared `installSupabaseMocks` /
`mockTable` / `mockRpc` helpers). The classifier is
`src/test/e2eNoSupabaseMocks.test.ts`, which is also the ratchet guard — it fails
on any NEW mock and fails if its BASELINE names a file that no longer mocks, so
the list can only shrink.

**Count at start: 36 files** — 30 `.spec.ts` + 6 helper modules.

Helpers (the mock machinery itself): `happy-path/fixtures.ts`,
`happy-path/seedData.ts`, `happy-path/seedDataHeavy.ts`,
`happy-path/state-matrix/stateMatrix.ts`, `happy-path/sweepCore.ts`,
`prod-audit/harness.ts`.

Specs (30): everything under `happy-path/` except `buttonGeometry.spec.ts` and
`popupFooterFit.spec.ts` (source-scan + layout measurement, no backend at all),
plus `visual-audit/desktop-fill.spec.ts`, `visual-audit/responsive.spec.ts`,
`payment-lifecycle.spec.ts`, `prod-audit/messy-input.spec.ts`,
`prod-audit/interruptions.spec.ts`.

**Approach.** A new `e2e/prod-ui/` project driving the DEPLOYED app with the two
shared accounts. `e2e/prod-ui/fixtures.ts` re-exports the fixture names the mocked
suite used (`customerPage`, `helperPage`, `checkA11y`) but backs them with
`getSession` from `e2e/journeys/fixtures.ts` (import only — another lane owns that
file) and the `is_seed` rows from `scripts/prod-seed.mjs`, so a spec body mostly
survives the move. Specs migrate in groups; the mocked copy is deleted only once
its prod copy is green, and each group updates the ratchet BASELINE and the
`e2eSpecsReachableInCi` registration in the same commit.

**States that cannot be seeded on prod are recorded as a stated GAP in the spec**
(`skipUncovered`, which annotates and prints a `::warning::`), never as a quiet
pass. GAPs are listed here as they are found.

**The pre-push visual sweep** (`happy-path/visual-audit-sweep.spec.ts`) is mocked
and is the one piece where a straight port makes every push slow. Proposal:
replace it with a prod CHANGED-SCREENS check — map the diff's changed files to the
routes they render (the existing `auditRoutes.ts` route table), capture only those
routes against prod, and fall back to the full sweep nightly. Whole-surface
coverage stays; it just moves off the push path.

---

## Cleanup candidates — dead code found 2026-09-13 (`npx knip`, call sites counted)

`npm run deadcode` (knip) reports **0 unused files and 0 unused dependencies** —
nothing whole is orphaned. What it finds is smaller: exports nothing imports,
and one reachable-looking code path that cannot execute.

- [ ] **`instant_book_claim` cannot fire — `useApplyFlow.ts:229-253` is dead.**
      `jobs.instant_book` was dropped by migration `20260904034410` (dead-feature
      cut) and `useApplyFlow.ts:67` stopped selecting it, so `isInstantBook` is
      always `false` and the RPC branch (plus its PGRST202 fallback) never runs.
      Five call sites still read or write the dropped column:
      `ApplyConfirmDialog.tsx:23`, `applyConfirmDialog/ApplyBody.tsx:90`,
      `JobCard.tsx:471` (renders an "Instant book" badge that can never show),
      `useApplyFlow.ts:244`, and `postjob/jobSubmitHelpers.ts:217`, which still
      sends `instant_book: true` on insert — a column prod no longer has.
      That last one is the reason this is not cosmetic.
- [x] **"12 scripts referenced by nothing" was a bad signal — only ONE was dead.**
      Reading them changed the answer: `scripts/mapkit-token.mjs` is how the
      live `VITE_APPLE_MAPKIT_TOKEN` gets regenerated, `check-silent-catch.mjs`
      documents in its own header why it exists outside ESLint,
      `scripts/asc/*` is in-flight App Store Connect work, `probes/*.probe.mjs`
      are run by hand with a PGlite dir, and `audit/a11y-focus-repro.mjs` and
      `complete-profile-icon-clip.mjs` were written the same day as this sweep.
      An operator tool is invoked by a person, so "nothing imports it" says
      nothing about whether it is dead. Only
      `scripts/e2e/cleanup-stray-testusers.sh` was genuinely spent (a one-shot
      for the 2026-08-24 id mixup); deleted. **Do not re-run this heuristic and
      act on it** — grep-for-references cannot see a human caller.
- [ ] **62 unused exports — almost all are OVER-exported, not dead.** Checked
      each against its own file: `QUEUE_LIMIT`, `MARKETING_MEDIA_BUCKET`,
      `assertUploadableMarketingMedia`, `LOCKOUT_BAN_STATUSES`,
      `earlyAccessWaitMinutes`, `displayHelpersCount`, `shortJobId`,
      `PASSWORD_SYMBOLS`, `helperCommissionCents`, `MetaApiError`,
      `buildCaption`, `toBase64`, `MAX_FEED_BYTES` … are all used by their own
      module — the only dead thing is the `export` keyword. Same for the 32
      "duplicate exports": a file exporting both `Foo` and `default Foo` when
      importers pick one. Dropping the surplus `export` is safe but cosmetic;
      deleting the symbol is NOT. `src/pages/jobs/jobsConstants.ts` was the one
      real find (5 of its 6 exports had no reader in any file, including its
      own) and is now cut to `ALL_CATEGORIES`. Re-run `npm run deadcode` before
      acting on any remaining entry, and check in-file usage first.
- [ ] **3 unlisted dependencies**: `playwright` imported by
      `scripts/audit/a11y-focus-repro.mjs` and
      `scripts/audit/complete-profile-icon-clip.mjs`,
      `@typescript-eslint/parser` by `src/test/buttonHeightLedger.test.ts`.
      They resolve today only because a transitive copy is installed.
- [ ] **`.claude-scratch/` is 129M and lints.** It is gitignored (290e73045) but
      still on disk and still inside the ESLint project, so
      `.claude-scratch/og/sandbox/api/share.ts` contributes the repo's only two
      standing `npm run lint` errors (`no-control-regex`, silent-catch). Either
      add it to `eslint.config` ignores or delete the directory.

---

## Keyboard — suggestion popups have tabbable options, no arrow-key model (2026-09-12)
- [x] `BrowseSearchBar.tsx`, `CityAutocomplete.tsx`, `AddressAutocomplete.tsx`: `<button role="option">` in a listbox with no ArrowUp/Down/aria-activedescendant on the input. Allowlisted as PENDING in `src/test/listboxOptionsNotTabbable.test.ts`; give the input a combobox keyboard model, set options `tabIndex={-1}`, remove from PENDING. (DOB wheel fixed.) DONE 2026-09-14: shared useComboboxKeyboard; proven keyboard-only on prod at 375 (Browse, City, Address/MapKit).

## CLOSED 2026-09-13 — contact smuggling in bios/job posts + hyphenated-domain emails (terminal 7)

Both SECURITY findings from 2026-09-12 shipped (owner said yes) in
`supabase/migrations/20260913020635_reject_contact_leaks_in_jobs_and_bios.sql`:
`contact_leak_reason` email domain widened to `[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}`
(matches `src/lib/messageScanner.ts`), and BEFORE INSERT/UPDATE triggers on
`jobs(title, description)` and `profiles(bio)` REJECT a leak (23514,
user-readable message; universal, no is_seed exemption, fire only when the
scanned column changes). Client pre-scans the same fields
(`src/lib/contactLeakField.ts`; post-job title/description, Edit Profile,
Complete Profile, Signup step 2) and shows a server rejection verbatim.
Checks: `e2e/journeys/abuse/contact-smuggling.spec.ts` now expects 400 (was
proving the gap), `src/lib/contactFilterParity.test.ts` locks the widened
domain on both layers, `scripts/probes/contact-leak-reject.probe.mjs` proves
old-miss/new-catch, reject/pass and 3x replay in PGlite.

- **Left alone on purpose:** ~60 pre-existing rows (all seed/E2E) already
  contain flagged text; the trigger only fires when title/description/bio
  changes, so they are untouched and an unrelated update on them still works.
  Rewrite or delete them with the next seed refresh if they should go.
- **Still open (documented limitation):** `"jane (at) gmail (dot) com"` worded
  obfuscation evades client and server alike.
- **Marker convention:** every E2E/seed run id inside a title/description is
  now letter-prefixed base36 (`r${Date.now().toString(36)}`); a bare
  10+-digit marker reads as a phone number and the trigger rejects the row.

## Terminal 7 suites shipped (2026-09-12)

- `e2e/journeys/abuse/` — IDOR & authz matrix (cross-account read/write refusal,
  self-review, review-without-completed-job, self-application, poster money-column
  lock) + contact smuggling. API-level, RLS-pinned to the live policies.
- `e2e/journeys/notifications/` — `create-notification` authz/link/type
  sanitisation, preference OFF round-trip, real in-app link opens its screen with
  no error page, trigger→in-app row→email_send_log on a funded thread.
- Inventory: `docs/audit/notification-inventory.md`.
- Nightly + dispatch: `.github/workflows/e2e-abuse-notifications.yml` (shared-
  accounts concurrency group; pre/post sweeper).
- [x] Revoked cached sessions no longer pass as signed in (2026-09-12): one shared
  check `e2e/liveSession.ts` (GET /auth/v1/user, dead/corrupt cache deleted and
  re-minted) used by journeys `getSession` (so prod-audit + a11y-prod) and
  `scripts/audit/pressProdSafety.mjs`; harness's private copy removed. Guard
  `src/test/liveSessionCache.test.ts` (red 2/4 on clock-only cache, green 4/4).
  Noted, not touched: `e2e/prodSessions.ts` has zero importers (dead, clock-only TTL).

---

## Decided 2026-09-11, now queued to build

- **Live location: background tracking, REQUIRED while en route.** Today it is
  `setInterval(pushPosition, 45_000)` in the WebView (JobTracking.tsx:692),
  running only while the job is `on_the_way`. There is no `watchPosition` and no
  background-location capability, so **iOS suspends it the moment the helper
  locks their phone or opens Maps** — i.e. exactly while they are driving, which
  is the only time it matters. Owner chose real background location from "On My
  Way" until arrival. Carries `UIBackgroundModes: location`, an Apple review
  justification, a privacy-label change, and battery cost.
- **Earnings splits into two tabs.** Earnings = what you made (summary, history,
  forecast, export, streak). Payouts = how you get paid (setup — currently
  NESTED inside the earnings tab — methods, wallet/cash-out, threshold, payout
  history, transfers, Instant Cash Out). Lane `earnings-split`.

## Job card (BOTH sides) — IN PROGRESS, lane `step-components`
Owner decided 2026-09-11: helper and poster cards share ONE shell, filling the
same slots (tracker / primary action / secondary row / the ask / escape link)
with different content per side and per step.

- **Poster name has two treatments** (REPEAT report — raised before, not fixed).
  `AppliedJobCard.tsx` ~169 collapsed: quiet inline avatar + name. ~293
  expanded: the same fact as a grey `bg-muted/40` band with an added "Posted
  by" label. Expanding a card should reveal more, never redraw what was
  already there. `bg-muted/40` around an identity or meta row is suspect
  generally here — the owner previously flagged the same band behind the
  location chip.
- Helper-name placement and the name in the tracking panel, poster side —
  check whether these are the same one-fact-two-treatments shape.

- One component per step; six states currently have six different layouts.
- `DisputedSection` still renders the OLD hand-rolled Photo Proof card that
  `adb4773dd` replaced elsewhere. Two designs ship side by side today.
- "Add a before photo" panel still shows in the Request-My-Payout state.
- Action row is 1-up / 2-up / 3-up with no rule; "Report a Problem" is a link
  under the row while "Can't Finish" is a chip inside it.

## Performance — audit done, NO fixes applied yet
Measured against prod, warm median:
- Postgres read ~101–118ms · edge fn without a third party ~128ms ·
  **edge fn → Stripe 395–893ms**. The third-party hop is the whole problem;
  the Deno runtime is not.
- `check-pro-subscription` (893ms) lands 570ms after everything else on
  /dashboard. `stripe-connect status` (395ms) is the "Connect to start earning"
  delay on /profile.
- **Neither is prefetched anywhere**, and 24 call sites set `gcTime: 5min`,
  which is below the threshold for React Query persistence to survive a
  rehydrate — so persistence covers the fast queries and excludes every slow
  one.
- Duplicate queries: `get_my_pending_direct_offers` ×2 per route,
  `applications?status=eq.pending` ×2, `profiles?select=ban_status` ×3 — raw
  `supabase.rpc` calls outside React Query, so no dedupe.
- CLS is 0.0000 on all five routes measured. This reads as slow, not broken —
  do not spend budget on skeletons.

## Messages screen
- **A selected thread should be the FULL page**, with back to return to the
  list. Today the list and the thread sit side by side and the thread is cut
  off. (owner, 2026-09-11)
- **Search: replace the "Cancel" text button with an × icon** —
  `ConversationList.tsx:790` (`ScreenHeaderRow`). "Cancel" is being cut off.

## Profile
- **Avatar has a square/rectangle behind the circle** — remove it. Seen on the
  profile header's 88px avatar (`AvatarFallback`), which is `rounded-full`, so
  the square is coming from something behind or around it, not the fallback
  itself.
- ~~Verified group should sort before As-a-Helpr / As-a-poster~~ — DONE,
  `RecognitionRow.tsx` GROUP_ORDER, not yet visually confirmed.

## Notification counts — REOPENED, my error
The owner reported the badge and the real numbers disagree, and noted I had
called this fixed. **They are right and I fixed the wrong thing.** Commit
`a93e5830b` only made the date-divider count LOOK like the panel's other quiet
text — a styling change. It never touched whether the numbers AGREE. Observed:
bell badge **10**, panel "Unread **11**". Two different sources of one count.
Find both and make one authoritative.

## Race conditions — proven on prod 2026-09-13 (terminal 3, seed accounts, all fixture rows deleted)
- **Same-frame double-click on Apply Now — FIXED (client), 2026-09-12.** Two clicks in one JS task sent 2 `apply_to_job` RPCs (server refused the 2nd; 1 row). Ref guard in `useApplyFlow`; prod-audit "SAME frame" case now dispatches a true same-task double and requires exactly 1 write: RED 2 writes on deployed prod, GREEN 1 on the guarded build. Same guard added to ResponseDeadlineDialog (hire), CompletionPrompts (review + tip), ReviewForm. **FIXED 2026-09-12:** `completeJob` (release) and `handleHelperResponse` (accept offer) now take refs owned by `useActivityActions`; same ref added to ReportDialog and the ManualVerify / FormalWarning / ResetPassword / RestrictApplications admin dialogs (vitest RED 2 calls / GREEN 1). Server verdict (prod, read-only): accept is REFUSED server-side (conditional UPDATE on `helper_confirmed_at IS NULL` re-checked under row lock → 0 rows), but the client then rolled back the first tap and toasted "no longer available"; release is NOT refused — deployed `create-payment` release reads the job then does an unconditional UPDATE, so a concurrent duplicate re-stamps `*_completed_at`/`payout_scheduled_at` and inserts duplicate notifications (no double transfer: one row, payout cron is idempotency-keyed). **CLOSED 2026-09-14:** release UPDATE conditional (93237acdf, re-measured 0/20, see Money section at top). **OPEN:** RichMessageInput send (sync `onSend` + stale `text` closure, not the same trivial shape).
- **Same-frame double release on the dispute paths — FIXED (client), 2026-09-12.** lh-money-escrow review of the completeJob/accept guards found two release entry points that bypass `completeJob`: poster Resolve & Pay (`PostedJobActions.resolveDisputeAndRelease`, `rpc_withdraw_dispute` + create-payment release) and admin Quick Release/Refund (`AdminDisputes.resolveDispute`, whose `resolving` state was set only after the biometric await). Both now hold a sync ref; `src/components/disputeReleaseInFlight.test.tsx` RED 2 requests with the guard stripped, GREEN 1. Server verdict re-verified live 2026-09-12 (downloaded deployed create-payment = repo; `trg_confirm_on_live_job` present): release still NOT refused server-side on a concurrent duplicate. **CLOSED 2026-09-14:** server-side release idempotency and admin_release_dispute/admin_refund_dispute idempotency (93237acdf, 0/20 each on prod, Money section at top). **OPEN:** one shared boolean per handler means a tap on job B while job A's release is in flight is silently swallowed (no money risk, no feedback) — per-id Set if it matters.
- **PROVEN 14/20 — apply vs cancel.** `enforce_application_job_state()` read the
  job without a lock; the INSERT then waited on the FK behind
  `poster_cancel_job()`'s `FOR UPDATE` and committed a `pending` application on
  the `cancelled` job (job xmin < application xmin in every bad round), with a
  "New application" notification to the poster who had just cancelled. Fix in
  migration `20260913014328` (`SELECT … FOR SHARE`). **Re-measured after
  db-deploy 34732902550 (d0471d07f): 0/20** — every round was apply-first or
  `job_not_open`. CLOSED.
- **PROVEN 5/20 — helper confirm vs cancel (money).** The plain-offer confirm at
  `useOfferHandlers.ts` is a client `UPDATE jobs SET helper_confirmed_at` with
  no status predicate; queued behind the cancel it stamped a CANCELLED job.
  `poster_cancel_job` had recorded `$0 / no strike / "no fee applies"`, but
  `void-cancelled-payments` recomputes committed from `helper_confirmed_at` and
  would have captured 25% ($25 of $100) from the poster. Fix in the same
  migration (`trg_confirm_on_live_job`, 42501 unless OLD.status ∈ open|accepted)
  plus `.eq("status","accepted")` on the client. PGlite: 16/16 after, 8 red
  before. **Re-measured after deploy: 0/20** — every cancelled row is either
  confirmed-then-cancelled (fee == cron fee, one strike) or unconfirmed with
  $0; a clean confirm on an accepted job still succeeds (1/1). CLOSED.
- **NOT REPRODUCED 0/20 — direct-offer accept vs cancel.** `respond_to_direct_offer`
  and `poster_cancel_job` both lock with `FOR UPDATE`; every round was either
  accept→cancel (fee $25 == cron $25, one strike) or cancel→`job_not_open`.
- **Unreachable — "apply at the old price".** `enforce_poster_jobs_money_lock`
  refuses `budget` once `payment_status <> 'unpaid'`, unfunded jobs are on no
  browse surface, and `applications` has no price column. No test written.
- **Class check BUILT 2026-09-12.** Static: `scripts/check-race-class.mjs`
  (+ `src/test/raceClassGuard.test.ts`) flags any plpgsql function reading
  `jobs` without `FOR SHARE`/`FOR UPDATE` before a decision + dependent write,
  and any client `.from("jobs").update()` of a lifecycle column (or an opaque
  payload) with no `.eq/.in("status")`. Red on the pre-fix function and client
  file, green on the fix. 36 grandfathered hits in
  `scripts/race-class-baseline.json` (only shrinks) — the ones marked
  "candidate" (settle_dispute_record, DisputeDialog, JobTracking
  helper_completed_at) are the next to lock/predicate.
- **Two-connection race runner BUILT** (`.github/workflows/race-runner.yml`,
  `scripts/ci/race-runner.mjs`): throwaway Supabase Postgres, same replay as
  db-smoke (`scripts/ci/replay-migrations.sh`), both races 20 rounds with a
  forced lock wait, a control write, and wrong-reason refusals counted as
  failures. Pre-fix (20260913014328 excluded): 20/20 BAD on both races.
  Nightly + on migration push; red files a `nightly-red` issue.

## Bugs found but not fixed
- [x] 2026-09-12 FIXED: stale-chunk reload stuck on "Something went sideways" when the one `?_v=` reload landed on the old build. `src/lib/chunkReload.ts` now allows a 2nd attempt after 30s, hard cap 2 (sessionStorage count + timestamp, `_v` fallback without storage), offline still never reloads; `src/lib/chunkReload.test.ts` (behavioural red on old code with exports stubbed: 5 of 7 fail, incl. (a) 1 reload not 2 and (b) old code reloaded 25x over 50 failures; offline tests pass on both). OPEN follow-ups from lh-silent-failure review: (1) while the backoff retry is pending, boundaries/`main.tsx` show and REPORT the card as a real failure, then the page reloads unannounced ~30s later: needs a "retrying" return/state; (2) pending retry timer is not cancelled if the user navigates to a working route; (3) `e2e/happy-path/stale-deploy.spec.ts` (mocked) asserts one reload within a short wait: rewrite for the 2-attempt model on prod per no-mock order; (4) `recoverFromChunkError` returns true and spends an attempt before `hardReloadBypassCache` actually reloads, which can bail offline or hang on SW/cache purge, leaving the "recovering" state stuck with nothing reported: needs a did-reload return, a purge timeout and a boundary watchdog; (5) `markChunkLoadSucceeded` only clears keys older than the 5-min episode that `readState` already ignores, so the reset is cleanup only, and only `lazyWithPreload` calls it.
- **CLOSED 2026-09-13, mock-only: sweep 143 admin-tiers "This page hit a problem".**
  The sweep fixture `get_helper_tiers` returned lowercase tiers (`elite/pro/rising`)
  that `AdminHelperTiers` has no icon for; prod returns `Verified`/`New` and renders
  (admin-e2e, 375; no HelperTiers row in `error_logs`). Fixture fixed; new prod check
  `e2e/prod-audit/admin-views.spec.ts` (every `/admin?view=*`, 26 green, shown red by
  feeding the prod bundle a lowercase tier). OPEN: the component still crashes on any
  unknown tier string (report, not fixed); `/admin?view=support` shows "We couldn't
  load the support queue" under that spec (probably its read uses a non-`get_` RPC
  the spec's write firewall refuses; unverified).
- **Every job card renders TWICE on /dashboard** (seen in the perf lane's
  screenshot). Unconfirmed cause.
- **No retry for a failed arrival.** `mark_helper_arrival` fires once and the
  tracker only moves forward, so a helper who denied location then enabled it
  has no way to re-verify and stays dependent on the poster.
- **No pre-expiry warning** on an accepted job — `AppliedJobCard` passes
  `expiresAt` only while pending, so the ghosting clock is invisible until it
  fires.
- **Complete Profile: input values clipped by the check icon at every phone
  width** (prod, 2026-09-12, Chromium + WebKit). `48b0d9b23` added the ZIP
  check with `pr-10`; at 375 the ZIP field leaves 29px for a 48px value and
  prod shows "705"/"528" (320→11px, 390→34px, 430→47px, all <48). Same class
  hits Last name ("Incomplet"). Edit Profile got a fixed ZIP column in
  `41cacda14`; Complete Profile did not. Repro: `admin-e2e`/`incomplete-e2e`
  sessions, `/complete-profile` at 375.
- **PostJob `PhotoUpload` focus ring never paints.** `dbed7befd` added
  `focus-within:ring-2`, but the label's inline `style={{ boxShadow: "inset …" }}`
  (`src/components/postjob/detailsSection/PhotoUpload.tsx` ~139-143, ~227-231)
  overrides Tailwind's ring (also box-shadow). Keyboard users get a named,
  focusable picker with no visible focus. Measured on prod 2026-09-12.
- **A brand-new account is asked to "Re-Agree"** — `TermsReconsentDialog`
  opens for a profile that never accepted any version (`terms_version_accepted`
  empty), on top of the Complete Profile gate. Copy says "re-agree" and
  "material update" to someone seeing the Terms for the first time. Seed
  accounts now pre-accept in `prod-seed.mjs` so the sweep gets past it.
- **Still unverified on prod after today's `dbed7befd`:** `role="img"` spans
  (no urgent/boosted/just-posted/pinned rows were live), admin KPI tile height
  + fraud-filter select 44px (now reachable via `admin-e2e`).

## Conventions half-applied
- **× vs labelled cancel.** `dialog.tsx` auto-hides the × when a
  `DialogSecondaryAction` registers — self-enforcing, by design. `sheet.tsx`
  renders `SheetCloseButton` unconditionally and shares none of it. Today's
  toast fix covered toasts only (2 of ~560 call sites).
- **`CardSubPanel`** was extracted today from PhotoProof; the same shape is
  hand-drawn ~59 more times.

## Verification debt
Everything shipped 2026-09-11 gated on typecheck + vitest only, because
Chromium was not installed until late in the day. **Nothing has been eyeballed**
except the guest /browse shell, the applicants card, and the poster photo
toggle. Owner's standing rule is that a visual is not done until it has been
looked at.

Harness contract for the helper job card, learned the hard way — two lanes
stalled on it:
- `useActivityData` needs BOTH the `applications` rows AND the RPC
  `get_jobs_for_my_applications` (SETOF jobs, no args), intersected on
  `job_id`. Mock only the `jobs` table and every app gets `job: null`.
- `HelperRevisionCard` reads the `job_revisions` table, falling back to
  `jobs.revision_note` — SINGULAR.
- Set `HAPPY_PATH_BASE_URL=http://localhost:5183`.
- Screenshot BEFORE asserting, and open the PNG. A spec here passed while
  photographing a page of skeletons because it asserted the capture succeeded
  rather than that anything was in it.

## Job card meta row
- **Location must always outrank "16 hours left".** At narrow widths the meta
  row drops the place name while keeping the expiry countdown — seen on
  `JobCard` in the browse feed with the map open. Where you are is the first
  filter a helper applies; how long is left is secondary. (owner, 2026-09-11)

## The job card is not one component — CONFIRMED
Owner asked directly ("is this all one component? if not fix it"). It is not:
- The category corner-tab (`rounded-br-lg rounded-tr-none`) is hand-rolled in
  **two** places — `activity/JobCardShell.tsx` and `dashboard/JobCard.tsx`.
- `activity/JobCardTitleBar.tsx` already owns title + price pill, and
  `dashboard/JobCard.tsx` reimplements the same thing inline instead.
- The price pill's literal colours (`hsl(var(--bark) / 0.10)` fill,
  `/ 0.28` border) are hand-written across 10+ files.

SEQUENCING, deliberately: this waits for lane `step-components`, which is
mid-flight defining the one shell both job cards fill. Retrofitting
`dashboard/JobCard.tsx` onto pieces whose API is still moving would be work
done twice. The moment that lane lands, the browse card adopts the same
chip / title-price / meta pieces — that is the fix, not a second set of
components.

## Notification count — STILL WRONG (reported again 2026-09-11)
My c14f86df4 fixed badge-vs-list DRIFT (setUnreadTotal was written once but the
list mutated in five places). It did not fix this. Do not re-fix drift.

One datum already gathered, prod: `lexilombas05@gmail.com` has **10** unread
notification rows, of types `application` and `new_offers` only. The bell
showed **10** — so the BELL IS CORRECT and the panel's "Unread 11" is the
wrong number. Start there, not at the badge. Suspect the panel's own
`unreadInPage`/tab-count derivation, or a row the list counts that the DB
query does not (optimistic insert, realtime dupe).

## Browse map — controls and preview card escape the map bounds
Owner, 2026-09-11 ("fix this bullshit"), with three screenshots:
- The **recenter button** (`browse-map-recenter`, BrowseMap.tsx:843) sits half
  outside the map's right edge — clipped against the boundary between the map
  and the page background.
- The **job preview card** (`aside`, the drag-handle + close-X sheet) is cut off
  at the bottom; its lower half runs past the visible map area.
Both are `position: absolute` inside the map container — check what is actually
establishing their containing block. CLAUDE.md's standing trap: any ancestor
with transform/filter/backdrop-filter/contain/will-change becomes the containing
block for absolutely/fixed positioned descendants, and the map's own chrome uses
backdrop-filter.
- **The preview card is not anchored to its pin.** Tapping a pin opens the card
  pinned to the BOTTOM of the map, nowhere near the marker that was tapped, so
  the reader has to work out which pin they are looking at. It should attach to
  (or at least point at) its own marker. Same screenshot set as above.

### Notification count — ruled out
`notifications.read` is `NOT NULL` in prod (10 false / 63 true for
lexilombas05), so the null-vs-false split between the server count
(`.eq("read", false)`) and the client filter (`!n.read`) is NOT the cause.
Next suspect: there are FOUR `<NotificationPanel />` mounts (DesktopTopNav,
AdminTopBar, DashboardTitleBar, DashboardHeader), each with its own
`notifications` array and its own `unreadTotal`, sharing no cache. Mark one
read and the others never hear about it. Lift the state into a shared query.

## Profile badges — "Verified" rung duplicates "Stripe verified"
The VERIFIED group shows "Stripe verified"; the AS A HELPR group directly
below opens with a ladder rung also called "Verified". Same fact, twice, two
inches apart. Drop the redundant one — the account-level badge above already
says it. (owner, 2026-09-11)

### DECIDED — At-a-glance stat tiles: exactly FOUR
Rating · Jobs posted · Jobs completed · Cancelled. (owner, 2026-09-11, via
pop-up, explicitly "im not asnwering this again".) Currently renders seven.
Drop: on-time %, rebooked %, needed-revisions %.

## CONSISTENCY — identity verification has FOUR renderings
One fact, four treatments, and the owner has raised this repeatedly:
1. Profile "Verified" group — **"Stripe verified"**, gold pill + shield icon
2. Profile "As a Helpr" group — **"Verified"**, ladder rung, different pill
3. Profile header — **"ID verified by Stripe"**
4. `dashboard/JobPosterCard.tsx:83` — **"✓ ID VERIFIED"**, uppercase, no pill,
   a literal ✓ character instead of the shield icon everything else uses

ONE component, ONE label, ONE treatment, everywhere. Pick the pill+shield form
(it is the one with an icon and a real badge primitive behind it) and delete
the other three. #2 is already logged separately as redundant with #1.

This is the class the owner keeps pointing at: the same fact hand-drawn per
surface. Same disease as the job card (three copies) and the price pill (10+).
- Profile: remove the white card behind the 'Finish setting up' payout banner (ProfileLanding, Profile.tsx:608) — the banner already has its own sienna-tinted surface; the liquid-glass box behind it is a second boundary. (owner, 2026-09-11)
- Reviews empty state: fix spacing — the 5-star illustration sits too close/tight above 'No reviews yet' (EmptyStateIllustration.tsx:37, EmptyReviews). Its viewBox is cropped ('2 34 116 26') so the glyph's own bounds don't match its visual weight. (owner, 2026-09-11)

## Shells leave a gap on the left and right — fix GLOBALLY
Owner, 2026-09-11: "on all these there shouldnot be a gap on the left or right
it needs to fill the space it stead rn ots showing like a small shadow look. so
fix these shells globally".

Seen on /profile?tab=availability: `AppShell` → `container mx-auto px-5 lg:px-8
xl:px-12` → `page-measure mx-auto`. The inner card stops short of the frame on
both sides, so the page reads as a narrow sheet floating on a wider surface
rather than filling it. This is the SHELL, so it affects every AppShell page —
fix once in the shell, never per page.

## Time picker regressed to a native input — restore the scroll wheels
Owner, 2026-09-11: "this needs to be a scroll how it was before how hour time
and ap pm". The Set-hours popover now renders a native `<input type="time">`
("05:-- PM" with a clock affordance) instead of the previous hour / minute /
AM-PM scroll columns. Native time inputs are keyboard-first and look different
on every platform — which also breaks the one-surface rule, since iOS, Android
and desktop each render their own. Restore the wheel picker.

## Availability: "Until 2:44 AM" is a hardcoded 4 hours nobody chose
`AvailabilityTab.tsx:73` calls `set_available_now` with `p_hours: 4`; the live
RPC is `p_hours numeric DEFAULT 4` → `available_until = now() + 4 hours`. The
card then prints "Until <that time>" as though it were a setting the helper
picked. Tap it at 10:44 PM and it announces you as available until 2:44 AM.

Worse, the SAME SCREEN holds a second, unrelated availability system: the
weekly Sun–Sat grid (9 AM–5 PM). The grid says 9–5, the toggle says until
2:44 AM, and neither reads the other. One fact, two systems — decide which is
authoritative, and either let the helper choose the duration or derive it from
the grid's hours for today.

## From the state-matrix sweep (logged 2026-09-11)

Real screen count, derived from code, not guessed: 28 routes that render a
screen + 26 Profile tabs + 25 Admin views + Activity/Legal sections = **~73
signed-in screens**, plus **94 files containing an overlay**. 73 + 94 = ~167,
which is where "162" comes from. The owner's number was right.

- [x] **S1 · DONE (a520a50a8).** Cause: these pages pick skeleton-vs-error from
      the query's settled state, so the shared retry schedule IS the
      time-to-error. `queryClient.ts` had `retry: failureCount < 2` on TanStack's
      default backoff — three round trips plus three seconds of pure waiting.
      Now one retry with an explicit capped `retryDelay`. Measured at 375:
      /my-jobs **3.41s -> 1.15s**, /my-posts 3.42 -> 1.40, /messages 3.39 -> 1.14,
      /dashboard 1.44 -> 1.24. Retries were NOT removed — a spec that fails the
      first read then succeeds proves a blip still self-heals with no error card.
      Original report: **A backend failure shows ~20s of skeletons.** SEEN
      on /dashboard, /my-jobs, /my-posts, /messages, both widths. The designed
      "We couldn't load this / Try again" card only appears after React Query
      exhausts retry+backoff. Until then: blank pills, no message, no way out.
- [x] **S2 · DONE (a520a50a8).** Cause: `useActivityData` returned
      `loading: isLoading`, and `isLoading` is `isPending && isFetching` — false
      in exactly the two states where there is no answer yet: a disabled query,
      and a cached-empty result being refetched. So the empty state rendered
      while the read that would return the user's work was still in flight. Now
      the skeleton holds until the tab's core query has settled, and keeps
      holding during a refetch only when there are zero rows to show (so a
      background refetch never blanks an existing list). False-empty window
      **3.7s -> 0s**. Original report: **A false empty state flashes.** SEEN on
      /my-jobs at 375: "No applications yet" at 3.8s, then at 15s the same page
      says "you have 1 in Waiting". The user is told they have nothing while
      they have work.
- [x] **S3 · DONE — it was the MOCK, not the app.** `WorkRecord.tsx` reads the
      profile with `.single()`; the Playwright fixture ignored the
      `Accept: application/vnd.pgrst.object+json` header and returned an ARRAY,
      so `created_at` was undefined (`Invalid Date`) and `full_name` was
      undefined ("Helpr Member" — visible in the same screenshot). Live, both
      render correctly, and prod has 0 null `created_at` across 8 profiles.
      Fixed at source with `honourSingleObject()` in the fixture, which now
      unwraps one row or returns 406/PGRST116 like real PostgREST.
      Original report: **Work Record prints `Invalid Date`** in MEMBER SINCE — on a document
      framed as an Employment & Earnings Record for an employer.
- [x] **S4 · DONE — and Work Record was the one lying.** The Reviews tab filters
      `feedback_visible_at <= now()`; Work Record had NO reveal filter, so it
      counted reviews the app deliberately hides during the blind window. In
      prod this never surfaced only because the `reviews` SELECT policy enforces
      the reveal — verified live: as an ordinary member, 0 of 16 blind-window
      reviews are readable. **An employer-facing number must not lean on RLS for
      its correctness**, so the filter is now explicit in the page. The mock had
      a second cause: `SEED_REVIEWS` lacked `feedback_visible_at`, a column the
      prod trigger always stamps. Both fixed; the two screens now agree.
      Original report: **Two screens disagree about the same reviews.** Work Record says
      AVG RATING 4.5 (2); ?tab=reviews says "No reviews yet". Same account,
      same session.
- [x] **S5 · DONE.** The desktop rail wrapped `EmptyState variant="inline"`
      (which paints its own fill and border) inside a `.liquid-glass` card. Added
      a `bare` variant that carries layout and paints nothing. Measured:
      liquid-glass boxes in the panel **2 -> 1**, then eyeballed. Every other
      Profile tab checked at 1440 — no other nested card.
      Original report: **Nested white card inside the white panel** at
      /profile?tab=pets @1440 — the 2026-09-07 defect at a width nobody rechecked.
- [x] **S6 · DONE.** The chip row was `overflow-x-auto scrollbar-hide` — a
      horizontal scroller with no affordance, and a mouse has no horizontal
      swipe. Now wraps. Chips fully inside the card: 1440 **10/11 -> 11/11**,
      375 **2/11 -> 11/11**. Eyeballed both.
      Original report: **Skills chips clipped mid-word** at /profile?tab=profile @1440
      ("Eve…"), no scroll affordance.
- [x] **S7 · NOT A DEFECT — the mock again.** The sweep's RPC catch-all returns
      `null` for `get_helper_analytics`, and the page's `!data` branch correctly
      renders the error. Live, the RPC returns a full payload and the page
      renders the UPGRADE panel at both widths. The app is right; the temporary
      spec was incomplete. Original report: **?tab=analytics error state.**
- [x] **S8 · DONE.** The sentence was sharing a tinted box with the 44px
      switch. Switch moved up to the heading row; the sentence gets the card's
      width. Measured: description **204px / 4 lines -> 293px / 3 lines**,
      switch top 508 -> 445. Eyeballed.
      Original report: **"Instant Release" body wraps in a ~250px column** inside a
      full-width card, ?tab=auto_tip @375.
- [x] **S9 · NOT A DEFECT — deliberate.** It is `TITLE_CARD_STYLE`'s top-right
      burnt-sienna radial glow, present on every title card. Sampled 254->251 RGB
      across the right half, identical live and in the original screenshot. Left
      alone. Original report: **Messages header pill grey band** across its right
      half, @1440 empty.

Clean: zero horizontal overflow on all 54 captures; every empty state on the 15
previously-uncaptured Profile tabs is designed, not blank.

## Needs the owner — prod write

      Original report: **Duplicate seed family.** `jobs` holds two exact mirror families,
      `5eed0a…` and `5eed0b…`: 26 jobs / 24 applications / 80 messages EACH,
      all 26 titles+statuses matching pairwise, identical `created_at`. The seed
      script ran twice. This is why every job card looks doubled on /dashboard —
      it is duplicated DATA, not a render defect. Deleting one family is a
      destructive prod DELETE of ~130 rows; either family is equivalent.

## Closed 2026-09-11

- [x] **Notification panel count — ROOT CAUSE FOUND, fixed in 74bb850a9.** The
      two numbers were never out of sync; the LIST was. The bell and the chip
      read the same variable in the same component, so they cannot diverge. The
      panel fetched the latest 50 by `created_at` (a recency page) while the
      badge counted unread across the whole table. Different sets. On the
      owner's account: 73 rows, 10 unread, 63 read — and the ten unread rank
      53rd-62nd, because 63 read rows landed after them. So the page contained
      zero unread while the chip correctly said 10. Re-measured through the real
      component at that exact row shape: **unread rows rendered 0 → 10**. This
      also un-breaks Mark all read, which derived its ids from the page, found
      none, and returned early — a silent no-op on the one account that needed
      it. My three previous attempts were all correct and all irrelevant: no
      amount of sharing one variable makes a page contain rows it never asked
      for.
- [x] **Job cards render twice — was duplicated seed data, not a render defect.**
      Closed by the prod delete above.
- [x] **Browse map pin anchoring.** Nothing mirrored MapKit selection into the
      DOM, so every pin stayed 44x44. Selected pin is now 64x64 with a halo and
      a caret in that pin's screen column. Recenter and card overflow did NOT
      reproduce (12/13px inside; the card sits 112px above the edge, which is
      `MAP_DOCK_CLEARANCE`) so they were left alone.
- [x] **Arrival retry.** `mark_helper_arrival` verified idempotent live — a
      second call can only add the verified stamp. "Try my location again" added
      while arrival is `claimed`; it never advances the rail.
- [x] **Hardcoded availability vs the weekly grid.** The grid is authoritative:
      it is the only one the helper configured. Was "Until 2:44 AM" over a 9-5
      grid; now "Today's hours ended at 5:00 PM · signal 2 more hours". A
      MISSING row resolves to what the grid draws, not to "off" — reading it as
      "off" reintroduced the contradiction in one step, caught by screenshot.
- [x] **Time-picker scroll wheels.** The native-input swap was keyed on the
      DEVICE while the problem it solves is the CONTAINER, so it fired inside a
      fixed 300px popover too. Wide desktop forms keep it; the popover opts out.
      Verified `nativeTimeInputs: 0`, wheels + AM/PM at 1440 and 393.

Not a defect: the lone `animate-pulse` is `MobileNav.tsx:779`, the `aria-hidden`,
`motion-safe`-gated halo behind the Post FAB. Screenshot specs should exclude
`[aria-hidden]` rather than assert "no pulse" — and note a `.animate-pulse`
class selector misses it entirely, since it is `motion-safe:animate-pulse`.

Open, small: the bell abbreviates at "99+" while the chip prints the true total.
Now reachable in prod. Mild disagreement, not yet fixed.

- [x] **`Admin.tsx` / `UserProfile.tsx` "hand-roll min-h-screen" — NOT a defect,
      2026-09-11.** I filed these two myself and I was wrong. CLAUDE.md defines
      TWO legitimate page shapes, and document-scroll pages are supposed to use
      a plain `min-h-screen bg-premium-page pb-safe-nav` wrapper and explicitly
      NOT `AppShell`. Both `/admin` and `/user` are in `DOCUMENT_SCROLL_ROUTES`.
      `ALLOWED_SHELLS` had no entry for their category, so the test manufactured
      two offenders. The danger was the FRAMING, not the false positive: the
      comment said the list "must only ever SHRINK" and "deleting an entry is
      the fix", which aims the next reader at wrapping both in `AppShell` —
      breaking them twice (clipped below the fold under `overflow: hidden`, and
      a second rail inset on top of `#root`'s). Category now derives from
      `DOCUMENT_SCROLL_ROUTES`, exempt-by-name is gone.
- [x] **`/terms`, `/privacy`, `/rules` lost their native viewport lock — FOUND
      BY THE NEW GATE, fixed 2026-09-11.** `8570fdbef` made them real routes
      three commits ago and added them to `DOCUMENT_SCROLL_ROUTES` but not to
      `NATIVE_APP_SHELL_ROUTES`. On native they rendered `Legal.tsx` through
      `AppShell` with no `html.app-shell` class — the internal scroll container
      without the lock that makes it work — on three quarters of the legal
      surface, which is exactly the iOS notch-ghosting bug that list exists to
      prevent. Gate proved by mutation: every half fails when broken.
- [x] **"7 dead page files to delete" — WRONG, do not delete them (2026-09-11).**
      `AutoTip`, `HelprWrapped`, `HomeHistory`, `PetProfiles`, `StrSettings`,
      `HelperAnalytics`, `WorkRecord` and `GiftCard` are all LIVE: every one is
      imported by `src/pages/profile/ProfileTabPanels.tsx` and renders as the
      body of a Profile tab. They are unROUTED, which is what the orphan check
      reported, and "unrouted" was read as "dead". Deleting them would have
      blanked eight Profile tabs. The orphan assertion should say "routed by
      nothing AND imported by nothing" — as written it describes a real
      condition but names it misleadingly.

## Public-site visual pass (lead, 2026-09-11) — 20 routes captured at 375 and 1440

- [x] **Automated-test debris on the PUBLIC browse page — DONE 2026-09-11.**
      Deleted the 19 test jobs that carried no financial records (with 12
      applications, 7 reviews and 117 notifications), including BOTH publicly
      visible rows. Backup: `docs/backups/test-debris-backup-2026-09-11.json`.
      Re-measured the finding's own repro: test titles in `open_jobs_browse`
      **2 -> 0**, and confirmed by eye in a fresh capture of guest `/browse` at
      375 — the `[sweep-poster]` card is gone.

      **49 rows deliberately NOT deleted.** They carry payout_transfers,
      refunds, tips, disputes, W9 or gift card records. `payout_transfers` is
      ON DELETE RESTRICT, so a settled job cannot be deleted by anyone anyway —
      and deleting settled money to tidy a list is worse than the list. None of
      the 49 is `open`, so none is publicly visible.

      **My "the spec never cleans up" claim was WRONG — correcting it.**
      `scripts/e2e/prod-lifecycle-sweeper.mjs` already exists, already runs in
      `e2e-real-backend.yml`, and already documents this exact residue and the
      exact ON DELETE RESTRICT constraint I then hit. The evidence it works:
      the newest test row is 2026-09-09, and dozens of CI runs have happened
      since with zero new rows. The accumulation had already stopped before I
      looked; what I deleted was historical residue from before it landed. The
      The sweeper keys on `[E2E DO NOT ACCEPT]` and never covered the 7
      sweep-harness titles (`[SWEEP]`, `[sweep-poster]`, `Sweep test`), which is
      where both public rows came from — but that is NOT a gap to fix either:
      grepped the whole repo and nothing creates those titles. The only match is
      a code COMMENT in `HelperRevisionCard.tsx:75` citing "the [SWEEP] patio
      job". They were typed by hand by an audit lane on 2026-09-07/08. No
      recurring source, so no sweeper change is warranted. NOTHING TO DO HERE.

      Original report: **Automated-test debris is live in prod.** SEEN at 375 on guest `/browse`: the first card
      reads `[sweep-poster] Deep clean before...`. Prod holds **68** such rows:
      61 titled `[E2E DO NOT ACCEPT] automated lifecycle …` and 7 from the sweep
      harness (`[SWEEP] …`, `[sweep-poster] …`, `Sweep test — …`). All are
      `is_seed = true`, so the launch switch will hide them — but that is an
      argument about launch day, not about today, and a visitor on the site now
      sees a bracketed test title as the top job. Two are `status = 'open'`:
      `[sweep-poster] Deep clean before move-out` and
      `Sweep test — deep clean kitchen`.
      The growth matters as much as the rows: first seen 2026-09-07, last
      2026-09-09, ~20 a day. The E2E lifecycle spec creates and never cleans up.
      Deleting is a prod DELETE; the spec also needs to clean up after itself.

Verified clean, so these can stop being re-reported:
- **Legal tab pills are NOT unequal.** Measured all three at 375: Terms, Rules
  and Privacy are each exactly **86px**, `flex: 1 1 0%`. The selected pill only
  READS wider because it is the filled one. Backlog item was stale.
- **The selected Legal pill does carry real gloss.** Computed `background-image`
  on its `btn-grad-primary` child is a genuine `radial-gradient(...)`, not a
  flat fill — checked the computed value, not the class name, per CLAUDE.md.
- **The grey Apple chip in the footer is deliberate**, not a broken asset:
  Apple and Instagram are `disabled` "coming soon" chips, Facebook is the only
  live account. Reasoned in the code.
- **The 404 page is fine** — "404", an explanation, Go Back and Back to Home,
  with the marketing footer. The temp spec's matcher was wrong, not the page.
- **/legal at 1440 fits correctly**: `#root` padding-right 248px applied once,
  content column 48→1144 centred in the 1192 post-rail area, zero overflow.
- **/dashboard at 375 fits**: frame 0→375 full width, zero overflow. Five
  distinct job cards, no doubling — the seed delete is confirmed VISUALLY, not
  just by a row count.

## Reports from the loading-states lane (not fixed, out of its scope)

- [x] **DONE f2b63d921.** Repro confirmed exactly: load /my-jobs empty, add an
      application server-side, reload -> **0** network requests for 60s while the
      page states the account has nothing. The persisted IndexedDB cache is what
      lets it survive a reload. Fix: `refetchOnMount: "always"` on the two
      activity CORE queries. Measured: `/rest/v1/applications` requests after
      reload **0 -> 1**; "No applications yet" at t=5s and t=8s **shown ->
      never**. Deliberately NOT `staleTime: 0` (that destroys the cache's
      purpose — every observer, tab switch and focus becomes a fresh wave), and
      NOT a zero-row-only stale window (a cached list of three that is now four
      is wrong the same way; the defect is "we re-showed a cached claim without
      checking it", not "empty is suspicious"). Cores only — details re-key off
      the core result and refetch anyway. Regression checked: populated cache +
      a 6s-slow revalidation paints rows at 800ms and never blanks to skeleton.
      Original report: **60s-stale empty list with NO refetch.**
      Within `CORE_STALE = 60s`, a user who just gained an application saw
      "No applications yet" for the full staleness window with zero network
      requests issued. Not a loading-state bug, so that lane left it — but it is
      a real "your work is invisible" window.
- [x] **DONE f2b63d921.** The toast now fires only when the panel is open and
      ALREADY showing rows. Measured: toast alongside the page's error card
      **t=1.5s to ~5s -> none**. Panel opened while failing with no rows still
      shows its inline card with Try again, 0 toasts. Eyeballed at 375 — one
      card, nothing floating over it.
      Original report: **two error messages for one outage** — a persistent
      inline "Couldn't load notifications — try again?" banner lingering ~4s
      beside the page's own error card.
- [x] **DONE f2b63d921 — and it was MUCH worse than I reported.** I said "10s
      plus a retry". It was **three** attempts: the query carried its own
      `retry: 2`, which is exactly why a520a50a8's retry-schedule change never
      reached it — this was the one query silently opting out of the shared
      client policy, so the global fix looked applied and wasn't. Measured
      against a hanging `/rest/v1/profiles`: time to "We couldn't load your
      account" **32.2s -> 13.0s**. Timeout 10000 -> 6000, and the local `retry`
      override removed so one place decides time-to-error. That also stops it
      retrying 4xx profile errors, which it was doing.
      Original report: **PROFILE_QUERY_TIMEOUT_MS is 10s per attempt.**
      Against a HANGING (not 500ing) backend, ProtectedRoute's account-level
      error card still costs 10s + a retry. The retry-count fix helps, but the
      10s timeout is the dominant term there.
- [x] **DONE — confirmed viewport-independent.** /my-jobs 935ms @1440 vs 923ms
      @375; /dashboard 1906ms @1440 vs 1910ms @375. Screenshots opened and
      looked at: designed error card, rail correct on the right, no dead gutter.
      **Measurement caveat worth keeping:** the pre-fix /dashboard number read
      1384ms and post-fix 1906ms. That is NOT a regression — the locator
      `/couldn't load/i` was matching the notification TOAST before it was
      removed. A measurement that was quietly measuring the wrong thing, which
      is the exact hazard CLAUDE.md names.
      Original report: **1440 not re-driven for S1/S2.** The fix is entirely in the data layer so
      it is viewport-independent, but it was verified at 375 only.

## CI reliability (lead, 2026-09-11)

- [x] **The anon surface contract failed the build on a lie — fixed d5b193c56.**
      `E2E real backend` went red at `b7bc81eb` with: *"public.get_ranked_open_jobs
      — the anon ranked-jobs RPC surface — answered anon with HTTP 504. A
      signed-out visitor sees nothing there."* None of that was true. I checked
      the object rather than the message: it is not a view and not broken — it
      is `get_ranked_open_jobs(integer,integer,boolean,numeric,numeric,numeric)`,
      runs in **31ms**, and has no client caller. `probeSurface` decided the
      object's kind from `table probe status !== 404`, so ANY transient gateway
      error short-circuited to `kind: "view"` carrying the 5xx, and the failure
      text then described a public outage that was not happening.
      The next push went green with nothing fixed — the self-healing red
      CLAUDE.md warns about twice. Re-measured against live prod:
      `504 view … rows=-` **→** `200 rpc … rows=9`, whole contract passes.
      Worth noting this was NOT caused by the seed/test deletes, which is the
      first thing I checked given the timing.

- **Notification count — CONFIRMED BY EYE 2026-09-11, on real prod data.** Not a
  count, not a test: opened the panel at 375 in Chrome against the owner's own
  account and LOOKED. Bell badge **10**, "Unread" chip **10**, "THIS WEEK 10",
  and **ten actual unread rows** rendered, each with its unread dot, default tab
  Unread. The panel is 375 wide and 650 tall at top 86 — full width, correctly
  sized, so it is not caught by the transformed-ancestor `position: fixed` trap.
  After three fixes I called done without looking, this one was looked at.

  Aside, not a defect: the bell's click did not register through the browser
  pane's synthetic click; a real `.click()` opens it. Worth knowing so nobody
  files "the bell does nothing" from an automated driver.


## The mock boundary lied three times in one sweep (2026-09-11)

Three of the seven state-matrix "defects" (S3, S4-in-part, S7) were the
Playwright fixture, not the app — and they were filed as SEEN because they WERE
seen, in a screenshot. This is the `mock-boundary-is-why-audits-missed-it`
pattern running in reverse: usually the mock hides a real defect; here it
manufactured three. Both directions have the same root: **a fixture that does
not behave like PostgREST**. The `.single()` bug is the sharpest case — the
fixture ignored the object-Accept header for every `.single()` call in the app,
so ANY page reading one row got an array and rendered undefined fields.
Fixed at source, so the next sweep inherits a fixture that tells the truth.

Two follow-ups worth keeping:
- [x] **`formatMonthYear` printed `Invalid Date` — DONE 7b4cbc59a.** It now
      returns null and the Work Record drops the whole "Member since" field.
      An absent row reads as "not shown"; the literal string reads as a fact
      about the person, on a document framed to its reader as an Employment &
      Earnings Record for an employer. Prod cannot produce it today, but the
      page reached exactly this state on 2026-09-11 via the fixture bug. Proved
      by stashing the guard: the new test fails `expected 'Invalid Date' to be
      null` without it, 20/20 green with it.
- [x] **`zz-tmp-state-matrix.spec.ts` DELETED** along with the other three temp
      sweep specs. It mocked only two RPCs, so any RPC-backed tab always showed
      its error state in it — which is how it manufactured the analytics
      "defect". A spec that produces confident, empty evidence is worse than no
      spec.


## New, from the data-freshness lane (2026-09-11)

- [x] **DONE e59a7ff85 — reproduced, then fixed.** With every non-account read
      500ing at 1440: "We couldn't load jobs." at x=93 and "We couldn't load the
      map." at x=663, side by side — two triangles, two Try again buttons. The
      desktop map column is now gated on the EXACT condition the feed uses for
      its own card, so the two cannot disagree. Cards **2 -> 1**; card width
      **481 -> 1006** (spans the panel). `mapVisible` untouched so the column
      returns the moment the feed has rows; healthy 1440 re-verified unchanged.
      The map toggle is disabled while that card is up, since with the column
      suppressed it would be an affordance guaranteed to do nothing.
      Original report: **two error cards for one outage** — "We couldn't
      load jobs" and "We couldn't load the map", side by side
      (`/tmp/freshness/r4-dash-1440.png`). Each panel legitimately owns its own
      read and the map panel only exists at desktop, but it is the same
      one-outage-many-messages shape just fixed for the toast. Desktop dashboard
      layout was not that lane's scope.
- [x] **NOW EXECUTED (b941fbfcd).** `NotificationPanel.refreshToast.test.tsx`
      renders the real panel and drives the real `loadNotifications` through the
      pull-to-refresh callback. Open panel with rows + failed refresh → toasts;
      closed panel → silent. Proved both ways: removing the branch fails one
      test, making it unconditional fails the other.
      Original: **One branch is code-verified but NOT runtime-verified.** The notification
      toast's "panel open and already showing rows" branch is only reachable via
      pull-to-refresh or a realtime event; the harness stubs realtime inert and a
      synthetic touch gesture did not fire the pull handler (instrumented: 0
      notification requests after the gesture). The branch was kept because it is
      the conservative narrowing — without it that case goes silent — but it was
      not proven to fire. Said plainly rather than counted as verified.

## The audit apparatus was the bug (lead, 2026-09-11)

- [x] **The admin visual sweep had never photographed a single admin view — fixed
      431d63125.** Ran it myself. All 25 admin captures came back
      **byte-for-byte identical**: every one a photograph of
      `RouteErrorBoundary`'s chunk-load state ("Update ready."), and the run
      reported **25 passed**. axe is perfectly happy with an error boundary — it
      is a heading and two buttons, and it is accessible. So the one check the
      file exists to perform had never run against a single admin view, and said
      green. The gate already failed a screen that did NOT render (a thrown test
      leaves `totalViolations` undefined); it did not fail a screen that rendered
      SOMETHING ELSE, and that hole was wide enough to drive the whole admin
      surface through. Now every capture is checked for the crash boundary, the
      chunk-load boundary and the account-error card. Proved both ways: red
      against the dev server naming both screens, green against a correct build.
      A second, quieter hole found on the way: without `PLAYWRIGHT_WEB_SERVER=1`
      all 25 tests pass in **672ms writing no images at all**.
- [x] **The 25 admin views are now actually captured** — 25 PNGs, 25 distinct,
      in `/tmp/ui-review/`. Admin Jobs and Admin Health both render correctly and
      read well. This is the first time anything in Admin has been looked at.

- [x] **Nested white card inside white card — SUPERSEDED.** The owner ruled on
      this (see "Nested white cards" under Owner decisions below); a lane is
      applying it. Kept for the evidence, not as a separate task.
      Original report: **Nested white card inside white card — SYSTEMIC.**
      Two lanes hit it independently today: `/profile` landing draws 4
      (`SettingsSection.tsx:44` — each WORK / MONEY group is a `liquid-glass`
      card inside the outer `liquid-glass` wrapper), and Admin Health's
      "Configuration Checks" does the same (white bordered rows inside a white
      bordered card). It is the 2026-09-07 defect class. It is NOT being fixed
      unilaterally because the code records the owner ASKING for the eyebrow
      grouping ("better organization", 2026-08-24). Suggested shape: keep the
      eyebrows and the inner cards, drop the OUTER wrapper's material.

## Notification duplicates — I was wrong, and the lane found the real one

- [x] **My four "duplicate" groups were a FALSE POSITIVE — retracted.** My
      grouping key omitted `link`. Each "pair" was two DIFFERENT jobs with
      identical titles: `/jobs/5eed0a10-…-005` vs `/jobs/5eed0b10-…-005` — the
      duplicate seed families. One sweep run legitimately visited both copies, so
      `NOW()` matched to the microsecond. With `link` in the key: **0 groups over
      14 days**. `sweep_job_start_reminders()` was read live via
      `pg_get_functiondef` and is correct — single-table scan, no join
      multiplication, gated on `start_reminder_sent_at IS NULL`. My "join
      fan-out" hypothesis was wrong. The `admin_alert` repeats are also correct
      (24h dedupe window; those timestamps are 30h apart).
- [x] **The REAL defect, found by widening the search — fixed 870279f8f.**
      `saved-helper-availability-push` stores its "already notified" cursor with
      `.update(...).eq("user_id", id)`. For a customer with **no `profiles` row**
      that matches zero rows and PostgREST returns `{ data: null, error: null }`,
      so the `if (updateErr)` branch never fired, the cursor never advanced, and
      the identical notification re-sent **every 6 hours forever**. This is
      exactly CLAUDE.md's "a null error does NOT mean the write happened".
      Live: **40 byte-identical rows** to one user, timestamps exactly `:41`
      every 6h since 2026-09-07, still growing — and that user has no row in
      `profiles` OR `auth.users`. Fix: skip a pair whose cursor cannot be stored,
      and guard the write with `.select("user_id")` treating 0 rows as a defect.
      Plus a BEFORE INSERT trigger refusing an exact repeat of
      `(user_id, type, title, message, link)` within 10 minutes, counted in
      `notification_dedupe_suppressions` so suppression is never silent.
      Window chosen from the live table, not taste: across all 580 rows in
      history exactly ONE pair would have been caught. Migration applied 3x under
      PGlite (replay-safe); new test has a negative control so it cannot pass
      vacuously. Existing 40 rows NOT deleted — not authorised.

- [x] **SUPERSEDED — see the full investigation under Owner decisions below.**
      Original report: **`favorite_helpers` has no FK** — 7 of its 12
      live rows point at a customer in neither `profiles` nor `auth.users`.
      `notifications.user_id` has no FK either, which is how rows were written
      for a user that does not exist. Reachable with no other bug.

## Authed visual sweep — REAL session, not mocks

- [x] **Messages painted a broken-image glyph for the other party, every row and
      the thread header, both widths — fixed 4a8690448.** Verified live: that
      profile has a truthy `avatar_url` and storage answers **HTTP 400**.
      `ConversationRow` and `ChatHeader` each hand-rolled an `<img>` with no
      error path, so the browser drew its broken-image icon. `/user/:id` showed
      initials for the same person because it goes through `UserAvatar` — the
      hand-rolled copies were the bug, exactly the "never hand-roll" rule. Both
      now use `UserAvatar`. Re-measured: visible broken `<img>` **10 -> 0** at
      both widths, 14 monograms painted.
- [x] **/payment-success at 1440 pinned its card to the left edge** with ~940px
      of dead canvas — fixed in the same commit. AuthShell's column defaults to
      `items-start` and this page has no brand panel to balance it. Re-measured:
      card 48–496 **->** 496–944, centre 720 = viewport centre.
- [x] **DONE e59a7ff85 — and WORSE than I logged it.** The toast does not
      overlap the title card, it REPLACES it: toast y 8–84, the title card owns
      the same band, so `<h1>My Jobs</h1>` is invisible and its two controls —
      **"Search jobs" and "Filter by status" — are unreachable for the full
      12 seconds**. No offset fixes that; the title card owns the top band by
      design. The shared `<Toaster>` was NOT moved: the nudge alone opts out per
      toast to `bottom-center`, and only below the Toaster's own 768px
      breakpoint, so at 1440 it is untouched. The added bottom offsets were
      verified inert for top-anchored toasts rather than assumed — an ordinary
      toast still lands at y 8 at 375 and y 24 at 1440. Nudge at 375
      **y 8–84 over the title -> y 640–716**, 32px clear of the dock; occluded
      controls **2 -> 0**.
      And the answer to why it fired on /my-jobs but not /dashboard: it is not a
      global toast at all. `usePushPermissionNudge` is called only from
      `Activity.tsx` and `useActivityActions.ts`.
      Original report: **"Get notified?" toast covers the My Jobs title card** Measured:
      toast at y 8–84, the `<h1>` at y 31–51, and `elementFromPoint` over the
      title returns the toast. Harmless at 1440. Moving it means changing the
      toaster position app-wide, so it belongs to whoever owns toasts.
- [x] **DONE e59a7ff85 — it DID reproduce.** There is no denied or banned
      account in prod, which is why nobody had ever walked into it; the lane
      rewrote `approval_status`/`ban_status` in the profiles RESPONSE client-side
      so both screens rendered for real — **no prod row was mutated**. Both were
      left-pinned at 1440: card x 48–496, centre 272 **->** 496–944, centre 720
      (= viewport centre, no rail on these routes). 375 unchanged. Fixed with
      `centerColumn`, the same prop `/payment-success` uses, applied to the
      loading skeleton as well as the loaded branch so the card does not jump
      when the profile lands.
      Original report: **AccountDenied / AccountBanned likely share it** —
      same `AuthShell` call with no `centerColumn`, where AccountPending passes
      `align="center"`. CODE READ ONLY, not reproduced live, not touched.
- [x] **DONE afe650635.** Measured before: /my-jobs 1 panel at x 48–1144 (w
      1096), inbox 1 panel, **thread 0 panels** at both widths — it painted
      straight onto the canvas. `ChatPaneShell`'s standalone branch now renders
      through `PageScaffold` (the shared shell, NOT a hand-rolled panel), which
      is a thin wrapper over the same `AppShell`, so the 100dvh lock and
      bottom-nav reservation are unchanged. After: thread **1 panel, x 48–1144,
      w 1096, radius 24, 1px border — byte-identical geometry to /my-jobs**;
      375 matches the inbox. The stop-condition was checked rather than assumed:
      internal scrolling survives and the composer still reaches the viewport
      edge, with all 14 `messages-thread.spec.ts` specs passing. The lane also
      caught itself: re-using the page gutter inside the card pushed the
      composer controls to x=40 at 375 and clipped "Type a message…" mid-word —
      spotted in the SCREENSHOT and backed out.
      Original report: **open thread at 1440 has no card boundary** — every other
      authed page draws in a panel; the thread paints straight on canvas with a
      composer whose white band ends abruptly. Centred correctly. Design call.

Clean and worth recording: every authed route measured **zero horizontal
overflow** at 375 and 1440, and at 1440 the rail inset was applied exactly once
on every one.

## Deploy + gate verification (lead, 2026-09-11)

- [x] **Both halves of the notification fix are LIVE in prod, verified by object
      state rather than run colour** (CLAUDE.md: a green run is not a deploy).
      `Supabase DB Deploy` green on 870279f8f, and in prod
      `to_regclass('public.notification_dedupe_suppressions')` resolves and
      `pg_get_triggerdef` shows
      `CREATE TRIGGER suppress_exact_duplicate_notification BEFORE INSERT ON
      public.notifications FOR EACH ROW`. `Supabase Edge Functions Deploy` also
      ran and succeeded on the same sha, so the cursor fix is live too.
      (I briefly thought the trigger had not landed — my own query filtered on
      `tgname ilike '%dedupe%'` and the trigger is named `suppress_…`. The
      filter was wrong, not the deploy. Worth recording because "verify by
      object state" only works if the query actually asks the right question.)

- [x] **I broke CI and CI caught it — 5f7113ba1.** Making `formatMonthYear`
      return `string | null` broke the PDF export, which assigns it into a
      `[string, string]` column tuple: `TS2322` in `workRecordDocument.ts:395`.
      I had gated on `parsecheck` + a scoped vitest run and never ran the
      typecheck — which is precisely the case CLAUDE.md describes when it says a
      clean parse is never a substitute for `tsc -b --noEmit`. Fixed by dropping
      the column rather than coercing it, matching the on-screen behaviour.
      Full typecheck now clean, 20/20 tests green.

- [x] **Temp sweep specs deleted** (`zz-tmp-authed-verify`, `zz-tmp-public-verify`,
      `zz-tmp-state-matrix`, `zz-tmp-thread-verify`). They were untracked, so CI
      never saw them, but they broke the LOCAL typecheck with implicit-any errors
      and — worse — `zz-tmp-authed-verify` photographed loading skeletons while
      passing. Keeping a spec that produces confident, empty evidence is how the
      audits kept missing things.
- [x] **deadcode gate went red, now green — 980c82a2a.** Two unused files, both
      orphaned TODAY rather than found lying around: `MessagesEmptyThread` by my
      own removal of the Messages two-pane split, and `HelperBadges` by the
      identity work in `aa4ef9034`. Deleted both. Three comments named
      `HelperBadges.tsx` as a live surface; deleting the file without touching
      them would have left three confident statements pointing at something that
      no longer exists — the exact failure mode that made this codebase hard to
      audit. They now describe the surface, not the filename. NOT touching the
      131 unused exports: dead code you happen to notice is a report, not a task.
      `Test` workflow green on 980c82a2a.

## Owner decisions, 2026-09-11

- [x] **The 40 orphaned availability notifications are DELETED** (owner
      approved). Backed up first to
      `docs/backups/orphan-availability-notifications-2026-09-11.json` — all 40
      rows, 40 unique ids, every field. Re-measured: rows for that user
      **40 -> 0**, and `title ilike '%updated availability%'` across the whole
      table is now **0**. The newest row was 2026-09-12T00:41, i.e. the flood was
      still running right up to the deploy; the next 6-hourly tick at :41 is the
      forward proof that it stays at zero.
      (Note for anyone reading the delete: `returning` plus a count subquery in
      ONE statement reports the pre-delete snapshot — it said "deleted 40,
      remaining 40". The remaining count has to be a separate statement.)

- [x] **DONE 0e4a57017 — the owner's ruling applied, and it was FAR more than the
      two screens anyone had seen.** 43 same-material (white-in-white) nested
      pairs eliminated across 8 surfaces, identical counts at 375 and 1440:
      `/profile` landing **4 -> 0**, `/settings` **4 -> 0**,
      availability (both routes, both roles) **7 -> 0**, Admin Health's Config
      Checks + Scheduled Jobs **20 -> 0**, Admin Jobs rows **5 -> 0**, Admin
      Disputes **1 -> 0**, Admin Settings' admin-user rows **1 -> 0**, Admin
      Analytics' empty state **1 -> 0**. Group cards, eyebrows and rows are
      untouched — only the OUTER wrapper stopped painting, exactly as ruled.
      Done through a shared mechanism, not per-page forks: `AdminCard` gained
      `surface?: "card" | "none"`, default unchanged, so the other ~20 admin
      views are untouched. Eyeballed at both widths, not just counted.

      **The detector missed one on its first pass, for a reason worth keeping:**
      it skipped `role="button"` elements, so Admin Jobs' rows did not register.
      Widened, found, fixed. That is the same shape as the 2026-09-07 miss — a
      detector whose definition quietly excluded the case — and it is why the
      count is trustworthy only after you check what the detector cannot see.

      Deliberately LEFT, with reasons: `PageScaffold`'s bleeding panel around job
      cards (My Posts, Activity, Dashboard) matches the shape literally but IS
      the documented two-card shell in CLAUDE.md — removing it is a layout
      decision for the owner, not this ruling. Work Record's grey stat tiles and
      the tinted inset panels inside AdminCards (`bg-muted/40`, `destructive/5`
      and friends) are a different material and read as inset, not box-in-box.
      Segmented-control tracks and the EmptyState icon disc are detector noise.

      Original ruling: **KEEP THE GROUPS, DROP THE OUTER CARD.**
      The WORK / MONEY group cards and their eyebrow labels stay exactly as they
      are; the outer wrapper stops painting a white card and a border, so there
      is one boundary per group instead of a box inside a box. Applies
      everywhere it appears — `/profile` landing (`SettingsSection.tsx:44`, 4
      instances) and Admin Health's "Configuration Checks" at minimum. Sweep for
      others rather than fixing only the two that were seen. NOT YET DONE.

- [x] **Missing foreign keys — DONE 6417eed97, owner said go.** Live in prod,
      verified by `pg_get_constraintdef`. See the overnight rulings section.
      Original: **Missing foreign keys — INVESTIGATION DONE.**
      Findings, all measured live:

      **The orphans are historical, and the leak is already plugged.** Every
      orphaned `favorite_helpers` row was created **on or before 2026-09-01**.
      The migration that makes account deletion purge these tables landed
      **2026-09-02** (`20260902051631_account_deletion_reaches_tracking_consent_availability_favorites_reports`,
      alongside `20260902014651_account_deletion_purges_the_no_fk_tables` — the
      name says outright that the no-FK tables are handled in code by choice).
      The single row created since (2026-09-11) is valid on BOTH sides. So the
      deletion path works and is not producing new orphans.

      **But an orphan already cost us a real bug today.** The 40-notification
      flood came from an orphaned `favorite_helpers` row pointing at a customer
      with no `profiles` row. A foreign key would have made that bug impossible
      rather than merely fixed.

      **Counts:** `favorite_helpers` 12 rows — 7 orphaned `customer_id`, 10
      orphaned `helper_id`, identical against `profiles` and `auth.users`. Only
      **1** row is clean on both sides. `notifications` 540 rows, **1** orphan
      left after today's delete. `profiles` 8 rows, 8 of 8 have an `auth.users`
      row, so that side is sound.

      **The FK is safe to add, and CASCADE is the right rule.** `profiles.user_id`
      already carries a UNIQUE constraint, so it is a valid FK target.
      `favorite_helpers` today has only `UNIQUE (customer_id, helper_id)` and its
      primary key — no FKs at all. Account deletion ANONYMISES rather than
      deletes (`profiles.anonymized_at`), so the profiles row SURVIVES a normal
      deletion and CASCADE would never fire on one. It fires only on a HARD
      delete of a profile — which is exactly what produced these orphans.

      **Recommended plan, in this order:** (1) delete the 11 pre-2026-09-02
      orphan rows, keeping the 1 valid one; (2) add
      `favorite_helpers.customer_id` and `.helper_id` -> `profiles(user_id)`
      ON DELETE CASCADE; (3) same for `notifications.user_id` after clearing its
      last orphan. Prove the migration replay-safe under PGlite by applying it
      3x, per CLAUDE.md. Step 1 must precede step 2 — a constraint added over
      existing orphans fails.

      Superseded note: **owner ruled INVESTIGATE AND REPORT FIRST.** No
      schema change yet. Work out what would break, how many existing rows
      violate each constraint, and what account deletion is supposed to do here
      (remember deletion ANONYMISES rather than deletes, so a naive FK with
      CASCADE would destroy history the app deliberately keeps). Bring back a
      concrete plan. Applies to `favorite_helpers.customer_id` / `.helper_id`
      (7 of 12 live rows orphaned) and `notifications.user_id`.


## New reports from the last-three lane (2026-09-11)

- [x] **DONE afe650635 — worse than reported.** Toast x 1060–1416; rail "Post a
      Job" x 1209–1411 overlapping, and over "Notifications"
      `elementFromPoint` returned THE TOAST — genuinely unclickable, not merely
      overlapped. Cause: sonner portals to `<body>`, so it sits outside BOTH
      rail insets. Fixed in CSS gated on the same three classes as the existing
      insets, setting `right` rather than the custom property sonner writes
      inline. After: toast x **812–1168**, and `elementFromPoint` over both
      controls returns the control. Scoped to right-anchored containers and
      verified not assumed: the 375 top-centre toast is unchanged, and the rule
      was checked in `dist/assets/*.css` after a build, not on the dev server —
      the CSS-minifier trap in CLAUDE.md.
      Original report: **desktop toast overlaps the rail**
      Job" and "Notifications" controls.** Pre-existing, affects EVERY toast, and
      unchanged by the nudge fix (which only moved that one toast, and only below
      768px). Same family as the My Jobs defect, at the other breakpoint.
- [x] **DONE afe650635 — REAL, not a harness artefact.** `supabase.auth
      .getSession()` does no shape validation: it checks the session exists and
      has not expired, then hands the stored user straight through. This app
      supplies its own storage adapter on both platforms, so those bytes travel
      through code that can return a partial value, and `!!user` is then true.
      Reproduced with the id stripped from the persisted session: **7 malformed
      PostgREST requests from 5 call sites** (`profiles`, `user_roles`,
      `user_blocks`, `messages`, `notifications` x3) — against prod those are
      400s on a uuid column, i.e. "We couldn't load your account" with a Try
      again that can never succeed. Fixed at the ROOT, not at five call sites:
      `emitAuthSnapshot` normalises an id-less user to signed-out and reports to
      Sentry. **7 -> 0**, and the user lands on /login with their path preserved.
      Deliberately NOT fixed by flipping `useCurrentUser`'s `enabled`, which
      would have made the query disabled -> `isLoading:false, data:undefined,
      isError:false` -> ProtectedRoute's optimistic fall-through, i.e. **fail
      OPEN for a banned account**.
      Original report: **stale session sends `user_id=eq.undefined`**
      route render "We couldn't load your account", with `user_id=eq.undefined`
      going to PostgREST.** Hit while building the harness, so it may be a
      harness artefact — but the request is genuinely MALFORMED rather than
      skipped, which is a guard missing at the call site, not a server problem.
      Worth reproducing before believing either way.

- [x] **PROVEN 2026-09-12 18:56 UTC — the flood is over.** Cron 39 has now run
      THREE times since the fix (06:41, 12:41, 18:41, last status `succeeded`)
      and availability-titled notifications are still **0**, with
      `notification_dedupe_suppressions` also 0 — nothing even tried to
      duplicate. The expectation is now a measurement.
      Original: **PENDING PROOF: the availability flood must stay at zero after the next
      cron tick.** As of 2026-09-12 05:42 UTC: availability-titled notifications
      **0**, `notification_dedupe_suppressions` **0** (nothing has tried to
      duplicate yet), newest notification in the whole table 2026-09-11 20:37.
      `cron.job` 39 runs `41 */6 * * *`, so the next tick is **06:41 UTC**. That
      is the forward proof, and it has NOT happened yet — the fix is deployed and
      the old rows are gone, but "no new ones are being written" is so far an
      expectation, not a measurement. One query settles it:
      `select count(*) from public.notifications where title ilike '%updated availability%';`
      It must still be 0 after 06:41.


## Guest /browse: I re-applied a decision the owner had already reversed

- [x] **Search + Filters on guest /browse — ASKED, and the owner confirmed they
      stay OFF (e85b82a5b).** I removed them earlier today (8321d4344). The test
      guarding that area carried a dated note saying the owner had reversed that
      exact removal on 2026-09-07 ("/browse can have the filters", c7bce404e)
      and warning that the spec "kept the suite red for two days asserting the
      decision it replaced". Rather than pick a side I put the contradiction to
      the owner directly, who chose **keep them off, update the test**. The
      assertion is now inverted with the full flip-flop history beside it and an
      explicit "do not flip this back on the strength of the c7bce404e commit
      message alone — ask first".
- [x] **Guest /browse had TWO `<h1>Browse Jobs</h1>` — my regression, fixed
      c27ad084b.** Moving the page onto `PublicHeaderPage` today gave it a
      visible h1 while `BrowseTasksToolbar` still rendered its own sr-only one.
      An a11y defect and a Playwright strict-mode violation, red at 320, 375 and
      1440. The toolbar now takes `renderHeading`; NATIVE still renders it,
      because `PageScaffold`'s title card there is the H logo and carries no
      heading. The same shell change also turned the two CTAs into the marketing
      Navbar's `<Button asChild><Link>` — an anchor, so `role="link"` — and the
      spec now asserts the real role while keeping its intent.
      8/8 in `home-chrome.spec.ts` green.

- [x] **DONE 7c824db4c — every toast moved to the bottom**, owner ruling, locked
      by `src/test/toastPlacement.test.ts`.
      Original: **Top-anchored toasts have now landed on a header control THREE times.**
      The My Jobs title card (e59a7ff85), the desktop right rail (afe650635),
      and now: at 375 every top-centre toast covers the header's Notifications
      bell (toast y 8–78 vs bell y 21–77; `elementFromPoint` returns the toast).
      Three one-off fixes is a pattern, not a coincidence — this wants an owner
      ruling on where toasts belong, not a fourth patch.
- [x] **CLOSED, working as intended — no change.** Looked at it at 1440 now that
      the thread sits in a panel: the header, the off-platform banner and the
      composer share one centred 780px column, and the band behind the composer
      lines up with the banner above it. The cap itself is the owner's fix for
      "the bottom bar does not fit correctly"; widening it would reintroduce that.
      Original: **At 1440 the composer bar spans the 780px reading column, not the full
      panel.** `ChatView` caps timeline and composer with one `max-w-[780px]`
      wrapper. That cap is owner-set ("the bottom bar does not fit correctly"),
      so it was left alone.

## Still red, and it is the owner's own report (lead, 2026-09-11)

- [x] **DONE 84d84bc63 — the payout notice rides inside the sticky block with the
      Apply button**, so the reason you cannot be hired and its Set Up Payouts
      link are never covered. Overlap 21.1px → 0, checked in both hosts.
      Original: **The Apply sheet's submit row STILL covers the payout notice — my earlier
      fix was incomplete.** Owner's words: "the you can apply button is cut off
      by apply". `fa716f4b9` fixed the case where the sheet does NOT scroll, by
      gating `.sheet-sticky-actions` on a real `hostScrolls` measurement. The
      SCROLLING case was never fixed and is now **worse: 6px -> 21.1px**. I
      opened the failure screenshot and LOOKED: "Apply Now" sits on the payout
      notice and hides its last line and its "Set Up Payouts" link — the one
      control that would let the user resolve the block.
      Reproduces reliably locally AND in CI, so it is not the documented
      shared-tree flakiness. It is the last red test in the happy-path smoke.
      Mechanism as far as I got: with the sheet overflowing, the row's natural
      position is below the fold, so `bottom: 0` pins it to the scroller's
      bottom edge — exactly where the notice sits. That is ordinary sticky
      behaviour, which is why a naive tweak will not settle it. Handed to a lane
      with the brief that the reason you cannot be hired AND the link that fixes
      it must both stay readable.

# ============================================================
# OVERNIGHT BRIEF — agreed with the owner 2026-09-12, ~06:45 UTC
# ============================================================
# Owner: "no agents either, you do it all on your own no rush take your time
# and be thorough" · "make sure every gap is covered. no excuses"
#
# THE CORRECTION THAT DEFINES THIS RUN. Owner: "you still didnt ask what the
# audit should do bc last time there were alot of gaps you just looked and
# didnt make sure anything worked as it should." So this is NOT a look-at-it
# pass. Every screen must be PROVEN TO WORK, not just proven to render.
#
# COVERAGE — a screen is not audited until all of this exists for it:
#   · states: empty · loading · error · populated
#   · widths: 375 and 1440
#   · themes: light and dark
#   (up to 16 captures per screen, and EVERY screen gets seen)
#
# DEPTH — click EVERY control on every screen: buttons, links, tabs, toggles,
# filters, form fields. Press it and verify WHAT ACTUALLY HAPPENED: the right
# thing opened, the data changed, the state moved, the toast told the truth.
# Anything that does nothing, or lies, is a defect.
#
# JOURNEYS — run the whole loop across two test accounts, Stripe test mode:
# post → fund → apply → hire → message → on my way → arrived → working →
# complete → approve → release → review, plus cancel, dispute and refund.
#
# PROD WRITES — allowed. Create test data freely, mark it clearly, back it up
# and clean it up at the end. Never touch the owner's real rows.
#
# ROOT CAUSE — chase every failure all the way down: database, RLS policies,
# edge functions, triggers. Verify the LIVE object, never the migration file.
# Fix the cause, not the symptom.
#
# AUTHORITY — fix everything, including the subjective calls, using the rules
# already given (CONSISTENCY above all). Owner reviews the diff.
#
# ORDER — daily screens first (Dashboard, My Jobs, My Posts, Messages, job
# cards), then Profile + tabs, then Post a Job, then Admin, then the 94
# overlays. But EVERYTHING must be seen.
#
# REPORT — tracker file as usual, plus a written summary covering what changed
# and what needs the owner.
#
# RULINGS GIVEN TONIGHT, to action:
#   · Remove the cancellation fee pill too — "no pills" means none.
#   · Move ALL toasts to the bottom (above the dock on phone, bottom-right on
#     desktop) so nothing at the top of any screen can be covered.
#   · Run the whole foreign-key plan: clean the 11 orphans, then add the
#     constraints, replay-safe, verified by object state.

## Overnight — the three rulings, all DONE (2026-09-12)

- [x] **Red build fixed first — a838fa807.** The empty-state sweep was failing a
      137-screen run because /dashboard logged a 406 from `POST referral_codes`.
      The mock returned `[]` for every write under a comment claiming that was
      "so `.insert().select()` patterns get back data" — an empty array is
      precisely NOT data. It only surfaced once `honourSingleObject` started
      modelling real PostgREST earlier today. Chased to the live database rather
      than believing the symptom: `referral_codes` has matching INSERT and
      SELECT policies in prod (`pg_policy`), so the real insert DOES return its
      row and there was no app defect behind the red. The mock now echoes the
      request body as the representation, the way PostgREST does.
      **1 failed request -> 0; empty-state sweep 137/137 green.**
- [x] **No pills, including the fee — 903bbc622.** Both sides done in one pass,
      the poster's card and the helper's, because one surface keeping it would
      be the exact inconsistency the ruling removes. The AMOUNT stays as a plain
      money line: a cancellation fee charged with nothing on the card saying so
      would be worse than the pill, and on the helper's side it is their money.
      `PostedJobCard` is down to one `rounded-full` and it is an avatar.
- [x] **Every toast anchors to the bottom — 7c824db4c.** This REVERSES an
      earlier owner decision, and the reason is recorded beside it because the
      argument for top (a top banner is the iOS convention) is reasonable and
      will be made again — it lost to three measured collisions in one day. The
      dock, the original objection to bottom, was already solved by offsets the
      one opted-out toast was using, so the flip costs nothing that was not
      already handled. The nudge's per-toast override is DELETED rather than
      left as a special case that reads as meaningful and does nothing.
      **A comment could not stop a fourth reversal, so the ruling is a test**
      (`src/test/toastPlacement.test.tsx`), proved to fail when reverted.
- [x] **Foreign keys — 6417eed97, live in prod and verified by object state.**
      `favorite_helpers.customer_id`, `.helper_id` and `notifications.user_id`
      now REFERENCES `profiles(user_id) ON DELETE CASCADE`, confirmed with
      `pg_get_constraintdef` rather than by the deploy going green. 11 orphaned
      favourite rows + 1 debris notification cleared first (backed up), in that
      order deliberately — a constraint added over violations fails outright.
      Cascade is safe precisely because account deletion ANONYMISES rather than
      deletes, so it can never fire on an ordinary deletion. Proved under
      PGlite: applied 3x consecutively, orphan inserts refused on both tables,
      the row SURVIVING when the profile is anonymised and disappearing only on
      a hard delete, unrelated notifications untouched.
      This closes the class of bug behind the 40-notification flood, rather than
      only the instance.

## ⚠️ FOR THE OWNER — your profile photo is (almost certainly) your ID document

Found 2026-09-12 while walking /dashboard, /my-jobs, /my-posts, /messages and
/profile with a real session. Every one of those pages logs
`400 GET .../user-documents/76b07824…/avatar.png`.

**Nothing is leaked.** That object is in the `user-documents` bucket, which is
`public = false`, and I confirmed the URL answers **400** — both there and at
the same path in the public `avatars` bucket. It is not anonymously fetchable.

**But look at what it is.** In `storage.objects`, for your user id:

| bucket | object | bytes | created |
|---|---|---|---|
| `user-documents` | `…/avatar.png` | **810107** | 2026-05-03 17:11:09.220671 |
| `id-documents` | `…/id-document-1777828268516.png` | **810107** | 2026-05-03 17:11:09.302834 |

Identical byte count, written **80 milliseconds apart**. That is one upload
landing in two places: your identity document was also written as your avatar.
This is precisely the scenario `src/lib/avatarStorage.ts`'s own header describes
— "the ID picker and the avatar picker have sat one tap apart… Two identity
documents were found live in this bucket exactly this way."

**What I did and deliberately did not do.** I did NOT copy the file into the
public `avatars` bucket to "fix" the broken image — that would publish an
identity document. I did NOT null your `avatar_url`, because the brief says not
to touch your real rows. The app already degrades correctly: every avatar call
site now renders through the shared `UserAvatar`, which falls back to a
monogram, so you see initials rather than a broken image. The only live symptom
is the 400 in the console on every page.

**What needs you:** upload a real profile photo (that writes to the public
`avatars` bucket via the consolidated path, which is correct now), and then say
the word and I will delete the stale `user-documents/…/avatar.png` object and
clear the dead URL. The `id-documents` copy is where an ID document belongs and
should stay.

Systemic check done, not assumed: yours is the ONLY profile whose `avatar_url`
points at a non-public bucket. Every other row uses `avatars` or the brand-asset
function.

## The night's audit — infrastructure, and what it has found so far

**`scripts/audit/walk-every-control.mjs`** — the answer to "you just looked and
didn't make sure anything worked". It signs in with a real prod session, waits
for content rather than photographing skeletons, records layout facts, then
presses EVERY button, link, tab, toggle and checkbox and records what actually
changed: the URL, a dialog, the controls, the fields, the toggle state, the
console.

**It took six rounds to make it trustworthy, and that is the point.** Every one
of these was the harness accusing working code:
- held element handles across clicks, so a re-render detached them → reported
  the notifications bell unclickable;
- measured change by text length alone → reported the dashboard's Search dead,
  when it swaps the whole header for a field (517 chars → 514);
- counted any card inside a card → reported the documented two-card shell's
  17px-inset job cards, 4-6 per dashboard;
- took a minimum over four edge gaps → reported the tinted "Lafayette" location
  chips as nested cards, 8 per screen;
- reported `sr-only` controls unclickable — they are clipped to a pixel ON
  PURPOSE, for screen readers;
- reported the whole bottom nav on /messages unclickable, because opening a
  thread hides the dock and the labels were captured on load;
- reported already-active tabs dead ("Home" on /dashboard, "Posts" on
  /my-posts, "Messages" on /messages, "Terms" on legal);
- could not see toggle state, so "Copy Mon to all" looked dead.
A harness that calls working controls broken spends the night's attention on
itself. **Every finding below was reproduced by hand before being believed.**

### Confirmed and FIXED
- [x] **Tapping Search on /dashboard left the field unfocused** (bfadf5460).
      The header swapped to a search box and `document.activeElement` stayed on
      BODY, so on a phone the keyboard never came up and you had to tap again —
      two taps for one intent on the primary surface. Fixed for the standalone
      header form ONLY; the copy embedded in the filter sheet still does not
      autofocus, deliberately, because that sheet is opened by a sort/category
      control and focusing threw the keyboard over the chips. Verified both in
      Chrome.

### Confirmed NOT defects (evidence both ways, so they stop being re-reported)
- **"Copy Mon to all" on the availability tab works.** It reported dead under
  the test account because all seven of that account's days are ALREADY an
  identical 09:00–17:00 — so the copy legitimately changes nothing. Driven on an
  account where a day differed, it flips that day on (`aria-checked` false →
  true). Not a defect; the data was uniform.
- **`/`, `/browse`, `/complete-profile`, `/account-*`, `/admin` report the
  dashboard's controls** because they REDIRECT for a signed-in approved
  non-admin. Expected.

### The two-account journey — `scripts/audit/two-account-journey.mjs`
9 of 10 steps pass. It proves: both sessions are really signed in; each account
can read its own profile under RLS; **the helper CANNOT read the poster's email**;
the browse feed answers; and it cleans up its own rows.

Two corrections to my own test, not the app:
- It first reported an RLS failure on a message the helper could not read. The
  thread's counterparty was the OWNER, not the helper, so **RLS was right and
  the assertion was wrong.** (That run also put a test message in the owner's
  real inbox; it has been deleted, and the script now cleans up.)
- A completed job's thread offers no composer via `/messages?jobId=…` because a
  conversation is built FROM messages — a job with none has no thread to open.
  The real entry point is the job card's Message action. Not yet driven.

- [x] **THE MONEY LOOP IS COVERED — passed on production 2026-09-12 19:41 UTC**
      (run 34714860101, first attempt, 27.3s, no retry). Sandbox confirmed first,
      not assumed: every `stripe_session_id` in `jobs` is `cs_test_`. Verified in
      the database, not from the green tick: job `5f20df1e…` completed and
      `released`, before AND after proof photos, helper and poster both done, a
      review, and a `payout_transfers` row `status=paid`, 2200 cents ($25 budget
      less the fee) with a real Stripe `tr_…` transfer id created at 19:41:49.
      Getting there took five fixes, each found by reading the run rather than
      guessing:
        1. the token mint's "check the password" message was wrong — auth had
           logged the sign-ins as 200; the mint is now a script that reports the
           real HTTP status and retries (dba125b99);
        2. the spec waited for a "Before Photos" button that the step-by-step
           photo redesign had removed from production (ed8371fc0);
        3. it uploaded before-then-after, but the Working step asks for the after
           photo first (same commit);
        4. a second `page.goto` raced the page's post-upload refetch and hung 296s;
           the before upload now waits on the same page for the card to advance
           (66f5d8108) — and a local check showed a refetch alone causes zero
           history writes, so this is not a user-facing defect;
        5. the final `is_seed === false` assertion predated the derive-from-account
           migration; it now asserts the flag is UNCHANGED (a06d987ba).
      Found and fixed a real product gap on the way: a proof-photo upload relied
      only on best-effort realtime to advance the card (ad9a884b7).
      Original: **THE MONEY LOOP IS NOT COVERED.** Funding,
      release and refund were all skipped. The Stripe key the edge functions
      actually use cannot be read, `scripts/e2e/stripe-sandbox-on.sh` is
      owner-run, and the Stripe account exposes a LIVE context — so driving a
      payment could charge a real card. **Owner: run the sandbox script and I
      will drive post → fund → apply → hire → complete → release → review end to
      end.** Until then, escrow, payout and refund remain proven only by the CI
      spec's own history, not by anything I ran tonight.

## Money and trust audit (read-only against prod, 2026-09-12)

**No real money is stuck anywhere.** Checked every integrity invariant I could
express over `jobs`:

| check | result |
|---|---|
| REAL (non-seed) jobs with stuck money | **0** |
| completed but not released/refunded/cancelled | 3 — **all `is_seed`** |
| escrow still held on a finished job | 1 — **seed**, the disputed fixture |
| released with no helper | 0 |
| non-positive budget | 0 |
| platform fee exceeding the budget | 0 |
| open job already assigned a helper | 0 |
| in-progress job with no helper | 0 |
| `cancellation_fee_status = 'charged'` with no fee amount | 0 |
| payout_transfers rows pointing at a job that no longer exists | 0 |

Real jobs in prod: **3**. Payout rows 10, refunds 39, tips 3.

**The repeating "Dispute split did not settle" alert — NOT a defect, and I
nearly filed it as one.** Dispute `c7a12050` is `status=decided` with
`execution_status='pending'`, never started, no error, so cron 15 (`21 */6`)
re-alerts every 30h. My first read was that nothing calls
`execute-dispute-split` — `grep -rn "execute-dispute-split" src` returns only
its own tests. **That was wrong: the call is there, at
`AdminDisputes.tsx:330`, split across a line break so the function name sits on
the line after `invoke(`.** The designed flow is admin decides →
`rpc_decide_dispute` → client invokes the settler, and `UnsettledSettlements.tsx`
exists precisely to list decisions whose money has not moved. The stuck row is
SEED data created already-decided without the settler ever being invoked.
Worth clearing so the alert stops, but the product path is intact.

A note on method: a multi-line call is invisible to a single-line grep, and
"nothing calls this function" is exactly the kind of confident, wrong conclusion
that a grep invites. Read the call site.

## Cross-account authorization — NO LEAKS (17 probes, two real sessions)

`scripts/audit/cross-account-authz.mjs`. Not a policy read: two real tokens, real
PostgREST, one signed-in member asking for another's rows — the question a
hostile user would ask. CLAUDE.md is explicit that a policy can look correct and
still not do what you think.

Clean on all of it: payout transfers, refunds, tips, disputes, gift cards, W9
tax records, verification history, other people's roles, fee config, error logs,
push tokens, saved searches, saved helpers, notifications, messages to third
parties, the poster's email, and **the exact address of a job she was never
hired for** (no latitude/longitude handed over).

It carries a control so it cannot pass vacuously: the helper must still be able
to read her OWN profile. A database where nothing works must not look like a
database where nothing leaks.

**Its first run reported five leaks and every one was the probe's fault** — two
asked for a column and a table that do not exist (`payout_transfers.amount`,
`id_verifications`), and three forgot to exclude the user's OWN rows, so her own
role, tips on jobs she worked and disputes she is a party to all came back and
read as breaches. Each was checked against the database before being believed.
A probe that cannot tell "your row" from "someone else's row" cannot report a
leak, only noise; a 400/404 now reports itself as a broken probe rather than a
finding.

---

# ☀️ MORNING SUMMARY — what happened overnight

*(written as the night went; the audit sweep's full results are appended below
when it finishes)*

## Your three rulings, all done and verified in prod
1. **No pills.** Both sides of the cancellation fee too. The amount survives as
   a plain money line — a fee charged with nothing saying so would be worse than
   the pill.
2. **All toasts moved to the bottom.** This reversed an earlier decision of
   yours, so the reason sits beside it in the code, and the ruling is now a
   TEST that fails if anyone flips it back.
3. **Foreign keys added and live**, verified by object state rather than by the
   deploy going green. This closes the CLASS of bug behind the 40-notification
   flood, not just the instance.

## The most serious thing I found
**Your profile photo is almost certainly your ID document.** Same byte count as
your `id-documents` copy, written 80 milliseconds apart. Nothing is leaked — the
bucket is private and the URL 400s — and the app already falls back to your
initials, so the only live symptom is console noise. I did NOT copy it to the
public bucket (that would publish an identity document) and did NOT edit your
row. Upload a real photo and say the word; I will clear the dead object.

## What I proved, rather than assumed
- **No cross-account leaks**, 17 probes, two real sessions, asking the question a
  hostile user would ask — including the exact address of a job she was never
  hired for. With a control so it cannot pass vacuously.
- **No real money is stuck.** Every integrity invariant over `jobs` is clean;
  the only unresolved payments are seed fixtures.
- **The dispute settlement path is intact** — I nearly filed it as broken
  because a grep for the settler returned only tests. The call is there, split
  across a line break.

## What I could NOT do, and why
**The money loop.** Funding, release and refund are untouched because I could
not confirm the Stripe key the edge functions use is test mode, and the account
has a live context. Driving a payment could have charged a real card. Run
`scripts/e2e/stripe-sandbox-on.sh` and I will drive post → fund → apply → hire →
complete → release → review end to end.

## The honest note about the harness
The audit tool accused working code **eight separate times** before it was
trustworthy — dead controls that were already-selected tabs, an unclickable
notifications bell that was a stale element handle, nested cards that were the
documented two-card shell. Every finding in this file was reproduced by hand
before being believed. That is why there are fewer findings here than you might
expect, and why the ones that remain are real.

## Sweep results — 58 routes, both widths, both themes

Four runs. **375 light and 375 dark completed all 58 routes each**; the 1440 pair
was re-run sequentially because four concurrent browsers starved the dev server
and produced a wall of `page.goto: Timeout` on the Profile tabs — contention,
not defects, and worth saying plainly rather than filing thirty findings.

### Answered, with evidence — NOT defects
- **"Save" on the auto-tip tab gives no feedback, and that is deliberate.** It
  works: clicking it issues `PATCH profiles` then refetches, verified on the
  network. There is no success toast because `applyToastPolicy()` neuters every
  action-less `toast.success` app-wide by an owner decision of 2026-08-13
  (confirmations read as clutter and covered the header). The intended
  confirmation is the haptic plus the re-seeded values. **See the open question
  below — that convention has a hole on the web.**
- **"Copy Mon to all"** — no-op only because that account's seven days are
  already an identical 09:00–17:00. Proven to work where a day differs.
- **"Light" / "Dark" on the accessibility tab, "Off" on auto-tip, "Lifetime" on
  earnings, "Post a new job" on /post-job, "Home" on /dashboard** — every one is
  the already-selected option or the current route. Pressing them is supposed to
  do nothing.
- **"Follow us on Facebook"** opens a new tab, which the walker cannot see as a
  change in the page it is watching.
- **"Recenter map"** appears on /admin, /account-*, /signup-pending and / at
  1440 because every one of those REDIRECTS a signed-in approved non-admin to
  /dashboard, which has the map. Same control, one screen.

### Real, and open
- [x] **TEXT CLIPPED on home_history — RETRACTED, it was my detector.** The
      description excerpt is `line-clamp-2`, a deliberate two-line truncation
      that draws its OWN ellipsis. Tailwind sets `-webkit-line-clamp` without
      setting `text-overflow`, so a check that only knew the latter read a
      designed excerpt as text the box cannot show. Detector fixed; the route
      now reports clean. **This was the last finding standing from the sweep,
      and it was mine, not the app's.**
- [x] **ANSWERED by the owner's "consequential actions only" ruling.** Auto-tip
      Save is a settings save the form already reflects, so it stays silent by
      design; the actions with a real-world effect now confirm.
      Original: **OPEN QUESTION FOR THE OWNER — Save confirms with a haptic, and the web
      has no haptics.** The 2026-08-13 ruling killed action-less success toasts,
      and the stated confirmation on the auto-tip screen is "the haptic plus the
      re-seeded values". On the phone-sized WEBSITE and on desktop there is no
      haptic, and the re-seeded values are identical to what the user just
      typed — so pressing Save produces **literally nothing observable**. That
      collides with the standing rule that the phone-sized website and the
      native app are ONE surface. I have NOT changed it, because adding a toast
      would reverse your ruling. Options: a brief inline "Saved" beside the
      button (no toast), or accept web having no confirmation.

## ⭐ THE FINDING WORTH READING FIRST — consequential actions confirm nothing, and the reason for that just expired

Driving every control at 1440 turned up buttons that reach the server and then
show the user **nothing at all**. Verified on the network, not guessed:

| control | what it actually does | what you see |
|---|---|---|
| Security → "Email me a password reset link" | `POST /auth/v1/recover` — the email really is sent | **nothing** |
| Subscription → "Refresh membership status" | `POST check-pro-subscription`, then refetches | **nothing** |
| Auto-tip → "Save" | `PATCH profiles`, then refetches | **nothing** |

Zero text change, zero toast, no dialog, no error. Press "Email me a password
reset link" and you cannot tell it worked — so you press it again.

**The cause is one deliberate app-wide policy**, `src/lib/toastPolicy.ts`, which
suppresses every action-less `toast.success` (and `.message`/`.info`) on your
2026-08-13 decision. Its own header gives the reason:

> "The confirmations … read as clutter and, **once toasts moved to the top of
> the screen, began covering page headers.**"

**That reason no longer exists.** Toasts moved to the BOTTOM tonight, on your
ruling, precisely because top-anchored toasts kept covering headers and controls.
The policy was a workaround for the placement, and the placement is fixed.

Two supporting facts, so this is not a guess:
- The exception proves the mechanism. "Send test notification" DOES show a
  toast — because its message carries a warning ("Sent to the bell icon — but
  the Email switch for Work Status is off"), so it is not an action-less
  success and the policy lets it through.
- The auto-tip screen's own comment says the intended confirmation is "the
  haptic plus the re-seeded values". **There are no haptics on the web**, and
  the re-seeded values are identical to what the user just typed — so on the
  phone-sized website and on desktop the confirmation is nothing at all. That
  collides with the standing rule that the website and the app are ONE surface.

- [x] **DONE 40dbf2d84 — owner ruled "consequential actions only".** A new
      `confirmConsequential` renders through the real `toast.success`, keeping
      success styling; 22 call sites across 18 files moved (password reset,
      email change, membership refresh and restore, dispute resolved / withdrawn
      / settled, bans, denials, restrictions, strike reversal, force-update gate,
      abuse caps, test notifications, review posted). Trivial saves stay silent.
      Also fixed a dropped error under it: Refresh membership status discarded
      `functions.invoke`'s result, so a server failure never reached the catch.
      Seen by eye at 375 and 1440: success check, bottom-anchored, clear of the
      dock. Guard tests proved to fail both ways.

      Original: **DECISION FOR THE OWNER.** I did NOT re-enable success toasts — that
      reverses an explicit ruling of yours and changes every screen at once.
      The options:
      1. **Re-enable them now that toasts sit at the bottom** (one-line change
         in `toastPolicy.ts`) — fixes the whole invisible-action class at once.
      2. **Re-enable only for consequential actions** (an email sent, a password
         reset, a payment refreshed) and keep trivial saves silent.
      3. **Keep them off and add inline confirmation** beside the button
         ("Sent ✓"), which never covers anything.
      My recommendation is 2: the actions that need confirming are the ones with
      a real-world side effect, and a "Saved" on every field edit is the clutter
      you removed in the first place.

- [x] **RESOLVED — the "signed-out on return from checkout" symptom is a retry
      artefact, not a user path.** It appeared on every RETRY attempt observed
      today (11:38, 19:26, 19:38) and on no first attempt, and the clean run at
      19:41 passed first time without it. The loop also continued past it each
      time, since it is a warning with a fallback. Watch it if it ever shows on a
      first attempt; until then it is not a defect.
      Original: **The production money-loop test is FLAKY, and the symptom is worth
      watching.** `prod-lifecycle.spec.ts` ("post, fund, apply, hire, complete,
      release, review") failed once at 11:38 and PASSED on the very same commit
      at 11:10, with every other run today green — so the payment path is not
      broken, it is intermittent. The failure mode is specific and not a
      timeout: it ends parked on
      `…/login?redirect=%2Fpayment-success%3Fjob_id%3D…`, i.e. **the return from
      Stripe checkout landed signed-OUT**, with the harness noting "no inline
      error text found on the page".
      That is the same shape as the native Stripe-return handoff problem already
      in the notes. If a real poster hits it they are asked to log in again
      immediately after paying, which is the worst possible moment. Not chased
      further tonight because I could not drive the money loop myself (see the
      Stripe sandbox item), and because a single flake on a green day is a
      watch, not a diagnosis. **Next run that fails, pull the error-context.md
      artefact before it expires.**


- [ ] **FOR THE OWNER — the dead avatar URL is CLEARED (2026-09-12); the duplicate FILE is still there.**
      `profiles.avatar_url` for the owner is now null, verified by the UPDATE's
      returned row, so the 400 on every page is gone and the app shows initials.
      The owner reported deleting the file, but `storage.objects` still lists
      `user-documents/76b07824…/avatar.png` with its original 2026-05-03
      timestamp, so that delete did not land. Everything else in the folder is
      untouched and the `id-documents` copy is intact.
      Original: **FOR THE OWNER — delete the duplicate of your ID document.** Confirmed by
      SHA-256, not just size: `user-documents/76b07824…/avatar.png` is
      byte-for-byte identical to `id-documents/76b07824…/id-document-1777828268516.png`
      (both `63fc9c6d587cf9b5…`). My delete was blocked by the permission
      classifier, so I did not route around it. To finish: Supabase dashboard →
      Storage → `user-documents` → folder `76b07824-9b41-4741-a4c4-4f8de362f682`
      → delete `avatar.png`. Keep the `id-documents` copy. Then upload a real
      profile photo, which writes to the public `avatars` bucket and replaces the
      dead URL. Nothing is leaked in the meantime — the bucket is private.

- [x] **DONE — ZIP shows its valid check on Complete Profile, signup AND Edit Profile.**
      Original: **Complete Profile: ZIP shows no check mark when filled.** Owner, 2026-09-12,
      pointing at `#zipCode` holding "70528": the neighbouring fields show the
      valid ✓, ZIP does not. `src/pages/CompleteProfile.tsx:771`.

- [x] **DONE — a position/zoom step before every profile photo save.**
      Original: **Profile photo upload has no crop/position step — it cuts heads off.**
      Owner, 2026-09-12: "the profile picture spot doesnt give them the option to
      like center the picture better it crops their head off". The avatar is
      shown center-cropped in a circle with no way to move or zoom the image
      before saving.

- [x] **DONE (fd2d7f73c, screenshots of both honest cards) — "Update ready." is an error screen pretending to be good news — remove it
      everywhere.** Owner, 2026-09-12, clicking Terms / Rules / Privacy on Complete
      Profile: "there should not be a such thing as an update ready screen this is
      clearly an error and all of them need to be fixed". Reproduced on localhost:
      all three routes render RouteErrorBoundary's chunk-load state. Cause on the
      dev server is Vite `504 (Outdated Optimize Dep)` on `@radix-ui_react-tabs.js`
      → `Failed to fetch dynamically imported module: …/Legal.tsx` (the dependency
      pre-bundle went stale after today's `npm run build` / `cap sync`). But the
      real defect is the SCREEN: any failed chunk load is labelled "A newer version
      of the app was just released", which is a guess and here is false.
- [x] **DONE (325e4009c, measured 60/60 at 360, 375, 1440 + screenshot) — Complete Profile: "Enter App" and "Sign Out" are different heights.** Owner,
      2026-09-12: "buttons should be the same size". Measured from the selection:
      Enter App 49.5px, Sign Out 60px, stacked full-width.

## Audit gaps — owner, 2026-09-12: "why were these missed and how do we fix this gap"

Rule for this section (owner): nothing that needs the browser is marked done
until the browser has been used to LOOK at it. Agents run one at a time.

- [x] **DONE (terminal 6, 2026-09-13) — messy input was mocked.** `e2e/prod-audit/messy-input.spec.ts`
      replaces the mocked `e2e/happy-path/messy-input*.spec.ts`: the full value battery on every field
      of every URL-reachable form, the targeted rules (email/phone/ZIP, an under-18 DOB, prices
      0/negative/decimal/1e9, whitespace-only required fields), and the dialog-gated forms explored
      from real seeded records behind a write firewall — all on PROD as the four seed accounts.
      Coverage test: inventory − sweeps − explore credits − stated gaps must be empty.
      Nightly: `.github/workflows/prod-audit.yml`. Screenshots looked at for every failure.
- [x] **DONE (terminal 6, 2026-09-13) — deep links and interruptions were untested on prod.**
      `e2e/prod-audit/deep-links.spec.ts` (22 tests) and `interruptions.spec.ts` (12): a gone job,
      double-tap on apply/send/post, offline mid-submit, a slow network, back and refresh mid-flow,
      and session expiry. First prod run found five HARNESS defects that would have made the suite
      lie (HEAD counted as a write; apply tests sharing one job; the offline relabel; goBack to
      about:blank; a toast asserted after it had gone) — all fixed in 706fab635.
- [ ] **Cached sessions can be dead and still look alive (terminal 6, 2026-09-13).** A revoked GoTrue
      session still passes PostgREST with its cached JWT, so a signed-in prod spec silently ran signed
      OUT — measured as a deep-link test bouncing to /login on a 40-minute-fresh cache. `sessionFor`
      in `e2e/prod-audit/harness.ts` now verifies against `/auth/v1/user` and re-mints. OPEN: the
      journeys and a11y-prod harnesses take the same cache and do NOT verify it.
- [ ] **A same-frame double-click on Apply Now fires two `apply_to_job` calls (terminal 6, 2026-09-13).**
      The button carries `disabled={applyLoading}` (ApplyBody.tsx), which holds at human tap speed —
      proven, the second tap is refused — but two clicks in one frame beat the re-render. The DB is
      safe: the RPC raises "Already applied to this job", exactly one row exists, and the user is not
      shown a failure. Fix if it is ever worth it: a ref-based in-flight guard in `useApplyFlow`.
      Covered both ways in `interruptions.spec.ts`.
- [ ] **A half-propagated deploy can leave "Something went sideways" on screen (terminal 6, 2026-09-13).**
      A lazy chunk 404s mid-deploy, `chunkReload.ts` recovers once with `?_v=`, and its 10s guard then
      refuses a second reload — so if that one reload also lands on the old build the visitor sees the
      crash screen. Measured on prod at `/messages/a/b/c`, which renders the designed 404 on every
      attempt before and after. `settle()` absorbs it once. Open: whether the guard should allow a
      second attempt after a longer backoff.
- [ ] **The post-job double-tap is not covered end to end (terminal 6, 2026-09-13).** The generic
      stepper in `interruptions.spec.ts` does not always reach the final submit; it skips with a
      stated GAP naming its `post-step-*` screenshots rather than passing quietly. Needs a
      purpose-built driver, or the journeys' post-job leg extended with the double-tap.
- [ ] **The admin queues the explore cannot fill (terminal 6, 2026-09-13).** `AdminExceptionQueue`,
      `AdminPayoutBatches`, `TwoFactorCard`, `W9CollectionDialog` and `NpsPrompt` have no seedable
      state (prod-seed.mjs: "not produced, by design"), so their fields are stated GAPS in
      `e2e/prod-audit/messyInputForms.ts` rather than swept.

- [x] **DONE de9d3cd88 — Button size classes that silently do nothing.** Unlayered
      `button { min-height: 44px }` beats Tailwind utilities. Detector:
      `buttonGeometry.ts` requestedNotRendered. Agent 1 (Opus), in browser now.
- [ ] **Sibling buttons of different heights never compared.** Detector:
      `buttonGeometry.ts` siblingMismatch, plus dialogs via overlay-sweep. Agent 2 (Fable), queued.
- [x] **DONE f5e0e104f (red/green proven) — New-tab links never followed.** walk-every-control.mjs + sweep
      newTabDestinations. Agent 3 (Sonnet), code done, red/green browser proof queued.
- [x] **DONE 2263feec8 (34 tests, red with Update ready restored) — Stale deploy only simulated on one route.** Multi-route chunk-failure
      spec. Agent 4 (Opus), queued.
- [ ] **Visual sweep could report "147 passed" with no server.** Fixed in
      91693fbd8: fails at the start (1 failed, 147 did not run, verified). Still
      needs a real sweep run with the server up, screenshots looked at.
- [ ] **Anon surface contract failed CI on one gateway 504.** Fixed in
      91693fbd8: the rpc probe retries 5xx twice; verified green against prod.
      Not browser work; closes when the next CI run is green.
- [ ] **Parallel sessions collide on the test-server port 4173.** One session's
      tests can hit another worktree's preview. The stale-bundle guard catches it
      locally. Open: give each worktree its own HAPPY_PATH_PORT by default.
- [ ] **No test moved the clock** (time-travel lane, 2026-09-12). Inventory: `docs/audit/time-inventory.md`.
      Prod spec `e2e/journeys/time-travel.spec.ts` covers the listing-expiry chip (day before, 1 min
      before, at start, next day, Pacific viewer, both DST mornings) and the availability row
      (16:59/17:00 CT, Pacific, both DST Sundays): 2 passed, and a mutant (fall-back start at the naive
      CDT instant) went red. Screenshots looked at. PGlite `scripts/probes/offer-expiry.probe.mjs` covers both
      offer sweeps. STILL UNCOVERED on prod, announced on every run: offer countdown, confirm window,
      review window → auto-release, subscription expiry. Each needs a funded/hired job or a paid tier
      on the E2E accounts (the prod-lifecycle legs). Server cutoffs of `auto-expire-jobs` step 2
      (CT evening, DST nights), `expiring-jobs-push` and `sweep_*` have no clock-moving test now that the
      mock date filter is dropped. They need PGlite probes of the SQL sweeps, or pure cutoff helpers extracted from
      the edge functions.
- [ ] **Direct-offer expiry never tells the poster** (VERIFIED LIVE). `expire_pending_direct_offers()`
      (20260423025644) flips expired offers in one CTE, then notifies from a separate scan limited to
      `direct_offer_expires_at > now() - interval '5 minutes'`. Its only caller, `auto-expire-jobs`, runs
      `0 * * * *`, so only offers that expired in the 5 minutes before the hour are announced. Prod: 1
      expired direct offer (expired at :41), 0 "Direct offer expired" notifications ever. Repro:
      `node scripts/probes/offer-expiry.probe.mjs` → FAIL "expired 19 min before the hourly run →
      poster told (notifications=0)". Fix: notify from the UPDATE's RETURNING, and REVOKE FROM PUBLIC, anon,
      authenticated. Migration left to the coordinator: it was classifier-blocked for this lane. Re-measure with the probe (goes
      green) and the live count.
- [x] **An expired listing sits under "Waiting" until midnight.** DONE 2026-09-12: open + no pending
      applicants moves to Needs You at `expires_at` (owner: Needs You), live via `useExpiryClock`. Prod proof
      at 375 (local vite preview on prod Supabase): Waiting 3→2 and Needs You 13→14 1.6s after expiry, no reload. Seen in the time-travel screenshot
      `08-job-dst-fall-at-start`: at its start time an open, unfilled job reads "Expired", which is correct,
      but stays in the Waiting tab for the rest of the CT day. It is invisible to every helper from `expires_at` on, so there is
      nothing to wait for. It moves to Needs You only at CT midnight (`isPastDue` is day-grained). Product call:
      bucket on `expires_at <= now` as well.
- [x] **"Expired" shows for the last 59 seconds of a live listing.** DONE 2026-09-12: "Under a minute
      left" until `expires_at`, then "Expired" (seen on prod at 39.8s left and after expiry). `formatTimeLeft` floors to whole
      minutes and returns "Expired" when the floor is 0, while `JobCardMetaRow` has already decided the job is
      NOT expired. Copy call (e.g. "Less than a minute left"); the floor rule forbids "1 minute left".
- [ ] **`expiring-jobs-push` can never warn a short-lead listing.** It runs once a day (`14 14 * * *`) over
      `(now, now+24h]`, so a job posted after today's run that expires before tomorrow's is never warned.
      No other sweep covers it.
- [ ] **Lead, needs device repro: a phone clock >1h fast may sign the user out.** In the prod time-travel
      spec, one context per step with its own freshly minted session and the browser clock days ahead
      landed on "That page needs an account. Log in…" on 2 of 3 runs. supabase-js reads the stored `expires_at`
      against the device clock, and overlapping refreshes of a rotating token look like the cause. The spec now
      restates `expires_at` against the moved clock, which is a harness workaround. Repro: remove that line in
      `openAt` and run the job test. Confirm on a real iPhone with the clock set manually ahead before
      treating it as an app defect.
- [ ] **My Posts search only searches the open status tab, and says the job does not exist** (journeys
      lane, 2026-09-12, seen on prod at 390px). Repro: as the poster, post and fund a job (it lands in
      Waiting), open `/my-posts` (opens on Needs You), tap Search and type a word from its title. Result:
      "No jobs in this view / No jobs match your search — try a different term." with no pointer to
      Waiting, where the job is. The non-search empty state does point at other tabs ("14 in Done and 52
      in Cancelled"); the search empty state does not. A poster looking for a job they just posted is told
      it is not there. Screenshot looked at (`02-marketplace` failure-poster.png, run of 01:47Z). Journey
      J2 now opens the Waiting tab explicitly. Not fixed: needs a product call (search across tabs, or
      name the tab holding matches).
- [ ] **Tracking map throws "reading '_leaflet_pos'" on My Jobs** (journeys lane, 2026-09-12). Found by the
      J3 journey's error_logs check: as the helper, open `/my-jobs` and switch to Waiting while a card with a
      tracking map is mounted. `report()` fired `TypeError: Cannot read properties of undefined (reading
      '_leaflet_pos')` from TrackingMap. Prod `error_logs`: 13 rows since 2026-08-23, all from `/my-jobs`, 2
      users. Cause: `fitBounds`/`setView` animate, and the zoom-end timer reads a pane that unmounted.
      Fix in the commit adding this line: `animate: false` on both. Closes when the J3 journey runs green on
      the deployed bundle and `error_logs` shows no new `_leaflet_pos` row.
- [ ] **A hired, funded job never says the money is held, on either side's card** (journeys lane,
      2026-09-12, 390px, looked at). After Stripe funds the job (`payment_status = escrow`) and the helper
      accepts, the poster's expanded Scheduled card shows the tracker, photos and "Confirmation opens in 1d
      2h"; the helper's shows the tracker and the confirm deadline. Neither mentions that $25 is held for the
      job. The only place it is said is the one-time "Payment authorized" page. Product call: whether the
      Scheduled cards should carry a "Payment held" line (the disputed card already shows "Payment on hold").
      J4 records the count as a `funded-indicator` annotation rather than failing on copy that does not exist.
- [ ] **Log Out signs the user out on EVERY device** (journeys lane, 2026-09-12, VERIFIED LIVE). Profile >
      Log Out calls `signOutWithPushCleanup()` with no scope (`src/lib/authSignOut.ts:70`), and supabase-js
      defaults `signOut` to `scope: "global"`. Repro: mint two sessions A and B for one account; refresh B
      (200); press Log Out in a browser holding A; refresh B → `400 refresh_token_not_found`. So logging out
      of the website also logs the user out of the phone app, and Account Security's separate "Sign Out
      Everywhere" button does nothing Log Out does not already do. Side effect found the hard way: the
      journey's Log Out kicked every other lane off the shared helper account. Not fixed (auth semantics,
      owner call): likely `{ scope: "local" }` for Log Out. The J8 sign-out step runs only in
      e2e-journeys.yml (`JOURNEY_GLOBAL_SIGNOUT_OK=1`) until then.
- [ ] **Saving weekly availability can wipe the whole week** (journeys lane, 2026-09-12, VERIFIED LIVE).
      `HelperAvailability.handleSave` DELETEs the helper's weekly rows, then INSERTs the new ones, as two
      requests. Leaving the page (or losing signal) between them leaves ZERO rows, and the page then shows
      the fabricated default week (every day 9 AM–5 PM) as if it were the helper's. Repro: /availability,
      toggle a day, tap Save Availability and reload immediately. Measured on the shared helper:
      `helper_availability` went from 7 rows (Sun 9–5, Mon–Fri 8–5, Sat 9–1) to 0; restored by hand and
      re-read. Fix needs one transaction (an RPC replacing the week) plus the PGRST202 fallback; not done
      here. J7 now waits for the INSERT and restores the snapshot.
- [ ] **Two payout buttons on one card** (journeys lane, 2026-09-12, 390px, looked at). On the helper's
      Working card after both photos: "Request My Payout" (tracker) and "I'm Done — Request Payout" appear
      one above the other, both primary. `singlePrimaryCta.test.tsx` exists for this class and did not catch
      it on the live data path. J5 records the count as `payout-cta-count`.
- [ ] **A rate-limited message says only "Not Sent — Tap to Retry"** (journeys lane, 2026-09-12). The
      messages INSERT returned `400 P0001 "You are sending messages too quickly. Please slow down."`; the
      bubble showed "Not Sent — Tap to Retry" and "Couldn't Load Photo" (the attachment object was already
      gone, so a retry cannot succeed), with no reason given and no error_logs row. Hit on the shared poster
      account after repeated runs (limit: 30 messages/hour per sender).
- [ ] **Lead: "Work started — couldn't tell the poster"** (journeys lane, 2026-09-12). One run, Start
      Working showed that warning; error_logs 03:27:38Z `createNotification.insert` "Edge Function returned a
      non-2xx status code". The same call made directly as the helper minutes later returned 200. Likely the
      same repeated-run pressure as the message limit; confirm on a quiet account before treating as a
      defect.
- [ ] **Lead: boot watchdog "Helpr couldn't load." on a /profile load** (journeys lane, 2026-09-12 ~04:55Z,
      seen once, J8, 390px). A plain `goto('/profile')` painted the index.html boot-failure screen; the next
      run passed. Possibly a deploy in flight. The journeys' assertHealthy catches this pattern, so a repeat
      will fail the nightly with a screenshot.
- [ ] **Public profile shows "ID verified" and "Verification in progress" together** (journeys lane,
      2026-09-12, looked at). /user/437de07d… (Hallie H.) as the poster: both chips under VERIFIED.
- [ ] **Edit Profile keeps the old avatar after "Use Photo"** (journeys lane, 2026-09-12, looked at). After
      cropping and saving a new photo, `profiles.avatar_url` changes and the bottom-nav avatar updates, but
      the Edit Profile header still shows the initials until the page is left.
- [ ] **Skeleton screens pass `detectStuckOrBlank`** (journeys lane). Account Security's sessions,
      Warnings & Strikes and Earnings were screenshotted mid-skeleton while the detector (aria-busy /
      animate-pulse) reported nothing, so those skeletons use neither. Milestones now wait for network idle;
      the detector itself (e2e/errorScreens.ts) is not changed here.
- [ ] **Journey residue on the shared accounts.** Each marketplace run leaves a cancelled job, its
      conversation and notifications, and the helper's public profile now reads "Cancelled 51% · 30 of 59
      jobs" because test jobs are unwound after hire. prod-lifecycle has the same effect. Needs the scoped
      purge prod-lifecycle's header already asks for.

## Working forwards — owner, 2026-09-12: "all 6 need to happen"

- [x] **Lint for root-cause patterns at write time.** 53440856f `local/no-button-height-override` (76 legacy hits / 38 files, shrink-only ledger); 0f5bfe179 global control CSS may not out-rank utilities (red on the pre-fix index.css) and new-tab links may not target redirect routes (red on the original /terms case).
- [x] **Changed-screen checks before push.** 213053f0f `.husky/pre-push` → `npm run check:changed`: import graph maps a diff to routes, sweeps only those at phone-light (/login: ~10s, screenshot inspected). Press-every-control joins it when that harness lands.
  - [x] 2026-09-12: pre-push was red on every push (605df3d6f deleted the mocked `visual-audit-sweep` spec it ran). Now builds + `vite preview`s the LOCAL checkout on the per-worktree port and runs `--project=a11y-prod` (prod backend, test accounts, browser lock) on the changed routes only; job-detail-per-status block now honours SWEEP_ROUTES; no sessions = hard fail. Guard `src/test/playwrightTargetsExist.test.ts` (red on the old script). Proof: /support clean exit 0; injected 1.35:1 contrast → exit 1.
- [x] **Owner reports become failing tests first.** 55ba5a461 `npm run repro`; generated spec proven in the browser: located the element, screenshotted 375 + 1440, failed on its placeholder.
- [x] **One open-work list.** This file. CLAUDE.md now says so; memory handoffs and agent reports point here instead of carrying their own open items.
- [x] **Automatic browser lock + per-worktree test ports.** c3b133e39: `~/.lh-browser.lock` via Playwright globalSetup (second holder waited 10s, then ran); worktrees get a path-derived port, main keeps 4173.
- [x] **Nightly WebKit + real-backend run.** e83876cc5 `nightly-webkit.yml` runs the whole happy-path suite in real WebKit (helper-apply 2/2 locally; first CI run dispatched). Real backend already nightly in e2e-real-backend.yml.


### Found while closing the audit gaps (2026-09-12)

- [ ] **The sweep never rendered /complete-profile.** Seed profile is complete, so it redirected to /dashboard; both owner bugs lived there. New `complete-profile-incomplete` screen. Uncommitted, waiting on the full sweep.
- [ ] **Profile photo on /complete-profile unreachable by keyboard/screen reader** (hidden file input, aria-label on <label>). Same class in 7 more pickers: dispute evidence x2, completion photos, Edit Profile photo, post-job photos x2, post-job video. All fixed + `fileInputsKeyboardReachable.test.ts`. Uncommitted.
- [ ] **aria-label on role-less elements, 15 places** (job-card chips, pinned/active dots, earnings projection, checkout redirect overlay, post-job photo labels). Fixed + `noAriaLabelOnGenericElements.test.ts`. Uncommitted.
- [ ] **Admin KPI tiles ragged in a row; fraud filter select 48px beside a 44px button.** Fixed; detector tightened with fixture cases. Uncommitted.
- [ ] **Pre-push check blocks on pre-existing sweep failures.** A global-file push runs the whole sweep; it was red on old sibling mismatches, so pushes needed LH_SKIP_CHANGED_CHECK. Closes when the full sweep is green.
- [ ] **One icon Button held at 44px by its parent's `[&_button]:h-11`** (AdminTopBar bell / menu). Intentional; detector now ignores parent-sized buttons.
- [ ] **Sweep mock data is thin.** 7 jobs, 8 applications, 6 messages, 2 reviews, 2 notifications; every other table returns [] (earnings, payouts, disputes, pets, home history, work record, saved Helprs, credentials, referrals, admin data) and nothing is long or crowded. Expand seed + add a heavy-content variant. Queued after the current sweep.
- [ ] **No end-to-end user-journey suite** (owner: "interactive and click through everything as a regular user would"). Only the money loop and two-role lifecycle exist. Build journeys for every flow on the real backend with the test accounts; Stripe steps need sandbox ON. Queued after press-every-control.
- [x] **Write contract: client writes checked against prod's schema.** `scripts/audit/write-contract.mjs` inventories every `.insert/.update/.upsert/.delete/.rpc` in `src/` (224 on 2026-09-12: 75 rpc, 83 update, 38 insert, 10 upsert, 18 delete, 0 unresolved) and checks each against `write-contract.snapshot.json` (read-only pull from prod): columns exist, NOT NULL sent, enum/check values, table + column grants, RLS policy per role and op, rpc existence/signature/EXECUTE. Guard: `src/test/writeContract.test.ts` (each check shown able to fail). Nightly `write-contract-refresh.yml` re-pulls and fails on drift. Still unchecked: 13 payloads built from non-literal objects (known keys checked, NOT NULL not asserted); anon role only for call sites listed in `ANON_CALL_SITES`; RLS `WITH CHECK` expressions are not evaluated.
- [x] **FIXED 1cdd3b786 — `saved_jobs` / `thread_pins` upsert failed on an existing row.** Verified live in `pg_policies`: INSERT/SELECT/DELETE policies, no UPDATE. PGlite repro: a fresh upsert works, but hitting the conflict raises an RLS error — exactly the "already saved" case the upsert was written for. Fixed with `ignoreDuplicates: true`; the write contract now passes.
- [ ] **`instant_book_claim` RPC called but dropped from prod** (`src/pages/dashboard/useApplyFlow.ts:244`). Verified live: `to_regprocedure('public.instant_book_claim(uuid)')` is null; dropped by `20260904034410_drop_dead_features_instant_book_skills_reminders_dup_disputes`. The call swallows PGRST202, so nothing visibly breaks, but the `isInstantBook` branch is dead code for a removed feature. Owner call: delete the branch (and any remaining instant-book UI). Baselined in `scripts/audit/write-contract.baseline.json`; remove the entry when fixed (the guard fails on stale entries).

### Queued — start only after several running audit agents finish (owner, 2026-09-12: "don't launch any more, wait")

- [ ] **Pre-release gate:** run every audit against the exact build being shipped to TestFlight/App Store; block the release on red.
- [ ] **Production watching:** alert when real users hit error screens or failed requests (Sentry + error_logs), not only in tests.
- [ ] **In-app "Report a problem" with state:** captures screen, route and recent errors automatically.
- [ ] **Accessibility sweep in WebKit:** the axe sweep runs only in Chromium; iPhone users get WebKit.

### Findings from paused audit lanes (2026-09-12), to triage on resume

- [ ] **Keyboard lane:** DOB wheel picker (`Month` listbox) focusable with no visible focus ring; focus drops to <body> after opening a message thread and after toggling the push master switch; `#require-photo-proof` switch reported unnamed (it has a `<label htmlFor>`, which should name a button, so verify in the accessibility tree before changing it). WIP a23bcb847 in its worktree.
- [ ] **Concurrency lane (leads, unrun):** `enforce_application_job_state` reads the job without a lock, so an application may land on a job being cancelled or re-priced; the client accept is a conditional update that doesn't check job status, so accept may stamp a cancelled job, or a cancel may count a just-accepted helper and charge a fee. Money/authz: needs a proven repro before any change.
- [ ] **Write-contract lane:** `instant_book_claim` RPC no longer exists in prod; `useApplyFlow.ts` quietly skips the error, so it is dead code. 4 open-payload `profiles` updates not yet checked against 11 non-updatable columns.
- [ ] **press-every-control:** checkout presses fail in mock mode because edge functions aren't mocked ("Couldn't open checkout"); the dock "Home" button reported not clickable on /profile; the payout-check banner is pressable but does nothing. Triage after the full run.
- [x] **Fixed by coordinator:** DST start time, listing expiry and confirm card zones (790004248); saved_jobs/thread_pins re-save RLS (1cdd3b786); press-every-control service-worker false failures (ef1574d65).

### Move every audit off mocks and onto prod (owner, 2026-09-12)

- [ ] **Seed prod test data** for the two test accounts in every state the mock seed had (all job/payment statuses, disputes, long thread, payouts, reviews, credentials, pets…), all `is_seed`, restorable, and never visible to real users. Replaces seedData.ts as the audit data source.
- [ ] **Visual sweep** against prod as the test accounts (not installSupabaseMocks). Empty/error-state sweeps: decide what replaces them honestly (a throwaway test account for empty; real network failure injection for errors).
- [ ] **press-every-control MODE=prod**: destructive presses allowed only on test-owned records; admin actions only against test targets.
- [ ] **Paused lanes on resume use prod:** keyboard/large text, messy input, interruptions, slow phone/returning, scorecard, explorer. Their mocked specs get migrated, not extended.
- [ ] **Existing mocked happy-path specs in CI** (e2e-happy-path.yml, ui-sweep): migrate to prod-backed or retire, one at a time, keeping CI green. (a11y-axe.yml DELETED 2026-09-14: its spec visual-audit-sweep.spec.ts was removed in 605df3d6f as superseded by a11y-prod, so every leg failed "No tests found"; a11y-webkit-prod.yml is the one a11y sweep.)
- [x] **CI red 2026-09-14 — E2E happy-path smoke** `device-pass-measure /dashboard @ 375-dark + 1440-dark`: Urgent corner chip on JobCard painted 9px label in raw `--accent` = 3.75:1 (#d46735 on #382b27). Now `--accent-ink` (light byte-identical). Guard is the spec itself (red since ef18b5af1). Still open: the spec is mocked; a prod dark-mode dashboard axe check with an urgent seed job should replace it.
- [ ] **Uncommitted mock fixture change discarded** (edge-function stub bodies) per this decision.

### REDO on prod — work that was only verified on mocks (owner: "no mock mode ever")

- [ ] Prod test data for every state (seed lane resumed on prod: scripts/audit/prod-seed.mjs).
- [ ] Button geometry + sibling heights (de9d3cd88, admin tiles, fraud select): re-verify on prod screens.
- [ ] Keyboard file pickers, aria-label roles, dark contrast (dbed7befd): re-verify on prod screens.
- [ ] /complete-profile sweep screen: needs a real incomplete-profile test account, not a mock rule.
- [ ] Stale-deploy spec (2263feec8): routes loaded with the prod backend.
- [ ] New-tab destination check (f5e0e104f): sweep side re-run on prod.
- [ ] Messy-input specs (1eb8e7caf), deep-link interruptions (c4a52d937 WIP), keyboard journeys (a23bcb847 WIP): migrate to prod before extending.
- [ ] press-every-control full run: MODE=prod, destructive presses only on test-owned records.
- [ ] Mock seed (59a92d362) and mock-only harness pieces: retire once prod equivalents pass.

### Launch checklist (owner decisions that flip at launch)

- [ ] **Switch Stripe to live** (`scripts/e2e/stripe-sandbox-off.sh`, owner-run). Owner, 2026-09-12: sandbox stays ON until launch so money journeys run nightly on the test card. After the switch, payment steps in audits skip as UNCOVERED unless sandbox is turned on for a test window.
- [ ] **Hide seed/demo jobs publicly** (`seed_jobs_hidden_publicly()`). Owner, 2026-09-12: stays OFF for now; anon browse shows 9 demo listings.

### From terminal 2 (keyboard a11y, done b6d24b625 + cc592fe46), 2026-09-12

- [ ] **DOB wheel: Tab changes the date.** Tab inside the DateWheelPicker lands on the option buttons, which scroll-snap the column and change the value (two Tabs moved the year 2008 -> 1906). Options should be tabIndex=-1 with arrow-key handling on the listbox. A keyboard user can silently corrupt their date of birth.
- [x] **AtAGlance stat tiles differ in height on /user/:id at phone width** ("4.5 5 reviews" 58px vs "5 Jobs completed" 70.3px), content wrap. Fixed (`auto-rows-fr`). Prod 375, helper profile: before 58/58/70.3/70.3 (grid spread 12.3px), after 70.3 x4 (spread 0); 1440 63.1 x4 before and after. Guard: e2e/journeys/stat-tile-heights.spec.ts (red on origin/main build by the 12.3px spread) + buttonGeometry fixture case.
- [ ] **git stash is shared across every worktree** and lint-staged writes to it constantly; a stash/pop in one worktree popped another lane's WIP (recovered via fsck). Rule for all sessions: use a WIP commit, never git stash.
- [x] Fixed: DOB listbox focus ring, focus kept on thread open, notification switches keep focus (nested component remount, also SignupStep1/ResetPassword), Complete Profile + Signup step 2 trailing-icon clipping, PhotoUpload and AtAGlance focus rings defeated by inline styles. Guards: focusableHasVisibleFocus, noNestedComponentDefinitions, keyboard-focus and trailing-icon-fields journeys.

## Routine consolidation (2026-09-12)
- [ ] OWNER: delete the 8 disabled cloud routines at claude.ai/code/routines (the API cannot delete): repo optimization, Playwright E2E, UI sweep triage, Accessibility, Full-app UX auto-fix, Main-is-broken watcher, PR triage, Daily digest email. None will run again while disabled.
- Deleted local tasks: lh-ledger-integrity, lh-prod-error-triage, lh-security-authz-drift.
- Kept (non-visual, merge only on green, silent when clean): Stripe webhook, Supabase advisor, Sentry, Edge Functions, iOS config drift, Bundle size, Docs drift, Weekly health. The 7:30 morning report now reads each one's latest run and reports only findings, merges and failures.
- Closed stale PRs: 1563, 1559, 1552, 1578, 1581 (vitest 5 migration, Sentry off the critical path, data-display polish to redo). Dependabot asked to rebase 1579/1580.

## Unshipped branches (owner review)
2026-09-13 local-branch sweep: no unmerged local branch holds real unshipped work. The 11 checked by this sweep were all patch-equivalent on main or superseded (partner/enterprise pages dropped, welcome modal removed, Apple IAP functions and admin shell already on main, marketing-claim files rewritten), and were deleted with tip shas logged in `docs/audit/deleted-branches-2026-09-13.log`. About 150 more were deleted by a different concurrent process during the run and are not in that log.
- [ ] Find which session deleted ~150 local branches on 2026-09-12 ~22:15 without logging tip shas; recover from its log or `git fsck --unreachable` if anything is missed.

## Agent queue (2026-09-13, max 3 at once; owner decisions applied)
- [x] Gift card rename LANDED 2026-09-13: migration 8c92b9d44 + code 0a397aa8a; prod verified gift_cards present, old gift table name null, 2 new RPCs, 0 old; old edge fns (the two old-name gift functions) deleted from prod; types.ts gift names match a fresh `supabase gen types` (full regen has 145 lines of unrelated drift, not applied); write-contract refresh dispatched. Expired listings (4f48acdac) and chunkReload (0f641f534) landed.
- [x] Admin AA contrast (4 views, a11y-prod sweep on local build + prod backend, 375 light+dark): people chip 4.38→6.71:1 and exceptions "stuck" chip 4.1→6.29:1 light / 4.12→4.88:1 dark (text-destructive → text-red-800 dark:text-red-400 on the bg-destructive/15 chips in AdminUserRow, UnsettledSettlements, AdminNotificationLogs failed badge); support meta 2.66→axe-clean light / 3.35→clean dark (text-muted-foreground/60 → text-muted-foreground). notiflogs 3.94 did not reproduce today (no failed rows); same chip fixed. Shared destructive token untouched (used app-wide). Owner-approved follow-ups in the same commit: PriorityAlert count chip 4.11→~6.3:1 (same red-800/red-400 fix); .segmented-count-selected pill (SegmentedControl, the one call site, same olive-gloss selected surface everywhere) bg parchment/0.22 → olivewood/0.4: 3.41→~7.5:1 light, 4.19→~8.2:1 dark. All 50 admin screens (25 views × phone light/dark) axe + resolver clean.
- [ ] Release/Accept + other money double-tap refs (worktree agent-aaec88c069873cd52, commit 75448970c)
- [ ] Admin follow-ups: unknown-tier fallback, support view, admin role indeterminate (worktree agent-a9c25acab110f3ea5, bb9a529fe)
- [x] AtAGlance equal tiles (worktree agent-a00a44b625c53174f) — landed, measured on prod
- [x] 24h messaging lockout + embedded double-card: LANDED 2026-09-14 as 6e3d2f7d1 (embedded cards) + fda1d23aa (lockout, migration 20260914201350, supersedes 20260831053124 and the 90d23935d draft); branch `lockout-embedded` deleted. db-deploy run 34893651774 log: "Applying migration 20260914201350… Finished supabase db push" (functions-deploy not triggered: no function files). Vercel build-commit meta = fda1d23aa. PROD PROOF (375, prod web + prod DB):
  - [x] Objects: all 6 functions resolve, jobs.completed_at timestamptz, `zz_jobs_stamp_completed_at` is the last BEFORE trigger on jobs; schema_migrations has 20260914200051 and 20260914201350.
  - [x] proacl: can_message_in_job {postgres, service_role} only; can_send_message_in_job and get_messaging_closes_at +authenticated, no anon; job_messaging_closes_at, job_legacy_completed_at, stamp_job_completed_at no client role. Live RPC as poster/Helpr: can_message_in_job 403 42501 "permission denied".
  - [x] pg_policies: 0 policies reference can_message_in_job; `messages."Users can send messages"` and `storage.objects."message-attachments: sender uploads to own path"` (INSERT, authenticated) call can_send_message_in_job.
  - [x] Backfill: 17 completed jobs, 0 with null completed_at, 0 differing from job_legacy_completed_at; revision job 67e8ccfe = GREATEST(poster 02:20:24, helper, revision 02:19:22) = 02:20:24 (updated_at untouched, 2026-09-10); 0 disabled triggers in any schema; 0 notifications and 0 completed-job updated_at bumps after the apply.
  - [x] Seed job 5f20df1e at completed_at −23h: poster and Helpr each sent text + a photo from the UI, 4 rows, no "Not Sent". At −25h from the still-open composer: toast "This conversation closed 24 hours…", bubble "Not Sent — Conversation Closed", composer flips to the notice, 0 rows written; storage upload to own path 403 RLS, REST insert 403 42501, get_messaging_closes_at returns closes_at = completed_at+24h. Fresh open from the inbox: notice, no composer, history shown, both accounts. Screenshots light+dark (composer 23h, sends, refused send, toast, notice ×2 accounts, Helpr My Jobs confirmed card, poster My Posts in-progress card: 0 bordered boxes inside the card) all review-logged (`docs/audit/launch-2026-09/review-logs/lockout-proof-2026-09-14.jsonl`). Cleanup: 4 messages, 4 notifications, 2 storage objects deleted; completed_at restored to its backfilled 2026-09-12 19:41:47.276+00 (read back = job_legacy_completed_at).
  - [x] write-contract snapshot refreshed (new lockout RPCs, can_message_in_job authenticated=false); check 0 rejects.
  - [x] FIXED 2026-09-14: the deep-link effect now opens through `openConvo` (the inbox tap's loader; it also keys on the cached auth user so frame one has an id). Vitest `useMessagesData.test.tsx` "a deep-link open loads the thread's messages" red first; class check `src/test/threadOpenSingleLoader.test.ts` inventories every entry (in-app `/messages?jobId=` links, server notification link + nativePush tap, `/m/:id` short links, inbox row) and fails on any `setActiveConvo(x)`/`openThreadUrl()` outside `openConvo` — red on the original at exactly useMessagesData.ts:336/337/376/377. Prod 375 (poster-e2e, job 5f20df1e): live site "Say hello." → fixed build full history, overflow 0; review-logged. Pre-existing, not touched here: reaction chips overlap bubble text in that thread (fixed separately, see below). WAS: NEW, PRE-EXISTING (not caused by the lockout; the effect is unchanged by both commits): a `/messages?jobId=&userId=` deep link (every message notification) opens the thread WITHOUT loading its history. Prod 375, both accounts: "Say hello. Send the first message…" over a thread with 38 REST-visible messages, and on a closed thread that empty state sits above the closed notice. Opening the same thread from the inbox shows the history. Cause: the deep-link effect in `src/pages/messages/useMessagesData.ts` (openIfMatch / placeholder) calls `setActiveConvo`, never `openConvo`, so the thread fetch never runs. Needs a fix plus a class check (every path that sets an active thread must load it).
  - [x] Helpr side, owner approved flat (2026-09-14): HelperTrackerPanel root is now `space-y-2`, no `rounded-2xl liquid-glass p-3`. `noNestedTrackerCard.test.ts` widened with a cross-file job-card render walk (seeds = everything inside `<JobCardShell>`), red on exactly HelperTrackerPanel first. Prod 375 helper-e2e My Jobs in-progress card, light + dark: before 1 nested glass box, after 0; rail, CTA and chips unchanged; overflow 0; review-logged. Was: HelperTrackerPanel still one bordered glass panel inside the job card (card → panel, measured 267×160).
  - [x] FIXED 2026-09-14 (owner approved flat): `GroupJobHelpers` root is now `space-y-3`, no `rounded-2xl liquid-glass p-5`. The name exemption (REPORTED_NOT_FIXED) is gone from `noNestedTrackerCard.test.ts`, which was red on exactly GroupJobHelpers first and now also asserts the walk reaches it. Prod has ZERO group jobs (`is_group_job=true`: 0 rows, `group_job_helpers`: 0 rows, read 2026-09-14), so no prod screenshot exists; a local props-only render in JobCardShell at 375 light + dark: nested glass 1 → 0, overflow 0, review-logged. WAS: REPORT, not fixed: `GroupJobHelpers` (root `rounded-2xl liquid-glass p-5`) renders inside PostedJobCard's JobCardShell on group jobs, a bordered box inside the poster card.
  - [x] FIXED 2026-09-14 (owner approved): reaction chips covered message text. Cause: chips were `absolute -top-3` on the bubble, and the global 44px tap floor (`index.css :where(button…)`) made each one a 44px disc over the first line. Chips now sit in flow below the bubble (bottom corner away from the speaker, `-mt-2` into the 10px bottom padding), sized to the emoji with `min-h-0 min-w-0` and a 44px hit area via `before:-inset-3`. Class check `e2e/prod-audit/reaction-chip-clearance.spec.ts` (prod-audit project, nightly): every chip's box vs every text rect in the poster-e2e thread with the most reactions, at 375 and 1440. Red on the live site at both widths (44x44 chips over "there", "8:30.", "First", "Gate is back on its hinges."), green on the fixed build against prod data (6 reacted rows: own + other, 1- and 2-line, one with two chips). Screenshots 375 light + dark and 1440 review-logged (`docs/audit/launch-2026-09/review-logs/reactions-groupjob-2026-09-14.jsonl`).
  - [x] Legacy-thread reopen leniency: FIXED in the same migration (owner, 2026-09-14: "don't leave these for later"). Every job already `completed` is backfilled `completed_at = job_legacy_completed_at(...)`: both party stamps → GREATEST(poster, helper, revision_completed_at); one stamp → that stamp + 24h (auto-release); neither → updated_at. Runs with the table's enabled user triggers off for that one statement (no updated_at bump, no notifications; already-disabled triggers stay disabled). The fallback clock no longer takes GREATEST over `updated_at`. PGlite: a backfilled job stays closed after later client and service row writes. Prod check after deploy: `select count(*) from jobs where status='completed' and completed_at is null` = 0 (17 rows to backfill at 2026-09-14).
  - [x] Poster card-in-card: PostedJobCard's JobTracking and JobConfirmation (inside JobCardShell) now render `embedded`; `noNestedTrackerCard.test.ts` derives card components from source and was red on exactly those two call sites first.
  - [x] `can_message_in_job(any sender id)` was client-callable (live proacl: authenticated=X; only caller the messages INSERT policy). Policy now calls `can_send_message_in_job(job_id)` (uses auth.uid()); the 2-arg function lost every client grant.
  - [x] `get_messaging_closes_at` no longer admits bare applicants: poster, assigned/offered Helpr, roster, or someone with a message on the job.
  - [ ] Same shape, NOT changed (report): `is_party_to_job(_job_id, _user_id)` is still authenticated-callable with an arbitrary user id (used by the messages INSERT policy for the receiver, and by 4 storage.objects proof-photo policies), so a signed-in user can ask whether any user is poster/Helpr/roster/applicant on any job. Needs its own fix: a policy needs the receiver id as an argument, so it cannot simply bind to auth.uid().
- [ ] Dead code deletions (wip agent-a7af3ac420980771a, 70f851af7) PLUS owner-approved drops: pet_profiles.is_evacuation_registered, jobs.protection_opted_in, profiles.push_consent/sms_consent, platform_settings.latest_build
- [x] Visible names: helper→Helpr copy + guard, signed-in heading "Home", /saved-helprs (shipped 2026-09-13; 375 prod screenshots reviewed)
- [x] Post Job double-tap prod test LANDED 2026-09-14 (`e2e/prod-audit/interruptions.spec.ts` "double-tap the final Post creates exactly one job"; branch wip/postjob-doubletap-driver deleted). Two `.click()`s in one JS task on the final Continue to Payment, local build against prod at 375. RED (useJobSubmit `submittingRef` check removed): 2 POST /jobs, **2 job rows** (both is_seed); GREEN (guard restored): **1 row**, test passes. Screens reviewed (review:record): details, logistics, checkout, double-tap (both land on Stripe Sandbox $28; in RED the duplicate is invisible to the user). All 5 E2E-PRODAUDIT job rows (2 red, 1 green, 2 left from 2026-09-13) deleted with service role, read back 0.
- [x] prod-audit post-job teardown leftover CLOSED 2026-09-14: `scripts/e2e/prod-audit-sweeper.mjs` (service-role, run `if: always()` in `.github/workflows/prod-audit.yml` right before the key is removed) deletes jobs where title contains the bracket-free `E2E-PRODAUDIT` AND customer_id is a shared test poster account AND is_seed=true — the exact residue `poster_cancel_job` leaves once a Stripe checkout session blocks the poster's own DELETE. Refuses without the service-role key, `--dry-run` supported, hard cap 50 (exit 1, no deletion, if exceeded). `src/test/prodAuditSweeper.test.ts` (12 tests) covers the filter and the cap; RED confirmed against the bracketed marker (the original bug — 3 tests failed), GREEN on the bracket-free one. `interruptions.spec.ts`'s stale "nothing removes these rows yet" comment updated to point at the new sweeper. prod-audit.yml stays disabled (`gh workflow disable`, unchanged).
- [ ] Full customer/helper → poster/Helpr internal rename, NO aliases (after gift card rename lands)
- [ ] Combobox keyboard model (~/.lh-prompts/combobox.md); race fixes (~/.lh-prompts/race2.md) unless a terminal took them
- [x] Stripe CI check: LANDED 2026-09-12 as `scripts/check-stripe-webhook-events.mjs` + `.github/workflows/stripe-webhook-guard.yml` (>1 enabled endpoint per URL, plus event drift vs EVENT_HANDLERS both ways). Still needs the `STRIPE_TEST_SECRET_KEY` secret — see the #1586 section above.
- [x] Stripe #1586: test-mode audit endpoint we_1Tql6m… DELETED 2026-09-12 (`{"deleted": true}`); one enabled endpoint remains on the stripe-webhook URL. Issue closed.
- [x] types.ts drift DONE 2026-09-14: regenerated from prod (`fncmgoasalhdgfwzhsqa`, one schema read) and committed matching `npm run db:types` (`--schema public`). Drift was ADDITIONS only — nothing stale was left asserting a guarantee prod had withdrawn: new table `notification_dedupe_suppressions`; new columns `platform_settings.{application_cap_per_hour,application_cap_per_minute,daily_application_cap,signup_rate_limit_per_hour}`, `profiles.identity_sha256`, `retained_bans.{identity_sha256,phone_sha256,retained_via}`; 11 new RPCs `application_cap`, `ban_fingerprint`, `ban_fingerprint_salt`, `enforce_retained_ban`, `identity_fingerprint`, `job_is_funded`, `job_payment_is_funded`, `normalize_phone_for_ban`, `open_dispute_as`, `retain_ban_for_user`, `save_weekly_availability`; one tightening, `open_jobs_browse.require_photo_proof` `boolean` -> `boolean | null` (already handled everywhere by `?? true` / `=== false`, see `src/lib/photoProofPolicy.ts`). `npm run typecheck` clean, zero errors. Drift GUARD already exists and is already wired: `scripts/check-types-fresh.mjs`, called by `.github/workflows/db-drift-detect.yml:137` — no new script and no workflow edit needed; it reports `✔ 962 columns, 164 functions` against this file.
- [x] Stale `supabase.rpc` casts DONE 2026-09-14: 19 cast sites cleared now that types.ts is fresh (18 `supabase.rpc`, 1 table) — the 10 single-line ones (`admin_reverse_violation` UserAuditLog, `clear_available_now` + `set_available_now` AvailabilityTab, `toggle_thread_mute` + `clear_thread_mute` + `get_muted_threads` threadMutes, `get_user_last_active` loadConversations, `record_profile_view` useUserProfileData, `respond_to_review` UserProfile), the 5 multi-line ones (`rpc_open_dispute` DisputeDialog, `rpc_decide_dispute` AdminDisputes, `rpc_escalate_dispute` PostedJobActions, `get_payout_batch_job_ids` AdminPayoutBatches, `admin_support_queue` AdminSupport), plus 4 more the grep for the same comment turned up: `rpc_check_application_rate` + `rpc_record_application_attempt` (applyRateLimit), `get_helper_analytics` (useHelperAnalytics), `subscription_purchase_eligibility` (iap), and the `favorite_helpers.private_note` table cast (useSavedHelpers). ONE real mismatch found and fixed: `record_profile_view` was being passed `userId: string | undefined` against a NOT NULL uuid arg — now narrowed by a `userId &&` guard, not an assertion. ONE cast deliberately KEPT and its comment corrected: `set_thread_snooze._until` is legitimately nullable (NULL = mute forever, migration 20260609150000) and a generated `Args` type cannot express a nullable argument — the call is now typed on name and return with only that one argument widened. GUARD: `src/test/staleRpcCastComments.test.ts` fails on any "drop the cast once types.ts is regenerated"-style comment beside a cast whose RPC types.ts already declares; shown red on both shapes via `src/test/fixtures/staleRpcCast.ts.txt`.
- [x] Remaining `supabase.rpc` casts DONE 2026-09-14: the 14 reported below, plus 3 the report missed and 1 table boundary — 18 cast sites cleared, every one an RPC types.ts already declares. Removed: `get_job_pets` (JobPetCareSheet), `rpc_withdraw_dispute` (DisputedSection, PostedJobActions), `admin_delete_review` (AdminReports), `record_job_view` (useJobDetailData), `accept_group_application` + `respond_to_direct_offer` (useOfferHandlers), `mark_applications_viewed` (useApplicantsState), `apply_to_job` (useApplyFlow), the four in useUserProfileData (`get_user_repeat_hire_percent`, `get_public_profile_stats`, `get_public_profile_reviews` x2, `get_my_reply_latency`), `save_weekly_availability` (HelperAvailability), `get_public_profile_reviews` (PublicReviewWall), `get_public_profile_stats` (reviewStats), `block_user_and_settle` (userBlocks), and the `callUntypedRpc` boundary in `postedJobsHelpers.ts` — DELETED outright, its six RPCs (`get_job_view_counts`, `get_neighbor_hire_count`, `get_helper_completed_counts`, `get_helper_repeat_hire_percents`, `get_helper_on_time_percents`, `get_helper_distances_from_job`) are all declared and now call `supabase.rpc` directly. THREE MORE the report did not list, found by the new guard because it does not depend on comment wording: `poster_cancel_job` (CancellationDialog), `apply_low_rating_flag` (CompletionPrompts), `apply_message_violation_consequence` (logViolation). `marketingApi.ts`: the whole hand-written `marketingTable`/`Chain`/`RawResult`/`RowsResult` boundary is gone — `marketing_content` and `marketing_settings` are both in types.ts now, so the 9 queries are checked against the real schema (`CONTENT_COLUMNS` had to become ONE string literal: a `+` concatenation widens to `string` and degrades the row to `GenericStringError[]`, which is how a select-list can silently stop being checked). TWO real mismatches, both fixed without a cast: `block_user_and_settle` and `poster_cancel_job` were passing `p_reason: null` against `p_reason?: string` — both declare `p_reason text DEFAULT NULL`, so the reason is now OMITTED, which is the identical server call and IS expressible in the generated Args (userBlocks test updated to match). ONE cast deliberately KEPT: `apply_to_job._p_message` is genuinely nullable (no default, inserted into the nullable `applications.message`; current definition in migration 20260907230038), so that ONE argument is widened with a `// nullable-arg:` justification while the RPC name, the other argument and the `string` return stay checked. Also removed the dead `QueueRow` type c8683f022 left in AdminSupport.tsx, which had `npm run lint` RED on main. GUARD: `src/test/rpcCastsOnDeclaredRpcs.test.ts` fails on ANY `as any`/`as never`/`as unknown` inside a `supabase.rpc` call for an RPC types.ts declares — and on a re-introduced `fn: string` wrapper — unless the call carries a `// nullable-arg:` line; shown red on all 23 sites first, and on `src/test/fixtures/declaredRpcCast.ts.txt` (3 offending shapes + 1 that must stay green). Unlike its sibling `staleRpcCastComments.test.ts` it does not read comment wording at all, which is exactly why it caught the 4 extra sites.
- [ ] Race fixes (terminal closed → agent): settle_dispute_record, DisputeDialog, JobTracking helper_completed_at. Partial WIP (8 files, unverified) on origin/wip/race2-terminal c983eb2a9; brief ~/.lh-prompts/race2.md
- [x] Combobox keyboard model (terminal closed → agent). Partial WIP on origin/wip/combobox-terminal 6f7c27387 (+ a 1-file WIP on wip/lexilombas-.lh-combobox-ws); brief ~/.lh-prompts/combobox.md DONE 2026-09-14: shared useComboboxKeyboard; proven keyboard-only on prod at 375 (Browse, City, Address/MapKit).
- [ ] OWNER: add STRIPE_TEST_SECRET_KEY repo secret (test-mode restricted key, Webhook Endpoints: Read) — stripe-webhook-guard live job is red until then
- [x] Button-height gate false positives on prod data (FIXED: `ul[aria-label="Upcoming 7 days"]` exempt in buttonGeometry.ts with its reason; fixture case red without the exemption): earnings bar-chart day buttons (bars differ by design) on helper-profile-earnings/-payment/helper-earnings; AtAGlance stat tiles on user-profile (covered by the tiles item). Seen when a global CSS push swept every route.
- [x] Pre-push sweep now nearest route only, max 3 screens (full sweep stays nightly). Order for remaining queue: easiest first.
### PROD DB OVERLOAD (2026-09-14) — cause found
- Supabase Infrastructure page: Disk IO 100%, CPU 80%, compute 100% on t4g.nano (free tier); disk space fine (25%). ~9 nightly workflows hit prod inside 06:00–09:20 UTC plus agent prod tests, draining the disk-IO allowance; DB down since 2026-09-13 00:40 PDT, restart did not help.
- [x] Owner chose pause + spread out. DISABLED (gh workflow disable, 2026-09-14): e2e-real-backend, e2e-journeys, nightly-webkit, e2e-abuse-notifications, a11y-webkit-prod, prod-audit, press-every-control, race-runner, write-contract-refresh, prod-errors (*/15), edge-function-smoke, db-drift-detect.
- [ ] When the DB is healthy: re-enable ONE AT A TIME with crons spread across the day (one prod-hitting run per ~2h, prod-errors hourly not every 15 min), and a guard test that fails if two prod-hitting workflow crons fall within 90 min of each other. Agents: at most one prod-testing job at a time.
- [x] Crons spread + guard shipped (2026-09-14; workflows still DISABLED, re-enable one at a time). `src/test/prodWorkflowSpacing.test.ts` derives the prod-hitting set from the files (ref/URL, SUPABASE_PROJECT_REF, E2E_SUPABASE_URL, PLAYWRIGHT_* creds, prod Playwright projects) and fails on <90 min spacing, missing `prod-load` concurrency, or sub-hourly crons; red on the old origin/main (81 violations), green now. Every prod slot starts at :17 UTC between 03:00 and 13:00, 2h apart, all in concurrency group `prod-load` (cancel-in-progress false):
  | UTC | Sun | Mon | Tue | Wed | Thu | Fri | Sat |
  |---|---|---|---|---|---|---|---|
  | 03:17 | prod-audit | press-every-control | e2e-journeys | press-every-control | prod-audit | e2e-journeys | press-every-control |
  | 05:17 | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect | db-drift-detect |
  | 07:17 | db-backup | db-backup | db-backup | db-backup | db-backup | db-backup | db-backup |
  | 09:17 | nightly-webkit | a11y-webkit-prod | nightly-webkit | a11y-webkit-prod | e2e-journeys | a11y-webkit-prod | nightly-webkit |
  | 11:17 | e2e-real-backend | e2e-real-backend | e2e-abuse-notifications | e2e-real-backend | edge-function-smoke | e2e-real-backend | write-contract-refresh |
  | hourly :47 | prod-errors (window 20→65 min) | | | | | | |
- [ ] RISK, owner/coordinator call: GitHub keeps ONE pending run per concurrency group and a newer queued run cancels it. With hourly prod-errors in `prod-load`, any run that outlasts its 2h slot (prod-audit timeout 300 min, press 150) leaves the next slot's run pending, and the next :47 prod-errors cancels it silently. Options: give prod-errors its own group, or cap heavy timeouts under 2h.
- [ ] Not moved into `prod-load`: race-runner (boots a local Postgres service, never talks to prod; cron unchanged 08:37), ui-sweep (mocked; its push/PR cancel logic would cancel scheduled prod runs). Press-every-control (4 parallel shards) and e2e-abuse-notifications (matrix) lost their workflow-level `prod-lifecycle-shared-accounts` lock, so a push-triggered e2e-real-backend money loop can now overlap them on the shared accounts; e2e-journeys and prod-audit keep it as a job-level lock.
### MAIN IS RED (found 2026-09-13 ~01:00) — do these FIRST
- [x] FIXED (OPEN.md lines reworded; charge-recurring test expects "standing Helpr" after 045f5301d; 25/25 pass). Was: Vitest 34745606695: giftCardNaming guard fails (a file added after 0a397aa8a uses the old name) and charge-recurring-visits.test.ts "records a defect when the poster/helper de…" fails. Fix both; run the two files.
- [x] FIXED (two-dot tree diff; proven in a depth-1 clone: OK, exit 0). Was: Test 34745606366: "No oversized binary enters git history" step crashes — `git diff --diff-filter=AM <before>...HEAD` fails in CI (shallow checkout lacks the base sha). Fetch depth or fall back.
- [x] DONE 2026-09-14 (snapshot refreshed and committed). The SQL was never the problem: no dropped/renamed name in it, and a local `node scripts/audit/write-contract.mjs --refresh --check-drift` ran clean against prod (0 REJECTs; exit 2 = drift only). Drift committed: 13 dead functions gone (count_profiles, get_approved_helpers, get_helper_parish_badges, get_hero_parishes, get_marketplace_activity_count, get_monthly_profile_view_count, get_platform_benchmarks, get_platform_impact_stats, get_public_avg_rating, get_public_completed_job_count, get_public_job_stories, get_recent_public_payouts, review_helper_credential), 2 dead tables (pet_report_cards, subscription_cancel_reasons), dropped columns jobs.protection_opted_in/scope_video_thumbnail_url, pet_profiles.is_evacuation_registered, platform_settings.latest_build, profiles.push_consent/sms_consent, gift_cards policies. the retired credits table, under its pre-gift-card name, appears nowhere (SQL, snapshot, src). Was: Write contract snapshot refresh 34745765776 failed; SQL suspected.
- [ ] FIX SHIPPED 2026-09-14, CI PROOF STILL OPEN: the workflow now runs a real `supabase link --project-ref` with SUPABASE_DB_PASSWORD (as db-drift-detect/db-backup do) and passes the password to the query step. Not yet proven green in CI: the agent could not re-enable/dispatch the disabled workflow (its tooling refused `gh workflow enable`), so whoever re-enables write-contract-refresh must dispatch it once and read the result. Was: write-contract-refresh CI failure is NETWORK, not schema (every run since 09-13 incl. scheduled 34846751782): `supabase db query --linked` in the runner prints "IPv6 is not supported on your current network … supabase link to setup IPv4 connection" because the workflow's "Link project" step only writes `supabase/.temp/project-ref` (no pooler-url). Fix in `.github/workflows/write-contract-refresh.yml` (workflows lane): run `supabase link --project-ref` or write the pooler URL before the query, then re-enable the workflow (currently disabled_manually, so `gh workflow run` returns 422).
- [ ] E2E happy-path smoke 34746217548 red — two real failures: (a) /dashboard 375-dark and 1440-dark axe color-contrast 3.75:1, #d46735 bold 9px on #382b27 (likely a badge/chip; check whether af75d23c0 segmented-badge change or older); (b) activity-card-density.spec.ts:676 "an action in the bo…" toHaveCount got 2. These specs are the MOCKED happy-path set — reproduce on prod before fixing, then migrate the spec to prod. and E2E real backend cancelled; nightly-red #1592 (e2e-real-backend) open. Read the failing runs themselves and fix.
- [ ] Open PRs: dependabot #1580, #1579, #1550, #1549 and #1529 "fix(e2e): resolve 4 Playwright failures" — land green ones in ONE batched merge window, close stale ones with a reason.

### Gaps found 2026-09-13 night (owner approved all; work top to bottom, batch pushes)
- [x] DONE 2026-09-14 (strikes cleared + check). `node scripts/check-test-account-strikes.mjs` (3 service-role reads over the 6 shared accounts) was RED on prod: poster-e2e `ban_status=final_warning` + user_violations 117785e6 (off_platform/warning, 2026-09-13 01:56); helpr-audit-web-0824 user_violations 8062bb28 (cancel_with_helper/warning, job a2a61dc7, 2026-09-08). Both rows deleted (returned 2), poster-e2e restored to active (returned 1), check re-run GREEN (exit 0). Unit test src/test/checkTestAccountStrikes.test.ts. user_strikes was already empty for all six.
- [x] DONE 2026-09-14: step "Shared test accounts carry no strikes" (if: always(), before the key is removed) fails the job on exit 1 and warns on exit 2. Not run in CI yet (prod-audit disabled). Was: Wire `node scripts/check-test-account-strikes.mjs` into `.github/workflows/prod-audit.yml` as its last step (workflows lane): it already holds SUPABASE_SERVICE_ROLE_KEY, runs in `prod-load`, and follows the journeys that make strikes. Exit 1 = a strike, 2 = could not check.
- [ ] Make every harness that can add a strike (race probes, journeys, interruptions, messy input) delete its user_violations/user_strikes rows and restore ban_status in cleanup (the check above catches a miss; it does not prevent one).
- [x] DONE 2026-09-14. Was: Job card at 375: "Under a minute left" chip squeezes location to "B…". The card is the Activity meta row (JobCardMetaRow: My Posts / My Jobs), not the browse JobCard (already hides the countdown <430px). Before, prod data at 375 (helper-e2e /my-posts, card 0e78dd2a, clock pinned 30s before expiry): city "New Iberia" 20px of 59px ("N…"), countdown 125px. After: city 59/59px full, countdown ellipsizes at 86px ("Under a mi…"), no-countdown card unchanged, no page overflow; both screenshots looked at and recorded (review-log). Countdown is `min-w-0 shrink-[100]` + truncate; city is `shrink-0 max-w-[50%]` only while a countdown is on the row. Guard JobCardMetaRow.locationPriority.test.tsx, RED on the old classes.
- [x] DONE 449fe9d9b (named exemption; planted bad fixture FAILS now, PASSED before). Was: fixtureSchemaContract was loosened (skips literals where most keys aren't table columns) so wrong fixtures slip through. Tighten: exempt only the known non-row object in e2e/visual-audit/responsive.spec.ts by name, keep majority rule off; prove a deliberately wrong fixture fails.
- [x] INCONCLUSIVE: the saved subagent transcripts (a586a5b8…, a27a9405…) contain no denied tool call — the block was not persisted. Nothing unsafe landed: branch triage deleted only 11 logged branches; the money agent pushed with a logged skip reason. Was: Two agents tripped the auto-mode safety classifier (branch triage 2026-09-13; money double-tap refs). Read their transcripts, name the blocked commands, report whether anything unsafe was attempted.
- [x] DONE a33298034 (Sets keyed by id; different-card tests RED on boolean, GREEN now). Was: Accept/Release handlers share one in-flight boolean per hook: a tap on job B while job A is in flight is silently ignored. Key the ref by job id.
- [x] DONE 22f4df0c0 (ref guard; test RED 2 sends on old code, GREEN 1). Was: RichMessageInput send has only a state guard: same-frame double send can post two messages. Add the ref guard + test.
- [x] DONE f5bf06ec8 (3s bounded purge steps; offline refund; 2 tests RED→GREEN). Was: chunkReload follow-ups (0f641f534): error screen can stick on "updating" when the reload aborts offline or cache-clear hangs; the success reset only tidies storage. Fix or reword.
- [x] CHECKED 2026-09-14: neither run succeeded (both, and every later one, died on the runner's IPv6 connection, see the network line above); the snapshot is now refreshed locally and no longer lists the dropped objects. Was: write-contract-refresh was dispatched twice (runs 34742767511, 34745765776): confirm each succeeded.
- [ ] After the Vercel limit resets and prod catches up: re-count "admin role indeterminate" rows in error_logs (fix e9fcac710) — any new row is a real failed check; close nightly-red #1591.
- [x] TRIAGED 2026-09-14 (read, not re-run). Was: press-every-control #1582: read run 34744828202. Two real runs read: 34744828202 (155 failed presses) and the latest 34865377511 (5; every authed persona UNCOVERED, sign-in HTTP 522). Real defect, FIXED: "Not Now" in the push rationale dialog raised an ERROR toast "Notifications are off. Turn them on in your browser settings." (12 presses) — NotificationPanel now toasts only when permission is actually denied/unsupported (`pushDeclineNeedsSettingsHint`, test RED without it). Harness false positive, FIXED: 404 on /_vercel/(speed-)insights/script.js on the local preview failed "Go Back" (3 presses) — `ignoreHostOnlyAsset`, tested. Environment (prod DB outage 2026-09-13 07:39Z / 09-14 16:00Z), no code change: 21 error-on-load + 19 "admin role lookup timed out" + 5 CORS-on-5xx + 4 OAuth buttons "not clickable" (click landed on Cloudflare 522). Harness false positives, listed below.
- [ ] press-every-control harness: 84 "control not found on a freshly loaded page" are Notifications panel rows (labels carry relative time "2h ago" and the list re-sorts) plus /account-pending customer nav after the redirect; re-address list rows by stable id, not label+ordinal.
- [ ] press-every-control harness: 11 "no observable change" are presses on the already-selected segment (Notifications All / Unread), self-route presses (Post a new job on /post-job, Home on home) and an empty-form submit whose only effect is the native "Please fill out this field" bubble; classify selected-segment, self-route and native-validation as documented skips.
- [ ] Verify on prod when the DB is healthy (one load): the Notifications panel read "Nothing new yet." for a poster whose Unread count was 313 during the 09-13 timeouts (run 34744828202 shot customer_missing_Hallie_H_…-6). If a failed/timed-out load renders the empty state instead of the error card, that is a silent failure.
- [ ] Re-run press-every-control once prod is steady; both runs read were outage-degraded, so authed coverage is still unproven (#1582 stays open until a green or triaged healthy run).
- [x] DONE 2026-09-14. Was: Test helper account avatar (Hallie Helper) replaced on prod storage with a generated PNG; make prod-seed.mjs own that file. `node scripts/audit/prod-seed.mjs --avatar` (also runs inside --apply, checked by --verify): HEAD avatars/437de07d…/avatar.png; if missing, upload a deterministic 256px PNG generated in the script (x-upsert false, nothing binary in the repo) and repoint profiles.avatar_url. Ran once on prod: "present, left alone (image/png, 427253 bytes)", avatar_url already correct. The upload branch has not run against prod (file present); the generated PNG was decoded locally (256x256 RGB, looked at).
- [ ] Untracked in the main checkout: docs/audit/naming-and-dead-code-2026-09-13.md (uses the pre-rename gift card name, makes the gift-card naming guard fail locally) and docs/audit/morning/. Commit the audit doc renamed-clean or delete it; keep morning/ gitignored.
- [ ] ~20 finished .claude/worktrees/agent-* worktrees and their local branches: remove one at a time after confirming each is merged or pushed (never a bulk loop).
- [x] Superseded 2026-09-14: origin wip/* triage folded into the GitHub cleanup below (11 wip/* kept, listed there).
- [x] DONE 34ffd973d (pre-push warns at 70% of ~100/day; reads 96 tonight). Was: Vercel deploy budget: add a check that warns before a push when today's production deploy count is near the free-tier limit, so a rate limit is never a surprise again.
- [ ] OWNER: STRIPE_TEST_SECRET_KEY repo secret; reconnect Supabase, Slack, Canva connectors (unauthorized in sessions tonight).
- [ ] Git history rewrite (322 MB dead media) — only after every agent/terminal is stopped; see disk-cleanup handoff.
### Owner-approved 2026-09-14 (queued; max 3 agents, one prod job at a time)
- [x] DONE 2026-09-14: GitHub cleanup. Artifacts: 845 (11.82 GB listed) → 661 (11.09 GB); 184 older than 14 days deleted, all 7 db-backup-* kept; repo default artifact+log retention 90 → 14 days (db-backup.yml keeps its own retention-days: 90). Caches: 53 (10.86 GB), none last accessed 7+ days ago (oldest 2026-09-13; the 10 GB cap evicts first), so 0 deleted. Remote branches: 203 → 21; 182 deleted (88 with no unique commits per git cherry, 7 duplicate archive/worktree-agent-* refs, 87 superseded), every tip sha in `docs/audit/deleted-remote-branches-2026-09-14.log`. Open-PR heads untouched (5 dependabot + e2e/playwright-fixes-sept-2026).
- [ ] 14 remote branches KEPT with unique unshipped work (resolve each: land, fold into a lane, or record why abandoned, then delete): `feat/apple-iap` (StoreKit 2 IAP; booby-trapped, reference for the rebuild only), `perf/bundle-sentry-lazy` (Sentry off the ForgotPassword critical path; PR #1581 closed to redo), `polish/data-display-plurals-labels-formatters` (plural bug, admin status label maps, dispute money formatter; PR #1578 closed to redo), `wip/messaging-lockout-2026-08-30` (24h post-completion lockout + migration not on main), `wip/job-confirmation-2026-08-30` (JobConfirmation/JobTracking/ConfirmedSection edits), `wip/race2-terminal` (settle-dispute/complete row-lock migration + race probe; main only has the apply/confirm lock), `wip/unplus-tier-removal-20260829` (remove Plus tier; Plus is still on main, decision unclear), `wip/postjob-doubletap-driver` (prod-audit interruptions spec driver), `wip/a3098e1a3d88bb205` (notification delivery audit scaffold), `wip/a52d1fb23f25cb495` (usability scorecard spec), `wip/a69d0af0b250db810` (slow-device spec), `wip/ab081703e8d015858` (first-time-user walk harness), `wip/abf395f466bcf1adf` (interruption journeys: deep links, apply), `wip/ac0f5d2ac0f5004a5` (assistive keyboard spec).
- [ ] RUNNING: integrations + secrets audit (Slack apps/webhooks, Sentry, Supabase, Vercel, GitHub, Stripe test, Resend/PostHog/MapKit/etc.) — report only
- [ ] Alerts to one Slack channel: prod down, deploy failed, nightly-red opened, Stripe webhook failures, DB near free-tier limits — PARTLY DONE 2026-09-14 (severity policy, deploy-failed, scheduler-down, digest: see "Alerting" at the top); nightly-red and DB-limit posts belong to the monitoring terminal
- [x] Uptime check DONE (.github/workflows/uptime.yml + scripts/uptime-check.mjs). Every 10 min: one GET of www.louisianahelpr.com AND one anonymous `open_jobs_browse?select=id&limit=1` read (the CDN serves index.html straight through a DB outage, so a site-only ping would have read green for all of 2026-09-13). Down only after TWO consecutive failed rounds 30s apart, then opens/updates `prod-down: uptime` via .github/actions/nightly-issue-sync (now takes a `label`) and closes it on recovery. Own concurrency group `uptime`, exempt BY NAME with a reason in src/test/prodWorkflowSpacing.test.ts (~6 anonymous single-row reads an hour, less than one page view); exemption proven able to fail. Failure path proven locally against a bad host, happy path against prod (200 in 147ms / 238ms).
- [x] DONE, owner approved by pop-up 2026-09-14: repo secret `SUPABASE_SERVICE_ROLE_KEY` added. CI run 34882789104 now reads real numbers — database 73.4 MB / 500 MB (14.7%), /data 369.9 MB / 1.98 GB (18.7%), CPU load 0.06, disk IO in flight 0, provisioned IO baseline 87 MB/s. NOTE the tradeoff the owner accepted: every GitHub Actions workflow in this repo can now read and write prod bypassing RLS. Bucket storage is still unmeasured — neither source carries it.
- [ ] OWNER (chose to add it, 2026-09-14 pop-up): create a Slack Incoming Webhook and add it as repo secret `SLACK_WEBHOOK_URL`. Both alerts then post with no code change — this also closes the "Alerts to one Slack channel" line above for the prod-down and free-tier-limit halves. Until then an outage or usage warning still opens its issue, and the notify step FAILS LOUDLY with the instruction rather than skipping silently.
- [x] Supabase usage alert DONE (.github/workflows/supabase-usage.yml + scripts/supabase-usage-check.mjs), Sat 01:17 UTC. Management API (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF), never SQL — the control plane answers without touching the nano instance. Warns at 70% of 500 MB DB / 1 GB storage by opening `supabase-usage`. MEASURED (run 34881959722): the Management API 404s on EVERY usage route (`/usage`, `/database/usage`, `/billing/usage`, org `/usage`) — it exposes project identity and health only. The script still probes them weekly and prints what each said, so the finding is re-tested not believed. The numbers come from the project's own Prometheus endpoint (`/customer/v1/privileged/metrics`, basic auth `service_role:<key>`) — one scrape a week, still not SQL. Proven against prod: database 73.4 MB / 500 MB (14.7%), /data volume 369.9 MB / 1.98 GB (18.7%), disk IO and CPU both read; warn path fires when the threshold is lowered under those readings. Bucket storage is the one metric NEITHER source carries (no `storage_*` family in a 1494-line scrape).
- [x] Sentry release tagging DONE. Release name is now `resolveSentryRelease()` (src/lib/sentryRelease.ts), fed by VITE_SENTRY_RELEASE then `__APP_COMMIT_FULL__` — the commit SHA in BOTH shipping builds (web: VERCEL_GIT_COMMIT_SHA; iOS `npm run build:ios`: `git rev-parse HEAD`). The version-shaped "1.0.0" tail is GONE: an unidentified build now reports `unidentified-build`, because a plausible-looking release is how OBS-005 hid for months. Source-map upload already runs in CI (sentry-release.yml, SENTRY_AUTH_TOKEN/ORG/PROJECT all present as repo secrets); nothing added to Vercel. src/test/sentryRelease.test.ts holds the whole chain and was RED on the pre-change sentry.ts.
- [ ] Supabase storage audit: orphaned files in the 10 buckets (after the release proof; light prod reads only)
- [x] Owner 2026-09-14 speed-ups: (1) non-prod work runs in parallel with the single prod job (full rename after types refresh lands; Slack alerts after the integrations audit); (2) prod proofs kept small — 375 only, fewest rounds that prove the point (10 not 20 unless money). SKIPPED by owner: prod rewrite of the mocked dashboard dark-mode check.
- [x] Sentry: deleted the 3 dead/duplicate alert rules (3390582 Stripe webhook signature mismatch, 3413443 edge function 5xx burst, 3413453 chat push trigger catch-all) via the dashboard; 10 → 7 rules (2026-09-14).
- [ ] Hallie avatar re-upload path: prove on prod (owner asked) — upload to a scratch path or temporarily move the real object aside, run prod-seed --avatar, confirm re-upload + profile pointer, restore. Next prod slot.
- [ ] Signed-in press-every-control full run on prod (owner: run just before the final re-check) — one run, after the paused suites are re-enabled and prod has been healthy.
- [ ] Supabase Pro: owner will decide later (not before launch prep).
- [x] Voice note client cap lowered 10 MB → 5 MB to match the message-attachments bucket limit; guard src/lib/voiceNoteLimitMatchesBucket.test.ts (red at 10 MB).
- [x] is_party_to_job(_job_id, _user_id) is callable by any signed-in user with an arbitrary user id. LANDED 102293bb1 (db-deploy run 34899094042 green, 20260914210443 on both sides): migration 20260914210443 adds caller-bound `can_send_message_to_in_job(job, receiver)` and the messages INSERT policy calls it; is_party_to_job loses PUBLIC/anon/authenticated EXECUTE (service_role only). Wrapper = caller may post in the job (can_message_in_job) AND not banned AND NOT are_users_blocked(caller, receiver) (same function as trg_enforce_block_on_message_insert) AND caller's messages in the last hour < 30 (same source/window/cap as enforce_message_rate) AND receiver is the poster (anyone who may post), OR Helpr/offered/roster when the caller is itself poster/Helpr/offered/roster, OR an applicant only when the caller is the poster. OWNER DECISION 2026-09-14 (applied): only the poster may message applicants; the hired Helpr, roster and messaged applicants are refused, and a messaged applicant reaches only the poster (lh-authz-rls review: otherwise a one-way thread to the Helpr/roster discloses the applicant). Live inventory: its ONLY dependent is that policy; the 4 proof-photos storage policies call `is_party_to_job_folder(text)` (untouched). PGlite: `node scripts/probes/party-to-job.probe.mjs` (69 expectations, 3x replay, 16 broken copies all caught, skip path no-op). Residual: RPC calls insert no row, so calls themselves are not rate-counted (answers limited to what one INSERT per receiver reveals). Closes the review's design gap (any party could message/identify applicants) and the accepted block/rate residuals. PROD PROOF 2026-09-14 (is_seed job 868f182b, Perry poster / Hallie hired / Eli seeded applicant / Weblane non-party): proacl is_party_to_job {postgres, service_role}; wrapper SECURITY DEFINER search_path=public, authenticated only; policy calls can_send_message_to_in_job(job_id, receiver_id); pg_depend: is_party_to_job 0 dependents, wrapper has the one policy; direct is_party_to_job RPC 403 42501; wrapper false for non-party and Helpr->applicant, true for poster->applicant; sends poster->Helpr 201, Helpr->poster 201, non-party->poster 403, hired Helpr->applicant 403, poster->applicant 201, applicant reply->poster 201, messaged applicant->Helpr 403; is_party_to_job_folder Helpr/poster true, non-party false (4 proof-photos policies unchanged); idx_messages_sender_created backs the rate count. Cleanup read back 0 (4 messages, 4 notifications, 1 application). write-contract snapshot refreshed (7a2e92217): 0 rejects.
- [ ] OWNER QUESTION (lh-authz-rls review 2026-09-14): the offered-but-not-accepted Helpr (jobs.offered_to_helper_id) is still reachable, and so identifiable, by the hired Helpr and roster members. Should an offered Helpr be poster-only like applicants? UI follow-up: existing non-poster->applicant threads are now read-only for that sender; if the composer still shows, the user gets an unexplained RLS refusal.
- [ ] BUILT, APPLY + SCREENSHOT PENDING (2026-09-14): prod still has 0 group jobs, so group-job screens (GroupJobHelpers flat card, 70f93a220) are proven only on a local render. `scripts/audit/prod-seed.mjs` now has a `--group-job` flag (idempotent, also folded into `--apply`) that inserts one is_seed group job (status='open', 2 of 3 roster slots filled — accept_group_application only flips a job to 'accepted' on the LAST slot, so 'open' is the realistic state; the roster rows themselves carry status='accepted', the table's own default) owned by the shared poster, staffed by the shared helper-e2e account + applicant01, payment_status='unpaid' (deliberately, NOT 'escrow' — this script's own header says --apply never writes a money column, and seed_jobs_hidden_publicly() currently reads FALSE so an escrow is_seed job would be a live public-Browse listing; the poster's own /my-posts, the only surface this fixture needs, reads jobs unfiltered by payment_status). `e2e/a11y-prod/a11y-prod.spec.ts` resolves the poster's is_seed group job at run time (same pattern as jobByStatus) and sweeps `/my-posts?highlight=<id>` as `group-job-poster-card`, skipping visibly if the row doesn't exist yet. `src/test/prodSeedGroupJobFixture.test.ts` grades the payload against the live schema via schemaConstraints.ts (fixtureSchemaContract can't see it — scripts/ is outside its e2e/+src/test walk of fixture files, though the new file lives in src/test/ itself as the checker, not the checked); shown red first (budget bumped to 6000, a real jobs_budget_range violation) then green again. Apply: `node scripts/audit/prod-seed.mjs --group-job` (needs .env with SUPABASE_SERVICE_ROLE_KEY; run --apply first if applicant01 doesn't exist yet). Verify: `node scripts/audit/prod-seed.mjs --verify` (checks "group job (is_seed, is_group_job, 3 slots)" and "group job roster (2 of 3 slots, accepted)"). STILL OPEN: run the apply, then screenshot the poster card at 375 light/dark on prod and log it with recordReview.
- [ ] QUEUED (next prod slot): land + prove branch completion-race (2608b2585): before numbers via scripts/probes/completion-race.prod.mjs 20 cancel|approve|block, land, verify objects, after numbers, re-enable race-runner.yml and run it red (exclude_migrations=20260914215112) then green. Owner decision 2026-09-14: no cancel during a revision request (Done mark stays set).
- [ ] QUEUED (with completion-race proof): one cancelled prod job still carries helper_completed_at (old race). Confirm money reconciliation shows it refunded correctly; fix the ledger if not.
- [ ] QUEUED (next prod slot): apply the seeded group job (node scripts/audit/prod-seed.mjs --group-job), --verify, screenshot the poster group card at 375 light/dark.
- [x] DONE 2026-09-14 in the lifecycle-writes audit commit (edge only, outside dispute-races' create-payment hunks): `resolve_revision` is a conditional flip (`status = revision_requested AND revision_completed_at IS NULL`); a duplicate call re-reads and returns `alreadyResolved` with no second notification. Class guard red on the pre-fix excerpt (`src/test/raceClassGuard.test.ts`). Prod double-tap proof still owed — see the lifecycle-writes OPEN line above.
- [ ] QUEUED (prod slot, one probe run each): race proofs for fa107a92f fixes — auto-release vs dispute open; auto-resolve vs escalate and vs withdraw; gift-card redeem vs card payment on one unpaid job; request_revision double-tap; resolve_revision vs dispute + double-tap; cancel_escrow vs dispute open + double-tap; charge.dispute.created vs payout settling. Before numbers from the pre-fix behaviour are not recoverable now (already deployed) — record after numbers and prove each probe can fail on a local build with the predicate removed.
- [ ] LAST, after everything above: independent re-check by a different model (sonnet) of ALL work landed 2026-09-13 — full vitest once, CI green per push, re-run each fix's own proof on prod, list what doesn't hold
- [ ] OWNER: allow the Stripe connector write tool + reconnect Stripe, then add transfer.failed to live webhook and close #1462/#1521
