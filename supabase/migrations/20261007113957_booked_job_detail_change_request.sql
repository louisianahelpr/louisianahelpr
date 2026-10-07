-- Q1254 (docs/OPEN.md; owner decision 2026-10-07): an AGREED change to a
-- booked job's place and details, the second half of the Q1204 decision
-- ("changes only through an agreed request"). Before this the lock
-- (enforce_poster_jobs_money_lock, 20261004165404) refused every poster edit
-- of the place and details once a Helpr was booked, and the only fix for a
-- wrong street number was to cancel (a late-cancel fee and a strike inside
-- the window).
--
-- Owner rules (2026-10-07):
--   - For a CREW every booked member must accept. One decline ends it.
--   - TEXT fields only, no photos: the title, the description, the address
--     (jobs.location) and the materials note. (The access and parking notes
--     are not locked by a booking, owner answer 3 of 2026-10-06; the poster
--     edits them directly.)
--   - Unanswered by the job's start, the request EXPIRES: nothing changes.
--
-- Shape: the schedule-change request (Q407 (8), 20260927012807) with a
-- per-Helpr answer row.
--   request_job_detail_change(job, changes jsonb)   the poster proposes
--   respond_job_detail_change(request, accept)       each booked Helpr answers
-- The booked Helprs are the ones the lock counts: the job's helper_id and
-- every crew roster row naming a Helpr. Each gets an answer row when the
-- poster asks; a Helpr booked AFTER the request gets one (and is told) when
-- the others' accepts would otherwise apply it, so nobody's job changes
-- without their own yes. Only when every Helpr booked at that moment has
-- accepted does the change apply, in the last accept's transaction, under
-- the transaction-local flag app.detail_change_rpc (set after the party
-- check, cleared right after the one UPDATE). The apply runs as that Helpr,
-- so enforce_helper_jobs_column_whitelist (the single-Helpr seat) is
-- restated with a carve-out for exactly these four columns under that flag;
-- the poster's lock is never reached (the caller is not the poster), and the
-- contact scan (reject_contact_leak_in_job) still judges the new text, also
-- checked up front when the poster asks.
--
-- Scope: a booked job that is not part of a recurring series (a series'
-- details are its own flow, like its dates), before its start.
-- Replay-safe: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF
-- EXISTS. Guard: src/test/jobDetailChange.test.ts; behaviour (red before,
-- 3x replay): src/test/pglite/jobDetailChange.pglite.mjs.

CREATE TABLE IF NOT EXISTS public.job_detail_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Which of the four columns change; the new_* of any other is ignored.
  changed_fields text[] NOT NULL,
  old_title text,
  new_title text,
  old_description text,
  new_description text,
  old_location text,
  new_location text,
  -- The new address's map point, geocoded when the poster asks (Q1499, lh-authz-rls
  -- re-review G1): written with the address, so the arrival check measures the
  -- agreed place, never the old pin and never no pin at all.
  new_latitude numeric,
  new_longitude numeric,
  old_materials_note text,
  new_materials_note text,
  status text NOT NULL DEFAULT 'pending',
  -- The job's start when it was asked (America/Chicago): unanswered by then, expired.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT job_detail_change_requests_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'replaced')),
  CONSTRAINT job_detail_change_requests_changed_fields_check
    CHECK (cardinality(changed_fields) > 0 AND changed_fields <@ ARRAY['title', 'description', 'location', 'materials_note']::text[]),
  CONSTRAINT job_detail_change_requests_lengths
    CHECK (char_length(new_title) <= 32 AND char_length(new_description) <= 1000
           AND char_length(new_location) <= 500 AND char_length(new_materials_note) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS job_detail_change_one_pending
  ON public.job_detail_change_requests (job_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.job_detail_change_answers (
  request_id uuid NOT NULL REFERENCES public.job_detail_change_requests(id) ON DELETE CASCADE,
  helper_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer text NOT NULL DEFAULT 'pending',
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, helper_id),
  CONSTRAINT job_detail_change_answers_answer_check CHECK (answer IN ('pending', 'accepted', 'declined'))
);

CREATE INDEX IF NOT EXISTS idx_job_detail_change_answers_helper
  ON public.job_detail_change_answers (helper_id) WHERE answer = 'pending';

-- Q807: the unconfirmed-email gate goes on every public table through its own
-- attacher (idempotent; it skips tables that already carry it). Both tables
-- are written only by the two definer RPCs below, which refuse a banned
-- caller themselves (is_caller_banned), so no ban-gate trigger is added.
DO $gates$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gates$;

-- Who may read a request and its answers: the poster who asked, and every
-- Helpr asked (a crew member sees who else still has to answer). Definer so
-- the two policies below do not read each other's table through RLS (that
-- recursion is refused); it reads auth.uid() itself and takes only a
-- request id, so a caller can only ever ask about themselves.
CREATE OR REPLACE FUNCTION public.can_read_job_detail_change(_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.job_detail_change_requests r
             WHERE r.id = _request_id AND r.requested_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.job_detail_change_answers a
                WHERE a.request_id = _request_id AND a.helper_id = auth.uid())
  );
