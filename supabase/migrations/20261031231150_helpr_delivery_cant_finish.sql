-- BUY-36 (Declutter buying audit, owner's rulings through the lead, 10-30): a Helpr with the item in the car had no way to
-- report anything or get out. "Delivery Helpr can't finish after pickup" in OWNER-DECISIONS.
--   Nobody's fault: the Helpr reports it; one retry once the buyer fixes it (24 hours, one corrected address within 25 miles,
--     or a note); then the item goes back to the seller, the sale is cancelled, the buyer gets back what they paid less the
--     delivery fee (which pays the Helpr for the trip) and less the card fee (owner: the buyer bears it, and is told). No strike.
--   Helpr's fault: a strike when they report; the item goes back within 48 hours, or the buyer collects it; no pay; the buyer
--     re-posts for another Helpr or takes a full refund, delivery included. The Helpr owes the card fee, out of their next
--     delivery or Declutter payout. If the buyer collects, the sale goes ahead with the delivery fee refunded.
--   Back at the seller: a photo at the pickup address, and the seller confirms or 24 hours pass.
--   Disagreement, a report of damage, or anything else: Louisiana Helpr decides, with the money held.
-- Restated from the newest definitions, each compared with prod's md5(prosrc) on 10-30. Only the marked parts change.
--
-- RE-TIMESTAMPED 2026-10-31 by Builder 36 (was 20261031231150, never on main or prod; main has since moved past it).
-- RESTATED FROM origin/main's NEWEST CREATE @ 70f35119f9 (checked 18:11 CT), three-way merged with the BUY-36 changes:
--   declutter_record_refund      from 20261031105148 (the debt notice names the item; ?tab=selling) + BUY-36 helpr_fault
--   helpr_task_customer_confirm  from 20261031082308 (BUY-39: not "I got it" while on the road) + BUY-36 going back /
--                                collecting (BUY-39's check skips a buyer collecting from a Helpr at fault)
--   helpr_task_sweep             from 20261031134217 (soldstates-5: unanswered seller report) + BUY-36 stuck steps
--   helpr_task_events CHECK      from 20261031134217 (pickup_moved, seller_no_show_report, seller_no_show_answer) + BUY-36
--   declutter_delivery_on_task_event: NOT restated. Its only change here was BUY-44's "Delivered" notice, which main's
--                                20261031170803 already carries (newer words), so this file no longer touches it.
--   Every other function here has no CREATE on main newer than the one it was restated from (checked by name).

ALTER TABLE public.helpr_tasks
  ADD COLUMN IF NOT EXISTS stuck_at timestamptz,
  ADD COLUMN IF NOT EXISTS stuck_reason text,
  ADD COLUMN IF NOT EXISTS stuck_note text,
  ADD COLUMN IF NOT EXISTS stuck_fault text,
  ADD COLUMN IF NOT EXISTS stuck_stage text,
  ADD COLUMN IF NOT EXISTS stuck_fix_by timestamptz,
  ADD COLUMN IF NOT EXISTS stuck_fix_note text,
  ADD COLUMN IF NOT EXISTS stuck_return_by timestamptz,
  ADD COLUMN IF NOT EXISTS stuck_choice text,
  ADD COLUMN IF NOT EXISTS stuck_choice_by timestamptz,
  ADD COLUMN IF NOT EXISTS stuck_collect_note text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_photo_path text,
  ADD COLUMN IF NOT EXISTS return_distance_m integer,
  ADD COLUMN IF NOT EXISTS return_answer_by timestamptz;
ALTER TABLE public.helpr_tasks DROP CONSTRAINT IF EXISTS helpr_tasks_stuck_values;
ALTER TABLE public.helpr_tasks ADD CONSTRAINT helpr_tasks_stuck_values CHECK (
  (stuck_fault IS NULL OR stuck_fault IN ('none', 'helpr'))
  AND (stuck_stage IS NULL OR stuck_stage IN ('waiting_fix', 'retrying', 'returning', 'returned', 'awaiting_choice', 'collecting'))
  AND (stuck_choice IS NULL OR stuck_choice IN ('refund', 'repost', 'collect'))
  AND (stuck_note IS NULL OR char_length(stuck_note) <= 1000)
  AND (stuck_fix_note IS NULL OR char_length(stuck_fix_note) <= 1000)
  AND (stuck_collect_note IS NULL OR char_length(stuck_collect_note) <= 1000));
ALTER TABLE public.helpr_task_payouts ADD COLUMN IF NOT EXISTS debt_cents integer NOT NULL DEFAULT 0;

DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.helpr_task_payouts.helpr_task_payouts_amount
  -- ACK-REASON: re-added on the next line with debt_cents taken off; every existing row has debt_cents 0, so it still validates.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten.
  ALTER TABLE public.helpr_task_payouts DROP CONSTRAINT IF EXISTS helpr_task_payouts_amount;
  ALTER TABLE public.helpr_task_payouts ADD CONSTRAINT helpr_task_payouts_amount CHECK (
    debt_cents >= 0 AND amount_cents = public.helpr_payout_round_down_cents(pay_cents - fee_cents) - debt_cents AND amount_cents >= 0);
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.helpr_task_events.helpr_task_events_task_event_check
  -- ACK-REASON: re-added on the next line with every event it allowed (newest: 20261031134217) plus the can't-finish steps.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten.
  ALTER TABLE public.helpr_task_events DROP CONSTRAINT IF EXISTS helpr_task_events_task_event_check;
  ALTER TABLE public.helpr_task_events ADD CONSTRAINT helpr_task_events_task_event_check CHECK (task_event = ANY (ARRAY[
    'created', 'accepted', 'released', 'helpr_no_show', 'picked_up', 'delivered', 'wrong_code', 'confirmed', 'unfilled',
    'cancelled', 'failed', 'pickup_no_show', 'handed_over', 'pickup_moved', 'seller_no_show_report', 'seller_no_show_answer',
    'cant_finish', 'buyer_fix', 'returned', 'buyer_choice']));
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_reason_check
  -- ACK-REASON: re-added on the next line with every reason it allowed plus 'helpr_fault'; the column is never unchecked once this block commits.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and every existing row's reason is still in the new list.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_reason_check CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described',
    'buyer_cancelled', 'buyer_restarted_checkout',
    'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault',
    'delivery_damage', 'refund_request_full', 'refund_request_part',
    'helpr_fault'));   -- BUY-36: everything back; the Helpr owes the card fee
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_policy
  -- ACK-REASON: re-added on the next line with the same mapping plus 'helpr_fault' -> full_seller_pays_fee; no existing reason changes policy.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and no existing row has reason 'helpr_fault', so every row still validates.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                      WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                      WHEN reason = 'refund_request_part' THEN 'agreed_part'
                      ELSE 'full_platform_absorbs' END);
