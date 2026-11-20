-- Declutter top 5, #5 (owner 11-19, "Do all 5", after the Vinted/Depop audit): BULK ACTIONS + AWAY MODE.
--
-- Bulk actions: on Selling the seller ticks several listings, then Discount / Pause / Put back on sale / Mark sold.
-- Pause, put back and mark sold are the existing one-listing RPCs called once per listing by the app (each keeps its own
-- checks and notices). Discount is one call here:
--   declutter_bulk_discount(p_item_ids, p_percent_off) -> integer (how many prices changed). The seller's own live or
--   paused listings of $2 or more, at most 100 at once, 5 to 50% off; the new price is the "Change price" rule
--   (declutter_set_listing_price): at least $1, never below the seller's lowest price (floor_price_cents), never above
--   the listed price (it only lowers). A listing it cannot lower is skipped, never refused. MONEY: none moves; a lower
--   price fires the existing price-drop notice to watchers.
--
-- Away mode: "Away until [date]". Every live listing pauses (declutter_pause_listing, so open offers close with their
-- notices, exactly as Pause), the seller's public page says "Away until Mon, Nov 30", and on that date the listings it
-- paused come back by themselves (or at once with "I'm back").
--   declutter_seller_away        one row per away seller: back_on (a Louisiana date), the listings it paused. Seller
--                                reads own; nothing else writes it.
--   declutter_go_away(p_back_on) -> integer (listings paused). Tomorrow to 90 days out. Again while away: moves the date
--                                and pauses anything listed since.
--   declutter_come_back()        -> integer (listings back on sale).
--   declutter_away_return(seller) the shared return step: each listing the away paused that is still paused goes live
--                                again with Relist's own check (a pickup time on file; a seller out of Declutter stays
--                                paused); one that cannot is left paused for the seller and logged. Service role only.
--   declutter_away_sweep()       hourly (cron declutter-away-return): returns every seller whose back_on has come.
--   declutter_seller_away_until(p_seller_id) -> date: the public page's "Away until" line; NULL when not away. Anyone
--                                who can open a profile (anon too); only a date, nothing else.
-- Review 11-19 #3: bulk % off and Change price refuse to LOWER a listing in a running shop sale (sale_running, "End your
-- sale to change prices."); the sale's own put-back stays exact. No feature switch (owner: ship on for everyone).
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE, cron.schedule by name (replaces),
-- ON CONFLICT. Proof: src/test/pglite/declutterBulkAndAway.pglite.mjs (applied 3x; NEW_MIGRATION=skip red).

