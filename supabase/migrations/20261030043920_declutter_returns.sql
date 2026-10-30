-- Declutter returns: how a full-refund item gets back to the seller (builder 37's design, approved by the lead
-- 2026-10-29). Owner answers (2026-10-29, through the lead): refunds stay for PROBLEMS ONLY (no "changed my mind"
-- reason; declutter_ask_refund is untouched), and there is NO paid Helpr return trip: only the two free ways.
--
-- WHY: when the seller agreed to a full refund, the buyer was told "give the item back; arrange it in Messages".
-- Nothing said how, where or when, and nothing showed the item was given back, so the seller's "I got it back"
-- (the only path that sends the refund) waited on a chat.
--
-- WHAT CHANGES (switch 'declutter_refund_requests', the one this flow already uses):
--   1. declutter_refund_requests gets the return: return_way 'drop_off' (the buyer brings it to the seller's pickup
--      address on or after return_day) or 'collect' (the seller comes for it at return_at, to an address the buyer
--      types: return_address/lat/lng); return_photo_path + return_dropped_off_at (the buyer's drop-off photo) and
--      returned_photo_path (the seller's optional photo with "I got it back"). One CHECK ties each way to its
--      fields; a request with no way (agreed before this change, or through declutter_answer_refund 'full') keeps
--      every return field empty and works as before.
--   2. declutter_accept_refund_with_return(request, way, day, at): the seller's full-refund answer AND the way in
--      ONE atomic call (the 'full' arm of declutter_answer_refund, restated, plus the way). declutter_answer_refund
--      itself is not changed.
--   3. declutter_return_dropped_off(request, photo, lat, lng): the buyer, drop_off only, on or after return_day:
--      a live photo (uploaded in the last 10 minutes, handover_photo_is_fresh) taken within 200 m of the order's
--      nearest item pickup point (the porch photo rules, 20261029002010). It moves no money.
--   4. declutter_set_return_address(request, address, lat, lng): the buyer, collect only, while returning.
--   5. declutter_refund_item_returned(request, photo DEFAULT NULL): DROP + CREATE with an optional live photo; it
--      stays the ONLY money path and its refund is unchanged.
--   6. declutter_refund_request_view: the return fields, the return address only while returning + collect.
--   7. declutter_refund_request_sweep: the 72-hour admin backstop counts from the LATER of return_by and the
--      return day/time + 24 hours (declutter_return_backstop_at).
--   8. declutter_handover_photo_access: a 'return' folder, writable by a party only while that order's refund
--      request is returning.
--
-- Restated from PROD'S EFFECTIVE definitions (pg_get_functiondef, read 2026-10-30 when prod's newest applied migration
-- was 20261030000030 = main's newest): declutter_refund_request_view and declutter_handover_photo_access from D2-3
-- (20261029225634); declutter_refund_item_returned and declutter_refund_request_sweep from 20261026155251; the 'full'
-- arm of declutter_answer_refund from D2-5 (20261029224147). First written by builder 37 as 20261029192457 (never
-- applied); re-timestamped by builder 80.
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; the CHECK dropped and re-added in one DO block; CREATE OR REPLACE;
-- DROP FUNCTION IF EXISTS before the one signature change.
-- Proof: src/test/pglite/declutterReturns.pglite.mjs (RED with NEW_MIGRATION=skip; this file 3x).
-- Guard: src/test/declutterReturns.test.ts.

-- ── 1. The return, on the request ──────────────────────────────────────────
ALTER TABLE public.declutter_refund_requests
  ADD COLUMN IF NOT EXISTS return_way text,
  ADD COLUMN IF NOT EXISTS return_day date,
  ADD COLUMN IF NOT EXISTS return_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_address text,
  ADD COLUMN IF NOT EXISTS return_lat numeric,
  ADD COLUMN IF NOT EXISTS return_lng numeric,
  ADD COLUMN IF NOT EXISTS return_photo_path text,
  ADD COLUMN IF NOT EXISTS return_dropped_off_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_photo_path text;

DO $do$
BEGIN
  ALTER TABLE public.declutter_refund_requests DROP CONSTRAINT IF EXISTS declutter_refund_requests_return_way;
  ALTER TABLE public.declutter_refund_requests ADD CONSTRAINT declutter_refund_requests_return_way CHECK (
    CASE
      -- No way: every return field empty (a request agreed before this change keeps working as it did).
      WHEN return_way IS NULL THEN return_day IS NULL AND return_at IS NULL AND return_address IS NULL AND return_lat IS NULL
                     AND return_lng IS NULL AND return_photo_path IS NULL AND return_dropped_off_at IS NULL
      -- The buyer brings it: a day, no time, no buyer address; the photo and its time go together.
      WHEN return_way = 'drop_off' THEN return_day IS NOT NULL AND return_at IS NULL AND return_address IS NULL
                     AND return_lat IS NULL AND return_lng IS NULL
                     AND ((return_photo_path IS NULL) = (return_dropped_off_at IS NULL))
      -- The seller comes for it: a day and a time; the address (typed by the buyer) all or nothing; no drop-off photo.
      WHEN return_way = 'collect' THEN return_day IS NOT NULL AND return_at IS NOT NULL
                     AND ((return_address IS NULL) = (return_lat IS NULL)) AND ((return_lat IS NULL) = (return_lng IS NULL))
                     AND (return_address IS NULL OR char_length(btrim(return_address)) BETWEEN 1 AND 300)
                     AND (return_lat IS NULL OR (return_lat BETWEEN -90 AND 90 AND return_lng BETWEEN -180 AND 180))
                     AND return_photo_path IS NULL AND return_dropped_off_at IS NULL
      ELSE false
    END);
END
$do$;

-- ── 2. When the admin backstop takes over a return ─────────────────────────
-- The later of return_by (72 hours after the seller agreed) and 24 hours after the return: the collect time, or
-- the end of the drop-off day (Louisiana time). NULL in, NULL out.
CREATE OR REPLACE FUNCTION public.declutter_return_backstop_at(r public.declutter_refund_requests)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT greatest(r.return_by,
                  CASE WHEN r.return_way = 'collect' THEN r.return_at + interval '24 hours'
                       WHEN r.return_way = 'drop_off'
                         THEN ((r.return_day + 1)::timestamp AT TIME ZONE 'America/Chicago') + interval '24 hours' END);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_return_backstop_at(public.declutter_refund_requests) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_return_backstop_at(public.declutter_refund_requests) TO service_role;

-- ── 3. The return photo folder ─────────────────────────────────────────────
-- Restated from prod's effective body (20261029225634, D2-3; pg_get_functiondef md5 fb006d7e, read 2026-10-30):
-- <uid>/declutter/return/<order>/<file> joins handover and problem; a party writes into it only while that order's
-- refund request is returning (the order itself is handed_over by then). The handover and problem rules are unchanged.
CREATE OR REPLACE FUNCTION public.declutter_handover_photo_access(p_name text, p_write boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
BEGIN
  IF v_uid IS NULL OR p_name IS NULL OR p_write IS NULL
     -- Exactly <uid>/declutter/<handover|problem|return>/<order>/<file>: no extra or empty segments.
     OR array_length(string_to_array(p_name, '/'), 1) IS DISTINCT FROM 5
     OR split_part(p_name, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_name, '/', 3) NOT IN ('handover', 'problem', 'return')
     OR split_part(p_name, '/', 4) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR split_part(p_name, '/', 5) = ''
     OR split_part(p_name, '/', 6) <> '' THEN
    RETURN false;
  END IF;
  v_order := split_part(p_name, '/', 4)::uuid;
  IF p_write THEN
    -- A return photo (20261030043920): into your own folder, only while the order's refund request is returning.
    IF split_part(p_name, '/', 3) = 'return' THEN
      RETURN split_part(p_name, '/', 1) = v_uid::text
         AND EXISTS (SELECT 1 FROM public.declutter_orders o
                       JOIN public.declutter_refund_requests r ON r.order_id = o.id
                      WHERE o.id = v_order AND r.status = 'returning' AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
    END IF;
    -- Only into your own folder, only for an order you are a party of, and
    -- only while it is paid (both RPCs take a photo only then; lh-authz-rls
    -- review of lane J, should-fix 2: no uploads to a refunded or closed order).
    -- D2-3 (Builder 45, measured live 2026-10-29): problem and refund photos are taken after the handover too, so
    -- the 'problem' folder also takes uploads while the order is handed over and a problem can still be reported,
    -- a refund request waits for an answer, or a problem is open (the other side adds theirs). Handover photos: paid only.
    RETURN split_part(p_name, '/', 1) = v_uid::text
       AND EXISTS (SELECT 1 FROM public.declutter_orders o
                    WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid)
                      AND (o.status = 'paid'
                           OR (split_part(p_name, '/', 3) = 'problem' AND o.status = 'handed_over'
                               AND (public.declutter_problem_window_open(o.id)
                                    OR EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                                                WHERE r.order_id = o.id AND r.status IN ('open', 'offered', 'returning'))
                                    OR EXISTS (SELECT 1 FROM public.declutter_problems x
                                                WHERE x.order_id = o.id AND x.status = 'open')))));
  END IF;
  RETURN public.has_role(v_uid, 'admin')
      OR EXISTS (SELECT 1 FROM public.declutter_orders o
                  WHERE o.id = v_order AND (o.buyer_id = v_uid OR o.seller_id = v_uid));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_photo_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_handover_photo_access(text, boolean) TO authenticated, service_role;

-- A return photo path of this caller for this order, uploaded to declutter-handover. Internal.
CREATE OR REPLACE FUNCTION public.declutter_return_photo_ok(p_order_id uuid, p_uid uuid, p_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_path IS NOT NULL AND p_uid IS NOT NULL AND p_order_id IS NOT NULL
     AND split_part(p_path, '/', 1) = p_uid::text
     AND split_part(p_path, '/', 2) = 'declutter'
     AND split_part(p_path, '/', 3) = 'return'
     AND split_part(p_path, '/', 4) = p_order_id::text
     AND split_part(p_path, '/', 5) <> ''
     AND split_part(p_path, '/', 6) = ''
     AND EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_path);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_return_photo_ok(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_return_photo_ok(uuid, uuid, text) TO service_role;

-- ── 4. The seller agrees a full refund AND picks the way, in one call ───────
CREATE OR REPLACE FUNCTION public.declutter_accept_refund_with_return(p_request_id uuid, p_way text, p_day date,
  p_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_day date;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_way IS NULL OR p_way NOT IN ('drop_off', 'collect') THEN
    RAISE EXCEPTION 'invalid_return_way' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: the order (and its items) first, then the request, as every other path.
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';
  END IF;
  -- The day (Louisiana time): today or within the next 7 days. A collect time is in the future, inside those days.
  IF p_way = 'drop_off' THEN
    IF p_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_return_time' USING ERRCODE = '22023';
    END IF;
    v_day := p_day;
  ELSE
    IF p_at IS NULL OR p_at <= now() THEN
      RAISE EXCEPTION 'invalid_return_time' USING ERRCODE = '22023', HINT = 'Pick a time from now on.';
    END IF;
    v_day := (p_at AT TIME ZONE 'America/Chicago')::date;
    IF p_day IS NOT NULL AND p_day <> v_day THEN
      RAISE EXCEPTION 'invalid_return_time' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_day IS NULL OR v_day < v_today OR v_day > v_today + 7 THEN
    RAISE EXCEPTION 'invalid_return_day' USING ERRCODE = '22023', HINT = 'Pick a day in the next 7 days.';
  END IF;
  -- The 'full' arm of declutter_answer_refund (prod body, 20261029224147): nothing is refunded yet; the payout stays held.
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
      HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
  END IF;
  UPDATE public.declutter_refund_requests
     SET status = 'returning', return_agreed_at = now(), return_by = now() + interval '72 hours',
         return_way = p_way, return_day = v_day, return_at = CASE WHEN p_way = 'collect' THEN p_at END
   WHERE id = r.id;
  IF p_way = 'drop_off' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller agreed to a full refund',
      format('Bring the item back to the seller''s pickup address on %s or after, and take a photo there. Your refund of $%s is sent as soon as the seller confirms they have it back.',
             to_char(v_day, 'FMDay, FMMonth FMDD'), to_char(public.declutter_full_refund_cents(o.id) / 100.0, 'FM999990.00')),
      '/declutter?view=buying', v_uid);
  ELSE
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller agreed to a full refund',
      format('The seller will come for the item on %s. Add the address where they should pick it up. Your refund of $%s is sent as soon as the seller confirms they have it back.',
             to_char(p_at AT TIME ZONE 'America/Chicago', 'FMDay, FMMonth FMDD "at" FMHH12:MI AM'),
             to_char(public.declutter_full_refund_cents(o.id) / 100.0, 'FM999990.00')),
      '/declutter?view=buying', v_uid);
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Full refund agreed',
    'When you have the item back, tap "I got it back" and the refund is sent. If you don''t confirm in time, Louisiana Helpr decides.',
    '/declutter?view=selling', o.buyer_id);
  RETURN jsonb_build_object('result', 'returning', 'return_way', p_way, 'return_day', v_day,
    'full_refund_cents', public.declutter_full_refund_cents(o.id));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_accept_refund_with_return(uuid, text, date, timestamptz) TO authenticated, service_role;

-- ── 5. The buyer drops it off ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.declutter_return_dropped_off(p_request_id uuid, p_photo_path text, p_lat numeric,
  p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_m integer;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'returning' OR r.return_way IS DISTINCT FROM 'drop_off' THEN
    RAISE EXCEPTION 'not_a_drop_off' USING ERRCODE = '55000';
  END IF;
  IF r.return_dropped_off_at IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_dropped_off');
  END IF;
  IF (now() AT TIME ZONE 'America/Chicago')::date < r.return_day THEN
    RAISE EXCEPTION 'before_return_day' USING ERRCODE = '55000',
      HINT = 'You can drop it off from the day the seller picked.';
  END IF;
  IF NOT public.declutter_return_photo_ok(o.id, v_uid, p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.
  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
    RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
      HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
  END IF;
  -- At the address (20261028235709): within 200 m of the NEAREST pickup point of any item in the order.
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - p.pickup_lat) / 2)), 2)
           + cos(radians(p.pickup_lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - p.pickup_lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = o.id AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the seller''s pickup address.';
  END IF;
  UPDATE public.declutter_refund_requests SET return_photo_path = p_photo_path, return_dropped_off_at = now()
   WHERE id = r.id;
  PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'The buyer brought the item back',
    'The buyer left the item at your pickup address and took a photo. Check it, then tap "I got it back" to send the refund.',
    '/declutter?view=selling', v_uid);
  RETURN jsonb_build_object('result', 'dropped_off', 'distance_m', v_m);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_return_dropped_off(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_return_dropped_off(uuid, text, numeric, numeric) TO authenticated, service_role;

-- ── 6. The buyer says where the seller collects it ─────────────────────────
CREATE OR REPLACE FUNCTION public.declutter_set_return_address(p_request_id uuid, p_address text, p_lat numeric,
  p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'returning' OR r.return_way IS DISTINCT FROM 'collect' THEN
    RAISE EXCEPTION 'not_a_collect' USING ERRCODE = '55000';
  END IF;
  p_address := NULLIF(btrim(p_address), '');
  IF p_address IS NULL OR char_length(p_address) > 300 THEN
    RAISE EXCEPTION 'address_required' USING ERRCODE = '22023', HINT = 'Type the address (up to 300 characters).';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'address_not_found' USING ERRCODE = '22023', HINT = 'We couldn''t find that address on the map.';
  END IF;
  UPDATE public.declutter_refund_requests SET return_address = p_address, return_lat = p_lat, return_lng = p_lng
   WHERE id = r.id;
  PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'Where to collect the item',
    'The buyer added the address where you collect the item. It''s on the sale.', '/declutter?view=selling', v_uid);
  RETURN jsonb_build_object('result', 'address_set');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_return_address(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_return_address(uuid, text, numeric, numeric) TO authenticated, service_role;

-- ── 7. The seller has the item back: the full refund is sent (#3558 answer 2) ──
-- Restated from prod's effective body (20261026155251; md5 a70e5f57) with only an optional live photo added; the refund is unchanged. The one-argument
-- signature is dropped so a call with one argument still resolves (to this one, by the DEFAULT).
DROP FUNCTION IF EXISTS public.declutter_refund_item_returned(uuid);
CREATE OR REPLACE FUNCTION public.declutter_refund_item_returned(p_request_id uuid, p_photo_path text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'returning' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  -- The optional photo: the seller's own, in the order's return folder, from the camera now.
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF p_photo_path IS NOT NULL THEN
    IF NOT public.declutter_return_photo_ok(o.id, v_uid, p_photo_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN
      RAISE EXCEPTION 'photo_too_old' USING ERRCODE = '22023',
        HINT = 'Take a new photo now: a handover photo must be taken in the last 10 minutes.';
    END IF;
  END IF;
  -- No deadline on the seller's own confirmation: until the sweep hands it to an admin (status changes), the
  -- seller may still say the item is back, and the buyer is refunded.
  v_out := public.declutter_refund_after_handover(o.id, 'refund_request_full', NULL);
  UPDATE public.declutter_refund_requests
     SET status = 'agreed', returned_at = now(), refund_id = (v_out->>'refund_id')::uuid, settled_at = now(),
         returned_photo_path = p_photo_path
   WHERE id = r.id;
  RETURN v_out || jsonb_build_object('result', 'refunded');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_item_returned(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_item_returned(uuid, text) TO authenticated, service_role;

-- ── 8. What a side sees ────────────────────────────────────────────────────
-- Restated from prod's effective body (20261029225634: D2-3 photo_paths, D2-5 admin_decided; md5 8746de1b) with the
-- return fields added. The collect address goes to the seller only while
-- the item is coming back that way; return_deadline is when Louisiana Helpr takes over.
CREATE OR REPLACE FUNCTION public.declutter_refund_request_view(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_side text;
  v_refund public.declutter_refunds;
  v_show_address boolean;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE order_id = o.id;
  IF r.refund_id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.declutter_refunds WHERE id = r.refund_id;
  END IF;
  v_show_address := COALESCE(r.status = 'returning' AND r.return_way = 'collect', false);
  RETURN jsonb_build_object(
    'order_id', o.id,
    'side', v_side,
    'handed_over', o.status = 'handed_over',
    'window_ends_at', CASE WHEN o.status = 'handed_over' THEN o.handed_over_at + interval '24 hours' END,
    'can_ask', COALESCE(v_side = 'buyer' AND o.status = 'handed_over' AND r.id IS NULL
               AND now() < o.handed_over_at + interval '24 hours'
               AND NOT public.declutter_sale_decided(o.id) AND public.declutter_payout_unsent(o.id)
               AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'can_report', COALESCE(v_side = 'buyer' AND public.declutter_problem_window_open(o.id)
                  AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'items_cents', o.items_cents,
    'full_refund_cents', public.declutter_full_refund_cents(o.id),
    'delivery_kept_cents', public.declutter_delivery_reserved_cents(o.id),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'answer_by', r.answer_by,
      -- D2-3: the buyer's photos (both sides read them through declutter-handover's read rule: the two parties and admins).
      'photo_paths', COALESCE(r.photo_paths, '{}'),
      'offer_cents', r.offer_cents, 'offer_answer_by', r.offer_answer_by, 'declined_at', r.declined_at,
      'return_by', r.return_by, 'returned_at', r.returned_at,
      'report_until', CASE WHEN r.status = 'declined' THEN greatest(r.declined_at, o.handed_over_at) + interval '24 hours' END,
      'refund_cents', v_refund.refund_cents, 'refund_status', v_refund.status, 'created_at', r.created_at,
      -- D2-5: the request ended with Louisiana Helpr's decision (not the seller's answer), so the panel says so.
      'admin_decided', r.status IN ('agreed', 'declined')
                       AND EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'decided'),
      'return_way', r.return_way, 'return_day', r.return_day, 'return_at', r.return_at,
      'return_dropped_off_at', r.return_dropped_off_at,
      'return_deadline', CASE WHEN r.status = 'returning' THEN public.declutter_return_backstop_at(r) END,
      'return_address', CASE WHEN v_show_address THEN r.return_address END,
      'return_lat', CASE WHEN v_show_address THEN r.return_lat END,
      'return_lng', CASE WHEN v_show_address THEN r.return_lng END) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_view(uuid) TO authenticated, service_role;

-- ── 9. The clock ───────────────────────────────────────────────────────────
-- Restated from prod's effective body (20261026155251; md5 1cfb6867): a return goes to an admin at declutter_return_backstop_at (the later of return_by
-- and the return day/time + 24 hours), not at return_by alone.
CREATE OR REPLACE FUNCTION public.declutter_refund_request_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  d record;
  r public.declutter_refund_requests;
  v_n integer := 0;
BEGIN
  FOR d IN
    SELECT x.id, x.order_id FROM public.declutter_refund_requests x
     WHERE (x.status = 'open' AND x.answer_by <= now()) OR (x.status = 'offered' AND x.offer_answer_by <= now())
        OR (x.status = 'returning' AND x.return_by <= now() AND public.declutter_return_backstop_at(x) <= now())
     ORDER BY x.created_at
     LIMIT 200
  LOOP
    BEGIN
      PERFORM public.declutter_lock_order(d.order_id);
      SELECT * INTO r FROM public.declutter_refund_requests WHERE id = d.id FOR UPDATE;
      IF (r.status = 'open' AND r.answer_by <= now()) OR (r.status = 'offered' AND r.offer_answer_by <= now())
         OR (r.status = 'returning' AND public.declutter_return_backstop_at(r) <= now()) THEN
        PERFORM public.declutter_refund_request_to_admin(r.id,
          CASE WHEN r.status = 'open' THEN 'the seller did not answer in 24 hours'
               WHEN r.status = 'returning' AND r.return_dropped_off_at IS NOT NULL
                 THEN 'the buyer dropped the item off with a photo but the seller did not confirm getting it back'
               WHEN r.status = 'returning' THEN 'the seller agreed to a full refund but did not confirm getting the item back in time'
               ELSE format('the seller offered $%s back and the buyer did not answer in 24 hours', to_char(r.offer_cents / 100.0, 'FM999990.00')) END);
        v_n := v_n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad request never stops the rest; it is logged and retried next run (lh-money-escrow review, should-fix 3).
      PERFORM public.log_cron_defect('declutter_refund_request_sweep', d.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('to_admin', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_sweep() TO service_role;
