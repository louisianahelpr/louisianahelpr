-- Declutter top 5, #4 (owner 11-19, "Do all 5", after the Vinted/Depop audit): SHOP-WIDE SALE. The seller sets "X% off
-- everything" for a date range. While it runs, every live priced listing's price IS the sale price (current_price_cents),
-- so Browse, the item page, offers, Buy and checkout all use it with no change of their own; cards and the item page
-- already strike through the listed price whenever the price is below it ("$20 -> $17"). It ends by itself: each
-- listing goes back to the price it had, unless the seller changed that listing's price during the sale.
--
-- MONEY: no money moves here. A price is lowered and later put back, exactly as the seller's own "Change price"
-- (declutter_set_listing_price) may: never above the listed price (price_cents), never below the seller's lowest price
-- (floor_price_cents) or $1. An item already reserved or sold keeps the price it was agreed at (its cart line).
--
-- Objects:
--   declutter_shop_sales        one row per sale (percent 5..50, starts_at, ends_at, status scheduled/on/ended/cancelled);
--                               at most one scheduled-or-on sale per seller (partial unique index). Seller reads own.
--   declutter_shop_sale_items   per listing: the price before and the sale price, and when it was put back. Seller reads own.
--   declutter_start_shop_sale(p_percent_off, p_starts_at, p_ends_at) -> uuid. Starts at once when p_starts_at <= now.
--                               Up to 14 days long, starting within 14 days.
--   declutter_end_shop_sale()   ends the running sale now (prices back) or cancels a scheduled one.
--   declutter_shop_sale_sweep() every 15 minutes (cron declutter-shop-sales): ends due sales, puts back what was waiting,
--                               THEN starts due sales and discounts listings that went live during a sale (review 11-19 #2).
--   trg_declutter_items_shop_sale_return / _price  a listing that comes back on sale after its sale ended gets its price
--                               back in the same write (review #1); any price change the sale did not make marks the row so
--                               the put-back leaves it alone (review #6). One open row per listing across sales (review #2).
--   declutter_item_demand       RESTATED (DROP + CREATE: two more columns) so the item page can say "15% off, sale ends
--                               Sun" from the read it already makes: sale_pct, sale_ends_at, only for a listing whose
--                               price right now is its sale price. Body otherwise verbatim from 20261120012729.
-- Lowering the price fires the existing price-drop notice to watchers (declutter_price_drop_alert, its own limits and
-- the Q137 seed rule), as any price cut does. No feature switch (owner: ship on for everyone).
-- REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE, DROP FUNCTION IF EXISTS
-- before the changed-signature restatement, cron.schedule by name (replaces), ON CONFLICT.
--   declutter_price_drop_sweep  RESTATED verbatim from 20261030154745 plus ONE condition: the nightly drop skips a listing
--                               that is in a running shop sale. Without it the drop would stack on the sale price (20%
--                               off, then 5% of that each night) and the end could no longer put back the exact price
--                               (a dropped price is no longer the sale price, so it would read as the seller's change).
--                               Drops resume the night after the sale ends, from the restored price.
-- Proof: src/test/pglite/declutterShopSale.pglite.mjs (applied 3x; NEW_MIGRATION=skip red).

-- ---------------------------------------------------------------------------
-- 1. Tables.
CREATE TABLE IF NOT EXISTS public.declutter_shop_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  percent_off smallint NOT NULL CHECK (percent_off BETWEEN 5 AND 50),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'on', 'ended', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  -- Review 11-19 #5: 2 hours of slack over 14 days, so a 14-day sale across a clock change is never refused.
  CONSTRAINT declutter_shop_sales_range CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '14 days 2 hours')
);
CREATE UNIQUE INDEX IF NOT EXISTS declutter_shop_sales_one_open
  ON public.declutter_shop_sales (seller_id) WHERE status IN ('scheduled', 'on');
CREATE INDEX IF NOT EXISTS declutter_shop_sales_due_idx ON public.declutter_shop_sales (status, starts_at, ends_at);
ALTER TABLE public.declutter_shop_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_shop_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_shop_sales TO authenticated;
GRANT ALL ON TABLE public.declutter_shop_sales TO service_role;
DROP POLICY IF EXISTS "declutter shop sales: seller reads own" ON public.declutter_shop_sales;
CREATE POLICY "declutter shop sales: seller reads own" ON public.declutter_shop_sales
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.declutter_shop_sale_items (
  sale_id uuid NOT NULL REFERENCES public.declutter_shop_sales(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  before_cents integer NOT NULL CHECK (before_cents BETWEEN 100 AND 100000),
  sale_cents integer NOT NULL CHECK (sale_cents BETWEEN 100 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  -- Review 11-19 #6: set when anything but the sale itself changed this listing's price while the row was open (the
  -- seller's Change price, a free-after-N-days, ...): the put-back then leaves that price alone, even when it happens to
  -- equal the sale price. Written by trg_declutter_items_shop_sale_price.
  seller_changed_at timestamptz,
  PRIMARY KEY (sale_id, item_id),
  CONSTRAINT declutter_shop_sale_items_lower CHECK (sale_cents < before_cents)
);
-- Review 11-19 #2: at most ONE open row per listing across every sale, so two sales can never stack on one price.
CREATE UNIQUE INDEX IF NOT EXISTS declutter_shop_sale_items_one_open ON public.declutter_shop_sale_items (item_id) WHERE restored_at IS NULL;
ALTER TABLE public.declutter_shop_sale_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_shop_sale_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_shop_sale_items TO authenticated;
GRANT ALL ON TABLE public.declutter_shop_sale_items TO service_role;
DROP POLICY IF EXISTS "declutter shop sale items: seller reads own" ON public.declutter_shop_sale_items;
CREATE POLICY "declutter shop sale items: seller reads own" ON public.declutter_shop_sale_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_shop_sales s WHERE s.id = sale_id AND s.seller_id = (SELECT auth.uid())));

-- Q807: refuse writes from a session whose email is unconfirmed (every public table).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
COMMENT ON TABLE public.declutter_shop_sales IS
  'Declutter top 5 #4 (owner 11-19): a seller''s shop-wide sale (X% off every live listing for a date range).';
COMMENT ON TABLE public.declutter_shop_sale_items IS
  'Declutter top 5 #4: each listing''s price before a shop sale and its sale price, so the sale can put it back.';

-- ---------------------------------------------------------------------------
-- 2. The price step, shared by start and sweep: discount every live priced listing of the sale's seller that has no
--    row for this sale AND no open row from any other sale (review 11-19 #2: a listing still waiting for an ended sale's
--    put-back is never discounted again on top; the unique index declutter_shop_sale_items_one_open backs this up).
--    The UPDATE only lands while the price is still the one read (a race with the seller's own change is skipped, never
--    overwritten). The price writes are marked as the sale's own (declutter.shop_sale_engine), so the price trigger
--    below does not take them for the seller's. Returns how many listings were discounted.
CREATE OR REPLACE FUNCTION public.declutter_shop_sale_apply(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_sale public.declutter_shop_sales%ROWTYPE;
  r record;
  v_cents integer;
  v_n integer := 0;
BEGIN
  SELECT * INTO v_sale FROM public.declutter_shop_sales WHERE id = p_sale_id AND status = 'on';
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  PERFORM set_config('declutter.shop_sale_engine', 'on', true);
  FOR r IN
    SELECT i.id, i.current_price_cents, p.floor_price_cents
      FROM public.declutter_items i
      LEFT JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.seller_id = v_sale.seller_id
       AND i.status = 'live'
       AND i.current_price_cents >= 200
       AND NOT EXISTS (SELECT 1 FROM public.declutter_shop_sale_items x
                        WHERE x.item_id = i.id AND (x.sale_id = p_sale_id OR x.restored_at IS NULL))
     ORDER BY i.id
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    v_cents := greatest(100, COALESCE(r.floor_price_cents, 100),
                        round(r.current_price_cents * (100 - v_sale.percent_off) / 100.0)::integer);
    CONTINUE WHEN v_cents >= r.current_price_cents;
    UPDATE public.declutter_items SET current_price_cents = v_cents, updated_at = now()
     WHERE id = r.id AND status = 'live' AND current_price_cents = r.current_price_cents;
    CONTINUE WHEN NOT FOUND;
    INSERT INTO public.declutter_shop_sale_items (sale_id, item_id, before_cents, sale_cents)
    VALUES (p_sale_id, r.id, r.current_price_cents, v_cents);
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('declutter.shop_sale_engine', '', true);
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_shop_sale_apply(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_shop_sale_apply(uuid) TO service_role;

-- 3. Put prices back: every row of the sale not yet put back (review 11-19 #1 and #6).
--    - the price was changed by anything but the sale (seller_changed_at): that price stays; the row closes;
--    - live or paused at the sale price: back to the price before; the row closes;
--    - a FINAL status (completed, withdrawn, rejected, removed, sold_elsewhere): nothing to put back; the row closes;
--    - anything else (reserved, sold, ended, in review, ...) can still come back on sale (a hold that runs out, a missed
--      pickup, a lapsed trade, a listing round): the row WAITS, and trg_declutter_items_shop_sale_return puts the price
--      back the moment the listing is live or paused again, however long that takes.
CREATE OR REPLACE FUNCTION public.declutter_shop_sale_restore(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  PERFORM set_config('declutter.shop_sale_engine', 'on', true);
  FOR r IN
    SELECT x.item_id, x.before_cents, x.sale_cents, x.seller_changed_at, i.status, i.current_price_cents, i.price_cents
      FROM public.declutter_shop_sale_items x
      JOIN public.declutter_items i ON i.id = x.item_id
     WHERE x.sale_id = p_sale_id AND x.restored_at IS NULL
     ORDER BY x.item_id
     FOR UPDATE OF i SKIP LOCKED
  LOOP
    IF r.seller_changed_at IS NULL AND r.status IN ('live', 'paused') AND r.current_price_cents = r.sale_cents THEN
      UPDATE public.declutter_items
         SET current_price_cents = least(r.before_cents, r.price_cents), updated_at = now()
       WHERE id = r.item_id;
      v_n := v_n + 1;
    ELSIF r.seller_changed_at IS NULL AND r.status NOT IN ('live', 'paused', 'completed', 'withdrawn', 'rejected', 'removed', 'sold_elsewhere') THEN
      CONTINUE; -- waits: it can still come back on sale, and the return trigger puts the price back then
    END IF;
    UPDATE public.declutter_shop_sale_items SET restored_at = now() WHERE sale_id = p_sale_id AND item_id = r.item_id;
  END LOOP;
  PERFORM set_config('declutter.shop_sale_engine', '', true);
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_shop_sale_restore(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_shop_sale_restore(uuid) TO service_role;

-- 3a. Review 11-19 #6: any price change on a listing with an open sale row that the sale did not make itself marks the
--     row, so the put-back never overwrites a deliberate price (even one equal to the sale price).
CREATE OR REPLACE FUNCTION public.declutter_items_shop_sale_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF COALESCE(current_setting('declutter.shop_sale_engine', true), '') <> 'on' THEN
    UPDATE public.declutter_shop_sale_items
       SET seller_changed_at = now()
     WHERE item_id = NEW.id AND restored_at IS NULL AND seller_changed_at IS NULL;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_shop_sale_price() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_shop_sale_price ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_shop_sale_price
  AFTER UPDATE OF current_price_cents ON public.declutter_items
  FOR EACH ROW WHEN (NEW.current_price_cents IS DISTINCT FROM OLD.current_price_cents)
  EXECUTE FUNCTION public.declutter_items_shop_sale_price();

-- 3b. Review 11-19 #1: a listing whose sale has ended (or was cancelled) and that comes back on sale (live or paused)
--     while still at its sale price gets its price back in the same write, whenever that happens (a missed pickup or a
--     lapsed trade can put a sold listing back up days later). BEFORE, so the price rides the same row write.
CREATE OR REPLACE FUNCTION public.declutter_items_shop_sale_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  x record;
BEGIN
  SELECT si.sale_id, si.before_cents, si.sale_cents, si.seller_changed_at INTO x
    FROM public.declutter_shop_sale_items si
    JOIN public.declutter_shop_sales s ON s.id = si.sale_id AND s.status IN ('ended', 'cancelled')
   WHERE si.item_id = NEW.id AND si.restored_at IS NULL
   LIMIT 1;
  IF FOUND THEN
    IF x.seller_changed_at IS NULL AND NEW.current_price_cents = x.sale_cents THEN
      NEW.current_price_cents := least(x.before_cents, NEW.price_cents);
    END IF;
    UPDATE public.declutter_shop_sale_items SET restored_at = now() WHERE sale_id = x.sale_id AND item_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_items_shop_sale_return() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_items_shop_sale_return ON public.declutter_items;
CREATE TRIGGER trg_declutter_items_shop_sale_return
  BEFORE UPDATE OF status ON public.declutter_items
  FOR EACH ROW WHEN (NEW.status IN ('live', 'paused') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.declutter_items_shop_sale_return();

-- ---------------------------------------------------------------------------
-- 4. The seller's two buttons.
CREATE OR REPLACE FUNCTION public.declutter_start_shop_sale(p_percent_off integer, p_starts_at timestamptz, p_ends_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_start timestamptz;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_percent_off IS NULL OR p_percent_off < 5 OR p_percent_off > 50 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023', HINT = 'Pick between 5% and 50% off.';
  END IF;
  v_start := greatest(COALESCE(p_starts_at, now()), now());
  -- Review 11-19 #5: 2 hours of slack over 14 days (a clock change inside the sale), as the table's own CHECK.
  IF p_ends_at IS NULL OR p_ends_at <= v_start OR p_ends_at > v_start + interval '14 days 2 hours' OR v_start > now() + interval '14 days' THEN
    RAISE EXCEPTION 'shop_sale_dates' USING ERRCODE = '22023',
      HINT = 'A sale starts within 2 weeks and runs up to 2 weeks.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_shop_sale:' || v_uid::text));
  IF EXISTS (SELECT 1 FROM public.declutter_shop_sales s WHERE s.seller_id = v_uid AND s.status IN ('scheduled', 'on')) THEN
    RAISE EXCEPTION 'sale_already_set' USING ERRCODE = '55000', HINT = 'End your current sale first.';
  END IF;
  INSERT INTO public.declutter_shop_sales (seller_id, percent_off, starts_at, ends_at, status)
  VALUES (v_uid, p_percent_off, v_start, p_ends_at, CASE WHEN v_start <= now() THEN 'on' ELSE 'scheduled' END)
  RETURNING id INTO v_id;
  IF v_start <= now() THEN
    PERFORM public.declutter_shop_sale_apply(v_id);
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_shop_sale(integer, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_shop_sale(integer, timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_end_shop_sale()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_sale public.declutter_shop_sales%ROWTYPE;
BEGIN
  PERFORM public.require_feature('declutter');
  -- The ban gate, as Pause and Take down have it (banGateCoverage); a banned seller's listings are hidden anyway and
  -- the sale ends by itself. Not the selling gate on purpose: anyone else may end their own sale.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('declutter_shop_sale:' || v_uid::text));
  SELECT * INTO v_sale FROM public.declutter_shop_sales
   WHERE seller_id = v_uid AND status IN ('scheduled', 'on') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'PT404', HINT = 'There is no sale to end.';
  END IF;
  IF v_sale.status = 'scheduled' THEN
    UPDATE public.declutter_shop_sales SET status = 'cancelled', ended_at = now() WHERE id = v_sale.id;
    RETURN 'cancelled';
  END IF;
  UPDATE public.declutter_shop_sales SET status = 'ended', ended_at = now() WHERE id = v_sale.id;
  PERFORM public.declutter_shop_sale_restore(v_sale.id);
  RETURN 'ended';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_end_shop_sale() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_end_shop_sale() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The sweep (every 15 minutes). Each sale in its own block: one bad sale never stops the others.
CREATE OR REPLACE FUNCTION public.declutter_shop_sale_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '1s'
AS $fn$
DECLARE
  r record;
  v_started integer := 0;
  v_ended integer := 0;
  v_items integer := 0;
  v_restored integer := 0;
  v_errors integer := 0;
BEGIN
  -- Due to end (a sale whose end passed before it ever started ends too, having changed nothing).
  FOR r IN SELECT s.id FROM public.declutter_shop_sales s WHERE s.status IN ('scheduled', 'on') AND s.ends_at <= now() ORDER BY s.ends_at LIMIT 200 LOOP
    BEGIN
      UPDATE public.declutter_shop_sales SET status = 'ended', ended_at = now() WHERE id = r.id AND status IN ('scheduled', 'on');
      v_restored := v_restored + public.declutter_shop_sale_restore(r.id);
      v_ended := v_ended + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_shop_sale_sweep', r.id::text, format('ending shop sale %s failed: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  -- Review 11-19 #2: put-backs BEFORE any discount. Ended or cancelled sales with a listing still waiting (it was
  -- reserved or sold at the end): a listing that has reached a final status closes; one back on sale was already put
  -- back by trg_declutter_items_shop_sale_return; this catches anything else. No time limit (review #1: a sold
  -- listing can come back days later).
  FOR r IN SELECT DISTINCT s.id FROM public.declutter_shop_sales s
             JOIN public.declutter_shop_sale_items x ON x.sale_id = s.id AND x.restored_at IS NULL
            WHERE s.status IN ('ended', 'cancelled') LIMIT 500 LOOP
    BEGIN
      v_restored := v_restored + public.declutter_shop_sale_restore(r.id);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_shop_sale_sweep', r.id::text, format('shop sale %s put-back failed: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  -- Due to start.
  FOR r IN SELECT s.id FROM public.declutter_shop_sales s WHERE s.status = 'scheduled' AND s.starts_at <= now() ORDER BY s.starts_at LIMIT 200 LOOP
    BEGIN
      UPDATE public.declutter_shop_sales SET status = 'on' WHERE id = r.id AND status = 'scheduled';
      v_items := v_items + public.declutter_shop_sale_apply(r.id);
      v_started := v_started + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_shop_sale_sweep', r.id::text, format('starting shop sale %s failed: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  -- Running sales: listings that went live since (relisted, newly posted) get the discount too.
  FOR r IN SELECT s.id FROM public.declutter_shop_sales s WHERE s.status = 'on' ORDER BY s.id LIMIT 500 LOOP
    BEGIN
      v_items := v_items + public.declutter_shop_sale_apply(r.id);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      PERFORM public.log_cron_defect('declutter_shop_sale_sweep', r.id::text, format('shop sale %s new listings failed: %s (%s)', r.id, SQLERRM, SQLSTATE));
    END;
  END LOOP;
  RETURN jsonb_build_object('started', v_started, 'ended', v_ended, 'discounted', v_items, 'put_back', v_restored, 'errors', v_errors);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_shop_sale_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_shop_sale_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. declutter_item_demand, restated with the sale (two more columns, so DROP + CREATE). Body verbatim from
--    20261120012729 apart from the lines marked CHANGED 20261120014036.
DROP FUNCTION IF EXISTS public.declutter_item_demand(uuid[]);
CREATE OR REPLACE FUNCTION public.declutter_item_demand(p_item_ids uuid[])
RETURNS TABLE(item_id uuid, saves integer, offers_week integer, views_today integer, sale_pct integer, sale_ends_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_today timestamptz := (date_trunc('day', now() AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago';
  v_ids uuid[];
BEGIN
  IF p_item_ids IS NULL OR cardinality(p_item_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_item_ids) > 200 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023', HINT = 'Ask about at most 200 items at a time.';
  END IF;
  IF v_uid IS NULL THEN
    IF NOT public.declutter_open_to_guests() THEN
      RETURN;
    END IF;
    SELECT array_agg(i.id) INTO v_ids
      FROM public.declutter_items i
     WHERE i.id = ANY (p_item_ids)
       AND i.status IN ('live', 'reserved')
       AND NOT i.seller_hidden
       AND NOT i.is_seed;
  ELSE
    SELECT array_agg(i.id) INTO v_ids
      FROM public.declutter_items i
     WHERE i.id = ANY (p_item_ids)
       AND i.status IN ('live', 'reserved')
       AND (
         i.seller_id = v_uid
         OR (
           (SELECT public.feature_enabled_for('declutter'))
           AND NOT i.seller_hidden
           AND (NOT i.is_seed OR NOT (SELECT public.seed_hidden_in_discovery()))
           AND NOT (i.seller_id = ANY (COALESCE((SELECT public.declutter_my_block_partners()), '{}'::uuid[])))
         )
       );
  END IF;
  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT i.id,
           (SELECT count(*)::integer FROM public.declutter_watchlist w
             WHERE w.item_id = i.id AND w.user_id <> i.seller_id),
           (SELECT count(DISTINCT o.buyer_id)::integer FROM public.declutter_offers o
             WHERE o.item_id = i.id AND o.created_at > now() - interval '7 days'
               AND NOT EXISTS (SELECT 1 FROM public.profiles bp WHERE bp.user_id = o.buyer_id AND bp.is_seed)
               AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = o.buyer_id)),
           (SELECT count(DISTINCT COALESCE(v.viewer_id::text, v.device_id))::integer FROM public.declutter_item_views v
             WHERE v.item_id = i.id AND v.created_at >= v_today
               AND (v.viewer_id IS NULL OR v.viewer_id <> i.seller_id)
               AND NOT EXISTS (SELECT 1 FROM public.profiles vp WHERE vp.user_id = v.viewer_id AND vp.is_seed)
               AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = v.viewer_id)),
           -- CHANGED 20261120014036: the running shop sale, only while this listing's price is its sale price.
           s.percent_off::integer,
           s.ends_at
      FROM public.declutter_items i
      LEFT JOIN LATERAL (
        SELECT ss.percent_off, ss.ends_at
          FROM public.declutter_shop_sale_items x
          JOIN public.declutter_shop_sales ss ON ss.id = x.sale_id AND ss.status = 'on'
         WHERE x.item_id = i.id AND x.restored_at IS NULL AND x.sale_cents = i.current_price_cents
         LIMIT 1
      ) s ON true
     WHERE i.id = ANY (v_ids);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_demand(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_item_demand(uuid[]) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_item_demand(uuid[]) IS
  'Declutter top 5 #3/#4 (owner 11-19): saves, offers this week, views today and the running shop sale per visible item; numbers only.';

-- ---------------------------------------------------------------------------
-- 7. The cron: every 15 minutes (off the quarter hours, Q786 spread), registered with the dead-cron monitor. Not daily, so no catch-up policy row: the
--    next run does whatever a missed one would have (Q30's own rule for frequent jobs).
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-shop-sales', interval '1 hour',
            'Declutter shop-wide sales, every 15 minutes: starts and ends sellers'' sales and puts prices back.',
            'exempt',
            'While no seller has a sale starting, running or ending, a run that changes nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-shop-sales', '5,20,35,50 * * * *',
      $c$SELECT public.cron_record_work('declutter-shop-sales', to_jsonb(public.declutter_shop_sale_sweep()));$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 8. The nightly price drop pauses during a shop sale. Restated VERBATIM from 20261030154745_declutter_drop_stop_whole_dollar.sql
--    (the newest definition); the one change is marked CHANGED 20261120014036. Grants restated as there.
CREATE OR REPLACE FUNCTION public.declutter_price_drop_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       -- ($38 at 5% is $36, never $36.10). DA-17: the stop counts up to a whole dollar too ($21.37 lands at $22).
       SET current_price_cents = greatest(p.floor_price_cents, (ceil(COALESCE(p.drop_stop_cents, p.floor_price_cents) / 100.0) * 100)::integer,
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
       AND i.current_price_cents > greatest(p.floor_price_cents, (ceil(COALESCE(p.drop_stop_cents, p.floor_price_cents) / 100.0) * 100)::integer)
       AND (i.last_price_drop_on IS NULL OR i.last_price_drop_on < v_today)
       -- CHANGED 20261120014036 (Declutter top 5 #4): never on a listing with an OPEN shop-sale row, running or still
       -- waiting for its put-back (review 11-19 #4), so the put-back always restores the exact price.
       AND NOT EXISTS (SELECT 1 FROM public.declutter_shop_sale_items x
                        WHERE x.item_id = i.id AND x.restored_at IS NULL)
    RETURNING i.id, i.title, i.current_price_cents, i.is_seed
  LOOP
    -- Q2429: the watchers' "price dropped" notice is sent by trg_declutter_items_price_drop_alert
    -- (every path that lowers a price, rate-limited), no longer from here.
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_price_drop_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_price_drop_sweep() TO service_role;
