-- Q423: a poster could erase the late-cancel fee they owe their Helpr by
-- editing the inputs the fee is priced from, then cancelling.
--
-- THE HOLE. poster_cancel_job prices a single booking's late-cancel fee from
-- whether the Helpr is COMMITTED (helper_id AND helper_confirmed_at) and how
-- many hours remain until date_needed + start_time; an uncommitted cancel is
-- $0 and no strike. void-cancelled-payments re-prices from the same columns
-- (computeCancellationFee). The poster's UPDATE policy on jobs is whole-row
-- (20260311000404), so the column locks are triggers, and
-- enforce_poster_jobs_money_lock (newest: 20260925154606) locked neither the
-- confirmation stamps nor the schedule. Proven in PGlite with every standing
-- BEFORE trigger on jobs at its newest text
-- (src/test/pglite/posterFeeInputsLocked.pglite.mjs), on a funded, confirmed
-- $200 booking 10 hours out:
--   honest cancel ........................................ $50 fee, 1 strike
--   PATCH helper_confirmed_at = NULL, then cancel ......... $0 fee, 0 strikes
--   PATCH date_needed = date_needed + 3, then cancel ...... $0 fee
--   PATCH start_time past the 24h line, then cancel ....... $0 fee
-- Nothing else stops it: enforce_confirm_on_live_job judges only the stamping
-- transition (NULL -> value), enforce_hire_columns_rpc_only covers helper_id /
-- status / offered_to_helper_id / recurring_helper_id,
-- enforce_helper_jobs_column_whitelist judges the Helpr only, and
-- prevent_job_field_escalation hands the poster to this trigger. No
-- column-level UPDATE grant narrows authenticated on jobs (the grant is
-- table-wide; see 20260915055601).
--
-- THE FIX (enforce_poster_jobs_money_lock, restated from 20260925154606):
--   1. helper_confirmed_at and helper_dayof_confirmed_at join locked_always.
--      They are the Helpr's own acts. Every legitimate writer is the Helpr
--      (their confirm and day-of confirm PATCH; helper_cancel_booking,
--      helper_abort_job, instant_book_claim and respond_to_direct_offer run
--      with auth.uid() = the Helpr), a server context (charge-recurring-visits
--      inserts visits as service role), or an INSERT
--      (enforce_jobs_insert_column_lock; this trigger is UPDATE-only). Crew
--      stamps live on group_job_helpers under their own server-owned lock
--      (20260919192559). No path writes them with auth.uid() = the poster, so
--      a poster write is never legitimate, in either direction (a forged
--      stamp would make a Helpr look committed to a job they never accepted).
--   2. date_needed and start_time are locked for the poster ONCE A HELPR IS
--      BOOKED: jobs.helper_id is set, or a crew roster row names a Helpr.
--      While nobody is hired the poster may still reschedule (EditJobDialog,
--      "Give it a new date"), funded or not. The poster's edit screen is
--      offered only on an open job (OpenStep); on a crew that already has
--      members a reschedule is now refused with a message saying why.
-- Everything else in the function is unchanged. The class guard
-- src/test/posterCannotMoveFeeInputs.test.ts derives every jobs column
-- poster_cancel_job and the settlement read to price a fee or a strike and
-- fails when one of them has no poster lock.
--
-- REPLAY-SAFE: CREATE OR REPLACE of a trigger function the table already runs
-- (trg_poster_jobs_money_lock, 20260710130000); PL/pgSQL resolves
-- group_job_helpers at run time, not at CREATE. Applied 3x in PGlite.
--
-- VERIFY LIVE after deploy (read-only):
--   SELECT pg_get_functiondef('public.enforce_poster_jobs_money_lock()'::regprocedure)
--            ~ '''helper_dayof_confirmed_at'''
--      AND pg_get_functiondef('public.enforce_poster_jobs_money_lock()'::regprocedure)
--            ~ 'locked_when_booked';        -- expect true
--   SELECT proacl FROM pg_proc WHERE oid = 'public.enforce_poster_jobs_money_lock()'::regprocedure;
--                                            -- expect no anon=, authenticated= or bare =X entry

CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    -- Added 20260915044137 (VN-33). The Helpr arrival stamps are written
    -- only by mark_helper_arrival (helper) and reset by
    -- zz_jobs_arrival_integrity (which sorts after this trigger). A poster
    -- writing the GPS half would satisfy half of the arrival rule for them.
    'helper_arrived_at',
    'helper_arrival_verified_at',
    -- VN-33(b): server-owned near-miss record. A poster writing it would make
    -- their own confirmation count without the Helpr ever being near.
    'helper_arrival_near_miss_at',
    'helper_arrival_near_miss_ft',
    -- ADDED 20260925231810 (Q423). The Helpr's own acceptance and day-of
    -- confirmation. poster_cancel_job charges a late-cancel fee (and strikes
    -- the poster) only while helper_confirmed_at is set, so a poster who
    -- cleared it cancelled late for $0. No poster path writes either.
    'helper_confirmed_at',
    'helper_dayof_confirmed_at'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
  -- ADDED 20260925231810 (Q423). The fee's clock: hours until
  -- date_needed + start_time. Moving it past 24h before cancelling took the
  -- fee to $0. Free to change while nobody is booked.
  locked_when_booked CONSTANT text[] := ARRAY[
    'date_needed',
    'start_time'
  ];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  -- Q423: once a Helpr is booked (a single job's helper_id, or a crew roster
  -- row naming a Helpr) the schedule is the fee's clock.
  IF OLD.helper_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 WHERE g.job_id = OLD.id AND g.helper_id IS NOT NULL) THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_booked) THEN
        RAISE EXCEPTION 'Posters may not move jobs.% once a Helpr is booked (job_id=%)', changed_col, OLD.id
          USING ERRCODE = '42501',
                HINT = 'A booked Helpr planned around this time. Message them, or cancel and post the job again for the new time.';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_poster_jobs_money_lock() FROM PUBLIC, anon, authenticated;
