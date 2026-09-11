# LAUNCH BLOCKER — `accept_application` never stamps `helper_confirmed_at`, so "I'm On My Way" dead-ends for every apply→accept hire

Found 2026-09-11 by the `lh-money-integrity` scheduled run, verified against prod
(`fncmgoasalhdgfwzhsqa`) live object state, not migration files.

## The chain

1. **`accept_application` does not set the column.** Live
   `pg_get_functiondef('public.accept_application')` — its only jobs write is:
   ```sql
   UPDATE public.jobs
      SET status = 'accepted', helper_id = v_helper_id, response_deadline = p_deadline
    WHERE id = v_job_id;
   ```
   No `helper_confirmed_at`. `respond_to_direct_offer` DOES stamp it, which is
   why the direct-offer path works and hides this.

2. **Nothing else on that path stamps it.** Every `public` function whose body
   mentions `helper_confirmed_at` was enumerated live; the only writers are
   `respond_to_direct_offer`, `helper_abort_job`, `helper_cancel_booking`,
   `stamp_recurring_series_helper` and two INSERT-time column locks. The jobs
   triggers that mention it (`enforce_job_funded_before_award`,
   `enforce_helper_award_gate`, `enforce_helper_jobs_column_whitelist`) are
   gates, not writers.

3. **The day-of tap writes a DIFFERENT column.** `JobConfirmation.tsx:195`
   sets `field = isOwner ? "poster_confirmed_at" : "helper_dayof_confirmed_at"`
   and line 216 updates only that one. `helper_confirmed_at` stays NULL forever.

4. **The client gate opens anyway.** `helperDayOfConfirmation`
   (`JobConfirmation.tsx:44`) returns early on `helperDayofConfirmedAt` alone,
   so `HelperTrackerPanel`'s `gateActive` clears and the tracker renders a live
   "I'm On My Way" primary.

5. **The server then refuses.** Live `helper_mark_on_the_way`:
   ```sql
   IF v_job.helper_confirmed_at IS NULL THEN
     RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514', ...
   ```
   `JobTracking.tsx:933-948` calls that RPC and, on any code that is not
   PGRST202, toasts "Couldn't mark you on the way — try again?", restores the
   previous tracking state and returns. 23514 is not PGRST202, so the legacy
   fallback never runs. The helper is stuck, permanently, with a retry prompt.

## Corroboration from real prod rows

25 of 25 jobs hired through `accept_application` (the `[E2E DO NOT ACCEPT]
automated lifecycle%` set) have `helper_confirmed_at IS NULL`. 24 of them
nonetheless carry `helper_on_the_way_at` — impossible through the RPC.

## Why the E2E suite is blind to it

`e2e/prod-lifecycle.spec.ts:741-751` does not call `helper_mark_on_the_way`.
It PATCHes the column straight onto the row over PostgREST as the helper:
```js
data: { helper_on_the_way_at: new Date(Date.now() - 45*60_000).toISOString(), status: "in_progress" }
```
That succeeds because `enforce_helper_jobs_column_whitelist` lists
`helper_on_the_way_at` as helper-writable. The suite therefore proves the
column can be set, never that the transition the app actually performs works.
Same shape as the mock-boundary class already on record.

## Blast radius

Zero real users hit yet — prod currently has **no** non-seed job with a helper
assigned. It would fire on the first real apply→accept hire. Direct-offer hires
are unaffected.

## Fix options (not applied — reporting only)

- Stamp `helper_confirmed_at` in `accept_application`'s jobs UPDATE, matching
  `respond_to_direct_offer`; or
- change the RPC's gate to accept
  `COALESCE(helper_confirmed_at, helper_dayof_confirmed_at)`, which is what the
  client already treats as the real answer.

Either way the finding closes only on a re-measurement: hire through
apply→accept, tap "I'm On My Way", and confirm the stamp lands — not on the diff.
Change the E2E spec to drive `helper_mark_on_the_way` instead of PATCHing, or
this stays invisible.