END;
$do$;

CREATE OR REPLACE FUNCTION public.helpr_task_confirm(p_task uuid, p_by text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.helpr_tasks;
  v_payout uuid;
  v_amount integer;
  v_debt integer := 0;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
      HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  IF p_by IS NULL OR p_by NOT IN ('customer', 'auto', 'admin') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  IF p_by <> 'admin' AND public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported. Louisiana Helpr decides before anyone is paid.';
  END IF;
  UPDATE public.helpr_tasks
     SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_by, closed_at = now(), updated_at = now()
   WHERE id = t.id AND status IN ('picked_up', 'delivered');
  v_amount := public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents);
  -- CHANGED (BUY-36): a card fee the Helpr owes (declutter_seller_fee_debts, reason helpr_fault) comes off this payout.
  IF t.helpr_id IS NOT NULL AND v_amount > 0 THEN
    v_debt := public.declutter_consume_fee_debt(t.helpr_id, 'helpr_task_' || t.id::text, v_amount);
  END IF;
  v_amount := v_amount - v_debt;
  INSERT INTO public.helpr_task_payouts (task_id, helpr_id, pay_cents, fee_cents, debt_cents, amount_cents, status)
  VALUES (t.id, t.helpr_id, t.pay_cents, t.fee_cents, v_debt, v_amount,
          CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (task_id) DO NOTHING
  RETURNING id INTO v_payout;
  PERFORM public.helpr_task_log(t.id, 'confirmed', p_actor, p_by);
  PERFORM public.declutter_notify(t.helpr_id, 'payment', 'Delivery done',
    CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
         THEN format('"%s" is delivered. Set up payouts in Settings to get your $%s. We send it as soon as you do.',
                     t.title, to_char(v_amount / 100.0, 'FM999990.00'))
         ELSE format('"%s" is delivered. $%s is on its way to your payout account.', t.title, to_char(v_amount / 100.0, 'FM999990.00')) END,
    '/declutter?tab=deliver', t.customer_id);
  RETURN jsonb_build_object('result', 'confirmed', 'helpr_payout_id', v_payout, 'by', p_by);
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_record_refund(p_order_id uuid, p_payment_intent_id text, p_reason text,
  p_paid_cents integer, p_card_fee_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_policy text;
  v_fee integer;
  v_kept integer := 0;
  v_seller uuid;
  v_order record;
BEGIN
  SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   WHEN p_reason = 'refund_request_part' THEN 'agreed_part'
                   ELSE 'full_platform_absorbs' END;
  IF v_policy = 'agreed_part' THEN
    -- Only the offered amount is right for a part refund; this function cannot know it.
    RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
  END IF;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  ELSIF v_policy = 'keep_buyer_fee' THEN
    SELECT o.items_cents, o.premium_cents, o.tax_cents, o.delivery_cents INTO v_order
      FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_order.premium_cents IS NULL OR v_order.premium_cents <= 0
       OR p_paid_cents IS DISTINCT FROM v_order.items_cents + v_order.premium_cents + v_order.tax_cents
                                        + v_order.delivery_cents - public.declutter_delivery_reserved_cents(p_order_id) THEN
      -- Only a whole paid order can keep its fee; anything else is a bug, never a guess.
      RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
    END IF;
    v_kept := v_order.premium_cents;
  END IF;
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                        kept_cents, refund_cents)
  VALUES (p_order_id, p_payment_intent_id, p_reason, v_policy, p_paid_cents, v_fee, v_kept,
          CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee
               WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept
               ELSE p_paid_cents END)
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
    RETURN v_id;
  END IF;
  IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN
    SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = p_order_id;
    -- CHANGED (BUY-36): on the Helpr's fault the Helpr owes it (owner 10-30), out of their next delivery or Declutter payout.
    IF p_reason = 'helpr_fault' THEN
      SELECT t.helpr_id INTO v_seller FROM public.helpr_tasks t WHERE t.source_kind = 'declutter_delivery' AND t.source_id = p_order_id;
    END IF;
    IF v_seller IS NOT NULL THEN
      INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
      VALUES (v_seller, v_id, v_fee, v_fee)
      ON CONFLICT (refund_id) DO NOTHING;
      -- D2-6 (audit 1b #6): the seller is told when a refund leaves them owing money, and where it comes from.
      -- In words, never a fee name (the owner's rule: members see no fee words); the amount is what they owe.
      -- CHANGED (BUY-30): the notice names the item (no other party is passed, so the writer could not) and
      -- opens Selling by its tab address.
      IF FOUND THEN
        PERFORM public.declutter_notify(v_seller, 'declutter_refunds', 'You owe from a refund',
          -- BUY-36 (CHANGED): a Helpr's own fault comes out of their next payout, and opens their deliveries.
          CASE WHEN p_reason = 'helpr_fault'
               THEN format('This refund on %s leaves you owing $%s. It comes out of your next Declutter payout.',
                           public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00'))
               ELSE format('This refund on %s leaves you owing $%s. It comes out of your next Declutter sale''s payout.',
                           public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00')) END,
          CASE WHEN p_reason = 'helpr_fault' THEN '/declutter?tab=deliver' ELSE '/declutter?tab=selling' END, NULL);
      END IF;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
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
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
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
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt,
          CASE WHEN o.items_cents + v_rate - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    format('The handover of %s is done. ', public.declutter_order_items_named(o.id)) ||
    CASE
      WHEN o.items_cents + v_rate - v_debt = 0 THEN
        format('This sale paid off the $%s you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?tab=selling', o.buyer_id);
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
$fn$;

CREATE OR REPLACE FUNCTION public.helpr_task_customer_confirm(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000', HINT = 'The Helpr has not picked the item up yet.';
  END IF;
  -- CHANGED (BUY-36): the item is on its way back, so there is nothing to confirm.
  IF t.stuck_stage IN ('returning', 'returned', 'awaiting_choice') THEN
    RAISE EXCEPTION 'item_going_back' USING ERRCODE = '55000', HINT = 'This item is going back to the seller.';
  END IF;
  -- BUY-39: on the road is not "I got it". From the drop-off, or after 24 h in the Helpr's hands.
  -- CHANGED (BUY-36): except when the buyer collected it from a Helpr at fault (below).
  IF t.status = 'picked_up' AND t.stuck_stage IS DISTINCT FROM 'collecting'
     AND (t.picked_up_at IS NULL OR t.picked_up_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'delivery_on_the_way' USING ERRCODE = '55000', HINT = 'The Helpr is bringing it. Tap I got it once it is dropped off.';
  END IF;
  -- CHANGED (BUY-36): the buyer collected it from a Helpr at fault: the sale goes ahead, the Helpr is unpaid, the delivery fee goes back.
  IF t.stuck_stage = 'collecting' THEN
    IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
      RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
        HINT = 'A problem was reported. Louisiana Helpr decides before anyone is paid.';
    END IF;
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'The buyer collected it from the Helpr', updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'failed', v_uid, 'helpr fault: buyer collected');
    PERFORM public.declutter_delivery_refund(t.source_id, 'delivery_not_done');
    PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Delivery closed',
      format('The buyer has "%s". You are not paid for this delivery.', t.title), '/declutter?tab=deliver', NULL);
  END IF;
  RETURN public.helpr_task_source_event(t.id, 'confirmed', 'customer');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.helpr_task_delivered(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric,
  p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = 'confirmed' THEN
    RETURN jsonb_build_object('result', 'already_confirmed');
  END IF;
  IF t.status NOT IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'not_picked_up_yet' USING ERRCODE = '55000', HINT = 'Take the "Picked up" photo first.';
  END IF;
  -- CHANGED (BUY-36): reported as can't finish: only the retry may still drop it off.
  IF t.status = 'picked_up' AND t.stuck_stage IS NOT NULL AND t.stuck_stage <> 'retrying' THEN
    RAISE EXCEPTION 'delivery_on_hold' USING ERRCODE = '55000', HINT = 'You reported this delivery. Follow the steps on it.';
  END IF;
  -- No drop-off code any more (owner 2026-10-18): p_code is ignored, kept in
  -- the signature so an old build's call still parses; the door photo is the
  -- only drop-off.
  IF t.status = 'picked_up' THEN
    IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) OR p_photo_path = t.pickup_photo_path THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    v_m := public.helpr_task_distance_m(p_lat, p_lng, t.dropoff_lat, t.dropoff_lng);
    -- 200 m from the drop-off point.
    IF v_m IS NULL OR v_m > 200 THEN
      RAISE EXCEPTION 'not_at_dropoff' USING ERRCODE = '22023', HINT = 'Take the photo at the drop-off address.';
    END IF;
    UPDATE public.helpr_tasks
       SET status = 'delivered', delivered_at = now(), dropoff_photo_path = p_photo_path, dropoff_distance_m = v_m, updated_at = now()
     WHERE id = t.id AND status = 'picked_up';
    PERFORM public.helpr_task_log(t.id, 'delivered', v_uid, v_m::text || ' m');
  END IF;
  -- The "Delivered" notice goes out once, on the step itself; a repeat call
  -- on a task already at the door says so again without re-sending it
  -- (lh-silent-failure #5, lh-authz-rls #9).
  IF t.status = 'picked_up' THEN
    PERFORM public.helpr_task_source_event(t.id, 'delivered', NULL);
  END IF;
  RETURN jsonb_build_object('result', 'delivered', 'distance_m', v_m,
    'held', public.helpr_task_source_held(t.source_kind, t.source_id));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.helpr_task_view(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_role text;
  v_active boolean;
  v_drop_shown boolean;
  v_helpr_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_role := CASE WHEN t.helpr_id = v_uid THEN 'helpr'
                 WHEN t.customer_id = v_uid THEN 'customer'
                 WHEN t.pickup_contact_id = v_uid THEN 'pickup_contact' END;
  IF v_role IS NULL THEN
    -- An open task is visible to a Helpr who could take it (area words only).
    PERFORM public.helpr_task_source_require_feature(t.source_kind);
    PERFORM public.helpr_task_assert_helpr();
    -- The same checks helpr_tasks_open_near applies (lh-authz-rls #8).
    IF t.status <> 'open' OR t.open_until <= now() OR NOT public.helpr_task_vehicle_fits(v_uid, t.size)
       OR public.are_users_blocked(v_uid, t.customer_id) OR public.are_users_blocked(v_uid, t.pickup_contact_id)
       OR NOT public.helpr_task_same_stripe_mode(v_uid, t.customer_id) THEN
      RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_role := 'candidate';
  END IF;
  v_active := t.status IN ('accepted', 'picked_up', 'delivered');
  v_drop_shown := v_role = 'helpr' AND v_active
                  AND COALESCE(now() > public.helpr_task_dropoff_shows_at(t.helpr_id, t.status, t.pickup_slot_start), false);
  SELECT NULLIF(split_part(COALESCE(public.member_display_name(pr.full_name, NULL), ''), ' ', 1), '') INTO v_helpr_name
    FROM public.profiles pr WHERE pr.user_id = t.helpr_id;
  RETURN jsonb_build_object(
    'task_id', t.id, 'source_kind', t.source_kind, 'source_id', CASE WHEN v_role <> 'candidate' THEN t.source_id END,
    'role', v_role, 'status', t.status, 'size', t.size, 'title', t.title,
    'pickup_area', t.pickup_area, 'dropoff_area', t.dropoff_area, 'trip_miles', t.trip_miles,
    'take_home_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN public.helpr_payout_round_down_cents(t.pay_cents - t.fee_cents) END,
    'pay_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.pay_cents END,
    'fee_cents', CASE WHEN v_role IN ('helpr', 'candidate') THEN t.fee_cents END,
    'open_until', t.open_until, 'latest_pickup_at', t.latest_pickup_at,
    'pickup_slot_start', t.pickup_slot_start, 'accepted_at', t.accepted_at,
    'picked_up_at', t.picked_up_at, 'delivered_at', t.delivered_at, 'confirmed_at', t.confirmed_at,
    'confirmed_by', t.confirmed_by,
    'helpr_first_name', CASE WHEN v_role IN ('customer', 'pickup_contact') THEN v_helpr_name END,
    'pickup_address', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_address END,
    'pickup_lat', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lat END,
    'pickup_lng', CASE WHEN v_role = 'helpr' AND v_active THEN t.pickup_lng END,
    'dropoff_address', CASE WHEN v_drop_shown THEN t.dropoff_address END,
    'dropoff_lat', CASE WHEN v_drop_shown THEN t.dropoff_lat END,
    'dropoff_lng', CASE WHEN v_drop_shown THEN t.dropoff_lng END,
    'pickup_photo_path', CASE WHEN v_role <> 'candidate' THEN t.pickup_photo_path END,
    'dropoff_photo_path', CASE WHEN v_role <> 'candidate' THEN t.dropoff_photo_path END,
    -- 20261030012018: the seller's "Handed over" (only while it is for the current Helpr), and a problem
    -- holding the sale (the Helpr's "The seller wasn't there" among them), for the three parties only.
    'handed_over_at', CASE WHEN v_role <> 'candidate' AND t.helpr_id IS NOT NULL AND t.handed_over_to = t.helpr_id THEN t.handed_over_at END,
    'problem_open', CASE WHEN v_role <> 'candidate' THEN public.helpr_task_source_held(t.source_kind, t.source_id) END,
    -- BUY-36: where a delivery the Helpr can't finish stands, for the three parties. The collect note is for the two who meet.
    'stuck_stage', CASE WHEN v_role <> 'candidate' THEN t.stuck_stage END,
    'stuck_reason', CASE WHEN v_role <> 'candidate' THEN t.stuck_reason END,
    'stuck_note', CASE WHEN v_role <> 'candidate' THEN t.stuck_note END,
    'stuck_fault', CASE WHEN v_role <> 'candidate' THEN t.stuck_fault END,
    'stuck_fix_by', CASE WHEN v_role <> 'candidate' THEN t.stuck_fix_by END,
    'stuck_fix_note', CASE WHEN v_role IN ('helpr', 'customer') THEN t.stuck_fix_note END,
    'stuck_return_by', CASE WHEN v_role <> 'candidate' THEN t.stuck_return_by END,
    'stuck_choice', CASE WHEN v_role IN ('helpr', 'customer') THEN t.stuck_choice END,
    'stuck_choice_by', CASE WHEN v_role = 'customer' THEN t.stuck_choice_by END,
    'stuck_collect_note', CASE WHEN v_role IN ('helpr', 'customer') THEN t.stuck_collect_note END,
    'returned_at', CASE WHEN v_role <> 'candidate' THEN t.returned_at END,
    'return_photo_path', CASE WHEN v_role <> 'candidate' THEN t.return_photo_path END,
    'return_answer_by', CASE WHEN v_role <> 'candidate' THEN t.return_answer_by END);
END;
$fn$;

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
    -- CHANGED (BUY-36): those words are only true before the Helpr picked it up.
    IF v_task.status IN ('picked_up', 'delivered') THEN
      RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
        HINT = 'The Helpr has this item. Decide it as nobody''s fault, the Helpr''s fault, or damaged in delivery.';
    END IF;
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The item never left the seller. Refund the buyer, and say whose fault it was.';
  END IF;
  -- CHANGED (BUY-36): a delivery reported as can't finish is decided by fault too: a plain refund would pay the Helpr.
  IF p_decision IN ('refund_buyer', 'refund_part') AND v_task.status = 'picked_up' AND v_task.stuck_at IS NOT NULL THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as nobody''s fault, the Helpr''s fault, or damaged in delivery.';
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

-- Puts the item back at the seller's end of the sale, by who is at fault and what the buyer chose. Service only.
CREATE OR REPLACE FUNCTION public.declutter_delivery_return_finish(p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t public.helpr_tasks;
  o public.declutter_orders;
  v_out jsonb;
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  IF t.stuck_fault = 'none' THEN
    -- The Helpr is paid for the trip (declutter_close_paid_order confirms a picked-up task, and keeps the delivery fee back).
    v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your delivery couldn''t be finished',
      format('%s went back to the seller, so this sale is cancelled. You get back what you paid, less the delivery fee, which paid the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back.',
             public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', t.helpr_id);
    RETURN v_out;
  END IF;
  IF t.stuck_choice = 'refund' THEN
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'The Helpr could not finish', updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'failed', NULL, 'helpr fault: returned, buyer refunded');
    PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Delivery closed',
      format('"%s" is back with the seller. You are not paid for this delivery.', t.title), '/declutter?tab=deliver', NULL);
    RETURN public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
  END IF;
  IF t.stuck_choice = 'repost' THEN
    UPDATE public.helpr_tasks
       SET status = 'open', helpr_id = NULL, accepted_at = NULL, pickup_slot_start = NULL, picked_up_at = NULL, pickup_photo_path = NULL,
           handed_over_at = NULL, handed_over_to = NULL, releases = least(releases + 1, 100),
           latest_pickup_at = greatest(latest_pickup_at, now() + interval '72 hours'),
           open_until = greatest(open_until, now() + interval '48 hours'),
           stuck_at = NULL, stuck_reason = NULL, stuck_note = NULL, stuck_fault = NULL, stuck_stage = NULL, stuck_fix_by = NULL, stuck_fix_note = NULL,
           stuck_return_by = NULL, stuck_choice = NULL, stuck_choice_by = NULL, stuck_collect_note = NULL,
           returned_at = NULL, return_photo_path = NULL, return_distance_m = NULL, return_answer_by = NULL, in_hand_nudged_at = NULL,
           updated_at = now()
     WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'released', t.helpr_id, 'helpr fault: returned, buyer re-posted');
    PERFORM public.helpr_task_source_event(t.id, 'released', 'repost');
    RETURN jsonb_build_object('result', 'reposted');
  END IF;
  -- Nothing chosen yet: the money stays held and the buyer has 48 hours, then Louisiana Helpr decides.
  UPDATE public.helpr_tasks SET stuck_stage = 'awaiting_choice', stuck_choice_by = now() + interval '48 hours', updated_at = now() WHERE id = t.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is back with the seller',
    format('Choose what happens with %s in Buying: a full refund, or re-post it for another Helpr.', public.declutter_order_items_named(o.id)),
    '/declutter?tab=buying', t.helpr_id);
  RETURN jsonb_build_object('result', 'awaiting_choice');
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_delivery_return_finish(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_return_finish(uuid) TO service_role;

-- "I can't deliver this": the Helpr picks a reason. Their word on fault stands unless someone disagrees (a problem, money held).
CREATE OR REPLACE FUNCTION public.helpr_task_cant_finish(p_task_id uuid, p_reason text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  o public.declutter_orders;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_item text;
  v_problem uuid;
  a record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'picked_up' THEN
    RAISE EXCEPTION 'not_picked_up_yet' USING ERRCODE = '55000', HINT = 'Take the "Picked up" photo first.';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF t.stuck_stage IS NOT NULL AND t.stuck_stage <> 'retrying' THEN
    RAISE EXCEPTION 'already_reported' USING ERRCODE = '55000', HINT = 'You already reported this delivery. Follow the steps on it.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('wrong_address', 'cant_get_in', 'nobody_there', 'wont_fit', 'cant_finish', 'damaged', 'other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_reason IN ('damaged', 'other') AND v_note IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  v_item := public.declutter_order_items_named(o.id);
  PERFORM public.helpr_task_log(t.id, 'cant_finish', v_uid, p_reason);
  IF p_reason IN ('damaged', 'other') THEN
    -- Louisiana Helpr decides, with the money held.
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
    VALUES (o.id, v_uid, 'helpr', p_reason, v_note, '{}')
    RETURNING id INTO v_problem;
    UPDATE public.helpr_tasks SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, updated_at = now() WHERE id = t.id;
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Your delivery is on hold',
      format('The Helpr reported a problem with %s. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'warning', 'This delivery is on hold',
      format('The Helpr reported a problem with %s. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', v_item),
      '/declutter?tab=selling', v_uid);
    -- Test stuff never reaches an admin (owner 2026-10-30; 20261030150104).
    IF NOT (t.is_seed OR o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(t.helpr_id)) THEN
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
          'A Helpr with an item reported a problem on a delivery. The money is held until you decide it.', '/admin');
      END LOOP;
    END IF;
    RETURN jsonb_build_object('result', 'with_admin', 'problem_id', v_problem);
  END IF;
  IF p_reason = 'cant_finish' THEN
    UPDATE public.helpr_tasks
       SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'helpr', stuck_stage = 'returning',
           stuck_return_by = now() + interval '48 hours', updated_at = now()
     WHERE id = t.id;
    PERFORM public.helpr_task_give_job_strike(v_uid, 'delivery_backed_out', t.id, 'Could not finish a Helpr delivery after picking it up');
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your Helpr can''t finish this delivery',
      format('They have to take %s back to the seller within 48 hours. In Buying, choose a full refund, re-posting it for another Helpr, or collecting it from them.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Your item is coming back',
      format('The Helpr can''t finish the delivery of %s and has to bring it back within 48 hours. Confirm in Selling when you have it.', v_item),
      '/declutter?tab=selling', v_uid);
    RETURN jsonb_build_object('result', 'returning', 'strike', true);
  END IF;
  -- Nobody's fault: one retry. A second report after it sends the item back.
  IF t.stuck_stage = 'retrying' THEN
    UPDATE public.helpr_tasks
       SET stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'none', stuck_stage = 'returning',
           stuck_return_by = now() + interval '48 hours', updated_at = now()
     WHERE id = t.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The delivery couldn''t be finished',
      format('The Helpr tried again and couldn''t leave %s, so it goes back to the seller and the sale is cancelled. You get back what you paid, less the delivery fee, which pays the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back. If you disagree, report a problem in Buying.', v_item),
      '/declutter?tab=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'info', 'Your item is coming back',
      format('The Helpr couldn''t leave %s and brings it back within 48 hours. Confirm in Selling when you have it.', v_item),
      '/declutter?tab=selling', v_uid);
    RETURN jsonb_build_object('result', 'returning', 'strike', false);
  END IF;
  UPDATE public.helpr_tasks
     SET stuck_at = now(), stuck_reason = p_reason, stuck_note = v_note, stuck_fault = 'none', stuck_stage = 'waiting_fix',
         stuck_fix_by = now() + interval '24 hours', updated_at = now()
   WHERE id = t.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Your Helpr can''t get to you',
    format('About %s. Fix it in Buying within 24 hours, and they try once more. If it isn''t fixed, it goes back to the seller and the sale is cancelled.', v_item),
    '/declutter?tab=buying', v_uid);
  RETURN jsonb_build_object('result', 'waiting_fix', 'strike', false);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_cant_finish(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_cant_finish(uuid, text, text) TO authenticated, service_role;

-- The buyer's fix: one corrected drop-off within 25 miles and/or a note. Pay doesn't change.
CREATE OR REPLACE FUNCTION public.helpr_task_buyer_fix(p_task_id uuid, p_note text, p_address text, p_lat numeric, p_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_address text := NULLIF(btrim(COALESCE(p_address, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.stuck_stage IS DISTINCT FROM 'waiting_fix' THEN
    RAISE EXCEPTION 'nothing_to_fix' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF now() >= t.stuck_fix_by THEN
    RAISE EXCEPTION 'fix_too_late' USING ERRCODE = '55000', HINT = 'The 24 hours to fix this are over.';
  END IF;
  IF v_note IS NULL AND v_address IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the Helpr what changed.';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the Helpr what changed (up to 1,000 characters).';
  END IF;
  IF v_address IS NOT NULL THEN
    IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
    END IF;
    IF public.helpr_task_distance_m(p_lat, p_lng, t.dropoff_lat, t.dropoff_lng) > 40234 THEN
      RAISE EXCEPTION 'fix_too_far' USING ERRCODE = '22023', HINT = 'The new address has to be within 25 miles of the old one.';
    END IF;
    UPDATE public.helpr_tasks SET dropoff_address = v_address, dropoff_lat = p_lat, dropoff_lng = p_lng WHERE id = t.id;
  END IF;
  UPDATE public.helpr_tasks SET stuck_stage = 'retrying', stuck_fix_note = v_note, updated_at = now() WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'buyer_fix', v_uid, CASE WHEN v_address IS NULL THEN 'note' ELSE 'address' END);
  PERFORM public.declutter_notify(t.helpr_id, 'info', 'The buyer fixed it',
    format('Try "%s" once more. See what changed on the delivery.', t.title), '/declutter?tab=deliver', v_uid);
  RETURN jsonb_build_object('result', 'retrying');
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_buyer_fix(uuid, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_buyer_fix(uuid, text, text, numeric, numeric) TO authenticated, service_role;

-- Helpr's fault: what the buyer wants. Refund and re-post happen once the item is back; collect needs them to say where and when.
CREATE OR REPLACE FUNCTION public.helpr_task_buyer_choose(p_task_id uuid, p_choice text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.stuck_fault IS DISTINCT FROM 'helpr' OR t.stuck_stage NOT IN ('returning', 'returned', 'awaiting_choice', 'collecting') THEN
    RAISE EXCEPTION 'nothing_to_choose' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_choice IS NULL OR p_choice NOT IN ('refund', 'repost', 'collect') THEN
    RAISE EXCEPTION 'invalid_choice' USING ERRCODE = '22023';
  END IF;
  IF p_choice = 'collect' THEN
    IF t.stuck_stage NOT IN ('returning', 'collecting') THEN
      RAISE EXCEPTION 'too_late_to_collect' USING ERRCODE = '55000', HINT = 'The item is already back with the seller.';
    END IF;
    IF v_note IS NULL OR char_length(v_note) > 1000 THEN
      RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the Helpr where and when you can meet.';
    END IF;
    UPDATE public.helpr_tasks SET stuck_choice = 'collect', stuck_stage = 'collecting', stuck_collect_note = v_note, updated_at = now() WHERE id = t.id;
    PERFORM public.helpr_task_log(t.id, 'buyer_choice', v_uid, 'collect');
    PERFORM public.declutter_notify(t.helpr_id, 'info', 'The buyer will collect it from you',
      format('See where and when on "%s".', t.title), '/declutter?tab=deliver', v_uid);
    RETURN jsonb_build_object('result', 'collecting');
  END IF;
  UPDATE public.helpr_tasks
     SET stuck_choice = p_choice, stuck_collect_note = NULL,
         stuck_stage = CASE WHEN t.stuck_stage = 'collecting' THEN 'returning' ELSE t.stuck_stage END, updated_at = now()
   WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'buyer_choice', v_uid, p_choice);
  IF t.stuck_stage = 'awaiting_choice' THEN
    RETURN public.declutter_delivery_return_finish(t.id);
  END IF;
  RETURN jsonb_build_object('result', 'chosen', 'choice', p_choice);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_buyer_choose(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_buyer_choose(uuid, text, text) TO authenticated, service_role;

-- The Helpr brings it back: a photo at the pickup address.
CREATE OR REPLACE FUNCTION public.helpr_task_returned(p_task_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_m integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.helpr_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.stuck_stage = 'returned' THEN
    RETURN jsonb_build_object('result', 'already_returned');
  END IF;
  IF t.stuck_stage IS DISTINCT FROM 'returning' THEN
    RAISE EXCEPTION 'not_returning' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF NOT public.helpr_task_photo_ok(t.id, v_uid, p_photo_path) OR p_photo_path = t.pickup_photo_path THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  v_m := public.helpr_task_distance_m(p_lat, p_lng, t.pickup_lat, t.pickup_lng);
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  UPDATE public.helpr_tasks
     SET stuck_stage = 'returned', returned_at = now(), return_photo_path = p_photo_path, return_distance_m = v_m,
         return_answer_by = now() + interval '24 hours', updated_at = now()
   WHERE id = t.id;
  PERFORM public.helpr_task_log(t.id, 'returned', v_uid, v_m::text || ' m');
  PERFORM public.declutter_notify(t.pickup_contact_id, 'warning', 'The Helpr says it''s back with you',
    format('About "%s". Confirm in Selling, or say it didn''t come back. If we don''t hear from you in 24 hours, we count it as back.', t.title),
    '/declutter?tab=selling', v_uid);
  RETURN jsonb_build_object('result', 'returned', 'distance_m', v_m);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_returned(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_returned(uuid, text, numeric, numeric) TO authenticated, service_role;

-- The seller's answer: back (the sale ends as the fault says), or not back (Louisiana Helpr decides, money held).
CREATE OR REPLACE FUNCTION public.helpr_task_seller_return_answer(p_task_id uuid, p_back boolean, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_problem uuid;
  a record;
  o public.declutter_orders;  -- B36: was used below but never declared ("missing FROM-clause entry for table o")
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  t := public.helpr_task_lock(p_task_id);
  IF t.pickup_contact_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.stuck_stage IS DISTINCT FROM 'returned' THEN
    RAISE EXCEPTION 'not_returned' USING ERRCODE = '55000';
  END IF;
  IF public.helpr_task_source_held(t.source_kind, t.source_id) THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_back IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF p_back THEN
    RETURN public.declutter_delivery_return_finish(t.id);
  END IF;
  IF v_note IS NULL OR char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = t.source_id;
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths, is_seed)
  VALUES (t.source_id, v_uid, 'seller', 'other', v_note, '{}', COALESCE(o.is_seed, false))
  RETURNING id INTO v_problem;
  PERFORM public.declutter_notify(t.helpr_id, 'warning', 'The seller says it didn''t come back',
    format('About "%s". Louisiana Helpr looks at it and tells you what it decides.', t.title), '/declutter?tab=deliver', v_uid);
  PERFORM public.declutter_notify(t.customer_id, 'warning', 'Your delivery is on hold',
    format('The seller says "%s" didn''t come back. Louisiana Helpr looks at it and tells you what it decides. The money stays held until then.', t.title),
    '/declutter?tab=buying', v_uid);
  -- Test stuff never reaches an admin (owner 2026-10-30; 20261030150104).
  IF NOT (t.is_seed OR o.is_seed OR public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id) OR public.is_test_subject(t.helpr_id)) THEN
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
        'A seller says a delivery a Helpr couldn''t finish didn''t come back. The money is held until you decide it.', '/admin');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('result', 'with_admin', 'problem_id', v_problem);
END;
$function$;
REVOKE ALL ON FUNCTION public.helpr_task_seller_return_answer(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_seller_return_answer(uuid, boolean, text) TO authenticated, service_role;

-- Louisiana Helpr decides a delivery a Helpr has and can't finish: nobody's fault, or the Helpr's. A Helpr's-fault decision
-- refunds in full: the buyer can still re-post from a new order, which is not this function's business.
CREATE OR REPLACE FUNCTION public.declutter_admin_decide_stuck_delivery(p_problem_id uuid, p_fault text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_task public.helpr_tasks;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_fault IS NULL OR p_fault NOT IN ('none', 'helpr') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id FOR UPDATE OF t;
  IF v_task.id IS NULL OR v_task.status <> 'picked_up' OR o.status <> 'paid' THEN
    RAISE EXCEPTION 'not_a_delivery_in_transit' USING ERRCODE = '55000', HINT = 'Only a delivery a Helpr has picked up can be decided here.';
  END IF;
  IF v_uid = v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = 'refund_buyer', fault = 'none', strike_given = (p_fault = 'helpr'),
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF p_fault = 'none' THEN
    v_out := public.declutter_close_paid_order(o.id, 'admin_no_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at the problem with %s. It was nobody''s fault, so the sale is cancelled. You get back what you paid, less the delivery fee, which paid the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back.',
             public.declutter_order_items_named(o.id)), '/declutter?tab=buying', o.seller_id);
  ELSE
    UPDATE public.helpr_tasks SET status = 'failed', closed_at = now(), close_note = 'Decided as the Helpr''s fault', updated_at = now() WHERE id = v_task.id;
    PERFORM public.helpr_task_log(v_task.id, 'failed', v_uid, 'decided: helpr fault');
    PERFORM public.helpr_task_give_job_strike(v_task.helpr_id, 'delivery_backed_out', v_task.id, 'Could not finish a Helpr delivery after picking it up');
    v_out := public.declutter_close_paid_order(o.id, 'helpr_fault', NULL, NULL, NULL);
    PERFORM public.declutter_notify(v_task.helpr_id, 'warning', 'Delivery decided',
      format('Louisiana Helpr decided "%s" wasn''t finished because of you. You are not paid for this delivery.', v_task.title), '/declutter?tab=deliver', NULL);
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
      format('We looked at the problem with %s. All of your money is coming back, delivery included.', public.declutter_order_items_named(o.id)),
      '/declutter?tab=buying', o.seller_id);
  END IF;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
    format('We looked at the problem with %s. The sale is cancelled and the buyer refunded.', public.declutter_order_items_named(o.id)),
    '/declutter?tab=selling', o.buyer_id);
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', 'stuck_delivery', 'fault', p_fault, 'task_id', v_task.id, 'result', v_out));
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_stuck_delivery(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_stuck_delivery(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.helpr_task_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  t public.helpr_tasks;
  v_unfilled integer := 0;
  v_noshow integer := 0;
  v_auto integer := 0;
  v_in_hand integer := 0;
  v_stuck integer := 0;
  v_o public.declutter_orders;
  a record;
  v_no_answer integer := 0;
BEGIN
  -- NEW (soldstates-5): the seller said the Helpr didn't come and the Helpr didn't answer in 24 hours. A strike, and a
  -- task still booked goes back up for another Helpr. The buyer's money is not refunded: the delivery goes on. An open
  -- problem on the order means Louisiana Helpr already has it: nothing here.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.seller_no_show_answer_by <= now() AND x.seller_no_show_answered_at IS NULL
              AND x.seller_no_show_settled_at IS NULL ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.seller_no_show_answer_by <= now() AND t.seller_no_show_answered_at IS NULL AND t.seller_no_show_settled_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = t.source_id AND p.status = 'open') THEN
        UPDATE public.helpr_tasks SET seller_no_show_settled_at = now(), updated_at = now() WHERE id = t.id;
        -- Review #4: only a Helpr still booked for it (picked up, cancelled or closed since: no strike).
        IF t.status = 'accepted' THEN
          PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
            'The seller said you didn''t come for a Helpr delivery pickup, and you didn''t answer within 24 hours');
          -- helpr_task_reopen clears the report, so the next Helpr starts clean (review #3).
          PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', t.helpr_id, 'the seller said the Helpr did not come; no answer in 24 h');
        END IF;
        v_no_answer := v_no_answer + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x WHERE x.status = 'open' AND x.open_until <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- An open problem freezes the task: the admin decides the money, never
      -- this sweep (lh-money-escrow re-review #1, 2026-10-16: the late
      -- fall-through close would otherwise refund under the no-fault rule and
      -- leave the problem undecidable).
      IF t.status = 'open' AND t.open_until <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_close(t.id, 'unfilled', 'No Helpr took it in time');
        PERFORM public.helpr_task_source_event(t.id, 'unfilled', NULL);
        v_unfilled := v_unfilled + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'accepted' AND x.pickup_slot_start + interval '2 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      -- A problem on the source (e.g. the Helpr's "the seller wasn't there")
      -- freezes the task: an admin decides, the Helpr is not a no-show.
      IF t.status = 'accepted' AND t.pickup_slot_start + interval '2 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_reopen(t.id, 'helpr_no_show', t.helpr_id, 'not picked up 2 h after the pickup time');
        PERFORM public.helpr_task_give_job_strike(t.helpr_id, 'delivery_no_show', t.id,
          'Did not pick up a Helpr delivery within 2 hours of the pickup time');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now() ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'delivered' AND t.delivered_at + interval '24 hours' <= now()
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        PERFORM public.helpr_task_source_event(t.id, 'confirmed', 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- BUY-37: picked up, never marked delivered, nobody has said anything. Nudged 24 hours after the pickup, then weekly.
  -- No money moves and no strike: the money stays held (owner 10-30, "Nobody taps at all: hold the money"). An open
  -- problem means an admin already has it. Test data reaches nobody.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'picked_up' AND x.picked_up_at + interval '24 hours' <= now()
              AND x.stuck_stage IS NULL
              AND (x.in_hand_nudged_at IS NULL OR x.in_hand_nudged_at + interval '7 days' <= now())
              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
              AND x.is_seed IS NOT TRUE
              AND NOT EXISTS (SELECT 1 FROM public.test_accounts ta WHERE ta.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id))
              AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id IN (x.customer_id, x.pickup_contact_id, x.helpr_id) AND pr.is_seed)
            ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      IF t.status = 'picked_up' AND t.picked_up_at + interval '24 hours' <= now()
         AND (t.in_hand_nudged_at IS NULL OR t.in_hand_nudged_at + interval '7 days' <= now())
         AND NOT public.helpr_task_source_held(t.source_kind, t.source_id) THEN
        UPDATE public.helpr_tasks SET in_hand_nudged_at = now() WHERE id = t.id;
        PERFORM public.helpr_task_source_event(t.id, 'still_in_hand', NULL);
        v_in_hand := v_in_hand + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- BUY-36: the clocks on a delivery the Helpr can't finish. A problem freezes them all: an admin decides.
  FOR r IN SELECT x.id FROM public.helpr_tasks x
            WHERE x.status = 'picked_up'
              AND ((x.stuck_stage = 'waiting_fix' AND x.stuck_fix_by <= now())
                OR (x.stuck_stage = 'returned' AND x.return_answer_by <= now())
                OR (x.stuck_stage IN ('returning', 'collecting') AND x.stuck_return_by <= now())
                OR (x.stuck_stage = 'awaiting_choice' AND x.stuck_choice_by <= now()))
              AND NOT public.helpr_task_source_held(x.source_kind, x.source_id)
            ORDER BY x.id LIMIT 200 LOOP
    BEGIN
      t := public.helpr_task_lock(r.id);
      CONTINUE WHEN t.status <> 'picked_up' OR public.helpr_task_source_held(t.source_kind, t.source_id);
      IF t.stuck_stage = 'waiting_fix' AND t.stuck_fix_by <= now() THEN
        -- Not fixed in 24 hours: as a failed retry.
        UPDATE public.helpr_tasks SET stuck_stage = 'returning', stuck_return_by = now() + interval '48 hours', updated_at = now() WHERE id = t.id;
        PERFORM public.declutter_notify(t.helpr_id, 'info', 'Take it back to the seller',
          format('The buyer didn''t fix the delivery of "%s". Take it back to the seller within 48 hours, and you''re paid for the trip.', t.title),
          '/declutter?tab=deliver', t.customer_id);
        PERFORM public.declutter_notify(t.customer_id, 'payment', 'The delivery couldn''t be finished',
          format('"%s" goes back to the seller and the sale is cancelled. You get back what you paid, less the delivery fee, which pays the Helpr for the trip, and less the small part the card network kept for the payment, which it doesn''t give back.', t.title),
          '/declutter?tab=buying', t.helpr_id);
        PERFORM public.declutter_notify(t.pickup_contact_id, 'info', 'Your item is coming back',
          format('The Helpr couldn''t leave "%s" and brings it back within 48 hours. Confirm in Selling when you have it.', t.title),
          '/declutter?tab=selling', t.helpr_id);
        v_stuck := v_stuck + 1;
      ELSIF t.stuck_stage = 'returned' AND t.return_answer_by <= now() THEN
        PERFORM public.declutter_delivery_return_finish(t.id);
        v_stuck := v_stuck + 1;
      ELSIF (t.stuck_stage IN ('returning', 'collecting') AND t.stuck_return_by <= now())
         OR (t.stuck_stage = 'awaiting_choice' AND t.stuck_choice_by <= now()) THEN
        -- Nobody finished it: Louisiana Helpr decides, the money held, and no second strike.
        SELECT * INTO v_o FROM public.declutter_orders WHERE id = t.source_id;
        INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
        VALUES (t.source_id, t.helpr_id, 'helpr', 'other',
                CASE WHEN t.stuck_stage = 'awaiting_choice' THEN 'The item is back with the seller, and the buyer hasn''t chosen a refund or re-posting in 48 hours.'
                     WHEN t.stuck_stage = 'collecting' THEN 'The buyer was going to collect the item from the Helpr, and 48 hours have passed without it being confirmed.'
                     ELSE 'The Helpr reported they couldn''t finish, and hasn''t brought the item back to the seller in 48 hours.' END,
                '{}');
        PERFORM public.declutter_notify(t.customer_id, 'warning', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". The money stays held until it decides.', t.title), '/declutter?tab=buying', t.helpr_id);
        PERFORM public.declutter_notify(t.pickup_contact_id, 'warning', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". The money stays held until it decides.', t.title), '/declutter?tab=selling', t.helpr_id);
        PERFORM public.declutter_notify(t.helpr_id, 'warning', 'Louisiana Helpr is looking at this delivery',
          format('About "%s". It decides what happens next.', t.title), '/declutter?tab=deliver', NULL);
        -- A cron has no caller for the gate to read, so test data is skipped here too (20261030150104's rule).
        IF NOT (t.is_seed OR public.is_test_subject(t.customer_id) OR public.is_test_subject(t.pickup_contact_id) OR public.is_test_subject(t.helpr_id)) THEN
          FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
            PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter delivery stuck',
              'A delivery a Helpr couldn''t finish has stalled. The money is held until you decide it.', '/admin');
          END LOOP;
        END IF;
        v_stuck := v_stuck + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('helpr_task_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('unfilled', v_unfilled, 'helpr_no_show', v_noshow, 'auto_confirmed', v_auto,
                            'still_in_hand_nudged', v_in_hand, 'seller_report_unanswered', v_no_answer,
                            'stuck_steps', v_stuck);
END;
$function$;

REVOKE ALL ON FUNCTION public.helpr_task_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_sweep() TO service_role;
CREATE OR REPLACE FUNCTION public.declutter_delivery_still_in_hand(p_order_id uuid, p_task uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o public.declutter_orders;
  t public.helpr_tasks;
  v_item text;
  v_when text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  v_item := public.declutter_order_items_named(o.id);
  v_when := to_char(t.picked_up_at AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD');
  -- The member's own Pickups switch: off means none of this.
  IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = t.helpr_id AND np.declutter_pickups IS FALSE) THEN
    PERFORM public.declutter_pickup_remind(t.helpr_id, 'Still have this delivery?',
      format('You picked up %s on %s and it isn''t marked delivered. Take the drop-off photo at the address when you leave it. If you can''t, tap "I can''t deliver this" on the delivery.', v_item, v_when),
      '/declutter?tab=deliver', o.buyer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.buyer_id AND np.declutter_pickups IS FALSE) THEN
    PERFORM public.declutter_pickup_remind(o.buyer_id, 'Is your delivery still coming?',
      format('The Helpr picked up %s on %s and hasn''t marked it delivered. If you have it, tap "I got it" in Buying. If not, report a problem there. Your money stays held until then.', v_item, v_when),
      '/declutter?tab=buying', t.helpr_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notification_preferences np WHERE np.user_id = o.seller_id AND np.declutter_pickups IS FALSE) THEN
    PERFORM public.declutter_pickup_remind(o.seller_id, 'This delivery hasn''t arrived yet',
      format('The Helpr picked up %s on %s and hasn''t marked it delivered. You''re paid once the buyer has it. If you didn''t hand it over, report a problem in Selling.', v_item, v_when),
      '/declutter?tab=selling', t.helpr_id);
  END IF;
  RETURN jsonb_build_object('result', 'still_in_hand');
END;
$function$;
