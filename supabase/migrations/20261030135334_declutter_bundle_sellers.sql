-- D-NEW12 (lead decision 2026-10-30 05:00Z): Browse cards wear one small "Bundle deal" chip when the item's seller has
-- a bundle discount on ("Buy 2+, get N% off", Q2427, 20261027211754). The only read of a rule was
-- declutter_bundle_rule(seller), one seller per call; a Browse page shows up to dozens of sellers. This adds ONE read
-- for a page of sellers: which of them have a rule. It says nothing a member could not already learn one seller at
-- a time from declutter_bundle_rule (same callers: members, while Declutter is on), and returns only seller ids the
-- caller passed in, never a percent or any other seller.
--
-- New function, nothing restated. declutter_bundle_rules on prod (2026-10-30): seller_id uuid, percent smallint,
-- updated_at timestamptz (information_schema); declutter_bundle_rule's prod md5 54e9b14d97743a8951451a21c78dbd3a is
-- 20261027211754's body, which this mirrors (require_feature first, then the read).
--
-- REPLAY-SAFETY: CREATE OR REPLACE; grants restated.
CREATE OR REPLACE FUNCTION public.declutter_bundle_sellers(p_seller_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  IF p_seller_ids IS NULL OR cardinality(p_seller_ids) = 0 THEN
    RETURN '{}'::uuid[];
  END IF;
  IF cardinality(p_seller_ids) > 200 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023', HINT = 'Ask about at most 200 sellers at a time.';
  END IF;
  RETURN COALESCE((
    SELECT array_agg(DISTINCT r.seller_id ORDER BY r.seller_id)
      FROM public.declutter_bundle_rules r
     WHERE r.seller_id = ANY (p_seller_ids)
  ), '{}'::uuid[]);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bundle_sellers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_bundle_sellers(uuid[]) TO authenticated, service_role;
