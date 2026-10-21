-- Board 190 (price guidance from real jobs; MASTER-LIST: hidden until ~30 real completed jobs).
-- Builder 2f, 2026-10-21.
--
-- get_price_guidance(category): what most REAL completed jobs in this category paid in the last 90 days,
-- statewide (the fan-out is statewide; no town is claimed). Returns the sample size and the middle half
-- (25th to 75th percentile of the job price, whole dollars) ONLY when at least 30 jobs from at least 3
-- different posters back it; below that ALL THREE are NULL (the count too, so polling it never reveals when
-- one job in a thin category completed), a thin sample never prints a number (truth rule) and no single
-- job's price can be read back from it. Measured 2026-10-21: 1 real completed job on prod, so every category reads "not enough".
--
-- Real means: not is_seed; neither the poster nor the Helpr is a test account (public.test_accounts) or an
-- is_seed profile; not a crew job (its budget is the whole crew's, not one job's price).
--
-- Authz: SECURITY DEFINER (members cannot read other people's completed jobs). Aggregates only: no id, name,
-- place or single price. Any signed-in member may ask (pricing their own post); anon cannot. Behind the
-- hidden switch 'price_guidance' (testers): require_feature first. Revoked from PUBLIC, anon.
-- Replay-safe: ON CONFLICT DO NOTHING; CREATE OR REPLACE.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('price_guidance', 'testers', 'Board 190: what most real completed jobs in a category paid (shown only with 30+ jobs)')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_price_guidance(p_category text)
RETURNS TABLE(sample_count integer, low_dollars integer, high_dollars integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer;
  v_low numeric;
  v_high numeric;
  v_posters integer;
BEGIN
  PERFORM public.require_feature('price_guidance');
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  SELECT count(*)::integer,
         count(DISTINCT j.customer_id)::integer,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY j.budget),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY j.budget)
    INTO v_n, v_posters, v_low, v_high
    FROM public.jobs j
   WHERE j.status = 'completed'
     AND j.category::text = p_category
     AND j.completed_at > now() - interval '90 days'
     AND coalesce(j.is_seed, false) = false
     AND coalesce(j.is_group_job, false) = false
     AND j.budget > 0
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (j.customer_id, j.helper_id))
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id IN (j.customer_id, j.helper_id) AND coalesce(p.is_seed, false));
  IF v_n < 30 OR v_posters < 3 THEN
    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::integer;
  ELSE
    RETURN QUERY SELECT v_n, round(v_low)::integer, round(v_high)::integer;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_price_guidance(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_price_guidance(text) TO authenticated, service_role;