-- ---------------------------------------------------------------------------
-- 1. Bulk discount.
CREATE OR REPLACE FUNCTION public.declutter_bulk_discount(p_item_ids uuid[], p_percent_off integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  r record;
  v_cents integer;
  v_n integer := 0;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_percent_off IS NULL OR p_percent_off < 5 OR p_percent_off > 50 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', HINT = 'Pick between 5% and 50% off.';
  END IF;
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 OR cardinality(p_item_ids) > 100 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', HINT = 'Pick 1 to 100 listings.';
  END IF;
  -- Review 11-19 #3: never on top of a running shop sale (the cut would stack on the sale price and stay after it).
  IF EXISTS (SELECT 1 FROM public.declutter_shop_sale_items x
               JOIN public.declutter_shop_sales s ON s.id = x.sale_id AND s.status = 'on'
               JOIN public.declutter_items i ON i.id = x.item_id AND i.seller_id = v_uid
              WHERE x.item_id = ANY (p_item_ids) AND x.restored_at IS NULL) THEN
    RAISE EXCEPTION 'sale_running' USING ERRCODE = '55000', HINT = 'End your sale to change prices.';
  END IF;
  FOR r IN
    SELECT i.id, i.current_price_cents, p.floor_price_cents
      FROM public.declutter_items i
      LEFT JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.id = ANY (p_item_ids)
       AND i.seller_id = v_uid
       AND i.status IN ('live', 'paused')
       AND i.current_price_cents >= 200
     ORDER BY i.id
     FOR UPDATE OF i
  LOOP
    v_cents := greatest(100, COALESCE(r.floor_price_cents, 100),
                        round(r.current_price_cents * (100 - p_percent_off) / 100.0)::integer);
    CONTINUE WHEN v_cents >= r.current_price_cents;
    UPDATE public.declutter_items SET current_price_cents = v_cents, updated_at = now() WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bulk_discount(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_bulk_discount(uuid[], integer) TO authenticated, service_role;

-- 1b. Review 11-19 #3: "Change price" may not LOWER a listing in a running shop sale either. Restated VERBATIM from
--     20261103173728 (its newest definition); the one change is marked CHANGED 20261120015456.
CREATE OR REPLACE FUNCTION public.declutter_set_listing_price(
  p_item_id uuid, p_price_cents integer, p_floor_price_cents integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_stopped boolean;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF v_item.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents < 100 OR p_price_cents > 100000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'The price must be between $1 and $1,000.';
  END IF;
  -- Never above the price it was listed at (authz review 2): raising then cutting
  -- would put a "was" price on the card the item was never really offered at.
  IF p_price_cents > v_item.price_cents THEN
    RAISE EXCEPTION 'price_above_listed'
      USING ERRCODE = '22023', HINT = 'You can lower the price, or raise it back up to the price you listed it at.';
  END IF;
  -- CHANGED 20261120015456 (review 11-19 #3): no lowering while the listing is in a running shop sale; the sale's price
  -- would stack and stay. Raising it (back toward the listed price) is still allowed and is kept after the sale.
  IF p_price_cents < v_item.current_price_cents AND EXISTS (
       SELECT 1 FROM public.declutter_shop_sale_items x
         JOIN public.declutter_shop_sales s ON s.id = x.sale_id AND s.status = 'on'
        WHERE x.item_id = p_item_id AND x.restored_at IS NULL) THEN
    RAISE EXCEPTION 'sale_running' USING ERRCODE = '55000', HINT = 'End your sale to change prices.';
  END IF;
  IF p_floor_price_cents IS NULL OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;

  SELECT p.drops_stopped INTO v_stopped FROM public.declutter_item_private p WHERE p.item_id = p_item_id;

  UPDATE public.declutter_items
     SET current_price_cents = p_price_cents,
         updated_at = now()
   WHERE id = p_item_id;

  -- A floor change re-picks the stop (trg_declutter_item_private_drop_stop).
  UPDATE public.declutter_item_private
     SET floor_price_cents = p_floor_price_cents, updated_at = now()
   WHERE item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- Prod CHECK declutter_item_private_stop_above_floor: stop > floor. A stop one
  -- cent above a price that sits at the floor still means "never drop" (the
  -- sweep drops only while current > greatest(floor, stop)). Money review 2.
  IF COALESCE(v_stopped, false) THEN
    UPDATE public.declutter_item_private
       SET drop_stop_cents = greatest(p_price_cents, p_floor_price_cents + 1), updated_at = now()
     WHERE item_id = p_item_id;
  END IF;
  RETURN p_price_cents;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_set_listing_price(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_listing_price(uuid, integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Away mode.
CREATE TABLE IF NOT EXISTS public.declutter_seller_away (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  back_on date NOT NULL,
  paused_item_ids uuid[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_seller_away_back_idx ON public.declutter_seller_away (back_on);
ALTER TABLE public.declutter_seller_away ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_seller_away FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_seller_away TO authenticated;
GRANT ALL ON TABLE public.declutter_seller_away TO service_role;
DROP POLICY IF EXISTS "declutter seller away: seller reads own" ON public.declutter_seller_away;
CREATE POLICY "declutter seller away: seller reads own" ON public.declutter_seller_away
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));
-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_seller_away IS
  'Declutter top 5 #5 (owner 11-19): a seller away until back_on, and the listings the away paused (they come back then).';

CREATE OR REPLACE FUNCTION public.declutter_go_away(p_back_on date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_ids uuid[] := '{}';
  r record;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Not the selling gate on purpose (as Pause): anyone may hide their own listings.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_back_on IS NULL OR p_back_on <= v_today OR p_back_on > v_today + 90 THEN
    RAISE EXCEPTION 'invalid_away_date' USING ERRCODE = '22023', HINT = 'Pick a day from tomorrow to 90 days out.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_away:' || v_uid::text));
  FOR r IN SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid AND i.status = 'live' ORDER BY i.id LOOP
    PERFORM public.declutter_pause_listing(r.id); -- Pause's own steps: open offers close, buyers told
    v_ids := v_ids || r.id;
  END LOOP;
  INSERT INTO public.declutter_seller_away AS a (seller_id, back_on, paused_item_ids)
  VALUES (v_uid, p_back_on, v_ids)
  ON CONFLICT (seller_id) DO UPDATE
    SET back_on = EXCLUDED.back_on,
        paused_item_ids = (SELECT array_agg(DISTINCT x) FROM unnest(a.paused_item_ids || EXCLUDED.paused_item_ids) x),
        updated_at = now();
  RETURN cardinality(v_ids);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_go_away(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_go_away(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_away_return(p_seller uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_away public.declutter_seller_away%ROWTYPE;
  v_ok boolean;
  v_id uuid;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_away FROM public.declutter_seller_away WHERE seller_id = p_seller FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- Relist's own checks (declutter_relist_listing): a pickup time on file; a seller out of Declutter stays paused.
  v_ok := EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = p_seller)
          AND NOT public.declutter_seller_out(p_seller);
  IF v_ok THEN
    FOREACH v_id IN ARRAY v_away.paused_item_ids LOOP
      BEGIN
        UPDATE public.declutter_items SET status = 'live', updated_at = now()
         WHERE id = v_id AND seller_id = p_seller AND status = 'paused';
        IF FOUND THEN
          v_n := v_n + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- One listing that cannot go back up (a list-time check) stays paused for the seller; the rest still return.
        PERFORM public.log_cron_defect('declutter_away_return', v_id::text,
          format('away return of listing %s failed: %s (%s)', v_id, SQLERRM, SQLSTATE));
      END;
    END LOOP;
  END IF;
  DELETE FROM public.declutter_seller_away WHERE seller_id = p_seller;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_away_return(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_away_return(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_come_back()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  -- The ban gate (banGateCoverage); a banned seller's away row ends by itself on its date.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_seller_away a WHERE a.seller_id = v_uid) THEN
    RAISE EXCEPTION 'not_away' USING ERRCODE = 'PT404', HINT = 'Your shop is already open.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_away:' || v_uid::text));
  RETURN public.declutter_away_return(v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_come_back() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_come_back() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_away_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  r record;
  v_sellers integer := 0;
  v_items integer := 0;
  v_errors integer := 0;
BEGIN
  FOR r IN SELECT a.seller_id FROM public.declutter_seller_away a WHERE a.back_on <= v_today ORDER BY a.back_on LIMIT 500 LOOP
    BEGIN
      v_items := v_items + public.declutter_away_return(r.seller_id);
      v_sellers := v_sellers + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_away_sweep', r.seller_id::text,
        format('away return for seller %s failed: %s (%s)', r.seller_id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  RETURN jsonb_build_object('sellers_back', v_sellers, 'listings_back', v_items, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_away_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_away_sweep() TO service_role;

-- Review 11-19 #7: the same visibility as the listings themselves (declutter_item_demand / the items policies): a guest
-- only while Declutter is open to guests; nobody across a block; nothing for a seller out of Declutter (hidden).
CREATE OR REPLACE FUNCTION public.declutter_seller_away_until(p_seller_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_hidden boolean;
BEGIN
  IF p_seller_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- A guest (no member: this is a READ for anon, never a trusted server write) sees it only while Declutter is open to
  -- guests; a member never across a block. Worked out as a value first, so no branch trusts a bare NULL uid.
  v_hidden := CASE
    WHEN v_uid IS NULL THEN NOT public.declutter_open_to_guests()
    ELSE v_uid <> p_seller_id
         AND p_seller_id = ANY (COALESCE((SELECT public.declutter_my_block_partners()), '{}'::uuid[]))
  END;
  IF v_hidden THEN
    RETURN NULL;
  END IF;
  IF v_uid IS DISTINCT FROM p_seller_id AND public.declutter_seller_out(p_seller_id) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT a.back_on FROM public.declutter_seller_away a WHERE a.seller_id = p_seller_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_away_until(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_away_until(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The cron: hourly, registered with the dead-cron monitor. Not daily, so no catch-up policy row (Q30): the next run
--    returns anyone a missed one would have.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-away-return', interval '3 hours',
            'Declutter away mode, hourly: puts an away seller''s paused listings back on sale on their return date.',
            'exempt',
            'While no away seller''s return date has come, a run that returns nobody is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-away-return', '10 * * * *',
      $c$SELECT public.cron_record_work('declutter-away-return', to_jsonb(public.declutter_away_sweep()));$c$);
  END IF;
END
$do$;
