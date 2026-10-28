-- "Buy 2+, get N% off" is advertised only where it can apply (deep audit 2026-10-28, #36; owner rule Q2427).
--
-- WHAT WAS WRONG: the item page and cards show the seller's "Buy 2+, get N% off" on every item of a seller with
-- a rule, but checkout never takes an item below its private lowest price (declutter_item_private.
-- floor_price_cents) or below $1 (declutter_bundle_targets, 20261027211754). On an item whose price already IS
-- its lowest price, the advertised discount cannot apply. The floor is private, so the client cannot tell.
--
-- WHAT THIS ADDS: declutter_bundle_applies(p_item_ids uuid[]) -> uuid[]. A member read (signed in, Declutter
-- switch on): of the ids asked about, the LIVE items whose current price is above the lowest price checkout
-- would let the discount reach (GREATEST($1, the item's floor), the exact bound declutter_bundle_targets uses).
-- It returns ids only, never a price or a floor; an id that is not a live item, or is hidden from the caller as
-- a test listing (seed_hidden_for), is left out. At most 200 ids per call (invalid_request above that).
-- REPLAY-SAFETY: CREATE OR REPLACE. Proof: src/test/pglite/declutterBundleApplies.pglite.mjs. Guard: src/test/declutterBundleApplies.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_bundle_applies(p_item_ids uuid[])
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN '{}'::uuid[];
  END IF;
  IF cardinality(p_item_ids) > 200 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023', HINT = 'Ask about at most 200 items at a time.';
  END IF;
  RETURN COALESCE((
    SELECT array_agg(i.id ORDER BY i.id)
      FROM public.declutter_items i
      LEFT JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.id = ANY (p_item_ids)
       AND i.status = 'live'
       AND NOT (i.is_seed AND public.seed_hidden_for(v_uid))
       AND i.current_price_cents > GREATEST(100, COALESCE(p.floor_price_cents, 100))
  ), '{}'::uuid[]);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bundle_applies(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_bundle_applies(uuid[]) TO authenticated, service_role;
