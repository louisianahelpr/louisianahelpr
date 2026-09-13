# Time inventory: every behaviour that changes because the clock moved

Built 2026-09-12 from source (`src/`, `supabase/functions/`, `supabase/migrations/`) and the live
`cron.job` table (read-only). Louisiana is `America/Chicago`. DST in the window this app lives in:
**2026-11-01** (02:00 CDT → 01:00 CST) and **2027-03-14** (02:00 CST → 03:00 CDT).

What proves each row is shown in the last column:
- **TT** is the prod time-travel spec, `e2e/journeys/time-travel.spec.ts`. It runs the deployed app
  against the real backend with the browser clock moved.
- **PG** is the PGlite probe, `scripts/probes/offer-expiry.probe.mjs`.
- **UT** is an existing vitest suite.
- **—** means nothing moves the clock for this row yet. That makes it a gap, and gaps are listed in `docs/OPEN.md`.

The server's clock cannot be moved against prod. Server boundaries are therefore tested where the
logic runs: SQL in PGlite, and edge-function cutoffs in unit tests.

## 1. The one definition of "when"

| Concern | Source of truth | Zone rule | Proof |
|---|---|---|---|
| A job's day (`date_needed`, bare DATE) | `src/lib/jobDate.ts` `jobDateMs`/`todayMs`/`isPastDue`/`daysPastDue` | midnight in CT | UT `jobDate.test.ts` |
| A job's start instant (`date_needed`+`start_time`) | `_shared/cancellationFee.ts` `jobLocalStartMs` → `dateUtils.jobStartDateTime` | CT wall clock, DST-correct since 790004248 | UT; TT (DST mornings) |
| Listing expiry (`jobs.expires_at`) | `src/lib/jobExpiry.ts` `computeJobExpiresAt`; trigger `enforce_job_expiry_floor` + `job_expires_at_for_schedule` (20260831201631) | CT start, floored at now+1h; 23:59:59 CT when no start | UT; TT stores + reads it |
| Confirm window | `_shared/confirmDeadline.ts` (opens 00:00 CT the day before, closes 12 real hours later) | CT; on fall-back Sunday the close reads 11:00 AM CST | UT `confirmDeadline.boundary.test.ts`, `auto-expire-jobs-confirm-window.test.ts` |
| Escrow timing | `_shared/escrowTiming.ts` `AUTO_COMPLETE_HOURS`=24, `PAYOUT_HOLD_HOURS`=24 | absolute hours | UT parity tests |
| Offer window | `src/lib/offerResponseWindow.ts` (1–48h) → `jobs.response_deadline` / `direct_offer_expires_at` | absolute | PG |

## 2. Client: what a user reads change with time

| Screen / component | Time behaviour | Boundaries | Proof |
|---|---|---|---|
| `JobCardMetaRow` expiry chip (Browse, My Posts, My Jobs) | `formatTimeLeft` floored: "N days/hours/minutes left" → "Expired" at `expires_at` | 21h before; 1 min before; at start; next day; from PT; both DST mornings | **TT**, all passing on prod |
| `JobCardMetaRow` start time | wall-clock string, zone-free (`2000-01-01T..`) | — | read |
| `activityFilters` buckets | overdue (`isPastDue`, CT day) → Needs You, sorted first | CT midnight | UT; TT screenshot 04 (moves out of Waiting) |
| `JobCountdown` "Job starts in" | ticks each minute, CT start; "Job time has arrived!" | — | — (needs a hired job) |
| `JobConfirmation` | "Confirmation opens in", "Confirm by … (Nh left)", button shows from the window's opening | CT, `confirmOpensMs` | UT; TT **UNCOVERED** (needs an accepted job) |
| `OfferedActions` | `response_deadline` / `direct_offer_expires_at` countdown → "Response deadline expired"; derived 24h fallback | — | TT **UNCOVERED** |
| `SubmittedStep` (helper) | 24h auto-complete countdown from `helper_completed_at` → "24 hours passed — completing automatically…" | — | TT **UNCOVERED** |
| `PostedJobCard` revision | `revision_acceptance_deadline`, `revision_deadline` countdowns | — | — |
| `DisputedStep` / `DisputedSection` | `dispute_deadline` countdown (hidden when escalated) | — | — |
| `DeadlineCountdown` shared | < 12h turns urgent; `≤0` shows expired copy | — | read |
| `AvailabilityTab` | "Ready until 5:00 PM — your hours for today" → "Today's hours ended at 5:00 PM"; weekday + minutes read in CT; "Until h:mm" in CT | 16:59 / 17:00 CT; from PT; both DST Sundays | **TT**, all passing on prod |
| `SubscriptionTab` / `subscriptionTiers.tierFeePercent` | `subscription_expires_at < now` → free plan and free fee rate; "Renews <date>" | — | TT **UNCOVERED** (no paid E2E account) |
| `earlyAccess` / browse embargo | `created_at <= now() - 20 min` for free tier (server) | — | — |
| `CancellationDialog` fee ladder | hours until CT start → tier | DST mornings | UT `cancellationFee.parity.test.ts` |
| `isScheduleInThePast` (Post a Job) | refuses a CT start already past | UT | UT `jobExpiry.test.ts` |
| `useDashboardFilters` stale posts | lexicographic `YYYY-MM-DD` compare; weekday via noon | — | read |
| `threadMutes` | "Until tomorrow 8 AM" | — | — |
| `useSessionTimeout`, `appLock` | inactivity lock | — | — |
| `StrikeBanner`, `banStatus` | `auto_suspended_until` | — | — |
| `inAppReview`, `nps`, `pushPermissionNudge`, `BirthdayPopup` | cadence gates in localStorage | — | — |
| Admin (`adminJobsHelpers`, `useCronHealth`, `AdminSubscriptions`) | past-due flags, cron staleness | — | UT (admin jobs) |

