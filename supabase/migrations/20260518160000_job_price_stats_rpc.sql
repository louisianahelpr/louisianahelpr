-- Smart Pricing Guidance — category price stats from real completed jobs.
--
-- Posters guess at budgets and often price below what actually fills.
-- get_category_price_stats() reads the budget distribution of *completed*
-- jobs in a category (optionally narrowed to a parish) so the post form
-- can show a "jobs like this near you pay $X–$Y" hint grounded in real
-- outcomes, not a hand-maintained static table.
--
-- Why SECURITY DEFINER: jobs RLS only exposes a poster their own rows and
-- helprs the jobs they touch. A cross-job aggregate would otherwise be
-- impossible for an authenticated poster to read. The function returns
-- only anonymous aggregate numbers (percentiles + a count) — never any
-- individual job, customer, or helper — so it leaks nothing identifiable.
--
-- Parish fallback: a fresh parish may have only a job or two completed.
-- Reporting a "range" off a sample of 1 is noise, so when the parish
-- sample is below MIN_PARISH_SAMPLE (5) the function falls back to the
-- category-wide distribution and reports parish_match = false, letting
-- the UI phrase the hint honestly ("across Louisiana" vs "near you").

CREATE OR REPLACE FUNCTION public.get_category_price_stats(
  p_category text,
  p_parish text DEFAULT NULL
)
RETURNS TABLE (
  p25 numeric,
  p50 numeric,
  p75 numeric,
  sample_count integer,
  parish_match boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Below this many completed jobs a parish-scoped range is statistical
  -- noise — fall back to the category-wide distribution instead.
  c_min_parish_sample CONSTANT integer := 5;
  v_parish_count integer := 0;
  v_use_parish boolean := false;
BEGIN
  -- Guard: a category is required. No category => no meaningful answer.
  IF p_category IS NULL OR btrim(p_category) = '' THEN
    RETURN;
  END IF;

  -- Decide whether the parish sample is large enough to trust. Only
  -- bother counting when a parish was actually supplied.
  IF p_parish IS NOT NULL AND btrim(p_parish) <> '' THEN
    SELECT count(*)
      INTO v_parish_count
    FROM public.jobs j
    WHERE j.status = 'completed'
      AND j.category = p_category::public.job_category
      AND j.parish = p_parish
      AND j.budget IS NOT NULL;

    v_use_parish := v_parish_count >= c_min_parish_sample;
  END IF;

  RETURN QUERY
  SELECT
    percentile_cont(0.25) WITHIN GROUP (ORDER BY j.budget)::numeric AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY j.budget)::numeric AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY j.budget)::numeric AS p75,
    count(*)::integer AS sample_count,
    v_use_parish AS parish_match
  FROM public.jobs j
  WHERE j.status = 'completed'
    AND j.category = p_category::public.job_category
    AND j.budget IS NOT NULL
    -- When the parish sample cleared the threshold, scope to it;
    -- otherwise this predicate is always-true and we aggregate the
    -- whole category.
    AND (NOT v_use_parish OR j.parish = p_parish)
  -- Suppress the row entirely when there is no data at all, so the
  -- client gets an empty result (=> render nothing) rather than a row
  -- of NULL percentiles.
  HAVING count(*) > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_category_price_stats(text, text) TO authenticated;
