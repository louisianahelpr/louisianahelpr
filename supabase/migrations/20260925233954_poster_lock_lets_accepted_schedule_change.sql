-- A booked job's date / time change the Helpr asked for and the POSTER accepts
-- (owner decision Q407 (8), respond_job_schedule_change, 20260925165200) was
-- refused by the Q423 poster lock (20260925231810): its locked_when_booked
-- raises for any write with auth.uid() = the poster once a Helpr is booked,
-- and the RPC's UPDATE runs as the accepting poster (is_server_context() is
-- false). The Helpr-accepts direction was never affected (the poster lock
-- judges the poster only; the Helpr's whitelist has the same carve-out since
-- 20260925165200).
--
-- THE FIX: enforce_poster_jobs_money_lock, restated from 20260925231810
-- verbatim, lets date_needed / start_time through locked_when_booked ONLY
-- under app.schedule_change_rpc = '1'. That flag is transaction-local
-- (set_config(..., true)); respond_job_schedule_change sets it after its
-- party, status and expiry checks and resets it right after its UPDATE. A
-- client cannot set it inside its own request: PostgREST runs one statement
-- per request and exposes only public-schema functions, and no public
-- function passes a caller-chosen setting to set_config
-- (src/test/posterLockLetsAcceptedScheduleChange.test.ts).
--
-- Proven in PGlite: src/test/pglite/jobScheduleChange.pglite.mjs (the
-- poster-as-responder accept on a funded booked job, refused on 231810 alone,
-- lands after this; a bare poster PATCH and a flag set in an earlier statement
-- are still refused) and src/test/pglite/posterFeeInputsLocked.pglite.mjs run
-- with NEW_MIGRATION_FILE = 231810 + this file (every Q423 case still holds).
--
-- REPLAY-SAFE: CREATE OR REPLACE of a trigger function the table already
-- runs (trg_poster_jobs_money_lock). Applied 3x in PGlite.

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
        -- ADDED 20260925233954 (Q407 (8)): a new date / start time the Helpr
        -- ASKED for and this poster ACCEPTED. Its only writer is
        -- respond_job_schedule_change (20260925165200), which sets this
        -- transaction-local flag only after checking that the caller is the
        -- party the request is addressed to and the request is still live,
        -- and clears it right after its one UPDATE. Only the schedule columns
        -- pass; locked_always and locked_when_funded above still apply.
        IF current_setting('app.schedule_change_rpc', true) = '1' THEN
          CONTINUE;
        END IF;
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
