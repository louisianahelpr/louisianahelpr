-- Q1366 (docs/OPEN.md): a poster could still rewrite jobs.stripe_session_id
-- on their own job (has_column_privilege('authenticated','public.jobs',
-- 'stripe_session_id','UPDATE') = true live, 2026-10-06).
-- prevent_job_field_escalation hands the poster to this lock, whose lists did
-- not name the column (its poster_locked_always list there applies only to
-- the offered Helpr).
--
-- Writers traced 2026-10-07 before locking: live pg_proc has no function that
-- assigns jobs.stripe_session_id (redeem_gift_card and
-- rpc_settle_dispute_without_payment only read it); supabase/functions writes
-- it only through the service-role client (create-payment stampSession,
-- stripe-webhook checkoutSessionExpired), which is_server_context() passes;
-- the client writes it nowhere (src/ grep: reads only).
--
-- Restated from its newest definition, 20261004193548 (md5(prosrc) live
-- 4053b19c3489a92c10f81b63fd62191a = that file), plus the one column in
-- locked_always. Built on 20261006204113's body (Q1461 materials_note, which
-- landed first), so neither change undoes the other. Replay-safe: CREATE OR
-- REPLACE; the trigger is unchanged.

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
    'helper_dayof_confirmed_at',
    -- ADDED 20261004165404 (Q1189). The row's birth time: browse freshness
    -- and the early-access cutoff read it, and no poster path writes it.
    'created_at',
    -- ADDED 20261007032429 (Q1366). The live Checkout Session. Only
    -- create-payment (service role) stamps it and stripe-webhook (service
    -- role) clears it; a poster rewriting it could point void-cancelled-
    -- payments' PaymentIntent lookup at another session, or clear it to make
    -- an open checkout read as "no checkout" to EditJobDialog and this lock.
    'stripe_session_id'
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
    'start_time',
    -- ADDED 20261004165404 (Q1204, owner 2026-10-03): once a Helpr is booked
    -- the place and the details they agreed to are locked, like the schedule.
    -- PLACE: where the work is.
    'location',
    'parish',
    'zip_code',
    -- Coordinates are the place too: unlocked, a poster could move the pin
    -- with a PATCH and skip the location lock. The geocoder
    -- (backfill-job-geocode) writes them as service role, a server context.
    'latitude',
    'longitude',
    -- DETAILS: what the work is.
    'title',
    'description',
    'category',
    'special_requirements',
    'photos',
    'scope_video_url',
    'estimated_hours',
    -- With date_needed / start_time: "any time that day" vs a fixed time.
    'is_flexible_schedule',
    -- ADDED 20261004193548 (Q1245, lh-authz-rls review 2026-10-04): the
    -- terms the Helpr agreed to. TERMS: requires_w9 false -> true adds
    -- paperwork after the agreement (the require_photo_proof shape);
    -- credential_tier moves who qualifies; pricing_mode is how the price was
    -- set. SERIES: is_recurring and recurrence_interval are the series the
    -- Helpr signed up for (recurrence_days/weeks/end_date and series_split_ok
    -- are already locked by enforce_series_columns_client_lock).
    -- OWNERSHIP: department and business_id (the businesses feature was
    -- removed, 20260828011811). No SQL function, edge function or client
    -- update writes any of the seven (measured 2026-10-04), so the lock
    -- breaks no writer; the server keeps them (is_server_context passes).
    'requires_w9',
    'credential_tier',
    'pricing_mode',
    'is_recurring',
    'recurrence_interval',
    'department',
    'business_id',
    -- ADDED 20261006204113 (Q1461): what the poster said they will provide
    -- is part of the details the Helpr agreed to, like special_requirements.
    'materials_note'
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
      -- ADDED 20261003193541 (Q1180). report_helper_no_show's reopen clears
      -- the departed Helpr's acceptance stamps together with the unassign.
      -- Same flag and the same narrowness as the helper_id unassign below:
      -- the trusted ladder write, these two columns, cleared to NULL, in the
      -- UPDATE that sets helper_id NULL. A stamp left behind made the next
      -- Hire read as an already-accepted re-save (lh-authz-rls review F3).
      IF changed_col IN ('helper_confirmed_at', 'helper_dayof_confirmed_at')
         AND (CASE changed_col WHEN 'helper_confirmed_at' THEN NEW.helper_confirmed_at
                               ELSE NEW.helper_dayof_confirmed_at END) IS NULL
         AND NEW.helper_id IS NULL AND OLD.helper_id IS NOT NULL
         AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
        CONTINUE;
      END IF;
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
    -- require_photo_proof is NOT in the list: turning it OFF only relaxes the
    -- completion gate (enforce_helper_completion_gates reads it when the Helpr
    -- marks the job done), so the poster keeps that. Turning it ON adds work
    -- the Helpr did not agree to, so that direction is locked.
    IF OLD.require_photo_proof IS DISTINCT FROM TRUE
       AND NEW.require_photo_proof IS TRUE THEN
      RAISE EXCEPTION 'Posters may not change jobs.require_photo_proof once a Helpr is booked (job_id=%)', OLD.id
        USING ERRCODE = '42501',
              HINT = 'The place and details are locked once a Helpr is booked. Message them, or cancel and post the job again.';
    END IF;

    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_booked) THEN
        -- ADDED 20260927012809 (Q407 (8)): a new date / start time the Helpr
        -- ASKED for and this poster ACCEPTED. Its only writer is
        -- respond_job_schedule_change (20260927012807), which sets this
        -- transaction-local flag only after checking that the caller is the
        -- party the request is addressed to and the request is still live,
        -- and clears it right after its one UPDATE. Only the schedule columns
        -- pass; locked_always and locked_when_funded above still apply.
        -- 20261004165404: the carve-out covers the two schedule columns only,
        -- so the flag cannot also unlock the place and details above.
        IF changed_col IN ('date_needed', 'start_time')
           AND current_setting('app.schedule_change_rpc', true) = '1' THEN
          CONTINUE;
        END IF;
        IF changed_col IN ('date_needed', 'start_time') THEN
          RAISE EXCEPTION 'Posters may not move jobs.% once a Helpr is booked (job_id=%)', changed_col, OLD.id
            USING ERRCODE = '42501',
                  HINT = 'A booked Helpr planned around this time. Message them, or cancel and post the job again for the new time.';
        END IF;
        RAISE EXCEPTION 'Posters may not change jobs.% once a Helpr is booked (job_id=%)', changed_col, OLD.id
          USING ERRCODE = '42501',
                HINT = 'The place and details are locked once a Helpr is booked. Message them, or cancel and post the job again.';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_poster_jobs_money_lock() FROM PUBLIC, anon, authenticated;
