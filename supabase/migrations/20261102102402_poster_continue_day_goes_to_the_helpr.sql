-- THE POSTER'S "ANOTHER DAY" GOES TO THE HELPR TO ACCEPT, AS THE HELPR'S GOES TO THE POSTER (Jobs audit 1102b row 20, Q2606).
--
-- What was wrong (prod bodies read 2026-11-02 ~4:40 AM CT; md5(prosrc) equal to 20261101231015's: propose 8ceefcc4...,
-- answer 99f165fa...): "Not finished? Set a day" sent the Helpr's pick to the poster to confirm, but the poster's pick
-- was SET at once ("Dana set Thu 11/5 at 9 AM to finish ... Next: confirm you'll be there"): the poster booked the
-- Helpr's time without asking, and the Helpr's only answer was to confirm it. It also cleared the Helpr's earlier
-- "done" at once.
--
-- The fix: propose_job_continue_day makes every pick a proposal ('proposed'), whoever asks; answer_job_continue_day
-- lets the one who did NOT propose answer it (the Helpr a poster's day, the poster a Helpr's day; a row whose proposer
-- account is gone keeps the old rule, the poster answers). Accepting sets the day and clears the earlier done, exactly
-- as the poster's confirm did; declining closes it. The Helpr's answer is told to the poster in server-built words.
-- The approval clock still holds while a day is proposed (auto-release reads 'proposed' and 'set' alike), the day-of
-- confirm (confirm_job_continue_day) is unchanged, and nothing else in either body moves.
--
-- Replay-safe: CREATE OR REPLACE of existing functions; grants restated as live (authenticated, service_role).
-- Proof: src/test/pglite/posterContinueDayAsksTheHelpr.pglite.mjs.

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
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
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
    RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'P0002';
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


REVOKE ALL ON FUNCTION public.propose_job_continue_day(uuid, date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_job_continue_day(uuid, date, time, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.answer_job_continue_day(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_job_continue_day(uuid, boolean) TO authenticated, service_role;
