# lh-long-tail-features — lane report

Scope: pet profiles, Home History, Work Record, Helpr Wrapped, Helper analytics,
STR iCal sync, saved searches, referrals, job milestones, job revisions, group
jobs, skills/endorsements, reactions/pins/mutes, NPS, reports/blocks plumbing
(product view only — trust ownership is `lh-trust-safety`).

Live checked against prod `fncmgoasalhdgfwzhsqa` via MCP `execute_sql`
(read-only) and against a local dev server (`~/.lh-audit/lh-long-tail-features`,
`npm run dev -- --port 5188`) driven with Playwright, signed in as the seeded
test account `eli.test.helper@louisianahelpr.com` (id
`6bdc1f67-ae1f-46a0-8edf-4035629a6147`) via `scripts/test-signin-link.mjs`.
Chrome extension (claude-in-chrome) was not connected this session, so
rendering was driven directly with Playwright instead — screenshots saved to
`/tmp/lt-shots/*.png` (not committed; paths given per finding).

## Bucket 1 — Verified working

- **Six Profile-tab conversions (`?tab=pets|work_record|home_history|str_settings|wrapped|analytics`)
  render correctly, at 1440 and 375, with no console errors and zero
  horizontal overflow.** All six page components (`PetProfiles.tsx`,
  `WorkRecord.tsx`, `HomeHistory.tsx`, `StrSettings.tsx`, `HelprWrapped.tsx`,
  `HelperAnalytics.tsx`) now render the canonical tab body (`space-y-4` under
  `ProfileTabHeader`), not `AppPage`/`AppShell` — no double viewport lock, no
  duplicated chrome, single rail inset. Confirmed by direct source read plus
  live render: `scrollWidth === clientWidth` at both breakpoints for all six,
  screenshots at `/tmp/lt-shots/{pets,work_record,home_history,str_settings,
  wrapped,analytics}-1440.png` and `{pets,wrapped,str_settings}-375.png`.
  `TAB_TITLES` (`src/pages/profile/types.ts`) gives each a distinct
  `document.title` and matches its on-screen `<h1>`.
- **Helpr Wrapped's stat tiles are exactly correct against the ledger — the
  near-miss the orchestrator flagged (an undisclosed "~26 hrs" rate-derived
  tile) is already gone**, per an explicit code comment
  (`HelprWrapped.tsx:21-29`) recording why it was removed rather than
  disclosed. Cross-checked every rendered figure for the test account against
  live SQL:
  - Jobs posted **7** = `count(*) jobs where customer_id=... and created_at in 2026` → 7. ✓
  - Invested in community **$140** = `sum(budget) where customer_id=... and status='completed'` → 140.00. ✓
  - Neighbors helped **3** = `count(*) jobs where helper_id=... and status='completed'` → 3. ✓
  - Earned **$280** = `sumHelperTakeHomeDollars` over those 3 jobs: job1
    (budget 120, stamped fee 8% → 110.40) + job2 (budget 75, stamped fee 8% →
    69.00) + job3 (budget 110, no stamped fee, falls back to the account's
    live tier `elite` = 8% → 101.20) = 280.60, floored to $280 by
    `formatPriceFloor` (matches the tile). Verified fee-percent fallback
    against `profiles.subscription_tier='elite'` for this account. ✓
  - Top category **"Yard work"** = counting both posted (1) + completed-as-helper
    (2) yard_work jobs = 3, ahead of handyman (2) and cleaning (2). ✓
  - People worked with **1** = one unique counterparty across both posted and
    completed-as-helper jobs for the year. ✓
  - Reviews written **2**, reviews received **1** (post-embargo,
    non-cancelled-job filter applied) — both match SQL exactly. ✓
  Screenshot: `/tmp/lt-shots/wrapped-1440.png`.
- **Pet report-card removal (deleted today) is clean on the client.** No
  "Pets cared for · N reports" badge or any other reference survives on the
  public profile (`/user/<id>`, rendered live, screenshot
  `/tmp/lt-shots/userprofile-1440.png`); no `report_card`/`ReportCard` string
  remains outside one harmless historical comment
  (`src/pages/petProfiles/PetForm.tsx:613`). `job_pets` / `care_relationships`
  / `get_job_pets` remain live and reachable (pet-care sheet on job detail,
  pet picker on post-a-job) — pet profiles themselves were correctly left
  alone by the removal.
- **Referrals** (`/profile?tab=referral`) render live with real copy and a
  working share/redeem explanation; `referral_codes`, `referrals`,
  `referral_credits`, `process_referral`, `enforce_referral_cap`,
  `record_referral_signup`, `enforce_referral_credit_eligibility`,
  `check_referral_bonus` all exist live in prod. Screenshot
  `/tmp/lt-shots/referral-1440.png`.
