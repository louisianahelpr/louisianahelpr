# Lane report — `lh-cron-jobs`

**Sweep date:** 2026-09-02 (re-dispatch; first pass 2026-09-02 04:14 filed CJ-001..CJ-006 and produced no report)
**Target:** PROD `fncmgoasalhdgfwzhsqa`, read-only `execute_sql`. `supabase/.temp/project-ref` points at staging and was never used.
**Source of truth for code:** `git show origin/main:<path>` — the shared main tree is mid-edit by other lanes, so nothing was read from the working copy.
**Mutating actions taken:** none. No function invoked, no cron triggered, no row written, no Stripe call. Stripe is on live keys.

## What I fixed

**Nothing — by the owner's own rule, not by omission.** Every finding in this lane lands in
`cron.job`, a `sweep_*` function body, `cron_work_expectations`, or a CI workflow. The
orchestrator's standing instruction is that a cron schedule change *is* a migration and must be
queued, and CI workflows are orchestrator-only files. All ten findings therefore carry a fix
proposal and none has been applied. I remained in `permissionMode: plan` throughout; the harness
would have blocked edits to `supabase/` regardless.

The queued fixes, in the order I would apply them, are in **Proposed fixes** below.

---

## Headline

The app's own detector for silently-dead cron jobs is itself the dead job, and it has been dead
in a way that erases the evidence of the two money reconcilers.

`sweep_silent_cron_failures()` raises `22P02` on the numeric cast at line 47 whenever a
`cron_work_expectations.candidate_key` names a JSON object instead of a number.
`money-reconciliation`'s registered key is `scanned`, whose value is an object. The crash aborts
the whole function, and because the run-log ingest and the detection loop share one transaction,
the ingest rolls back with it — so `money-reconciliation` and `subscription-reconciliation` can
**never** commit a `cron_run_log` row. Both run daily and succeed; the watcher built to notice
them deletes the proof every time.

`error_logs` has never contained a single row with `tags->>'source' = 'cron-silent'`. The
silent-work detector has not produced one verdict about anything since it was created.

---

## Findings

| id | sev | blocker | status | one line |
|---|---|---|---|---|
| **CJ-001** | HIGH | **yes** | verified (self) | `sweep_silent_cron_failures()` raises `22P02` daily; its rollback makes both money reconcilers permanently unrecordable |
| CJ-007 | MEDIUM | no | filed | 22 of 44 crons (every SQL cron) have liveness monitoring only — zero work visibility, by construction |
| CJ-008 | MEDIUM | no | filed | `auto-tip-charge`'s hard 24h window loses every tip in a >24h outage, permanently and silently |
| CJ-009 | MEDIUM | no | filed | `schedule-heartbeat.yml` watches 5 of 8 scheduled workflows — and not itself |
| CJ-002 | MEDIUM | no | verified (self) | Two retention functions are correct and scheduled nowhere; three edge functions cite them as the reason growth is safe |
| CJ-004 | MEDIUM | no | verified (self) | An intermittently-failing cron alerts nobody: `erroring` needs the last 3 runs to *all* fail |
| CJ-003 | LOW | no | verified (self) | `job_views`, `profile_views`, `notification_logs`, `login_history` have no retention sweep at all |
| CJ-005 | LOW | no | verified (self) | `extend-boosts-hourly` is the one job with no `cron_work_expectations` row, so it cannot be flagged dead |
| CJ-006 | LOW | no | verified (self) | The email dead-letter queues record but never drain; the only monitor is a passive admin tile |
| CJ-011 | MEDIUM | no | filed | The four cron detectors don't duplicate — but `sweep_dead_crons` watches the other three and nothing watches it |
| CJ-010 | LOW | no | filed | The busiest cron in the product (every 60s, 171,495 runs) serves a feature the owner confirmed dead |

`verified (self)` means *I* reproduced it against live prod on this pass. `lh-verifier`'s
independent ruling is still owed on all ten; nothing here should be read as having passed the gate.

**One consequence retracted.** CJ-001 as originally filed claimed the crash left a *permanent*
hole in `cron_run_log` for every HTTP cron. That is no longer true: `sweep_silent_cron_failures`
has been rewritten since I filed, the ingest window is now six hours rather than sixty minutes,
and the body parse moved into an exception-guarded loop. A crashed run's ingest is redone by the
next hourly run. The crash itself, and the self-perpetuating blindness for the two reconcilers,
are unchanged and worse than I described.

