-- Declutter: Louisiana Helpr can refund PART of the price (audit 1b #14; owner decided 2026-10-29: "allow partial").
--
-- WHAT WAS MISSING: after a refund request went to Louisiana Helpr, the admin saw the seller's part offer only as
-- text in the note and could only refund everything or pay the seller.
--
-- WHAT CHANGES (each function restated VERBATIM from its newest definition, with only these edits):
--   * declutter_problems.decision also takes 'refund_part'.
--   * declutter_admin_decide_problem (20261029224147): a seventh parameter p_part_cents integer DEFAULT NULL; the
--     decision 'refund_part' (exactly p_part_cents back, above $0 and below the item price) only after the handover;
--     it runs declutter_refund_after_handover(order, 'refund_request_part', p_part_cents), the path a part refund
--     the buyer accepted already takes (fee policy agreed_part: no card fee kept, the payout rebooked by the amount).
--     The refund request closes as agreed with that refund. Both sides' decision notices say it was part, and the
--     buyer keeps the item. The 6-argument version is dropped; an installed admin screen's call (named arguments,
--     no p_part_cents) resolves to the new one.
--   * declutter_admin_open_problems (20261028195212): also returns the other side's words and photos (D2-3,
--     20261029225634) and the seller's last part offer on the sale's refund request (refund_offer_cents), so the
--     card pre-fills the part refund with it. A new return type needs DROP + CREATE.
--
-- Replay-safe: the constraint is dropped and re-added; DROP FUNCTION IF EXISTS before each signature change.
-- Proof: src/test/pglite/declutterAdminPartRefund.pglite.mjs. Guard: src/test/declutterAdminPartRefund.test.ts.

DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_problems.declutter_problems_decision_check
  -- ACK-REASON: re-added on the next line with every value it had plus 'refund_part'.
  -- ACK-DATA-LOSS: none; every existing row still validates.
  ALTER TABLE public.declutter_problems DROP CONSTRAINT IF EXISTS declutter_problems_decision_check;
  ALTER TABLE public.declutter_problems ADD CONSTRAINT declutter_problems_decision_check
    CHECK (decision IS NULL OR decision IN ('refund_buyer', 'pay_seller', 'delivery_damage', 'refund_part'));
END
$do$;

-- DESTRUCTIVE-DDL-ACK: DROP FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean)
-- ACK-REASON: replaced right below by the same function with a seventh parameter (p_part_cents DEFAULT NULL); a call
-- with the six old named arguments resolves to the new one.
-- ACK-DATA-LOSS: No data: this drops a function definition, not rows.
DROP FUNCTION IF EXISTS public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean);