- **Saved searches** are reachable from the Browse toolbar
  (`BrowseTasksToolbar.tsx` → `SavedSearches.tsx`), and `saved_searches`,
  `enforce_saved_search_limit`, `notify_saved_searches_on_new_job` all exist
  live. Source shows the radius-match and free-text-query bugs this feature
  used to have are already fixed (haversine radius match, a `query` column
  that used to not exist) — read but not independently re-driven this pass
  (see Bucket 3).
- **Job revisions** are live end to end, just under different names than the
  brief gave: `job_revisions` (table) + `track_revision_scope_creep()`
  (trigger on `jobs`, fires on transition into `revision_requested`, flags
  `fraud_flags` + notifies both parties at 3+ revisions) both exist and are
  referenced from `HelperRevisionCard.tsx` / `ActiveJobSection.tsx` /
  `CompletionChoiceSheet.tsx`. A deadline mechanism exists as
  `jobs.revision_deadline` / `revision_acceptance_deadline`, written by
  `create-payment` and enforced by `auto-release-payment` — not the
  `set_revision_deadline()` RPC named in the brief (see LTF-002; that name
  does not exist).
- **Group jobs are correctly, deliberately withdrawn — not a defect.**
  `GROUP_JOBS_ENABLED = false` (`src/lib/groupJobs.ts:79`) hides the "Group"
  toggle entirely in `LogisticsSection.tsx` (no dead affordance offered to
  users), and server-side the `reject_new_group_jobs` trigger raises a clean,
  human error (`'Group jobs are temporarily unavailable...'`) on any real
  end-user attempt to set `is_group_job=true`, while leaving service-role/cron
  paths unaffected. `groupJobs.ts`'s own doc-comment records a prior audit
  finding five real defects in the roster model (can't message, can't
  confirm/arrive/complete, vanishes from Activity, at most one review per job,
  dispute payout stranded shares) — three are marked FIXED, two ((b) messaging
  authorization on `helper_id`, (d) one-review-per-job) are marked NOT FIXED,
  which is why the feature is withdrawn rather than reworked. Confirmed live:
  zero `is_group_job=true` non-terminal jobs and zero `group_job_helpers` rows
  in prod — no stranded rosters are exposed to the two NOT-FIXED gaps today.
  `group_job_helpers`, `accept_group_application` (named in the brief) does
  NOT exist as a function any more; `enforce_group_roster_award_gate` and
  `freeze_group_roster_identity` do exist (leftover guards on the withdrawn
  feature, harmless while `GROUP_JOBS_ENABLED` is false).

## Bucket 2 — Defects (filed to the bus)

