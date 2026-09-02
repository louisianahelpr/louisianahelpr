-- Two switches that were wired to nothing. One authority each, server-side.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — "Hide the fixture jobs" reached 1 of the 3 public browse surfaces
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `src/config/showSeedJobs.ts` promised, in its own docstring: "Flip to false
-- and every public surface that reads it stops showing fixtures." Measured on
-- prod 2026-09-01, with the service-role key, that was true of exactly one of
-- the three surfaces a member can browse jobs on:
--
--   surface                                   flag reaches it?   anon rows
--   ───────────────────────────────────────── ────────────────── ──────────
--   /jobs      get_ranked_open_jobs(…)        YES (p_include_seed)   12 → 0
--   the map    get_open_jobs_for_map()        NO — `Args: never`     12
--   dashboard  open_jobs_browse (view)        NO — no is_seed col    14
--
-- Proof of the two NOs, verbatim from PostgREST with the anon key:
--   rpc/get_open_jobs_for_map {"p_include_seed":false}
--     → 404 PGRST202 "Could not find the function
--       public.get_open_jobs_for_map(p_include_seed) in the schema cache"
--   open_jobs_browse?select=id,is_seed
--     → 400 42703 "column open_jobs_browse.is_seed does not exist"
--
-- And prod's open-job population is 20 rows, ALL of them fixtures — 0 open
-- non-seed jobs. So flipping the constant today would have emptied /jobs while
-- leaving every fixture pin on the map and every fixture card on the dashboard
-- browse list: the three surfaces would have disagreed completely, which is
-- worse than the honest "all fixtures, everywhere" they show now.
--
-- ── WHY THE FLAG MOVES INTO THE DATABASE ────────────────────────────────────
--
-- The obvious repair is to widen the client-side shape: add `p_include_seed`
-- to the map RPC and an `is_seed` column to the view, and let three call sites
-- pass the constant. That is the shape that had just been removed from these
-- exact functions one migration earlier (20260901022522): a filter the client
-- supplies is a filter the client can drop, and /jobs was serving the paid
-- early-access window to any anon caller because of it.
--
-- Two further reasons specific to this flag:
--
--   1. THIS IS A NATIVE APP. A `const` in `src/config` only changes what a
--      shipped bundle does. Flipping it for iOS means a build, a submission
--      and App Review — days, not a line — while the web surface would flip
--      immediately. "Every public surface stops showing fixtures" would be
--      false on the surface that matters most, for as long as review takes.
--      Same reasoning as `src/lib/featureFlags.ts`, which exists because "a
--      native app cannot be hot-fixed inside App Review".
--   2. THREE CALL SITES IS THREE CHANCES TO DRIFT. The dashboard list and the
--      map are read by `useDashboardData` and `BrowseMap`, neither of which
--      knows this flag exists today. A future surface (a widget, an export, a
--      digest email) inherits the gate for free when it lives in the row
--      filter, and inherits nothing when it lives in three hooks.
--
-- So the authority is `public.seed_jobs_hidden_publicly()`, read by all three
-- surfaces, exactly as `public.early_access_cutoff()` is. Flipping it is one
-- statement, takes effect on web and native at once, and needs no release:
--
--     UPDATE public.platform_settings
--        SET feature_flags = feature_flags
--                            || '{"seed_jobs_hidden_publicly": true}'::jsonb;
--
-- ── WHY THE FLAG IS NAMED FOR THE EXCEPTION ─────────────────────────────────
--
-- `seed_jobs_HIDDEN_publicly`, not `show_seed_jobs_publicly`, for the same
-- reason `idv_requirement_paused` is named that way (featureFlags.ts): every
-- way of failing to read it — key absent, blob reset, row missing, a replay
-- onto a fresh database — has to land on TODAY'S behaviour, which is fixtures
-- visible. A `show_…` flag defaulting to false would empty the public
-- marketplace the moment the key went missing, which is the exact outcome the
-- owner rejected when they chose to keep fixtures visible while testing.
--
-- Deploying this file therefore changes NOTHING anyone sees. It seeds the key
-- as `false` so the switch is discoverable in `feature_flags` rather than
-- being an unwritten convention, and never overwrites an existing value.
--
-- ── WHAT `p_include_seed` MEANS NOW ─────────────────────────────────────────
--
-- It survives, with narrowing-only semantics: a caller may still say "don't
-- send me fixtures", and can no longer say "send me fixtures anyway". The
-- predicate is `NOT is_seed OR (p_include_seed AND NOT <flag>)`, so the
-- argument can only ever remove rows. Keeping the parameter also keeps the
-- signature byte-identical, so the anon EXECUTE grant carries over and there
-- is no PGRST202 window for the guest feed during db-deploy.
--
-- Admin aggregates are untouched, as ever: they exclude `is_seed`
-- unconditionally (20260825184500), because a money figure that counts
-- fixtures is wrong at every stage, testing included.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — Saved searches have never notified anyone, and could not have
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `saved_searches` has shipped since 20260426132214 with a polished dialog, a
-- per-row bell toggle, a 1-hour throttle, digest batching and an email/push
-- fan-out. Prod, 2026-09-01: 0 rows. It has therefore never fired, and three
-- separate defects meant it could not have if it had rows:
--
--   D-1  THE RADIUS FILTER COULD NEVER MATCH. `location_keyword` is written
--        from the dashboard's `locationFilter`, and that state is only ever
--        `""` or the machine token `nearby:<miles>` — `JobFilters.tsx` sets it
--        from radius chips and `useDashboardFilters` reads it from `?loc=`;
--        there is no free-text location input anywhere in the app. The match
--        predicate was `NEW.location ILIKE '%' || s.location_keyword || '%'`,
--        i.e. `ILIKE '%nearby:25%'` against a street address. It can never be
--        true, and because it is AND-ed with everything else it killed the
--        whole row — so saving a search WITH a radius made it match nothing at
--        all, silently, forever.
--
--   D-2  IT FIRED ON A JOB NOBODY COULD SEE. The trigger was
--        `AFTER INSERT ON public.jobs` with no WHEN clause. A job is INSERTed
--        with `payment_status` at its column default `'unpaid'` and only
--        becomes `'escrow'` when checkout completes — and every browse surface
--        requires `payment_status IN ('escrow','payout_pending','released')`
--        (the F-1 funded gate). So the alert was sent at the one moment the
--        job was guaranteed invisible: the helper taps `/dashboard?job=<id>`
--        and finds nothing. Worse, the alert fired even for a checkout that
--        was then abandoned — a job that never existed for anyone.
--
--   D-3  A SAVED SEARCH COULD NOT RESTORE ITS OWN TEXT QUERY. The browse feed
--        has a text query (`?q=`, matched against title + description) and
--        `saved_searches` had no column for it. "Lawn care under $200" saved
--        the budget and the category and dropped the words, so re-applying the
--        search silently widened it — the same class of bug the min_budget
--        comment in SavedSearches.tsx already records for the budget band.
--
-- ── FIX, NOT REMOVE ─────────────────────────────────────────────────────────
--
-- A saved-search UI that silently never notifies is worse than none: the
-- helper believes they are covered and stops checking. Removal was the
-- alternative and was rejected on the evidence — the 0 rows are not a demand
-- signal (the app is pre-launch and its open-job population is 100% fixtures),
-- every expensive part of the feature already exists and works (throttle,
-- dedupe, digest mode, email + push fan-out, the RLS, the 10-per-user cap),
-- and job alerts are the mechanism that gets a helper back into the loop
-- between jobs. Three bounded defects against a built feature is a repair.
--
-- ── D-1: THE RADIUS BECOMES A REAL GEOGRAPHIC TEST ──────────────────────────
--
-- `radius_miles numeric` replaces the token. `location_keyword` stays a
-- genuine free-text keyword (nothing writes one today; the column is kept
-- because a legacy row may hold one and NULL means "no keyword"). Any
-- surviving `nearby:N` token is converted below, and the predicate ignores a
-- token-shaped keyword rather than letting it poison the match again during
-- the window where an old bundle is still writing them.
--
-- The origin is resolved at MATCH time from the searcher's own
-- `profiles.latitude/longitude` rather than frozen into the row at save time:
-- a helper who moves gets the search they meant, and no new client plumbing
-- has to capture coordinates. The ladder mirrors the client's own
-- (`useDashboardFilters`: precise coords when present, coarse location when
-- not):
--
--   1. helper coords AND job coords  → haversine miles <= radius_miles.
--   2. either side missing coords    → parish equality (a Louisiana parish is
--                                      the right coarseness for a 5–50 mile
--                                      radius, and every job carries one).
--   3. helper has neither            → NO MATCH. An unevaluable radius must
--                                      not quietly fan out statewide; that is
--                                      how a "within 5 miles" alert becomes
--                                      spam, and spam is how a helper turns
--                                      alerts off for good.
--
-- ── D-2: THE TRIGGER FIRES WHEN THE JOB BECOMES VISIBLE ─────────────────────
--
-- One function, two triggers, because a WHEN clause may not reference OLD on
-- an INSERT:
--   * INSERT — fire only if the row lands already funded and open (a
--     service-role/backfill insert, or a recurring-job spawn that copies the
--     escrow state).
--   * UPDATE — fire on the TRANSITION into funded+open, and only then: the
--     WHEN clause requires the OLD row not to have been funded+open already,
--     so an edit, a boost, a title change or a second escrow write cannot
--     re-notify. Combined with the existing per-search 1-hour throttle and the
--     `match_digest_queue` unique key, a job produces at most one alert.
--
-- The same clause is where the two parts of this migration meet: a fixture job
-- must not generate an alert while fixtures are hidden, so the function asks
-- `seed_jobs_hidden_publicly()` — the one authority — rather than carrying its
-- own idea of what is visible.
--
-- ── D-3: `query text` ───────────────────────────────────────────────────────
--
-- Matched with `strpos(lower(…))`, not ILIKE: that is exactly what the client
-- filter does (`title.toLowerCase().includes(q) || description…`), and it is
-- immune to a user typing `%` or `_` into the box and silently matching every
-- job in the state. The same treatment is applied to `location_keyword`.
--
-- ── SECURITY / RECURSION ────────────────────────────────────────────────────
--
-- `seed_jobs_hidden_publicly()` is SECURITY DEFINER with a pinned search_path
-- and reads exactly one table, the `platform_settings` singleton, with no
-- reference to `auth.uid()` and no per-caller behaviour.
--
-- SECURITY DEFINER IS LOAD-BEARING, NOT DECORATION. `platform_settings` is
-- ADMIN-READ-ONLY under RLS (the public policy was dropped in 20260403200046;
-- see also 20260826070000 and 20260901035235, which exist because a non-admin
-- gets `200 []` from `/rest/v1/platform_settings`). An INVOKER function would
-- therefore read NO ROW for every guest and every ordinary helper — the exact
-- callers this gate exists for — and the `COALESCE(…, false)` would resolve to
-- "fixtures visible" forever. The switch would look wired and do nothing, with
-- no error anywhere: the silent-no-op class this whole migration is about.
-- `is_idv_requirement_paused()` (20260829031930) is SECURITY DEFINER for the
-- identical reason, and says so.
--
-- It cannot recurse: `platform_settings`' surviving policies are a plain
-- admin-role check and a service_role grant, neither of which reads back into
-- a function that reads `platform_settings`.
--
-- EXECUTE goes to `anon` and `authenticated` by name because
-- `open_jobs_browse` is `security_invoker = false` — table access is checked
-- as the view owner, but a FUNCTION referenced by the view is still checked
-- against the CALLING role (same note as `early_access_cutoff()`).
--
-- `miles_between()` is IMMUTABLE arithmetic over four numerics and touches no
-- table, but it still ships with an explicit REVOKE rather than riding the
-- default PUBLIC EXECUTE — `scripts/check-migration-grants.mjs` fails the
-- build otherwise, because the Supabase advisor pass keeps stripping implicit
-- grants and silently breaking whatever depended on them (#355/#358/#364).
-- Its only caller is the SECURITY DEFINER trigger below, which runs as the
-- owner, so nothing else needs to reach it.
--
-- `notify_saved_searches_on_new_job()` keeps its name (20260505190000 revokes
-- EXECUTE on it by name and that revoke is re-asserted below), stays SECURITY
-- DEFINER with a pinned search_path, and reads only tables it already read.
--
-- ── REPLAY-SAFETY ───────────────────────────────────────────────────────────
--
-- Every statement is CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS / a guarded
-- ALTER / DROP TRIGGER IF EXISTS + CREATE TRIGGER / a self-limiting UPDATE.
-- No column is dropped, no function signature or return type changes, and
-- nothing here references an object a LATER migration defines. Applied three
-- times consecutively against a prod-shaped PGlite database with assertions
-- after every pass; pass 3 was identical to pass 1 and no overload
-- accumulated, so `get_ranked_open_jobs` stayed callable at 0-, 1-, 2- and
-- 3-argument arity throughout the db-deploy window.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The one authority for fixture visibility
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.seed_jobs_hidden_publicly()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Named for the exception so every failure mode (key absent, blob reset,
  -- no settings row at all) resolves to FALSE = fixtures visible = today's
  -- behaviour. Only a deliberate `true` written into feature_flags hides them.
  SELECT COALESCE(
    (
      SELECT s.feature_flags -> 'seed_jobs_hidden_publicly' = 'true'::jsonb
      FROM public.platform_settings s
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    false
  );
$function$;

COMMENT ON FUNCTION public.seed_jobs_hidden_publicly() IS
  'TRUE when the operator has hidden fixture (is_seed) jobs from the public marketplace. The single server-side authority: /jobs (get_ranked_open_jobs), the dashboard list (open_jobs_browse), the map (get_open_jobs_for_map) and the saved-search alert trigger all read it. Flip with: UPDATE public.platform_settings SET feature_flags = feature_flags || ''{"seed_jobs_hidden_publicly": true}''::jsonb; Absent/unreadable resolves to FALSE (fixtures visible) so a lost key can never empty the marketplace. See src/config/showSeedJobs.ts.';

REVOKE ALL ON FUNCTION public.seed_jobs_hidden_publicly() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_jobs_hidden_publicly() TO anon, authenticated, service_role;

-- Make the switch discoverable in the stored blob (and in /admin's settings
-- reader) rather than being an unwritten convention. Self-limiting: the WHERE
-- means a second application is a no-op, and an operator's later flip to
-- `true` is never overwritten by a replay.
UPDATE public.platform_settings
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
                       || '{"seed_jobs_hidden_publicly": false}'::jsonb
 WHERE COALESCE(feature_flags, '{}'::jsonb) -> 'seed_jobs_hidden_publicly' IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Surface 1 — /jobs (get_ranked_open_jobs)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260901031421's body verbatim, with the fixture predicate moved onto the
-- authority and the flag hoisted into the existing single-evaluation CTE.

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Surface 2 — the dashboard browse list (open_jobs_browse)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260901022522's body verbatim plus the fixture predicate. No new column is
-- exposed: `is_seed` stays off the view's column list, because the answer the
-- client needs is "is this row for me", not "is this row a fixture" — and a
-- returned flag is one a client could be tempted to filter on instead.
--
-- CREATE OR REPLACE VIEW preserves grants and the column list but NOT
-- reloptions (measured on PGlite: `{security_invoker=false}` → NULL on every
-- pass), so the posture is re-asserted below exactly as 20260616120000,
-- 20260628120000 and 20260901022522 each do.

CREATE OR REPLACE VIEW public.open_jobs_browse AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() THEN location
            ELSE public.mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
    offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    (( SELECT count(*) AS count
           FROM public.applications a
          WHERE a.job_id = jobs.id))::integer AS applicant_count,
    pricing_mode
   FROM public.jobs
  WHERE status = 'open'::job_status
    -- F-1: escrow must exist before a helper can see the job.
    AND payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid())
    -- Early Access, enforced here rather than trusted to the caller's
    -- `.lte("created_at", …)` (20260901022522).
    AND (
      created_at <= public.early_access_cutoff()
      OR customer_id = auth.uid()
      OR offered_to_helper_id = auth.uid()
    )
    -- Fixture rows, on the shared authority. This surface had NO way to
    -- exclude them at all before today.
    AND (NOT is_seed OR NOT public.seed_jobs_hidden_publicly());

DO $$
BEGIN
  IF to_regclass('public.open_jobs_browse') IS NOT NULL THEN
    ALTER VIEW public.open_jobs_browse SET (security_invoker = false);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Surface 3 — the map (get_open_jobs_for_map)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260901022522's body verbatim plus the fixture predicate on the shared
-- authority. The signature stays zero-argument on purpose: the whole point is
-- that no caller supplies this, so `Args: never` stops being the reason the
-- map could not honour the switch and becomes the reason it cannot dodge it.

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Saved searches — the columns the feature always needed
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS query        text,
  ADD COLUMN IF NOT EXISTS radius_miles numeric;

COMMENT ON COLUMN public.saved_searches.query IS
  'Free-text query, matched against jobs.title + jobs.description exactly as the browse feed matches ?q= (case-insensitive substring, NOT a LIKE pattern).';
COMMENT ON COLUMN public.saved_searches.radius_miles IS
  'Geographic radius in miles from the searcher''s own profiles.latitude/longitude, resolved at match time. Replaces the `nearby:<miles>` machine token that used to be stored in location_keyword, where it could never match a real address.';
COMMENT ON COLUMN public.saved_searches.location_keyword IS
  'A genuine free-text location keyword. Never a `nearby:<miles>` token — that is radius_miles now; the alert trigger ignores a token-shaped value so a stale client cannot re-break matching.';

-- A radius must be a positive number of miles. Guarded rather than inline so a
-- replay onto a database that already has the constraint is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.saved_searches'::regclass
      AND conname  = 'saved_searches_radius_miles_positive'
  ) THEN
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_radius_miles_positive
      CHECK (radius_miles IS NULL OR radius_miles > 0);
  END IF;
