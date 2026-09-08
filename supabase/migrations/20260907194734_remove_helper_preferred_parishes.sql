-- Remove `helper_preferred_parishes` — a ranking input with no way to set it.
--
-- Owner decision, 2026-09-07. The table has never been writable: no picker was
-- ever built, there is no client write site (`src/` referenced it in exactly
-- two places — the generated `types.ts` and one admin health count), and no
-- edge function writes it. Verified read-only against prod fncmgoasalhdgfwzhsqa
-- before this file was written, rather than inferred from migration history:
--
--   * `pg_stat_user_tables` — n_tup_ins = 4, n_tup_upd = 0, n_live_tup = 0, and
--     `count(*)` = 0. The four inserts are the AL-001 / SI-006 audit probes of
--     2026-09-02, each of which deleted its own row and verified the delete. No
--     product write has ever reached this table.
--   * `pg_constraint` — no inbound foreign keys, and `helper_id` is a bare uuid
--     with no FK of its own. Dropping the table strands nothing.
--   * `pg_get_functiondef` over `pg_proc` — SIX functions reference it, not the
--     one the removal brief named. All six are handled below.
--
-- Because the table is permanently empty, every `helper_preferred_parishes`
-- branch in those six functions is a branch that has never executed in
-- production. The rungs that read it were written as a LADDER with
-- `profiles.parish` as the fallback (20260506020000), so removing rung 1 leaves
-- every caller on the path it was already taking. `get_helper_parish_badges` is
-- the one exception and says so at its own section.
--
-- REPLAY-SAFETY: every statement here is idempotent, and the two that read
-- live catalog state (the trigger drop, the purge_user_data rewrite) are
-- guarded on `to_regclass` / `to_regprocedure` so a from-scratch rebuild and a
-- second and third consecutive apply are all no-ops after the first.

-- ── 1. The guard trigger on a table nobody can insert into ────────────────
-- `enforce_parish_limit` raises 'You can select up to 5 home parishes' — a
-- refusal no caller can reach, which reads as a live feature to the next
-- person who finds it.
DO $do$
BEGIN
  IF to_regclass('public.helper_preferred_parishes') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS enforce_parish_limit_trigger ON public.helper_preferred_parishes';
  END IF;
END $do$;

DROP FUNCTION IF EXISTS public.enforce_parish_limit();

