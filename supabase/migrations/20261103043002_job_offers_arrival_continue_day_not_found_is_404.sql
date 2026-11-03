-- Q2390 packet 4 (submit_job_quote, respond_to_job_quote, helper_mark_on_the_way,
-- propose_job_continue_day, answer_job_continue_day, mark_helper_arrival):
-- "not found" answers HTTP 404, not 500.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy; arguments, defaults, SECURITY DEFINER and
-- search_path as on prod):
--   submit_job_quote          7150a791cdb7ab5bcc51edb7eab440e1 2908 chars (20261019043546)
--   respond_to_job_quote      7d774ebaebf3e6ae818beb107c676f14 4798 chars (20261019043546)
--   helper_mark_on_the_way    b28be0cbfbc64b3564e2af67c08752da 2970 chars (20261008203441)
--   propose_job_continue_day  db87570c3b749c62785f1da19d0cba2f 5179 chars (20261102102402)
--   answer_job_continue_day   b7633661a611fa437f4b7e275369a997 5291 chars (20261102102402)
--   mark_helper_arrival       8e09fb678fee049ab6906d4042c09436 8396 chars (20261008203441)
-- The ONLY change is each not-found ERRCODE 'P0002' -> 'PT404' (two lines in
-- submit_job_quote and respond_to_job_quote, one in each other). Messages and
-- control flow are unchanged. Grants restated as on prod (proacl: postgres,
-- authenticated, service_role).

