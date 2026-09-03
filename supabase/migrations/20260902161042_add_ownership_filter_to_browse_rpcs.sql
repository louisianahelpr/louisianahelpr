-- Teach the OTHER two browse surfaces that a job can outlive its poster.
--
-- ── What this corrects ──────────────────────────────────────────────────────
-- 20260902152714_hide_ownerless_jobs_from_browse added `customer_id IS NOT NULL`
-- to the `open_jobs_browse` view, so a job whose poster deleted their account
-- (20260901033011 anonymises rather than deletes: `jobs.customer_id` becomes
-- NULL and the row survives as a financial record) stops appearing in the
-- signed-in dashboard feed and its "N jobs" count.
--
-- That migration's header comment claimed:
--
--     "the feed, the recommended row, the map and the count all inherit it at
--      once"
--
-- THAT SENTENCE IS FALSE, and it is recorded here rather than quietly repaired
-- because it is the version already applied to prod — a future audit reading
-- `schema_migrations` would have trusted it. Only TWO of the four surfaces
-- named actually read the view. The browse map and the `/jobs` feed are
-- `SECURITY DEFINER` FUNCTIONS that query `public.jobs` DIRECTLY; they mention
-- `open_jobs_browse` only inside comments, so CREATE OR REPLACE VIEW could not
-- reach them and they kept surfacing ownerless jobs.
--
-- Verified against prod (fncmgoasalhdgfwzhsqa) on 2026-09-02:
--
--   surface                object                          reads the view?
--   ─────────────────────  ──────────────────────────────  ───────────────
--   dashboard list+count   public.open_jobs_browse         YES — fixed 20260902152714
--   /jobs feed (+guest)    public.get_ranked_open_jobs()   NO  — fixed here
--   browse map             public.get_open_jobs_for_map()  NO  — fixed here
--   landing teaser         public.get_public_open_jobs()   NO  — fixed here
--
-- All three are `SECURITY DEFINER` and EXECUTE-able by `anon`
-- (`get_ranked_open_jobs` additionally to `PUBLIC`), so the ownerless job was
-- reachable by a logged-out visitor. Call sites: `BrowseMap.tsx:152`,
-- `App.tsx:276`, and the surface map in `src/config/showSeedJobs.ts:88-90`.
--
-- ── Why the map needs this even though it looks safe today ──────────────────
-- `get_open_jobs_for_map` already filters `j.latitude IS NOT NULL`, and
-- `purge_user_data()` nulls `location`, `latitude` and `longitude` on the
-- departing poster's jobs. So ownerless jobs are excluded from the map TODAY.
--
-- THAT SAFETY IS INCIDENTAL, NOT INTENDED. Do not "simplify" the predicate
-- added below on the belief that the coordinate check covers ownership — it
-- covers ownership only for as long as those two facts stay coupled, and they
-- are not coupled by anything. `jobs_customer_id_fkey` is
-- `REFERENCES auth.users(id) ON DELETE SET NULL` (verified live), so deleting
-- an `auth.users` row by ANY path that does not call `purge_user_data()` — an
-- admin acting through the Supabase dashboard or the Admin API, a future
-- deletion path, a `purge_user_data()` that fails after the FK has fired —
-- nulls `customer_id` while leaving the coordinates populated. In that state
-- the map pins a job nobody owns. The predicate below states the rule the map
-- actually means, so it holds regardless.
--
-- ── Scope: exactly one predicate per function ───────────────────────────────
-- Every body below is reproduced VERBATIM from `pg_get_functiondef()` against
-- prod, with a single added line: `AND ... customer_id IS NOT NULL`. Nothing
-- else changed — not a column, not a cast, not an ORDER BY, not a comment.
-- Attributes (`SECURITY DEFINER`, `SET search_path`, `STABLE`, argument names
-- and defaults, return type) are restated explicitly rather than relied on to
-- carry over: CREATE OR REPLACE FUNCTION replaces the whole definition, and a
-- `SECURITY DEFINER` function that loses its pinned `search_path` is a
-- privilege-escalation primitive.
--
-- No GRANTs are re-issued. CREATE OR REPLACE FUNCTION preserves ownership and
-- privileges; re-granting would only risk widening them.
--
-- KNOWN, DELIBERATELY NOT FIXED HERE: `get_public_open_jobs` has no
-- `payment_status` gate at all, so the landing teaser can show a job whose
-- escrow was never funded — a real divergence from the other two feeds, and a
-- separate change. This migration adds one predicate to each function and
-- nothing else, so that the diff stays reviewable against `pg_get_functiondef`.
--
-- REPLAY-SAFETY: three CREATE OR REPLACE FUNCTION statements, idempotent by
-- construction, with no dependency on rows or on prior state. Every object
-- referenced (`public.jobs`, `early_access_cutoff()`,
-- `seed_jobs_hidden_publicly()`, `mask_job_location()`,
-- `helper_preferred_parishes`, `profiles`) is defined by an EARLIER migration,
-- so a from-scratch rebuild in timestamp order reaches this file with all of
-- them present.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. /jobs feed — the guest and signed-in browse list.
--
-- This function has FOUR `WHERE` clauses. The predicate belongs in the FOURTH,
-- the one on the `scored` CTE, because that is the only one that selects the
-- BROWSABLE SET; it is where `status`, `payment_status`, the direct-offer rule,
-- the seed rule and Early Access already live. The other three all sit inside
-- `viewer_parishes` and describe the VIEWER (which parishes this user has
-- chosen), not the jobs — adding an ownership rule to any of them would filter
-- the wrong relation and silently change ranking rather than visibility.
-- ───────────────────────────────────────────────────────────────────────────
-- REPLAY SAFETY (added 2026-09-03). `CREATE OR REPLACE FUNCTION` cannot change a
-- function's RETURNS TABLE signature — Postgres raises "cannot change return type
-- of existing function". Against prod that never fired, because the previous
-- definition happened to match; against db-smoke's from-scratch replay it did,
-- and db-smoke has been RED on every run since. Dropping first is idempotent and
-- is what makes this file replayable.
DROP FUNCTION IF EXISTS public.get_ranked_open_jobs(integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.get_ranked_open_jobs(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_include_seed boolean DEFAULT true)
 RETURNS TABLE(id uuid, title text, description text, category job_category, budget numeric, date_needed date, start_time time without time zone, location text, parish text, is_urgent boolean, urgent_fee numeric, is_flexible_schedule boolean, is_recurring boolean, recurrence_interval text, is_group_job boolean, helpers_needed integer, estimated_hours numeric, photos text[], special_requirements text, created_at timestamp with time zone, expires_at timestamp with time zone, boosted_at timestamp with time zone, boost_expires_at timestamp with time zone, parish_match boolean, rank_score numeric, pricing_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH viewer_parishes AS (
    SELECT parish FROM public.helper_preferred_parishes
    WHERE helper_id = (SELECT auth.uid())
    UNION
    SELECT parish FROM public.profiles
    WHERE user_id = (SELECT auth.uid())
      AND parish IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.helper_preferred_parishes
        WHERE helper_id = (SELECT auth.uid())
      )
  ),
  -- Evaluated once per call, not once per row: neither value depends on j.
  cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden
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
    -- Poster's membership row. LEFT so a job whose poster has no profile row
    -- still ranks (it simply earns no placement points).
    LEFT JOIN public.profiles pp ON pp.user_id = j.customer_id
    WHERE j.status = 'open'
      -- Ownership. A job whose poster deleted their account keeps `status =
      -- 'open'` and its funded escrow, but nobody remains to answer a question,
      -- accept an application or release the money — so it must not be offered
      -- as work. Mirrors open_jobs_browse (20260902152714).
      AND j.customer_id IS NOT NULL
      AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
      -- Hide jobs under a live direct offer — mirrors open_jobs_browse.
      AND (
        j.offered_to_helper_id IS NULL
        OR j.direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
      -- F-1: escrow must exist before a helper can see the job.
      AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
      -- Fixture rows. The SERVER decides. `p_include_seed` may only NARROW —
      -- a caller can still ask not to be sent fixtures, and can no longer ask
      -- to be sent them once the operator flag is on.
      AND (NOT j.is_seed OR (p_include_seed AND NOT cutoff.seed_hidden))
      -- Early Access (20260901022522). auth.uid() IS NULL for a guest, which
      -- lands on the free 20-minute delay — the free experience, by design.
      AND (
        j.created_at <= cutoff.ts
        OR j.customer_id = (SELECT auth.uid())
        OR j.offered_to_helper_id = (SELECT auth.uid())
      )
  )
  SELECT id, title, description, category, budget, date_needed, start_time,
    public.mask_job_location(location) AS location, parish, is_urgent, urgent_fee,
    is_flexible_schedule, is_recurring, recurrence_interval, is_group_job,
    helpers_needed, estimated_hours, photos, special_requirements, created_at,
    expires_at, boosted_at, boost_expires_at, parish_match, rank_score, pricing_mode
  FROM scored
  ORDER BY rank_score DESC, created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Browse map — one WHERE, so there is no ambiguity about placement.
--    See the header: the existing `latitude IS NOT NULL` filter makes this
--    redundant TODAY and will not keep doing so.
-- ───────────────────────────────────────────────────────────────────────────
-- REPLAY SAFETY (added 2026-09-03). `CREATE OR REPLACE FUNCTION` cannot change a
-- function's RETURNS TABLE signature — Postgres raises "cannot change return type
-- of existing function". Against prod that never fired, because the previous
-- definition happened to match; against db-smoke's from-scratch replay it did,
-- and db-smoke has been RED on every run since. Dropping first is idempotent and
-- is what makes this file replayable.
DROP FUNCTION IF EXISTS public.get_open_jobs_for_map();

CREATE OR REPLACE FUNCTION public.get_open_jobs_for_map()
 RETURNS TABLE(id uuid, title text, category text, budget numeric, is_urgent boolean, latitude numeric, longitude numeric, parish text, created_at timestamp with time zone, location text, date_needed date, start_time time without time zone, urgent_fee numeric, is_group_job boolean, helpers_needed integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cutoff AS (
    SELECT public.early_access_cutoff()      AS ts,
           public.seed_jobs_hidden_publicly() AS seed_hidden
  )
  SELECT
    j.id,
    j.title,
    j.category,
    j.budget,
    COALESCE(j.is_urgent, false) AS is_urgent,
    -- 2 decimal places ≈ 1.1km at Louisiana latitudes. The pin lands in
    -- the right neighborhood, never on the doorstep, and can't be
    -- reverse-engineered to the source coords.
    ROUND(j.latitude, 2) AS latitude,
    ROUND(j.longitude, 2) AS longitude,
    j.parish,
    j.created_at,
    -- City, State only — same masker the public /jobs board uses. The popup
    -- prints the city and falls back to the parish when this is empty.
    public.mask_job_location(j.location) AS location,
    j.date_needed,
    j.start_time,
    j.urgent_fee,
    COALESCE(j.is_group_job, false) AS is_group_job,
    j.helpers_needed
  FROM public.jobs j
  CROSS JOIN cutoff
  WHERE j.status = 'open'
    -- Ownership. Redundant today only because anonymisation also nulls the
    -- coordinates the filter below requires; stated explicitly so the map does
    -- not depend on that coincidence. See the header.
    AND j.customer_id IS NOT NULL
    -- F-1: same funded gate as get_ranked_open_jobs and open_jobs_browse, so
    -- the map cannot pin a job the list refuses to show.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL
    AND (j.expires_at IS NULL OR j.expires_at > NOW())
    -- Hide jobs whose needed date has already passed — matches the
    -- client-side filter in useDashboardFilters.ts and the SQL filter in
    -- get_ranked_open_jobs, so list + map + /jobs page all agree on
    -- which posts are "still open for browse."
    AND (j.date_needed IS NULL OR j.date_needed >= CURRENT_DATE)
    -- Same visibility rule as get_public_open_jobs: a job with a pending
    -- direct offer is private to its targeted helper; it reappears once
    -- the offer resolves (declined/expired).
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
    -- The paid perk, on the shared authority.
    AND (
      j.created_at <= cutoff.ts
      OR j.customer_id = (SELECT auth.uid())
      OR j.offered_to_helper_id = (SELECT auth.uid())
    )
    -- Fixture rows, on the shared authority. The map could not exclude them
    -- at all before today — the RPC takes no arguments.
    AND (NOT j.is_seed OR NOT cutoff.seed_hidden)
  ORDER BY j.boosted_at DESC NULLS LAST, j.created_at DESC
  LIMIT 100;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Landing teaser — anon-executable, six jobs, shown to logged-out visitors.
--    The same rule for the same reason. (Its missing `payment_status` gate is
--    called out in the header and deliberately left alone here.)
-- ───────────────────────────────────────────────────────────────────────────
-- REPLAY SAFETY (added 2026-09-03). `CREATE OR REPLACE FUNCTION` cannot change a
-- function's RETURNS TABLE signature — Postgres raises "cannot change return type
-- of existing function". Against prod that never fired, because the previous
-- definition happened to match; against db-smoke's from-scratch replay it did,
-- and db-smoke has been RED on every run since. Dropping first is idempotent and
-- is what makes this file replayable.
DROP FUNCTION IF EXISTS public.get_public_open_jobs(integer);

CREATE OR REPLACE FUNCTION public.get_public_open_jobs(p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, title text, category text, location text, budget numeric, date_needed date, is_urgent boolean, is_boosted boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id, j.title, j.category::text,
         public.mask_job_location(j.location) AS location,
         j.budget, j.date_needed, j.is_urgent,
         (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) AS is_boosted
  FROM public.jobs j
  WHERE j.status = 'open'
    -- Ownership. Mirrors open_jobs_browse (20260902152714).
    AND j.customer_id IS NOT NULL
    AND j.date_needed >= CURRENT_DATE
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
  ORDER BY
    (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) DESC,
    j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$function$;

-- DROP DISCARDS THE ACL. `CREATE OR REPLACE` preserved these grants, which is
-- why the file never needed them; the DROP added above for replay-safety does
-- not. Restored to exactly what prod holds (read from pg_proc.proacl
-- 2026-09-03: anon, authenticated, service_role) so a replayed database is not
-- quietly more or less permissive than production. This is the same trap that
-- bit review_credential() earlier today — a DROP is never only a DROP.
GRANT EXECUTE ON FUNCTION public.get_ranked_open_jobs(integer, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_open_jobs_for_map() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_open_jobs(integer) TO anon, authenticated, service_role;