-- ── 2. get_ranked_open_jobs — the browse feed ─────────────────────────────
-- `viewer_parishes` collapses from the two-rung ladder to the profile rung it
-- has always resolved to. Every other line is byte-identical to the live
-- definition (20260907052949). Behaviour is unchanged: with the preferred set
-- empty, the old UNION already returned exactly the profile parish.
CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_max_miles numeric DEFAULT NULL::numeric)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text, distance_band text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
  ),
  -- Where the viewer is. Argument first (a fresh device fix, and the only
  -- option for a guest), then the stored fix. `profiles.latitude` is
  -- device-only by construction — a ZIP centroid is never written there — so
  -- this is always a real position or nothing.
  --
  -- SEAM: the centroid rung goes here as a third COALESCE arm, once
  -- `louisiana_zip_parishes` has latitude/longitude:
  --   COALESCE(p_lat, pr.latitude, z.latitude)
  -- joined via `profiles.zip_code`. Deliberately absent rather than stubbed —
  -- referencing columns that do not exist yet would not deploy.
  viewer_point AS (
    SELECT
      COALESCE(p_lat, (SELECT pr.latitude  FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lat,
      COALESCE(p_lng, (SELECT pr.longitude FROM public.profiles pr
                        WHERE pr.user_id = (SELECT auth.uid()))) AS lng
  ),
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden,
           COALESCE(public.get_user_credential_tier((SELECT auth.uid())), 0) AS viewer_tier
  ),
  scored AS (
    SELECT
      j.id, j.title, j.description, j.category, j.budget, j.date_needed,
      j.start_time, j.location, j.parish, j.is_urgent, j.urgent_fee,
      j.is_flexible_schedule, j.is_recurring, j.recurrence_interval,
      j.is_group_job, j.helpers_needed, j.estimated_hours, j.photos,
      j.special_requirements, j.created_at, j.expires_at, j.boosted_at,
      j.boost_expires_at, j.pricing_mode,
      (j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes)) AS parish_match,
      -- Measured against the job's 2dp-ROUNDED coordinates — the identical
      -- masked pair `open_jobs_browse` already publishes. This is what makes
      -- boundary-sweeping worthless rather than merely awkward.
      public.miles_between(
        round(j.latitude, 2), round(j.longitude, 2),
        (SELECT lat FROM viewer_point), (SELECT lng FROM viewer_point)
      ) AS distance_miles,
      (
        CASE WHEN j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now() THEN 1000 ELSE 0 END
        + CASE WHEN j.parish IS NOT NULL AND j.parish IN (SELECT parish FROM viewer_parishes) THEN 500 ELSE 0 END
        + CASE WHEN j.is_urgent THEN 100 ELSE 0 END
        + GREATEST(0, 50 - EXTRACT(EPOCH FROM (now() - j.created_at)) / 3600.0)::numeric
        -- Poster placement. BOUNDED — 10% / 5% of the recency span above, so
        -- it is strictly smaller than every other term here and cannot
        -- outrank boost, parish, urgency or a real age gap (20260901031421).
        + CASE
            WHEN pp.subscription_expires_at IS NOT NULL
                 AND pp.subscription_expires_at <= now() THEN 0
            WHEN pp.subscription_tier = 'elite' THEN 5
            WHEN pp.subscription_tier = 'pro'   THEN 2.5
            ELSE 0
          END
      )::numeric AS rank_score
    FROM public.jobs j
    CROSS JOIN cutoff
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE j.status = 'open'
      AND j.customer_id IS NOT NULL
      AND ((SELECT auth.uid()) IS NULL OR j.customer_id <> (SELECT auth.uid()))
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      AND (COALESCE(j.credential_tier, 0) = 0 OR cutoff.viewer_tier >= j.credential_tier)
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      AND (
        j.created_at <= cutoff.ts
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match,
    -- rank_score WITHOUT the distance term. See the header: every other term
    -- is derivable from fields in this same row, so including distance here
    -- would hand back the true distance by subtraction.
    rank_score,
    pricing_mode,
    CASE
      WHEN distance_miles IS NULL   THEN NULL
      WHEN distance_miles < 5       THEN 'Under 5 mi'
      WHEN distance_miles < 15      THEN '5-15 mi'
      WHEN distance_miles < 30      THEN '15-30 mi'
      ELSE '30+ mi'
    END AS distance_band
  FROM scored
  WHERE
    -- Radius filter, three cases, mirroring useDashboardFilters.ts so the two
    -- browse surfaces agree. An unevaluable radius KEEPS the row: a filter
    -- that silently empties the feed, or that hides a poster whose geocode
    -- failed, is worse than one extra card.
    p_max_miles IS NULL
    OR distance_miles IS NULL
    OR distance_miles <= p_max_miles
  -- The distance term is applied HERE and nowhere else. It orders the feed
  -- and never reaches the payload.
  ORDER BY
    (rank_score + CASE
       -- Unmeasurable, NOT far. This arm covers two different situations and
       -- both want the same answer. If the VIEWER has no position, every row
       -- gets this and the ranking is simply unchanged — correct. If the JOB
       -- has no geocode, the failure is the platform's (backfill-job-geocode
       -- has not caught up, or geocoding failed), never the poster's, and
       -- scoring it 0 would tie it with genuinely-distant work and sink it to
       -- the bottom of the feed. That is the same harm the radius filter
       -- refuses to do above, applied more quietly. So unknown distance is
       -- treated as NEUTRAL — the middle band — not as evidence of far.
       -- Not gameable: geocoding is automatic at post time, not a poster
       -- choice, and this still ranks below both nearer bands.
       WHEN distance_miles IS NULL THEN 100
       WHEN distance_miles < 5     THEN 400
       WHEN distance_miles < 15    THEN 250
       WHEN distance_miles < 30    THEN 100
       ELSE 0
     END) DESC,
    created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

REVOKE ALL ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean, numeric, numeric, numeric) TO anon, authenticated, service_role;