$fn$;

REVOKE ALL ON FUNCTION public.can_read_job_detail_change(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_job_detail_change(uuid) TO authenticated, service_role;

ALTER TABLE public.job_detail_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_detail_change_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_detail_change_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.job_detail_change_answers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_detail_change_requests TO authenticated;
GRANT SELECT ON TABLE public.job_detail_change_answers TO authenticated;
GRANT ALL ON TABLE public.job_detail_change_requests TO service_role;
GRANT ALL ON TABLE public.job_detail_change_answers TO service_role;

DROP POLICY IF EXISTS "The poster and the Helprs asked read a detail change" ON public.job_detail_change_requests;
CREATE POLICY "The poster and the Helprs asked read a detail change"
  ON public.job_detail_change_requests FOR SELECT TO authenticated
  USING (requested_by = (SELECT auth.uid()) OR public.can_read_job_detail_change(id));

DROP POLICY IF EXISTS "The poster and the Helprs asked read the answers" ON public.job_detail_change_answers;
CREATE POLICY "The poster and the Helprs asked read the answers"
  ON public.job_detail_change_answers FOR SELECT TO authenticated
  USING (helper_id = (SELECT auth.uid()) OR public.can_read_job_detail_change(request_id));

-- The Helprs booked on a job right now: the lock's own definition
-- (enforce_poster_jobs_money_lock: helper_id, or a roster row naming a Helpr).
CREATE OR REPLACE FUNCTION public.job_booked_helpr_ids(p_job_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT x.helper_id ORDER BY x.helper_id), ARRAY[]::uuid[])
    FROM (
      SELECT j.helper_id FROM public.jobs j WHERE j.id = p_job_id AND j.helper_id IS NOT NULL
      UNION
      SELECT g.helper_id FROM public.group_job_helpers g WHERE g.job_id = p_job_id AND g.helper_id IS NOT NULL
    ) x;
$fn$;

REVOKE ALL ON FUNCTION public.job_booked_helpr_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_booked_helpr_ids(uuid) TO service_role;

-- ── Ask ────────────────────────────────────────────────────────────────────
-- p_changes: an object whose keys are among title / description / location /
-- materials_note. A key present is a proposed change (materials_note may be
-- null or blank: remove it); a key equal to the job's value is dropped; an
-- object that changes nothing is refused.
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