## 3. Server: sweeps that act on time (live schedule, 2026-09-12)

| Sweep | Schedule (UTC) | Selection at the boundary | Proof |
|---|---|---|---|
| `auto-expire-jobs` step 1 | `0 * * * *` | accepted, unconfirmed, `confirmDeadlineMs <= now` | UT |
| `auto-expire-jobs` step 2 | hourly | open and `expires_at < now`; or no expiry and `date_needed < today(CT)` | UT (no clock-moving CT-evening/DST case: the mock-filter version was dropped per the no-mock order) |
| `expire_unanswered_offers()` | hourly via above | accepted, `response_deadline < now()`, not confirmed → reopen, reject, strike, notify both | **PG**: 1s ahead / 1ms past / 59 min lag / confirmed / replay |
| `expire_pending_direct_offers()` | hourly via above | `direct_offer_expires_at < now()` → expired | **PG**. **DEFECT**: the notification only covers the last 5 minutes (OPEN.md) |
| `auto-release-payment` | `5,35 * * * *` | escrow and `poster/helper_completed_at <= now-24h`, no revision; instant pass `> now-24h`; revision deadlines `<= now` | UT (money: described, not changed) |
| `sweep_release_last_chance` | `*/5` | `helper_completed_at` in (now-24h, now-22h] | — |
| `payment-confirm-reminder` | `15 */6 * * *` | `helper_completed_at` in (now-24h, now-12h]; asserts period ≤ 12h | UT |
| `process-scheduled-payouts` | `20 * * * *` | payout_pending, `payout_scheduled_at <= now` | UT |
| `auto-resolve-disputes` | `21 */6 * * *` | disputed, `dispute_deadline <= now` | UT |
| `review-nag-cron` | `26 16 * * *` | 24h-wide windows at 24h and 72h, disjoint | UT (every age a daily run can see) |
| `expire-subscriptions` | `9 8 * * *` | `subscription_expires_at < now` | UT |
| `subscription-reconciliation` | `24 8 * * *` | flags expiry > 26h stale, > 24h Stripe drift | UT |
| `expiring-jobs-push` | `14 14 * * *` | open, `now < expires_at <= now+24h`, not yet sent | — (gap: see OPEN.md) |
| `auto_start_due_jobs` | `*/15` | confirmed and CT start `<= now`, within 7 days | — |
| `sweep_dayof_confirm_reminders` | `*/5` | CT start (default 09:00) in [now, now+24h] | — |
| `sweep_job_start_reminders` | `*/5` | CT start in [now, now+35m] | — |
| `sweep_no_show_alerts` | `*/5` | CT start in [now-6h, now-30m] | — |
| `sweep_expired_auto_bans` | hourly | `auto_suspended_until < now` | — |
| `charge-recurring-visits` | `6 6 * * *` | visits within `FUND_LEAD_DAYS`=3 (UTC date strings) | UT |
| `auto-tip-charge` | `7 * * * *` | `auto_tip_candidates` RPC | UT |
| `void-cancelled-payments` | `10 * * * *` | abandoned checkouts `created_at < now-1h` | — |
| `reap_stranded_instant_payouts` | `34 * * * *` | `created_at < now-30m` | — |
| `detect_stuck_payments` | `*/15` | created in (now-24h, now-10m) | — |
| `cleanup-abandoned-accounts` / `cleanup-notifications` / `sweep_old_*` | daily | age cutoffs (30d etc.) | — |
| `engagement-automations`, `daily-match-digest`, `sweep_daily_job_digest`, `weekly-helper-report` | daily/weekly | 14d/30d/7d/24h lookbacks | UT (engagement, weekly) |
| `extend-boosts-hourly`, `str-ical-sync`, `saved-helper-availability-push` | periodic | boost expiry, feed recency | UT (availability push) |

## 4. How to run

```
npx playwright test --project=journeys e2e/journeys/time-travel.spec.ts --workers=1   # queues on the browser lock
node scripts/probes/offer-expiry.probe.mjs                                            # PGlite from ~/.lh-pglite-probe
```

Harness notes that cost a run each:
- Use `clock.setFixedTime`. A running clock floors "21 hours left" to 20 within a second.
- Restate the stored session `expires_at` against the moved clock (the reason is in OPEN.md).
- Mint ONE session per run. GoTrue answers 429 after about two dozen magic links.
