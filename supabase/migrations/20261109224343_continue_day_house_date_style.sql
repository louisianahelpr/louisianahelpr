-- F175 (owner UI audit 11-09; lead 11-09: "change the shared continue_day_label date format AND the client mirror
-- together, plus the First L. name; display only").
--
-- "Your Helpr needs another day" read "Hallie asked to finish "Lay garden pavers" on Wed 11/11 at 9 AM", while every
-- other message writes "Sun, Nov 15 at 10:00 AM" and names the person "Hallie H.". Two display changes:
--   1. continue_day_label (every continue-day notice and the in-app line read it) writes the house style,
--      "Wed, Nov 11 at 9:00 AM": to_char 'FMDy, FMMon FMDD' and always 'FMHH12:MI AM'. The client mirror
--      (src/lib/continueDayWords.ts continueDayLabel) changes in the same commit; src/test/continueDayLabelParity.test.ts
--      and the PGlite proof hold them identical.
--   2. propose_job_continue_day names the asker "First L." (member_display_name, the same mask every notice uses)
--      instead of the first name alone, in both directions (the Helpr's ask and the poster's).
-- Nothing else changes: the same rows, links, types, checks and refusals. Bodies are the LIVE definitions (md5(prosrc)
-- continue_day_label 6a97401a..., propose_job_continue_day 1883f7bd... on prod 11-09, byte-equal to the newest repo
-- definitions) with only those two changes. Grants restated as live proacl. Replay-safe: CREATE OR REPLACE.
-- Proof: src/test/pglite/continueDayHouseDateStyle.pglite.mjs (3x replay; --before red).

CREATE OR REPLACE FUNCTION public.continue_day_label(p_date date, p_time time)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT to_char(p_date, 'FMDy, FMMon FMDD') || ' at ' || to_char(p_time, 'FMHH12:MI AM')
$function$;

REVOKE ALL ON FUNCTION public.continue_day_label(date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.continue_day_label(date, time) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.propose_job_continue_day(p_job_id uuid, p_date date, p_start_time time, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
                     COALESCE(NULLIF(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ''), 'The person who posted it'),
                     COALESCE(v_job.title, 'your job'), v_label)
         -- Server-built words only (Q223): the Helpr's note is shown on the job page to the two parties, never in a notice.
         ELSE format('%s asked to finish "%s" on %s. Next: confirm the new day.',
                     COALESCE(NULLIF(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ''), 'Your Helpr'),
                     COALESCE(v_job.title, 'your job'), v_label)
    END,
    'job_updates',
    CASE WHEN v_poster THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('continue_id', v_id, 'status', v_status, 'replaced', v_prev.id IS NOT NULL);
END;
$function$
;

REVOKE ALL ON FUNCTION public.propose_job_continue_day(uuid, date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_job_continue_day(uuid, date, time, text) TO authenticated, service_role;