---

## Coverage manifest — all 44 scheduled `pg_cron` jobs

Every row checked against `cron.job` (schedule, active) and `cron.job_run_details` (real firing
history), read 2026-09-02 18:00–18:17 UTC. **Work** = does anything record what this job *did*,
as opposed to that it ran.

### HTTP crons (22) — edge functions dispatched via `net.http_post`

| job | schedule | last success (UTC) | work recorded | note |
|---|---|---|---|---|
| auto-expire-jobs | `0 * * * *` | 2026-09-02 18:00 | yes, 166 rows | also drives `expire_pending_direct_offers` + `expire_unanswered_offers` |
| auto-release-payment | `5,35 * * * *` | 2026-09-02 18:05 | yes, 343 rows | backlog drains: no floor, no `.limit()` |
| auto-resolve-disputes | `21 */6 * * *` | 2026-09-02 12:21 | yes, 30 rows | |
| auto-tip-charge | `7 * * * *` | 2026-09-02 17:07 | yes, 177 rows | **CJ-008** — 24h hard window |
| backfill-job-geocode | `17 */4 * * *` | 2026-09-02 16:17 | yes, 18 rows | |
| charge-recurring-visits | `6 6 * * *` | 2026-09-02 06:06 | yes, 8 rows | 371-day lookback; drains |
| cleanup-abandoned-accounts | `11 9 * * *` | 2026-09-02 09:11 | yes, 8 rows | |
| cleanup-notifications | `16 9 * * *` | 2026-09-02 09:16 | yes, 8 rows | |
| daily-match-digest | `12 13 * * *` | 2026-09-02 13:12 | yes, 8 rows | |
| engagement-automations | `22 16 * * *` | 2026-09-02 16:22 | yes, 8 rows | |
| expire-subscriptions | `9 8 * * *` | 2026-09-02 08:09 | yes, 6 rows | |
| expiring-jobs-push | `14 14 * * *` | 2026-09-02 14:14 | yes, 8 rows | |
| **money-reconciliation** | `20 8 * * *` | 2026-09-02 08:20 | **NO — 0 rows, ever** | **CJ-001**: runs fine, watcher rolls back its own record |
| payment-confirm-reminder | `15 */6 * * *` | **2026-09-02 18:15** | yes, 7 rows | fix by another lane, **observed firing** — see below |
| process-email-queue | `3-58/5 * * * *` | 2026-09-02 18:03 | yes, 2,120 rows | |
| process-scheduled-payouts | `20 * * * *` | 2026-09-02 17:20 | yes, 42 rows | backlog drains: no floor |
| review-nag-cron | `26 16 * * *` | 2026-09-02 16:26 | yes, 7 rows | one `cron-http` warning today 16:30 |
| saved-helper-availability-push | `41 */6 * * *` | 2026-09-02 12:41 | yes, 30 rows | |
| str-ical-sync | `44 */6 * * *` | 2026-09-02 12:44 | yes, 7 rows | |
| **subscription-reconciliation** | `24 8 * * *` | 2026-09-02 08:24 | **NO — 0 rows, ever** | **CJ-001**, collateral: its own key is a number, it is erased by money-reconciliation's |
| void-cancelled-payments | `10 * * * *` | 2026-09-02 17:10 | yes, 176 rows | |
| weekly-helper-report | `19 14 * * 1` | 2026-08-31 14:19 | yes, 1 row | Monday-only; next 2026-09-07 |

### SQL crons (22) — `SELECT public.fn()`

**None of these has ever produced a work record of any kind (CJ-007).** `cron_run_log` is fed
only from `net._http_response`; a SQL cron's return value is discarded at the call site. All 22
carry `candidate_key = NULL`, and `sweep_silent_cron_failures` filters
`WHERE c.candidate_key IS NOT NULL`, so the silent-work rule skips every one of them by
construction. Liveness (`expected_max_gap` vs `cron.job_run_details`) is the only signal.

