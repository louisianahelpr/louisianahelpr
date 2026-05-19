-- Proactive job alerts — upgrade notify_saved_searches_on_new_job.
--
-- A saved search is meant to be a live alert: post a matching job and the
-- helper who saved that search gets pinged, so the feed stops being
-- something they must manually re-check. The trigger + matching SQL for
-- this already shipped (20260426132214, last redefined 20260509194716).
-- This migration fixes two real gaps in that function:
--
--   1. Per-user dedupe. The previous loop iterated over EVERY matching
--      saved_searches row. A helper with three searches that all match
--      one job got THREE notifications (and three push fan-outs) for the
--      same job. Now we dedupe to the user: one notification per job per
--      helper, no matter how many of their searches matched.
--
--   2. Digest-mode routing. notification_preferences.match_digest_mode
--      (added 20260513000100) lets a user batch non-urgent job matches
--      into the once-daily digest. instant-job-match already honors it;
--      the saved-search trigger did not — digest-mode users still got an
--      instant notification per match. Now, when match_digest_mode = true
--      AND the job is not urgent, the match is written into
--      match_digest_queue (drained by the daily-match-digest function)
--      instead of firing an immediate notification. Urgent jobs always
--      fire immediately regardless of the preference.
--
-- The per-search last_notified_at throttle (1 hour) is preserved, and
-- still updated for every search that matched so the throttle window is
-- per-search even though the notification is per-user.
--
-- Idempotent: CREATE OR REPLACE on the function only. The trigger binding
-- (trg_notify_saved_searches AFTER INSERT ON public.jobs) is unchanged.
--
-- DEPLOYMENT NOTE: like accept_application, this migration does NOT
-- auto-apply to production — it must be run against the live database
-- after merge. Until applied, the previous behavior stands (instant
-- per-search notifications, no digest routing) and the app keeps working.

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
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  v_is_urgent := COALESCE(NEW.is_urgent, false);
  v_title := '🎯 New job matches your saved search';
  v_link  := '/dashboard?job=' || NEW.id::text;

  -- One row per matching helper. matched_search_ids collects every saved
  -- search that fired for that helper so we can update their throttle
  -- timestamps, and search_name gives a concrete name for the message
  -- (the most recently created matching search wins the headline).
  --
  -- saved_searches is opt-in (the user explicitly created the search), so
  -- no role gate — just approved + not banned + not the poster.
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
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.location_keyword IS NULL
        OR NEW.location ILIKE '%' || s.location_keyword || '%'
      )
      -- Throttle: skip a search notified within the last hour. Applied
      -- per-search; a helper with one hot search and one cold one still
      -- gets pinged via the cold one.
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
    GROUP BY s.user_id
  LOOP
    -- Stamp every search that contributed to this match so each one's
    -- own 1-hour throttle window resets.
    UPDATE public.saved_searches
       SET last_notified_at = now()
     WHERE id = ANY(match_record.matched_search_ids);

    IF match_record.digest_mode AND NOT v_is_urgent THEN
      -- Digest-mode helper, non-urgent job: park the match in the queue
      -- the daily-match-digest function drains. Idempotent on
      -- (user_id, job_id) — a re-fire for the same job is a no-op.
      INSERT INTO public.match_digest_queue (user_id, job_id)
      VALUES (match_record.user_id, NEW.id)
      ON CONFLICT (user_id, job_id) DO NOTHING;
    ELSE
      -- Immediate path: one notification for the whole job. The
      -- notifications_fan_out_to_push trigger handles native push and
      -- honors the user's push_enabled + per-category preference, so we
      -- do not gate push here.
      v_message :=
        'A new job matches "' || match_record.search_name || '": '
        || NEW.title || ' ($' || NEW.budget || ')'
        || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);

      -- Email fan-out — same vault-secret pattern as the other notify
      -- triggers. send-notification-email checks the user's email prefs.
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', match_record.user_id,
          'title', v_title,
          'message', v_message,
          'type', 'job_match',
          'link', v_link
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Keep the security posture of the other internal trigger functions:
-- the function is only ever invoked by the trigger, never via RPC.
REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;
