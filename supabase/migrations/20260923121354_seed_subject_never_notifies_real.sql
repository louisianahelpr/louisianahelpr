-- Q137: a seed subject never notifies a real person.
--
-- WHAT WAS BROKEN. When the Q100 fixture job (is_seed) became escrowed at
-- 2026-09-23 11:35Z, notify_helpers_on_job_post inserted "New job in your
-- parish" for every matching helper in East Baton Rouge and POSTed each one to
-- send-notification-email. Every fan-out producer skipped a seed job only while
-- seed_jobs_hidden_publicly() is true, and that is the owner's LAUNCH switch
-- for browse visibility: FALSE on prod today. Both recipients that morning were
-- seed accounts, but any real helper in the parish would have been pushed and
-- emailed about a fake job, and the fixture re-funds itself on a schedule.
-- Measured on prod before this migration (30 days to 2026-09-23 12:00Z): 105
-- notifications reached a NON-seed account about a seed job (all three
-- non-seed profiles are the owner's own accounts; no other person), a floor,
-- because many producers do not record which job a row is about.
--
-- THE RULE. A seed subject (a job with is_seed, or a seed account as the actor
-- named in the link) never produces a notification, push or email to a
-- NON-seed recipient, whatever the launch switch says. Seed-to-seed stays
-- allowed: the test accounts rely on it. The switch keeps controlling browse
-- visibility only; nothing here reads or changes it.
--
-- WHERE IT IS ENFORCED (choke points, so the next producer cannot forget):
--   1. notifications, BEFORE INSERT (trg_notifications_seed_boundary). Push
--      is fanned out by the AFTER INSERT trigger on the same row
--      (notifications_fan_out_to_push), so a row dropped here is never pushed.
--      Named to sort AFTER trg_notifications_fill_job_id (BEFORE triggers run
--      in name order), so a job recovered from the link is already in job_id.
--   2. match_digest_queue, BEFORE INSERT (trg_match_digest_queue_seed_boundary):
--      the daily-match-digest edge function summarises that queue into one
--      row with a job-less link, which choke point 1 cannot see into.
--   3. send-notification-email calls notification_crosses_seed_boundary()
--      before it sends (edge function, same commit). It is the one email
--      sender every producer uses for notification mail, including the three
--      SQL producers that POST to it directly.
--   4. sweep_daily_job_digest counts jobs per parish into one row whose link
--      is '/dashboard'; it now counts seed jobs only for seed recipients.
-- A suppressed row is recorded in notification_logs (status
-- 'suppressed_seed'), so the rule is observable, not silent.
--
-- FAIL-CLOSED: if the check itself raises, the row is dropped and logged with
-- the error, never delivered. The inserting transaction (e.g. a message send)
-- is never failed by this trigger.
--
-- REPLAY-SAFETY: only CREATE OR REPLACE / DROP TRIGGER IF EXISTS; every table
-- and function referenced exists since 2026-05 (notifications, jobs, profiles,
-- match_digest_queue, notification_logs, notification_job_id_from_link).

CREATE OR REPLACE FUNCTION public.notification_crosses_seed_boundary(
  p_recipient uuid,
  p_job_id uuid,
  p_link text,
  p_actor uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job uuid;
  v_actor_text text;
  v_actor uuid;
BEGIN
  -- Seed-to-seed is allowed. A recipient with no profiles row is NOT seed:
  -- when in doubt the recipient is treated as a real person.
  IF p_recipient IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles rp
    WHERE rp.user_id = p_recipient AND rp.is_seed IS TRUE
  ) THEN
    RETURN false;
  END IF;

  -- The subject job: the row's own job_id, else the one its link names.
  v_job := COALESCE(p_job_id, public.notification_job_id_from_link(p_link));
  IF v_job IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = v_job AND j.is_seed IS TRUE
  ) THEN
    RETURN true;
  END IF;

  -- The actor: one the caller names (create-notification passes the signed-in
  -- sender), else the one the link names: '/messages?...&userId=<sender>',
  -- '/post-job?offerTo=<helper>', '/admin?view=people&user=<member>'.
  -- Anchored on a full canonical uuid so a malformed id is ignored, never cast.
  v_actor_text := (regexp_match(
    COALESCE(p_link, ''),
    '[?&](?:userId|offerTo|user)=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[&#]|$)'
  ))[1];
  v_actor := COALESCE(p_actor, v_actor_text::uuid);
  IF v_actor IS NOT NULL AND v_actor <> p_recipient AND EXISTS (
    SELECT 1 FROM public.profiles ap
    WHERE ap.user_id = v_actor AND ap.is_seed IS TRUE
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notification_crosses_seed_boundary(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_crosses_seed_boundary(uuid, uuid, text, uuid) TO service_role;

-- 1. notifications
CREATE OR REPLACE FUNCTION public.notifications_seed_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cross boolean;
  v_reason text := 'seed subject to a non-seed recipient';
BEGIN
  BEGIN
    v_cross := public.notification_crosses_seed_boundary(NEW.user_id, NEW.job_id, NEW.link);
  EXCEPTION WHEN OTHERS THEN
    v_cross := true;
    v_reason := 'seed boundary check failed, dropped: ' || SQLERRM;
  END;

  IF v_cross THEN
    -- The record is best-effort: a failed log write never fails the insert
    -- that triggered it, and never lets the row through.
    BEGIN
      INSERT INTO public.notification_logs (user_id, category, channel, status, subject, job_id, error_message)
      VALUES (NEW.user_id, COALESCE(NEW.type, 'unknown'), 'in_app', 'suppressed_seed', NEW.title,
              COALESCE(NEW.job_id, public.notification_job_id_from_link(NEW.link)), v_reason);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notifications_seed_boundary: suppressed a row for % but could not log it: %', NEW.user_id, SQLERRM;
    END;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notifications_seed_boundary() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_seed_boundary ON public.notifications;
CREATE TRIGGER trg_notifications_seed_boundary
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_seed_boundary();

-- 2. match_digest_queue
CREATE OR REPLACE FUNCTION public.match_digest_queue_seed_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cross boolean;
  v_reason text := 'seed subject to a non-seed recipient';
BEGIN
  BEGIN
    v_cross := public.notification_crosses_seed_boundary(NEW.user_id, NEW.job_id, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_cross := true;
    v_reason := 'seed boundary check failed, dropped: ' || SQLERRM;
  END;

  IF v_cross THEN
    BEGIN
      INSERT INTO public.notification_logs (user_id, category, channel, status, job_id, error_message)
      VALUES (NEW.user_id, 'job_match', 'digest_queue', 'suppressed_seed', NEW.job_id, v_reason);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'match_digest_queue_seed_boundary: suppressed a row for % but could not log it: %', NEW.user_id, SQLERRM;
    END;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.match_digest_queue_seed_boundary() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_match_digest_queue_seed_boundary ON public.match_digest_queue;
CREATE TRIGGER trg_match_digest_queue_seed_boundary
  BEFORE INSERT ON public.match_digest_queue
  FOR EACH ROW EXECUTE FUNCTION public.match_digest_queue_seed_boundary();

-- 4. sweep_daily_job_digest: identical to 20260911201653 except that a seed
-- job is counted only for a seed recipient (new_jobs.is_seed, and the
-- `AND (NOT nj.is_seed OR ...)` line in the per-recipient count).
CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  rec RECORD;
  total_sent integer := 0;
  budget_lo integer;
  budget_hi integer;
BEGIN
  FOR rec IN
    WITH new_jobs AS (
      SELECT j.id, j.parish, j.budget, j.credential_tier, COALESCE(j.is_seed, false) AS is_seed
      FROM public.jobs j
      WHERE j.status = 'open'
        AND j.created_at > NOW() - INTERVAL '24 hours'
        AND j.parish IS NOT NULL
        AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    )
    SELECT
      p.user_id,
      p.parish,
      pc.cnt,
      pc.min_budget,
      pc.max_budget
    FROM public.profiles p
    LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(public.get_user_credential_tier(p.user_id), 0) AS tier
    ) ut
    CROSS JOIN LATERAL (
      SELECT
        COUNT(*)        AS cnt,
        MIN(nj.budget)  AS min_budget,
        MAX(nj.budget)  AS max_budget
      FROM new_jobs nj
      WHERE nj.parish = p.parish
        AND (COALESCE(nj.credential_tier, 0) = 0 OR ut.tier >= nj.credential_tier)
        -- Q137: a seed job is news only to a seed account.
        AND (NOT nj.is_seed OR COALESCE(p.is_seed, false))
    ) pc
    WHERE p.parish IS NOT NULL
      AND pc.cnt > 0
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
      AND (np.user_id IS NULL OR COALESCE(np.job_matches, true) IS TRUE)
      AND EXISTS (
        SELECT 1 FROM public.applications WHERE helper_id = p.user_id
        UNION ALL
        SELECT 1 FROM public.jobs WHERE customer_id = p.user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n
        WHERE n.user_id = p.user_id
          AND n.title LIKE 'New jobs in%'
          AND n.created_at > NOW() - INTERVAL '23 hours'
      )
  LOOP
    BEGIN
      budget_lo := FLOOR(rec.min_budget)::integer;
      budget_hi := CEIL(rec.max_budget)::integer;
      INSERT INTO public.notifications (user_id, type, title, message, link, read)
      VALUES (
        rec.user_id,
        'job_match',
        format('New jobs in %s', rec.parish),
        format(
          '%s new %s posted in the last 24 hours — %s. Tap to browse.',
          rec.cnt,
          CASE WHEN rec.cnt = 1 THEN 'job' ELSE 'jobs' END,
          CASE
            WHEN budget_lo = budget_hi THEN format('$%s', budget_lo)
            ELSE format('$%s to $%s', budget_lo, budget_hi)
          END
        ),
        '/dashboard',
        false
      );
      total_sent := total_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'sweep_daily_job_digest', rec.user_id::text, SQLERRM,
        jsonb_build_object('user_id', rec.user_id, 'parish', rec.parish));
      RAISE NOTICE 'sweep_daily_job_digest: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN total_sent;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'sweep_daily_job_digest', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'sent_before_failure', total_sent));
  RETURN total_sent;
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_daily_job_digest() FROM PUBLIC, anon, authenticated;
