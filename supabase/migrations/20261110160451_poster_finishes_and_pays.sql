-- THE POSTER CAN FINISH THE JOB AND RELEASE THE MONEY (owner 11-10, screenshot of her job "Mow and Weed Eat" 7b1da54b).
--
-- What was wrong, measured on prod 11-10 (read-only): 7b1da54b is in_progress with $100 held (payment_status escrow),
-- helper_completed_at NULL (day 1's done was cleared when the first continue day was set, 11-01), and its continue day
-- de37688f ('set', Fri 11/06 3:15 PM, Helpr-confirmed) passed with nothing recorded. The poster's only controls were
-- "Change day" and "Message". The release (create-payment 'release') pays only once BOTH sides have marked the job
-- done, and the poster's Approve is offered only after the Helpr marks it done, so the poster had no way to pay.
--
-- What this does: public.poster_finish_job_refusal(job, user) is the ONE rule for when the poster may mark the job
-- done themselves and release the money without the Helpr's done. create-payment 'release' with posterFinishes asks
-- it first (service role, the signed-in user's id from the token, never from the body) and then runs the SAME write as
-- the poster's Approve: the same payout math, the same payout day, the same held-escrow and Stripe checks. The
-- poster's poster_completed_at stamp ends the open continue day as 'finished' (close_continue_day_on_job_change,
-- 20261101231015). The job is paid in full; this is never the "Didn't come back" path (owner 11-08: that one goes to
-- the admin queue and an admin decides the split).
--
-- Returns NULL when allowed, else a short reason code (the edge maps each to plain words):
--   job_not_found, not_the_poster, account_restricted, not_in_progress, not_a_solo_job, helpr_marked_done
--   (their done is on: the normal Approve is the way), already_approved, money_not_held, dispute_open,
--   not_started (no day and no arrival), day_not_reached (the job's start, or its open continue day's start, is ahead).
--
-- Only poster-independent facts gate it, and none of them lowers what the Helpr is paid: the poster can only choose to
-- pay in full, sooner. Replay-safe: CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/posterFinishesAndPays.pglite.mjs (applied 3x). Guard: src/test/edge/posterFinishesAndPays.test.ts.

CREATE OR REPLACE FUNCTION public.poster_finish_job_refusal(p_job_id uuid, p_user_id uuid, p_now timestamptz DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_job record;
  v_day record;
  v_starts timestamptz;
BEGIN
  IF p_job_id IS NULL OR p_user_id IS NULL THEN
    RETURN 'not_the_poster';
  END IF;
  SELECT j.id, j.customer_id, j.helper_id, j.status::text AS status, j.is_group_job, j.helper_completed_at,
         j.poster_completed_at, j.payment_status::text AS payment_status, j.has_active_dispute, j.date_needed,
         j.start_time, j.helper_arrived_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF v_job.id IS NULL THEN
    RETURN 'job_not_found';
  END IF;
  IF v_job.customer_id IS DISTINCT FROM p_user_id THEN
    RETURN 'not_the_poster';
  END IF;
  -- is_caller_banned()'s own test, for this user (the caller here is the service role, so auth.uid() is not theirs).
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = p_user_id
       AND ((p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
             AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > v_now))
            OR p.under_13_blocked_at IS NOT NULL)
  ) THEN
    RETURN 'account_restricted';
  END IF;
  IF v_job.status <> 'in_progress' THEN
    RETURN 'not_in_progress';
  END IF;
  IF COALESCE(v_job.is_group_job, false) OR v_job.helper_id IS NULL THEN
    RETURN 'not_a_solo_job';
  END IF;
  IF v_job.helper_completed_at IS NOT NULL THEN
    RETURN 'helpr_marked_done';
  END IF;
  IF v_job.poster_completed_at IS NOT NULL THEN
    RETURN 'already_approved';
  END IF;
  IF v_job.payment_status IS DISTINCT FROM 'escrow' THEN
    RETURN 'money_not_held';
  END IF;
  IF COALESCE(v_job.has_active_dispute, false) THEN
    RETURN 'dispute_open';
  END IF;
  -- The day the work was due: the newest open continue day's start, else the job's own start, else the arrival.
  SELECT c.new_date, c.new_start_time INTO v_day
    FROM public.job_continue_days c
   WHERE c.job_id = p_job_id AND c.status IN ('proposed', 'set')
   ORDER BY c.created_at DESC
   LIMIT 1;
  IF v_day.new_date IS NOT NULL THEN
    v_starts := (v_day.new_date + COALESCE(v_day.new_start_time, time '00:00')) AT TIME ZONE 'America/Chicago';
  ELSIF v_job.date_needed IS NOT NULL THEN
    v_starts := (v_job.date_needed + COALESCE(v_job.start_time, time '00:00')) AT TIME ZONE 'America/Chicago';
  ELSIF v_job.helper_arrived_at IS NOT NULL THEN
    v_starts := v_job.helper_arrived_at;
  ELSE
    RETURN 'not_started';
  END IF;
  IF v_now < v_starts THEN
    RETURN 'day_not_reached';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.poster_finish_job_refusal(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.poster_finish_job_refusal(uuid, uuid, timestamptz) TO service_role;
