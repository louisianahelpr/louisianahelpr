-- The two notification paths still advertise jobs the recipient cannot see.
--
-- 20260904203654 put the credential filter on the four DISCOVERY surfaces, per
-- the owner's rule: "if they're not licensed or insured then the job shouldn't
-- show on their page." It did not touch the two paths that PUSH jobs at people,
-- so a helper with no credentials is still emailed and notified about a
-- licensed-and-insured job, taps through, and finds nothing — the filtered
-- browse surface correctly hides it.
--
-- notify_helpers_on_job_post already contains this exact argument, applied to a
-- different case. Its direct-offer guard says: "every browse surface hides it,
-- so alerting on it would link a helper to a job they cannot see." That is the
-- whole rationale; the credential gate is the same rule with a per-HELPER
-- predicate instead of a per-job one, which is why it cannot be an early RETURN
-- and has to sit in the recipient query.
--
-- Both bodies below are the live definitions (pg_get_functiondef) verbatim.
-- Only the marked blocks are new.

-- 1 ─────────────────────────────────────────────────────────────────────────
-- Per-recipient, so it joins the candidate WHERE. The browse view's version
-- also allows `customer_id = auth.uid()`; that clause is unnecessary here
-- because the loop already excludes NEW.customer_id a few lines above.
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
  -- COALESCE, not a bare `= ANY`: payment_status is nullable, and a NULL would
  -- make the whole condition NULL, which an IF treats as false — i.e. it would
  -- fall THROUGH the guard and alert about an unfunded job.
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN
    RETURN NEW;
  END IF;

  -- A job under a LIVE direct offer is addressed mail, not open-pool work:
  -- every browse surface hides it, so alerting on it would link a helper to a
  -- job they cannot see. It reappears (and is not re-alerted — see the UPDATE
  -- trigger's WHEN) once the offer resolves.
  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  -- Fixtures, on the same authority the three browse surfaces use. Never alert
  -- about a job the operator has hidden from the marketplace.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  FOR helper_record IN
    WITH candidates AS (
      -- Rung 1 — the explicit opt-in. Unchanged, and still first: a helper who
      -- has named their parishes has said exactly where they want work.
      SELECT hpp.helper_id AS user_id
      FROM public.helper_preferred_parishes hpp
      WHERE hpp.parish = NEW.parish

      UNION

      -- Rung 2 — the fallback, for every helper who never had a picker to use.
      -- `NOT EXISTS` makes it strictly a fallback, matching the ladder in
      -- get_ranked_open_jobs: once a helper sets ANY preference, this rung
      -- stops applying to them entirely, so choosing Orleans genuinely means
      -- "not my home parish" rather than "Orleans as well".
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.parish = NEW.parish
        AND NOT EXISTS (
          SELECT 1 FROM public.helper_preferred_parishes h2
          WHERE h2.helper_id = p2.user_id
        )
        -- Helper intent, behaviour-based. profiles.parish is derived from the
        -- ZIP for EVERY account, poster and helper alike, so without this the
        -- rung emails the whole parish. Not `has_role(uid,'helper')`: prod
        -- holds zero rows with that role, and gating on it would rebuild the
        -- silent-empty-set bug this migration exists to remove.
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
      -- job_match maps to new_offers (send-notification-email:22 uses its
      -- email twin). Unset means on: only 5 of 36 accounts have a preferences
      -- row, so a strict `= true` would mute nearly everybody.
      AND COALESCE(np.new_offers, true) IS TRUE
      -- Digest mode is an explicit "batch these, don't ping me". This producer
      -- has no queue to route into, so it stands down and sweep_daily_job_digest
      -- covers them.
      AND COALESCE(np.match_digest_mode, false) IS FALSE
      -- ADDED 2026-09-05 — CREDENTIAL GATE. Same rule as the four browse
      -- surfaces (20260904203654). An ungated job (tier 0) still goes to
      -- everyone; a licensed-and-insured job only reaches helpers who clear it.
      -- COALESCE on BOTH sides: credential_tier is NOT NULL today but the
      -- function returns a nullable integer for a user with no credential row,
      -- and a NULL here would drop the helper from the set silently.
      AND (
        COALESCE(NEW.credential_tier, 0) = 0
        OR COALESCE(public.get_user_credential_tier(c.user_id), 0) >= NEW.credential_tier
      )
  LOOP
    -- job_id explicitly: the BEFORE INSERT fill trigger (20260901035600) only
    -- fills when the producer left it NULL, so naming it here wins and the
    -- recovery path is never relied on.
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

-- 2 ─────────────────────────────────────────────────────────────────────────
-- The digest is the harder of the two, because it AGGREGATES before it knows
-- who it is talking to. `parish_counts` grouped every open job in a parish and
-- the recipient simply joined that row, so an uncredentialed helper was told
-- "5 new jobs — $50 to $300" when only 2 were visible to them and the real
-- range was $50 to $120. Both the count and the money were wrong, and tapping
-- through showed a shorter list than the message promised.
--
-- Fixed by making the aggregate correlated: the per-parish figures are now
-- computed per RECIPIENT, over only the jobs that recipient can actually see.
-- The credential tier is resolved once per profile in its own LATERAL rather
-- than inside the aggregate's WHERE, so the function is not re-evaluated for
-- every candidate job.
--
-- NOTE the `pc.cnt > 0` guard. The old `JOIN parish_counts` filtered empty
-- parishes implicitly, since a parish with no jobs produced no row to join.
-- A CROSS JOIN LATERAL always produces a row, so without this an uncredentialed
-- helper in a parish whose only new job is gated would receive
-- "0 new jobs posted in the last 24 hours" — and min/max would be NULL, which
-- FLOOR() would then fail on inside the per-user EXCEPTION block, logging a
-- cron defect for every such user, every night.
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
        -- THE SEED GATE. Added 20260903081713; see the migration header.
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
    -- Resolve the recipient's credential tier ONCE, not per candidate job.
    CROSS JOIN LATERAL (
      SELECT COALESCE(public.get_user_credential_tier(p.user_id), 0) AS tier
    ) ut
    -- ADDED 2026-09-05 — the aggregate is now per-recipient. See header.
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
      AND (np.user_id IS NULL OR COALESCE(np.job_updates, true) IS TRUE)
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
