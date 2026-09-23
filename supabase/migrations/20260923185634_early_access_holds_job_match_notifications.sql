-- Q225 (V-008 second half): job-match notifications honour Early Access.
--
-- THE BUG. Browse hides a brand-new job from a member until
-- created_at <= early_access_cutoff(): 20 minutes for a free account, minus
-- the head start their ACTIVE tier has earned (Elite sees it at once). The
-- three real-time job-match producers ignored that window. On funding they
-- told every matching member "New job ... <title> ($<budget>)" at once, by
-- in-app row, push (fanned out from the notifications row) and email:
--   1. notify_helpers_on_job_post        (trigger: parish fan-out, + email)
--   2. notify_saved_searches_on_new_job  (trigger: saved searches, + email)
--   3. supabase/functions/instant-job-match (edge: "Match for you", no email)
-- So the paid perk leaked to every free account through its own inbox.
--
-- THE FIX: the same window, per recipient, at one choke point.
--   - early_access_delay_minutes(uuid): the delay early_access_cutoff() applies
--     to auth.uid(), for any user. Its CASE is the cutoff's CASE, word for
--     word (src/test/jobMatchEarlyAccess.test.ts holds them equal).
--   - job_match_release_at(job, user) = jobs.created_at + that delay: the
--     instant the job enters that user's browse feed.
--   - deliver_job_match(): producers 1 and 2 hand it each notification (and
--     whether to email). Released -> insert + email now, as before. Not yet
--     -> a job_match_holds row, nothing sent.
--   - trg_notifications_zz_early_access_hold: BEFORE INSERT backstop on
--     notifications for type 'job_match'. Any producer that inserts directly
--     (producer 3 today, and the next one) is held the same way. It sorts after
--     the seed boundary and job_id fill triggers, so a seed-suppressed row is
--     never held and the job_id is already filled from the link.
--   - release_job_match_holds() (cron release-job-match-holds, every minute)
--     delivers each hold once the job is visible to its recipient, re-reading
--     the job (still open, funded, not under someone else's live offer) and the
--     recipient (not banned, matches not muted). A job hired or cancelled
--     inside its window is never announced.
-- Delivery can be up to a minute after the window opens; never before it.
--
-- FAIL OPEN, LOUDLY. The producers run inside the funding UPDATE (Stripe
-- webhook). A failed hold must not fail the payment, so it logs a WARNING and
-- delivers immediately: the old behaviour, never a lost notification.
--
-- Producers 1 and 2 are restated from their NEWEST definitions
-- (20260923172405_retire_approval_status_reads.sql) with only the
-- notifications INSERT + net.http_post pair replaced by deliver_job_match().
--
-- REPLAY-SAFE: CREATE OR REPLACE, IF NOT EXISTS, DROP ... IF EXISTS; the cron
-- and liveness rows are guarded on the cron schema / table existing.

-- ── 1. The window, for any user ──
CREATE OR REPLACE FUNCTION public.early_access_delay_minutes(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Same arithmetic as early_access_cutoff() (20260905221158), for p_user_id
  -- instead of auth.uid(). A user with no profile row waits the full 20.
  SELECT 20 - COALESCE((
    SELECT CASE
             WHEN p.subscription_expires_at IS NOT NULL
                  AND p.subscription_expires_at <= now() THEN 0
             WHEN p.subscription_tier = 'elite' THEN 20
             WHEN p.subscription_tier = 'plus'  THEN 15
             WHEN p.subscription_tier = 'pro'   THEN 10
             WHEN p.subscription_tier = 'basic' THEN 5
             ELSE 0
           END
    FROM public.profiles p
    WHERE p.user_id = p_user_id
  ), 0);
$function$;
REVOKE ALL ON FUNCTION public.early_access_delay_minutes(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.job_match_release_at(p_job_id uuid, p_user_id uuid)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- NULL when the job does not exist (nothing to wait for).
  SELECT j.created_at + make_interval(mins => public.early_access_delay_minutes(p_user_id))
    FROM public.jobs j
   WHERE j.id = p_job_id;
$function$;
REVOKE ALL ON FUNCTION public.job_match_release_at(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. The held notifications (server-only queue) ──
CREATE TABLE IF NOT EXISTS public.job_match_holds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  title       text NOT NULL,
  message     text NOT NULL,
  link        text,
  send_email  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_match_holds_job_id_idx ON public.job_match_holds (job_id);
CREATE INDEX IF NOT EXISTS job_match_holds_user_id_idx ON public.job_match_holds (user_id);

REVOKE ALL ON public.job_match_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_match_holds TO service_role;
ALTER TABLE public.job_match_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_only_job_match_holds" ON public.job_match_holds;
CREATE POLICY "service_role_only_job_match_holds"
  ON public.job_match_holds FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 3. The one delivery path for the SQL producers ──
CREATE OR REPLACE FUNCTION public.deliver_job_match(
  p_user_id uuid, p_job_id uuid, p_title text, p_message text, p_link text, p_send_email boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_release timestamptz;
BEGIN
  BEGIN
    v_release := public.job_match_release_at(p_job_id, p_user_id);
    IF v_release IS NOT NULL AND v_release > now() THEN
      INSERT INTO public.job_match_holds (user_id, job_id, title, message, link, send_email)
      VALUES (p_user_id, p_job_id, p_title, p_message, p_link, COALESCE(p_send_email, false));
      RETURN false;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'deliver_job_match: could not hold job % for user %, delivering now: %', p_job_id, p_user_id, SQLERRM;
  END;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  VALUES (p_user_id, p_title, p_message, 'job_match', p_link, p_job_id);

  IF p_send_email THEN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', p_user_id,
        'title', p_title,
        'message', p_message,
        'type', 'job_match',
        'link', p_link
      )
    );
  END IF;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.deliver_job_match(uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- ── 4. Backstop for every direct INSERT of a job_match row ──
CREATE OR REPLACE FUNCTION public.notifications_early_access_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_job uuid;
  v_release timestamptz;
BEGIN
  IF NEW.type IS DISTINCT FROM 'job_match' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_job := COALESCE(NEW.job_id, public.notification_job_id_from_link(NEW.link));
    IF v_job IS NULL THEN
      RETURN NEW;
    END IF;
    v_release := public.job_match_release_at(v_job, NEW.user_id);
    IF v_release IS NULL OR v_release <= now() THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.job_match_holds (user_id, job_id, title, message, link, send_email)
    VALUES (NEW.user_id, v_job, NEW.title, NEW.message, NEW.link, false);
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notifications_early_access_hold: could not hold a job_match row for %, delivering now: %', NEW.user_id, SQLERRM;
    RETURN NEW;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public.notifications_early_access_hold() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_zz_early_access_hold ON public.notifications;
CREATE TRIGGER trg_notifications_zz_early_access_hold
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_early_access_hold();

-- ── 5. The release sweep ──
CREATE OR REPLACE FUNCTION public.release_job_match_holds()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_sent integer := 0;
BEGIN
  -- DELETE ... RETURNING claims each due hold exactly once, so an overlapping
  -- run cannot deliver it twice. "Due" is recomputed from the recipient's tier
  -- NOW, the same instant browse would show them the job.
  FOR r IN
    DELETE FROM public.job_match_holds h
     USING public.jobs j
     WHERE j.id = h.job_id
       AND j.created_at + make_interval(mins => public.early_access_delay_minutes(h.user_id)) <= now()
    RETURNING h.user_id, h.job_id, h.title, h.message, h.link, h.send_email,
              j.status::text AS job_status, j.payment_status, j.offered_to_helper_id, j.direct_offer_status
  LOOP
    -- The job must still be what browse would show: open, funded, not under
    -- someone else's live direct offer.
    CONTINUE WHEN r.job_status <> 'open'
      OR COALESCE(r.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      OR (r.offered_to_helper_id IS NOT NULL
          AND r.offered_to_helper_id <> r.user_id
          AND COALESCE(r.direct_offer_status, 'pending') NOT IN ('declined', 'expired'));
    -- The recipient still wants it: not banned, matches not switched off since.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.profiles p
                           WHERE p.user_id = r.user_id AND COALESCE(p.ban_status, 'active') <> 'active')
      OR EXISTS (SELECT 1 FROM public.notification_preferences np
                  WHERE np.user_id = r.user_id AND np.job_matches IS FALSE);

    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (r.user_id, r.title, r.message, 'job_match', r.link, r.job_id);

    IF r.send_email THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', r.user_id,
          'title', r.title,
          'message', r.message,
          'type', 'job_match',
          'link', r.link
        )
      );
    END IF;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$function$;
REVOKE ALL ON FUNCTION public.release_job_match_holds() FROM PUBLIC, anon, authenticated;

-- ── 6. Producer 1, restated from 20260923172405 ──
CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- The triggers' WHEN clauses already guarantee funded, so this is a
  -- belt-and-braces re-assertion for any future direct call.
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN
    RETURN NEW;
  END IF;

  -- A job under a LIVE direct offer is addressed mail, not open-pool work.
  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  -- Fixtures, on the same authority the browse surfaces use.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  FOR helper_record IN
    WITH candidates AS (
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.parish = NEW.parish
        AND (
          EXISTS (SELECT 1 FROM public.applications a WHERE a.helper_id = p2.user_id)
          OR EXISTS (SELECT 1 FROM public.jobs j2 WHERE j2.helper_id = p2.user_id)
        )
    )
    SELECT DISTINCT c.user_id AS helper_id
    FROM candidates c
    JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = c.user_id
    WHERE p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND c.user_id <> NEW.customer_id
      AND COALESCE(np.job_matches, true) IS TRUE
      -- Digest mode is an explicit "batch these, don't ping me". This producer
      -- has no queue to route into, so it stands down and sweep_daily_job_digest
      -- covers them.
      AND COALESCE(np.match_digest_mode, false) IS FALSE
      -- CREDENTIAL GATE (20260905201818).
      AND (
        COALESCE(NEW.credential_tier, 0) = 0
        OR COALESCE(public.get_user_credential_tier(c.user_id), 0) >= NEW.credential_tier
      )
  LOOP
    -- CHANGED Q225: in-app + push + email now, or held until the job enters
    -- this helper's browse feed (their Early Access window).
    PERFORM public.deliver_job_match(helper_record.helper_id, NEW.id, v_title, v_message, v_link, true);
  END LOOP;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;

-- ── 7. Producer 2, restated from 20260923172405 ──
CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
BEGIN
  IF NEW.status <> 'open'
     OR COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
  THEN
    RETURN NEW;
  END IF;

  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_is_urgent := COALESCE(NEW.is_urgent, false);
  v_title := 'New job matches your saved search';
  v_link  := '/dashboard?job=' || NEW.id::text;

  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids,
      COALESCE(BOOL_OR(np.match_digest_mode), false)    AS digest_mode
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      AND COALESCE(np.job_matches, true) IS TRUE
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.query IS NULL
        OR btrim(s.query) = ''
        OR strpos(lower(NEW.title), lower(btrim(s.query))) > 0
        OR strpos(lower(COALESCE(NEW.description, '')), lower(btrim(s.query))) > 0
      )
      AND (
        s.location_keyword IS NULL
        OR s.location_keyword ~ '^nearby:'
        OR strpos(lower(COALESCE(NEW.location, '')), lower(s.location_keyword)) > 0
      )
      AND (
        s.radius_miles IS NULL
        OR (
          p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
          AND public.miles_between(p.latitude, p.longitude, NEW.latitude, NEW.longitude) <= s.radius_miles
        )
        OR (
          (p.latitude IS NULL OR p.longitude IS NULL
           OR NEW.latitude IS NULL OR NEW.longitude IS NULL)
          AND p.parish IS NOT NULL
          AND NEW.parish IS NOT NULL
          AND p.parish = NEW.parish
        )
      )
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
    GROUP BY s.user_id
  LOOP
    UPDATE public.saved_searches
       SET last_notified_at = now()
     WHERE id = ANY(match_record.matched_search_ids);

    IF match_record.digest_mode AND NOT v_is_urgent THEN
      INSERT INTO public.match_digest_queue (user_id, job_id)
      VALUES (match_record.user_id, NEW.id)
      ON CONFLICT (user_id, job_id) DO NOTHING;
    ELSE
      v_message :=
        'A new job matches "' || match_record.search_name || '": '
        || NEW.title || ' ($' || NEW.budget || ')'
        || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

      -- CHANGED Q225: now, or held until this member's Early Access window.
      PERFORM public.deliver_job_match(match_record.user_id, NEW.id, v_title, v_message, v_link, true);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;

-- ── 8. Schedule the release, and watch it ──
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note)
    VALUES ('release-job-match-holds', interval '15 minutes',
            'Q225: every minute, delivers job-match notifications held for the recipient Early Access window.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('release-job-match-holds', '* * * * *',
                          'SELECT public.release_job_match_holds();');
  END IF;
END
$do$;
