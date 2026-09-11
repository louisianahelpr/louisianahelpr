-- Job matches get their own off switch.
--
-- `job_match` is the single largest notification type in prod — 470 of 1,584
-- rows — and it was the ONE category with no control on the preferences
-- screen. It was gated by whatever column each producer happened to pick, and
-- the four producers did not agree:
--
--   * notify_helpers_on_job_post        -> np.new_offers   (direct offers!)
--   * notify_saved_searches_on_new_job  -> nothing at all
--   * sweep_daily_job_digest            -> np.job_updates
--   * notification_type_pref_map (push) -> job_updates
--   * send-notification-email TYPE_MAP  -> email_job_updates
--
-- So the only way to mute matches was to also mute every genuine status change
-- on your own jobs, and even then two of the four producers ignored you. This
-- migration gives the category its own column on BOTH channels and points
-- every producer and both fan-out gates at it.
--
-- DEFAULT true on both columns, and every producer reads through
-- COALESCE(..., true): nobody silently loses matches. The switch only does
-- something once a user actually flips it, which is the entire point.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, INSERT ... ON CONFLICT DO UPDATE, and
-- CREATE OR REPLACE throughout. Verified idempotent under PGlite (3x replay).

-- ---------------------------------------------------------------------------
-- 1. The two columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS job_matches boolean NOT NULL DEFAULT true;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS email_job_matches boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.job_matches IS
  'Push/in-app gate for notifications.type = ''job_match'' (new work matching your parish or a saved search). Default true.';
COMMENT ON COLUMN public.notification_preferences.email_job_matches IS
  'Email twin of job_matches — gates send-notification-email for type = ''job_match''. Default true.';

-- ---------------------------------------------------------------------------
-- 2. Re-point the push gate. `fan_out_push_on_notification` reads this table
--    per row, so this ONE row closes push for all four producers at once.
--    Written as an INSERT (not an UPDATE) because it is the registry seed the
--    repo's own drift test parses out of supabase/migrations.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('job_match', 'job_matches', 'New job matching the helper''s parish or a saved search')
ON CONFLICT (type) DO UPDATE SET
  pref_column = EXCLUDED.pref_column,
  description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- 3. Producer 1 — the parish fan-out trigger.
--    Only change: the pref gate moves off `new_offers` (which belongs to
--    DIRECT offers, a different product concept entirely) onto `job_matches`.
-- ---------------------------------------------------------------------------
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
    WHERE p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND c.user_id <> NEW.customer_id
      -- CHANGED 2026-09-11. This read `np.new_offers`, which is the switch
      -- labelled "Job Offers" on the prefs screen and belongs to DIRECT
      -- offers. A helper muting direct offers silently muted parish matches
      -- too, and a helper wanting to mute matches had no way to. Unset still
      -- means on: most accounts have no preferences row.
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
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link, NEW.id);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', helper_record.helper_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Producer 2 — the saved-search trigger.
--    Only change: it had NO category gate at all. A saved search is opt-in
--    per search, but the category switch is the master over all of them:
--    "turn job-match notifications off" has to mean off.
-- ---------------------------------------------------------------------------
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
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      -- ADDED 2026-09-11. These rows are type 'job_match'; the category switch
      -- is the master over every saved search. Unset means on.
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

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);

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

REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Producer 3 — the daily parish digest cron. It writes type 'job_match'
--    but gated on `job_updates`. Same category, same switch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sweep_daily_job_digest()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rec RECORD;
  total_sent integer := 0;
  budget_lo integer;
  budget_hi integer;
BEGIN
  FOR rec IN
    WITH new_jobs AS (
      SELECT j.id, j.parish, j.budget, j.credential_tier
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
    ) pc
    WHERE p.parish IS NOT NULL
      AND pc.cnt > 0
      AND p.approval_status = 'approved'
      AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
      -- CHANGED 2026-09-11: these rows are type 'job_match', so they answer to
      -- the job-match switch, not the job-updates one.
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
$function$;

REVOKE ALL ON FUNCTION public.sweep_daily_job_digest() FROM PUBLIC, anon, authenticated;
