-- Free items: the asker picks the pickup day and time WHEN THEY ASK (owner 11-01, Mockup 3 "Ask for it" sheet),
-- from the giver's saved pickup times. Builder 99.
--
-- WHAT THIS ADDS:
--   1. declutter_free_requests.pickup_at (timestamptz, NULL): the time the asker chose. NULL = an ask made before this
--      (or from an older app build calling declutter_request_free), which keeps the old path.
--   2. declutter_seller_slot_open(seller, start) (internal, service_role only): is a 30-minute pickup starting at
--      `start` inside the giver's saved times? A giver with pickup places: any place's hours (the place's own, else
--      filled as declutter_item_pickup_places shows them, declutter_place_windows_fill). A giver with no place: the
--      usual times (declutter_slot_in_windows), as declutter_order_slot_in_windows falls back for an order.
--   3. declutter_request_free_at(item, pickup_at) (new RPC): refuses a missing time, a time in the past, a time more
--      than 8 days ahead and a time outside the giver's saved times (pickup_time_unavailable, 22023). It asks
--      through declutter_request_free FIRST (every guard of that function: ban, member, item, own item, sale mode,
--      free, live, pause, 3 at a time), so a hidden item still answers item_not_found; a time outside the hours then
--      raises, which rolls back the ask and its notice. The time is stored on the caller's own open ask. Asking again
--      with a new time moves the time on the same open ask.
--   4. declutter_free_requests_for_item (newest: 20261101040158_profile_lookups_by_user_id.sql) also returns
--      pickup_at, so the giver sees each asker's chosen time. DROP + CREATE: the row type changed. Body otherwise
--      verbatim.
--
-- NOT CHANGED HERE: declutter_request_free (installed builds still call it) and declutter_pick_free_request (the
-- picked person still confirms the pickup in the cart, with their asked time; see the B99 handoff).
-- MONEY: none. REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP FUNCTION IF EXISTS before the changed
-- row type. Proof: src/test/pglite/freeAskPicksATime.pglite.mjs (applied 3x, with mutants).

ALTER TABLE public.declutter_free_requests ADD COLUMN IF NOT EXISTS pickup_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_seller_slot_open(p_seller uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_local timestamp := p_start AT TIME ZONE 'America/Chicago';
BEGIN
  IF p_seller IS NULL OR p_start IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_porch_places pl WHERE pl.seller_id = p_seller) THEN
    RETURN public.declutter_slot_in_windows(p_seller, p_start);
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.declutter_porch_places pl
      CROSS JOIN LATERAL jsonb_array_elements(
        coalesce(pl.windows, public.declutter_place_windows_fill(NULL, pl.seller_id, pl.weekdays))) e
     WHERE pl.seller_id = p_seller
       AND (e ->> 'weekday')::int = extract(dow FROM v_local)::int
       AND v_local::time >= (e ->> 'starts')::time
       AND (e ->> 'ends')::time >= (e ->> 'starts')::time + interval '30 minutes'
       AND v_local::time <= (e ->> 'ends')::time - interval '30 minutes');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_slot_open(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_slot_open(uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_request_free_at(p_item_id uuid, p_pickup_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_pickup_at IS NULL OR p_pickup_at <= now() OR p_pickup_at > now() + interval '8 days' THEN
    RAISE EXCEPTION 'pickup_time_unavailable' USING ERRCODE = '22023',
      HINT = 'Pick one of the giver''s pickup times in the next week.';
  END IF;
  -- Every guard of the ask itself first (ban, member, item visible and live, own item, free, pause, 3 at a time), so
  -- a hidden or unknown item answers item_not_found exactly as before, never a time error that says it exists.
  v_id := public.declutter_request_free(p_item_id);
  SELECT i.seller_id INTO v_seller FROM public.declutter_items i WHERE i.id = p_item_id;
  -- A time outside the giver's hours raises, which rolls back the ask and its notice with it (one statement).
  IF NOT public.declutter_seller_slot_open(v_seller, p_pickup_at) THEN
    RAISE EXCEPTION 'pickup_time_unavailable' USING ERRCODE = '22023',
      HINT = 'Pick one of the giver''s pickup times in the next week.';
  END IF;
  UPDATE public.declutter_free_requests r SET pickup_at = p_pickup_at
   WHERE r.id = v_id AND r.requester_id = v_uid AND r.status = 'open';
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_request_free_at(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_request_free_at(uuid, timestamptz) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.declutter_free_requests_for_item(uuid);
CREATE OR REPLACE FUNCTION public.declutter_free_requests_for_item(p_item_id uuid)
 RETURNS TABLE(request_id uuid, requester_id uuid, display_name text, avg_rating numeric, review_count integer, created_at timestamptz, pickup_at timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT r.id, r.requester_id, public.member_display_name(p.full_name, 'A neighbor'),
           s.avg_rating, s.review_count, r.created_at, r.pickup_at
      FROM public.declutter_free_requests r
      LEFT JOIN public.profiles p ON p.user_id = r.requester_id
      LEFT JOIN LATERAL (SELECT g.avg_rating, g.review_count FROM public.get_public_profile_stats(ARRAY[r.requester_id]) g LIMIT 1) s ON true
     WHERE r.item_id = p_item_id AND r.status = 'open'
       AND NOT public.are_users_blocked(v_uid, r.requester_id)
     ORDER BY r.created_at;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_free_requests_for_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_free_requests_for_item(uuid) TO authenticated, service_role;