| job | schedule | last success (UTC) | runs | note |
|---|---|---|---|---|
| auto-start-due-jobs | `*/15 * * * *` | 2026-09-02 18:00 | 2,105 | |
| detect-stuck-payments | `*/15 * * * *` | 2026-09-02 18:00 | 11,409 | money-adjacent, no work record |
| detect-suspicious-user-patterns | `30 4 * * *` | 2026-09-02 04:30 | 119 | |
| extend-boosts-hourly | `0 * * * *` | 2026-09-02 18:00 | 2,916 | **CJ-005** — no expectation row |
| prune-cron-run-log | `52 4 * * *` | 2026-09-02 04:52 | 7 | |
| prune-edge-rate-limit-log | `56 4 * * *` | **never — 0 runs** | 0 | created today ~13:52; first fire due 2026-09-03 04:56. **Not a defect yet** |
| reap-stranded-instant-payouts | `34 * * * *` | 2026-09-02 17:34 | 46 | money-adjacent, no work record |
| sweep-cron-blackouts | `57 * * * *` | 2026-09-02 17:57 | 5 | new; covers the pg_cron dispatch-gap case |
| sweep-cron-http-failures | `*/15 * * * *` | 2026-09-02 18:00 | 733 | demonstrably working — writes `cron-http` rows |
| sweep-daily-job-digest | `0 14 * * *` | 2026-09-02 14:00 | 119 | |
| sweep-dayof-confirm-reminders | `*/5 * * * *` | 2026-09-02 18:05 | 2,521 | |
| sweep-dead-crons | `53 * * * *` | 2026-09-02 17:53 | 39 | **CJ-004** — blind to intermittent failure |
| sweep-expired-auto-bans | `0 * * * *` | 2026-09-02 18:00 | 2,857 | |
| sweep-job-start-reminders | `*/5 * * * *` | 2026-09-02 18:05 | 34,297 | |
| sweep-no-show-alerts | `*/5 * * * *` | 2026-09-02 18:05 | 34,295 | |
| sweep-old-email-send-log | `0 4 * * *` | 2026-09-02 04:00 | 116 | |
| sweep-old-error-logs | `45 3 * * *` | 2026-09-02 03:45 | 116 | |
| sweep-old-notifications | `30 3 * * *` | 2026-09-02 03:30 | 115 | |
| sweep-pending-broadcast-fan-outs | `* * * * *` | 2026-09-02 18:05 | 171,495 | **CJ-010** — dead feature, 0 rows in target table |
| sweep-release-last-chance | `*/5 * * * *` | 2026-09-02 18:05 | 2,506 | escrow-adjacent, no work record |
| **sweep-silent-cron-failures** | `47 * * * *` | 2026-09-02 17:47 | 181, **3 failed** | **CJ-001** |
| sync-profiles-update-grants | `4-59/10 * * * *` | 2026-09-02 18:04 | 232 | |

**Every job is `active = true`. No job is disabled. No job in the table has never run except
`prune-edge-rate-limit-log`, which is not yet due.**

### Scheduled elsewhere / deliberately not scheduled

| function | verdict | evidence |
|---|---|---|
| `instant-job-match` | **correctly event-driven, not a cron.** My dispatch brief listed it as scheduled; that is wrong | invoked from `src/pages/postjob/useJobSubmit.ts` and `supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts`; absent from `cron.job` by design |
| `spawn-recurring-jobs` | **deliberately disabled and superseded** | migration `20260821020000_disable_spawn_recurring_jobs_cron.sql`, replaced by `20260823170000_schedule_charge_recurring_visits.sql` |
| `cleanup_observability_tables` | **unscheduled — CJ-002** | 0 matching rows in `cron.job` |
| `cleanup_stripe_webhook_events` | **unscheduled — CJ-002** | 0 matching rows in `cron.job` |
| `expire_pending_direct_offers` | reached | called by `auto-expire-jobs` (hourly) |
| `expire_unanswered_offers` | reached | called by `auto-expire-jobs` (hourly) |
| `auto_tip_candidates` | reached | `STABLE` selector called by `auto-tip-charge` |
| `purge_user_data` | reached | user-initiated deletion path, not retention |
| `auto_escalate_reports`, `auto_pending_credentials`, `auto_restrict_repeat_violators` | reached | all three are `RETURNS trigger` with one live trigger each — not crons |

`node scripts/check-dead-edge-functions.mjs` → `67 edge functions checked; 1 known-unreferenced, 0 new.`

### GitHub Actions schedules (8 files, 10 cron lines)

