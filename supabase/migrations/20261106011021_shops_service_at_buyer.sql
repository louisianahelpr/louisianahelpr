-- Shops H8 follow-up (b) (lead 11-05, after H8's lh-money-escrow review; must land before Shops leaves testers):
-- carpet or furniture cleaning done AT THE BUYER'S PLACE is taxed where the work is done (lead 11-05: Louisiana sources
-- a taxable service where it is performed), so H6's single calculation at the shop's pickup address is wrong for it. Shops stays behind its switch (testers).
-- Before: every shop order was taxed at the shop's private pickup address (shop-checkout, H6).
-- What this adds:
--   1. shop_items.at_buyer: the shop's answer to "Where do you do this work?" for a fabric_cleaning item only (any
--      other type reads as false, so a later type change can never leave a stale answer).
--   2. shop_order_lines.at_buyer: frozen on the line by the H8 snapshot trigger (restated), like tax_kind.
--   3. One address per calculation: an order holding an at-the-buyer's-place line holds only that line (an AFTER
--      INSERT trigger on the lines refuses the order: service_at_buyer_alone).
--   4. shop_order_service_addresses: the buyer's service address for that order (Louisiana only), written only by
--      shop-checkout (service role). PERSONAL DATA: buyer_id ON DELETE CASCADE, so account deletion purges it; no member
--      grant; never in a list. Its Download My Data section is owed with the shops export (dataExportInventory EXEMPT).
--   5. shops_set_item_at_buyer(item, at_buyer): the owner sets the answer.
--   6. shops_order_service_address(order): ONE order's address. The buyer reads their own; the shop reads it only after
--      it accepted the order (accepted or handed_over: the same reveal rule as Declutter's pickup address).
--   7. shops_shop_items RESTATED (from 20261103061500, verbatim plus 'at_buyer'): the order sheet knows to ask.
-- shop-checkout figures the tax at the service address for such an order and sends Stripe only what the tax
-- calculation needs (line1, city, state, ZIP, country), never in metadata.
-- MONEY: yes (where the tax is figured; lh-money-escrow). AUTHZ: one table, two RPCs, one restated read (lh-authz-rls).
-- REPLAY-SAFE: ADD COLUMN / CREATE TABLE IF NOT EXISTS, DROP TRIGGER IF EXISTS, CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsServiceAtBuyer.pglite.mjs (3x; NEW_MIGRATION=skip red).

-- 1. The item's answer.
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS at_buyer boolean NOT NULL DEFAULT false;

-- 2. The line's frozen answer.
ALTER TABLE public.shop_order_lines ADD COLUMN IF NOT EXISTS at_buyer boolean NOT NULL DEFAULT false;
ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_at_buyer_fabric;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_at_buyer_fabric
  CHECK (NOT at_buyer OR tax_kind = 'fabric_cleaning');

-- RESTATED from 20261105235833 (verbatim plus at_buyer): the line keeps its item's answers from the moment it is written.
CREATE OR REPLACE FUNCTION public.shop_order_line_snapshot_tax_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.tax_kind := CASE WHEN NEW.kind = 'service' THEN
    (SELECT st.tax_kind FROM public.shop_items i JOIN public.shop_item_subtypes st ON st.slug = i.subtype
      WHERE i.id = NEW.item_id) END;
  -- H8 (b): done at the buyer's place, only for carpet or furniture cleaning.
  NEW.at_buyer := COALESCE(NEW.tax_kind = 'fabric_cleaning' AND
    (SELECT i.at_buyer FROM public.shop_items i WHERE i.id = NEW.item_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_line_snapshot_tax_kind() FROM PUBLIC, anon, authenticated;

-- 3. One address per calculation.
CREATE OR REPLACE FUNCTION public.shop_order_lines_at_buyer_alone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shop_order_lines l WHERE l.order_id = NEW.order_id AND l.at_buyer)
     AND (SELECT count(*) FROM public.shop_order_lines l WHERE l.order_id = NEW.order_id) > 1 THEN
    RAISE EXCEPTION 'service_at_buyer_alone' USING ERRCODE = '22023',
      HINT = 'Work done at your place is ordered on its own.';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_lines_at_buyer_alone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS shop_order_lines_at_buyer_alone ON public.shop_order_lines;
CREATE TRIGGER shop_order_lines_at_buyer_alone AFTER INSERT ON public.shop_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.shop_order_lines_at_buyer_alone();

-- 4. The buyer's service address (personal data).
CREATE TABLE IF NOT EXISTS public.shop_order_service_addresses (
  order_id uuid PRIMARY KEY REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  -- Account deletion purges the address with the account (never anonymised: it is the buyer's home).
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  line1 text NOT NULL CHECK (char_length(btrim(line1)) BETWEEN 3 AND 120),
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 2 AND 60),
  state text NOT NULL DEFAULT 'LA' CHECK (state = 'LA'),
  postal_code text NOT NULL CHECK (postal_code ~ '^7[01][0-9]{3}$'),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_order_service_addresses_buyer_idx ON public.shop_order_service_addresses (buyer_id);
ALTER TABLE public.shop_order_service_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_order_service_addresses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_order_service_addresses TO service_role;

-- Q807: writes from an unconfirmed email are refused on every public table (the gate's own statement trigger).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- 5. The owner's answer.
CREATE OR REPLACE FUNCTION public.shops_set_item_at_buyer(p_item_id uuid, p_at_buyer boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status NOT IN ('draft', 'pending_review', 'live') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_at_buyer IS NULL OR (p_at_buyer AND v_item.subtype IS DISTINCT FROM 'fabric_cleaning') THEN
    RAISE EXCEPTION 'at_buyer_not_allowed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_items SET at_buyer = p_at_buyer, updated_at = now() WHERE id = p_item_id;
  RETURN p_at_buyer;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_item_at_buyer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_item_at_buyer(uuid, boolean) TO authenticated, service_role;

-- 6. One order's service address: the buyer, or the shop once it accepted.
CREATE OR REPLACE FUNCTION public.shops_order_service_address(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.shop_orders%ROWTYPE;
  a public.shop_order_service_addresses%ROWTYPE;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.shop_orders WHERE id = p_order_id;
  -- The same answer for no order and an order that is not the caller's.
  IF o.id IS NULL OR (o.buyer_id IS DISTINCT FROM v_uid AND o.seller_id IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- The shop sees it only after it said yes.
  IF o.buyer_id IS DISTINCT FROM v_uid AND o.status NOT IN ('accepted', 'handed_over') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO a FROM public.shop_order_service_addresses WHERE order_id = o.id;
  IF a.order_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('line1', a.line1, 'city', a.city, 'state', a.state, 'postal_code', a.postal_code);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_order_service_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_order_service_address(uuid) TO authenticated, service_role;

-- 7. RESTATED from 20261103061500 (verbatim plus 'at_buyer').
CREATE OR REPLACE FUNCTION public.shops_shop_items(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_mine boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'PT404';
  END IF;
  v_mine := EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.owner_id = v_uid);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', i.id,
             'kind', i.kind,
             'subtype', i.subtype,
             'status', CASE WHEN v_mine THEN i.status ELSE 'live' END,
             'title', i.title,
             'description', i.description,
             'price_cents', i.price_cents,
             'lead_time_days', i.lead_time_days,
             'stock_count', i.stock_count,
             'home_kitchen', i.kind = 'home_food',
             -- H8 (b): done at the buyer's place (carpet or furniture cleaning only).
             'at_buyer', i.at_buyer AND i.subtype = 'fabric_cleaning',
             'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ph.id, 'storage_path', ph.storage_path, 'position', ph.position)
                                          ORDER BY ph.position)
                                   FROM public.shop_item_photos ph WHERE ph.item_id = i.id), '[]'::jsonb))
           ORDER BY i.live_at DESC NULLS FIRST, i.created_at DESC, i.id)
      FROM public.shop_items i
     WHERE i.shop_id = p_shop_id
       AND (CASE WHEN v_mine THEN i.status <> 'withdrawn'
                 -- D12: a shop that turned selling off shows visitors no items.
                 ELSE i.status = 'live' AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.offers_selling) END)), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_items(uuid) TO authenticated, service_role;