-- ── 3. notify_helpers_on_job_post — the job-match fan-out ─────────────────
-- Rung 1 (the preferred-parish opt-in) goes, and with it rung 2's `NOT EXISTS`
-- exclusion — which existed only to make rung 2 strictly a fallback. One rung
-- left means the CTE has nothing to UNION, so it becomes a plain candidate
-- SELECT. Every guard, preference check and credential gate below it is
-- byte-identical to the live definition (20260905201818).
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
      -- The parish the helper lives in, derived from their ZIP. This used to
      -- be rung 2 of a ladder whose rung 1 read `helper_preferred_parishes`;
      -- that table was removed on 2026-09-07 having never held a
      -- product-written row, so this rung is the only one that has ever fired.
      -- Rung 2's `NOT EXISTS` exclusion went with it: it existed solely to
      -- make this rung strictly a fallback to rung 1.
      SELECT p2.user_id
      FROM public.profiles p2
      WHERE p2.parish = NEW.parish
        -- Helper intent, behaviour-based. profiles.parish is derived from the
        -- ZIP for EVERY account, poster and helper alike, so without this the
        -- rung emails the whole parish. Not `has_role(uid,'helper')`: prod
        -- holds zero rows with that role, and gating on it would rebuild the
        -- silent-empty-set bug 20260902040718 exists to remove.
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

REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_helpers_on_job_post() TO service_role;

-- ── 4. get_helper_analytics — market scope ────────────────────────────────
-- The preferred-parish arm of the `v_parishes` UNION goes. That arm's own
-- comment already recorded that the table held ZERO rows, and that the third
-- rung (the parishes the caller has WORKED in) exists precisely because of
-- that — so the arm has never contributed a parish to anybody's scope. Only
-- those four lines and their comment change; everything else is byte-identical
-- to the live definition (20260901011102).
CREATE OR REPLACE FUNCTION public.get_helper_analytics(p_days integer DEFAULT 365)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- The subject is always the caller. No id parameter exists, so there is
  -- nothing to forge.
  v_uid          uuid := auth.uid();
  v_tier         text;
  v_entitled     boolean;
  -- Clamped: 30 days is the shortest window any panel can say something true
  -- about, 730 keeps the scan bounded.
  v_days         integer := LEAST(GREATEST(COALESCE(p_days, 365), 30), 730);
  v_since        timestamptz;
  -- The market window is fixed at 180 days and deliberately NOT the caller's
  -- window: "when do jobs get posted" is a property of the marketplace, not of
  -- the slider the helper happens to have dragged.
  v_market_days  constant integer := 180;
  v_market_since timestamptz;   -- := now() - v_market_days, set in the body
  v_parishes     text[];
  v_scope        text;

  -- Sample floors. Returned in the payload so the client applies the SAME
  -- numbers to the rows it aggregates itself.
  c_min_category_jobs        constant integer := 3;
  c_min_decided_apps         constant integer := 5;
  c_min_apps                 constant integer := 3;
  c_min_head_to_head         constant integer := 3;
  c_min_market_jobs          constant integer := 20;
  c_min_market_category_jobs constant integer := 5;

  v_jobs         jsonb;
  v_apps         jsonb;
  v_h2h          jsonb;
  v_demand       jsonb;
  v_rates        jsonb;
  v_market_n     integer;
  v_floors       jsonb;
