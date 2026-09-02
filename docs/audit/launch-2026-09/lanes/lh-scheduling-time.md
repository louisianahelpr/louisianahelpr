# lh-scheduling-time — lane report

**Worktree:** `~/.lh-audit/scheduling` @ `b170609a` (detached off `origin/main`)
**Live target for every reproduction:** prod `fncmgoasalhdgfwzhsqa` (read-only, `execute_sql`)
**Findings filed:** 11 (2 HIGH, 8 MEDIUM, 1 LOW) — ST-001 … ST-011
**Fixed this pass:** 0. See "What I fixed" below — the reason is stated, not implied.

---

## ST-001 — the poster is charged a harsher cancellation tier than the one they were shown, on almost every job

`public.job_hours_until_start(date, timestamptz)` decides which cancellation tier
applies. It computes `(p_date_needed::timestamp AT TIME ZONE 'America/Chicago') - p_at`
— **midnight of the job's day. It never adds `start_time`.** The TypeScript twin,
`hoursUntilJob()` in `supabase/functions/_shared/cancellationFee.ts`, does exactly the
same thing, and `CancellationDialog.tsx:98` computes the estimate the poster sees from
that same midnight anchor.

**That agreement is why this survived every previous audit.** The two things a
developer would naturally diff — the client estimate and the server charge — match
perfectly. The only thing either of them disagrees with is the sentence the user is
reading three lines further down the same dialog: *"24+ hours before: 0% (free)"*
(`:301-303`) and *"Free cancellation — more than 24 hours until the job starts"*
(`:338`).

Because `start_time` is always `>= 00:00`, the computed hours are always **shorter**
than the real time to start, so the tier is always **harsher**, and the error is never
once in the poster's favour. Reproduced against the live functions on prod:

| Scenario | Real hours to start | `job_hours_until_start` | Charged | Policy says |
|---|---|---|---|---|
| Job today 18:00, cancel today 10:00 CT | 8.00 | −10.00 | **50%** | 25% |
| Job tomorrow 08:00, cancel today 23:00 CT | 9.00 | 1.00 | **50%** | 25% |
| Job tomorrow 18:00, cancel today 01:00 CT | 41.00 | 23.00 | **25%** | **0% — free** |

The third row is the one to look at: a job **41 hours away**, which the disclosed
policy calls free, is charged 25% of budget. **61 of 64 live jobs carry a
`start_time`**, up to 18:00, so this is not an edge case — it is the normal path.

This is money charged that does not match money disclosed, which makes it a trust and
chargeback question as much as a correctness one. It is filed HIGH and left unfixed
deliberately: the fix changes what real people are billed and belongs to the owner.

---

## What I fixed

**Nothing, and that is not "ran out of time."** Every one of the eleven findings falls
into a category my standing constraints reserve for the owner or another lane:

| Finding | Why I did not fix it |
|---|---|
| ST-001 | Money. Changes what a poster is charged on cancellation. Owner review. |
| ST-002, ST-008 | Needs a CHECK constraint → a migration → data-model change. Queued. **ST-002 additionally needs a data repair first — see below.** |
| ST-003 | Fix is a new transactional RPC → migration. Queued. |
| ST-004, ST-006 | Product decisions, explicitly — both options costed below. Only the owner can pick. |
| ST-005 | Fix changes which timezone the whole client resolves job starts in — touches shared `src/lib/dateUtils.ts` used by other lanes' surfaces. Needs coordination. |
| ST-007, ST-009, ST-010, ST-011 | All live in `SECURITY DEFINER` database functions → migrations. Queued. |

I remained in `permissionMode: plan` for the whole sweep and was not released to a
fix phase. No plan was submitted because none of the above is a low-risk in-lane edit.

### ST-002 — can the CHECK actually be added? (asked by the orchestrator)

**No, not on its own — a bare `ADD CONSTRAINT` would fail on live data:** `select count(*) filter (where start_time >= end_time) from public.helper_availability` returns 1 of 14 rows. Measured on
prod, so the migration can be written without guessing:

| Check | Result |
|---|---|
| `helper_availability` rows | 14 |
| Violate `start_time < end_time` | **1** — id `036f02c0-0d5e-438c-9277-d36e686e16b6`, day 0, `21:00:00 → 17:00:00`, `is_available = true` |
| Duplicate `(helper_id, day_of_week, specific_date)` groups | 0 — so a UNIQUE **would** apply cleanly today |
| `day_of_week` outside 0..6 | 0 |
| NULL `start_time` / `end_time` | 0 |
| Rows with `specific_date` set | 0 — the date-override path is entirely unexercised |

