-- Blockers 7 (2026-11-03, "Nothing slow for users"; lead PASS 2026-11-03): the nav's To-do badge (NeedsYouBridge,
-- mounted on every signed-in page after the page's own reads) made six separate reads on every page load:
-- declutter_my_cart, declutter_my_offers, declutter_my_refund_todos, declutter_free_requests, backout_notices and
-- shop_orders (a11y-prod 41598471444: ~480-530 each over 605 tests). This is ONE read that returns all six, so a
-- signed-in page makes one request for them instead of six.
--
-- READ ONLY, no money, no write. SECURITY INVOKER: it reads nothing the caller cannot read today. The three wrapped
-- functions already scope to auth.uid() (they are what the client calls now); the three table reads run under the
-- caller's RLS AND carry an auth.uid() filter (prod RLS, read 2026-11-03: backout_notices user_id = auth.uid(),
-- declutter_free_requests requester or seller, shop_orders buyer or seller; the read narrows each to the badge's side). No id argument: p_keys names only WHICH sections
-- to read (the client sends the ones whose feature switch is on), never whose.
--
-- A section that errors returns null for its key (its own EXCEPTION block), never failing the whole read: the client
-- falls back to that section's old single call, so the badge never goes blank because one section broke (lead).
-- A key not asked for is absent. Signed out: raises not_authenticated (42501), as the wrapped functions do.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a new function; the grants are restated after it.

CREATE OR REPLACE FUNCTION public.my_badge_reads(p_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_out jsonb := '{}'::jsonb;
  v_part jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF 'cart' = ANY (p_keys) THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_part FROM public.declutter_my_cart() c;
    EXCEPTION WHEN OTHERS THEN
      v_part := NULL;
    END;
    v_out := v_out || jsonb_build_object('cart', v_part);
  END IF;

  IF 'offers' = ANY (p_keys) THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO v_part FROM public.declutter_my_offers() o;
    EXCEPTION WHEN OTHERS THEN
      v_part := NULL;
    END;
    v_out := v_out || jsonb_build_object('offers', v_part);
  END IF;

  IF 'refund_todos' = ANY (p_keys) THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_part FROM public.declutter_my_refund_todos() r;
    EXCEPTION WHEN OTHERS THEN
      v_part := NULL;
    END;
    v_out := v_out || jsonb_build_object('refund_todos', v_part);
  END IF;

  IF 'free_asks' = ANY (p_keys) THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'item_id', f.item_id, 'created_at', f.created_at,
               'declutter_items', jsonb_build_object('title', i.title))
             ORDER BY f.created_at ASC), '[]'::jsonb)
        INTO v_part
        FROM public.declutter_free_requests f
        JOIN public.declutter_items i ON i.id = f.item_id
       WHERE f.seller_id = v_uid AND f.status = 'open';
    EXCEPTION WHEN OTHERS THEN
      v_part := NULL;
    END;
    v_out := v_out || jsonb_build_object('free_asks', v_part);
  END IF;

  IF 'backout' = ANY (p_keys) THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', b.id, 'job_id', b.job_id, 'backout_kind', b.backout_kind, 'actor_name', b.actor_name)
             ORDER BY b.created_at DESC), '[]'::jsonb)
        INTO v_part
        FROM public.backout_notices b
       WHERE b.user_id = v_uid AND b.acknowledged_at IS NULL;
    EXCEPTION WHEN OTHERS THEN
      v_part := NULL;
    END;
    v_out := v_out || jsonb_build_object('backout', v_part);
  END IF;

  IF 'shop_orders' = ANY (p_keys) THEN
    BEGIN
      SELECT COALESCE(jsonb_agg(x.o ORDER BY x.created_at DESC), '[]'::jsonb)
        INTO v_part
        FROM (
          SELECT so.created_at,
                 jsonb_build_object(
                   'id', so.id, 'buyer_id', so.buyer_id, 'seller_id', so.seller_id, 'shop_id', so.shop_id,
                   'status', so.status, 'close_reason', so.close_reason, 'ready_date', so.ready_date,
                   'cancel_policy', so.cancel_policy, 'ready_tap_cancel', so.ready_tap_cancel, 'note', so.note,
                   'decline_reason', so.decline_reason, 'items_cents', so.items_cents,
                   'premium_cents', so.premium_cents, 'tax_cents', so.tax_cents, 'total_cents', so.total_cents,
                   'created_at', so.created_at, 'held_at', so.held_at, 'accept_by', so.accept_by,
                   'accepted_at', so.accepted_at, 'captured_at', so.captured_at, 'closed_at', so.closed_at,
                   'handover_mode', so.handover_mode, 'handed_over_at', so.handed_over_at,
                   'shop_order_lines', COALESCE((
                     SELECT jsonb_agg(jsonb_build_object(
                              'id', l.id, 'item_id', l.item_id, 'title', l.title, 'kind', l.kind,
                              'unit_cents', l.unit_cents, 'quantity', l.quantity, 'line_cents', l.line_cents))
                       FROM public.shop_order_lines l WHERE l.order_id = so.id), '[]'::jsonb)
                 ) AS o
            FROM public.shop_orders so
           WHERE so.seller_id = v_uid AND so.status NOT IN ('awaiting_hold', 'superseded')
           ORDER BY so.created_at DESC
           LIMIT 100
        ) x;
    EXCEPTION WHEN OTHERS THEN
      v_part := NULL;
    END;
    v_out := v_out || jsonb_build_object('shop_orders', v_part);
  END IF;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.my_badge_reads(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_badge_reads(text[]) TO authenticated;