BEGIN
  -- Derived from the constant the payload ADVERTISES, not from a second copy of
  -- the number. The two were separate literals for one draft, which is all it
  -- takes for the page to name a window it did not scan.
  v_market_since := now() - make_interval(days => v_market_days);

  v_floors := jsonb_build_object(
    'category_jobs',        c_min_category_jobs,
    'decided_applications', c_min_decided_apps,
    'applications',         c_min_apps,
    'head_to_head',         c_min_head_to_head,
    'market_jobs',          c_min_market_jobs,
    'market_category_jobs', c_min_market_category_jobs
  );

  IF v_uid IS NULL THEN
    -- Signed out / torn session. Deliberately the ONLY branch that omits
    -- `preview`, and the client keys off exactly that: an absent `preview`
    -- means "we could not identify you", while `preview.jobs = []` means "we
    -- looked and you have no completed jobs". Returning an empty preview here
    -- instead would have the page tell a ten-year helper they had never
    -- finished a job. Not an error, either — the route sits behind
    -- ProtectedRoute, so this is a stale-session render, not a crash.
    RETURN jsonb_build_object(
      'generated_at', now(),
      'window_days',  v_days,
      'tier',         NULL,
      'entitled',     false,
      'floors',       v_floors
    );
  END IF;

  SELECT p.subscription_tier INTO v_tier
  FROM public.profiles p WHERE p.user_id = v_uid LIMIT 1;

  v_entitled := public.helper_has_advanced_analytics(v_uid);
  v_since := now() - make_interval(days => v_days);

  -- ── The caller's completed helper jobs ───────────────────────────────────
  -- `status = 'completed'` matches what EarningsTab aggregates
  -- (Profile.tsx: `earningsJobs.filter(j => j.status === "completed")`), so
  -- the two screens count the same jobs.
  --
  -- THE GROUP-JOB ROSTER IS PART OF THAT, and it is the one place where these
  -- two surfaces used to disagree. Only ONE member is written to
  -- `jobs.helper_id`, while `release-payout` pays every row of
  -- `group_job_helpers`, so a `helper_id`-only query silently drops a paid
  -- group job from every non-lead member's earnings. `useProfileEarnings`
  -- (src/hooks/useProfileTabData.ts) was changed in the same commit to fold the
  -- roster in the same way. Both surfaces are now right, and they agree —
  -- rather than agreeing on the same omission. Zero rows in
  -- `group_job_helpers` on prod today, so the change is a no-op there and a
  -- correctness fix the first time a group job completes.
  --
  -- `completed_at` is COALESCE(helper_completed_at, created_at) — the exact
  -- fallback EarningsBreakdownCharts.tsx already uses to place a job on a
  -- month axis. `poster_completed_at` would arguably be a better second
  -- choice, but agreeing with the chart that already ships beats being
  -- marginally more correct and disagreeing with it.
  WITH mine AS (
    SELECT
      j.id,
      j.category::text                                   AS category,
      COALESCE(j.parish, z.parish)                       AS parish,
      COALESCE(j.helper_completed_at, j.created_at)      AS completed_at,
      j.budget,
      j.helper_fee_percent,
      j.platform_fee_amount,
      j.payment_status,
      j.is_group_job,
      j.helpers_needed,
      j.urgent_fee
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.status = 'completed'
      AND (
        j.helper_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.group_job_helpers g
          WHERE g.job_id = j.id AND g.helper_id = v_uid
        )
      )
      AND COALESCE(j.helper_completed_at, j.created_at) >= v_since
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.completed_at DESC), '[]'::jsonb)
  INTO v_jobs
  FROM mine m;

  -- ── NOT ENTITLED ─────────────────────────────────────────────────────────
  -- Return early with a PREVIEW, not a broken dashboard.
  --
  -- The preview carries only the money fields of the caller's own completed
  -- jobs — the identical rows the Earnings tab already hands them for free —
  -- so the upgrade screen can say "you paid $X in platform fees last year; at
  -- the Pro rate those same jobs cost $Y" with a real number instead of a
  -- brochure. Category, parish, dates, the application funnel and every market
  -- aggregate stay behind the gate.
  IF NOT v_entitled THEN
    RETURN jsonb_build_object(
      'generated_at', now(),
      'window_days',  v_days,
      'tier',         v_tier,
      'entitled',     false,
      'floors',       v_floors,
      'preview',      jsonb_build_object(
        'jobs', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'budget',              e->'budget',
            'helper_fee_percent',  e->'helper_fee_percent',
            'platform_fee_amount', e->'platform_fee_amount',
            'payment_status',      e->'payment_status',
            'is_group_job',        e->'is_group_job',
            'helpers_needed',      e->'helpers_needed',
            'urgent_fee',          e->'urgent_fee'
          )), '[]'::jsonb)
          FROM jsonb_array_elements(v_jobs) AS e
        )
      )
    );
  END IF;

  -- ── The caller's applications ────────────────────────────────────────────
  -- `minutes_to_apply` is the helper's own clock: how long after the job was
  -- posted they got their application in.
  WITH my_apps AS (
    SELECT
      a.id,
      a.created_at AS applied_at,
      j.id         AS job_id,
      j.status     AS job_status,
      j.helper_id  AS job_helper_id,
      j.category::text AS category,
      COALESCE(j.parish, z.parish) AS parish,
      a.status::text AS app_status,
      ROUND(EXTRACT(EPOCH FROM (a.created_at - j.created_at)) / 60.0)::integer AS minutes_to_apply
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE a.helper_id = v_uid
      AND a.created_at >= v_since
  ),
  classified AS (
    SELECT
      m.*,
      CASE
        WHEN m.app_status = 'accepted' THEN 'won'
        WHEN m.app_status = 'rejected' THEN 'lost'
        -- Still pending, but the job moved on without them. `pending_approval`
        -- and `open` are undecided; `cancelled` is nobody's loss.
        WHEN m.job_status IN ('accepted', 'in_progress', 'completed', 'revision_requested', 'disputed')
             AND m.job_helper_id IS DISTINCT FROM v_uid
             AND NOT EXISTS (
               SELECT 1 FROM public.group_job_helpers g
               WHERE g.job_id = m.job_id AND g.helper_id = v_uid
             )
          THEN 'lost'
        ELSE 'undecided'
      END AS outcome
    FROM my_apps m
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',               c.id,
    'applied_at',       c.applied_at,
    'minutes_to_apply', c.minutes_to_apply,
    'outcome',          c.outcome,
    'category',         c.category,
    'parish',           c.parish
  ) ORDER BY c.applied_at DESC), '[]'::jsonb)
  INTO v_apps
  FROM classified c;

  -- ── Speed vs. the applicant who actually won ─────────────────────────────
  -- Only jobs the caller applied to where SOMEBODY ELSE was accepted. Jobs the
  -- caller won are excluded on purpose: including them would put the caller on
  -- both sides of the comparison and flatter the result.
  WITH contested AS (
    SELECT
      j.id AS job_id,
      MIN(EXTRACT(EPOCH FROM (mine.created_at - j.created_at)) / 60.0) AS mine_min,
      MIN(EXTRACT(EPOCH FROM (won.created_at  - j.created_at)) / 60.0) AS won_min
    FROM public.applications mine
    JOIN public.jobs j ON j.id = mine.job_id
    JOIN public.applications won
      ON won.job_id = j.id AND won.status = 'accepted' AND won.helper_id <> v_uid
    WHERE mine.helper_id = v_uid
      AND mine.status <> 'accepted'
      AND mine.created_at >= v_since
    GROUP BY j.id
  )
  SELECT jsonb_build_object(
    'sample', COUNT(*)::integer,
    -- How many of those jobs the caller actually applied to FIRST. The medians
    -- alone cannot answer that — a lower median is compatible with being last
    -- on half the set — and the first draft of the UI turned "my median is
    -- lower" into "you got in first on those", which is a different claim.
    'you_were_first', COUNT(*) FILTER (WHERE mine_min < won_min)::integer,
    'your_median_minutes',
      CASE WHEN COUNT(*) >= c_min_head_to_head
        THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY mine_min)::numeric) END,
    'winner_median_minutes',
      CASE WHEN COUNT(*) >= c_min_head_to_head
        THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY won_min)::numeric) END
  )
  INTO v_h2h
  FROM contested;

  -- ── Market scope ─────────────────────────────────────────────────────────
  -- Two rungs: the parish the caller lives in (derived from their ZIP), and
  -- the parishes they have actually worked in. A third rung read
  -- `helper_preferred_parishes` until 2026-09-07; that table was removed
  -- because nothing could ever write it, and the comment that stood here
  -- already recorded that it held ZERO rows in prod — so the rung never
  -- contributed a parish to anybody's scope.
  -- ORDERED. scopeLabel() renders parishes[0] as the headline parish, and an
  -- unordered array_agg let "Jobs posted in Lafayette + 3 more" become
  -- "...in Orleans + 3 more" between two loads of the same page.
  SELECT COALESCE(array_agg(DISTINCT parish ORDER BY parish) FILTER (WHERE parish IS NOT NULL), '{}')
  INTO v_parishes
  FROM (
    SELECT p.parish
    FROM public.profiles p
    WHERE p.user_id = v_uid AND p.parish IS NOT NULL
    UNION
    SELECT COALESCE(j.parish, z.parish)
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.helper_id = v_uid
  ) s;

  v_scope := CASE WHEN COALESCE(array_length(v_parishes, 1), 0) > 0
                  THEN 'parish' ELSE 'statewide' END;

  -- ── The market population ────────────────────────────────────────────────
  -- Everyone else's real, human-posted demand.
  --   is_seed          — 59 of 64 prod rows; a clock drawn from those is a
  --                      picture of the seed script, not of the market.
  --   is_auto_created  — recurring clones are stamped by the cron that made
  --                      them, not by a person deciding to post at 7pm.
  --   customer_id      — the caller's own postings are not demand FOR them.
  WITH market AS (
    SELECT
      j.id,
      j.category::text AS category,
      j.budget,
      COALESCE(j.parish, z.parish) AS parish,
      (j.created_at AT TIME ZONE 'America/Chicago') AS posted_local
    FROM public.jobs j
    LEFT JOIN public.louisiana_zip_parishes z ON z.zip_code = LEFT(REGEXP_REPLACE(COALESCE(j.zip_code, ''), '[^0-9]', '', 'g'), 5)
    WHERE j.created_at >= v_market_since
      AND j.is_seed IS NOT TRUE
      AND j.is_auto_created IS NOT TRUE
      AND j.customer_id <> v_uid
  ),
  scoped AS (
    SELECT * FROM market
    WHERE v_scope = 'statewide' OR parish = ANY(v_parishes)
  )
  SELECT
    COUNT(*)::integer,
    -- The clock. Day-of-week 0=Sunday, six 4-hour blocks. Emitted only above
    -- the floor: a heatmap off nine jobs is a Rorschach test.
    CASE WHEN COUNT(*) >= c_min_market_jobs THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('dow', d.dow, 'block', d.block, 'jobs', d.n)
                                ORDER BY d.dow, d.block), '[]'::jsonb)
      FROM (
        SELECT EXTRACT(DOW FROM posted_local)::integer AS dow,
               (EXTRACT(HOUR FROM posted_local)::integer / 4) AS block,
               COUNT(*)::integer AS n
        FROM scoped
        GROUP BY 1, 2
      ) d
    ) END,
    -- Median posted budget per category, each with its own floor.
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'category', r.category, 'jobs', r.n, 'median_budget', r.median_budget)
               ORDER BY r.n DESC, r.category), '[]'::jsonb)
      FROM (
        SELECT category,
               COUNT(*)::integer AS n,
               CASE WHEN COUNT(*) >= c_min_market_category_jobs
                 THEN ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY budget)::numeric, 2) END
                 AS median_budget
        FROM scoped
        WHERE budget IS NOT NULL
        GROUP BY category
      ) r
    )
  INTO v_market_n, v_demand, v_rates
  FROM scoped;

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'window_days',   v_days,
    'tier',          v_tier,
    'entitled',      true,
    'floors',        v_floors,
    'jobs',          v_jobs,
    'applications',  v_apps,
    'head_to_head',  v_h2h,
    'market',        jsonb_build_object(
      'scope',       v_scope,
      'parishes',    to_jsonb(v_parishes),
      'window_days', v_market_days,
      'sample',      COALESCE(v_market_n, 0),
      'demand',      v_demand,          -- NULL below the floor, never a grid of zeros
      'rates',       COALESCE(v_rates, '[]'::jsonb)
    )
  );