Recommended order, one replay-safe migration: **(1)** repair the single row — swapping
to `17:00 → 21:00` is the only repair that preserves both endpoints the user actually
chose, where resetting to the `09:00–17:00` default silently discards them and setting
`is_available = false` silently removes a day; **(2)** `ADD CONSTRAINT … CHECK
(start_time < end_time) NOT VALID` then `VALIDATE`, so a future violation surfaces
rather than aborting; **(3)** optionally the UNIQUE, which would make the "7 rows per
helper" invariant real — it is currently unenforced, and the delete-then-insert in
ST-003 is exactly what used to duplicate rows.

**The row belongs to the owner's own account**, so whether `17:00 → 21:00` is what he
meant is his call, not a lane's.

---

## Coverage manifest — what I actually opened

**Live database objects read via `pg_get_functiondef` / `pg_get_viewdef` on prod:**
`job_hours_until_start` · `job_expires_at_for_schedule` · `cancellation_fee_percent` ·
`is_late_cancellation` · `enforce_job_expiry_floor` · `stamp_recurring_series_helper` ·
`instant_book_claim` · `poster_cancel_job` · `helper_cancel_booking` ·
`apply_cancellation_violation_consequence` · `auto_start_due_jobs` ·
`sweep_job_start_reminders` · `sweep_dayof_confirm_reminders` ·
`expire_pending_direct_offers` · `expire_unanswered_offers` ·
`notify_saved_searches_on_new_job` · `open_jobs_browse` (view) ·
all 31 non-internal triggers on `public.jobs` · `cron.job` (44 rows) ·
`cron.job_run_details` · `public.cron_run_log` · `net._http_response`

**Tables inspected (columns, defaults, constraints, indexes):**
`jobs` · `helper_availability` · `job_checkins` · `job_tracking` ·
`recurring_visit_releases` · `saved_searches` · `str_calendar_connections` ·
`str_processed_events` · `profile_views`

**Repo files read:**
`src/lib/jobDate.ts` · `src/lib/dateUtils.ts` · `src/lib/recurringSchedule.ts` ·
`supabase/functions/_shared/cancellationFee.ts` ·
`supabase/functions/_shared/recurringSchedule.ts` ·
`supabase/functions/charge-recurring-visits/index.ts` ·
`supabase/functions/str-ical-sync/index.ts` + `dates.ts` ·
`supabase/functions/auto-expire-jobs/index.ts` ·
`src/components/CancellationDialog.tsx` · `src/components/HelperAvailability.tsx` ·
`src/components/HelperAvailabilityDisplay.tsx` · `src/components/TimeRangeField.tsx` ·
`src/components/profile/ScheduleTab.tsx` · `src/hooks/useDashboardFilters.ts` ·
`src/hooks/useDashboardData.ts` · `src/pages/dashboard/dashboardTypes.ts` ·
`src/components/activity/postedJobCard/PostedJobActions.tsx`

**Scripts I ran (artifacts):** `scratchpad/dst.mjs` (10 dates × DST),
`scratchpad/tzshift.mjs` (3 TZ values), an inline `tsx` run of the real
`recurringVisitDates` across both 2026 transitions and the year boundary.

### Scope items that DO NOT EXIST in prod

My brief named these; they are not there. This is worth recording because the brief
itself is a lead, not a fact:

- `job_milestones` — `to_regclass` NULL
- `helper_late_cancellations` — `to_regclass` NULL
- `is_late_cancellation(uuid)` — the real signature is `(boolean, numeric)`
- `job_hours_until_start(date, time)` — the real signature is `(date, timestamptz)`
- `instant_book_claim(uuid, uuid)` — the real signature is `(uuid)`
- `str_ical_feeds` / `str_properties` — the real tables are
  `str_calendar_connections` and `str_processed_events`

---

## Verified working — with the artifact

1. **Every scheduling instant is stored as `timestamptz`.** Zero
   `timestamp without time zone` columns across `jobs`, `helper_availability`,
   `job_checkins`, `job_tracking`, `recurring_visit_releases`, `saved_searches`.
   The `date` / `time` columns that remain (`date_needed`, `start_time`,
   `visit_date`, availability `start_time`/`end_time`) are genuinely date-only or
   wall-clock-only. Repo-wide the only naive columns are
   `profile_views.viewed_at` / `hour_bucket` — relayed, not mine.
   *Artifact:* `information_schema.columns` scan, `data_type='timestamp without time zone'`
   → 2 rows, both in `profile_views`.