| workflow | cron | state | in `WATCHED` |
|---|---|---|---|
| broken-links.yml | Tue 09:00 | active | yes |
| db-drift-detect.yml | daily 06:00 | active | yes |
| edge-function-smoke.yml | daily 13:00 | active | yes |
| lighthouse.yml | Sun 06:00 | active | yes |
| security-audit.yml | Mon 08:00 | active | yes |
| prod-freshness.yml | daily 07:45 | active, firing | **no — CJ-009** |
| ui-sweep.yml | Sun 05:30 / Wed 05:00 / Fri 05:00 | active, firing | **no — CJ-009** |
| schedule-heartbeat.yml | daily 11:23 | active, firing | **no — CJ-009, watches everything but itself** |

`gh workflow list --all` — all 27 workflows `active`; none `disabled_manually`.
`sitemap-drift.yml` and `a11y-axe.yml` have no cron block, so their absence from `WATCHED` is
correct under the file's own rule and is not part of CJ-009.

### Retention coverage

Census over all public functions matching `DELETE FROM <table>` in `pg_get_functiondef`:

| table | rows | size | pruned by | scheduled |
|---|---|---|---|---|
| cron_run_log | 3,046 | 1,312 kB | `prune_cron_run_log` | yes, daily 04:52 |
| error_logs | 539 | 1,136 kB | `sweep_old_error_logs`, `cleanup_observability_tables` | yes (the first) |
| analytics_events | 1,619 | 720 kB | `cleanup_observability_tables` | **no — CJ-002** |
| login_history | 1,080 | 392 kB | `purge_user_data` only | **no — CJ-003** |
| notification_logs | 367 | 360 kB | `purge_user_data` only | **no — CJ-003** |
| email_send_log | 160 | 200 kB | `sweep_old_email_send_log` | yes, daily 04:00 |
| job_views | 71 | 72 kB | **nothing** | **no — CJ-003** |
| profile_views | 51 | 72 kB | **nothing** | **no — CJ-003** |
| stripe_webhook_events | 51 | 48 kB | `cleanup_stripe_webhook_events` | **no — CJ-002** |
| edge_rate_limit_log | — | — | `prune_edge_rate_limit_log` | yes, from 2026-09-03 |

Free tier, 500 MB cap. Nothing is near it today; the point is that four tables have no bound at all.

---

## The three leads routed from `lh-money-escrow` — my ruling on the schedules

I did not re-file any of these. They are that lane's findings; the schedule question is mine.

