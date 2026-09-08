-- is_seed: derive it from the ACCOUNT instead of hard-setting it false.
--
-- WHY: the Post-a-Job budget hint on prod read
--   "Jobs like this pay $25–$25 (most around $25) · Based on 15 completed jobs"
-- and every one of those 15 was an `[E2E DO NOT ACCEPT]` row from the nightly
-- money loop, posted by helpr-e2e-poster-0902@mailinator.com. Test rows were
-- steering real pricing guidance.
--
-- The root cause is a design gap, not the RPC. `is_seed` (20260825184500) was
-- built so fixture ACCOUNTS and their jobs stay out of aggregates, but:
--   (a) the backfill was ONE-TIME. The two 0902 e2e profiles were created
--       afterwards and sat at is_seed = false, dragging 57 e2e jobs with them.
--   (b) `enforce_jobs_insert_column_lock` hard-set `NEW.is_seed := false` on
--       every poster INSERT, so a seed account's own job could NEVER be seed.
--       The lock was right to ignore the client and wrong to answer `false`.
--   (c) `get_category_price_stats` never looked at `is_seed` at all.
--
-- Fix all three. The flag stays unforgeable — it is still derived server-side
-- and still ignores whatever the client sent — it just tells the truth now:
-- a job is fixture data iff the account that posted it is fixture data.
-- `profiles.is_seed` itself remains locked by `prevent_self_escalation`, so
-- there is no path for a user to make themselves (and thus their jobs) seed.
--
-- NOT CHANGED, deliberately: `enforce_poster_jobs_money_lock.locked_always`
-- still contains 'is_seed', so a poster can never mutate the flag on an
-- existing row. And the HELPER-side lock is left alone: when a seed helper is
-- hired onto a REAL poster's job, that job is a real job and must keep
-- counting. Seed-ness follows the poster, which is who the aggregate is about.
-- (The 20260825184500 backfill also OR'd on helper_id; that is kept below for
-- the backfill only, to match the historical predicate exactly.)

-- ── 1. Derive the flag on INSERT ──────────────────────────────────────────
-- Body is the DEPLOYED function verbatim (pg_get_functiondef on prod,
-- 2026-09-08) with exactly one statement changed: the `NEW.is_seed` line.
CREATE OR REPLACE FUNCTION public.enforce_jobs_insert_column_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role (uid NULL) and anyone not inserting their own job pass
  -- through untouched. Same gate as the UPDATE money lock.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM NEW.customer_id THEN
    RETURN NEW;
  END IF;

  -- Escrow state is the webhook's to set, never the poster's.
  NEW.payment_status           := 'unpaid';
  NEW.stripe_payment_intent_id := NULL;
  NEW.stripe_session_id        := NULL;

  -- Paid placement is create-boost-payment's to grant.
  NEW.boosted_at               := NULL;
  NEW.boost_expires_at         := NULL;

  -- Fixture flag: still not the poster's to set — whatever they sent is
  -- discarded — but the answer is now DERIVED from the posting account
  -- rather than hardcoded false. A fixture account's jobs are fixture jobs;
  -- a real account's jobs cannot be hidden, because profiles.is_seed is
  -- itself locked by prevent_self_escalation.
  NEW.is_seed                  := EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = NEW.customer_id
       AND p.is_seed
  );

  -- A new job is open and unassigned. Assignment happens on UPDATE, through
  -- accept_application / the direct-offer flow; a direct offer at post time
  -- uses offered_to_helper_id, which is deliberately left writable.
  NEW.status                   := 'open';
  NEW.helper_id                := NULL;

  -- A brand-new job has lived through none of its own lifecycle. Every one
  -- of these can only be set legitimately by the corresponding server-side
  -- action AFTER a helper is actually hired (accept_application,
  -- mark_helper_arrival, the on-my-way/arrived RPCs, the completion RPCs) —
  -- none of that can have happened yet to a row that does not exist until
  -- this statement returns.
  NEW.helper_confirmed_at         := NULL;
  NEW.helper_on_the_way_at        := NULL;
  NEW.helper_arrived_at           := NULL;
  NEW.helper_arrival_verified_at  := NULL;
  NEW.poster_confirmed_at         := NULL;
  NEW.helper_completed_at         := NULL;
  NEW.poster_completed_at         := NULL;
  NEW.payout_scheduled_at         := NULL;

  RETURN NEW;
END;
$$;

-- ── 2. Re-run the backfill, idempotently ──────────────────────────────────
-- Same three email predicates as 20260825184500, re-applied because accounts
-- created since that migration were never swept. Guarded on `is_seed = false`
-- so a replay is a no-op.
UPDATE public.profiles
   SET is_seed = true
 WHERE is_seed = false
   AND (email ILIKE '%@mailinator.com'
     OR email ILIKE '%@helpr.test'
     OR email ILIKE 'eli.test.%');

-- COALESCE for the same reason the original migration documents: `col IN
-- (subquery)` yields NULL (not false) on a NULL column, and an unassigned or
-- anonymised job would otherwise fall out of the predicate silently.
UPDATE public.jobs j
   SET is_seed = true
 WHERE j.is_seed = false
   AND (
        COALESCE(j.customer_id IN (SELECT user_id FROM public.profiles WHERE is_seed), false)
     OR COALESCE(j.helper_id   IN (SELECT user_id FROM public.profiles WHERE is_seed), false)
   );

COMMENT ON COLUMN public.jobs.is_seed IS
  'Fixture/demo/audit row. Excluded from admin aggregates and from the '
  'Post-a-Job price hint. Never set by a client — derived from the posting '
  'account by enforce_jobs_insert_column_lock, locked on UPDATE by '
  'enforce_poster_jobs_money_lock.locked_always.';

-- ── 3. Keep fixture jobs out of the price hint ────────────────────────────
-- Body is the deployed function verbatim plus `AND NOT j.is_seed` in BOTH
-- queries — the parish-sample count and the aggregate. Missing either one
-- would let fixtures decide whether the parish sample "cleared the threshold"
-- while the numbers came from somewhere else.
-- CREATE OR REPLACE preserves the EXECUTE grants re-granted in 20260907034811.
CREATE OR REPLACE FUNCTION public.get_category_price_stats(p_category text, p_parish text DEFAULT NULL::text)
RETURNS TABLE(p25 numeric, p50 numeric, p75 numeric, sample_count integer, parish_match boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
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
      AND j.budget IS NOT NULL
      AND NOT j.is_seed;

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
    -- Fixture rows must never price a real job. This is the whole point of
    -- the migration: 15 of the 16 completed `cleaning` jobs on prod were
    -- nightly-money-loop rows all budgeted at exactly $25, which rendered as
    -- "Jobs like this pay $25–$25 · Based on 15 completed jobs".
    AND NOT j.is_seed
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