2. **DST is correct on the server** — `select public.job_expires_at_for_schedule('2026-01-15','09:00')` returned `2026-01-15 15:00:00+00` (CST) and the same call for `'2026-07-15'` returned `2026-07-15 14:00:00+00` (CDT), 6 rows total. The offset is
   derived, not hardcoded. Non-existent local times (02:30 on spring-forward) and
   ambiguous ones (01:30 on fall-back) both resolve deterministically without error.
   *Artifact:* prod `fncmgoasalhdgfwzhsqa`, 6-case `job_expires_at_for_schedule`
   comparison returning `expires_at_utc` and its `AT TIME ZONE` read-back —
   `2026-01-15 15:00:00+00` vs `2026-07-15 14:00:00+00` for the same `09:00`.

3. **DST is correct on the client** — `$ node scratchpad/dst.mjs` printed `non-midnight results: 0` over 10 rows. `jobLocalMidnightMs` resolved true local
   midnight on **10/10** dates spanning both 2026 transitions, both 2027 transitions
   and ordinary winter/summer days. The 23-hour day (03-08→03-09) and the 25-hour day
   (11-01→11-02) come out as exactly 23h and 25h, and `daysPastDue`'s `Math.round`
   turns both into 1 day, which is what the comment claims and what a user expects.
   *Artifact:* `scratchpad/dst.mjs` output — 10 dates, `non-midnight results: 0`,
   deltas `2026-03-08→03-09 = 23h`, `2026-11-01→11-02 = 25h`.

4. **Recurring series do not skip, duplicate or drift across DST.** The real
   `recurringVisitDates` produced 12 dates for a Mon/Wed/Fri 4-week series spanning
   spring-forward and 12 for one spanning fall-back — correct weekdays, zero
   duplicates, zero drift — plus clean results for a Sunday series starting *on*
   each transition day and a Monday series crossing into 2027. This is by
   construction: every operation is `setUTCDate` at UTC noon, so local time is never
   consulted.

5. **All six scheduled sweeps in my scope are alive and doing work, not just firing** — `select jobid, status, count(*) from cron.job_run_details where jobid in (16,42,45,29,44,57) group by 1,2` returned only `succeeded` rows. `auto-start-due-jobs`, `sweep-job-start-reminders`,
   `sweep-dayof-confirm-reminders`, `auto-expire-jobs`, `charge-recurring-visits`,
   `str-ical-sync`: 0 failures in `cron.job_run_details` over 3 days, and
   `cron_run_log` carries real `200` responses with `ok:true, defects:0` bodies —
   `auto-expire-jobs` literally reports *"expired 0 unanswered offers, expired 0
   direct offers"*, which is execution evidence, not a queued `http_post`.
   *Artifact:* prod `cron.job_run_details` grouped by jobid/status for jobids
   16/29/42/44/45/57 — every row `status='succeeded'`, no `failed` row; and
   `public.cron_run_log` for the same window — `auto-expire-jobs` 67×`200`,
   `charge-recurring-visits` 3×`200`, `str-ical-sync` 8×`200`, all `ok:true`.

6. **`instant_book_claim` has the right shape for the single-slot race.** Authenticates
   first (an explicit `NULL` check, because a NULL `auth.uid()` used to walk past the
   poster guard), takes `SELECT … FOR UPDATE` on the job row, then re-checks
   `status <> 'open'` and `helper_id IS NOT NULL` after the lock. Also refuses a
   poster claiming their own job and a non-target claiming a live direct offer.
   **Not driven under real concurrency — see UNVERIFIED.**

7. **`expire_unanswered_offers` is correctly concurrent.** Scans without a lock, then
   locks each candidate individually with `FOR UPDATE SKIP LOCKED` and re-checks
   every predicate after the lock — so one slow row cannot block an unrelated helper
   confirming, and a helper who confirms mid-sweep is not expired out from under.

8. **The seeded helper's availability is intact.** All 7
   `helper_availability` rows on `eli.test.helper@louisianahelpr.com` are
   `is_available = true`, 09:00–17:00. My brief's warning that a previous sweep had
   flipped them false is **stale**.

---

## The two product decisions, with the cost of each

The owner decides these; framing them so the decision is one read, not a
re-investigation.

### ST-004 — `helper_availability` is promised but never enforced

`HelperAvailabilityDisplay.tsx:62` tells the helper *"Posters match jobs to your
weekly hours."* Nothing on the booking path consults the table: the only prod function
referencing it is `purge_user_data`, none of the 31 triggers on `public.jobs` checks a
schedule, and `instant_book_claim` has no availability term. The single real consumer
is an opt-in filter on the helper's **own** browse feed.