END $function$;

REVOKE ALL ON FUNCTION public.get_helper_analytics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_analytics(integer) TO authenticated, service_role;

-- ── 5. get_helper_parish_badges — NOT a no-op, and deliberately so ────────
-- `is_verified_local` was `(the helper listed their own home parish as a
-- PREFERRED parish) AND (>= 3 completed jobs there)`. The left conjunct could
-- never be true, so the badge has been hard-false for every helper since the
-- day it was written. Removing the dead conjunct leaves the half that was
-- always the real test: three or more completed jobs in your own parish.
--
-- This CHANGES behaviour rather than preserving it, which is the right call on
-- two grounds. The function has zero callers today — no reference in `src/` or
-- `supabase/functions/`, and EXECUTE granted only to service_role — so nothing
-- renders differently tomorrow. And preserving the old behaviour would mean
-- replacing the dead conjunct with a literal `false`, i.e. deliberately
-- keeping a badge defined never to appear.
CREATE OR REPLACE FUNCTION public.get_helper_parish_badges(_user_id uuid)
 RETURNS TABLE(home_parish text, is_verified_local boolean, is_top_helper_in_parish boolean, parish_completed_jobs integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT user_id, parish FROM public.profiles WHERE user_id = _user_id LIMIT 1
  ),
  parish_jobs AS (
    SELECT COUNT(*)::int AS n
    FROM public.jobs j, p
    WHERE j.helper_id = _user_id
      AND j.status = 'completed'
      AND j.parish = p.parish
  ),
  top10 AS (
    SELECT 1
    FROM public.get_top_helpers_by_parish((SELECT parish FROM p), 10) t
    WHERE t.user_id = _user_id
  )
  SELECT
    p.parish AS home_parish,
    (p.parish IS NOT NULL AND COALESCE((SELECT n FROM parish_jobs), 0) >= 3) AS is_verified_local,
    EXISTS (SELECT 1 FROM top10) AS is_top_helper_in_parish,
    COALESCE((SELECT n FROM parish_jobs), 0) AS parish_completed_jobs
  FROM p;
