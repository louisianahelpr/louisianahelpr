-- Declutter: the SELLER's ID check moves from the first listing to the first payout (owner 11-12 1:00 AM, pop-up;
-- OWNER-DECISIONS.md: "seller ID check moves from first listing to FIRST PAYOUT. Listings go live right away; ID
-- verified before the first payout is sent." Supersedes the 10-22 / 10-30 "seller at listing" timing). A real member
-- quit at the ID sheet six seconds after making her first listing.
--
-- 1. LISTING: trg_declutter_items_identity_before_list (20261021202226) is dropped with its function, so a listing
--    goes up (draft or paused -> pending_review / live, or an INSERT straight in) with no ID check. A draft that was
--    refused before (identity_required_to_list) can now be published as it is. declutter_identity_gate stays: the
--    BUYER's gates (offer, counter, order) and Shops' list gate (20261105174853, shop_identity_before_list) call it,
--    and are unchanged. The setup fee is unchanged (it already comes out of the payout while the switch is on,
--    20261031214749).
-- 2. PAYOUT: unchanged here, because the hold already exists: declutter-money's stillPayableNow ("declutter" kind,
--    right before the transfer) asks payout_waits_on_identity through checkIdentityHold and, while it waits, skips the
--    row with no try used and records an 'identity' wait (payout_payee_wait_seen: the seller is reminded, ops alerted
--    past its limit); the payout_transfers claim trigger asks the same question. The first run after the seller
--    verifies sends it. (lh-money-escrow review 11-12: a second hold in declutter_payouts_due would hide the row from
--    that reminder and alert, and from the reconcile step, so it is NOT added.) Buyers are unaffected: their money is
--    held until the handover and the 24 hours either way.
-- 3. NOTICE: declutter_complete_handover's seller notice ("Handover done") says "Verify your ID to get paid $X" when
--    the payout will wait on the ID check, and its link opens the ID sheet (?verify_id=1). Restated from its newest
--    definition (20261109224952) with only the two places marked "CHANGED (owner 11-12".
-- Replay-safe: DROP ... IF EXISTS, CREATE OR REPLACE with the same signature and return type; grants restated.
-- Proof: src/test/pglite/sellerIdAtFirstPayout.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).

DROP TRIGGER IF EXISTS trg_declutter_items_identity_before_list ON public.declutter_items;
DROP FUNCTION IF EXISTS public.declutter_identity_before_list();

CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
  -- Manager mode phase 2: the manager's share of this sale (0 when none was locked at payment).
  v_share integer := 0;
  v_ms public.declutter_order_manager_shares;
  v_mpay uuid;
  v_split text := '';
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Our team decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    -- CHANGED (BUY-36): or the buyer collected it from a Helpr who couldn't finish (helpr_task_customer_confirm failed the task, unpaid).
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed')
          OR (v_task.status = 'failed' AND v_task.stuck_stage = 'collecting') THEN
      -- Already confirmed, or the damage decision (row 43) that failed the
      -- task itself and refunds the whole order on its own: nothing more here.
      NULL;
    ELSIF p_by = 'admin' AND (v_task.id IS NULL OR v_task.status IN ('open', 'accepted')) THEN
      IF v_task.id IS NOT NULL THEN
        PERFORM public.helpr_task_close(v_task.id, 'cancelled', 'The sale was decided without a delivery');
      END IF;
      PERFORM public.declutter_delivery_refund(o.id, 'delivery_not_done');
    ELSE
      RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
        HINT = 'The Helpr has not picked the item up yet.';
    END IF;
  END IF;
  -- Seller delivery: the rate is the seller's, paid with the items.
  v_rate := CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  -- A free claim (20261027170717): no money is owed either way, so no payout row and no payout words.
  IF o.paid_with = 'free' THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
      format('Thank you for giving away %s. It has a new home.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=selling', o.buyer_id);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
      format('The handover of %s is done. Leave the giver a review.', public.declutter_order_items_named(o.id)),
      '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'handed_over', 'payout_id', NULL, 'by', p_by, 'free', true);
  END IF;
  -- Manager mode phase 2 (lead 11-01): the share comes off first (items + rate - share), then the fee debt and the
  -- setup fee from what is left, so the seller's row is never negative and a debt never reduces the manager's share.
  SELECT * INTO v_ms FROM public.declutter_order_manager_shares s WHERE s.order_id = o.id;
  v_share := public.declutter_manager_share_cents(o.id);
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate - v_share);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, manager_share_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_share, v_debt, o.items_cents + v_rate - v_share - v_debt,
          CASE WHEN o.items_cents + v_rate - v_share - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The manager's own row: a SEPARATE transfer to their own payout account (declutter-money), never through the seller.
  IF v_payout IS NOT NULL AND v_ms.order_id IS NOT NULL AND v_ms.manager_id IS NOT NULL THEN
    INSERT INTO public.declutter_manager_payouts (order_id, seller_payout_id, grant_id, seller_id, manager_id, share_cents, amount_cents, status)
    VALUES (o.id, v_payout, v_ms.grant_id, o.seller_id, v_ms.manager_id, v_share, v_share,
            CASE WHEN v_share = 0 THEN 'nothing_due' ELSE 'pending' END)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING id INTO v_mpay;
    IF v_mpay IS NOT NULL AND v_share > 0 THEN
      v_split := format('$%s sale · $%s to %s%s · $%s to you. ',
        to_char((o.items_cents + v_rate) / 100.0, 'FM999990.00'), to_char(v_share / 100.0, 'FM999990.00'),
        public.declutter_manager_first_name(v_ms.manager_id),
        CASE WHEN v_ms.share_type = 'percent' THEN ' (' || v_ms.share_pct::text || '%)' ELSE '' END,
        to_char((o.items_cents + v_rate - v_share) / 100.0, 'FM999990.00'));
      -- declutter_sales, by choice (declutterNoticeKinds): the manager's share is a sale notice, under the Declutter switch.
      PERFORM public.declutter_notify(v_ms.manager_id, 'declutter_sales', 'You earned a share',
        format('You earned $%s from %s''s sale of %s. ', to_char(v_share / 100.0, 'FM999990.00'),
               public.declutter_manager_first_name(o.seller_id), public.declutter_order_items_named(o.id)) ||
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = v_ms.manager_id AND pr.stripe_account_id IS NOT NULL) THEN
            'Next: set up payouts in Settings to get it. We send it as soon as you do and the sale is final.'
          WHEN p_by = 'admin' THEN 'It is on its way to your payout account.'
          ELSE 'We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.'
        END,
        '/declutter?tab=selling', o.seller_id);
    END IF;
  END IF;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    format('The handover of %s is done. ', public.declutter_order_items_named(o.id)) || v_split ||
    CASE
      WHEN o.items_cents + v_rate - v_share - v_debt = 0 THEN
        format('This sale paid off the $%s you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      -- CHANGED (owner 11-12 1:00 AM): the seller's ID check is asked before their first payout, not at listing.
      -- The payout waits (declutter-money: checkIdentityHold) until they are verified, and this notice says so first.
      WHEN public.payout_waits_on_identity(o.seller_id) THEN
        format('Verify your ID to get paid $%s. It takes about 2 minutes, once.%s We send it once you''re verified%s.',
               to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'),
               CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL)
                    THEN ' Then set up payouts in Settings.' ELSE '' END,
               CASE WHEN p_by = 'admin' THEN '' ELSE ' and the sale is final, 24 hours after the handover, unless the buyer asks for a refund' END)
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_share - v_debt) / 100.0, 'FM999990.00'))
    END
    -- Kept from B49's 20261031214749 (train 5). Owner 2026-10-30: said before the money moves. Taken when the payout is sent (declutter_payout_take_setup_fee).
    || CASE WHEN public.declutter_setup_fee_from_payout_cents(o.seller_id) > 0
              AND o.items_cents + v_rate - v_share - v_debt - public.declutter_setup_fee_from_payout_cents(o.seller_id) >= 100 THEN
         format(' Your one-time $%s account setup fee comes out of your payout. It is only ever charged once.',
                to_char(public.declutter_setup_fee_from_payout_cents(o.seller_id) / 100.0, 'FM999990.00'))
       ELSE '' END,
    -- CHANGED (owner 11-12): a seller whose payout waits on the ID check lands on the ID sheet (?verify_id=1).
    CASE WHEN o.items_cents + v_rate - v_share - v_debt > 0 AND public.payout_waits_on_identity(o.seller_id)
         THEN '/declutter?tab=selling&verify_id=1&verify_reason=get_paid' ELSE '/declutter?tab=selling' END, o.buyer_id);
  -- 20261028232338: a caller that tells the buyer its own outcome (declutter_admin_decide_delivery_damage: refunded in full)
  -- names this order in declutter.no_enjoy_notice for its transaction, so the buyer never also reads "the sale is final".
  IF COALESCE(current_setting('declutter.no_enjoy_notice', true), '') IS DISTINCT FROM o.id::text THEN
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    format('The handover of %s is done', public.declutter_order_items_named(o.id)) ||
    CASE WHEN p_by = 'admin' THEN ' and the sale is final. Leave the seller a review.'
         ELSE '. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.' END
    || CASE WHEN public.declutter_delivery_tip_open(o.id) THEN ' You can add a tip for your Helpr in Buying.' ELSE '' END,
    '/declutter?view=cart', o.seller_id);
  END IF;
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by)
         || CASE WHEN v_task_out IS NOT NULL THEN jsonb_build_object('helpr_payout_id', v_task_out->'helpr_payout_id') ELSE '{}'::jsonb END;
END;
$function$
;

REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;