| Option | What it costs | What it buys |
|---|---|---|
| **A. Change the copy** (e.g. "Helprs use this to filter the jobs they see") | One string. Zero risk. Ships today. | Honest immediately. But the feature stays decorative, and a helper still gets instant-booked at 6am on a day they marked off. |
| **B. Enforce it** — check availability in `instant_book_claim` and the accept path | A migration touching a `SECURITY DEFINER` money-adjacent RPC, plus a product answer to "what happens when a poster wants a helper outside their hours — hard block, or warn-and-allow?" Hard-blocking shrinks liquidity in a marketplace that needs it. | The promise becomes true, and double-booking becomes structurally harder. |

**My recommendation: A now, B later.** The copy is making a specific factual claim
that is false today, and that is fixable in one line without a migration. B is a real
feature with a real liquidity trade-off and should not be smuggled in under a bug fix.

### ST-006 — STR auto-created jobs are unfunded and therefore invisible

`str-ical-sync` inserts jobs with no `payment_status`, which defaults to `'unpaid'`.
All three browse surfaces gate on `payment_status IN ('escrow','payout_pending','released')` — `select pg_get_viewdef('public.open_jobs_browse') ilike '%payment_status%'` and the same probe over `get_ranked_open_jobs` / `get_open_jobs_for_map` all returned true, 3 rows — so no helper can see them, while the host can, and
the sync reports success. There is no UI path to fund one afterwards.

