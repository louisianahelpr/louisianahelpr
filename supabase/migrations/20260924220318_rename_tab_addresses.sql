-- Owner 2026-09-24: the tab addresses match the tabs.
--   /dashboard -> /home, /my-posts -> /posts, /my-jobs -> /jobs (no redirects).
--
-- 1. Every function that writes a notification link (or parses one) is
--    recreated from its live pg_get_functiondef with ONLY those address
--    strings changed. CREATE OR REPLACE keeps each function's owner and ACL.
-- 2. Stored notifications and dedupe suppressions still pointing at the old
--    addresses are deleted (owner's choice: "Delete the old notifications");
--    a link to an address the app no longer serves would open the 404 page.
-- 3. Route-probe rows for the old addresses can never be refreshed again.

CREATE OR REPLACE FUNCTION public.block_user_and_settle(p_blocked uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_committed boolean;
  v_updated int;
  v_settled jsonb := '[]'::jsonb;
  v_ladder_present boolean;
  v_closed_apps int;
  v_closed_offers int;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_blocked IS NULL OR p_blocked = v_user THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  -- The block itself first: whatever happens to the jobs below, the person
  -- asking to be left alone is left alone.
  INSERT INTO public.user_blocks (blocker_id, blocked_id, reason)
  VALUES (v_user, p_blocked, NULLIF(btrim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  -- ADDED 2026-09-23 (Q301): a banned caller keeps the block and settles
  -- nothing. The settle step's jobs UPDATE is refused by enforce_ban_gate,
  -- and because this is one transaction that refusal used to roll the block
  -- back too, so a banned user could not block someone they shared a live
  -- job with. Blocking while banned is allowed (Q281); cancelling a job and
  -- pricing its fee is not.
  IF public.is_caller_banned() THEN
    RETURN jsonb_build_object('blocked', p_blocked, 'settled', '[]'::jsonb, 'settle_skipped', 'account_restricted');
  END IF;

  v_ladder_present :=
    to_regprocedure('public.apply_cancellation_violation_consequence(uuid)') IS NOT NULL;

  FOR v_job IN
    SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
           j.helper_confirmed_at, j.status
      FROM public.jobs j
     WHERE j.status IN ('accepted', 'in_progress', 'revision_requested')
       -- ADDED 2026-09-14: finished work is not cancelled by a block.
       AND j.helper_completed_at IS NULL
       AND (
            (j.customer_id = v_user     AND j.helper_id = p_blocked)
         OR (j.customer_id = p_blocked  AND j.helper_id = v_user)
       )
     FOR UPDATE
  LOOP
    -- CHANGED 2026-09-23: committed, not merely assigned — the same predicate
    -- poster_cancel_job and _shared/cancellationFee.ts helperIsCommitted use.
    -- A Helpr who was chosen but never accepted lost no committed time.
    v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;

    -- CHANGED 2026-09-05: anchored on start_time, matching poster_cancel_job.
    -- Both settle paths must price a cancellation identically or the fee a
    -- poster is quoted depends on which exit they happened to take.
    v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
    v_percent := public.cancellation_fee_percent(v_committed, v_hours);
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;

    -- The pinned columns (cancellation_*, late_cancellation) are legitimate
    -- server writes here, and the blocker may be the HELPER seat, which the
    -- helper column whitelist would otherwise reject. `app.sanctioned_cancel`
    -- additionally satisfies trg_cancellation_requires_rpc: this IS one of the
    -- sanctioned exits. Both hatches are transaction-local and switched off
    -- again immediately after the statement.
    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    PERFORM set_config('app.sanctioned_cancel', 'on', true);

    UPDATE public.jobs
       SET status = 'cancelled',
           cancelled_by = v_user,
           cancelled_at = now(),
           cancellation_reason = 'Cancelled because one party blocked the other.',
           late_cancellation = public.is_late_cancellation(v_committed, v_hours),
           cancellation_fee = v_fee,
           cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
     WHERE id = v_job.id
       AND status IN ('accepted', 'in_progress', 'revision_requested')
       AND helper_completed_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    PERFORM set_config('app.trusted_ladder_write', 'off', true);
    PERFORM set_config('app.sanctioned_cancel', 'off', true);

    IF v_updated = 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      p_blocked,
      'Job cancelled',
      CASE
        WHEN v_fee > 0 AND v_job.helper_id = p_blocked THEN
          format('"%s" was cancelled. Because it was cancelled late, a $%s cancellation fee applies and your share is on its way — it settles within the hour.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled late, so a $%s cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        ELSE
          format('"%s" was cancelled. No cancellation fee applies.', COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      CASE WHEN v_job.helper_id = p_blocked THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
    );

    -- The reliability strike, through the SAME ladder the normal cancel path
    -- uses. It authorises off auth.uid() = customer_id internally, so it is a
    -- no-op (raises 'not_authorized') for the helper-blocks-poster direction —
    -- only call it in the seat it is written for.
    -- CHANGED 2026-09-23: gated on v_committed, as poster_cancel_job is.
    IF v_ladder_present AND v_job.customer_id = v_user AND v_committed THEN
      PERFORM public.apply_cancellation_violation_consequence(v_job.id);
    END IF;

    v_settled := v_settled || jsonb_build_object(
      'job_id', v_job.id,
      'title', v_job.title,
      'cancellation_fee', v_fee,
      'fee_percent', v_percent
    );
  END LOOP;

  -- ADDED 2026-09-24 (Q345): what is still PENDING between the two closes too.
  -- Pending applications, either seat: closed silently (notify_on_application
  -- skips closed_reason = 'party_blocked'). Neither the row nor its absence of
  -- a notice says who blocked whom.
  UPDATE public.applications a
     SET status = 'rejected',
         closed_reason = 'party_blocked'
    FROM public.jobs j
   WHERE j.id = a.job_id
     AND a.status = 'pending'
     AND (
          (a.helper_id = v_user    AND j.customer_id = p_blocked)
       OR (a.helper_id = p_blocked AND j.customer_id = v_user)
     );
  GET DIAGNOSTICS v_closed_apps = ROW_COUNT;

  -- A pending direct offer between the two: declined, as if the offered person
  -- had declined it — the job reopens to everyone (C4 no longer reserves it).
  -- Silent: no "Offer declined" notice.
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE direct_offer_status = 'pending'
     -- Only an answerable offer (the "Targeted helper can respond" policy's
     -- shape). A row with helper_id set is not one, and from the helper seat
     -- enforce_helper_jobs_column_whitelist would refuse the write and roll the
     -- block back with it (measured on prod, rolled back, 2026-09-24).
     AND helper_id IS NULL
     AND (
          (customer_id = v_user    AND offered_to_helper_id = p_blocked)
       OR (customer_id = p_blocked AND offered_to_helper_id = v_user)
     );
  GET DIAGNOSTICS v_closed_offers = ROW_COUNT;

  RETURN jsonb_build_object(
    'blocked', p_blocked,
    'settled', v_settled,
    'closed_applications', v_closed_apps,
    'closed_offers', v_closed_offers
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.decline_job_offer(p_application_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_app_helper uuid;
  v_job_helper uuid;
  v_job_title text;
  v_customer uuid;
  v_result jsonb;
BEGIN
  SELECT a.job_id, a.helper_id
    INTO v_job_id, v_app_helper
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Only the helper who owns the application may decline it.
  IF v_app_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Lock the job row — serializes against a concurrent accept/confirm.
  SELECT j.helper_id, j.title, j.customer_id
    INTO v_job_helper, v_job_title, v_customer
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- The offer must still be held by this helper (guards a double
  -- decline — the first call already cleared jobs.helper_id).
  IF v_job_helper IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;

  v_result := public.apply_job_denial_consequence(
    v_app_helper, v_job_id,
    'Declined job offer: "' || COALESCE(v_job_title, 'Unknown') || '"');

  UPDATE public.applications SET status = 'rejected' WHERE id = p_application_id;
  UPDATE public.jobs
     SET status = 'open', helper_id = NULL, response_deadline = NULL
   WHERE id = v_job_id;

  -- ADDED 2026-09-05. Written HERE, in the same transaction as the reopen,
  -- rather than from the client: the client's own admin fan-out for this event
  -- is structurally dead (RLS), and the notifications INSERT policy is
  -- admin/service-role only, so an ordinary helper's browser cannot write this
  -- row at all. A SECURITY DEFINER RPC is the only seat that can.
  -- customer_id is nullable (account deletion anonymises rather than deletes),
  -- and notifications.user_id is NOT NULL — so guard it rather than throwing
  -- inside a decline that has otherwise already succeeded.
  IF v_customer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_customer,
      'Offer declined — job reopened',
      'Your Helpr turned down "' || COALESCE(v_job_title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/posts?job=' || v_job_id::text
    );
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
    RETURNING id, customer_id, title
  ), notified AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT customer_id,
           'Direct offer expired',
           'Your offer for "' || title || '" was not accepted in time. The job is now visible to all helpers.',
           'job_updates',
           '/posts?job=' || id::text
      FROM expired
     WHERE customer_id IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_unanswered_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_locked record;
  v_app_id uuid;
  v_count int := 0;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    SELECT j.id, j.title, j.customer_id, j.helper_id
      INTO v_locked
      FROM public.jobs j
     WHERE j.id = v_job.id
       AND j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
     FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT a.id INTO v_app_id
      FROM public.applications a
     WHERE a.job_id = v_locked.id
       AND a.helper_id = v_locked.helper_id
       AND a.status = 'accepted'
     LIMIT 1;

    -- ONE ladder for the whole reliability family — see
    -- apply_job_denial_consequence (20260824243000). The literal copy this
    -- replaced is exactly the drift hazard its own comment warned about.
    PERFORM public.apply_job_denial_consequence(
      v_locked.helper_id, v_locked.id,
      'Let a job offer expire without answering: "' || COALESCE(v_locked.title, 'Unknown') || '"');

    IF v_app_id IS NOT NULL THEN
      UPDATE public.applications SET status = 'rejected' WHERE id = v_app_id;
    END IF;

    UPDATE public.jobs
       SET status = 'open',
           helper_id = NULL,
           response_deadline = NULL
     WHERE id = v_locked.id;

    -- Both sides are told, because both sides were waiting on this.
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_locked.customer_id,
      'Offer expired — job reopened',
      'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/posts?job=' || v_locked.id::text,
      v_locked.id
    );

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_locked.helper_id,
      'You lost a job offer',
      'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
        || '" and it went back to everyone. Letting an offer expire counts the same as declining it.',
      'expired',
      '/jobs?job=' || v_locked.id::text,
      v_locked.id
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.helper_abort_job(p_job_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_uid uuid := auth.uid();
  v_reason text;
  v_work_started boolean;
  v_dispute_id uuid;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required'
      USING HINT = 'Tell the poster why you can''t finish.';
  END IF;
  -- Keep it a sentence, not an essay dumped into a notification body.
  v_reason := left(v_reason, 1000);

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.helper_arrived_at, j.helper_completed_at,
         j.proof_before_urls, j.proof_after_urls
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Server owns the decision: only the ASSIGNED helper, only from a state
  -- this exit is actually for. A poster (or any third party) hitting this
  -- gets not_authorized, not a partial write.
  IF v_job.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_job.status NOT IN ('in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_abortable'
      USING HINT = 'Only a job that is underway can be abandoned this way.';
  END IF;

  v_work_started :=
        v_job.helper_arrived_at IS NOT NULL
     OR v_job.helper_completed_at IS NOT NULL
     OR COALESCE(array_length(v_job.proof_before_urls, 1), 0) > 0
     OR COALESCE(array_length(v_job.proof_after_urls, 1), 0) > 0;

  -- The strike lands first and identically in both branches — the ladder does
  -- not care which settlement path the money takes.
  v_result := public.apply_job_denial_consequence(
    v_uid, v_job.id,
    'Abandoned a job in progress: "' || COALESCE(v_job.title, 'Unknown')
      || '" — ' || v_reason);

  IF v_work_started THEN
    -- ── Branch B: partial work exists → a human decides who gets what. ──
    v_dispute_id := public.rpc_open_dispute(
      v_job.id,
      'Helpr could not finish the job: ' || v_reason,
      '{}'::text[]);

    -- Admin-only from here (see header): never auto-release to the abandoner.
    UPDATE public.jobs
       SET dispute_status = 'escalated'
     WHERE id = v_job.id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      'Your Helpr couldn''t finish',
      'Your Helpr had to stop work on "' || COALESCE(v_job.title, 'your job')
        || '": ' || v_reason
        || ' Because work had already started, we''re reviewing it — your payment stays in escrow until a decision is made, and you don''t need to do anything.',
      'warning',
      '/posts?job=' || v_job.id::text,
      v_job.id
    );

    RETURN v_result || jsonb_build_object(
      'outcome', 'disputed',
      'dispute_id', v_dispute_id);
  END IF;

  -- ── Branch A: nothing was done → reopen, no money moves. ──
  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = v_uid AND status = 'accepted';

  -- Same clean slate helper_cancel_booking leaves, so the day-of machinery
  -- runs fresh for the next helper rather than inheriting this one's stamps.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         helper_on_the_way_at = NULL,
         helper_arrived_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL,
         revision_requested_at = NULL,
         revision_note = NULL,
         revision_deadline = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (
    v_job.customer_id,
    'Your Helpr couldn''t finish',
    'Your Helpr had to drop "' || COALESCE(v_job.title, 'your job')
      || '": ' || v_reason
      || ' They never started, so nothing was charged — the job is open to everyone again and your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/posts?job=' || v_job.id::text,
    v_job.id
  );

  RETURN v_result || jsonb_build_object('outcome', 'reopened');
END;
$function$;

CREATE OR REPLACE FUNCTION public.helper_cancel_booking(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_starts_at timestamptz;
  v_result jsonb;
BEGIN
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status,
         j.date_needed, j.start_time, j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_job.helper_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status <> 'accepted' THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Only a booked job that has not started can be cancelled this way.';
  END IF;
  -- ADDED 2026-09-14: reopening would hand the next Helpr this one's done stamp.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'You already marked this job done, so it can''t be cancelled. Message the poster or open a dispute.';
  END IF;

  -- Once the start has passed this is a no-show question, not a cancellation.
  v_starts_at := ((v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time))
                    AT TIME ZONE 'America/Chicago');
  IF v_starts_at IS NOT NULL AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'job_already_started'
      USING HINT = 'The scheduled start has passed — contact the poster or support.';
  END IF;

  v_result := public.apply_job_denial_consequence(
    auth.uid(), v_job.id,
    'Cancelled after committing to: "' || COALESCE(v_job.title, 'Unknown') || '"');

  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = v_job.id AND helper_id = auth.uid() AND status = 'accepted';

  -- Reopen with a clean slate for the next helper: confirmation stamps and
  -- the reminder sent-ats reset so the day-of machinery runs fresh.
  UPDATE public.jobs
     SET status = 'open',
         helper_id = NULL,
         response_deadline = NULL,
         helper_confirmed_at = NULL,
         helper_dayof_confirmed_at = NULL,
         dayof_confirm_reminder_sent_at = NULL,
         dayof_unanswered_poster_alert_sent_at = NULL,
         start_reminder_sent_at = NULL
   WHERE id = v_job.id;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    v_job.customer_id,
    'Your Helpr cancelled',
    'Your Helpr can''t make "' || COALESCE(v_job.title, 'your job')
      || '" — it''s open to everyone again. Your payment stays protected in escrow for whoever you pick next.',
    'warning',
    '/posts?job=' || v_job.id::text
  );

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_helper_arrival(p_job_id uuid, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
  v_dist double precision;
  v_verified boolean := false;
  v_near_miss boolean := false;
  v_new_window boolean := false;
  v_now timestamptz := now();
  v_basis text;
  v_arrived_at timestamptz;
BEGIN
  -- FOR UPDATE: a double tap must not run two verdicts against one row.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'Arrival can only be marked on an accepted or in-progress job.';
  END IF;

  -- ALREADY SETTLED BY THE POSTER. Their tap IS the arrival under the new
  -- rule, so there is nothing left for a retry to establish and nothing to
  -- re-measure — a pin known to be wrong must not be measured against again.
  -- No write. (Generalised from the 20260915074058 near-miss-only carve-out.)
  IF v_job.poster_confirmed_arrival_at IS NOT NULL
     AND v_job.helper_arrived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', v_job.helper_arrived_at,
      'verified', v_job.helper_arrival_verified_at IS NOT NULL,
      'basis', 'already_confirmed',
      'distance_ft', v_job.helper_arrival_near_miss_ft,
      'poster_confirmed', true,
      'poster_confirmation_required', false,
      'poster_can_confirm', false,
      'arrival_established', true
    );
  END IF;

  -- ALREADY VERIFIED. A second call (double tap, a retry after a lost
  -- response) must not be refused because the Helpr has since walked to their
  -- van, and must never DOWNGRADE the verification to a bare claim. No write.
  IF v_job.helper_arrival_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', COALESCE(v_job.helper_arrived_at, v_job.helper_arrival_verified_at),
      'verified', true,
      'basis', 'already_verified',
      'distance_ft', NULL,
      'poster_confirmed', false,
      'poster_confirmation_required', true,
      'poster_can_confirm', true,
      'arrival_established', false
    );
  END IF;

  -- WHAT DID THE LOCATION PROVE? Every branch below RECORDS the arrival; they
  -- differ only in whether they can also verify it. Nothing raises.
  IF p_lat IS NULL OR p_lng IS NULL THEN
    -- Location off, denied, or no fix. Owner, 2026-09-19: "if gps is not on,
    -- they can mark themselves as arrived but can not move on until the poster
    -- marks them arrived."
    v_basis := 'no_location';
  ELSIF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    v_basis := 'location_invalid';
  ELSIF v_job.latitude IS NULL OR v_job.longitude IS NULL THEN
    -- The job itself never geocoded, so there is nothing to measure against. A
    -- real fix is the best evidence available; accept it rather than punishing
    -- the Helpr for the poster's address. (Unchanged from 20260915044137.)
    v_verified := true;
    v_basis := 'no_job_coordinates';
  ELSE
    -- Haversine, in feet (earth radius 20 902 231 ft) — the same 500 ft
    -- threshold the client shows. LEAST(1, …) keeps asin in its domain for a
    -- near-antipodal fix, where rounding can push the argument past 1.
    v_dist := 20902231 * 2 * asin(LEAST(1::double precision, sqrt(
      power(sin(radians((p_lat - v_job.latitude)::double precision) / 2), 2)
      + cos(radians(v_job.latitude::double precision))
        * cos(radians(p_lat::double precision))
        * power(sin(radians((p_lng - v_job.longitude)::double precision) / 2), 2)
    )));
    IF v_dist <= 500 THEN
      v_verified := true;
      v_basis := 'gps_verified';
    ELSIF v_dist <= 5280 THEN
      -- BAD PIN (VN-33(b), 20260915074058), recorded exactly as before. The
      -- stamp is the FIRST near miss of a 12-hour window, not the latest: the
      -- no-show hold (report_helper_no_show GUARD 0b) and the admin escalation
      -- count from it, so a Helpr who keeps tapping from 1,500 ft away cannot
      -- hold them open indefinitely. The distance is always the latest.
      v_near_miss := true;
      v_basis := 'near_miss';
      v_new_window := v_job.helper_arrival_near_miss_at IS NULL
                      OR v_job.helper_arrival_near_miss_at <= v_now - interval '12 hours';
    ELSE
      -- Beyond a mile. Recorded as a claim and nothing more: no verification,
      -- no near-miss stamp (the near-miss columns mean "close enough that the
      -- pin is the likely culprit", and a mile out is not that). The poster's
      -- confirmation is what can still move this job, and they are told the
      -- Helpr marked arrived by notify_poster_on_status_change.
      v_basis := 'too_far';
    END IF;
  END IF;

  -- THE WRITE. One statement, so a double tap cannot interleave two.
  --   helper_arrived_at           first claim wins; a retry never re-stamps it.
  --   helper_arrival_verified_at  set only on a genuine verification, and only
  --                               if not already set — a later claim from the
  --                               van can never clear or move it.
  --   near-miss columns           as before.
  --   status                      accepted → in_progress, because the Helpr is
  --                               on site. This is NOT the working unlock; that
  --                               is the tracker's 'working' row, gated on the
  --                               poster's confirmation below.
  -- The transaction-local flag is what lets the helper column whitelist admit
  -- these four columns from this ONE function; it is dropped the moment its
  -- single UPDATE is done, so nothing later in the transaction inherits it.
  PERFORM set_config('app.arrival_rpc', '1', true);
  UPDATE public.jobs
     SET helper_arrived_at = COALESCE(helper_arrived_at, v_now),
         helper_arrival_verified_at = CASE
           WHEN v_verified THEN COALESCE(helper_arrival_verified_at, v_now)
           ELSE helper_arrival_verified_at END,
         helper_arrival_near_miss_at = CASE
           WHEN v_near_miss AND v_new_window THEN v_now
           ELSE helper_arrival_near_miss_at END,
         helper_arrival_near_miss_ft = CASE
           WHEN v_near_miss THEN round(v_dist)::integer
           ELSE helper_arrival_near_miss_ft END,
         status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END
   WHERE id = p_job_id
   RETURNING helper_arrived_at INTO v_arrived_at;
  PERFORM set_config('app.arrival_rpc', '0', true);

  -- One near-miss notice per 12-hour window, however often the Helpr retries
  -- (arrival-confirm-reminder sends the follow-ups). The generic "<Helpr> has
  -- arrived" notice is sent by notify_poster_on_status_change off
  -- helper_arrived_at, which now fires for EVERY recorded arrival; this extra
  -- one exists because it carries the distance and names the control.
  IF v_near_miss AND v_new_window AND v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Is your Helpr at the door?',
      '"' || v_job.title || '" — their location is ' || round(v_dist)::bigint
        || ' ft from the map pin. If they are there, tap Confirm They Arrived.',
      'job_updates',
      '/posts?job=' || p_job_id
    );
  END IF;

  -- THE VERDICT. `poster_confirmation_required` is true on every path that
  -- reaches here: the owner's rule is that the poster confirms either way, so
  -- a verified arrival is just as blocked as a fix-less one. `poster_can_confirm`
  -- is kept (and widened from the near-miss-only case) so the currently shipped
  -- client, which branches on it, degrades into telling the Helpr the truth
  -- rather than into an error toast.
  RETURN jsonb_build_object(
    'arrival_recorded', true,
    'arrived_at', v_arrived_at,
    'verified', v_verified,
    'basis', v_basis,
    'distance_ft', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist::numeric) END,
    'poster_confirmed', false,
    'poster_confirmation_required', true,
    'poster_can_confirm', NOT v_verified,
    'arrival_established', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.notification_job_id_from_link(p_link text)
 RETURNS uuid
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NULLIF(
           COALESCE(
             -- '?job=' / '&job=' — the canonical Activity deep link. Anchored
             -- on '=' so it cannot also match 'jobId='.
             (regexp_match(p_link, '[?&]job=([0-9a-fA-F-]{36})'))[1],
             -- '/messages?jobId=<job>&userId=<user>' — param-anchored so the
             -- trailing userId is never picked up.
             (regexp_match(p_link, '[?&]jobId=([0-9a-fA-F-]{36})'))[1],
             -- '/home?quickApply=<job>' — the single most common link in
             -- the product (485 rows). src/pages/home/QuickApplyHandler.tsx
             -- looks this id up with .eq("id", …) against jobs.
             (regexp_match(p_link, '[?&]quickApply=([0-9a-fA-F-]{36})'))[1],
             -- '/jobs/<job>' — the public job detail route (App.tsx:257).
             (regexp_match(p_link, '^/jobs/([0-9a-fA-F-]{36})'))[1]
           ),
           ''
         )::uuid
$function$;

CREATE OR REPLACE FUNCTION public.notify_helper_application_viewed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_title text;
BEGIN
  -- Only fire on the first view (NULL → non-NULL transition)
  IF NEW.poster_viewed_at IS NULL OR OLD.poster_viewed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Only notify pending applications (not already decided)
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;

  INSERT INTO public.notifications (
    user_id, title, message, type, link, job_id
  ) VALUES (
    NEW.helper_id,
    'Your application was seen',
    'The poster viewed your application for "' || COALESCE(v_job_title, 'a job') || '".',
    'info',
    '/jobs?highlight=' || NEW.id,
    NEW.job_id
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id)
  THEN
    SELECT COALESCE(full_name, 'A poster') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      '/jobs?job=' || NEW.id::text,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- The triggers' WHEN clauses already guarantee funded, so this is a
  -- belt-and-braces re-assertion for any future direct call.
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN
    RETURN NEW;
  END IF;

  -- A job under a LIVE direct offer is addressed mail, not open-pool work.
  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  -- Fixtures, on the same authority the browse surfaces use.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/home?job=' || NEW.id::text;

  FOR helper_record IN
    WITH candidates AS (
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.parish = NEW.parish
        AND (
          EXISTS (SELECT 1 FROM public.applications a WHERE a.helper_id = p2.user_id)
          OR EXISTS (SELECT 1 FROM public.jobs j2 WHERE j2.helper_id = p2.user_id)
        )
    )
    SELECT DISTINCT c.user_id AS helper_id
    FROM candidates c
    JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = c.user_id
    WHERE p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND c.user_id <> NEW.customer_id
      -- CHANGED 2026-09-11. This read `np.new_offers`, which is the switch
      -- labelled "Job Offers" on the prefs screen and belongs to DIRECT
      -- offers. A helper muting direct offers silently muted parish matches
      -- too, and a helper wanting to mute matches had no way to. Unset still
      -- means on: most accounts have no preferences row.
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Digest mode is an explicit "batch these, don't ping me". This producer
      -- has no queue to route into, so it stands down and sweep_daily_job_digest
      -- covers them.
      AND COALESCE(np.match_digest_mode, false) IS FALSE
      -- CREDENTIAL GATE (20260905201818).
      AND (
        COALESCE(NEW.credential_tier, 0) = 0
        OR COALESCE(public.get_user_credential_tier(c.user_id), 0) >= NEW.credential_tier
      )
      -- N-007: once per (job, Helpr). A funded job that leaves 'open' and comes
      -- back re-fires this trigger; it must not re-notify the whole parish.
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.user_id = c.user_id AND n.job_id = NEW.id AND n.type = 'job_match'
      )  -- N-007 once per job
      -- N-007: at most 10 parish matches per Helpr per hour (measured peak on
      -- prod 2026-09-24: 4). Past it the job is still on their browse feed.
      AND (
        SELECT count(*) FROM public.notifications n
         WHERE n.user_id = c.user_id AND n.type = 'job_match'
           AND n.created_at > now() - interval '1 hour'
      ) < 10  -- N-007 hourly cap
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link, NEW.id);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', helper_record.helper_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    v_message := 'Someone applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/posts?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF COALESCE(v_email_enabled, true) THEN
      SELECT email, full_name INTO v_profile FROM public.profiles WHERE user_id = v_user_id;
      IF v_profile.email IS NOT NULL THEN
        PERFORM net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
          ),
          body := jsonb_build_object(
            'user_id', v_user_id,
            'title', v_title,
            'message', v_message,
            'type', v_type,
            'link', v_link
          )
        );
      END IF;
    END IF;
  END IF;

  -- NO 'accepted' branch. The client (useOfferHandlers) is the single
  -- producer for an accept: only it knows the response deadline the poster
  -- picked, and only its link ('/jobs?filter=offered') reaches the screen
  -- where the helper can actually accept before that deadline runs out.

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    -- ADDED 2026-09-23 (Q274): the backfill below closes applications on jobs
    -- that were cancelled long ago. Nobody is owed a notice for that.
    IF current_setting('app.q274_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    -- ADDED 2026-09-24 (Q345): closed because one of the two blocked the
    -- other. A notice would be contact the blocker asked not to have, and
    -- "not selected" would be false when the applicant is the one who blocked.
    IF NEW.closed_reason = 'party_blocked' THEN
      RETURN NEW;
    END IF;
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    -- ADDED 2026-09-23 (Q274): closed because the JOB was cancelled, not
    -- because anyone turned this applicant down. "Not selected" would be false.
    IF NEW.closed_reason = 'job_cancelled' THEN
      v_message := '"' || COALESCE(job_title, 'A job') || '" was cancelled, so your application is closed';
    ELSE
      v_message := 'Your application for "' || job_title || '" was not selected';
      -- The poster's own words, when they left any. This is the whole reason
      -- the client used to fire a SECOND notification.
      IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
        v_message := v_message || ': ' || btrim(NEW.decline_reason);
      END IF;
    END IF;
    v_type := 'info';
    -- A rejected application buckets to `cancelled` on the applied tab
    -- (appliedActivityBucket). '/home' showed the job board instead.
    v_link := '/jobs?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF COALESCE(v_email_enabled, true) THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id, 'title', v_title, 'message', v_message, 'type', v_type, 'link', v_link
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_job_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Job completed!', '"' || NEW.title || '" has been marked complete. Payment is being processed.', 'payment', '/jobs?job=' || NEW.id::text);
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.helper_id IS NOT NULL
     AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.helper_id, 'Job cancelled', '"' || OLD.title || '" has been cancelled by the poster.', 'warning', '/jobs?job=' || OLD.id::text);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow') THEN
    v_title := 'Payment secured in escrow';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held in escrow and will release after the job is completed.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.customer_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = NEW.helper_id;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', 'Payment for "' || NEW.title || '" is now in escrow. Get to work!', 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_poster_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_helper_name text;
  v_category text;
  v_title text;
  v_msg text;
  v_pref_in_app boolean;
  v_link text;
