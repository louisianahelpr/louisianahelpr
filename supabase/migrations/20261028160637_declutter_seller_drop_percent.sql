-- Declutter: the seller picks their nightly price-drop percentage (owner
-- 2026-10-28: "they should be able to choose their price drop percentage").
--
-- What was fixed before: every offers-mode listing dropped exactly 5% each
-- evening (declutter_price_drop_sweep: floor(current * 0.95)), never below the
-- seller's lowest price. The lowest price ("Lowest you'll take") was already
-- the seller's own; only the step was fixed.
--
-- What this adds:
--   1. declutter_items.drop_pct: 0 (off), 5, 10, 15 or 20; default 5, so every
--      listing that exists today keeps exactly the rule it had. It sits on
--      the PUBLIC row (not declutter_item_private) on purpose: the item page,
--      Browse's "May drop tonight" tag and the "What next" sheet say "could
--      drop as low as $X", and must compute it with the real step (the truth
--      rule, src/lib/declutter/priceDrop.ts). The floor and the hidden stop
--      stay private.
--   2. declutter_set_drop_pct(item, pct): the seller's own draft, live or
--      paused listing only; refuses any other value (invalid_drop_pct). The
--      CHECK constraint refuses it too, whoever writes the row.
--   3. declutter_price_drop_sweep() (newest body from 20261027205327, changed
--      only where marked): the step is current * (100 - drop_pct) / 100, down
--      to a whole dollar (the lead's 2026-10-28 walkthrough saw drops land on
--      $18.05 and $17.14), and a listing at 0 is skipped. Never below the
--      floor or the stop, as before.
--
-- MONEY: this changes how far a price falls each evening, never what anyone
-- is charged at checkout (checkout reads current_price_cents as before).
--
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, constraint dropped then added,
-- CREATE OR REPLACE, REVOKE/GRANT. Applied 3x in PGlite
-- (src/test/pglite/declutterSellerDropPercent.pglite.mjs).

ALTER TABLE public.declutter_items ADD COLUMN IF NOT EXISTS drop_pct smallint NOT NULL DEFAULT 5;
ALTER TABLE public.declutter_items DROP CONSTRAINT IF EXISTS declutter_items_drop_pct_check;
ALTER TABLE public.declutter_items ADD CONSTRAINT declutter_items_drop_pct_check CHECK (drop_pct IN (0, 5, 10, 15, 20));
COMMENT ON COLUMN public.declutter_items.drop_pct IS
  'Owner 2026-10-28: the seller''s nightly price drop, percent (0 = off). Set only by declutter_set_drop_pct; read by declutter_price_drop_sweep.';

CREATE OR REPLACE FUNCTION public.declutter_set_drop_pct(p_item_id uuid, p_pct integer)
RETURNS integer
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
  IF p_pct IS NULL OR p_pct NOT IN (0, 5, 10, 15, 20) THEN
    RAISE EXCEPTION 'invalid_drop_pct' USING ERRCODE = '22023', HINT = 'Price drops are off, 5, 10, 15 or 20 percent.';
  END IF;

  SELECT i.status INTO v_status FROM public.declutter_items i
   WHERE i.id = p_item_id AND i.seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('draft', 'live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;

  UPDATE public.declutter_items SET drop_pct = p_pct, updated_at = now()
   WHERE id = p_item_id AND seller_id = v_uid;
  RETURN p_pct;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_drop_pct(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_drop_pct(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_price_drop_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_n integer := 0;
  r record;
BEGIN
  -- Q2430: day 12, the seller's "make it free" (one last chance before the 14-day haul-away).
  v_n := v_n + public.declutter_auto_free_due();
  FOR r IN
    UPDATE public.declutter_items i
       -- Never below the stop point, which is always above the floor (B42).
       -- 2026-10-28: the seller's own step (drop_pct), not a fixed 5%, and down to a WHOLE dollar
       -- ($38 at 5% is $36, never $36.10).
       SET current_price_cents = greatest(p.floor_price_cents, COALESCE(p.drop_stop_cents, p.floor_price_cents),
                                          (floor(i.current_price_cents * (100 - i.drop_pct) / 10000.0) * 100)::integer),
           last_price_drop_on = v_today,
           price_dropped_at = now(),
           updated_at = now()
      FROM public.declutter_item_private p
     WHERE p.item_id = i.id
       AND i.status = 'live'
       AND i.sale_mode = 'offers'
       AND i.drop_pct > 0
       AND i.live_at IS NOT NULL AND i.live_at <= now() - interval '12 hours'
       AND i.current_price_cents > greatest(p.floor_price_cents, COALESCE(p.drop_stop_cents, p.floor_price_cents))
       AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today)
    RETURNING i.id, i.title, i.current_price_cents, i.is_seed
  LOOP
    -- Q2429: the watchers' "price dropped" notice is sent by trg_declutter_items_price_drop_alert
    -- (every path that lowers a price, rate-limited), no longer from here.
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_price_drop_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_drop_sweep() TO service_role;