| Option | What it costs | What it buys |
|---|---|---|
| **A. Stop auto-creating** — sync the calendar, notify the host, let them post normally | Small. The feature becomes "your turnovers, one tap to post" instead of "posts for you". | Nothing is ever silently broken. The host keeps consent over every charge. |
| **B. Funding prompt** — create as a draft, notify the host to fund it | A draft state the browse surfaces already exclude, plus a fund-an-existing-job path that does not exist today (`stripe-webhook`'s `repay` branch has no caller in `src/`). | Keeps the automation while keeping consent. |
| **C. Charge the host unattended** | Needs a stored card and explicit up-front consent this feature never collected. | Fully automatic — and the highest-risk of the three. |

**My recommendation: A for launch, B after.** Prod has **0** STR connections, so
nothing is lost by shipping the honest version first; C should not be considered
without a separate consent flow.

---

## Retracted before filing — two false leads, and how they were disproved

Kept in the report deliberately. Both are true-but-misleading observations of exactly
the shape that becomes a false blocker.

1. **"`expire_pending_direct_offers` and `expire_unanswered_offers` are not
   scheduled."** True that neither appears in any `cron.job` row — and wrong. Both are
   invoked hourly via `supabase.rpc(...)` from
   `supabase/functions/auto-expire-jobs/index.ts:209,230`, and that edge function is
   cron jobid 16, `0 * * * *`, active.
   *Disproof:* prod `cron_run_log` body for `auto-expire-jobs`, verbatim —
   `{"fn":"auto-expire-jobs","ok":true,"defects":0,"message":"Expired 0 accepted jobs, cancelled 0 past-time open jobs, expired 0 unanswered offers, expired 0 direct offers"}`.
   A function's absence from `cron.job` proves nothing; an edge function can hold the
   schedule on its behalf.

2. **"A previous sweep flipped the seeded helper's 7 `helper_availability` rows to
   `false`."** This warning is repeated in my own dispatch brief. It is **stale**: all
   7 rows on `eli.test.helper@louisianahelpr.com` are `is_available = true`,
   09:00–17:00.
   *Disproof:* a single join of `helper_availability` to `profiles` on `user_id`
   (not `id`), output captured. My briefs are written from prior sweeps' notes, which
   are an upper bound on what is still true.

---

## Assessed and deliberately NOT filed

Recording these so a future pass does not re-derive them.

- **`charge-recurring-visits` uses `todayUtc()` (`new Date().toISOString().slice(0,10)`),
  which `dateUtils.ts` explicitly warns against.** It is nonetheless safe *as
  scheduled*: the cron fires at 06:06 UTC, which is 00:06 CST / 01:06 CDT, so the UTC
  date and the Central date agree at the only moment it runs. An off-schedule manual
  run after ~18:00 CT would shift the window a day, but the `existing` pre-flight read
  absorbs it (a visit funded a day early is then skipped, not double-charged). Latent
  fragility, not a defect. If the cron time ever moves, this becomes one.

- **`parseIcalDate` discards any `TZID` parameter and takes only `YYYYMMDD`.**
  Correct for the `VALUE=DATE` DTEND that Airbnb and VRBO actually emit. A robustness
  gap for a hand-rolled feed, not a live defect, and prod has zero feeds.

- **Non-overlapping same-day bookings are not a double-booking bug.** One helper holds
  3 accepted jobs on 2026-08-28 at 07:00 / 08:00 / 09:30 — but they are seed rows
  (`5eed0828-…`), `estimated_hours` is NULL on all three, and the times do not
  overlap. I did **not** file this as a double-booking; the real gap is ST-004
  (nothing consults availability at all).

- **Spring-forward 02:30 collides with 03:30 in `job_expires_at_for_schedule`.** Both
  yield `08:30Z`. There is no correct answer for a wall-clock time that does not
  exist, this is standard Postgres behaviour, and it affects only a listing expiry on
  one night a year. Not a finding.

---

## UNVERIFIED — could not reach, and why

1. **`instant_book_claim` under genuine simultaneity.** My mandate requires two
   *simultaneous* claims and a resulting row count, not sequential calls. Firing that
   race requires WRITING to prod — a test job plus two authenticated test-helper
   sessions. My standing constraints authorize prod **reads** only. I requested
   authorization from the orchestrator (`SendMessage`, mid-sweep) offering three
   options and did not receive a ruling before finishing. The lock-and-recheck
   structure is correct (see Verified #6) but per PROTOCOL that is a lead, not a fact,
   so I am **not** marking it clean.
   **Resolved as ownership, 2026-09-02:** the orchestrator assigned this proof to
   **`lh-concurrency-cache`**, on the reasoning that two lanes writing competing test
   jobs to prod to exercise the same lock produces a result neither can trust. It stays
   UNVERIFIED *here* and is tracked there. If that lane does not reach it, this line is
   the reason it is unverified — not an oversight.

2. **The STR iCal path end to end.** Prod has **0** rows in
   `str_calendar_connections` and **0** jobs with `is_auto_created = true`. There is
   no feed to sync, so ST-006 and ST-007 are established from the deployed code plus
   the prod schema, and their *consequences* are latent rather than observed. A
   hostile/huge feed test would require creating a connection (a prod write).

3. **`charge-recurring-visits` against real data.** Its last 3 runs report
   `seriesScanned: 0, seriesTotal: 0` — there is no live recurring series in prod, so
   the charge, the mid-series helper departure, and the mid-series charge failure are
   all unexercised. The date *generation* is separately proven (Verified #4).

4. **Whether the 5 missing `auto-expire-jobs` response rows are failed runs or lost
   logs.** `cron.job_run_details` shows 72 succeeded runs in 3 days; `cron_run_log`
   holds 67 responses; the gap hours are 2026-09-01 08:00 and 2026-09-02 04:00 /
   08:00 / 13:00 / 21:00. `net._http_response` is empty for all of those windows
   (pg_net prunes aggressively), so I **cannot** distinguish a failed invocation from
   a response pruned before the logger copied it. Handed to `lh-cron-jobs` as a lead
   via the orchestrator. It matters here because `auto-expire-jobs` is what expires
   direct and unanswered offers.

5. **No visual/interactive pass.** I did not drive Chrome or the iOS simulator. My
   lane's defects are all in database functions, edge functions and pure date logic,
   and every one is reproduced against live prod or by executing the real source
   module. The `?tab=availability` and `?tab=schedule` screens were read, not
   rendered — `lh-route-walker` and `lh-visual-critic` own their pixels.

---

## Out-of-scope conclusions (PROTOCOL §6)

- **Offline-first sync / conflict resolution for the schedule.** Not applicable —
  there is no offline store. The real analogue, React Query cache staleness on the
  dashboard availability context, is `lh-concurrency-cache`'s.
- **Full i18n.** Out of scope by §6. Timezone and locale *formatting* were in scope
  and are covered above.
- **Realm/CoreData calendar migrations.** No local database exists.

---

## Cross-lane leads relayed to the orchestrator

- **`lh-schema-integrity`** — `profile_views.viewed_at` and `hour_bucket` are
  `timestamp without time zone` defaulting to `LOCALTIMESTAMP`; the only naive
  real-world-time columns in the database (73 rows).
- **`lh-cron-jobs`** — the `auto-expire-jobs` 72-vs-67 gap above.
- **`lh-money-escrow`** — ST-001 is a money finding; the fee charged does not match
  the disclosed ladder, and the error is always against the poster.
- **`lh-notifications`** — ST-009 (posters not told their offer expired) and ST-011
  (digest matches silently throttled away).
- **`lh-concurrency-cache`** — ST-007 (STR job-before-guard ordering) and the
  outstanding `instant_book_claim` race proof.
