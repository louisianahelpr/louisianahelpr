-- Declutter audit 3 server fixes (lead 2026-10-28; ~/.lh-shots/declutter-audit3-1028/REPORT.md, audit 2 LO2-1 / SE2-4 / A3-4).
--
--   1. declutter_seller_delivery_offer (restated from 20261027153244): an empty cart with this seller ANSWERS
--      {available: false, reason: 'cart_empty', slots: []} instead of raising cart_empty, which Buying turned
--      into a 500 and an error_logs row on every load. Still asked before the seller is looked at (no oracle).
--   2. declutter_admin_review_item (restated from 20261027182550): "Your listing is live" / "Your listing needs
--      a change" open /declutter?tab=selling (was the retired ?view=selling).
--   3. declutter_listing_submitted_notice (restated from 20261028162048): the 10-minute skip is gone, so a
--      second or third listing also tells the seller "Listing sent for review" / "Your listing is live". Each
--      notice already names its item, so none is dropped as a duplicate (suppress_exact_duplicate_notification
--      compares the message). A moving sale that lists 30 things sends 30 notices (the lead's call, 2026-10-28).
--   4. The seller's Helpr-delivery notices open Selling (/declutter?tab=selling), never the buyer's ?view=cart:
--      declutter_delivery_on_task_event's "Helpr pickup booked", "Pickup time cancelled", "Picked up", "The
--      buyer will pick it up" and "The Helpr couldn't pick up" (was ?view=sales), restated from its EFFECTIVE
--      definition (20261018184535 as rewritten in place by 20261027172503); declutter_delivery_open_task's
--      "A Helpr will pick it up" (restated from 20261017055505). The buyer's notices are unchanged.
-- Everything else in each body is verbatim. CREATE OR REPLACE keeps each function's grants.
-- Proof: src/test/pglite/declutterAudit3Server.pglite.mjs (applied 3x).

-- 1. The empty cart answers.
CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_offer(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_lines uuid[];
  v_rules jsonb := public.declutter_seller_delivery_rules();
  c record;
  v_open uuid;
  v_held timestamptz;
  v_slots timestamptz[] := '{}';
  v_reason text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  v_uid := public.declutter_assert_member(false);
  IF p_seller_id IS NULL OR p_seller_id = v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_lines := ARRAY(SELECT x.id FROM public.declutter_cart_items x
                    WHERE x.buyer_id = v_uid AND x.seller_id = p_seller_id AND x.status = 'in_cart'
                      AND x.checkout_by > now() ORDER BY x.id);
  -- Nothing from this seller is waiting (audit 2 LO2-1, 20261028200440): an answer, not an error. Asked before
  -- the seller is looked at, so it says nothing about the seller (no schedule or ban oracle).
  IF cardinality(v_lines) = 0 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'cart_empty', 'rate_cents', NULL, 'base_rate_cents', NULL,
      'free_over_cents', NULL, 'items_cents', NULL, 'radius_miles', NULL, 'dropoff_area', NULL,
      'slot_minutes', (v_rules ->> 'slot_minutes')::integer, 'slots', '[]'::jsonb, 'held_slot', NULL);
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
  SELECT o.id INTO v_open FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment';
  SELECT d.slot_start INTO v_held FROM public.declutter_seller_deliveries d
   WHERE d.order_id = v_open AND d.status = 'held' AND d.held_until > now();
  IF c.reason IS NULL THEN
    v_slots := ARRAY(SELECT s FROM public.declutter_delivery_open_slots(p_seller_id, v_open) s);
  END IF;
  v_reason := COALESCE(c.reason, CASE WHEN cardinality(v_slots) = 0 THEN 'no_times' END);
  RETURN jsonb_build_object(
    'available', v_reason IS NULL,
    'reason', v_reason,
    -- What this order pays (0 = free) and why: the seller's rate, their free-delivery amount,
    -- and this order's items total from the seller (owner 2026-10-27).
    'rate_cents', c.rate_cents,
    'base_rate_cents', c.base_rate_cents,
    'free_over_cents', c.free_over_cents,
    'items_cents', c.items_cents,
    'radius_miles', c.radius_miles,
    'dropoff_area', c.dropoff_area,
    'slot_minutes', (v_rules ->> 'slot_minutes')::integer,
    'slots', to_jsonb(v_slots),
    'held_slot', v_held);
END;
$fn$;

-- 2. The approval's notices open the Selling tab.
CREATE OR REPLACE FUNCTION public.declutter_admin_review_item(p_item_id uuid, p_approve boolean, p_note text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
  v_status text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_title text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required'
      USING ERRCODE = '22023', HINT = 'Say why the listing is not approved.';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT seller_id INTO v_seller FROM public.declutter_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  -- lh-authz-rls review must-fix 1: an admin never reviews their own listing.
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '42501', HINT = 'Another admin must review your own listing.';
  END IF;
  -- Must-fix 2: approval puts the listing in front of buyers NOW, so the
  -- seller must still be allowed to sell now: not banned, fewer than 3
  -- active Declutter strikes, not under 18, payout setup done.
  IF p_approve AND (
       EXISTS (SELECT 1 FROM public.profiles pr
                WHERE pr.user_id = v_seller
                  AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                  AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
       OR public.declutter_active_strike_count(v_seller) >= 3
       OR public.member_under_18(v_seller)) THEN
    -- No payout check (owner 2026-10-27, list first, set up at first sale).
    RAISE EXCEPTION 'seller_not_eligible'
      USING ERRCODE = '22023', HINT = 'The seller cannot sell right now (restricted, strikes or age). Reject it instead.';
  END IF;

  v_status := CASE WHEN p_approve THEN 'live' ELSE 'rejected' END;
  UPDATE public.declutter_items
     SET status = v_status,
         admin_approved_at = CASE WHEN p_approve THEN now() ELSE admin_approved_at END,
         live_at = CASE WHEN p_approve THEN now() ELSE live_at END,
         updated_at = now()
   WHERE id = p_item_id AND status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.declutter_item_private SET review_note = v_note, updated_at = now() WHERE item_id = p_item_id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'declutter_listing_approved' ELSE 'declutter_listing_rejected' END,
          'declutter_item', p_item_id::text, jsonb_build_object('note', v_note));
  -- Q2414 (owner walkthrough 2026-10-27): the seller hears the decision, as the
  -- Selling tab promises. Through declutter_notify (bell + push, respects prefs).
  SELECT title INTO v_title FROM public.declutter_items WHERE id = p_item_id;
  IF p_approve THEN
    PERFORM public.declutter_notify(v_seller, 'info', 'Your listing is live',
      '"' || COALESCE(v_title, 'Your item') || '" is approved. Buyers can see it now.',
      '/declutter?tab=selling', v_uid);
  ELSE
    PERFORM public.declutter_notify(v_seller, 'info', 'Your listing needs a change',
      '"' || COALESCE(v_title, 'Your item') || '" wasn''t approved: ' || v_note,
      '/declutter?tab=selling', v_uid);
  END IF;
  RETURN v_status;
END;
$function$;

-- 3. Every listing sent tells the seller.
CREATE OR REPLACE FUNCTION public.declutter_listing_submitted_notice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_title text;
  v_name text := COALESCE(NULLIF(btrim(NEW.title), ''), 'Your item');
BEGIN
  IF NEW.status NOT IN ('pending_review', 'live')
     OR (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_title := CASE WHEN NEW.status = 'live' THEN 'Your listing is live' ELSE 'Listing sent for review' END;
    IF NEW.status = 'live' THEN
      PERFORM public.declutter_notify(NEW.seller_id, 'declutter_listings', v_title,
        '"' || v_name || '" is live. Buyers can see it now.',
        '/declutter/item/' || NEW.id::text);
    ELSE
      PERFORM public.declutter_notify(NEW.seller_id, 'declutter_listings', v_title,
        'We''re checking "' || v_name || '" before buyers see it. We''ll tell you when it''s live.',
        '/declutter?tab=selling');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'declutter_listing_submitted_notice: item %: %', NEW.id, SQLERRM;
    PERFORM public.log_cron_defect('declutter_listing_submitted_notice', NEW.id::text, SQLERRM);
  END;
  RETURN NULL;
END;
$fn$;

-- 4a. The seller's Helpr-delivery notices open Selling.
CREATE OR REPLACE FUNCTION public.declutter_delivery_on_task_event(p_order_id uuid, p_task uuid, p_event text, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  t public.helpr_tasks;
  v_out jsonb;
  v_refund uuid;
  v_problem uuid;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF p_event = 'accepted' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'A Helpr took your delivery',
      format('Pickup from the seller is %s. They leave it at your door with a photo.',
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Helpr pickup booked',
      format('A Helpr picks up your item %s. Have it ready.',
             to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?tab=selling', t.helpr_id);
  ELSIF p_event = 'released' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Finding another Helpr',
      'Your Helpr can''t make it. Your delivery is back up for another Helpr.', '/declutter?view=cart', NULL);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Pickup time cancelled',
      'The Helpr can''t make it. You''ll be told the new pickup time.', '/declutter?tab=selling', NULL);
  ELSIF p_event = 'picked_up' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is on its way',
      'The Helpr picked up your item. They leave it at your door with a photo; tap "I got it" when you have it.', '/declutter?view=cart', t.helpr_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Picked up',
      'The Helpr picked up your item. You''re paid when the buyer has it.', '/declutter?tab=selling', t.helpr_id);
  ELSIF p_event = 'delivered' THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivered',
      'The Helpr left your item at the drop-off address. Tap "I got it", or report a problem within 24 hours.',
      '/declutter?view=cart', t.helpr_id);
  ELSIF p_event = 'confirmed' THEN
    -- The handover IS the delivery: the seller is paid (and the Helpr, below).
    v_out := public.declutter_complete_handover(o.id,
      CASE p_by WHEN 'code' THEN 'code' WHEN 'customer' THEN 'buyer' WHEN 'admin' THEN 'admin' ELSE 'auto' END);
    RETURN v_out;
  ELSIF p_event = 'unfilled' THEN
    -- Row 40: no Helpr in 48 h. The delivery fee goes back in full; the order
    -- becomes a pickup at the seller's home; the 7-day clock keeps running.
    IF o.status = 'paid' AND o.handover = 'delivery' THEN
      v_refund := public.declutter_delivery_refund(o.id, 'no_helpr');
      -- B76: a Helpr who backed out or never came late in the week can leave
      -- the buyer too little time to book a pickup, and the handover sweep
      -- would then close it as the BUYER's no-show (strike, fee kept). With
      -- under 48 h to the 7-day deadline the sale is closed instead as no one's
      -- fault: the delivery fee back in full (above), the rest under the
      -- no-fault policy (row 100: the card fee is kept), no strike, the item
      -- back on sale.
      IF o.paid_at + interval '7 days' < now() + interval '48 hours' THEN
        PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your delivery fell through',
          'No Helpr could deliver in time, so this sale is cancelled. What you paid for delivery comes back in full, and most of the rest of your payment.',
          '/declutter?view=cart', o.seller_id);
        v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
        RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund, 'closed', v_out);
      END IF;
      UPDATE public.declutter_orders SET handover = 'pickup_home' WHERE id = o.id AND status = 'paid';
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'No Helpr took your delivery',
        format('The $%s you paid for delivery is coming back to your card. Book a time to pick up at the seller''s home before your 7-day deadline.',
               to_char(o.delivery_cents / 100.0, 'FM999990.00')),
        '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'The buyer will pick it up',
        'No Helpr took this delivery, so the buyer will book a pickup at your home.', '/declutter?tab=selling', o.buyer_id);
    END IF;
    RETURN jsonb_build_object('result', 'unfilled', 'delivery_refund_id', v_refund);
  ELSIF p_event = 'pickup_no_show' THEN
    -- B67 (revised 2026-10-16 after lh-authz-rls #3): the Helpr's report, with
    -- a photo at the pickup point, opens a problem on the order. The money
    -- waits (the problem holds it; the task stays taken, so the Helpr is not
    -- counted a no-show) and an admin decides: a seller no-show = refund the
    -- buyer, the seller's fault (row 19: everything back, card fee to the
    -- seller's debt, a strike); or pay the seller (the delivery fee goes
    -- back, B70).
    -- The Helpr's photo goes on the problem so the admin sees the evidence
    -- (lh-silent-failure re-review #1); p_by carries "<metres> m|<photo path>".
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths, is_seed)
    VALUES (o.id, t.helpr_id, 'helpr', 'no_show',
            format('The Helpr says the seller wasn''t there for the pickup at %s. Their photo at the pickup address (%s m away) is on the delivery.',
                   to_char(t.pickup_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD FMHH12:MI AM'), COALESCE(split_part(p_by, '|', 1), '?')),
            CASE WHEN NULLIF(split_part(p_by, '|', 2), '') IS NULL THEN '{}'::text[] ELSE ARRAY[split_part(p_by, '|', 2)] END,
            o.is_seed)
    RETURNING id INTO v_problem;
    PERFORM public.declutter_notify(o.seller_id, 'info', 'The Helpr couldn''t pick up',
      'The Helpr says you weren''t there for the pickup. Louisiana Helpr will look at it and decide; the money waits until then.',
      '/declutter?tab=selling', t.helpr_id);
    PERFORM public.declutter_notify(o.buyer_id, 'info', 'Your delivery is on hold',
      'The Helpr couldn''t pick up your item from the seller. Louisiana Helpr will look at it and decide; you''ll be told.',
      '/declutter?view=cart', t.helpr_id);
    RETURN jsonb_build_object('result', 'reported', 'problem_id', v_problem);
  END IF;
  RETURN jsonb_build_object('result', p_event);
END;
$fn$;

-- 4b. The seller's "A Helpr will pick it up" opens Selling.
CREATE OR REPLACE FUNCTION public.declutter_delivery_open_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  od public.declutter_order_deliveries;
  v_task uuid;
  v_title text;
  v_addr text;
  v_lat numeric;
  v_lng numeric;
  v_area text;
BEGIN
  IF NEW.status <> 'paid' OR OLD.status = 'paid' OR NEW.handover <> 'delivery' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO od FROM public.declutter_order_deliveries WHERE order_id = NEW.id;
  IF NOT FOUND OR od.task_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(i.title, ', ' ORDER BY c.id),
         (array_agg(p.pickup_address ORDER BY c.id))[1],
         (array_agg(p.pickup_lat ORDER BY c.id))[1],
         (array_agg(p.pickup_lng ORDER BY c.id))[1],
         (array_agg(i.area_label ORDER BY c.id))[1]
    INTO v_title, v_addr, v_lat, v_lng, v_area
    FROM public.declutter_cart_items c
    JOIN public.declutter_items i ON i.id = c.item_id
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = NEW.id;
  v_task := public.helpr_task_create('declutter_delivery', NEW.id, od.size, COALESCE(v_title, 'Declutter delivery'),
    COALESCE(v_area, 'Louisiana'), v_addr, v_lat, v_lng,
    od.dropoff_area, od.dropoff_address, od.dropoff_lat, od.dropoff_lng, od.road_miles, NEW.delivery_cents,
    NEW.buyer_id, NEW.seller_id,
    least(COALESCE(NEW.paid_at, now()) + interval '48 hours', COALESCE(NEW.paid_at, now()) + interval '7 days' - interval '2 hours'),
    COALESCE(NEW.paid_at, now()) + interval '7 days', NEW.is_seed);
  UPDATE public.declutter_order_deliveries SET task_id = v_task WHERE order_id = NEW.id;
  PERFORM public.declutter_notify(NEW.seller_id, 'payment', 'A Helpr will pick it up',
    'Your buyer chose Helpr delivery. We''re finding a Helpr; you''ll be told the pickup time.', '/declutter?tab=selling', NEW.buyer_id);
  RETURN NEW;
END;
$fn$;