BEGIN
  IF NEW.helper_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The poster's active job lives in the "Scheduled" bucket of My Posts
  -- (postedActivityBucket: in_progress → scheduled). The old
  -- '/posts?job=<id>' used a param the page never reads and landed on the
  -- default "Needs you" list, which hides in-progress jobs.
  v_link := '/posts?job=' || NEW.id::text;
  SELECT COALESCE(full_name, 'Your Helpr') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' is on the way';
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '"';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '"';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    v_title := 'Work has started';
    v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
    v_msg := v_helper_name || ' has finished "' || NEW.title || '". Please review and confirm.';
    -- A completed claim IS the poster's move — send them where the confirm
    -- action lives.
    v_link := '/posts?job=' || NEW.id::text;

  ELSE
    RETURN NEW;
  END IF;

  -- Check in-app pref for poster
  SELECT
    CASE v_category
      WHEN 'transit_updates' THEN COALESCE(transit_updates, true)
      WHEN 'work_status' THEN COALESCE(work_status, true)
      ELSE true
    END INTO v_pref_in_app
  FROM public.notification_preferences WHERE user_id = NEW.customer_id;

  IF COALESCE(v_pref_in_app, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link, NEW.id);
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'sent', v_title, NEW.id);
  ELSE
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'skipped', v_title, NEW.id, 'preference_off');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
BEGIN
  IF NEW.status <> 'open'
     OR COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
  THEN
    RETURN NEW;
  END IF;

  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_is_urgent := COALESCE(NEW.is_urgent, false);
  v_title := 'New job matches your saved search';
  v_link  := '/home?job=' || NEW.id::text;

  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids,
      COALESCE(BOOL_OR(np.match_digest_mode), false)    AS digest_mode
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      -- ADDED 2026-09-11. These rows are type 'job_match'; the category switch
      -- is the master over every saved search. Unset means on.
      AND COALESCE(np.job_matches, true) IS TRUE
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.query IS NULL
        OR btrim(s.query) = ''
        OR strpos(lower(NEW.title), lower(btrim(s.query))) > 0
        OR strpos(lower(COALESCE(NEW.description, '')), lower(btrim(s.query))) > 0
      )
      AND (
        s.location_keyword IS NULL
        OR s.location_keyword ~ '^nearby:'
        OR strpos(lower(COALESCE(NEW.location, '')), lower(s.location_keyword)) > 0
      )
      AND (
        s.radius_miles IS NULL
        OR (
          p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
          AND public.miles_between(p.latitude, p.longitude, NEW.latitude, NEW.longitude) <= s.radius_miles
        )
        OR (
          (p.latitude IS NULL OR p.longitude IS NULL
           OR NEW.latitude IS NULL OR NEW.longitude IS NULL)
          AND p.parish IS NOT NULL
          AND NEW.parish IS NOT NULL
          AND p.parish = NEW.parish
        )
      )
      -- ST-011: the hourly throttle stops notification spam, so it applies only
      -- where this job would notify now. A digest match is batched by
      -- daily-match-digest already; throttling it dropped later matches.
      AND (
        s.last_notified_at IS NULL
        OR s.last_notified_at < now() - interval '1 hour'
        OR (COALESCE(np.match_digest_mode, false) AND NOT v_is_urgent) -- ST-011 digest unthrottled
      )
    GROUP BY s.user_id
  LOOP
    IF match_record.digest_mode AND NOT v_is_urgent THEN
      INSERT INTO public.match_digest_queue (user_id, job_id)
      VALUES (match_record.user_id, NEW.id)
      ON CONFLICT (user_id, job_id) DO NOTHING;
    ELSE
      -- ST-011: the throttle is spent only when the user is actually notified.
      UPDATE public.saved_searches
         SET last_notified_at = now()
       WHERE id = ANY(match_record.matched_search_ids); -- ST-011 stamp on notify only

      v_message :=
        'A new job matches "' || match_record.search_name || '": '
        || NEW.title || ' ($' || NEW.budget || ')'
        || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);

      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', match_record.user_id,
          'title', v_title,
          'message', v_message,
          'type', 'job_match',
          'link', v_link
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_user_on_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_link text;
  v_job_title text;
  v_customer_id uuid;
  v_reviewer_name text;
  v_revealed boolean;
