-- The landing teaser is the only browse surface that ignores BOTH the funding
-- gate and the seed-jobs flag. Two predicates, one function.
--
-- 1. PAYMENT. Every other browse surface requires the escrow to actually be
--    funded -- `open_jobs_browse`, `get_ranked_open_jobs` and
--    `get_open_jobs_for_map` all carry
--      payment_status = ANY (ARRAY['escrow','payout_pending','released'])
--    `get_public_open_jobs` carried no payment predicate at all, so the public
--    marketing page could advertise a job whose escrow was never funded --
--    a job that vanishes the moment the visitor signs in, because no
--    signed-in surface shows it. Measured before the change: 4 of 14
--    landing-eligible jobs were unfunded.
--
-- 2. SEED. This is the one that would have bitten on launch day, and it is why
--    this migration is not simply the payment gate.
--
--    Seed/demo jobs are gated everywhere else by
--      (NOT is_seed OR NOT seed_jobs_hidden_publicly())
--    -- a deliberate switch: while `seed_jobs_hidden_publicly()` is FALSE the
--    demo content is visible on purpose, and flipping it to TRUE at launch
--    hides it. `get_public_open_jobs` never referenced `is_seed` at all, so it
--    does not participate in that switch.
--
--    Verified against prod at the time of writing: seed_jobs_hidden_publicly()
--    = false, real (non-seed) open jobs = 0, and all 14 landing-eligible rows
--    were seed jobs. So nothing is wrong TODAY -- the demo content is showing
--    because it is supposed to. The defect is what happens next: flip the flag
--    to launch, and the dashboard, /jobs and the map all go quiet while the
--    marketing landing page carries on advertising test jobs to the public,
--    with no way to turn it off short of deleting the rows.
--
--    That is a launch-day failure that would look like a content problem and
--    actually be a missing predicate, which is the worst kind to debug under
--    time pressure.
--
-- Everything else in this function is reproduced verbatim from the definition
-- as of 20260902161042 (which added the ownership predicate). The only changes
-- are the two AND clauses marked below.
--
-- REPLAY-SAFE: CREATE OR REPLACE FUNCTION, no dependency on rows or prior state.
-- SECURITY DEFINER and `SET search_path TO 'public'` are restated explicitly
-- rather than relied upon to carry over -- losing the search_path pin on a
-- SECURITY DEFINER function is a privilege-escalation bug, not a style slip.
-- Grants are NOT re-issued: they survive CREATE OR REPLACE.

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
    -- NEW (1): funding. Mirrors open_jobs_browse / get_ranked_open_jobs /
    -- get_open_jobs_for_map. An unfunded job is not workable, so advertising
    -- it on the public page promises something the app will not honour.
    AND j.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    -- NEW (2): the seed switch. Same expression the other three surfaces use,
    -- so the landing page now goes quiet with them when the flag is flipped
    -- at launch instead of being the one place demo jobs survive.
    AND (NOT j.is_seed OR NOT public.seed_jobs_hidden_publicly())
    AND j.date_needed >= CURRENT_DATE
    AND (j.offered_to_helper_id IS NULL OR j.direct_offer_status <> 'pending')
  ORDER BY
    (j.boost_expires_at IS NOT NULL AND j.boost_expires_at > now()) DESC,
    j.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 6), 1);
$function$;

COMMENT ON FUNCTION public.get_public_open_jobs(integer) IS
  'Landing-page teaser. Anon-executable. Now carries the same four gates as '
  'every other browse surface: open status, a non-null owner, funded escrow, '
  'and the seed switch (NOT is_seed OR NOT seed_jobs_hidden_publicly()). '
  'Before 20260902163216 it had neither the funding nor the seed gate, so it '
  'would have kept advertising demo jobs to the public after the launch flag '
  'was flipped.';