REVOKE ALL ON FUNCTION public.request_job_detail_change(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_detail_change(uuid, jsonb) TO authenticated, service_role;

-- ── Answer ─────────────────────────────────────────────────────────────────
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

  -- Everyone booked has said yes: apply it.
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
  PERFORM set_config('app.detail_change_rpc', '0', true);

  UPDATE public.job_detail_change_requests SET status = 'accepted', decided_at = now() WHERE id = v_req.id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  SELECT x.uid, v_job.id, 'Change to job details accepted',
         format('"%s" now has the new details everyone agreed to.',
                CASE WHEN 'title' = ANY (v_req.changed_fields) THEN v_req.new_title ELSE COALESCE(v_job.title, 'The job') END),
         'job_updates',
         CASE WHEN x.uid = v_req.requested_by THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
    FROM (SELECT v_req.requested_by AS uid UNION SELECT unnest(v_booked)) x;

  RETURN jsonb_build_object('status', 'accepted');
END;
$fn$;

REVOKE ALL ON FUNCTION public.respond_job_detail_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_job_detail_change(uuid, boolean) TO authenticated, service_role;

-- ── A changed address clears the old coordinates (Q1499) ──────────────────
-- jobs.latitude/longitude were written once at post time and re-filled only
-- when NULL (backfill-job-geocode). A poster's edit of an open job's address,
-- and an agreed change of a booked job's address (above), left the OLD pin:
-- the map showed the old place, and mark_helper_arrival measured the Helpr's
-- 500 ft check against it, so a Helpr at the agreed new address could not
-- verify their arrival (lh-authz-rls review of Q1254, F1). Now any UPDATE
-- that changes the address without also writing coordinates clears them;
-- backfill-job-geocode re-geocodes live jobs (open AND booked) with none.
-- The agreed change of a BOOKED job's address writes its new point with it
-- (the request carries it), so this clear never leaves a booked job pinless
-- through that path: a pinless job verifies any arrival fix
-- ('no_job_coordinates', lh-authz-rls re-review G1). EditJobDialog also
-- geocodes an open job's new address and sends the point with it; the clear
-- only catches a writer that does not.
-- Named to sort AFTER every other BEFORE UPDATE trigger on jobs (they fire in
-- name order; the last was zzzzz_jobs_route_notes): the poster's lock and
-- the Helpr's whitelist judge the write as the client sent it, so this
-- server-side clear never reads as a client writing the coordinates.
CREATE OR REPLACE FUNCTION public.jobs_location_clears_coords()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
BEGIN
  -- An agreed change (respond_job_detail_change) always writes the request's
  -- own range-checked point with the address; a new address that geocodes to
  -- the SAME point (a typo fix) must keep it, never read as "no point sent"
  -- (lh-authz-rls third pass, H1: a booked job left pinless verifies any
  -- arrival fix).
  IF current_setting('app.detail_change_rpc', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF NEW.location IS DISTINCT FROM OLD.location
     AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude
     AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude THEN
    NEW.latitude := NULL;
    NEW.longitude := NULL;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_location_clears_coords() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzzzzz_jobs_location_clears_coords ON public.jobs;
CREATE TRIGGER zzzzzz_jobs_location_clears_coords
  BEFORE UPDATE OF location ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_location_clears_coords();

-- ── Helper whitelist: admit the agreed change ───────────────────────────────
-- Restated from its newest definition, 20261004192041 (md5(prosrc) live
-- 2026-10-07 9a751dba78962d581db80eccc8198d58 = that file), plus one
-- carve-out (app.detail_change_rpc, four columns). Without it the booked
-- Helpr whose accept is the last one would be refused by their own whitelist.
CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
    -- Added 2026-09-05. Without this a helper cannot open a dispute at all:
    -- rpc_open_dispute stamps it in the same UPDATE as disputed_at/dispute_status.
    'disputed_by',
    'dispute_status',
    'dispute_helper_response',
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status',
    'helper_id',
    'response_deadline',
    'updated_at'
  ];
BEGIN
  -- Only constrain the assigned helper acting on their own job. Everyone
  -- else (a server context; poster; admin) passes through — their
  -- access is governed by RLS as before. A NULL uid alone is not a server
  -- context: anon has one too (20260915051905).
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF NOT (changed_col = ANY (allowed)) THEN
      -- BOTH arrival stamps are deliberately NOT in `allowed`: the only
      -- writer is public.mark_helper_arrival(), which computes the proximity
      -- verdict server-side, refuses (writing nothing) when the helper is not
      -- within 500ft, and sets this transaction-local flag. A direct PATCH
      -- from the client still hits the RAISE below. helper_arrived_at joined
      -- the verified stamp here in 20260915044137 (VN-33): while it was on the
      -- list, a helper 2000 miles away could mark themselves arrived with a
      -- plain PATCH and no location at all.
      IF changed_col IN ('helper_arrival_verified_at', 'helper_arrived_at',
                         'helper_arrival_near_miss_at', 'helper_arrival_near_miss_ft')
         AND current_setting('app.arrival_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- The dispute-resolution stamp, same pattern and for the same reason.
      -- Its only writer is public.rpc_withdraw_dispute(), which sets this flag
      -- transaction-locally only AFTER establishing that auth.uid() is the
      -- opener_id of a live dispute on this job. Listing the column in
      -- `allowed` instead would let a helper stamp their own job resolved with
      -- a plain PATCH and skip that check entirely — which is the whole reason
      -- the RPC exists.
      IF changed_col = 'dispute_resolved_at'
         AND current_setting('app.dispute_withdraw_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- The series end date, same pattern. Its only writer is
      -- public.end_recurring_series(), which sets this flag transaction-locally
      -- only after establishing that auth.uid() is the poster or the standing
      -- Helpr of the series. A direct PATCH is also refused by
      -- enforce_series_columns_client_lock.
      IF changed_col = 'series_ended_on'
         AND current_setting('app.series_end_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- A permanent ban handing back or cancelling the banned Helpr's own
      -- visits (end_series_for_banned_account, 20260927012808) may run inside
      -- that Helpr's own request (the consequence ladder). Its only writes of
      -- these columns are the server-owned ban marker and the day-of stamps a
      -- vacated visit resets; it sets app.series_end_rpc around them.
      IF changed_col IN ('series_ban_cancelled_at',
                         'dayof_confirm_reminder_sent_at', 'dayof_unanswered_poster_alert_sent_at',
                         'start_reminder_sent_at')
         AND current_setting('app.series_end_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- A new date / start time the OTHER party asked for and this Helpr
      -- accepted (Q407 (8)). Its only writer is
      -- public.respond_job_schedule_change(), which sets this flag
      -- transaction-locally only after checking the caller is the party the
      -- request is addressed to; the day-of stamps it resets go with it.
      IF changed_col IN ('date_needed', 'start_time', 'expires_at',
                         'dayof_confirm_reminder_sent_at', 'dayof_unanswered_poster_alert_sent_at',
                         'start_reminder_sent_at')
         AND current_setting('app.schedule_change_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- ADDED (Q1254): the place and details every booked Helpr agreed to.
      -- Its only writer is public.respond_job_detail_change(), which sets
      -- this flag transaction-locally only after checking the caller is a
      -- Helpr the request asked and still booked, and only once every booked
      -- Helpr has accepted; it clears it right after its one UPDATE. The map
      -- point travels with the address (Q1499).
      IF changed_col IN ('title', 'description', 'location', 'latitude', 'longitude', 'materials_note')
         AND current_setting('app.detail_change_rpc', true) = '1' THEN
        CONTINUE;
      END IF;
      -- A Helpr cancelling their own booking (Q402). Its only writer is
      -- public.helper_cancel_booking(), which sets this flag transaction-locally
      -- around its one reopen UPDATE, after checking auth.uid() holds the job,
      -- and resets the reminder sent-ats so the next Helpr's day-of machinery
      -- runs fresh. The flag only lets them be CLEARED, never stamped.
      IF changed_col IN ('dayof_confirm_reminder_sent_at', 'dayof_unanswered_poster_alert_sent_at',
                         'start_reminder_sent_at')
         AND current_setting('app.helper_cancel_rpc', true) = '1'
         AND to_jsonb(NEW) -> changed_col = 'null'::jsonb THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'Helpers may not modify jobs.% ', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A helper may un-assign themselves (decline fallback sets helper_id NULL)
  -- but never reassign the job to another account.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.helper_id, not reassign it'
      USING ERRCODE = '42501';
  END IF;

  -- Q1202: the offer's response window is the poster's (accept_application
  -- stamps it). The Helpr may only CLEAR it (the accept and the decline do,
  -- through definer RPCs that run as this Helpr), never move it: a Helpr who
  -- pushed it years out could hold an unconfirmed offer forever, because
  -- expire_unanswered_offers would never fire.
  IF NEW.response_deadline IS DISTINCT FROM OLD.response_deadline AND NEW.response_deadline IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.response_deadline, not move it'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_helper_jobs_column_whitelist() FROM PUBLIC, anon, authenticated;


-- ── export_my_data: a person's change requests and answers are their data ───
-- Restated from its newest definition, 20261007073145 (Q1390's ledger), plus
-- two sections: the requests the caller asked, and the answers the caller
-- gave (each names its request).
DROP FUNCTION IF EXISTS public.export_my_data();
CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