CREATE OR REPLACE FUNCTION public.submit_job_quote(
  p_request_id uuid,
  p_price_cents integer,
  p_note text,
  p_available_note text,
  p_photo_paths text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_id  uuid;
  v_photos text[] := COALESCE(p_photo_paths, '{}');
  v_path text;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  FOREACH v_path IN ARRAY v_photos LOOP
    -- Only the quoter's own quotes folder: account deletion erases exactly
    -- job-photos/<uid>/quotes/ (purgeBuckets.ts IDENTITY_SUBFOLDERS), so a
    -- path anywhere else would outlive the purge (lh-silent-failure review).
    IF v_path IS NULL OR v_path NOT LIKE v_uid::text || '/quotes/%' OR v_path LIKE '%..%' THEN
      RAISE EXCEPTION 'invalid_photo' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Per-quoter serialization: the daily cap below is read-then-write.
  PERFORM pg_advisory_xact_lock(hashtext('submit_job_quote'), hashtext(v_uid::text));
  IF (SELECT count(*) FROM public.job_quotes q
       WHERE q.quoter_id = v_uid AND q.created_at > now() - interval '24 hours') >= 20 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000';
  END IF;

  -- FOR SHARE composes with the poster's FOR UPDATE in accept / switch /
  -- cancel: a quote cannot land on a request being closed in the same instant.
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404';
  END IF;
  IF v_req.poster_id IS NULL OR v_req.poster_id = v_uid THEN
    RAISE EXCEPTION 'cannot_quote_own_request' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'open' OR v_req.quotes_close_at <= now() OR v_req.invited_only THEN
    RAISE EXCEPTION 'quotes_closed' USING ERRCODE = '55000';
  END IF;
  IF public.are_users_blocked(v_req.poster_id, v_uid) THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_quotes q WHERE q.request_id = p_request_id AND q.quoter_id = v_uid) THEN
    RAISE EXCEPTION 'already_quoted' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.job_quotes (request_id, quoter_id, price_cents, note, available_note,
                                 photo_paths, last_offer_side, respond_until)
  VALUES (p_request_id, v_uid, p_price_cents, btrim(p_note), btrim(p_available_note),
          v_photos, 'quoter', now() + interval '48 hours')
  RETURNING id INTO v_id;
  INSERT INTO public.job_quote_offers (quote_id, by_side, price_cents, note)
  VALUES (v_id, 'quoter', p_price_cents, btrim(p_note));

  -- Q10 (owner, 2026-10-17): push AND email for each new quote.
  PERFORM public.quote_notify_to(v_req.poster_id, 'New quote',
    'You got a quote of $' || (p_price_cents / 100) || ' for "' || v_req.title || '".', v_uid, true,
    v_req.id, NULL, false);
  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_job_quote(uuid, integer, text, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.respond_to_job_quote(
  p_quote_id uuid,
  p_action text,
  p_price_cents integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid    uuid;
  v_req_id uuid;
  v_req    public.job_quote_requests%ROWTYPE;
  v_q      public.job_quotes%ROWTYPE;
  v_side   text;
  v_other  uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('accept', 'decline', 'counter') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
  END IF;

  SELECT q.request_id INTO v_req_id FROM public.job_quotes q WHERE q.id = p_quote_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = v_req_id FOR UPDATE;
  SELECT * INTO v_q FROM public.job_quotes WHERE id = p_quote_id FOR UPDATE;

  IF v_uid = v_req.poster_id THEN
    v_side := 'poster'; v_other := v_q.quoter_id;
  ELSIF v_uid = v_q.quoter_id THEN
    v_side := 'quoter'; v_other := v_req.poster_id;
  ELSE
    -- Q5: a stranger learns nothing, not even that the quote exists.
    RAISE EXCEPTION 'unknown_quote' USING ERRCODE = 'PT404';
  END IF;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'quote_unavailable' USING ERRCODE = '55000';
  END IF;
  -- Q345: no hire across a block, either direction, on every action (an
  -- accept here is the hire). Same code and errcode as accept_application.
  IF public.are_users_blocked(v_req.poster_id, v_q.quoter_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;
  IF v_req.status <> 'open' OR v_q.status <> 'pending' THEN
    RAISE EXCEPTION 'quote_closed' USING ERRCODE = '55000';
  END IF;
  IF v_q.respond_until <= now() THEN
    RAISE EXCEPTION 'quote_expired' USING ERRCODE = '55000';
  END IF;
  -- Past the posted-job start rule (2 hours' notice) the agreed job could never
  -- be booked, so nothing may be agreed or countered any more (decline still may).
  IF p_action <> 'decline' AND ((v_req.date_needed + COALESCE(v_req.start_time, '23:59'::time)) AT TIME ZONE 'America/Chicago')
       - interval '2 hours' <= now() THEN
    RAISE EXCEPTION 'job_start_too_soon' USING ERRCODE = '22023',
      HINT = 'This job starts too soon to agree a price now.';
  END IF;
  IF v_q.last_offer_side = v_side THEN
    RAISE EXCEPTION 'not_your_turn' USING ERRCODE = '55000',
      DETAIL = 'Waiting for the other side to answer your last offer.';
  END IF;

  IF p_action = 'decline' THEN
    UPDATE public.job_quotes SET status = 'declined', updated_at = now() WHERE id = p_quote_id;
    PERFORM public.quote_notify_to(v_other, 'Quote declined',
      'Your offer on "' || v_req.title || '" was declined.', v_uid, false, v_req.id, NULL, false);
    RETURN 'declined';
  END IF;

  IF p_action = 'counter' THEN
    IF p_price_cents IS NULL THEN
      RAISE EXCEPTION 'price_required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.job_quotes
       SET price_cents = p_price_cents, last_offer_side = v_side,
           respond_until = now() + interval '48 hours', offer_count = offer_count + 1,
           updated_at = now()
     WHERE id = p_quote_id;
    INSERT INTO public.job_quote_offers (quote_id, by_side, price_cents, note)
    VALUES (p_quote_id, v_side, p_price_cents, NULLIF(btrim(p_note), ''));
    -- Q10 (owner, 2026-10-17): push AND email for each counter, to whichever
    -- side it is now waiting on (the poster, or the quoter).
    PERFORM public.quote_notify_to(v_other, 'New counter-offer',
      'You got a counter-offer of $' || (p_price_cents / 100) || ' on "' || v_req.title || '".', v_uid, true,
      v_req.id, NULL, false);
    RETURN 'countered';
  END IF;

  -- accept: this quote wins at the price on the table; every other quote on the
  -- request closes. The request row is locked FOR UPDATE above, so two accepts
  -- (or an accept racing a switch / cancel) serialize and the second sees
  -- status <> 'open'. job_quotes_one_accepted is the backstop.
  UPDATE public.job_quotes SET status = 'accepted', updated_at = now() WHERE id = p_quote_id;
  UPDATE public.job_quotes SET status = 'closed', updated_at = now()
   WHERE request_id = v_req.id AND id <> p_quote_id AND status = 'pending';
  UPDATE public.job_quote_requests SET status = 'agreed', updated_at = now() WHERE id = v_req.id;
  PERFORM public.quote_notify_to(v_other, 'Quote accepted',
    CASE WHEN v_side = 'poster'
         THEN 'Your quote of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. It is booked once the poster pays.'
         ELSE 'Your offer of $' || (v_q.price_cents / 100) || ' for "' || v_req.title || '" was accepted. Pay to book it.' END,
    v_uid, false, v_req.id, NULL, false);
  RETURN 'accepted';
END;
$fn$;

REVOKE ALL ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_job_quote(uuid, text, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helper_mark_on_the_way(p_job_id uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
  v_now timestamptz := now();
  v_tracking_id uuid;
  v_start timestamptz;
BEGIN
  -- Lock the row: two concurrent taps must not both run the transition.
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_the_assigned_helper' USING ERRCODE = '42501';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'job_not_active' USING ERRCODE = '23514',
      HINT = 'On-the-way can only be marked on an accepted or in-progress job.';
  END IF;
  IF v_job.helper_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'helper_not_confirmed' USING ERRCODE = '23514',
      HINT = 'Confirm the job before heading out.';
  END IF;

  -- THE DAY-BEFORE CONFIRM AND THE 2-HOUR WINDOW (Q1570). A second tap after
  -- heading out is a no-op below, never refused here.
  IF v_job.helper_on_the_way_at IS NULL
     AND NOT public.job_posted_by_seed(v_job.customer_id) THEN
    IF v_job.helper_dayof_confirmed_at IS NULL THEN
      RAISE EXCEPTION 'helper_not_dayof_confirmed' USING ERRCODE = '23514',
        HINT = 'Tap "Confirm You''ll Be at the Job" before heading out.';
    END IF;
    IF v_job.date_needed IS NOT NULL THEN
      v_start := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
      IF (v_job.start_time IS NOT NULL AND v_now < v_start - interval '2 hours')
         OR (v_job.start_time IS NULL AND v_now < v_start) THEN
        RAISE EXCEPTION 'on_the_way_too_early' USING ERRCODE = '23514',
          HINT = 'I''m On My Way turns on 2 hours before the job starts.';
      END IF;
    END IF;
  END IF;

  -- Tracking row: job_tracking has no unique(job_id, helper_id), so update
  -- the newest existing row for this pair, else insert one.
  SELECT id INTO v_tracking_id
    FROM public.job_tracking
   WHERE job_id = p_job_id AND helper_id = v_job.helper_id
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_tracking_id IS NOT NULL THEN
    UPDATE public.job_tracking
       SET status = 'on_the_way',
           latitude = p_lat,
           longitude = p_lng,
           updated_at = v_now
     WHERE id = v_tracking_id;
  ELSE
    INSERT INTO public.job_tracking (job_id, helper_id, status, latitude, longitude)
    VALUES (p_job_id, v_job.helper_id, 'on_the_way', p_lat, p_lng)
    RETURNING id INTO v_tracking_id;
  END IF;

  -- ONE update: status transition + departure stamp together, so the notify
  -- trigger sees both in a single firing and an interrupted run can never
  -- leave one without the other.
  UPDATE public.jobs
     SET status = CASE WHEN status = 'accepted' THEN 'in_progress' ELSE status END,
         helper_on_the_way_at = COALESCE(helper_on_the_way_at, v_now)
   WHERE id = p_job_id;

  RETURN v_tracking_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_mark_on_the_way(uuid, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_mark_on_the_way(uuid, double precision, double precision) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.propose_job_continue_day(p_job_id uuid, p_date date, p_start_time time, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_poster boolean;
  v_new_at timestamptz;
  v_note text;
  v_prev record;
  v_id uuid;
  v_status text;
  v_cleared timestamptz;
  v_label text;
BEGIN
  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.payment_status, j.is_group_job, j.helper_completed_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_job.helper_id IS NULL OR v_job.helper_id = v_job.customer_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.are_users_blocked(v_job.customer_id, v_job.helper_id) THEN
    RAISE EXCEPTION 'users_blocked' USING ERRCODE = '42501';
  END IF;
  IF v_job.status::text <> 'in_progress' OR COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'continue_day_not_in_progress' USING ERRCODE = '22023',
      HINT = 'Another day can be set only on a job that is under way.';
  END IF;
  IF p_date IS NULL OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'continue_day_invalid' USING ERRCODE = '22023', HINT = 'Pick a day and a time.';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 300 THEN
    RAISE EXCEPTION 'continue_day_note_too_long' USING ERRCODE = '22023', HINT = 'Keep the note under 300 characters.';
  END IF;
  v_new_at := (p_date + p_start_time) AT TIME ZONE 'America/Chicago';
  IF v_new_at < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'continue_day_too_soon' USING ERRCODE = '22023', HINT = 'Pick a time at least an hour from now.';
  END IF;
  IF v_new_at > now() + interval '30 days' THEN
    RAISE EXCEPTION 'continue_day_too_far' USING ERRCODE = '22023', HINT = 'Pick a day within the next 30 days.';
  END IF;

  v_poster := v_uid = v_job.customer_id;
  -- CHANGED 20261102102402 (Q2606): the poster's day goes to the Helpr to accept, as the Helpr's goes to the poster
  -- (answer_job_continue_day: the one who did not propose answers). Nobody's day is set without the other.
  v_status := 'proposed';
  v_label := public.continue_day_label(p_date, p_start_time);

  -- A second day replaces the active one (the log keeps both).
  SELECT c.id, c.status INTO v_prev
    FROM public.job_continue_days c
   WHERE c.job_id = v_job.id AND c.status IN ('proposed', 'set')
   FOR UPDATE;
  IF v_prev.id IS NOT NULL THEN
    UPDATE public.job_continue_days SET status = 'replaced', closed_at = now() WHERE id = v_prev.id;
    INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
    VALUES (v_job.id, v_prev.id, v_uid, 'replaced', jsonb_build_object('was', v_prev.status));
  END IF;

  INSERT INTO public.job_continue_days (job_id, proposed_by, new_date, new_start_time, note, status, decided_at, decided_by)
  VALUES (v_job.id, v_uid, p_date, p_start_time, v_note, v_status, NULL, NULL)
  RETURNING id INTO v_id;

  -- CHANGED 20261102102402 (Q2606): the Helpr's earlier "done" is cleared when the day is agreed (answer_job_continue_day), never on a proposal.

  INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
  VALUES (v_job.id, v_id, v_uid, 'proposed',
          jsonb_build_object('new_date', p_date, 'new_start_time', p_start_time, 'note', v_note, 'cleared_done_at', v_cleared));

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    CASE WHEN v_poster THEN v_job.helper_id ELSE v_job.customer_id END,
    v_job.id,
    CASE WHEN v_poster THEN 'New day to finish' ELSE 'Your Helpr needs another day' END,
    CASE WHEN v_poster
         -- CHANGED 20261102102402 (Q2606): the poster asks; the Helpr accepts or declines.
         THEN format('%s asked to finish "%s" on %s. Next: accept or decline the new day.',
                     COALESCE(NULLIF(split_part(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ' ', 1), ''), 'The person who posted it'),
                     COALESCE(v_job.title, 'your job'), v_label)
         -- Server-built words only (Q223): the Helpr's note is shown on the job page to the two parties, never in a notice.
         ELSE format('%s asked to finish "%s" on %s. Next: confirm the new day.',
                     COALESCE(NULLIF(split_part(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ' ', 1), ''), 'Your Helpr'),
                     COALESCE(v_job.title, 'your job'), v_label)
    END,
    'job_updates',
    CASE WHEN v_poster THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('continue_id', v_id, 'status', v_status, 'replaced', v_prev.id IS NOT NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.propose_job_continue_day(uuid, date, time without time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_job_continue_day(uuid, date, time without time zone, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.answer_job_continue_day(p_continue_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_job record;
  v_cleared timestamptz;
  v_label text;
  v_answerer uuid;
  v_helpr_answers boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Job first, then the row: the order propose_job_continue_day takes.
  SELECT c.job_id INTO v_row FROM public.job_continue_days c WHERE c.id = p_continue_id;
  IF v_row.job_id IS NULL THEN
    RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status INTO v_job
    FROM public.jobs j WHERE j.id = v_row.job_id FOR UPDATE;
  SELECT c.* INTO v_row FROM public.job_continue_days c WHERE c.id = p_continue_id FOR UPDATE;

  -- CHANGED 20261102102402 (Q2606): the one who did NOT propose answers: the poster a Helpr's day, the Helpr a poster's day. A row whose
  -- proposer is gone (proposed_by NULL) keeps the old rule: the poster answers.
  v_answerer := CASE WHEN v_row.proposed_by IS NOT NULL AND v_row.proposed_by = v_job.customer_id
                     THEN v_job.helper_id ELSE v_job.customer_id END;
  v_helpr_answers := v_answerer IS NOT DISTINCT FROM v_job.helper_id AND v_job.helper_id IS NOT NULL;
  IF v_answerer IS NULL OR v_uid IS DISTINCT FROM v_answerer THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.are_users_blocked(v_job.customer_id, v_job.helper_id) THEN
    RAISE EXCEPTION 'users_blocked' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'proposed' THEN
    RETURN jsonb_build_object('status', v_row.status, 'changed', false);
  END IF;
  IF v_job.status::text <> 'in_progress' THEN
    UPDATE public.job_continue_days SET status = 'closed', closed_at = now() WHERE id = v_row.id;
    INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
    VALUES (v_job.id, v_row.id, v_uid, 'closed', jsonb_build_object('reason', 'job_moved_on', 'job_status', v_job.status::text));
    RETURN jsonb_build_object('status', 'closed', 'changed', false);
  END IF;

  v_label := public.continue_day_label(v_row.new_date, v_row.new_start_time);
  IF p_accept THEN
    IF ((v_row.new_date + v_row.new_start_time) AT TIME ZONE 'America/Chicago') <= now() THEN
      RAISE EXCEPTION 'continue_day_in_past' USING ERRCODE = '22023', HINT = 'That time has passed. Pick a new day.';
    END IF;
    v_cleared := public.continue_day_clear_done(v_job.id);
    UPDATE public.job_continue_days
       SET status = 'set', decided_at = now(), decided_by = v_uid, cleared_done_at = v_cleared
     WHERE id = v_row.id;
  ELSE
    UPDATE public.job_continue_days
       SET status = 'declined', decided_at = now(), decided_by = v_uid, closed_at = now()
     WHERE id = v_row.id;
  END IF;
  INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
  VALUES (v_job.id, v_row.id, v_uid, CASE WHEN p_accept THEN 'set' ELSE 'declined' END,
          jsonb_build_object('cleared_done_at', v_cleared));

  -- CHANGED 20261102102402 (Q2606): the Helpr's answer goes to the poster (server-built words, the Helpr's first name).
  IF v_helpr_answers THEN
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_job.customer_id, v_job.id,
      CASE WHEN p_accept THEN 'New day accepted' ELSE 'New day declined' END,
      CASE WHEN p_accept
           THEN format('%s accepted %s to finish "%s".',
                       COALESCE(NULLIF(split_part(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ' ', 1), ''), 'Your Helpr'),
                       v_label, COALESCE(v_job.title, 'your job'))
           ELSE format('%s can''t make %s for "%s". Message them to agree on what''s next.',
                       COALESCE(NULLIF(split_part(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ' ', 1), ''), 'Your Helpr'),
                       v_label, COALESCE(v_job.title, 'your job'))
      END,
      'job_updates',
      '/posts?job=' || v_job.id::text
    );
    RETURN jsonb_build_object('status', CASE WHEN p_accept THEN 'set' ELSE 'declined' END, 'changed', true);
  END IF;
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_job.helper_id, v_job.id,
    CASE WHEN p_accept THEN 'Another day confirmed' ELSE 'Another day declined' END,
    CASE WHEN p_accept
         THEN format('%s confirmed %s to finish "%s". Next: confirm you''ll be there.',
                     COALESCE(NULLIF(split_part(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ' ', 1), ''), 'The person who posted it'),
                     v_label, COALESCE(v_job.title, 'your job'))
         ELSE format('The person who posted "%s" declined %s. Message them to agree on what''s next.', COALESCE(v_job.title, 'the job'), v_label)
    END,
    'job_updates',
    '/jobs?job=' || v_job.id::text
  );
  RETURN jsonb_build_object('status', CASE WHEN p_accept THEN 'set' ELSE 'declined' END, 'changed', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.answer_job_continue_day(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_job_continue_day(uuid, boolean) TO authenticated, service_role;

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
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
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
      'poster_confirmation_required', false,
      'poster_can_confirm', true,
      'arrival_established', true
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
    'poster_confirmation_required', NOT v_verified,
    'poster_can_confirm', NOT v_verified,
    'arrival_established', v_verified
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_helper_arrival(uuid, numeric, numeric) TO authenticated, service_role;

