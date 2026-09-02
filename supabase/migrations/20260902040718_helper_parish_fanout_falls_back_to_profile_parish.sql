-- The parish fan-out has a source table with no writer. Give it a second rung.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `notify_helpers_on_job_post` draws its entire recipient set from
-- `public.helper_preferred_parishes`. That table has **zero rows in prod**,
-- across all 36 accounts, and has had zero rows for the life of the product.
-- Verified 2026-09-02 against fncmgoasalhdgfwzhsqa: `helper_preferred_parishes
-- ?select=*` returns `*/0`.
--
-- The reason is not that helpers declined to fill it in. **Nothing has ever
-- been able to write it.** There is no INSERT, upsert or `.from(
-- "helper_preferred_parishes")` write anywhere in the tree — not in `src/`,
-- not across the 60 edge functions, not in `e2e/`, not in `scripts/`. The one
-- non-generated reference in `src/` is a READ, in the admin marketplace-pulse
-- panel (`src/components/admin/adminHealth/useHealthData.ts:118`). Git history
-- confirms it: the table was created in 20260418081253 and every commit since
-- has either rewritten a CONSUMER or added a workaround for the emptiness.
-- A writer was never built.
--
-- So this is not a broken feature. It is a feature whose input surface does
-- not exist, wired to a fan-out that reads it as a hard requirement.
--
-- ── What that costs, precisely, and what it does not ────────────────────────
--
-- The brief this lane was handed said the empty table also breaks the browse
-- feed, via `get_ranked_open_jobs`. It does not, and it is worth being exact,
-- because the two consumers read the same empty table and only one of them is
-- a gate:
--
--   * `get_ranked_open_jobs` (live definition: 20260901035245:285) builds a
--     `viewer_parishes` CTE and uses it in exactly two places — a returned
--     `parish_match` boolean and a `+500` ranking bonus. `viewer_parishes`
--     never appears in the WHERE clause. With an empty table the feed still
--     returns every open job; it just loses its location signal. AND that CTE
--     already has the fallback rung this migration is about: since
--     20260506020000 it UNIONs `profiles.parish` when the helper has set no
--     preferences. Nothing to fix there.
--
--   * `notify_helpers_on_job_post` (live definition: 20260902015059:179) is a
--     `FOR … IN SELECT DISTINCT hpp.helper_id FROM helper_preferred_parishes
--     hpp …` loop. There is no fallback rung and no WHERE-clause escape: an
--     empty source table means the loop body never executes. Zero
--     notifications, zero emails, every job, always.
--
-- The measurement agrees. Prod holds 519 `job_match` notifications and NOT ONE
-- came from this producer — they are 485 from the `instant-job-match` edge
-- function, 33 from the `daily-job-digest` cron and 1 from `daily-match-
-- digest`. `notifications?title=eq.New job in your parish` → 0 rows.
-- 20260902015059's header measured the same thing independently.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE FIX IS HERE AND NOT IN A SETTINGS SCREEN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Building the missing picker is the complete answer and it is a separate
-- piece of work: `helper_preferred_parishes` already carries the RLS to
-- support it (`FOR ALL TO authenticated USING (auth.uid() = helper_id) WITH
-- CHECK (auth.uid() = helper_id)`) and a max-5 trigger, so a UI could write it
-- today. That UI belongs in the helper's profile/preferences surface, which
-- another lane holds open in this same tree. It is specified in the lane
-- report, not built here.
--
-- What this migration does is make the feature work for the 36 accounts that
-- exist NOW, without one of them having to visit a screen that does not exist
-- yet — and it does it with a rung the codebase has already standardised on in
-- two other places for exactly this reason:
--
--   get_ranked_open_jobs (20260506020000)      preferred → profiles.parish
--   get_helper_market_position (20260901011102) preferred → profiles.parish
--                                               → parishes actually worked
--
-- Both use `UNION` + `NOT EXISTS`, so an explicit preference SUPPRESSES the
-- fallback rather than adding to it. That property is what makes the picker,
-- when it ships, an upgrade rather than a conflict: the moment a helper picks
-- Orleans, they stop being alerted about their home parish, which is the whole
-- point of picking.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE THREE GATES ON THE NEW RUNG, AND WHY EACH IS NOT OPTIONAL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `helper_preferred_parishes` is opt-in by construction — 20260509194716:42
-- dropped the role check on precisely that reasoning ("users who set parish
-- prefs are expressing helper intent by definition"). `profiles.parish` is
-- NOT: it is derived from the ZIP code at profile save (`src/pages/Profile
-- .tsx:266-273, :394`) and is set for posters and helpers alike. Copying rung
-- one's gates onto rung two would therefore email every approved user in a
-- parish on every funded job. So rung two carries three gates that rung one
-- does not need.
--
--   1. HELPER INTENT, behaviour-based. `user_roles` holds **no `helper` rows
--      at all** in prod — 13 `admin`, 34 `customer`, zero `helper` (checked
--      2026-09-02). A `has_role(uid,'helper')` gate would reproduce the exact
--      bug this migration is fixing, silently, which is what
--      20260509195035 already discovered and rewrote eight functions to avoid.
--      The behavioural definition here is "has applied to a job OR has been
--      assigned one" — slightly wider than that migration's "has been
--      assigned", deliberately, because an applicant who has not yet won work
--      is the person a job alert is most FOR.
--
--   2. THE NOTIFICATION PREFERENCE. `send-notification-email:22` maps
--      `job_match` to the `email_new_offers` column, so the email half is
--      already gated inside that function; the in-app INSERT was not gated at
--      all. `COALESCE(np.new_offers, true)` fixes that — unset means on, which
--      matches every sibling (`notification_preferences` exists for only 5 of
--      36 accounts, so a strict `= true` would mute almost everyone).
--
--   3. DIGEST MODE. `match_digest_mode = true` means "batch my matches, do not
--      ping me per job" (20260513000100). The saved-search producer honours it
--      by routing to a queue; this producer has no queue, so it skips those
--      users — who continue to receive the daily parish digest from
--      `sweep_daily_job_digest`, which is the thing they asked for.
--
-- Gates 2 and 3 are applied to BOTH rungs. On rung one that is a behaviour
-- change to a loop that currently runs zero times, so it cannot regress
-- anything, and it closes the same hole for the picker's future users.
--
-- ── Measured blast radius ───────────────────────────────────────────────────
--
-- Before: 0 recipients, any job, any parish.
-- After:  7 accounts become reachable — Lafayette 4, Orleans 1, East Baton
--         Rouge 1, Jefferson 1 (approved + active + `profiles.parish` set +
--         has applied or been assigned). Of 36 accounts, 30 are approved and
--         active, only 11 have a parish at all, and 11 have ever applied.
--         Per funded job the fan-out is therefore at most 4 people, minus the
--         poster. It is a real feature turning on, not a broadcast.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS DELIBERATELY UNCHANGED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Everything 20260902015059 established hours ago: the two funded-transition
-- triggers, the direct-offer guard, the seed-visibility guard, the
-- belt-and-braces payment_status re-assertion, the explicit `job_id`, the
-- notification copy and the email fan-out are reproduced here verbatim. This
-- migration changes the recipient QUERY and nothing else. Its triggers are not
-- touched, so the "fires when the job becomes visible, exactly once" property
-- and its verification block both still stand on that file.

-- ───────────────────────────────────────────────────────────────────────────
-- The producer, with a two-rung recipient ladder.
-- ───────────────────────────────────────────────────────────────────────────
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

-- Re-asserted from 20260505190000 — CREATE OR REPLACE preserves grants, but
-- restating the posture beside the body is how the sibling migrations keep an
-- internal trigger function un-callable from PostgREST.
REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC;

DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- ───────────────────────────────────────────────────────────────────────────
-- Supporting index. Rung 2 filters `profiles.parish = NEW.parish` on every
-- funded transition; the table has no index on that column today
-- (idx_helper_preferred_parishes_parish covers rung 1 only).
-- ───────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_parish
  ON public.profiles (parish)
  WHERE parish IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFY — the point of the change is that the recipient set is no longer
-- structurally empty. Say what it is now, in the deploy log.
--
-- WARNING, never EXCEPTION, matching every sibling guard in this tree.
-- ───────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_pref   bigint;
  v_reach  bigint;
BEGIN
  IF to_regclass('public.helper_preferred_parishes') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.applications') IS NULL THEN
    RAISE NOTICE 'skip verify — one of the source tables is absent';
    RETURN;
  END IF;

  SELECT count(*) INTO v_pref FROM public.helper_preferred_parishes;

  SELECT count(DISTINCT p.user_id) INTO v_reach
  FROM public.profiles p
  LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
  WHERE p.parish IS NOT NULL
    AND p.approval_status = 'approved'
    AND COALESCE(p.ban_status, 'active') = 'active'
    AND COALESCE(np.new_offers, true) IS TRUE
    AND COALESCE(np.match_digest_mode, false) IS FALSE
    AND (
      EXISTS (SELECT 1 FROM public.applications a WHERE a.helper_id = p.user_id)
      OR EXISTS (SELECT 1 FROM public.jobs j2 WHERE j2.helper_id = p.user_id)
    );

  RAISE NOTICE 'parish fan-out: % explicit preference row(s); % account(s) now reachable through the profiles.parish fallback', v_pref, v_reach;

  IF v_reach = 0 AND v_pref = 0 THEN
    RAISE WARNING 'parish fan-out is STILL structurally empty — both rungs resolve to nobody. Check profiles.parish population and approval_status.';
  END IF;
END $verify$;
