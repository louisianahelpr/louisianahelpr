-- JOBS-19: an unanswered date or time request vanished at the job's start with no word, and the job stayed at its old
-- time. Readers hide a 'pending' row past expires_at, and only request_job_schedule_change ever marked it, so nobody
-- was told. auto-expire-jobs now calls this sweep: each such row becomes 'expired' and whoever asked gets one notice.
--
-- The status update is the claim, so a re-run or two runs at once cannot notify twice. Moves no money and does not
-- change the job. Cron only: service_role. Replay-safe (CREATE OR REPLACE).
-- Proof: src/test/pglite/scheduleChangeExpiryNotice.pglite.mjs

CREATE OR REPLACE FUNCTION public.expire_unanswered_schedule_changes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r record;
  v_title text;
  v_customer uuid;
BEGIN
  FOR r IN
    UPDATE public.job_schedule_change_requests q
       SET status = 'expired', decided_at = now()
     WHERE q.status = 'pending'
       AND q.expires_at <= now()
     RETURNING q.job_id, q.requested_by
  LOOP
    v_count := v_count + 1;
    CONTINUE WHEN r.requested_by IS NULL;
    SELECT j.title, j.customer_id INTO v_title, v_customer FROM public.jobs j WHERE j.id = r.job_id FOR SHARE;
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      r.requested_by,
      'Your new time wasn''t answered',
      format('Nobody answered your request to move "%s" before it started, so the job stays at its original time.',
             COALESCE(v_title, 'your job')),
      'warning',
      CASE WHEN v_customer = r.requested_by THEN '/posts?job=' ELSE '/jobs?job=' END || r.job_id::text,
      r.job_id
    );
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_unanswered_schedule_changes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_schedule_changes() TO service_role;
