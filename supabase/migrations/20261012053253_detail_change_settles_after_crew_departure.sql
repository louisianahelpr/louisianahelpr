-- Q1500 (finding lh-authz-rls@e1f83f9e9#2): a detail change no longer stalls
-- when a crew member leaves after the others accepted.
--
-- respond_job_detail_change (20261007113957) recounted the booked crew only
-- inside an answer. After A accepted and B left the crew, nothing re-counted:
-- the request sat pending, A (already answered) had nothing to press, and the
-- agreed change lapsed at the start.
--
-- Now the "everyone booked has accepted: apply it" step is one internal
-- function, settle_job_detail_change, which counts waiting answers ONLY over
-- the Helprs booked now. respond_job_detail_change calls it (restated
-- verbatim from 20261007113957 with its apply block replaced by the call),
-- and the roster's AFTER DELETE trigger (sync_job_after_roster_departure)
-- calls it for the job's pending request, so a departure that leaves everyone remaining agreed
-- applies the change and tells the poster and the crew (the same
-- 'Change to job details accepted' notice). A departure that leaves nobody
-- booked marks the request expired.
--
-- When the POSTER removes the member (the open-crew remove, or a block), the
-- request expires instead: nothing changes until they ask again. Settling
-- there would let a poster remove the one Helpr who had not answered and
-- force the change through, and the settle's jobs write would hit the
-- poster's own money lock (review lh-authz-rls of this migration, #1).
-- A Helpr booked after the ask who was never asked (only an answer asked
-- them before) is asked by the settle step itself (same review, #2).

CREATE OR REPLACE FUNCTION public.settle_job_detail_change(p_request_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_req record;
  v_job record;
  v_booked uuid[];
  v_waiting int;
  v_helper uuid;
  v_starts_at timestamptz;
  v_prev text := current_setting('app.detail_change_rpc', true);
BEGIN
  -- Job first, then the request: the order both RPCs take.
  SELECT r.job_id INTO v_req FROM public.job_detail_change_requests r WHERE r.id = p_request_id;
  IF v_req.job_id IS NULL THEN
    RETURN 'request_not_found';
  END IF;
  SELECT j.id, j.title, j.description, j.location, j.materials_note, j.customer_id,
         j.status, j.date_needed, j.start_time, j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_req.job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.job_detail_change_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF v_req.status <> 'pending' THEN
    RETURN v_req.status;
  END IF;

  v_booked := public.job_booked_helpr_ids(v_job.id);
  -- The same lapse rules respond_job_detail_change applies, plus: nobody
  -- left booked means nobody left to agree.
  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF cardinality(v_booked) = 0
     OR now() >= v_req.expires_at
     OR v_job.date_needed IS NULL OR now() >= v_starts_at
     OR v_job.status::text NOT IN ('open', 'accepted')
     OR v_job.helper_completed_at IS NOT NULL
     OR v_job.customer_id IS DISTINCT FROM v_req.requested_by
     OR ('title' = ANY (v_req.changed_fields) AND v_job.title IS DISTINCT FROM v_req.old_title)
     OR ('description' = ANY (v_req.changed_fields) AND v_job.description IS DISTINCT FROM v_req.old_description)
     OR ('location' = ANY (v_req.changed_fields) AND v_job.location IS DISTINCT FROM v_req.old_location)
     OR ('materials_note' = ANY (v_req.changed_fields) AND v_job.materials_note IS DISTINCT FROM v_req.old_materials_note) THEN
    UPDATE public.job_detail_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
    RETURN 'expired';
  END IF;

  -- A Helpr booked after the poster asked has not agreed to anything yet:
  -- ask them now (respond_job_detail_change does the same before it calls
  -- this; on a departure nobody else would).
  FOREACH v_helper IN ARRAY v_booked LOOP
    INSERT INTO public.job_detail_change_answers (request_id, helper_id)
    VALUES (v_req.id, v_helper)
    ON CONFLICT (request_id, helper_id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (v_helper, v_job.id, 'Change to job details requested',
              format('The person who posted "%s" asked to change its details. Nothing changes unless everyone booked on it accepts.',
                     COALESCE(v_job.title, 'your job')),
              'job_updates', '/jobs?job=' || v_job.id::text);
    END IF;
  END LOOP;

  -- Waiting on every Helpr booked NOW who has not accepted (one with no
  -- answer row yet, booked after the ask, counts as waiting). A member who
  -- left is not booked, so their old answer row no longer holds it up.
  SELECT count(*) INTO v_waiting
    FROM unnest(v_booked) h(helper_id)
   WHERE NOT EXISTS (SELECT 1 FROM public.job_detail_change_answers a
                      WHERE a.request_id = v_req.id AND a.helper_id = h.helper_id AND a.answer = 'accepted');
  IF v_waiting > 0 THEN
    RETURN 'waiting';
  END IF;

  PERFORM set_config('app.detail_change_rpc', '1', true);
  UPDATE public.jobs
     SET title = CASE WHEN 'title' = ANY (v_req.changed_fields) THEN v_req.new_title ELSE title END,
         description = CASE WHEN 'description' = ANY (v_req.changed_fields) THEN v_req.new_description ELSE description END,
         location = CASE WHEN 'location' = ANY (v_req.changed_fields) THEN v_req.new_location ELSE location END,
         -- The agreed address's own map point, in the same write (Q1499 G1).
         latitude = CASE WHEN 'location' = ANY (v_req.changed_fields) THEN v_req.new_latitude ELSE latitude END,
         longitude = CASE WHEN 'location' = ANY (v_req.changed_fields) THEN v_req.new_longitude ELSE longitude END,
         materials_note = CASE WHEN 'materials_note' = ANY (v_req.changed_fields) THEN v_req.new_materials_note ELSE materials_note END
   WHERE id = v_job.id;
  PERFORM set_config('app.detail_change_rpc', COALESCE(v_prev, '0'), true);

  UPDATE public.job_detail_change_requests SET status = 'accepted', decided_at = now() WHERE id = v_req.id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  SELECT x.uid, v_job.id, 'Change to job details accepted',
         format('"%s" now has the new details everyone agreed to.',
                CASE WHEN 'title' = ANY (v_req.changed_fields) THEN v_req.new_title ELSE COALESCE(v_job.title, 'The job') END),
         'job_updates',
         CASE WHEN x.uid = v_req.requested_by THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
    FROM (SELECT v_req.requested_by AS uid UNION SELECT unnest(v_booked)) x;

  RETURN 'accepted';
END;
$fn$;

REVOKE ALL ON FUNCTION public.settle_job_detail_change(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_job_detail_change(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.respond_job_detail_change(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_job record;
  v_booked uuid[];
  v_helper uuid;
  v_new int;
  v_waiting int;
  v_starts_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'detail_change_invalid';
  END IF;

  -- Job first, then the request: the order request_job_detail_change takes.
  SELECT r.job_id INTO v_req FROM public.job_detail_change_requests r WHERE r.id = p_request_id;
  IF v_req.job_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  SELECT j.id, j.title, j.description, j.location, j.materials_note, j.customer_id,
         j.status, j.date_needed, j.start_time, j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_req.job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.job_detail_change_requests r WHERE r.id = p_request_id FOR UPDATE;

  -- Only a Helpr this request asked, and only while still booked on the job.
  v_booked := public.job_booked_helpr_ids(v_job.id);
  IF NOT EXISTS (SELECT 1 FROM public.job_detail_change_answers a
                  WHERE a.request_id = v_req.id AND a.helper_id = v_uid)
     OR NOT (v_uid = ANY (v_booked)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_req.status);
  END IF;

  -- Unanswered by the start (as asked, or as the job now stands), or the job
  -- moved on since it was asked (no longer booked, done, or its details
  -- changed some other way): nothing changes.
  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF now() >= v_req.expires_at
     OR v_job.date_needed IS NULL OR now() >= v_starts_at
     OR v_job.status::text NOT IN ('open', 'accepted')
     OR v_job.helper_completed_at IS NOT NULL
     OR v_job.customer_id IS DISTINCT FROM v_req.requested_by
     OR ('title' = ANY (v_req.changed_fields) AND v_job.title IS DISTINCT FROM v_req.old_title)
     OR ('description' = ANY (v_req.changed_fields) AND v_job.description IS DISTINCT FROM v_req.old_description)
     OR ('location' = ANY (v_req.changed_fields) AND v_job.location IS DISTINCT FROM v_req.old_location)
     OR ('materials_note' = ANY (v_req.changed_fields) AND v_job.materials_note IS DISTINCT FROM v_req.old_materials_note) THEN
    UPDATE public.job_detail_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  UPDATE public.job_detail_change_answers
     SET answer = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END, answered_at = now()
   WHERE request_id = v_req.id AND helper_id = v_uid;

  IF NOT p_accept THEN
    UPDATE public.job_detail_change_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    SELECT x.uid, v_job.id, 'Change to job details declined',
           format('"%s" stays as it was: %s declined the change. The usual cancellation rules apply if anyone cancels.',
                  COALESCE(v_job.title, 'The job'),
                  CASE WHEN x.uid = v_req.requested_by THEN 'a Helpr booked on it' ELSE 'another Helpr on the crew' END),
           'job_updates',
           CASE WHEN x.uid = v_req.requested_by THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
      FROM (SELECT v_req.requested_by AS uid
            UNION
            SELECT a.helper_id FROM public.job_detail_change_answers a
             WHERE a.request_id = v_req.id AND a.helper_id <> v_uid AND a.helper_id = ANY (v_booked)) x;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  -- A Helpr booked after the poster asked has not agreed to anything yet:
  -- ask them now, and wait for them like everyone else.
  v_new := 0;
  FOREACH v_helper IN ARRAY v_booked LOOP
    INSERT INTO public.job_detail_change_answers (request_id, helper_id)
    VALUES (v_req.id, v_helper)
    ON CONFLICT (request_id, helper_id) DO NOTHING;
    IF FOUND THEN
      v_new := v_new + 1;
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (v_helper, v_job.id, 'Change to job details requested',
              format('The person who posted "%s" asked to change its details. Nothing changes unless everyone booked on it accepts.',
                     COALESCE(v_job.title, 'your job')),
              'job_updates', '/jobs?job=' || v_job.id::text);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_waiting
    FROM public.job_detail_change_answers a
   WHERE a.request_id = v_req.id AND a.helper_id = ANY (v_booked) AND a.answer <> 'accepted';
  IF v_waiting > 0 THEN
    RETURN jsonb_build_object('status', 'waiting', 'waiting_on', v_waiting);
  END IF;

  -- Everyone booked has said yes: apply it (Q1500: the one shared settle,
  -- also run when a crew member leaves).
  RETURN jsonb_build_object('status', public.settle_job_detail_change(v_req.id));
END;
$fn$;

REVOKE ALL ON FUNCTION public.respond_job_detail_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_job_detail_change(uuid, boolean) TO authenticated, service_role;

-- ── A crew member leaves: settle what the rest already agreed to ──────────
-- In the roster's one AFTER DELETE trigger (groupJobRosterLifecycle: every
-- deleter of a roster row is answered by that one trigger). Restated verbatim
-- from 20260925154606 plus the loop at the end.
CREATE OR REPLACE FUNCTION public.sync_job_after_roster_departure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_poster uuid;
BEGIN
  IF OLD.helper_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- The departed Helpr's hire is over. accepted -> rejected is silent
  -- (notify_on_application speaks only on pending -> rejected).
  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = OLD.job_id
     AND helper_id = OLD.helper_id
     AND status = 'accepted';

  -- Q1500: the poster removed this Helpr (open-crew remove, block): their
  -- pending ask lapses, nothing changes until they ask again. The job lock
  -- is the one settle_job_detail_change takes next anyway (job, then request).
  SELECT j.customer_id INTO v_poster FROM public.jobs j WHERE j.id = OLD.job_id FOR UPDATE;
  IF auth.uid() = v_poster THEN
    UPDATE public.job_detail_change_requests
       SET status = 'expired', decided_at = now()
     WHERE job_id = OLD.job_id AND status = 'pending';
    RETURN OLD;
  END IF;

  -- Q1500: the job's pending detail change no longer waits on this Helpr.
  -- Settling must never stop someone leaving the crew: a failure rolls back
  -- only the settle (the request stays pending, as before this fix) and is
  -- logged where prod-errors-check reads it.
  -- seed-policy: the logged row names the job; a seed job's failed settle is
  -- logged like any other (it is a code fault, not seed traffic), and the
  -- ops ledger's own is_seed handling applies downstream.
  FOR v_id IN
    SELECT r.id FROM public.job_detail_change_requests r
     WHERE r.job_id = OLD.job_id AND r.status = 'pending'
  LOOP
    BEGIN
      PERFORM public.settle_job_detail_change(v_id);
    EXCEPTION WHEN others THEN
      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES ('error', 'Detail change not settled after a crew member left',
              format('/admin?view=jobs&job=%s', OLD.job_id),
              jsonb_build_object('source', 'settle_job_detail_change', 'job_id', OLD.job_id::text),
              jsonb_build_object('request_id', v_id, 'sqlstate', SQLSTATE, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_job_after_roster_departure() FROM PUBLIC, anon, authenticated;