$function$;

REVOKE ALL ON FUNCTION public.get_helper_parish_badges(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_helper_parish_badges(uuid) TO service_role;

-- ── 6. purge_user_data — drop the counter for a table that no longer exists
-- Step 4l deleted the departing user's preferred parishes and reported the
-- count as `preferred_parishes_deleted`. Both go. The key has no consumer: it
-- appears nowhere in `src/`, `supabase/functions/`, or any test.
--
-- Rewritten by targeted substitution over the LIVE definition rather than by
-- re-pasting 450 lines of a compliance-critical function, so that every other
-- clause is provably byte-identical to what is deployed. The substitution is
-- self-verifying: if either pattern fails to match, the assertion at the end
-- RAISEs and the migration fails at DEPLOY time rather than leaving the
-- function pointing at a dropped table and failing at the next account
-- deletion — which is exactly the class of silent breakage that killed
-- `rpc_withdraw_dispute`.
DO $do$
DECLARE
  v_src text;
  v_new text;
BEGIN
  IF to_regprocedure('public.purge_user_data(uuid)') IS NULL THEN
    RETURN;   -- replayed against a database that does not have it yet
  END IF;

  v_src := pg_get_functiondef('public.purge_user_data(uuid)'::regprocedure);

  IF position('helper_preferred_parishes' in v_src) = 0 THEN
    RETURN;   -- already rewritten: the second and third consecutive apply
  END IF;

  -- (a) the prose in step 4l's comment that names the table, (b) the DECLARE
  -- line, (c) the guarded delete block, (d) the returned key. (a) is not
  -- cosmetic: the assertion at the end refuses ANY surviving mention, and a
  -- comment describing a table that no longer exists is exactly the kind of
  -- stale note that sends the next reader looking for a feature.
  v_new := replace(
    v_src,
    E'  --     address they typed. `helper_preferred_parishes` is the twin of\n  --     `helper_availability` at 4j: both are the service-area configuration of\n  --     a helper who has left.\n',
    E'  --     address they typed.\n'
  );
  v_new := regexp_replace(v_new, E'\\n *v_parishes +int := 0;', '', 'g');
  v_new := regexp_replace(
    v_new,
    E'\\n  IF to_regclass\\(''public\\.helper_preferred_parishes''\\) IS NOT NULL THEN.*?\\n  END IF;\\n',
    -- A REAL newline, not E'\\n'. In a regexp_replace REPLACEMENT, backslash-n
    -- is not an escape — Postgres emits the two literal characters, which is
    -- how the first push of this file put `\\n` on its own line inside the
    -- rewritten function and failed db-smoke with `syntax error at or near "\\"`.
    -- Escapes belong in the PATTERN, where E'\\n' does mean newline.
    E'\n',
    ''
  );
  v_new := regexp_replace(v_new, E'\\n *''preferred_parishes_deleted'',[^\\n]*', '', 'g');

  IF position('helper_preferred_parishes' in v_new) <> 0
     OR position('v_parishes' in v_new) <> 0 THEN
    RAISE EXCEPTION 'purge_user_data rewrite left a helper_preferred_parishes reference behind';
  END IF;

  -- The live definition contains no backslash anywhere (checked against prod:
  -- position(E'\\' in src) = 0), so one appearing here means a replacement
  -- string emitted an escape as literal text rather than acting on it. That
  -- is exactly what happened on the first push of this file, and the failure
  -- surfaced 300 lines away from its cause.
  IF position(E'\\' in v_new) <> 0 THEN
    RAISE EXCEPTION 'purge_user_data rewrite introduced a literal backslash — a replacement string was taken as text';
  END IF;

  EXECUTE v_new;
END $do$;

REVOKE ALL ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;

-- ── 7. The table ──────────────────────────────────────────────────────────
-- Last, after every reader above has been rewritten to not name it.
-- DESTRUCTIVE-DDL-ACK: DROP TABLE public.helper_preferred_parishes
-- ACK-REASON: Removed feature. No picker was ever built, so no client or edge function could write it; the only prod inserts were four audit probes that deleted their own rows.
-- ACK-DATA-LOSS: Zero rows, and zero rows in its entire history apart from four self-deleted audit probes (pg_stat_user_tables n_tup_ins=4, n_live_tup=0, count(*)=0 on 2026-09-07). No inbound foreign keys, so nothing is stranded.
DROP TABLE IF EXISTS public.helper_preferred_parishes CASCADE;