- **LTF-001 (HIGH)** — STR iCal sync's "Auto-creates cleaning jobs" toggle
  (`/profile?tab=str_settings`) promises a job will be posted at guest
  checkout, but `str-ical-sync` creates it `payment_status: 'unpaid'`. Every
  browse surface requires a funded status, so the job is invisible to every
  helper, and there is no client path to fund an already-created job — the
  host sees it in their own list and has no reason to think anything is
  wrong. The edge function's own comment already names this as a "KNOWN
  PRODUCT GAP" needing an owner decision (prompt-to-fund vs. don't
  auto-create); `ConnectionCard.tsx` discloses none of this to the host who
  is deciding whether to flip the toggle. Currently 0 such jobs exist in prod
  (the auto-create path hasn't fired live yet), so nothing is stranded today
  — but the toggle is live and reachable, and the first host who uses it will
  hit this. Not fixed this pass: this is a product decision (fund-prompt vs.
  withdraw, same shape as the group-jobs call above), not a code bug with one
  right answer, and it touches money (job funding) — flagging for owner
  review per the "queue money/data-model decisions" constraint rather than
  picking a fix myself.
- **LTF-002 (LOW, scope correction)** — `job_milestones`, `auto_approve_milestone`,
  `job_scope_items`, `set_revision_deadline` (all named in this lane's brief)
  do not exist in prod. Filed so a later pass doesn't re-derive the same lead
  from the brief — see PROTOCOL.md's own retracted SI-001 for why this
  matters. Revision deadlines are real, just implemented as `jobs` columns +
  a cron rather than an RPC (see Bucket 1).
- **LTF-003 (LOW)** — `pet_report_cards` is an orphaned table: exists live in
  prod, zero references anywhere in `src/` outside generated types, after
  today's report-card feature removal. Outside this lane's territory to drop
  — relayed to `lh-schema-integrity` via `team-lead`.

## UNVERIFIED — could not reach, or ran out of budget (bucket 3)

- **Home History and Work Record** were rendered and read correctly (real
  job-history rows, correct total/rating, PDF/share/print controls present —
  screenshots `/tmp/lt-shots/{home_history,work_record}-1440.png`), but I did
  not drive their "Share Record (PDF)" / "Print" buttons or independently
  verify every row in `home_maintenance_reminders` / `helper_w9_records`
  against SQL the way I did for Wrapped. Reason: budget — Wrapped was
  explicitly flagged by the orchestrator as the highest-risk (public,
  screenshotted) surface and got the deep pass; these two got a render +
  read-the-source pass only.
- **Helper analytics** (`/profile?tab=analytics`) rendered live with real
  content ("Not enough history..." gating copy, which is itself correct
  behavior for a low-volume test account) but I did not create enough seeded
  job history to drive the account past the analytics-unlock thresholds and
  see the filled-in charts, nor did I independently verify
  `helper_has_advanced_analytics` / `get_helper_tiers` /
  `get_platform_benchmarks` gate correctly for a non-Pro account. Reason:
  would require seeding ~20 more prod jobs against the test account, which I
  judged out of proportion to this pass's budget; flagging so a future pass
  (or `lh-subscriptions-credits`, which owns the Pro-gate boundary) can pick
  it up.
- **Saved searches**: reachability, the DB objects, and the fixed-bug history
  were all confirmed by source + live schema, but I did not actually create a
  saved search, trigger `notify_saved_searches_on_new_job` with a real
  matching job post, or verify `enforce_saved_search_limit` actually blocks a
  same-account 6th saved search. Reason: budget; this is a mutating,
  multi-step flow (create job matching criteria, wait for/trigger the
  notification trigger) that didn't fit in the time remaining.
- **STR iCal sync's parser and SSRF gate** (`safeFetch.ts`, `parseIcal`,
  malformed-feed handling, duplicate-posting-under-load) were read but not
  driven with a real external iCal feed — I did not stand up a test calendar
  connection and fire a manual "Sync now" against a real or malformed feed.
  This is exactly what the orchestrator asked me to scrutinize
  ("malformed feeds, duplicate posting and volume spikes") and I could not
  reach it within budget; co-owned with `lh-scheduling-time`, flagged to
  `team-lead` for a follow-up pass with more time.
- **Skills & endorsements** (`helper_skills`, `skill_endorsements`,
  `endorse_skill`), **reactions/pins/mutes/archives**
  (`message_reactions`, `thread_pins`, `thread_mutes`, `thread_archives`),
  and **NPS** (`nps_responses`) were not reached at all this pass — ran out
  of budget after the STR/Wrapped/group-jobs/revisions work above, which the
  orchestrator's message weighted as the highest-risk items (fresh
  conversions, shareable artifact, money-adjacent). Genuinely unaudited; not
  claimed clean.
- **Reports/blocks plumbing** (`reports`, `user_blocks`, `are_users_blocked`)
  — explicitly noted by the orchestrator as owned by `lh-trust-safety` for
  product view; not audited here by design, not by omission.

## What I fixed

**Nothing was fixed this pass.** The one defect found (LTF-001) is a money-
adjacent product decision, not a code bug with a single correct fix, and is
queued for owner review rather than picked unilaterally. LTF-002/003 are
scope corrections and a cross-lane relay, not code changes. No `permissionMode:
plan` release was requested or needed since no fix was proposed against
`src/`/`supabase/`.

## Coverage manifest

| Surface | Method | Result |
|---|---|---|
| `/profile?tab=pets` | render 1440+375, source read | checked-clean |
| `/profile?tab=work_record` | render 1440, source read | checked-clean |
| `/profile?tab=home_history` | render 1440, source read | checked-clean |
| `/profile?tab=str_settings` | render 1440+375, source read | checked-clean (shell); LTF-001 found in the feature |
| `/profile?tab=wrapped` | render 1440+375, source read, SQL cross-check every figure | checked-clean |
| `/profile?tab=analytics` | render 1440, source read | UNVERIFIED (gated states) |
| `/user/<id>` public profile | render 1440, pet-badge removal check | checked-clean |
| `/profile?tab=referral` | render 1440, SQL object check | checked-clean |
| Saved searches (Browse toolbar) | source read, SQL object check | UNVERIFIED (not driven) |
| Job revisions | source read, SQL object check | checked-clean |
| Job milestones | SQL object check | does not exist — LTF-002 |
| Group jobs | source read, SQL object + row check | checked-clean (withdrawn) |
| STR iCal sync (`str-ical-sync`) | source read, SQL object + row check | LTF-001 filed; parser/SSRF UNVERIFIED |
| Skills & endorsements | — | UNVERIFIED (not reached) |
| Reactions/pins/mutes/archives | — | UNVERIFIED (not reached) |
| NPS | — | UNVERIFIED (not reached) |
| Reports/blocks plumbing | — | out of scope (owned by lh-trust-safety) |

## Out-of-scope conclusions (§6)

- Reports/blocks plumbing product view: correctly deferred to `lh-trust-safety`
  per the orchestrator's own scoping — not audited here.
- Pet evacuation (`evacuation_pets`): correctly excluded per PROTOCOL §6d
  removed-features list — not audited as product.
