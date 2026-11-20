-- Owner 2026-11-20 (ease batch, item 1): Post a job shows a fair price hint from recent similar jobs near the poster
-- ("Most yard jobs near you are $40-$80"), computed server-side from REAL non-seed jobs, with a sensible fallback
-- when data is thin. It replaces board 190's get_price_guidance (statewide, completed jobs only, 30+ jobs, behind the
-- testers switch 'price_guidance'), which never showed: measured 2026-11-20 (read-only), 7 real priced jobs in the
-- last year across 5 categories.
--
-- get_fair_price_hint(category, lat, lng) answers ONE range and where it came from (scope):
--   'near'    the middle half (25th-75th percentile, whole dollars) of real jobs in this category within 25 miles of
--             the point, posted in the last 180 days, when at least 5 jobs from at least 3 different posters back it;
--   'state'   the same, statewide, when the near sample is too thin;
--   'typical' otherwise: a fixed starting range per category (below), worded on the screen as typical, never as
--             "jobs on Helpr" (truth rule: a real number is real, a typical one says so).
-- A real sample needs 5 jobs and 3 posters, so no single job's or poster's price can be read back from it, and the
-- count is never returned for a thin sample.
--
-- Real means: not is_seed; neither the poster nor the Helpr is a test account (public.test_accounts) or an is_seed
-- profile; not a crew job (its budget is the whole crew's); priced (budget > 0); posted and not refused or abandoned:
-- status is not cancelled and payment_status is not one of the never-paid ones (src/lib/neverPaidStatuses.ts).
--
-- Authz: SECURITY DEFINER (members cannot read other people's jobs); aggregates only, no id, name, place or single
-- price. A signed-in member gets the real ranges; a guest (anon, starting a post before signing up) only ever gets
-- the 'typical' row, read from no table. STABLE, a read: no ban gate (scripts/ci/ban-gate-coverage.sql classifies
-- VOLATILE RPCs). Shipped on for everyone (owner rule: fixes ship ON, no testers switch), so the 'price_guidance'
-- switch and get_price_guidance are retired in the same change (AGENT-BRIEF "Retiring a switch").
-- Replay-safe: CREATE OR REPLACE, DROP ... IF EXISTS, DELETE is idempotent. Proof: src/test/pglite/fairPriceHint.pglite.mjs.

CREATE OR REPLACE FUNCTION public.fair_price_typical(p_category text)
RETURNS TABLE(low_dollars integer, high_dollars integer)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT v.lo, v.hi
    FROM (VALUES
      ('cleaning', 80, 150), ('yard_work', 40, 80), ('moving', 80, 200), ('errands', 25, 50),
      ('handyman', 60, 150), ('painting', 100, 300), ('delivery', 25, 60), ('pet_care', 25, 60),
      ('assembly', 40, 100), ('storm_prep', 60, 150), ('events', 60, 150), ('electrical', 100, 250),
      ('plumbing', 100, 250), ('hvac', 100, 300), ('roofing', 150, 400), ('welding', 100, 250),
      ('carpentry', 100, 250), ('auto_repair', 80, 200), ('appliance_repair', 80, 200), ('flooring', 150, 400),
      ('concrete_masonry', 150, 400), ('fencing', 150, 400), ('pressure_washing', 80, 200), ('declutter_help', 50, 120),
      ('other', 40, 100)
    ) AS v(cat, lo, hi)
   WHERE v.cat = p_category
$fn$;

REVOKE ALL ON FUNCTION public.fair_price_typical(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fair_price_typical(text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_fair_price_hint(p_category text, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)
RETURNS TABLE(scope text, sample_count integer, low_dollars integer, high_dollars integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer;
  v_posters integer;
  v_low numeric;
  v_high numeric;
  v_near boolean := p_lat IS NOT NULL AND p_lng IS NOT NULL
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180;
BEGIN
  IF p_category IS NULL OR length(p_category) > 40 THEN
    RETURN;
  END IF;

  IF (SELECT auth.uid()) IS NOT NULL THEN
    -- Near first (25 miles, flat-earth miles: fine at Louisiana's latitude), then statewide.
    FOR i IN 1..2 LOOP
      CONTINUE WHEN i = 1 AND NOT v_near;
      SELECT count(*)::integer,
             count(DISTINCT j.customer_id)::integer,
             percentile_cont(0.25) WITHIN GROUP (ORDER BY j.budget),
             percentile_cont(0.75) WITHIN GROUP (ORDER BY j.budget)
        INTO v_n, v_posters, v_low, v_high
        FROM public.jobs j
       WHERE j.category::text = p_category
         AND j.created_at > now() - interval '180 days'
         AND j.status::text <> 'cancelled'
         AND coalesce(j.payment_status, '') NOT IN ('unpaid', 'abandoned', 'failed')
         AND coalesce(j.is_seed, false) = false
         AND coalesce(j.is_group_job, false) = false
         AND j.budget > 0
         AND j.customer_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (j.customer_id, j.helper_id))
         AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id IN (j.customer_id, j.helper_id) AND coalesce(p.is_seed, false))
         AND (i = 2 OR (
               j.latitude IS NOT NULL AND j.longitude IS NOT NULL
               AND sqrt(power((j.latitude - p_lat) * 69.0, 2) + power((j.longitude - p_lng) * 69.0 * cos(radians(p_lat)), 2)) <= 25
             ));
      IF v_n >= 5 AND v_posters >= 3 AND v_high >= v_low THEN
        RETURN QUERY SELECT CASE WHEN i = 1 THEN 'near' ELSE 'state' END, v_n, round(v_low)::integer, round(v_high)::integer;
        RETURN;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT 'typical'::text, NULL::integer, t.low_dollars, t.high_dollars FROM public.fair_price_typical(p_category) t;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_fair_price_hint(text, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fair_price_hint(text, double precision, double precision) TO anon, authenticated, service_role;

-- Retire board 190's hidden switch and its RPC (no caller after this change: PriceGuidance.tsx reads the hint above).
DROP FUNCTION IF EXISTS public.get_price_guidance(text);
DELETE FROM public.feature_switches WHERE key = 'price_guidance';
