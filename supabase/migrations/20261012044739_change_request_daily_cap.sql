-- Q1501 (finding lh-authz-rls@e1f83f9e9#4): a cap on change requests.
--
-- request_job_detail_change (20261007113957) and request_job_schedule_change
-- (20261008183640) each replace the job's pending request and notify the
-- other side on EVERY call: the detail change sends one notice per booked
-- Helpr, so a poster could notify a whole crew as often as they liked, and the
-- date/time ask had the same gap in both directions. Now five asks per job per
-- asker in any 24 hours; the sixth is refused with *_rate_limited before
-- anything is written or sent.
--
-- Both functions are restated verbatim from their newest definitions plus the
-- one check (just before the pending request is replaced). Signatures,
-- owners and grants are unchanged; the REVOKE/GRANT pair is repeated so the
-- file stands alone.

CREATE OR REPLACE FUNCTION public.request_job_schedule_change(p_job_id uuid, p_date date, p_start_time time)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_other uuid;
  v_starts_at timestamptz;
  v_new_at timestamptz;
  v_id uuid;
  v_replaced int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time,
         j.parent_job_id, j.recurrence_days, j.is_group_job, j.helper_completed_at,
         j.estimated_hours
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL OR COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'schedule_change_not_one_time';
  END IF;
  IF v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'schedule_change_not_booked';
  END IF;

  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF now() >= v_starts_at THEN
    RAISE EXCEPTION 'schedule_change_too_late';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'schedule_change_invalid';
  END IF;
  v_new_at := (p_date + COALESCE(p_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF v_new_at <= now() THEN
    RAISE EXCEPTION 'schedule_change_in_past';
  END IF;
  -- At least an hour out (owner, 2026-10-08): a request for a start minutes
  -- away was accepted 19 s after that start and expired with nobody told
  -- (request 1f6349c9). An hour leaves the other person time to answer.
  IF v_new_at < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'schedule_change_too_soon';
  END IF;
  IF p_date = v_job.date_needed AND p_start_time IS NOT DISTINCT FROM v_job.start_time THEN
    RAISE EXCEPTION 'schedule_change_same';
  END IF;

  -- Q736: the new start must not overlap another booking the Helpr already
  -- holds (their own hire, or a crew seat), ending at start + estimated_hours
  -- (1 hour when unset). A time-less side ("any time that day") is flexible
  -- and never clashes.
  IF p_start_time IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.jobs o
     WHERE o.id <> v_job.id
       AND o.date_needed = p_date
       AND o.start_time IS NOT NULL
       AND o.status::text IN ('accepted', 'in_progress')
       AND o.helper_completed_at IS NULL
       AND (o.helper_id = v_job.helper_id
            OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                        WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                          AND g.status = 'accepted'))
       AND (p_date + p_start_time, p_date + p_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
           OVERLAPS
           (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
  ) THEN
    RAISE EXCEPTION 'schedule_change_clash';
  END IF;

  -- Q1501: each ask notifies the other person, and a new ask replaces the
  -- last one, so without a cap the asker can notify them without end. Five
  -- asks per job in 24 hours; the job row is locked above, so the count is
  -- serialised per job.
  IF (SELECT count(*) FROM public.job_schedule_change_requests r
       WHERE r.job_id = v_job.id AND r.requested_by = v_uid
         AND r.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'schedule_change_rate_limited';
  END IF;

  v_other := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;

  UPDATE public.job_schedule_change_requests r
     SET status = CASE WHEN r.expires_at <= now() THEN 'expired' ELSE 'replaced' END,
         decided_at = now()
   WHERE r.job_id = v_job.id AND r.status = 'pending';
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.job_schedule_change_requests
    (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at)
  VALUES
    (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_other, v_job.id,
    'New date or time requested',
    format('%s asked to move "%s" to %s%s. Nothing changes unless you accept.%s',
           CASE WHEN v_uid = v_job.customer_id THEN 'The person who posted it' ELSE 'The Helpr doing it' END,
           COALESCE(v_job.title, 'your job'),
           to_char(p_date, 'FMDy FMMon FMDD'),
           CASE WHEN p_start_time IS NULL THEN '' ELSE ' at ' || to_char(p_start_time, 'FMHH12:MI AM') END,
           CASE WHEN v_replaced > 0 THEN ' This replaces their earlier request.' ELSE '' END),
    'job_updates',
    CASE WHEN v_other = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('request_id', v_id, 'expires_at', v_starts_at, 'replaced', v_replaced);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.request_job_detail_change(p_job_id uuid, p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_booked uuid[];
  v_starts_at timestamptz;
  v_fields text[] := ARRAY[]::text[];
  v_title text;
  v_description text;
  v_location text;
  v_lat numeric;
  v_lng numeric;
  v_materials text;
  v_reason text;
  v_id uuid;
  v_replaced int;
  v_helper uuid;
  v_what text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.title, j.description, j.location, j.materials_note, j.customer_id, j.helper_id,
         j.status, j.date_needed, j.start_time, j.parent_job_id, j.recurrence_days, j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_uid IS DISTINCT FROM v_job.customer_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL THEN
    RAISE EXCEPTION 'detail_change_not_one_time';
  END IF;
  v_booked := public.job_booked_helpr_ids(v_job.id);
  IF cardinality(v_booked) = 0 OR v_job.status::text NOT IN ('open', 'accepted') OR v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'detail_change_not_booked';
  END IF;
  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF v_job.date_needed IS NULL OR now() >= v_starts_at THEN
    RAISE EXCEPTION 'detail_change_too_late';
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k
                 WHERE k NOT IN ('title', 'description', 'location', 'latitude', 'longitude', 'materials_note')) THEN
    RAISE EXCEPTION 'detail_change_invalid';
  END IF;

  IF p_changes ? 'title' THEN
    v_title := btrim(p_changes ->> 'title', E' \t\r\n');
    IF v_title IS NULL OR v_title = '' THEN RAISE EXCEPTION 'detail_change_title_required'; END IF;
    IF char_length(v_title) > 32 THEN RAISE EXCEPTION 'detail_change_title_too_long'; END IF;
    IF v_title IS DISTINCT FROM v_job.title THEN v_fields := array_append(v_fields, 'title'); END IF;
  END IF;
  IF p_changes ? 'description' THEN
    v_description := btrim(p_changes ->> 'description', E' \t\r\n');
    IF v_description IS NULL OR v_description = '' THEN RAISE EXCEPTION 'detail_change_description_required'; END IF;
    IF char_length(v_description) > 1000 THEN RAISE EXCEPTION 'detail_change_description_too_long'; END IF;
    IF v_description IS DISTINCT FROM v_job.description THEN v_fields := array_append(v_fields, 'description'); END IF;
  END IF;
  IF p_changes ? 'location' THEN
    v_location := btrim(p_changes ->> 'location', E' \t\r\n');
    IF v_location IS NULL OR v_location = '' THEN RAISE EXCEPTION 'detail_change_location_required'; END IF;
    IF char_length(v_location) > 500 THEN RAISE EXCEPTION 'detail_change_location_too_long'; END IF;
    IF v_location IS DISTINCT FROM v_job.location THEN v_fields := array_append(v_fields, 'location'); END IF;
  END IF;
  -- A new address carries its map point (the client geocodes it when the
  -- poster asks). Without one the Helpr's 500 ft arrival check would have no
  -- pin, and mark_helper_arrival / rpc_group_member_mark_arrival verify any
  -- fix when a job has none (lh-authz-rls re-review of Q1499, G1): refused.
  IF 'location' = ANY (v_fields) THEN
    BEGIN
      v_lat := (p_changes ->> 'latitude')::numeric;
      v_lng := (p_changes ->> 'longitude')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'detail_change_location_unmapped';
    END;
    IF v_lat IS NULL OR v_lng IS NULL OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'detail_change_location_unmapped';
    END IF;
  ELSIF p_changes ? 'latitude' OR p_changes ? 'longitude' THEN
    -- A map point only ever travels with a new address.
    RAISE EXCEPTION 'detail_change_invalid';
  END IF;
  IF p_changes ? 'materials_note' THEN
    -- Blank is not a note (jobs_route_notes stores it as NULL too).
    v_materials := NULLIF(btrim(p_changes ->> 'materials_note', E' \t\r\n'), '');
    IF char_length(v_materials) > 500 THEN RAISE EXCEPTION 'detail_change_materials_too_long'; END IF;
    IF v_materials IS DISTINCT FROM v_job.materials_note THEN v_fields := array_append(v_fields, 'materials_note'); END IF;
  END IF;
  IF cardinality(v_fields) = 0 THEN
    RAISE EXCEPTION 'detail_change_same';
  END IF;

  -- The same scanner the job row's own trigger runs, up front, so a Helpr's
  -- accept can never be the write that fails it.
  v_reason := CASE WHEN 'title' = ANY (v_fields) THEN public.contact_leak_reason(v_title) END;
  IF v_reason IS NULL AND 'description' = ANY (v_fields) THEN v_reason := public.contact_leak_reason(v_description); END IF;
  IF v_reason IS NULL AND 'materials_note' = ANY (v_fields) THEN v_reason := public.contact_leak_reason(v_materials); END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the change. Keep contact details and payment off the post; hiring and payment happen in the app.';
  END IF;

  -- Q1501: each ask notifies every booked Helpr, and a new ask replaces the
  -- last one, so without a cap the poster can notify a crew without end. Five
  -- asks per job in 24 hours; the job row is locked above, so the count is
  -- serialised per job.
  IF (SELECT count(*) FROM public.job_detail_change_requests r
       WHERE r.job_id = v_job.id AND r.requested_by = v_uid
         AND r.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'detail_change_rate_limited';
  END IF;

  UPDATE public.job_detail_change_requests r
     SET status = CASE WHEN r.expires_at <= now() THEN 'expired' ELSE 'replaced' END,
         decided_at = now()
   WHERE r.job_id = v_job.id AND r.status = 'pending';
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  INSERT INTO public.job_detail_change_requests
    (job_id, requested_by, changed_fields, old_title, new_title, old_description, new_description,
     old_location, new_location, new_latitude, new_longitude, old_materials_note, new_materials_note, expires_at)
  VALUES
    (v_job.id, v_uid, v_fields,
     v_job.title, CASE WHEN 'title' = ANY (v_fields) THEN v_title END,
     v_job.description, CASE WHEN 'description' = ANY (v_fields) THEN v_description END,
     v_job.location, CASE WHEN 'location' = ANY (v_fields) THEN v_location END, v_lat, v_lng,
     v_job.materials_note, CASE WHEN 'materials_note' = ANY (v_fields) THEN v_materials END,
     v_starts_at)
  RETURNING id INTO v_id;

  v_what := array_to_string(ARRAY(
    SELECT CASE f WHEN 'title' THEN 'title' WHEN 'description' THEN 'description'
                  WHEN 'location' THEN 'address' ELSE 'materials note' END
      FROM unnest(v_fields) f), ', ');

  FOREACH v_helper IN ARRAY v_booked LOOP
    INSERT INTO public.job_detail_change_answers (request_id, helper_id) VALUES (v_id, v_helper);
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_helper, v_job.id,
      'Change to job details requested',
      format('The person who posted "%s" asked to change its %s. Nothing changes unless %s.%s',
             COALESCE(v_job.title, 'your job'), v_what,
             CASE WHEN cardinality(v_booked) > 1 THEN 'everyone booked on it accepts' ELSE 'you accept' END,
             CASE WHEN v_replaced > 0 THEN ' This replaces their earlier request.' ELSE '' END),
      'job_updates',
      '/jobs?job=' || v_job.id::text
    );
  END LOOP;

  RETURN jsonb_build_object('request_id', v_id, 'expires_at', v_starts_at, 'replaced', v_replaced,
                            'fields', to_jsonb(v_fields), 'asked', cardinality(v_booked));
END;
$fn$;

REVOKE ALL ON FUNCTION public.request_job_schedule_change(uuid, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_schedule_change(uuid, date, time) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_job_detail_change(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_detail_change(uuid, jsonb) TO authenticated, service_role;
