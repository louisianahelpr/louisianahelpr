-- F360a (whole-app audit 2026-11-10; owner pop-up 11-11 ~2:10 PM): "Report a problem adds 'Refund me' vs 'Swap / fix it'
-- choice; refund rules unchanged." The buyer who reports says what would make it right; the seller sees it on the order.
--
-- What it is: one column on the problem row, buyer_wants ('refund' | 'swap_fix', NULL when not said), and one setter,
-- declutter_problem_set_wants, that only the BUYER who reported an OPEN problem may call. It is words for the two
-- sides and the admin to read: no refund, payout, decision, strike or clock reads it, and no amount changes.
--
-- Read: authenticated gets SELECT on the new column only; the existing RLS policy ("the two sides and admins read",
-- 20261015042253) already limits the rows to the order's buyer, seller and admins. No UPDATE grant: the setter is the
-- one way in. Replay-safe: IF NOT EXISTS, a named CHECK added once, CREATE OR REPLACE, grants restated.

ALTER TABLE public.declutter_problems ADD COLUMN IF NOT EXISTS buyer_wants text;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_problems_buyer_wants_check'
                   AND conrelid = 'public.declutter_problems'::regclass) THEN
    ALTER TABLE public.declutter_problems
      ADD CONSTRAINT declutter_problems_buyer_wants_check CHECK (buyer_wants IS NULL OR buyer_wants IN ('refund', 'swap_fix'));
  END IF;
END
$do$;

GRANT SELECT (buyer_wants) ON TABLE public.declutter_problems TO authenticated;

CREATE OR REPLACE FUNCTION public.declutter_problem_set_wants(p_problem_id uuid, p_wants text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_wants IS NULL OR p_wants NOT IN ('refund', 'swap_fix') THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  -- Not found, not the caller's own report, or not the buyer's: the same answer, so nobody learns a problem exists.
  IF NOT FOUND OR p.reporter_id IS DISTINCT FROM v_uid OR p.reporter_side <> 'buyer' THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_not_open' USING ERRCODE = '55000';
  END IF;
  -- Item reports only (the form asks only for these): a no-show, a delivery that never came or a safety report has no swap.
  IF p.reason NOT IN ('damaged', 'not_as_described', 'other') THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_problems SET buyer_wants = p_wants WHERE id = p.id;
  RETURN p_wants;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_problem_set_wants(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_problem_set_wants(uuid, text) TO authenticated, service_role;