BEGIN
  SELECT title, customer_id INTO v_job_title, v_customer_id
    FROM public.jobs WHERE id = NEW.job_id;

  -- Is this review visible to its subject right now? The visibility trigger
  -- runs AFTER INSERT alongside this one, so read the reciprocal directly
  -- rather than trusting NEW.feedback_visible_at, which may not be set yet.
  SELECT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE job_id = NEW.job_id
      AND reviewee_id = NEW.reviewer_id
      AND id <> NEW.id
  ) INTO v_revealed;

  IF v_revealed THEN
    SELECT COALESCE(full_name, 'Someone') INTO v_reviewer_name
      FROM public.profiles WHERE user_id = NEW.reviewer_id;
    v_title := 'New review from ' || v_reviewer_name;
    v_msg := 'You got a ' || NEW.rating || '-star review for "'
             || COALESCE(v_job_title, 'a job') || '".';
    -- Nothing to write; the ask is "come read it".
    v_link := '/profile?tab=reviews';
  ELSE
    -- Held. Say a review exists and nothing more — no rating, no name.
    v_title := 'You have a new review';
    v_msg := 'Someone reviewed you for "' || COALESCE(v_job_title, 'a job')
             || '". It unlocks once you review them too, or in 14 days.';
    -- The ask IS to write one, so land on the surface that can.
    -- A job whose row has gone (or a review with no job) has no Activity card
    -- to land on, so it falls back to the read-only tab rather than to a
    -- /posts?job= link naming nothing.
    IF NEW.job_id IS NULL OR v_customer_id IS NULL THEN
      v_link := '/profile?tab=reviews';
    ELSIF NEW.reviewee_id = v_customer_id THEN
      v_link := '/posts?job=' || NEW.job_id;
    ELSE
      v_link := '/jobs?job=' || NEW.job_id;
    END IF;
  END IF;

  SELECT COALESCE(reviews, true) INTO v_pref
  FROM public.notification_preferences WHERE user_id = NEW.reviewee_id;

  IF COALESCE(v_pref, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (NEW.reviewee_id, v_title, v_msg, 'review', v_link, NEW.job_id);
    PERFORM public.log_notification(NEW.reviewee_id, 'review', 'in_app', 'sent', v_title, NEW.job_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := _opener_id;
  _system boolean := _opener_id IS NULL;
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
  _reason_trimmed text;
  _velocity_count integer;
  _payment_status text;
BEGIN
  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. Applies to the platform too: a
  -- system filing has to say what happened in the same words a person would.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — an admin decides this from your words.';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added in 20260901032007 is the backstop; this is what makes the loser WAIT
  -- and then take the existing-dispute branch instead of erroring.
  SELECT customer_id, helper_id, title, status::text, payment_status
    INTO _customer, _helper, _title, _status, _payment_status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  -- DONE IS FINAL (owner, 2026-09-14). A completed job cannot be disputed by
  -- either party, and an open dispute row on one cannot be appended to or used
  -- to re-freeze it. Human callers only: the one system caller
  -- (auto-release-payment's undelivered-revision sweep) files on
  -- revision_requested jobs, never completed ones, and its path is unchanged.
  -- Ahead of the existing-dispute branch on purpose, so its re-freeze from
  -- 'completed' is unreachable for a person.
  -- (Live guard from 20260915025607, kept verbatim when this migration was
  -- re-derived from the live definition on 2026-09-15.)
  IF NOT _system AND _status = 'completed' THEN
    RAISE EXCEPTION 'job_already_completed'
      USING HINT = 'Once a job is marked done it is final.';
  END IF;

  -- ── Evidence is the filer's own uploads, nothing else (authz review of the
  -- dispute-races rebase, MEDIUM). Both the new-dispute path and the re-file
  -- branch below store `_evidence_urls` verbatim, and they render as <a>/<img>
  -- in the admin console and the other party's dialog. A person may attach only
  -- signed proof-photos URLs for their own uploads on this job
  -- (dispute_evidence_url_ok, section 8); the platform files with none.
  IF _system THEN
    IF COALESCE(cardinality(_evidence_urls), 0) > 0 THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url'
        USING HINT = 'A platform filing carries no evidence.';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(COALESCE(_evidence_urls, '{}'::text[])) AS e(u)
     WHERE NOT public.dispute_evidence_url_ok(e.u, _uid, _job_id)
  ) THEN
    RAISE EXCEPTION 'dispute_evidence_invalid_url'
      USING HINT = 'Only photos you uploaded to this dispute can be attached.';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- ── Not over a decided dispute whose money has not moved ────────────────
  -- rpc_decide_dispute leaves the job completed/cancelled with the escrow held
  -- until execute-dispute-split settles it. A party re-filing then flipped the
  -- job back to `disputed` (and a withdrawal to in_progress), which handed the
  -- escrow to Quick Release / Quick Refund / the sweep and, via
  -- poster_cancel_job, to void-cancelled-payments — each settling over the
  -- admin's decision, and "Retry settlement" moving the split on top (both
  -- reviews, round 2, HIGH; live shape on prod: job bb2c3732 / dispute
  -- c7a12050). The decision stands until it executes.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id
       AND d.status = 'decided'
       AND d.execution_status IS DISTINCT FROM 'executed'
  ) THEN
    RAISE EXCEPTION 'dispute_already_decided'
      USING HINT = 'An admin has already decided this dispute and its payment is being settled.';
  END IF;

  -- ── Not while the escrow is being cancelled ─────────────────────────────
  -- `cancelling` is cancel_escrow's claim: its Stripe refund is in flight.
  -- A dispute stamped onto that job made it `disputed` with the refund still
  -- going out, and an admin Quick Release then paid the Helpr beside it.
  -- claim_dispute_settlement now refuses that shape too; this stops it being
  -- created. Read under the FOR UPDATE above, so cancel_escrow's claim either
  -- committed first (visible here) or waits behind this filing (and its own
  -- status-pinned claim then matches zero rows).
  IF _payment_status = 'cancelling' THEN
    RAISE EXCEPTION 'dispute_payment_being_cancelled'
      USING HINT = 'This job''s payment is being cancelled and refunded, so it can no longer be disputed.';
  END IF;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    -- Set-like append, 20260915034822. A DOUBLE SUBMIT from the dispute
    -- dialog — two clicks inside one JS task, both past the React-state
    -- `submitting` flag because state does not land until the next render —
    -- sends two calls. The second blocks on the FOR UPDATE above, then lands
    -- HERE, and with a bare `||` it appended the SAME evidence urls a second
    -- time: the admin queue showed each photo twice and `evidence_urls` grew
    -- without bound on every retry. The client now holds a synchronous ref
    -- guard as well (DisputeDialog.tsx), but a guard in the browser is not a
    -- guarantee; this is.
    UPDATE public.disputes
    SET evidence_urls = (
          SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
            FROM (
              SELECT u, min(ord) AS ord
                FROM unnest(
                       evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
                     ) WITH ORDINALITY AS t(u, ord)
               GROUP BY u
            ) d
        )
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls = (
             SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
               FROM (
                 SELECT u, min(ord) AS ord
                   FROM unnest(
                          COALESCE(dispute_evidence_urls, '{}'::text[])
                            || COALESCE(_evidence_urls, '{}'::text[])
                        ) WITH ORDINALITY AS t(u, ord)
                  GROUP BY u
               ) d
           )
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind (it writes `jobs`, never this
    -- table), and this branch used to RETURN without touching the job — so a
    -- re-file inside the payout hold appended evidence, reported success, and
    -- left the escrow free to pay out. Only re-freeze from a state the
    -- transition matrix allows, so this can never raise on a job that has
    -- legitimately moved on.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    -- Page ops on a re-freeze but not on a bare evidence append. A re-freeze
    -- means money was one payout-hold away from leaving on a job somebody is
    -- still contesting; an extra photo on an already-frozen dispute is not
    -- news at 3am.
    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    -- NO velocity check on this branch, deliberately. This is a re-file on a
    -- dispute that already exists, and both mirror columns are COALESCEd above
    -- precisely so it does not restamp. The job was already counted the first
    -- time; counting it again here would flag people for uploading a second
    -- photo.
    --
    -- This is ALSO the sweep's idempotency guard: a second pass over a job
    -- whose dispute the platform already opened lands here, appends nothing
    -- and returns the SAME id. No duplicate row, no second notification.
    RETURN _existing_id;
  END IF;

  -- ── The job must still be disputable, 20260915034822 ────────────────────
  -- The re-freeze branch above has always checked `_status` against the
  -- transition matrix's own `-> disputed` edges. The NEW-dispute path below
  -- never did: it inserted the row and stamped status='disputed'
  -- unconditionally. `_status` was read under the FOR UPDATE above, so a
  -- concurrent `poster_cancel_job` / completion / payout either commits BEFORE
  -- this call takes the lock (and is therefore visible in `_status`) or waits
  -- behind it — which is exactly why checking it here closes the window
  -- instead of merely narrowing it.
  --
  -- Without it, filing a dispute that raced a cancellation either stamped
  -- `disputed` onto a cancelled job (freezing an escrow that had already been
  -- refunded) or raised `enforce_job_status_transition`'s raw Postgres prose at
  -- the filer. A terse code instead, so `lifecycleErrorMessage` can say what
  -- happened; the allowed set is the same list the re-freeze branch uses.
  IF _status NOT IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger (BEFORE UPDATE, keyed on the flip to
  -- 'disputed') sees a non-null disputed_at and can derive the 72h deadline.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         dispute_status = 'open',
         dispute_evidence_urls =
           COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
   -- Belt and braces on the predicate above: the same allowed set, written
   -- into the statement itself so the freeze can never land on a job that
   -- moved on, even if a future edit drops the IF.
   WHERE id = _job_id
     AND status::text IN ('completed', 'in_progress', 'revision_requested', 'accepted');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Delivers "3+ disputes in 30 days flags your account for review."
  --
  -- Skipped entirely for a system filing: `disputed_by` is NULL, nobody chose
  -- to file, and flagging an account for the platform's own sweep would turn a
  -- stalled revision into a fraud signal against whichever party the count
  -- happened to land on.
  --
  -- Runs AFTER the UPDATE above on purpose: that statement is what stamps
  -- disputed_by/disputed_at, so the dispute being filed right now is inside
  -- the window the check counts. check_dispute_velocity returns TRUE while
  -- UNDER the limit, so `NOT ...` is "this filing put them at or past it".
  --
  -- Wrapped, and this is the one place in this function where swallowing is
  -- correct: the purpose of this RPC is to FREEZE THE MONEY on a contested
  -- job. Failing to file a risk signal must never be the reason a real
  -- dispute does not freeze.
  IF NOT _system THEN
    BEGIN
      IF NOT public.check_dispute_velocity(_uid) THEN
        -- One open flag per account at a time. Every further dispute past the
        -- threshold is more of the same signal, and an admin resolving the flag
        -- is what re-arms it.
        IF NOT EXISTS (
          SELECT 1 FROM public.fraud_flags
          WHERE user_id = _uid AND flag_type = 'high_dispute_rate' AND resolved = false
        ) THEN
          SELECT count(*) INTO _velocity_count
            FROM public.jobs
           WHERE disputed_by = _uid
             AND disputed_at > now() - interval '30 days';

          INSERT INTO public.fraud_flags (user_id, job_id, flag_type, details)
          VALUES (
            _uid,
            _job_id,
            'high_dispute_rate',
            'Opened ' || _velocity_count || ' disputes in the last 30 days, at or over the '
              || 'review threshold. Most recent: "' || COALESCE(_title, 'a job') || '".'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'open_dispute_as: dispute-velocity flag failed for % on job %: %',
        _uid, _job_id, SQLERRM;
    END;
  END IF;

  -- ── Tell the people this affects ────────────────────────────────────────
  -- A human filing tells the counterparty (the filer knows already). A system
  -- filing tells BOTH, because neither of them did this and neither is
  -- expecting it.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own.
  IF _system THEN
    IF _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'Revision deadline passed — dispute opened',
        'The revision you requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so we opened a dispute for you. ' ||
          'The payment stays on hold and an admin will decide it — add your side.',
        'warning',
        '/posts?job=' || _job_id::text
      );
    END IF;
    IF _helper IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _helper,
        'Revision deadline passed — dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'An admin will decide the payment — add your side.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END IF;
  ELSIF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/posts?job=' || _job_id::text
           ELSE '/jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      _admin,
      'Job disputed',
      '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
      'warning',
      '/admin?view=disputes',
      _job_id
    );
  END LOOP;

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_reason text;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_late boolean;
  v_committed boolean;
  v_commission numeric;
  v_helper_cut numeric;
  v_verdict jsonb := jsonb_build_object('action', 'none', 'prior_count', 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);

  SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
         j.status, j.helper_fee_percent, j.helper_confirmed_at,
         j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- The server owns the decision. A helper (or any third party) hitting this
  -- gets not_authorized rather than a partial write.
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Deliberately NOT 'pending_approval': enforce_job_status_transition has no
  -- pending_approval -> cancelled edge for a non-admin, so offering it here
  -- would promise an exit the very next trigger rejects. That draft is
  -- withdrawn through reject_pending_job, which is the business-approval path.
  -- 'disputed' is excluded too: escrow must not move while a human is deciding.
  IF v_job.status::text NOT IN ('open', 'accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'This job is already finished, cancelled, or under dispute.';
  END IF;

  -- ADDED 2026-09-14: a job the Helpr has marked DONE is not cancellable.
  -- From here the poster's moves are approve, ask for a change, or dispute —
  -- never a cancel that refunds the escrow and pays a cancellation fee for
  -- finished work. No poster screen offers Cancel once work is underway
  -- (derivePosterStep renders no Cancel for in_progress/revision_requested),
  -- so the only way here was a stale screen racing the Helpr's Done. Read under
  -- the FOR UPDATE above: a Done that committed first is seen here, and a Done
  -- queued behind this lock is refused by trg_completion_on_live_job.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Your Helpr already marked this job done. Approve it, ask for a change, or open a dispute.';
  END IF;

  -- ADDED 2026-09-08: the one question both the fee and the strike turn on.
  -- Chosen is not committed; see this migration's header.
  v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;

  -- The fee is DERIVED here, never accepted from the caller — same ladder
  -- void-cancelled-payments recomputes from, so the persisted row and the money
  -- that moves can no longer disagree.
  -- CHANGED 2026-09-05: now anchored on the job's START TIME, not midnight of
  -- its day. See that migration's header for the 41-hours-reads-as-23 case.
  v_hours   := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
  v_percent := public.cancellation_fee_percent(v_committed, v_hours);
  v_fee := CASE
    WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
      THEN round(v_job.budget * v_percent) / 100.0
    ELSE 0
  END;
  -- CHANGED 2026-08-26: was `v_hours < 24 AND v_hours > 0`, which called a
  -- post-start cancellation "not late" while charging it the top 50% tier.
  v_late := public.is_late_cancellation(v_committed, v_hours);

  PERFORM set_config('app.sanctioned_cancel', 'on', true);

  UPDATE public.jobs
     SET status = 'cancelled'::job_status,
         cancelled_by = v_uid,
         cancelled_at = now(),
         cancellation_reason = v_reason,
         late_cancellation = v_late,
         cancellation_fee = v_fee,
         cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
   WHERE id = v_job.id;

  PERFORM set_config('app.sanctioned_cancel', 'off', true);

  -- Tell the Helpr what happened to their money. This used to be a separate
  -- client-side createNotification() that a cancelling client could skip.
  -- Still sent to a merely-offered Helpr: they were waiting on this job and
  -- deserve to know it is gone — but with copy that does not promise a fee.
  IF v_job.helper_id IS NOT NULL THEN
    v_commission := COALESCE(v_job.helper_fee_percent, 10);
    v_helper_cut := GREATEST(0, round((v_fee - round(v_fee * v_commission) / 100.0) * 100) / 100.0);

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.helper_id,
      CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
      CASE
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled by the poster. You''ll receive approximately $%s as a cancellation fee (%s%% of the budget minus platform fee), processed within the hour.',
                 COALESCE(v_job.title, 'A job'),
                 to_char(v_helper_cut, 'FM999999990.00'),
                 v_percent)
        WHEN NOT v_committed THEN
          -- The old copy claimed "it was more than 24 hours out", which is
          -- simply false when the reason for the $0 is that this offer was
          -- never accepted.
          format('"%s" was cancelled by the poster before you accepted it, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
        ELSE
          format('"%s" was cancelled by the poster. It was more than 24 hours out, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/jobs?job=' || v_job.id::text
    );
  END IF;

  -- THE LADDER, in the same transaction as the state change. Idempotent on
  -- (user, 'cancel_with_helper', job_id), so one cancelled job is one strike
  -- however many times this is retried.
  -- CHANGED 2026-09-08: gated on v_committed, not on helper_id alone.
  IF v_committed THEN
    v_verdict := public.apply_cancellation_violation_consequence(v_job.id);
  END IF;

  RETURN v_verdict || jsonb_build_object(
    'cancellation_fee', v_fee,
    'fee_percent', v_percent,
    'late_cancellation', v_late,
    -- Kept under its original key so existing callers keep parsing, but it now
    -- answers the question the callers were always really asking.
    'had_helper', v_committed,
    'helper_committed', v_committed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(p_job_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_customer uuid;
  v_app_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- Q345: no hire across a block, in either direction. The applications
    -- trigger (C10) would refuse the INSERT below anyway; naming it here gives
    -- the caller a code this RPC owns, and copy for it. Accept branch only:
    -- declining an offer across a block is still allowed.
    IF public.are_users_blocked(auth.uid(), v_customer) THEN
      RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
    END IF;

    -- The real applications row the synthetic 'direct-<id>' stood in for.
    -- ON CONFLICT covers the helper who somehow also applied to the same job
    -- before the offer landed: promote their existing row instead of
    -- colliding with the (job_id, helper_id) unique index.
    INSERT INTO public.applications (job_id, helper_id, message, status)
    VALUES (p_job_id, auth.uid(), NULL, 'accepted')
    ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
    RETURNING id INTO v_app_id;

    UPDATE public.jobs
       SET status = 'accepted',
           helper_id = auth.uid(),
           direct_offer_status = 'accepted',
           -- The helper accepting IS the confirmation. There is no second
           -- "confirm you'll be there" step on this path — the poster already
           -- chose them, so requiring another tap would strand the job in
           -- accepted-but-unconfirmed forever.
           helper_confirmed_at = v_now,
           response_deadline = NULL,
           direct_offer_expires_at = NULL
     WHERE id = p_job_id;

    RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         'Your direct offer for "' || title || '" was declined. The job is open to all helpers again.',
         'job_updates',
         '/posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_decide_dispute(_dispute_id uuid, _decision_text text, _payout_split jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _job_id uuid;
  _customer_id uuid;
  _helper_id uuid;
  _job_title text;
  _existing_status text;
  _poster_share numeric;
  _helper_share numeric;
  _new_job_status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _decision_text IS NULL OR length(trim(_decision_text)) = 0 THEN
    RAISE EXCEPTION 'decision_text required';
  END IF;

  -- Lock order jobs -> disputes (lh-authz-rls review of the rebase). The job
  -- id is looked up unlocked (disputes.job_id never changes), the job is
  -- locked, then the dispute row, and its status is judged under that lock.
  SELECT job_id INTO _job_id
    FROM public.disputes
   WHERE id = _dispute_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  -- FOR UPDATE, 20260915034822 (round 4): the claim check below must read under
  -- the same jobs lock claim_dispute_settlement takes before it inserts, so a
  -- Quick Release / Quick Refund / sweep either committed its claim first
  -- (visible, refused) or waits behind this decision (and then finds the job
  -- no longer disputed). Lock order jobs -> disputes.
  SELECT customer_id, helper_id, title
    INTO _customer_id, _helper_id, _job_title
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- The dispute is judged from THIS locked re-read, not the unlocked lookup
  -- above (lh-money-escrow review, MEDIUM-2). Its own NOT FOUND is load-
  -- bearing: a dispute deleted between the lookup and this lock leaves
  -- `_existing_status` NULL, and `NULL <> 'open'` is NULL — falling through the
  -- gate and letting the UPDATE below strand the job's escrow. `IS DISTINCT
  -- FROM` so a NULL that slips past NOT FOUND still refuses.
  SELECT status INTO _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _existing_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'dispute already %', COALESCE(_existing_status, 'gone');
  END IF;

  -- An admin who is a party to the job does not rule on it (round-4 review).
  IF _uid = _customer_id OR _uid = _helper_id THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to decide its dispute.';
  END IF;

  -- Not while a settlement holds (or a dead holder stamped) the escrow: a
  -- decision recorded under a live Quick Release became a decided, unexecuted
  -- split over an escrow that had just been paid out (round-4 review). An
  -- expired claim that never stamped a money step moved nothing.
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'This dispute''s payment is being settled right now, so it can''t be decided. Refresh in a few minutes.';
  END IF;

  _poster_share := COALESCE((_payout_split->>'poster')::numeric, 0.5);
  _helper_share := COALESCE((_payout_split->>'helper')::numeric, 0.5);
  IF _poster_share > 1 OR _helper_share > 1 THEN
    _poster_share := _poster_share / 100.0;
    _helper_share := _helper_share / 100.0;
  END IF;

  IF _poster_share >= 1 AND _helper_share <= 0 THEN
    _new_job_status := 'cancelled';
  ELSE
    _new_job_status := 'completed';
  END IF;

  UPDATE public.disputes
     SET status = 'decided',
         decided_at = now(),
         decided_by = _uid,
         decision_text = _decision_text,
         payout_split = jsonb_build_object(
           'poster', _poster_share,
           'helper', _helper_share
         ),
         -- The decision is on record; the money is not. Until
         -- execute-dispute-split flips this to 'executed', this dispute is
         -- UNSETTLED and stays in the admin's open work.
         execution_status = COALESCE(disputes.execution_status, 'pending')
   WHERE id = _dispute_id;

  UPDATE public.jobs
     SET status = _new_job_status::public.job_status,
         dispute_resolved_at = now(),
         dispute_status = 'resolved'
   WHERE id = _job_id;

  IF _customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _customer_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'your job') || '": ' || _decision_text,
      '/posts?job=' || _job_id::text,
      false
    );
  END IF;

  IF _helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _helper_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'a job you worked') || '": ' || _decision_text,
      '/jobs?job=' || _job_id::text,
      false
    );
  END IF;

  -- Audit-log entry so this admin action shows up alongside every other
  -- admin mutation in AdminAuditLog. Non-fatal — the decision itself has
  -- already committed; a failed audit write shouldn't roll it back.
  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      _uid,
      'decide_dispute',
      _dispute_id,
      'dispute',
      jsonb_build_object(
        'job_id', _job_id,
        'poster_share', _poster_share,
        'helper_share', _helper_share,
        'new_job_status', _new_job_status,
        'decision_preview', left(_decision_text, 200)
      )
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_escalate_dispute(_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _dispute_status text;
  _other uuid;
  _admin uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- FOR UPDATE for the same reason rpc_open_dispute takes it: two parties can
  -- escalate the same dispute at the same instant, and the second one must
  -- read the first one's write rather than both fanning out to every admin.
  SELECT customer_id, helper_id, title, status::text, dispute_status
    INTO _customer, _helper, _title, _status, _dispute_status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  IF _status <> 'disputed' THEN
    RAISE EXCEPTION 'job is not disputed';
  END IF;

  -- Already escalated is a NO-OP, not an error. Both parties can now escalate
  -- and the control stays on screen; making the second tap fail would show an
  -- error for an action whose desired end state already holds. Returning early
  -- also means the admin fan-out happens exactly once per escalation.
  IF _dispute_status = 'escalated' THEN
    RETURN _job_id;
  END IF;

  -- The two pre-decision values of the mirror column. Anything else
  -- ('auto_resolved', 'resolved') means the dispute is over and there is
  -- nothing left to hand an admin.
  IF _dispute_status IS NOT NULL AND _dispute_status NOT IN ('open', 'helper_responded') THEN
    RAISE EXCEPTION 'dispute is no longer open';
  END IF;

  UPDATE public.jobs
     SET dispute_status = 'escalated'
   WHERE id = _job_id;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- The counterparty: the decision just moved to a human and the deadline they
  -- were watching will no longer fire.
  IF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'Dispute escalated to an admin',
      'The dispute on "' || COALESCE(_title, 'a job') ||
        '" was escalated. An admin will decide it — the payment stays on hold until they do.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/posts?job=' || _job_id::text
           ELSE '/jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- The admins, who are the ones who actually decide it. This is the half that
  -- could not be done from the client at all. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _admin,
      'Dispute escalated',
      '"' || COALESCE(_title, 'a job') || '" dispute has been escalated and needs an admin decision. Payment is on hold.',
      -- `admin_alert`, not `warning`: this is addressed to admins only, and
      -- typing it as a severity puts it in the same preference bucket as
      -- party-facing warnings (N-011).
      'admin_alert',
      '/admin?view=disputes&job=' || _job_id::text
    );
  END LOOP;

  RETURN _job_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_group_member_mark_arrival(_job_id uuid, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_slot uuid;
  v_row record;
  v_job record;
  v_dist double precision;
  v_verified boolean := false;
  v_near_miss boolean := false;
  v_new_window boolean := false;
  v_basis text;
  v_now timestamptz := now();
  v_arrived_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_slot := public.group_member_slot(_job_id, v_uid);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'not_on_this_crew' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.group_job_helpers WHERE id = v_slot FOR UPDATE;
  SELECT j.status::text AS status, j.latitude, j.longitude, j.title, j.customer_id
    INTO v_job
  FROM public.jobs j WHERE j.id = _job_id;

  IF v_job.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'Arrival can only be marked on an accepted or in-progress job.';
  END IF;

  -- Already settled by the poster for this member: nothing left to establish
  -- and nothing to re-measure. No write.
  IF v_row.poster_confirmed_arrival_at IS NOT NULL AND v_row.helper_arrived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', v_row.helper_arrived_at,
      'verified', v_row.helper_arrival_verified_at IS NOT NULL,
      'basis', 'already_confirmed',
      'poster_confirmation_required', false,
      'arrival_established', true
    );
  END IF;

  -- Already verified: a retry must never DOWNGRADE the verification. No write.
  IF v_row.helper_arrival_verified_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'arrival_recorded', true,
      'arrived_at', COALESCE(v_row.helper_arrived_at, v_row.helper_arrival_verified_at),
      'verified', true,
      'basis', 'already_verified',
      'poster_confirmation_required', true,
      'arrival_established', false
    );
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    v_basis := 'no_location';
  ELSIF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    v_basis := 'location_invalid';
  ELSIF v_job.latitude IS NULL OR v_job.longitude IS NULL THEN
    v_verified := true;
    v_basis := 'no_job_coordinates';
  ELSE
    -- Haversine in feet (earth radius 20 902 231 ft), the same 500 ft threshold
    -- the client shows. LEAST(1, …) keeps asin in its domain.
    v_dist := 20902231 * 2 * asin(LEAST(1::double precision, sqrt(
      power(sin(radians((p_lat - v_job.latitude)::double precision) / 2), 2)
      + cos(radians(v_job.latitude::double precision))
        * cos(radians(p_lat::double precision))
        * power(sin(radians((p_lng - v_job.longitude)::double precision) / 2), 2)
    )));
    IF v_dist <= 500 THEN
      v_verified := true;
      v_basis := 'gps_verified';
    ELSIF v_dist <= 5280 THEN
      v_near_miss := true;
      v_basis := 'near_miss';
      v_new_window := v_row.helper_arrival_near_miss_at IS NULL
                      OR v_row.helper_arrival_near_miss_at <= v_now - interval '12 hours';
    ELSE
      v_basis := 'too_far';
    END IF;
  END IF;

  UPDATE public.group_job_helpers
     SET helper_arrived_at = COALESCE(helper_arrived_at, v_now),
         helper_arrival_verified_at = CASE
           WHEN v_verified THEN COALESCE(helper_arrival_verified_at, v_now)
           ELSE helper_arrival_verified_at END,
         helper_arrival_near_miss_at = CASE
           WHEN v_near_miss AND v_new_window THEN v_now
           ELSE helper_arrival_near_miss_at END,
         helper_arrival_near_miss_ft = CASE
           WHEN v_near_miss THEN round(v_dist)::integer
           ELSE helper_arrival_near_miss_ft END
   WHERE id = v_slot
   RETURNING helper_arrived_at INTO v_arrived_at;

  UPDATE public.jobs SET status = 'in_progress' WHERE id = _job_id AND status = 'accepted';

  IF v_job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.customer_id,
      'Is your Helpr at the door?',
      '"' || COALESCE(v_job.title, 'Your job') || '" — a crew member marked themselves arrived'
        || CASE WHEN v_near_miss THEN ', ' || round(v_dist)::bigint || ' ft from the map pin' ELSE '' END
        || '. If they are there, tap Confirm They Arrived.',
      'job_updates',
      '/posts?job=' || _job_id
    );
  END IF;

  RETURN jsonb_build_object(
    'arrival_recorded', true,
    'arrived_at', v_arrived_at,
    'verified', v_verified,
    'basis', v_basis,
    'distance_ft', CASE WHEN v_dist IS NULL THEN NULL ELSE round(v_dist::numeric) END,
    'poster_confirmation_required', true,
    'arrival_established', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_supersede_dispute_decision(_dispute_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d record;
  _job_status text;
  _payment_status text;
  _customer uuid;
  _helper uuid;
  _title text;
  _moved boolean;
  _new_id uuid;
  _job_id_lookup uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'supersede_needs_reason'
      USING HINT = 'Say why this decision can never execute — it goes in the audit log.';
  END IF;

  -- Lock order jobs -> disputes (lh-authz-rls review of the rebase): job id
  -- looked up unlocked (it never changes), job locked, then the dispute row.
  SELECT job_id INTO _job_id_lookup FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT status::text, payment_status, customer_id, helper_id, title
    INTO _job_status, _payment_status, _customer, _helper, _title
    FROM public.jobs
   WHERE id = _job_id_lookup
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT id, job_id, opener_id, reason, evidence_urls, status, decided_at, decided_by,
         decision_text, payout_split, execution_status, execution_started_at,
         execution_error, execution_transfer_id, execution_refund_id
    INTO _d
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;
  -- NOT FOUND on the LOCKED re-read is load-bearing (lh-money-escrow review,
  -- MEDIUM-2): a dispute deleted between the unlocked lookup above and this
  -- lock leaves _d all-NULL, and `NULL <> 'decided' OR NULL = 'executed'` is
  -- NULL — the gate below would fall through and the job UPDATE would strand the
  -- escrow. IS DISTINCT FROM so a NULL still refuses.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;
  IF _d.status IS DISTINCT FROM 'decided' OR _d.execution_status = 'executed' THEN
    RAISE EXCEPTION 'supersede_not_supersedable'
      USING HINT = 'Only a decided dispute whose split has not executed can be superseded.';
  END IF;

  IF _uid = _customer OR _uid = _helper THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to supersede its decision.';
  END IF;

  -- A split run inside the TTL may be between its execution claim (step 6) and
  -- its settlement claim (6b), where no claim row exists yet; one that started
  -- longer ago than any edge invocation can live is dead, and the ledger and
  -- leg checks below decide whether it moved anything.
  IF _d.execution_status = 'executing'
     AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl() THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'This decision''s split is executing right now; wait for it to finish or fail.';
  END IF;

  -- A live claim means a settlement is running; a STAMPED one (live or dead)
  -- means its holder reached a Stripe money call. An expired unstamped claim
  -- moved nothing and does not block. Read under the jobs lock
  -- claim_dispute_settlement also takes.
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _d.job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'A settlement of this job is running or stopped part-way; reconcile it before superseding.';
  END IF;

  IF COALESCE(_payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
    RAISE EXCEPTION 'supersede_escrow_not_held'
      USING HINT = 'This job''s escrow is no longer held, so there is no decision left to supersede.';
  END IF;

  _moved := _d.execution_transfer_id IS NOT NULL
         OR _d.execution_refund_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.payout_transfers t
                     WHERE t.job_id = _d.job_id AND t.status IN ('pending', 'paid', 'reversed'))
         OR EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _d.job_id);
  IF NOT _moved AND to_regclass('public.gift_cards') IS NOT NULL THEN
    _moved := EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = _d.job_id);
  END IF;
  IF _moved THEN
    RAISE EXCEPTION 'supersede_money_moved'
      USING HINT = 'Money has already moved for this job, so the decision cannot be superseded — reconcile against Stripe by hand.';
  END IF;

  -- disputes_one_open_per_job_idx: the new row needs the job to have no other
  -- open dispute. Checked, not left to the unique violation.
  IF EXISTS (SELECT 1 FROM public.disputes o WHERE o.job_id = _d.job_id AND o.status = 'open') THEN
    RAISE EXCEPTION 'dispute_already_open';
  END IF;

  -- The trail FIRST, and not wrapped: voiding an admin's money decision with
  -- no record would be worse than refusing.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    _uid,
    'supersede_dispute_decision',
    'dispute',
    _d.id,
    jsonb_build_object(
      'job_id', _d.job_id,
      'reason', btrim(_reason),
      'decided_at', _d.decided_at,
      'decided_by', _d.decided_by,
      'decision_text', _d.decision_text,
      'payout_split', _d.payout_split,
      'execution_status', _d.execution_status,
      'execution_error', _d.execution_error,
      'job_status', _job_status,
      'payment_status', _payment_status
    )
  );

  -- Retired, not rewritten: its decision and execution record stay as they were.
  UPDATE public.disputes
     SET status = 'superseded'
   WHERE id = _d.id;

  -- The new dispute. opener_id NULL: the platform re-opened it, so no party can
  -- withdraw it (rpc_withdraw_dispute is opener-only); the evidence carries over.
  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (
    _d.job_id,
    NULL,
    'Re-opened by an admin after the earlier decision could not be carried out: ' || btrim(_reason)
      || E'\n\nOriginal dispute: ' || COALESCE(_d.reason, ''),
    COALESCE(_d.evidence_urls, '{}'::text[])
  )
  RETURNING id INTO _new_id;

  -- Back under dispute, escalated. dispute_resolved_at cleared so nothing
  -- reads the superseded decision as a resolution; disputed_at kept (or set,
  -- for a job that never carried one) so set_dispute_deadline derives a
  -- deadline and the overdue-escalation reminder reaches an admin.
  UPDATE public.jobs
     SET status = 'disputed',
         dispute_status = 'escalated',
         dispute_resolved_at = NULL,
         disputed_at = COALESCE(disputed_at, now())
   WHERE id = _d.job_id;

  IF _customer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (_customer, 'Dispute re-opened',
      'An admin is taking another look at the dispute on "' || COALESCE(_title, 'a job') ||
        '". The payment stays on hold until a new decision is made.',
      'info', '/posts?job=' || _d.job_id::text);
  END IF;
  IF _helper IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (_helper, 'Dispute re-opened',
      'An admin is taking another look at the dispute on "' || COALESCE(_title, 'a job') ||
        '". The payment stays on hold until a new decision is made.',
      'info', '/jobs?job=' || _d.job_id::text);
  END IF;

  RETURN _new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_sent integer := 0;
  budget_lo integer;
  budget_hi integer;
BEGIN
  FOR rec IN
    WITH new_jobs AS (
      SELECT j.id, j.parish, j.budget, j.credential_tier, COALESCE(j.is_seed, false) AS is_seed
      FROM public.jobs j
      WHERE j.status = 'open'
        AND j.created_at > NOW() - INTERVAL '24 hours'
        AND j.parish IS NOT NULL
        AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    )
    SELECT
      p.user_id,
      p.parish,
      pc.cnt,
      pc.min_budget,
      pc.max_budget
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(public.get_user_credential_tier(p.user_id), 0) AS tier
    ) ut
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)        AS cnt,
        MIN(nj.budget)  AS min_budget,
        MAX(nj.budget)  AS max_budget
      FROM new_jobs nj
      WHERE nj.parish = p.parish
        AND (COALESCE(nj.credential_tier, 0) = 0 OR ut.tier >= nj.credential_tier)
        -- Q137: a seed job is news only to a seed account.
        AND (NOT nj.is_seed OR COALESCE(p.is_seed, false))
    ) pc
    WHERE p.parish IS NOT NULL
      AND pc.cnt > 0
      AND p.email_verified
      AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
      AND (np.user_id IS NULL OR COALESCE(np.job_matches, true) IS TRUE)
      AND EXISTS (
        SELECT 1 FROM public.applications WHERE helper_id = p.user_id
        UNION ALL
        SELECT 1 FROM public.jobs WHERE customer_id = p.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = p.user_id
          AND n.title LIKE 'New jobs in%'
          AND n.created_at > NOW() - INTERVAL '23 hours'
      )
  LOOP
    BEGIN
      budget_lo := FLOOR(rec.min_budget)::integer;
      budget_hi := CEIL(rec.max_budget)::integer;
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'job_match',
        format('New jobs in %s', rec.parish),
        format(
          '%s new %s posted in the last 24 hours — %s. Tap to browse.',
          rec.cnt,
          CASE WHEN rec.cnt = 1 THEN 'job' ELSE 'jobs' END,
          CASE
            WHEN budget_lo = budget_hi THEN format('$%s', budget_lo)
            ELSE format('$%s to $%s', budget_lo, budget_hi)
          END
        ),
        '/home',
        false
      );
      total_sent := total_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_daily_job_digest', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id, 'parish', rec.parish));
      RAISE NOTICE 'sweep_daily_job_digest: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN total_sent;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_daily_job_digest', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'sent_before_failure', total_sent));
  RETURN total_sent;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_dayof_confirm_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
  v_start timestamptz;
BEGIN
  -- Pass 1: window open — remind the unanswered parties.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id, j.helper_id,
           j.helper_confirmed_at, j.helper_dayof_confirmed_at, j.poster_confirmed_at,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_confirm_reminder_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      v_start := rec.scheduled_start;
      -- Helper: skip when the day-of stamp exists OR the accept itself
      -- happened inside the window (same grace as JobConfirmation).
      IF rec.helper_dayof_confirmed_at IS NULL
         AND (rec.helper_confirmed_at IS NULL
              OR v_start - rec.helper_confirmed_at > INTERVAL '24 hours') THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.helper_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on. One tap keeps your spot.', rec.title),
                '/jobs?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      IF rec.poster_confirmed_at IS NULL THEN
        INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
        VALUES (rec.customer_id, 'job_update', 'Still on for tomorrow?',
                format('"%s" starts soon — tap to confirm you''re still on so your Helpr knows it''s a go.', rec.title),
                '/posts?job=' || rec.id::text, false, rec.id);
        total_pushed := total_pushed + 1;
      END IF;
      UPDATE public.jobs SET dayof_confirm_reminder_sent_at = NOW() WHERE id = rec.id;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p1:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 1, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p1: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  -- Pass 2: T-12h and the helper still hasn't answered — alert the poster.
  FOR rec IN
    SELECT j.id, j.title, j.customer_id,
           ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') AS scheduled_start
    FROM public.jobs j
    WHERE j.dayof_unanswered_poster_alert_sent_at IS NULL
      AND j.status = 'accepted'
      AND j.helper_id IS NOT NULL
      AND j.date_needed IS NOT NULL
      AND j.helper_dayof_confirmed_at IS NULL
      AND (j.helper_confirmed_at IS NULL
           OR ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago') - j.helper_confirmed_at > INTERVAL '24 hours')
      AND ((j.date_needed + COALESCE(j.start_time, '09:00'::time)) AT TIME ZONE 'America/Chicago')
            BETWEEN NOW() AND NOW() + INTERVAL '12 hours'
    ORDER BY (j.date_needed + j.start_time)
    LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (rec.customer_id, 'warning', 'Your Helpr hasn''t confirmed yet',
              format('"%s" starts in under 12 hours and your Helpr hasn''t confirmed they''re still on. Message them — or line up a backup while there''s time.', rec.title),
              '/posts?job=' || rec.id::text, false, rec.id);
      UPDATE public.jobs SET dayof_unanswered_poster_alert_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_dayof_confirm_reminders', format('p2:%s', rec.id), SQLERRM,
        jsonb_build_object('pass', 2, 'job_id', rec.id));
      RAISE NOTICE 'sweep_dayof_confirm_reminders p2: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;

  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_dayof_confirm_reminders', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_release_last_chance()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_pushed integer := 0;
BEGIN
  FOR rec IN
    SELECT j.id, j.title, j.customer_id
      FROM public.jobs j
     WHERE j.release_last_chance_notif_sent_at IS NULL
       AND j.status = 'in_progress'
       AND j.payment_status = 'escrow'
       AND j.poster_completed_at IS NULL
       AND j.revision_requested_at IS NULL
       AND j.helper_completed_at IS NOT NULL
       -- inside the final 2 hours of the 24h window
       AND j.helper_completed_at <= NOW() - INTERVAL '22 hours'
       AND j.helper_completed_at >  NOW() - INTERVAL '24 hours'
     ORDER BY j.helper_completed_at
     LIMIT 100
  LOOP
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, link, read, job_id)
      VALUES (
        rec.customer_id,
        'warning',
        'Last chance to review',
        format('"%s" auto-releases payment in about 2 hours. Approve it, or request a revision now if something''s wrong.', rec.title),
        '/posts?job=' || rec.id::text,
        false,
        rec.id
      );
      UPDATE public.jobs SET release_last_chance_notif_sent_at = NOW() WHERE id = rec.id;
      total_pushed := total_pushed + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_release_last_chance', rec.id::text, SQLERRM,
        jsonb_build_object('job_id', rec.id));
      RAISE NOTICE 'sweep_release_last_chance: job % failed: %', rec.id, SQLERRM;
    END;
  END LOOP;
  RETURN total_pushed;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_release_last_chance', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'pushed_before_failure', total_pushed));
  RETURN total_pushed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.track_revision_scope_creep()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Detect a NEW revision request (transition into revision_requested)
  IF NEW.status = 'revision_requested'
     AND (OLD.status IS DISTINCT FROM 'revision_requested') THEN
    NEW.revision_count := COALESCE(OLD.revision_count, 0) + 1;

    -- Flag scope creep at 3+ revisions
    IF NEW.revision_count >= 3 THEN
      INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
      VALUES (
        NEW.customer_id,
        'scope_creep',
        'Job "' || NEW.title || '" has been revised ' || NEW.revision_count || ' times. Possible scope creep or dispute brewing.',
        NEW.id
      );

      -- Notify both parties + admins via in-app notification
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        NEW.customer_id,
        '⚠️ Scope creep detected',
        'You''ve requested ' || NEW.revision_count || ' revisions on "' || NEW.title || '". Repeated revisions may signal unclear scope — consider a dispute or accepting the work.',
        'warning',
        '/posts?job=' || NEW.id::text,
        NEW.id
      );

      IF NEW.helper_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.helper_id,
          '⚠️ Multiple revisions on this job',
          'The poster has requested ' || NEW.revision_count || ' revisions on "' || NEW.title || '". Admins have been notified.',
          'warning',
          '/jobs?job=' || NEW.id::text,
          NEW.id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DELETE FROM public.notifications
 WHERE link ~ '^/(dashboard|my-posts|my-jobs)([?#/]|$)';

DELETE FROM public.notification_dedupe_suppressions
 WHERE link ~ '^/(dashboard|my-posts|my-jobs)([?#/]|$)';

DELETE FROM public.ops_route_probe
 WHERE route IN ('/dashboard', '/my-posts', '/my-jobs');
