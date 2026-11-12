-- b1e/b1f review follow-up (lh-authz-rls on 20261112023218, planned in HANDOFF-B1 11-11): four places still showed a
-- member's name across a BAN (and two across a block). Like the other Declutter cards since 20261112010100, the name now
-- goes whenever public.declutter_names_hidden(a, b) is true (a user_blocks row either way, or an active ban on either side):
--   declutter_my_wanted      a reply's seller_name -> 'A neighbor' (a blocked seller's reply was already left out).
--   declutter_listed_for_me  helpr_first_name -> '' (ListedForYouCard already falls back to "Your Helpr" on '').
--   shops_my_talks / shops_talk_view: the shop's view of the buyer (other_label) -> 'A shopper', the existing fallback.
--     declutter_names_hidden reads only user_blocks and profiles, so Shops calls it as is (no alias).
-- Not changed: declutter_wanted_browse. The reviewer read only the caller's ban there, but the poster's ban already drops
-- the whole row (NOT public.declutter_member_out(w.user_id), whose ban clause is the same as declutter_names_hidden's) and
-- a block drops it too (are_users_blocked).
-- Only what a list SHOWS narrows; no row is added or dropped, no action changes.
--
-- Bodies restated VERBATIM from their newest definitions, each change marked "CHANGED 20261112052501".
-- Replay-safe: CREATE OR REPLACE of the same signatures; grants restated by role name.
-- Proof: src/test/pglite/namesHiddenWantedListedShopTalk.pglite.mjs. Sensitive: authz (what one member sees of another).

-- 1. declutter_my_wanted, from 20261102013814_declutter_my_wanted_reply_deadlines.sql
CREATE OR REPLACE FUNCTION public.declutter_my_wanted()
 RETURNS TABLE(id uuid, what text, category text, max_price_cents integer, radius_miles integer, status text, expires_at timestamp with time zone, created_at timestamp with time zone, matches jsonb, public boolean, photo_paths text[], replies jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_wanted');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT w.id, w.what, w.category, w.max_price_cents, w.radius_miles::integer,
           CASE WHEN w.status = 'open' AND w.expires_at <= now() THEN 'expired' ELSE w.status END,
           w.expires_at, w.created_at,
           CASE WHEN w.status = 'open' AND w.expires_at > now() THEN
             COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'price_cents', i.current_price_cents)
                                        ORDER BY i.current_price_cents, i.id)
                         FROM public.declutter_wanted_pairs(NULL, w.id, true) p
                         JOIN public.declutter_items i ON i.id = p.item_id
                        WHERE i.current_price_cents <= w.max_price_cents
                          AND NOT public.declutter_seller_hidden(i.seller_id)), '[]'::jsonb)
           ELSE '[]'::jsonb END,
           w.public,
           w.photo_paths,
           -- The replies to THIS post (a reply is an offer to the poster, tagged wanted_id): which seller (First L.,
           -- never an id), which listing, what price, and where the offer stands. Blocked either way: left out.
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                               'offer_id', o.id, 'item_id', o.item_id, 'item_title', i.title,
                               -- CHANGED 20261112052501: no name across a ban on either side (a block already drops the
                               -- reply): the words the other Declutter cards use instead.
                               'seller_name', CASE WHEN public.declutter_names_hidden(v_uid, o.seller_id) THEN 'A neighbor'
                                                   ELSE public.member_display_name(sp.full_name) END,
                               'amount_cents', o.amount_cents, 'status', o.status, 'awaiting', o.awaiting,
                               'created_at', o.created_at,
                               -- A3-77 / A3-62: when the seller's offer closes, and once accepted, the cart line's
                               -- pay-by and whether it is paid (Close this post waits until then).
                               'respond_by', o.respond_by,
                               'checkout_by', (SELECT c.checkout_by FROM public.declutter_cart_items c
                                                WHERE c.offer_id = o.id AND c.buyer_id = v_uid AND c.status = 'in_cart'
                                                ORDER BY c.created_at DESC LIMIT 1),
                               'paid', EXISTS (SELECT 1 FROM public.declutter_cart_items c
                                                WHERE c.offer_id = o.id AND c.buyer_id = v_uid AND c.status = 'paid'),
                               'photo_path', (SELECT ph.storage_path FROM public.declutter_item_photos ph
                                               WHERE ph.item_id = o.item_id ORDER BY ph.position LIMIT 1))
                             ORDER BY o.created_at DESC, o.id)
                       FROM public.declutter_offers o
                       JOIN public.declutter_items i ON i.id = o.item_id
                       LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
                      WHERE o.wanted_id = w.id
                        AND o.buyer_id = v_uid
                        AND NOT public.are_users_blocked(v_uid, o.seller_id)), '[]'::jsonb)
      FROM public.declutter_wanted w
     WHERE w.user_id = v_uid
       AND w.removed_at IS NULL
     ORDER BY (w.status = 'open' AND w.expires_at > now()) DESC, w.created_at DESC
     LIMIT 50;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_my_wanted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_wanted() TO authenticated, service_role;

