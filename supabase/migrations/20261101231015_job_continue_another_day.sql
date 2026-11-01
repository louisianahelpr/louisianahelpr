-- COULDN'T FINISH: CONTINUE ANOTHER DAY (owner 2026-11-01 5:05 PM, Yusef's job: "he couldn't finish today so he
-- will go back Thursday. We need to add this to the job so if this happens again we can move the day").
--
-- A job under way (in_progress) gets a continue day: the rest of the work moves to a new date and time.
--   * The Helpr proposes it (propose_job_continue_day as the Helpr -> 'proposed'); the poster confirms with one
--     tap (answer_job_continue_day) or declines. The poster can also set it themselves (the same RPC as the
--     poster -> 'set' at once). The poster stays in control: nothing is set without them.
--   * The job stays in progress, the money stays held. While a continue day is active (proposed or set) the
--     approval clock does not run: auto-release-payment skips the job (_shared/continueDay.ts reads this table,
--     fails closed). A 'set' clears the Helpr's earlier "done" (helper_completed_at) so the clock starts again only
--     when they mark it done for real; enforce_completion_on_live_job lets ONLY this RPC clear it, under the
--     transaction-local flag app.continue_day_rpc.
--   * The Helpr cannot mark it done again before the continue day's date (refuse_done_before_continue_day, end-user
--     sessions only; the poster's approval on the server is never refused). Marking it done, the poster's approval,
--     or the job leaving the live statuses closes the active row (close_continue_day_on_job_change).
--   * Reminders fire for the NEW day only (sweep_job_continue_day_reminders, its own sends keyed by the continue
--     row): 2 hours before to both sides, a confirm ask to the Helpr from 7 AM that day, and an alert to the poster
--     30 minutes past the new start when the Helpr has not confirmed. jobs.date_needed is NOT moved: the original day
--     stays the record, and every existing day-of sweep reads status 'accepted', which a continuing job never is,
--     so no no-show is ever marked for the original day.
--   * A second continue day is allowed (a new proposal replaces the active one). Every change is logged in
--     job_continue_events.
-- Proof: src/test/pglite/jobContinueDay.pglite.mjs.

-- ── Tables ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_continue_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  proposed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  new_date date NOT NULL,
  new_start_time time NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'set', 'declined', 'replaced', 'finished', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The Helpr's earlier "done" this row cleared, kept for the record.
  cleared_done_at timestamptz,
  -- The Helpr's confirm that they will be there on the new day.
  helper_confirmed_at timestamptz,
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS job_continue_days_one_active
  ON public.job_continue_days (job_id) WHERE status IN ('proposed', 'set');
CREATE INDEX IF NOT EXISTS job_continue_days_set_day
  ON public.job_continue_days (new_date) WHERE status = 'set';

CREATE TABLE IF NOT EXISTS public.job_continue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  continue_id uuid REFERENCES public.job_continue_days(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_continue_events_job ON public.job_continue_events (job_id, created_at);

CREATE TABLE IF NOT EXISTS public.job_continue_reminder_sends (
  continue_id uuid NOT NULL REFERENCES public.job_continue_days(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (continue_id, kind)
);

ALTER TABLE public.job_continue_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_continue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_continue_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_continue_days, public.job_continue_events, public.job_continue_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_continue_days TO authenticated;
GRANT SELECT ON TABLE public.job_continue_events TO authenticated;
GRANT ALL ON TABLE public.job_continue_days TO service_role;
GRANT ALL ON TABLE public.job_continue_events TO service_role;
GRANT ALL ON TABLE public.job_continue_reminder_sends TO service_role;

-- The job's two parties read; nobody writes from the client (every write is an RPC below).
DROP POLICY IF EXISTS "Job parties read continue days" ON public.job_continue_days;
CREATE POLICY "Job parties read continue days" ON public.job_continue_days FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id
                  AND ((SELECT auth.uid()) = j.customer_id OR (SELECT auth.uid()) = j.helper_id)));
DROP POLICY IF EXISTS "Job parties read continue events" ON public.job_continue_events;
CREATE POLICY "Job parties read continue events" ON public.job_continue_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id
                  AND ((SELECT auth.uid()) = j.customer_id OR (SELECT auth.uid()) = j.helper_id)));

