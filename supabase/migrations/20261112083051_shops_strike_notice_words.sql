-- S046 (Shops audit 11-12, Low): the strike notice said "(%s of 3)", which reads "4 of 3" at a fourth strike.
-- shop_give_strike RESTATED from 20261019071055_shops_refunds_cancels_strikes.sql (newest CREATE); only the notice's
-- words change. The paused-until day on the screen is fixed in src/components/shops/ShopMyStrikes.tsx.
-- MONEY: none. AUTHZ: none new (CREATE OR REPLACE keeps the service_role grant). REPLAY-SAFE: CREATE OR REPLACE.
-- Proof: src/test/pglite/shopsStrikeWords.pglite.mjs (3x; NEW_MIGRATION=skip red).

CREATE OR REPLACE FUNCTION public.shop_give_strike(p_user uuid, p_side text, p_reason text, p_order uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_count integer;
BEGIN
  IF p_user IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.shop_strikes (user_id, offender_side, reason, order_id, expires_at, is_seed)
  VALUES (p_user, p_side, p_reason, p_order, now() + interval '1 year',
          COALESCE((SELECT o.is_seed FROM public.shop_orders o WHERE o.id = p_order), false))
  ON CONFLICT (order_id, user_id, reason) WHERE order_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    v_count := public.shop_active_strike_count(p_user);
    -- S046 (Shops audit 11-12): never "4 of 3". Under the limit, the count toward it; at or past it, the count and that
    -- Shops opens again once enough of them end (ShopMyStrikes names the day).
    PERFORM public.declutter_notify(p_user, 'warning', 'Shops strike',
      CASE WHEN v_count < 3
        THEN format('You got a Shops strike (%s of 3). It ends in a year. At 3, Shops closes for you until one ends.', v_count)
        ELSE format('You got a Shops strike. You now have %s, so Shops is closed for you until you are back under 3. Each strike ends a year after it was given.', v_count)
      END
        || ' If this is wrong, contact Louisiana Helpr support.',
      '/shops/orders');
  END IF;
  RETURN v_id;
END;
$fn$;
