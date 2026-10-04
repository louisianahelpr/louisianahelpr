-- Q1204 + Q1189 (owner decision 2026-10-03 for Q1204).
--
-- Q1204: once a Helpr is booked, the place and the details are LOCKED, the
-- way Q423 (20260925231810) already locks date_needed and start_time.
-- BEFORE this migration the poster could PATCH location, parish, zip_code,
-- title, description, category, special_requirements, photos,
-- scope_video_url, estimated_hours and is_flexible_schedule on a job whose
-- Helpr had accepted, and the Helpr was never told: they could arrive at a
-- different address, or to a different job, than the one they agreed to.
-- The edit screen already disabled most of these inputs when jobs.helper_id
-- was set, but the trigger did not, so any other client (or a direct PATCH)
-- passed.
--
-- enforce_poster_jobs_money_lock (restated from its EFFECTIVE definition,
-- 20261003193541) adds to locked_when_booked, "booked" being what Q423 already
-- tests: jobs.helper_id is set, or a crew roster row names a Helpr. Column by
-- column:
--   location, parish, zip_code ... LOCK. The place the Helpr agreed to travel to.
--   latitude, longitude ......... LOCK. The map pin is the same place; left
--       open, a PATCH of the coordinates would move the job past the location
--       lock. The only writers are the post flow right after INSERT (job not
--       booked yet), backfill-job-geocode and purge_user_data (service role =
--       is_server_context(), which this trigger still lets through).
--   title, description, category, special_requirements ... LOCK. What the
--       work is; the Helpr priced and accepted it as written. (category also
--       sets the sales-tax class, trg_funded_category_tax_class.)
--   photos, scope_video_url ..... LOCK. The scope evidence the Helpr looked at.
--       Their only client writer, useJobMediaUpload, runs right after INSERT.
--   estimated_hours ............. LOCK. The size of the job they accepted.
--   is_flexible_schedule ........ LOCK. "Any time that day" vs a fixed time is
--       part of the schedule that date_needed / start_time already lock.
--   require_photo_proof ......... NOT a plain lock. enforce_helper_completion_
--       gates reads it when the Helpr marks the job done, so the poster
--       turning it OFF only relaxes the gate (kept allowed, as the edit
--       screen documents). Turning it ON adds work the Helpr did not agree
--       to, so false -> true is refused once booked.
-- Server writes are unchanged: is_server_context() returns before any of it.
-- The app.schedule_change_rpc carve-out (a schedule change the Helpr asked
-- for and the poster accepted, 20260927012809) is narrowed to date_needed and
-- start_time so the flag cannot also unlock the new columns.
--
-- Q1189: jobs.created_at was client-writable on INSERT (the lh-authz-rls
-- review of Q1181, measured on prod): a mailinator (seed) account could
-- backdate a job past deleted_jobs_log's 90-day window so its leftover files
-- were swept uncapped, and forge the freshness the browse ranking and the
-- early-access cutoff read. enforce_jobs_insert_column_lock (restated from
-- its EFFECTIVE definition, 20260924044812) now sets created_at := now() for
-- a signed-in poster's own INSERT (the column default is now(), so an honest
-- insert is unchanged), and created_at joins locked_always on UPDATE.
-- Server contexts (service role seeds, charge-recurring-visits) still pass
-- through untouched. NOT fixed here: jobs.id is still client-chosen on insert
-- (the review's second half); filed as its own item, not guessed at.
--
-- REPLAY-SAFE: CREATE OR REPLACE of two trigger functions the table already
-- runs (trg_poster_jobs_money_lock, trg_jobs_insert_column_lock);
-- PL/pgSQL resolves group_job_helpers at run time. Applied 3x in PGlite
-- (src/test/pglite/bookedJobLocked.pglite.mjs).
--
-- VERIFY LIVE after deploy (read-only):
--   SELECT pg_get_functiondef('public.enforce_poster_jobs_money_lock()'::regprocedure) ~ '''scope_video_url'''
--      AND pg_get_functiondef('public.enforce_jobs_insert_column_lock()'::regprocedure) ~ 'NEW\.created_at';  -- expect true
--   SELECT proacl FROM pg_proc WHERE oid IN ('public.enforce_poster_jobs_money_lock()'::regprocedure,
--                                            'public.enforce_jobs_insert_column_lock()'::regprocedure);
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
    'helper_dayof_confirmed_at',
    -- ADDED 20261004003046 (Q1189). The row's birth time: browse freshness
    -- and the early-access cutoff read it, and no poster path writes it.
    'created_at'
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
    -- ADDED 20261004003046 (Q1204, owner 2026-10-03): once a Helpr is booked
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
    'is_flexible_schedule'
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
        -- 20261004003046: the carve-out covers the two schedule columns only,
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

-- ===== Q1189: jobs.created_at is server-owned on INSERT =====
CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  -- A server context and anyone not inserting their own job pass through
  -- untouched. Same gate as the UPDATE money lock.
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;
  -- Q356: a series' standing helper is stamped from the hire, never posted.
  NEW.recurring_helper_id      := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.helper_arrival_near_miss_at := NULL;
  NEW.helper_arrival_near_miss_ft := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  -- Q1189: the row's birth time is the database's. A poster-supplied value
  -- would forge the storage sweep's 90-day trust window (deleted_jobs_log
  -- is keyed on it) and the browse freshness score / early-access cutoff.
  -- The column default is now(), so a normal insert is unchanged.
  NEW.created_at                  := now();

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.enforce_jobs_insert_column_lock() FROM PUBLIC, anon;
