-- DA-17 (Declutter audit 2026-10-30, Builder 3): a nightly price drop never lands on odd cents because of the stop.
-- 20261028160637 made the step a whole dollar ($38 at 5% is $36), but the price is
-- greatest(floor, stop, step) and the private stop is an un-rounded figure (measured on prod 2026-10-30, read-only: the
-- 6 live items' stops are $5.40, $21.37, $21.57, $20.90, $20.53, $21.39), so a listing that reaches its stop shows $21.37.
-- The stop now counts up to the next whole dollar, in the sweep only:
--   - never below the seller's floor or the stop: both round UP, so neither is ever passed (with no stop, a floor of
--     $20.50 stops the drops at $21; the seller gets more, never less);
--   - the WHERE uses the same figure, so a listing already at its rounded stop is left alone, not "dropped" to itself.
-- Restated from the effective prod definition (pg_get_functiondef, 2026-10-30), which matches 20261028160637; only the
-- two greatest(...) lines change. Grants restated as 20261028160637 has them. Stored stops are not touched.
-- No data change: prices already on odd cents (the 6 live items are all is_seed, last dropped 2026-10-27, before the
-- whole-dollar rule) settle on the next drop.
-- Proof: src/test/pglite/declutterDropStopWholeDollar.pglite.mjs.
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