**1. `money-reconciliation` "has never completed a run: 0 rows in 2,493 `cron_run_log` rows."**
The zero is real; the inference is not. `cron.job_run_details` shows **8 successful runs**, most
recently 2026-09-02 08:20:00, zero failures ever. **The job runs.** Its `cron_run_log` row cannot
exist because CJ-001's cast raises on that very row inside the same transaction as the ingest.
The `fn`-key half of that lead was also already fixed before I looked: `money-reconciliation`
now answers through `cronResult(...)` and its own source documents the old defect at
`supabase/functions/money-reconciliation/index.ts:742` ("NO `fn` KEY … ZERO rows in
`cron_run_log`"). That fix is what *converted* the problem: the response is now ingestible, so it
now reaches the cast that kills the sweep. **CJ-001 is the reason money-reconciliation is
invisible, and fixing CJ-001 is what makes that lead resolve.** Its schedule, `20 8 * * *`
daily, is correct for a reconciler and I propose no change.

**2. `payment-confirm-reminder` — `15 15 * * *` daily against a 12-hour eligibility window.**
Already fixed by another lane and landed as
`supabase/migrations/20260902035754_payment_confirm_reminder_every_six_hours.sql`; there is no
drift, prod matches the repo. **I verified it by observation rather than by reading the
migration:** live `cron.job` shows `15 */6 * * *`, and at 18:15:00 UTC today it fired — the
first non-15:15 firing in its entire 76-run history (every prior run: 15:15 exactly). The
coverage gap is closed. **What is still unproven is the send path itself:**
`jobs.payment_confirm_notif_sent = true` remains **0 rows across all 64 jobs**, and the newest
`cron_run_log` body is `{"fn":"payment-confirm-reminder","ok":true,"processed":0,"sent":0}`. That
is consistent with "no eligible jobs right now", not with "it sends" — the schedule is fixed;
the send has still never been observed to happen in prod. I am flagging that rather than
reporting the lead closed.

**3. ME-001 — nothing releases escrow after a revision. Confirmed: no cron path exists.**
Established from prod, not from a grep. Across all 254 public functions, exactly **two** mention
`revision_requested_at`: `helper_abort_job` (which *clears* it, i.e. the helper abandoning the
job) and `sweep_release_last_chance` (which *excludes* it, so the poster who most needs the
"auto-releases in ~2 hours" warning is the only one guaranteed not to get it). Exactly **three**
mention `revision_deadline`: `set_revision_deadline` (sets it), `prevent_job_field_escalation`
(guards it), `helper_abort_job` (clears it). **Nothing reads `revision_deadline` to act on
expiry. There is no scheduled job, in the database or in `cron.job`, that resolves a revision.**
`auto-release-payment` excludes those jobs at `index.ts:123` and its own comment states the gap
outright: *"If revision jobs should ever settle on their own, that needs its own pass keyed on
`revision_deadline` — not this one."* No such pass exists. Live state: 1 job has been sitting in
`revision_requested_at IS NOT NULL` since 2026-08-25 (8 days); its `payment_status` is no longer
`escrow`, so **no money is stranded right now** — the mechanism is unguarded, the current
exposure is zero. Building that pass is a new cron and belongs to this lane in the FIX phase, but
the escrow semantics (who gets paid, after how long, and what the poster is told) are a product
decision for the owner, not something I should choose.

---

## The two additions routed from `lh-generated-drift`

**`prune_edge_rate_limit_log` — scheduled, correct, no exposure. Not a finding.**
It is `cron.job` jobid 62, `56 4 * * *`, active, created ~13:52 today; the function deletes
`edge_rate_limit_log` rows older than one day. Zero runs so far only because its first fire is due
2026-09-03 04:56. `edge_rate_limit_log` holds **0 rows / 40 kB**, so there is no unbounded-growth
risk to confirm. The write path is healthy too, and my first pass nearly got this wrong: grepping
`supabase/functions` for `edge_rate_limit_log` returns nothing, because the write goes through an
RPC rather than a table reference. `rate_limit_hit(p_bucket text, p_subject text, p_ip text,
p_window_seconds integer, p_max integer, p_ip_max integer, p_forwarded_for text)` exists in prod
with exactly the signature `_shared/rate-limit.ts` POSTs to, and its body does
`INSERT INTO public.edge_rate_limit_log`. Edge functions were redeployed 2026-09-02 13:51:53,
after the 03:57 migration, and `function_edge_logs` contains **zero** `[rate-limit]` lines — so it
has not silently degraded to `inMemoryFallback` either. The zero rows are simply no traffic on a
pre-launch app. Its absence from committed `types.ts` is real but is a generated-drift finding,
not a cron defect.

**`sweep_cron_blackouts` vs `sweep_silent_cron_failures` — no overlap whatsoever. CJ-011.**

| detector | cadence | input | catches | `error_logs` source | rows ever |
|---|---|---|---|---|---|
| `sweep_cron_http_failures` | `*/15` | `net._http_response` status codes | an edge function answering non-2xx | `cron-http` | 126 |
| `sweep_silent_cron_failures` | `:47` | `cron_run_log` bodies × `candidate_key` | a **2xx that did nothing** | `cron-silent` | **0** |
| `sweep_dead_crons` | `:53` | `cron.job_run_details` × `expected_max_gap` | unscheduled / inactive / never-ran / dead / erroring | `cron-dead` | 1 |
| `sweep_cron_blackouts` | `:57` | **aggregate** dispatch-stream gap differencing | pg_cron dispatching *nothing* for >15 min | `cron-blackout` | 0 |

Four distinct inputs, four distinct verdicts, disjoint sources, deliberately staggered. There is
no redundancy to remove.

**But your instinct was right in a different place.** All four detectors are themselves crons, and
only one thing can notice a detector failing: `sweep_dead_crons` is the only *actor* in the entire
254-function catalog that reads `expected_max_gap` (the only other reader,
`cron_dispatch_health()`, is a read-only reporter that raises no alarm). So `sweep_dead_crons`
watches the other three, **and nothing watches `sweep_dead_crons`.** If it stops or starts raising,
the database emits no signal, and every other detector's failure becomes unobservable at the same
instant. That is structurally identical to CJ-009 in the CI half — `schedule-heartbeat.yml` also
watches everything except itself — so the same gap exists independently on both sides of the stack.

One nuance that softens CJ-004 and that I had missed on the first pass: `cron_dispatch_health()`
*does* expose per-job `recent_failures`, and it correctly reports `sweep-silent-cron-failures` at
**2** — the only non-zero row in the whole 44-job fleet. So the intermittent failure is not
literally invisible. It reaches exactly one consumer, `useCronHealth.ts`, i.e. a passive tile on
`/admin?view=health`. No Slack, no `error_logs` row, no push; a human must open the page and read
the number. CJ-004's corrected claim is *"alerts nobody"*, not *"is recorded nowhere"*.

---

## Answers to the lane's core questions

**Is every job actually scheduled?** Yes — all 44 in `cron.job`, all `active`. Two DB functions
are scheduled nowhere (CJ-002). One job has no expectation row (CJ-005). No edge function is
orphaned (`check-dead-edge-functions.mjs` clean).

**Has it run recently, and did it do work?** Firing: every job is current except
`prune-edge-rate-limit-log` (not yet due) and `weekly-helper-report` (weekly). Work: **answerable
for 20 of 44 jobs.** Two HTTP crons are erased by CJ-001; all 22 SQL crons have no work channel
at all (CJ-007). So for **24 of 44 jobs the question cannot be answered from any data the app
keeps** — which is the finding, not a gap in my coverage.

**Money jobs — what if they do not run for a day, a week?**
- `auto-release-payment` — drains. `.or(poster_completed_at.lte.cutoff, helper_completed_at.lte.cutoff)`, no floor, no `.limit()`.
- `process-scheduled-payouts` — drains. `.lte("payout_scheduled_at", now)`, no floor.
- `charge-recurring-visits` — drains. `SERIES_LOOKBACK_DAYS = 371`.
- `void-cancelled-payments` — drains. `.limit(200)` on the reserved-holds pass only, at hourly cadence.
- **`auto-tip-charge` — does NOT drain. CJ-008.** Hard 24h window; a longer outage loses those tips forever.

**Idempotency / double-execution.** No advisory locks anywhere in the database (`pg_proc` scan
for `advisory_lock` → 0 rows), so pg_cron overlap is not prevented structurally. It does not need
to be for the release path: `auto-release-payment` claims each job with a compare-and-swap —
`.update(...).eq("id", job.id).eq("payment_status", "escrow").select("id")` plus an explicit
zero-row check — which is the correct pattern and is double-execution safe. `auto-tip-charge` is
guarded by `NOT EXISTS (tips WHERE source='auto')`. `process-scheduled-payouts`,
`charge-recurring-visits` and `void-cancelled-payments` all carry idempotency-key material.
`money-reconciliation` is read-only. **No double-charge or double-release path found.**

**Failure visibility.** Three signals exist and two work. `sweep_cron_http_failures` works —
`error_logs` holds 126 `cron-http` rows across 7 jobs. `sweep_dead_crons` works for the
stopped-cron case (one `cron-dead` row, payment-confirm-reminder, today 13:53) but is blind to
intermittent failure (CJ-004). `sweep_silent_cron_failures` has **never produced a verdict**
(`cron-silent`: 0 rows, ever) — CJ-001. `sweep_cron_blackouts` is new and untested by an actual
blackout. `move_to_dlq` records but nothing drains (CJ-006).

**Unbounded growth.** Table above. Four tables have no retention sweep written at all (CJ-003);
two have one that is never called (CJ-002).

---

## Proposed fixes — all queued, none applied

1. **CJ-001 (blocker).** Exact change, for the orchestrator to hold. **No schedule change is
   involved** — `47 * * * *` is correct and stays. This is a function body plus one data row.

   `npm run migration:new -- guard_the_silent_cron_cast` (never a hand-typed timestamp), then:

   ```sql
   -- (a) The crash. A candidate_key naming a JSON object must score 0, not raise.
   --     Two sites, and BOTH must change: the value is computed once for
   --     `candidates` and again inside the `suspicious` predicate.
   CREATE OR REPLACE FUNCTION public.sweep_silent_cron_failures() ...
   --   replace   COALESCE((r0.body ->> r0.candidate_key)::numeric, 0)
   --   with      CASE WHEN jsonb_typeof(r0.body -> r0.candidate_key) = 'number'
   --                  THEN (r0.body ->> r0.candidate_key)::numeric ELSE 0 END
   --   and apply the identical guard to the disposition_keys sum, which has the
   --   same shape and the same latent failure for any future object-valued key.

   -- (b) The lie in the data. This note asserts the opposite of what the code does.
   UPDATE public.cron_work_expectations
      SET note = 'Liveness only. candidate_key names an object, so the guarded cast '
                 'scores it 0 and the silent-work rule cannot fire for this job.'
    WHERE jobname = 'money-reconciliation';
   ```

   **Guard (a) is what unblocks the launch; (b) is bookkeeping.** Ship both together — the note
   is what sent the first reader to the wrong conclusion.

   Verification I will run before marking it fixed, in this order: apply the migration **3×
   consecutively under PGlite** (installed outside the repo, `git status package.json
   package-lock.json` clean afterwards) to prove replay-safety; then re-run the exact reproduction
   — the `select ...::numeric` on the real literal — and show it returns `0` instead of raising;
   then, after deploy, confirm the 08:47 UTC run succeeds and that `money-reconciliation` finally
   commits its first-ever `cron_run_log` row. That last one is the real proof and it takes until
   the next morning; I would not claim the fix without it.

   **Consider separately, not in this migration:** whether `money-reconciliation` should keep a
   liveness-only expectation at all, or point `candidate_key` at a scalar (`scanned->'jobs'`) so
   it gains genuine silent-work detection. That changes what the alarm means and is a judgment
   call for the owner, not a bug fix.
2. **CJ-007.** Give SQL crons a work channel. The cheapest correct shape is a wrapper that
   records `(jobname, returned_value, occurred_at)` into `cron_run_log` so the existing
   `candidate_key` machinery applies unchanged — the functions already return the counts, they
   are simply thrown away at the call site.
3. **CJ-008.** Widen `_since_hours` well past any plausible outage (or drop the window and rely
   on the existing `NOT EXISTS` guard, which already makes it idempotent).
4. **CJ-002 / CJ-003.** Schedule `cleanup_observability_tables` and
   `cleanup_stripe_webhook_events`; write retention sweeps for `job_views`, `profile_views`,
   `notification_logs`, `login_history`.
5. **CJ-005.** One `INSERT` into `cron_work_expectations` for `extend-boosts-hourly`.
6. **CJ-004.** Lower the `erroring` bar, or add a separate rate-based verdict (*n* failures in
   the last *m* runs) so a once-a-day raise is visible.
7. **CJ-010.** Unschedule `sweep-pending-broadcast-fan-outs` **in the same migration** that drops
   `broadcast_messages` — unscheduling first is safe, dropping first makes the cron raise every
   60 seconds. Also re-check `sweep_cron_blackouts`' 15-minute sensitivity afterwards: removing a
   per-minute job thins the aggregate dispatch stream it differences.
8. **CJ-006.** A DLQ drain, plus a real alert rather than the passive `/admin?view=health` tile.
9. **CJ-009.** Orchestrator-owned (CI workflow). Add `prod-freshness.yml` and `ui-sweep.yml` to
   `WATCHED`; give the heartbeat an external watcher — the natural home is a
   `cron_work_expectations`-style assertion inside `db-drift-detect.yml` or
   `edge-function-smoke.yml` that the heartbeat's own last scheduled run is recent.

---

## Out-of-scope conclusions (PROTOCOL §6)

- **Local-DB migrations / offline sync / SDWebImage / FlatList / SwiftUI / XCTest / IAP receipts
  / Bluetooth / audio interruption** — none apply; no cron surface touches them. Not searched for.
- **Role-gating** — no role system; not applicable and not filed.
- **Certificate pinning, RASP, i18n extraction** — no cron surface; the assess-then-justify
  conclusions belong to the lanes that own those surfaces.
- **Apex universal links** — deliberately staged; untouched.
- **Removed features** — I touched exactly one: `sweep-pending-broadcast-fan-outs`, and only its
  *schedule* (CJ-010). The `broadcast_*` object removals are `lh-schema-integrity`'s, and I have
  relayed the coupling requirement to the orchestrator rather than writing the DROP.

## What I could NOT cover, and why

- **Whether `payment-confirm-reminder` actually sends.** `payment_confirm_notif_sent` is 0 rows
  ever and the last run reported `processed: 0`. Proving the send needs a job seeded into the
  eligibility window — a mutating action against prod, outside this lane's read-only remit.
- **`sweep_cron_blackouts` correctness under a real blackout.** Five runs old, never triggered.
  Verifying it needs an induced pg_cron outage. Not attempted.
- **`prune-edge-rate-limit-log`'s first run.** Due 2026-09-03 04:56, after this sweep.
- **The DLQ drain path end to end (CJ-006).** Both queues are empty; exercising it means forcing
  an email to exhaust its retries, which is mutating.
- **Slack delivery.** Every alert path ends in `net.http_post` to `slack-ops-alert` inside
  `EXCEPTION WHEN OTHERS THEN NULL`. I verified the `error_logs` durable record for each path;
  I did **not** verify that any message reached Slack, and the fail-open catch means a broken
  Slack integration would be invisible from the database. That is a real gap in this lane's
  evidence, not a claim that Slack works.

---

## Appendix — re-run everything here

`npm run check:audit-evidence` scores this file 10/35 claims carrying an inline artifact. That
ratio is a keyword heuristic and understates the case: most flagged lines are table rows and
section prose whose artifact is the table itself. The artifacts that matter live in the ten bus
findings (`node scripts/audit-bus.mjs show CJ-001` … `CJ-010`), each of which carries its own
`repro` and `evidence` block. The queries below are the complete set this pass ran, so any
reader can reproduce the manifest from scratch rather than trusting the prose.

All against PROD `fncmgoasalhdgfwzhsqa`, read-only.

```sql
-- The 44 jobs, their schedules, and http-vs-sql kind
select j.jobid, j.jobname, j.schedule, j.active,
       case when j.command ilike '%net.http_post%' then 'http' else 'sql' end as kind
  from cron.job j order by j.jobname;

-- Real firing history: last success, last failure, failure count (the manifest's spine)
select j.jobname, j.schedule, count(d.*) as runs,
       max(d.start_time) filter (where d.status='succeeded') as last_success,
       count(*) filter (where d.status<>'succeeded')          as failures
  from cron.job j left join cron.job_run_details d on d.jobid=j.jobid
 group by j.jobname, j.schedule order by last_success asc nulls first;

-- CJ-001: the crash, verbatim, and the daily cadence
select date_trunc('day', d.start_time) as day,
       count(*) filter (where d.status='failed') as failed, count(*) as total
  from cron.job_run_details d join cron.job j on j.jobid=d.jobid
 where j.jobname='sweep-silent-cron-failures' group by 1 order by 1 desc;
-- and the cast itself (this statement is EXPECTED to raise 22P02):
select coalesce(('{"scanned":{"jobs":3,"pages":2,"server_totals":{"jobs":3,
       "payout_transfers":2},"payout_transfers":2}}'::jsonb->>'scanned')::numeric, 0);

-- CJ-007: which jobs have any work record at all
with k as (select jobname, case when command ilike '%net.http_post%'
                                then 'http' else 'sql' end kind from cron.job)
select k.kind, count(*) as jobs,
       count(*) filter (where l.jobname is not null) as with_work_records
  from k left join (select distinct jobname from cron_run_log) l on l.jobname=k.jobname
 group by k.kind;   -- => http 22/20, sql 22/0

-- CJ-005: the one job with no expectation row
select j.jobname from cron.job j
  left join cron_work_expectations c on c.jobname=j.jobname where c.jobname is null;

-- CJ-002 / CJ-003: retention census over every public function
select t.table_name, string_agg(p.proname, ', ') as pruned_by
  from information_schema.tables t
  left join pg_proc p on p.pronamespace='public'::regnamespace
   and pg_get_functiondef(p.oid) ~* ('delete\s+from\s+(public\.)?'||t.table_name||'\M')
 where t.table_schema='public' group by t.table_name order by t.table_name;

-- CJ-004 / failure visibility: what the app has ever alerted about
select tags->>'source' as source, tags->>'job' as job, count(*),
       min(created_at), max(created_at)
  from error_logs where tags->>'area'='cron' or tags->>'source' like 'cron%'
 group by 1,2 order by 4 desc;   -- 'cron-silent' never appears

-- ME-001: nothing schedules a revision resolution
select p.proname from pg_proc p where p.pronamespace='public'::regnamespace
   and pg_get_functiondef(p.oid) ilike '%revision_deadline%';
   -- => set_revision_deadline, helper_abort_job, prevent_job_field_escalation. No reader.
```

```bash
# GitHub Actions half (CJ-009)
for f in .github/workflows/*.yml; do grep -lE '^\s+- cron:' "$f"; done   # => 8 files
sed -n '/WATCHED="/,/"/p' .github/workflows/schedule-heartbeat.yml       # => 5 entries
gh workflow list --all                                                    # => 27, all active
gh run list --workflow=schedule-heartbeat.yml --event=schedule -L 5

node scripts/check-dead-edge-functions.mjs   # => 67 checked, 1 known-unreferenced, 0 new
```
