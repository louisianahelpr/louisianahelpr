-- Q2390 packet 3 (book_accepted_quote, confirm_job_continue_day, nudge_confirm):
-- "not found" answers HTTP 404, not 500.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Each is restated VERBATIM from prod (pg_proc.prosrc read 2026-11-02, md5 equal
-- to the newest migration copy; header attributes as pg_get_functiondef):
--   book_accepted_quote       11ab71ca763cda4d71dc8fd903cc2476 1521 chars (20261015091114)
--   confirm_job_continue_day  dd8fd7e0669879ec10b39d78348edc2f 1798 chars (20261101231015)
--   nudge_confirm             2904894f8b9a18192960ec6655db709a 2106 chars (20261021131322)
-- The ONLY change is one ERRCODE 'P0002' -> 'PT404' in each. Messages
-- (unknown_request, continue_day_not_found, job_not_found) and control flow are
-- unchanged. Grants restated as on prod (proacl: postgres, authenticated,
-- service_role).

CREATE OR REPLACE FUNCTION public.book_accepted_quote(p_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_q   public.job_quotes%ROWTYPE;
  v_job uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404';
  END IF;
  IF v_req.status <> 'agreed' THEN
    RAISE EXCEPTION 'no_agreed_quote' USING ERRCODE = '55000';
  END IF;
  IF v_req.job_id IS NOT NULL THEN
    RETURN v_req.job_id;
  END IF;
  SELECT * INTO v_q FROM public.job_quotes
   WHERE request_id = p_request_id AND status = 'accepted' FOR UPDATE;
  IF NOT FOUND OR v_q.quoter_id IS NULL THEN
    RAISE EXCEPTION 'no_agreed_quote' USING ERRCODE = '55000';
  END IF;
  -- Q345: booking offers the job to the quoter, so it is refused across a
  -- block exactly as respond_to_job_quote's accept is.
  IF public.are_users_blocked(v_uid, v_q.quoter_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  -- Whole dollars: job_quotes CHECKs price_cents % 100 = 0.
  v_job := public.quote_insert_job(v_req, (v_q.price_cents / 100)::numeric, v_q.quoter_id);
  UPDATE public.job_quote_requests SET job_id = v_job, updated_at = now() WHERE id = p_request_id;
  RETURN v_job;
END;
$fn$;

REVOKE ALL ON FUNCTION public.book_accepted_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_accepted_quote(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_job_continue_day(p_continue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_job record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT c.job_id INTO v_row FROM public.job_continue_days c WHERE c.id = p_continue_id;
  IF v_row.job_id IS NULL THEN
    RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status INTO v_job
    FROM public.jobs j WHERE j.id = v_row.job_id FOR UPDATE;
  SELECT c.* INTO v_row FROM public.job_continue_days c WHERE c.id = p_continue_id FOR UPDATE;
  IF v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'set' THEN
    RAISE EXCEPTION 'continue_day_not_set' USING ERRCODE = '22023';
  END IF;
  IF v_row.helper_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('helper_confirmed_at', v_row.helper_confirmed_at, 'changed', false);
  END IF;
  UPDATE public.job_continue_days SET helper_confirmed_at = now() WHERE id = v_row.id;
  INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action) VALUES (v_job.id, v_row.id, v_uid, 'helpr_confirmed');
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (v_job.customer_id, v_job.id, 'Your Helpr confirmed',
          format('Your Helpr confirmed they''ll be back for "%s" %s.', COALESCE(v_job.title, 'your job'),
                 public.continue_day_label(v_row.new_date, v_row.new_start_time)),
          'job_updates', '/posts?job=' || v_job.id::text);
  RETURN jsonb_build_object('helper_confirmed_at', now(), 'changed', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.confirm_job_continue_day(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_job_continue_day(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nudge_confirm(p_job_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_job public.jobs;
  v_uid uuid := auth.uid();
  v_target uuid;
  v_sender text;
  v_owes boolean;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_uid IS NULL OR (v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id) THEN
    RAISE EXCEPTION 'not_a_party' USING ERRCODE = '42501';
  END IF;
  -- A restricted account sends nobody anything (the ban gate, Q281).
  IF public.is_caller_banned() THEN
    RETURN 'account_restricted';
  END IF;
  IF v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_confirmed_at IS NULL THEN
    RETURN 'not_booked';
  END IF;
  v_target := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;
  v_owes := CASE WHEN v_target = v_job.helper_id THEN v_job.helper_dayof_confirmed_at IS NULL ELSE v_job.poster_confirmed_at IS NULL END;
  IF NOT v_owes THEN
    RETURN 'already_confirmed';
  END IF;
  -- Once per 2 hours per job per sender: the notifications row is the record.
  IF EXISTS (SELECT 1 FROM public.notifications n
              WHERE n.user_id = v_target AND n.job_id = p_job_id AND n.title = 'Please confirm'
                AND n.created_at > now() - interval '2 hours') THEN
    RETURN 'too_soon';
  END IF;
  SELECT COALESCE(NULLIF(split_part(COALESCE(public.member_display_name(p.full_name, NULL), ''), ' ', 1), ''), 'They') INTO v_sender
    FROM public.profiles p WHERE p.user_id = v_uid;
  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (
    v_target, 'Please confirm',
    COALESCE(v_sender, 'They') || ' asked you to confirm "' || COALESCE(v_job.title, 'the job') || '" is still on.'
      || CASE WHEN v_target = v_job.helper_id THEN ' If you don''t confirm 2 hours before the start, it''s reposted to other Helprs.' ELSE '' END,
    'job_update',
    CASE WHEN v_target = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || p_job_id::text,
    p_job_id
  );
  RETURN 'sent';
END;
$fn$;

REVOKE ALL ON FUNCTION public.nudge_confirm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nudge_confirm(uuid) TO authenticated, service_role;