-- 2. declutter_listed_for_me, from 20261101034159_declutter_list_for_seller.sql
CREATE OR REPLACE FUNCTION public.declutter_listed_for_me()
RETURNS TABLE (item_id uuid, job_id uuid, title text, price_cents integer, floor_price_cents integer,
               helpr_first_name text, sent_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  RETURN QUERY
    SELECT l.item_id, l.job_id, i.title, i.price_cents, pv.floor_price_cents,
           -- CHANGED 20261112052501: '' across a block or a ban (either side); ListedForYouCard then says "Your Helpr".
           CASE WHEN public.declutter_names_hidden(l.seller_id, l.helpr_id) THEN ''
                ELSE split_part(COALESCE(p.full_name, ''), ' ', 1) END, l.sent_at
      FROM public.declutter_listed_for_seller l
      JOIN public.declutter_items i ON i.id = l.item_id
      -- The lowest price the Helpr set, so the seller sees it before approving (lh-authz-rls review, 11-01).
      LEFT JOIN public.declutter_item_private pv ON pv.item_id = l.item_id
      LEFT JOIN public.profiles p ON p.user_id = l.helpr_id
     WHERE l.seller_id = (SELECT auth.uid()) AND i.seller_id = (SELECT auth.uid())
       AND i.status = 'pending_seller_approval'
     ORDER BY l.sent_at, l.created_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_listed_for_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_listed_for_me() TO authenticated, service_role;

-- 3. shops_my_talks, from 20261105185006_shops_talk.sql
CREATE OR REPLACE FUNCTION public.shops_my_talks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.last_at DESC, x.talk_id)
      FROM (
        SELECT t.id AS talk_id,
               CASE WHEN t.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END AS side,
               CASE WHEN t.buyer_id = v_uid THEN s.name
                    -- CHANGED 20261112052501: no first name across a block or a ban (either side).
                    WHEN public.declutter_names_hidden(s.owner_id, t.buyer_id) THEN 'A shopper'
                    ELSE COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = t.buyer_id)), ' ', 1), ''), 'A shopper') END AS other_label,
               last.created_at AS last_at,
               last.sender_side = CASE WHEN t.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END AS last_mine,
               last.created_at > COALESCE(CASE WHEN t.buyer_id = v_uid THEN t.buyer_read_at ELSE t.shop_read_at END, '-infinity'::timestamptz)
                 AND last.sender_side <> CASE WHEN t.buyer_id = v_uid THEN 'buyer' ELSE 'shop' END AS unread
          FROM public.shop_talks t
          JOIN public.shops s ON s.id = t.shop_id
          CROSS JOIN LATERAL (
            SELECT m.created_at, m.sender_side FROM public.shop_talk_messages m
             WHERE m.talk_id = t.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) last
         WHERE t.buyer_id = v_uid OR s.owner_id = v_uid
         ORDER BY last.created_at DESC
         LIMIT 50) x), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_talks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_talks() TO authenticated, service_role;

-- 4. shops_talk_view, from 20261105225245_shops_talk_inbox_and_reports.sql
CREATE OR REPLACE FUNCTION public.shops_talk_view(p_talk_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.shop_talks%ROWTYPE;
  s public.shops%ROWTYPE;
  v_side text;
  v_messages jsonb;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  v_side := public.shop_talk_side(p_talk_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'talk_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO t FROM public.shop_talks WHERE id = p_talk_id;
  SELECT * INTO s FROM public.shops WHERE id = t.shop_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'mine', m.sender_side = v_side, 'body', m.body, 'created_at', m.created_at)
                            ORDER BY m.created_at, m.id), '[]'::jsonb)
    INTO v_messages
    FROM public.shop_talk_messages m WHERE m.talk_id = t.id;
  RETURN jsonb_build_object(
    'talk_id', t.id,
    'shop_id', s.id,
    'side', v_side,
    -- The shop's name for the member; the member's first name for the shop (never a full name or an id).
    'other_label', CASE WHEN v_side = 'buyer' THEN s.name
                        -- CHANGED 20261112052501: no first name across a block or a ban (either side).
                        WHEN public.declutter_names_hidden(s.owner_id, t.buyer_id) THEN 'A shopper'
                        ELSE COALESCE(NULLIF(split_part(btrim((SELECT p.full_name FROM public.profiles p WHERE p.user_id = t.buyer_id)), ' ', 1), ''), 'A shopper') END,
    -- CHANGED (Q1947): the shop-state rule every viewer shares, as the send refuses by it.
    'open', public.shop_state_ok(s.id) AND NOT public.are_users_blocked(t.buyer_id, s.owner_id),
    'messages', v_messages);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_talk_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_talk_view(uuid) TO authenticated, service_role;
