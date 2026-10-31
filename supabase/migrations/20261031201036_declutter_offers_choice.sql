-- LEAD-OFFERS-CHOICE (owner, 2026-10-31): sellers choose offers or Buy now only in more places.
--
--   (a) declutter_seller_defaults.accepts_offers: the seller's "Accept offers" default for a NEW listing (on, as
--       declutter_items.accepts_offers defaults). The row is the seller's own under the existing own-row policies and
--       ban gate (20261030144112, 20261030224733); export_my_data already exports the whole row (to_jsonb).
--   (b) declutter_set_offer_rules also takes a DRAFT, so the one-item form and Sell a bunch record the choice before
--       the item goes up (it took only live and paused). Restated from its newest CREATE, 20261029162620; the only
--       change is the status list.
--
-- Proof: src/test/pglite/declutterOffersChoice.pglite.mjs (NEW_MIGRATION=skip is red).

ALTER TABLE public.declutter_seller_defaults ADD COLUMN IF NOT EXISTS accepts_offers boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.declutter_set_offer_rules(p_item_id uuid, p_accepts_offers boolean, p_auto_offers boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_accepts_offers IS NULL OR p_auto_offers IS NULL THEN
    RAISE EXCEPTION 'invalid_offer_rules' USING ERRCODE = '22023';
  END IF;
  SELECT i.status INTO v_status FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- LEAD-OFFERS-CHOICE: a draft too, so the sell form and Sell a bunch set it before the item goes up.
  IF v_status NOT IN ('draft', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_items SET accepts_offers = p_accepts_offers, updated_at = now() WHERE id = p_item_id;
  -- Auto answers only while offers are taken.
  UPDATE public.declutter_item_private SET auto_offers = (p_accepts_offers AND p_auto_offers), updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_offer_rules(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_offer_rules(uuid, boolean, boolean) TO authenticated, service_role;
