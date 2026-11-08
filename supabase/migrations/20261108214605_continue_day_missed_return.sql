-- OWNER DECISION #4 (11-08), Jobs audit 11-08 #4 (Medium): ~/.lh-shots/handoffs-1108/jobs-audit.md.
--
-- A continue day whose time has passed without "Mark done" had no way out: the no-show RPC refuses (day-1 arrival
-- stamps are kept) and helper_cancel_booking only takes an accepted job. The poster got "Not marked done yet" and
-- nothing to tap; the money stayed held.
--
-- Owner (11-08): the poster gets "Didn't come back" (optional photos of what's left plus a note); the Helpr gets
-- "Can't come back" (a note). Either one sends the job to the admin queue and the admin decides the split with the
-- existing admin release / refund tools. NO MONEY MOVES automatically.
--
-- report_continue_day_missed(p_job_id, p_note, p_photos), callable by the job's poster or hired Helpr only while:
--   * the job is a solo job in progress with the Helpr's done NOT on;
--   * its active continue day is 'set' (agreed) and has LAPSED: start + 6 hours (CONTINUE_DAY_HOLD_GRACE_HOURS in
--     supabase/functions/_shared/continueDay.ts, the same instant the day stops holding the job).
-- It, in one transaction:
--   1. closes the continue day as 'lapsed' (a new status) and logs job_continue_events 'missed_poster' /
--      'cant_come_back';
--   2. writes the report: public.job_missed_returns (who, which side, note, photos), one open per job;
--   3. puts the job in the admin queue as a REAL ROW: job_completion_nudges escalated_at = now(), resolved_at cleared,
--      which admin_stalled_job_queue (Admin -> Stuck jobs, rail badge) lists; not only a bell notice;
--   4. tells the other side (in-app row + email under Job updates) and the admins (skipped for a seed job or a test
--      member on either side: test data never pages the owner).
-- While the report is open the job is HELD: _shared/continueDay.ts loadContinuingJobs reads job_missed_returns, so
-- auto-release-payment neither escalates nor instant-releases it, stalled-completion-reminder does not nudge it and
-- payment-confirm-reminder does not ask. A new continue day is refused (continue_day_missed_open) for end users.
-- The report closes itself when the admin acts: "Mark Reviewed" on the stuck-job row (job_completion_nudges.resolved_at
-- set) or the job leaving in_progress (an admin release / refund / status change, or the poster's own approval).
--
-- admin_stalled_job_queue is restated from its NEWEST definition (20261103214229) with ONE change: a lapsed day
-- (closed by this report) dates the row, and is never treated as "still ahead".
--
-- Proof: src/test/pglite/continueDayMissedReturn.pglite.mjs. Guard: src/test/continueDayMissedReturn.test.ts.

-- ── 1. The 'lapsed' status ────────────────────────────────────────────────────────────────────────────────────────
DO $do$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = 'public.job_continue_days'::regclass AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%replaced%'
  LOOP
    EXECUTE format('ALTER TABLE public.job_continue_days DROP CONSTRAINT %I', v_con);
  END LOOP;
END
$do$;
ALTER TABLE public.job_continue_days ADD CONSTRAINT job_continue_days_status_check
  CHECK (status IN ('proposed', 'set', 'declined', 'replaced', 'finished', 'closed', 'lapsed'));

-- ── 2. The report (the admin's record of who said what) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_missed_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  continue_id uuid REFERENCES public.job_continue_days(id) ON DELETE SET NULL,
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  side text NOT NULL CHECK (side IN ('poster', 'helpr')),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  photos text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(photos) <= 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution text
);
CREATE UNIQUE INDEX IF NOT EXISTS job_missed_returns_one_open ON public.job_missed_returns (job_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS job_missed_returns_continue ON public.job_missed_returns (continue_id);
CREATE INDEX IF NOT EXISTS job_missed_returns_reported_by ON public.job_missed_returns (reported_by);
CREATE INDEX IF NOT EXISTS job_missed_returns_resolved_by ON public.job_missed_returns (resolved_by);

ALTER TABLE public.job_missed_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_missed_returns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_missed_returns TO authenticated;
GRANT ALL ON TABLE public.job_missed_returns TO service_role;

DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The job's two parties and the admins read; nobody writes from the client (the RPC below is the one writer).
DROP POLICY IF EXISTS "Job parties and admins read missed returns" ON public.job_missed_returns;
CREATE POLICY "Job parties and admins read missed returns" ON public.job_missed_returns FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin')
         OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id
                     AND ((SELECT auth.uid()) = j.customer_id OR (SELECT auth.uid()) = j.helper_id)));

-- ── 3. The RPC ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_continue_day_missed(p_job_id uuid, p_note text DEFAULT NULL, p_photos text[] DEFAULT '{}'::text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_row record;
  v_side text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_photos text[] := COALESCE(p_photos, '{}'::text[]);
  v_photo text;
  v_report uuid;
  v_name text;
  v_day text;
  v_other uuid;
  v_title text;
  v_msg text;
  v_link text;
  v_test boolean;
BEGIN
  -- An end user only: a server caller (null uid) has no side to report from.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status::text AS status, j.is_group_job, j.is_seed,
         j.helper_completed_at
    INTO v_job
    FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_uid = v_job.customer_id THEN
    v_side := 'poster';
  ELSIF v_uid = v_job.helper_id THEN
    v_side := 'helpr';
  ELSE
    RAISE EXCEPTION 'not_a_party' USING ERRCODE = '42501';
  END IF;
  IF v_job.status <> 'in_progress' OR COALESCE(v_job.is_group_job, false) OR v_job.helper_id IS NULL THEN
    RAISE EXCEPTION 'continue_day_missed_not_live' USING ERRCODE = '22023';
  END IF;
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'continue_day_missed_marked_done' USING ERRCODE = '22023',
      HINT = 'The Helpr marked it done. Approve it, ask for a fix, or open a dispute instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_missed_returns m WHERE m.job_id = v_job.id AND m.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'continue_day_missed_already_reported' USING ERRCODE = '23505';
  END IF;
  SELECT c.* INTO v_row FROM public.job_continue_days c
   WHERE c.job_id = v_job.id AND c.status = 'set'
   ORDER BY c.created_at DESC LIMIT 1
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'continue_day_missed_no_day' USING ERRCODE = '22023';
  END IF;
  -- Lapsed: the day's start + 6 hours (CONTINUE_DAY_HOLD_GRACE_HOURS), Central.
  IF now() < ((v_row.new_date + v_row.new_start_time) AT TIME ZONE 'America/Chicago') + interval '6 hours' THEN
    RAISE EXCEPTION 'continue_day_missed_too_soon' USING ERRCODE = '22023',
      HINT = 'You can report this once the day you set has passed.';
  END IF;
  -- Photos: the poster's only, at most 5, each its own upload for this job in the immutable evidence folder
  -- (proof-photos <uid>/disputes/<job>/..., the folder 20260925141905 makes immutable).
  IF v_side = 'helpr' AND cardinality(v_photos) > 0 THEN
    RAISE EXCEPTION 'continue_day_missed_photos_poster_only' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_photos) > 5 THEN
    RAISE EXCEPTION 'continue_day_missed_too_many_photos' USING ERRCODE = '22023';
  END IF;
  FOREACH v_photo IN ARRAY v_photos LOOP
    IF v_photo IS NULL OR length(v_photo) > 300
       OR v_photo !~ ('^' || v_uid::text || '/disputes/' || v_job.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*$')
       OR position('..' IN v_photo) > 0 THEN
      RAISE EXCEPTION 'continue_day_missed_bad_photo' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'continue_day_missed_note_too_long' USING ERRCODE = '22023';
  END IF;

  -- 1. The day closes as lapsed.
  UPDATE public.job_continue_days SET status = 'lapsed', closed_at = now() WHERE id = v_row.id;
  INSERT INTO public.job_continue_events (job_id, continue_id, actor_id, action, detail)
  VALUES (v_job.id, v_row.id, v_uid, CASE WHEN v_side = 'poster' THEN 'missed_poster' ELSE 'cant_come_back' END,
          jsonb_build_object('note', v_note, 'photos', to_jsonb(v_photos)));

  -- 2. The report.
  INSERT INTO public.job_missed_returns (job_id, continue_id, reported_by, side, note, photos)
  VALUES (v_job.id, v_row.id, v_uid, v_side, v_note, v_photos)
  RETURNING id INTO v_report;

  -- 3. The admin queue row (Admin -> Stuck jobs reads escalated and unresolved).
  INSERT INTO public.job_completion_nudges (job_id, escalated_at)
  VALUES (v_job.id, now())
  ON CONFLICT (job_id) DO UPDATE SET escalated_at = now(), resolved_at = NULL, resolved_by = NULL;

  -- 4. The other side, then the admins.
  SELECT COALESCE(NULLIF(split_part(COALESCE(public.member_display_name(p.full_name, NULL), ''), ' ', 1), ''),
                  CASE WHEN v_side = 'poster' THEN 'The person who posted it' ELSE 'Your Helpr' END)
    INTO v_name FROM public.profiles p WHERE p.user_id = v_uid;
  v_name := COALESCE(v_name, CASE WHEN v_side = 'poster' THEN 'The person who posted it' ELSE 'Your Helpr' END);
  v_day := public.continue_day_label(v_row.new_date, v_row.new_start_time);
  IF v_side = 'poster' THEN
    v_other := v_job.helper_id;
    v_title := 'Reported: didn''t come back';
    v_msg := format('%s told us you didn''t come back %s to finish "%s". Louisiana Helpr is reviewing the job and will decide the payment. Nothing is paid or refunded until then.',
                    v_name, v_day, COALESCE(v_job.title, 'the job'));
    v_link := '/jobs?job=' || v_job.id::text;
  ELSE
    v_other := v_job.customer_id;
    v_title := 'Your Helpr can''t come back';
    v_msg := format('%s can''t come back to finish "%s". Louisiana Helpr is reviewing the job and will decide the payment. Nothing is paid or refunded until then.',
                    v_name, COALESCE(v_job.title, 'your job'));
    v_link := '/posts?job=' || v_job.id::text;
  END IF;
  IF v_other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (v_other, v_job.id, v_title, v_msg, 'job_updates', v_link);
    PERFORM public.send_notice_email(v_other, v_title, v_msg, 'job_updates', v_link, v_job.id);
  END IF;

  -- Test data never pages the owner: a seed job, or a test member on either side, alerts nobody.
  v_test := COALESCE(v_job.is_seed, false)
            OR (v_job.customer_id IS NOT NULL AND public.is_test_subject(v_job.customer_id))
            OR public.is_test_subject(v_job.helper_id)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id IN (v_job.customer_id, v_job.helper_id) AND p.is_seed IS TRUE);
  IF NOT v_test THEN
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    -- The stuck-job title (admin_alert_close_rule prefix 'job stalled — nobody marked it done' -> 'stalled-job', the
    -- queue row written above), so the Slack mirror's item closes itself once the row is reviewed.
    SELECT r.user_id, v_job.id, 'Job stalled — nobody marked it done (continue day missed)',
           format('"%s": %s. Decide the payment in Jobs (release or refund). Nothing moved.',
                  COALESCE(v_job.title, 'a job'),
                  CASE WHEN v_side = 'poster' THEN 'the poster says the Helpr didn''t come back' ELSE 'the Helpr says they can''t come back' END),
           'admin_alert', '/admin?view=stalled&job=' || v_job.id::text
      FROM public.user_roles r
     WHERE r.role = 'admin';
  END IF;

  RETURN jsonb_build_object('report_id', v_report, 'side', v_side, 'continue_id', v_row.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.report_continue_day_missed(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_continue_day_missed(uuid, text, text[]) TO authenticated, service_role;

-- ── 4. No new continue day while a report is open (end users; server writers pass) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.refuse_continue_day_while_missed_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('proposed', 'set') AND EXISTS (
       SELECT 1 FROM public.job_missed_returns m WHERE m.job_id = NEW.job_id AND m.resolved_at IS NULL) THEN
    RAISE EXCEPTION 'continue_day_missed_open' USING ERRCODE = '23514',
      HINT = 'Louisiana Helpr is reviewing this job after a missed continue day.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_continue_day_while_missed_open() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_refuse_continue_day_while_missed_open ON public.job_continue_days;
CREATE TRIGGER trg_refuse_continue_day_while_missed_open
  BEFORE INSERT ON public.job_continue_days
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_continue_day_while_missed_open();

-- ── 5. The report closes itself when the admin acts ───────────────────────────────────────────────────────────────
-- "Mark Reviewed" on the stuck-job row (resolve_stalled_job_flag writes resolved_at / resolved_by).
CREATE OR REPLACE FUNCTION public.resolve_missed_return_on_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL THEN
    UPDATE public.job_missed_returns
       SET resolved_at = NEW.resolved_at, resolved_by = NEW.resolved_by, resolution = 'reviewed'
     WHERE job_id = NEW.job_id AND resolved_at IS NULL;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.resolve_missed_return_on_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_resolve_missed_return_on_review ON public.job_completion_nudges;
CREATE TRIGGER trg_resolve_missed_return_on_review
  AFTER UPDATE OF resolved_at ON public.job_completion_nudges
  FOR EACH ROW
  EXECUTE FUNCTION public.resolve_missed_return_on_review();

-- The job leaving in_progress: an admin release, refund or status change, or the poster's own approval.
CREATE OR REPLACE FUNCTION public.resolve_missed_return_on_job_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status::text IS DISTINCT FROM OLD.status::text AND NEW.status::text <> 'in_progress' THEN
    UPDATE public.job_missed_returns
       SET resolved_at = now(), resolved_by = auth.uid(), resolution = 'job_' || NEW.status::text
     WHERE job_id = NEW.id AND resolved_at IS NULL;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.resolve_missed_return_on_job_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_resolve_missed_return_on_job_change ON public.jobs;
CREATE TRIGGER trg_resolve_missed_return_on_job_change
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.resolve_missed_return_on_job_change();

-- ── 6. admin_stalled_job_queue: a lapsed day dates the row (restated from 20261103214229) ─────────────────────────
CREATE OR REPLACE FUNCTION public.admin_stalled_job_queue(p_include_resolved boolean DEFAULT false)
 RETURNS TABLE(job_id uuid, title text, customer_id uuid, helper_id uuid, budget numeric, date_needed date, start_time time without time zone, estimated_hours numeric, status text, payment_status text, first_sent_at timestamp with time zone, second_sent_at timestamp with time zone, escalated_at timestamp with time zone, resolved_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    n.job_id,
    j.title,
    j.customer_id,
    j.helper_id,
    j.budget,
    -- Owner bug 11-03: a job in progress with an open SET continue day is dated by that day.
    coalesce(c.new_date, j.date_needed),
    CASE WHEN c.new_date IS NOT NULL THEN c.new_start_time ELSE j.start_time END,
    j.estimated_hours,
    j.status::text,
    j.payment_status::text,
    n.first_sent_at,
    n.second_sent_at,
    n.escalated_at,
    n.resolved_at
  FROM public.job_completion_nudges n
  JOIN public.jobs j ON j.id = n.job_id
  LEFT JOIN LATERAL (
    SELECT d.new_date, d.new_start_time, d.status
      FROM public.job_continue_days d
     -- CHANGED 20261108214605 (owner #4): a day closed as 'lapsed' by a missed-return report also dates the row.
     WHERE d.job_id = j.id AND j.status = 'in_progress'
       AND ((d.status = 'set' AND d.closed_at IS NULL) OR d.status = 'lapsed')
     ORDER BY d.created_at DESC
     LIMIT 1
  ) c ON true
  WHERE n.escalated_at IS NOT NULL
    -- Server-side authorization: non-admins get no rows, not an error.
    AND public.has_role(auth.uid(), 'admin')
    AND (coalesce(p_include_resolved, false) OR n.resolved_at IS NULL)
    -- Owner bug 11-03 (lead): a job whose open SET day is today or still ahead (Central) is not stalled. It is left
    -- out of the queue and its rail badge; it comes back once that day passes without the job finishing.
    -- CHANGED 20261108214605: a LAPSED day (reported missed) is never "still ahead": its report is the queue item.
    AND NOT (c.status = 'set' AND c.new_date IS NOT NULL AND c.new_date >= (now() AT TIME ZONE 'America/Chicago')::date)
  ORDER BY n.escalated_at ASC, n.job_id ASC;
$function$;
REVOKE ALL ON FUNCTION public.admin_stalled_job_queue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stalled_job_queue(boolean) TO authenticated, service_role;