CREATE OR REPLACE FUNCTION public.declutter_admin_decide_problem(p_problem_id uuid, p_decision text, p_fault text,
  p_strike boolean, p_note text, p_false_report boolean DEFAULT false, p_part_cents integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_out jsonb;
  v_task public.helpr_tasks;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- D2-14 (owner 2026-10-29: allow partial): 'refund_part' gives back exactly p_part_cents of the item price.
  IF p_decision IS NULL OR p_decision NOT IN ('refund_buyer', 'pay_seller', 'refund_part')
     OR (p_decision = 'refund_part') <> (p_part_cents IS NOT NULL)
     OR p_fault IS NULL OR p_fault NOT IN ('seller', 'buyer', 'none')
     OR p_strike IS NULL OR (p_strike AND p_fault = 'none')
     -- AL-5: a false report is its own explicit choice, never NULL; its strike is the false-report strike, not a
     -- second one on top.
     OR p_false_report IS NULL OR (p_false_report AND p_strike) THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    -- Another admin decides a sale you are part of (both reviews, 2026-10-15).
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  -- Slice 5: the order's Helpr task, if any.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id;
  IF v_task.id IS NOT NULL AND v_uid IS NOT DISTINCT FROM v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  -- AL-5 (anti-lying #5, owner 2026-10-28): "The report was false" goes against the person who reported it. Only
  -- a buyer's or a seller's report (a Helpr's report is a delivery matter, struck on the Helpr's own record); the
  -- reporter's side is at fault; and the decision goes the other way: a buyer's false report pays the seller, a
  -- seller's false report refunds the buyer.
  IF p_false_report AND (p.reporter_side NOT IN ('buyer', 'seller') OR p.reporter_id IS NULL
                         OR p_fault IS DISTINCT FROM p.reporter_side
                         OR p_decision IS DISTINCT FROM CASE p.reporter_side WHEN 'buyer' THEN 'pay_seller' ELSE 'refund_buyer' END) THEN
    RAISE EXCEPTION 'false_report_mismatch' USING ERRCODE = '22023',
      HINT = 'A false report goes against whoever reported it: their side is at fault, and the decision goes the other way.';
  END IF;
  -- Slice 5 (lh-money-escrow review #1): refunding the buyer on a delivery the
  -- Helpr already has pays the Helpr for the trip (B69). For an item reported
  -- damaged or not received that would pay the Helpr who may have caused it,
  -- so the admin decides it explicitly instead: "Damaged in delivery" (row 43,
  -- declutter_admin_decide_delivery_damage: the Helpr is not paid) or
  -- "Pay the seller".
  -- B77: after a Helpr's "the seller wasn't there" the item never left the
  -- seller, so "Pay the seller" would close a sale the buyer never received
  -- (lh-money-escrow re-review #2). The admin refunds the buyer instead (whose
  -- fault decides the card fee); the item stays with the seller.
  IF p_decision = 'pay_seller' AND p.reporter_side = 'helpr' THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The item never left the seller. Refund the buyer, and say whose fault it was.';
  END IF;
  IF p_decision IN ('refund_buyer', 'refund_part') AND p.reason IN ('damaged', 'not_received')
     AND v_task.status IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as damaged in delivery, or pay the seller.';
  END IF;
  -- D2-14: a part refund exists only after the handover (the buyer keeps the item; before it, the order is refunded
  -- in full or the sale goes ahead), above $0 and below the item price (declutter_refund_after_handover checks again).
  IF p_decision = 'refund_part' AND o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'part_refund_after_handover_only' USING ERRCODE = '55000',
      HINT = 'A part refund is for an item the buyer keeps. Before the handover, refund in full or pay the seller.';
  END IF;
  IF p_decision = 'refund_part' AND (p_part_cents <= 0 OR p_part_cents >= o.items_cents) THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023',
      HINT = 'A part refund is above $0 and below the item price. To give it all back, choose Refund the buyer.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = p_decision, fault = p_fault, strike_given = p_strike,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF o.status = 'handed_over' THEN
    -- 141d: a problem reported in the window after the handover. The payout is still held (never sent).
    IF p_decision = 'refund_part' THEN
      -- D2-14: exactly the amount decided, the buyer keeps the item; the rest of the payout still goes to the seller.
      v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', p_part_cents);
    ELSIF p_decision = 'pay_seller' THEN
      v_out := jsonb_build_object('result', 'seller_keeps', 'order_id', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
        'We looked at both sides. The seller keeps the payment, and the sale is final.', '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
        'We looked at both sides. You keep the payment; we send it to your payout account.', '/declutter?view=selling', o.buyer_id);
    ELSE
      v_out := public.declutter_refund_after_handover(o.id,
        CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END, NULL);
    END IF;
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Louisiana Helpr decided a reported problem on a Declutter sale against you.',
        (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1));
    END IF;
  ELSIF p_decision = 'pay_seller' THEN
    v_out := public.declutter_complete_handover(o.id, 'admin');
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Louisiana Helpr decided a reported problem on a Declutter sale against you.', NULL);
    END IF;
  ELSE
    v_out := public.declutter_close_paid_order(o.id,
      CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END,
      CASE WHEN p_strike THEN p_fault END,
      CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
      'Louisiana Helpr decided a reported problem on a Declutter sale against you.');
  END IF;
  -- D2-5 (audit 1b #5): a refund request that came to the admin with this problem ends with the decision, so
  -- neither refund panel keeps saying "Louisiana Helpr is looking". A refund closes it as agreed (with the
  -- refund), paying the seller closes it as declined. Only on a handed-over sale: a request exists only there.
  IF o.status = 'handed_over' THEN
    UPDATE public.declutter_refund_requests
       SET status = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN 'agreed' ELSE 'declined' END,
           refund_id = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN (v_out->>'refund_id')::uuid ELSE refund_id END,
           settled_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN now() ELSE settled_at END,
           declined_at = CASE WHEN p_decision IN ('refund_buyer', 'refund_part') THEN declined_at ELSE now() END
     WHERE order_id = o.id AND problem_id = p.id AND status = 'to_admin';
  END IF;
  -- A2-14 (20261028223738): both sides are told the decision. The one path that already said it (a sale already
  -- handed over, "Pay the seller", above) is left as it is; every other path only sent the handover or refund
  -- notice, which never said Louisiana Helpr had decided. A refund's amount stays in its own notice.
  IF NOT (o.status = 'handed_over' AND p_decision = 'pay_seller') THEN
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'
             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'
             WHEN p_decision = 'pay_seller' THEN 'The seller keeps the payment, and the sale is final.'
             WHEN p_decision = 'refund_part' THEN 'We are refunding you part of the price, and you keep the item. A separate notice says how much.'
             ELSE 'We are refunding you. A separate notice says how much.' END),
      '/declutter?tab=buying', o.seller_id);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at both sides of the problem with %s. %s', public.declutter_order_items_named(o.id),
        CASE WHEN o.paid_with = 'free' AND p_decision = 'pay_seller' THEN 'The handover stands.'
             WHEN o.paid_with = 'free' THEN 'This free pickup is cancelled.'
             WHEN p_decision = 'pay_seller' THEN 'You keep the payment.'
             WHEN p_decision = 'refund_part' THEN 'We are refunding the buyer part of the price; it comes out of your payout for this sale, and the buyer keeps the item.'
             ELSE 'We are refunding the buyer, so this sale is cancelled.' END),
      '/declutter?tab=selling', o.buyer_id);
  END IF;
  -- AL-5: the reporter's Declutter strike for a proven false report (3 active strikes = locked out of Declutter,
  -- declutter_assert_member). Given after the decision, so a refusal above gives none; recorded on the problem
  -- (strike_given) and in the audit row.
  IF p_false_report THEN
    UPDATE public.declutter_problems SET strike_given = true WHERE id = p.id;
    PERFORM public.declutter_give_strike(p.reporter_id, p.reporter_side, 'false_report',
      (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
      'Louisiana Helpr looked at the problem you reported on a Declutter sale and found it was not true.', NULL);
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', p_decision, 'fault', p_fault, 'strike', p_strike,
                             'false_report', p_false_report, 'part_cents', p_part_cents, 'result', v_out));
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text, boolean, integer) TO authenticated, service_role;