END $$;

-- Convert any surviving machine token into the real column. Self-limiting: the
-- WHERE stops matching once converted, so replay is a no-op. (Prod holds zero
-- saved_searches rows as of 2026-09-01 — this is for staging and for any row
-- an old bundle writes during the deploy window.)
UPDATE public.saved_searches
   SET radius_miles = COALESCE(
         radius_miles,
         substring(location_keyword from '^nearby:([0-9]+(?:\.[0-9]+)?)$')::numeric
       ),
       location_keyword = NULL
 WHERE location_keyword ~ '^nearby:[0-9]+(\.[0-9]+)?$';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Distance, in miles, the same way the client computes it
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Plain haversine arithmetic — no PostGIS, no earthdistance, nothing to
-- install. R = 3958.8 to match `haversineMiles` in src/lib/geo.ts exactly, so
-- a job on the edge of the radius does not fall inside the feed's filter and
-- outside the alert's, or vice versa.

CREATE OR REPLACE FUNCTION public.miles_between(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN lat1 IS NULL OR lng1 IS NULL OR lat2 IS NULL OR lng2 IS NULL THEN NULL
    ELSE (
      2 * 3958.8 * asin(LEAST(1, sqrt(
            power(sin(radians(lat2 - lat1) / 2), 2)
          + cos(radians(lat1)) * cos(radians(lat2))
            * power(sin(radians(lng2 - lng1) / 2), 2)
      )))
    )::numeric
  END;
$function$;

COMMENT ON FUNCTION public.miles_between(numeric, numeric, numeric, numeric) IS
  'Great-circle distance in miles. Mirrors haversineMiles() in src/lib/geo.ts (R = 3958.8) so the saved-search radius and the browse-feed radius agree on the boundary. NULL if any coordinate is NULL.';

-- Locked: the only caller is notify_saved_searches_on_new_job(), which is
-- SECURITY DEFINER and therefore executes as the owner. Explicit rather than
-- implicit, per scripts/check-migration-grants.mjs.
REVOKE ALL ON FUNCTION public.miles_between(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. The alert itself
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260824070000's body, with the three defects repaired. Everything else —
-- the per-user grouping, the per-search 1-hour throttle, digest mode, the
-- notification copy, the email fan-out via the vault secrets — is unchanged.

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
  -- The triggers' WHEN clauses already guarantee open + funded, so this is a
  -- belt-and-braces re-assertion for any future direct call.
  -- COALESCE, not a bare `= ANY`: payment_status is nullable, and a NULL
  -- would make the whole condition NULL, which an IF treats as false — i.e.
  -- it would fall THROUGH the guard and notify about an unfunded job.
  IF NEW.status <> 'open'
     OR COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
  THEN
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

  -- Fixtures, on the same authority the three browse surfaces use. Never
  -- alert about a job the operator has hidden from the marketplace.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_is_urgent := COALESCE(NEW.is_urgent, false);
  v_title := 'New job matches your saved search';
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
      -- D-3: the words the helper actually searched for. Substring, not
      -- ILIKE — a typed `%` is a character here, not a wildcard, exactly as
      -- in the browse feed's `.includes()`.
      AND (
        s.query IS NULL
        OR btrim(s.query) = ''
        OR strpos(lower(NEW.title), lower(btrim(s.query))) > 0
        OR strpos(lower(COALESCE(NEW.description, '')), lower(btrim(s.query))) > 0
      )
      -- A genuine free-text location keyword. A surviving `nearby:<miles>`
      -- token is NOT a keyword and must never be matched against an address
      -- (D-1): treat it as "no keyword" so a stale client writing one cannot
      -- silently kill the whole match again.
      AND (
        s.location_keyword IS NULL
        OR s.location_keyword ~ '^nearby:'
        OR strpos(lower(COALESCE(NEW.location, '')), lower(s.location_keyword)) > 0
      )
      -- D-1: the radius, as a real geographic test. Precise when both sides
      -- have coordinates, parish equality when they do not, and NO MATCH when
      -- the searcher has neither — an unevaluable radius must not fan out
      -- statewide. See the ladder in this migration's header.
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

REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Fire it when the job becomes VISIBLE, exactly once
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The old `trg_notify_saved_searches` (AFTER INSERT, no WHEN) fired at the one
-- moment `payment_status` was guaranteed to be its `'unpaid'` default. Two
-- triggers replace it because a WHEN clause may not reference OLD on INSERT.

DROP TRIGGER IF EXISTS trg_notify_saved_searches ON public.jobs;
DROP TRIGGER IF EXISTS trg_notify_saved_searches_funded_insert ON public.jobs;
DROP TRIGGER IF EXISTS trg_notify_saved_searches_funded_update ON public.jobs;

-- Lands already funded and open — a service-role insert, or a recurring-job
-- spawn that copies the escrow state.
CREATE TRIGGER trg_notify_saved_searches_funded_insert
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
  )
  EXECUTE FUNCTION public.notify_saved_searches_on_new_job();

-- The normal path: checkout completes and `payment_status` moves to 'escrow'.
-- The OLD-row half of the condition makes this the TRANSITION into visible —
-- an edit, a boost, a re-save or a second escrow write leaves the row already
-- funded+open and fires nothing.
CREATE TRIGGER trg_notify_saved_searches_funded_update
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND NOT (
      OLD.status = 'open'::job_status
      AND OLD.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    )
  )
  EXECUTE FUNCTION public.notify_saved_searches_on_new_job();