-- ── The one completion trigger, restated with ONE new allowance ────────────
-- Unchanged from 20260915101102 except the first block: the continue-day RPC (its transaction-local flag, set only
-- around its own UPDATE) may clear the Helpr's "done" when the poster sets a day to come back.
CREATE OR REPLACE FUNCTION public.enforce_completion_on_live_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- NO END USER UNSTAMPS DONE (20260915101102), with one door: a continue day set by the poster
  -- (set_continue_day_core, flag app.continue_day_rpc) clears it so the approval clock waits for the real finish.
  IF OLD.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS NULL
     AND NOT public.is_server_context()
     AND COALESCE(current_setting('app.continue_day_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'helper_completed_at_not_clearable'
      USING ERRCODE = '42501',
            HINT = 'A job marked done stays marked done. Ask for a change or open a dispute instead.';
  END IF;

  -- A second Done keeps the FIRST stamp (idempotent; the auto-release clock does not move).
  IF OLD.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS NOT NULL
     AND NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at
     AND (auth.uid() IS NOT NULL
          OR COALESCE(auth.role(), '') IN ('anon', 'authenticated', 'service_role')) THEN
    NEW.helper_completed_at := OLD.helper_completed_at;
    RETURN NEW;
  END IF;

  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Only the stamping transition is judged below.
  IF NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer active (status=' || OLD.status::text || '), so it cannot be marked done.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── Helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.continue_day_label(p_date date, p_time time)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $fn$
  SELECT to_char(p_date, 'FMDy FMMM/FMDD') || ' at ' ||
         CASE WHEN extract(minute FROM p_time) = 0 THEN to_char(p_time, 'FMHH12 AM') ELSE to_char(p_time, 'FMHH12:MI AM') END
$fn$;
REVOKE ALL ON FUNCTION public.continue_day_label(date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.continue_day_label(date, time) TO authenticated, service_role;

-- ── propose_job_continue_day: the Helpr proposes, the poster sets ──────────
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
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_prev record;
  v_id uuid;
  v_status text;
  v_cleared timestamptz;
  v_label text;
BEGIN
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
  v_status := CASE WHEN v_poster THEN 'set' ELSE 'proposed' END;
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
  VALUES (v_job.id, v_uid, p_date, p_start_time, v_note, v_status,
          CASE WHEN v_poster THEN now() END, CASE WHEN v_poster THEN v_uid END)
  RETURNING id INTO v_id;

  IF v_poster THEN
    v_cleared := public.continue_day_clear_done(v_job.id);
    UPDATE public.job_continue_days SET cleared_done_at = v_cleared WHERE id = v_id;
  END IF;

  INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
  VALUES (v_job.id, v_id, v_uid, CASE WHEN v_poster THEN 'set' ELSE 'proposed' END,
          jsonb_build_object('new_date', p_date, 'new_start_time', p_start_time, 'note', v_note, 'cleared_done_at', v_cleared));

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    CASE WHEN v_poster THEN v_job.helper_id ELSE v_job.customer_id END,
    v_job.id,
    CASE WHEN v_poster THEN 'Job continues another day' ELSE 'Your Helpr needs another day' END,
    CASE WHEN v_poster
         THEN format('%s set %s to finish "%s". Next: confirm you''ll be there.',
                     COALESCE(NULLIF(split_part(btrim((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid)), ' ', 1), ''), 'The person who posted it'),
                     v_label, COALESCE(v_job.title, 'your job'))
         ELSE format('Your Helpr asked to finish "%s" on %s. Tap to confirm the day.%s', COALESCE(v_job.title, 'your job'), v_label,
                     CASE WHEN v_note IS NULL THEN '' ELSE ' Note: ' || left(v_note, 120) END)
    END,
    'job_updates',
    CASE WHEN v_poster THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('continue_id', v_id, 'status', v_status, 'replaced', v_prev.id IS NOT NULL);
END;
$fn$;

-- Clears the Helpr's "done" for a continue day. Only the two RPCs in this file call it (it trusts its caller:
-- EXECUTE is revoked from every client role).
CREATE OR REPLACE FUNCTION public.continue_day_clear_done(p_job_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_was timestamptz;
BEGIN
  SELECT helper_completed_at INTO v_was FROM public.jobs WHERE id = p_job_id;
  IF v_was IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.continue_day_rpc', '1', true);
  UPDATE public.jobs SET helper_completed_at = NULL WHERE id = p_job_id AND status::text = 'in_progress';
  PERFORM set_config('app.continue_day_rpc', '0', true);
  RETURN v_was;
END;
$fn$;
REVOKE ALL ON FUNCTION public.continue_day_clear_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.continue_day_clear_done(uuid) TO service_role;

-- ── answer_job_continue_day: the poster confirms (one tap) or declines ─────
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

  IF v_uid IS DISTINCT FROM v_job.customer_id THEN
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

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_job.helper_id, v_job.id,
    CASE WHEN p_accept THEN 'Another day confirmed' ELSE 'Another day declined' END,
    CASE WHEN p_accept
         THEN format('%s confirmed %s to finish "%s". Next: confirm you''ll be there.',
                     COALESCE(NULLIF(split_part(btrim((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid)), ' ', 1), ''), 'The person who posted it'),
                     v_label, COALESCE(v_job.title, 'your job'))
         ELSE format('The person who posted "%s" declined %s. Message them to agree on what''s next.', COALESCE(v_job.title, 'the job'), v_label)
    END,
    'job_updates',
    '/jobs?job=' || v_job.id::text
  );
  RETURN jsonb_build_object('status', CASE WHEN p_accept THEN 'set' ELSE 'declined' END, 'changed', true);
END;
$fn$;

-- ── confirm_job_continue_day: the Helpr's day-of confirm for the new day ───
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
    RAISE EXCEPTION 'continue_day_not_found' USING ERRCODE = 'P0002';
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

REVOKE ALL ON FUNCTION public.propose_job_continue_day(uuid, date, time, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_job_continue_day(uuid, date, time, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.answer_job_continue_day(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_job_continue_day(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_job_continue_day(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_job_continue_day(uuid) TO authenticated, service_role;

-- ── Done before the new day is refused; done / approval / moving on closes it ──
CREATE OR REPLACE FUNCTION public.refuse_done_before_continue_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_day date;
BEGIN
  IF public.is_server_context() OR NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.new_date INTO v_day
    FROM public.job_continue_days c
   WHERE c.job_id = OLD.id AND c.status = 'set';
  IF v_day IS NOT NULL AND (now() AT TIME ZONE 'America/Chicago')::date < v_day THEN
    RAISE EXCEPTION 'continue_day_ahead' USING ERRCODE = '23514',
      HINT = 'This job continues on ' || to_char(v_day, 'FMDy FMMM/FMDD') || '. Mark it done once you finish that day.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_done_before_continue_day() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_refuse_done_before_continue_day ON public.jobs;
CREATE TRIGGER trg_refuse_done_before_continue_day
  BEFORE UPDATE OF helper_completed_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.refuse_done_before_continue_day();

CREATE OR REPLACE FUNCTION public.close_continue_day_on_job_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_reason text;
  v_row record;
BEGIN
  IF NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL THEN
    v_reason := 'helpr_marked_done';
  ELSIF NEW.poster_completed_at IS NOT NULL AND OLD.poster_completed_at IS NULL THEN
    v_reason := 'poster_approved';
  ELSIF NEW.status::text NOT IN ('in_progress', 'accepted', 'revision_requested') AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_reason := 'job_' || NEW.status::text;
  ELSE
    RETURN NULL;
  END IF;
  FOR v_row IN
    UPDATE public.job_continue_days
       SET status = CASE WHEN v_reason IN ('helpr_marked_done', 'poster_approved') THEN 'finished' ELSE 'closed' END,
           closed_at = now()
     WHERE job_id = NEW.id AND status IN ('proposed', 'set')
    RETURNING id, status
  LOOP
    INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
    VALUES (NEW.id, v_row.id, auth.uid(), v_row.status, jsonb_build_object('reason', v_reason));
  END LOOP;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.close_continue_day_on_job_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_close_continue_day_on_job_change ON public.jobs;
CREATE TRIGGER trg_close_continue_day_on_job_change
  AFTER UPDATE OF helper_completed_at, poster_completed_at, status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.close_continue_day_on_job_change();

-- ── Reminders for the NEW day ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sweep_job_continue_day_reminders(p_now timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  rec record;
  v_claimed integer;
  v_sent integer := 0;
BEGIN
  FOR rec IN
    WITH active AS (
      SELECT c.id AS continue_id, c.new_date, c.new_start_time, c.helper_confirmed_at,
             j.id AS job_id, j.title, j.customer_id, j.helper_id,
             ((c.new_date + c.new_start_time) AT TIME ZONE 'America/Chicago') AS starts_at
        FROM public.job_continue_days c
        JOIN public.jobs j ON j.id = c.job_id
       WHERE c.status = 'set'
         AND j.status::text = 'in_progress'
         AND j.helper_id IS NOT NULL
         AND j.helper_completed_at IS NULL
    )
    SELECT a.*, k.kind
      FROM active a
      CROSS JOIN LATERAL (VALUES
        -- 2 hours before, up to 15 minutes late (cron every 5), to each side.
        (CASE WHEN v_now >= a.starts_at - interval '2 hours' AND v_now < a.starts_at - interval '105 minutes' THEN 'two_hours_helpr' END),
        (CASE WHEN v_now >= a.starts_at - interval '2 hours' AND v_now < a.starts_at - interval '105 minutes' THEN 'two_hours_poster' END),
        -- The day-of confirm ask: from 7 AM Central on the new day (or 3 hours before an earlier start), until the start.
        (CASE WHEN a.helper_confirmed_at IS NULL
               AND v_now >= LEAST(((a.new_date + time '07:00') AT TIME ZONE 'America/Chicago'), a.starts_at - interval '3 hours')
               AND v_now < a.starts_at THEN 'confirm_ask' END),
        -- 30 minutes past the new start without the Helpr's confirm: tell the poster (nothing is marked).
        (CASE WHEN a.helper_confirmed_at IS NULL
               AND v_now >= a.starts_at + interval '30 minutes'
               AND v_now < a.starts_at + interval '6 hours' THEN 'not_confirmed_poster' END)
      ) AS k(kind)
     WHERE k.kind IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.job_continue_reminder_sends s WHERE s.continue_id = a.continue_id AND s.kind = k.kind)
     ORDER BY a.starts_at
     LIMIT 300
  LOOP
    INSERT INTO public.job_continue_reminder_sends (continue_id, kind, sent_at)
    VALUES (rec.continue_id, rec.kind, v_now)
    ON CONFLICT (continue_id, kind) DO NOTHING;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    CONTINUE WHEN v_claimed = 0;

    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      CASE WHEN rec.kind IN ('two_hours_helpr', 'confirm_ask') THEN rec.helper_id ELSE rec.customer_id END,
      rec.job_id,
      CASE rec.kind
        WHEN 'two_hours_helpr' THEN 'Back on your job in 2 hours'
        WHEN 'two_hours_poster' THEN 'Your Helpr is back in 2 hours'
        WHEN 'confirm_ask' THEN 'Confirm you''ll be back today'
        ELSE 'Your Helpr hasn''t confirmed today'
      END,
      CASE rec.kind
        WHEN 'two_hours_helpr' THEN format('"%s" continues today at %s.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        WHEN 'two_hours_poster' THEN format('Your Helpr comes back to finish "%s" today at %s.', COALESCE(rec.title, 'your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        WHEN 'confirm_ask' THEN format('"%s" continues today at %s. Confirm you''ll be there.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
        ELSE format('"%s" was set to continue at %s and your Helpr hasn''t confirmed. Message them, or set another day.', COALESCE(rec.title, 'Your job'), to_char(rec.new_start_time, 'FMHH12:MI AM'))
      END,
      'job_updates',
      CASE WHEN rec.kind IN ('two_hours_helpr', 'confirm_ask') THEN '/jobs?job=' ELSE '/posts?job=' END || rec.job_id::text
    );
    INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
    VALUES (rec.job_id, rec.continue_id, NULL, 'reminder', jsonb_build_object('kind', rec.kind));
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_job_continue_day_reminders(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_job_continue_day_reminders(timestamptz) TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('sweep-job-continue-day-reminders', interval '30 minutes',
            'Owner 11-01: a job continued on another day gets its own reminders for the NEW day (2 h before, the day-of confirm, a not-confirmed alert).',
            'exempt', 'Almost every run finds no continue day at a reminder edge: nothing to send is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('sweep-job-continue-day-reminders', '1-59/5',
      $c$SELECT public.cron_record_work('sweep-job-continue-day-reminders', to_jsonb(public.sweep_job_continue_day_reminders()));$c$);
  END IF;
END
$do$;
