-- A3-77 / A3-62 (audit 11-01): the poster's Wanted card had no deadline on a seller's reply (the offer closes at
-- respond_by, 48 h) and, once accepted, said "Close this post" instead of "check out by <time>". declutter_my_wanted's
-- replies now carry respond_by, the accepted offer's in-cart checkout_by, and paid. Read-only, the caller's own rows
-- only (o.buyer_id = v_uid, and c.buyer_id = v_uid on the cart reads); same signature, gates and grants.
-- Restated from 20261030221255 (the newest definition); applied 3x in PGlite
-- (src/test/pglite/declutterMyWantedReplyDeadlines.pglite.mjs).

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
                               'seller_name', public.member_display_name(sp.full_name),
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