-- DESTRUCTIVE-DDL-ACK: DROP FUNCTION public.declutter_admin_open_problems(boolean)
-- ACK-REASON: re-created right below with the same argument and three more result columns (a new return type cannot
-- be made with CREATE OR REPLACE).
-- ACK-DATA-LOSS: No data: this drops a function definition, not rows.
DROP FUNCTION IF EXISTS public.declutter_admin_open_problems(boolean);

CREATE OR REPLACE FUNCTION public.declutter_admin_open_problems(p_include_test boolean DEFAULT false)
RETURNS TABLE(problem_id uuid, order_id uuid, reporter_side text, reason text, note text, problem_photo_paths text[],
  reported_at timestamptz, handover text, order_status text, items_cents integer, bundle_discount_cents integer,
  delivery_cents integer, premium_cents integer, tax_cents integer, total_cents integer, paid_at timestamptz,
  item_titles text[], item_photo_paths text[], buyer_id uuid, buyer_name text, seller_id uuid, seller_name text,
  set_out_photo_path text, set_out_at timestamptz, picked_up_photo_path text, picked_up_at timestamptz,
  picked_up_distance_m integer, confirmed_at timestamptz, confirmed_by text, helpr_delivery boolean,
  other_side_note text, other_side_photo_paths text[], refund_offer_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.order_id, p.reporter_side, p.reason, p.note, p.photo_paths, p.created_at,
           o.handover, o.status, o.items_cents, o.bundle_discount_cents, o.delivery_cents, o.premium_cents,
           o.tax_cents, o.total_cents, o.paid_at,
           li.titles, li.photos,
           o.buyer_id, CASE WHEN o.buyer_id IS NULL THEN NULL ELSE public.member_display_name(bp.full_name) END,
           o.seller_id, CASE WHEN o.seller_id IS NULL THEN NULL ELSE public.member_display_name(sp.full_name) END,
           h.set_out_photo_path, h.set_out_at, h.picked_up_photo_path, h.picked_up_at, h.picked_up_distance_m,
           h.confirmed_at, h.confirmed_by,
           o.handover = 'delivery',
           -- D2-3 / D2-14: the other side's words and photos, and the seller's last part offer on the refund request.
           p.other_side_note, p.other_side_photo_paths, rr.offer_cents
      FROM public.declutter_problems p
      JOIN public.declutter_orders o ON o.id = p.order_id
      LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
      LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
      LEFT JOIN public.declutter_handovers h ON h.order_id = o.id
      LEFT JOIN public.declutter_refund_requests rr ON rr.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(array_agg(i.title ORDER BY c.created_at, c.id), ARRAY[]::text[]) AS titles,
               COALESCE(array_agg((SELECT ph.storage_path FROM public.declutter_item_photos ph
                                    WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1)
                                  ORDER BY c.created_at, c.id), ARRAY[]::text[]) AS photos
          FROM public.declutter_cart_items c
          LEFT JOIN public.declutter_items i ON i.id = c.item_id
         WHERE c.order_id = o.id
      ) li ON true
     WHERE p.status = 'open'
       AND (COALESCE(p_include_test, false) OR NOT o.is_seed)
     ORDER BY p.created_at, p.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_open_problems(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_open_problems(boolean) TO authenticated, service_role;
