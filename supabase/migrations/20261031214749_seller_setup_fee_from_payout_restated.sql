-- The seller's one-time $2 comes out of their Declutter payout once items sell (owner 2026-10-30: "Declutter seller:
-- ID at listing. $2 from payout once items sell."). Once per account, ever: the same profiles.onboarding_fee_paid flag
-- and the same one-winner conditional UPDATE as every other path (declutter_claim_setup_fee, release-payout,
-- process-scheduled-payouts, pay-onboarding-fee).
--
-- BEHIND THE SWITCH `identity_check`, which stays OFF. identity_check_exempt() is TRUE while it is off, so landing this
-- changes nothing: a first paid listing still pays by card, and no payout is touched.
--
-- With it on, for an ordinary member:
--   * declutter_setup_fee_before_list no longer refuses the listing.
--   * The handover notice says the fee is coming, before any money moves.
--   * declutter_payout_take_setup_fee, called by declutter-money right before the transfer, claims the fee and lowers
--     that payout by it. Only then: the sale is final (declutter_payouts_due only offers a final sale), so a sale
--     refunded inside the buyer's 24 hours never pays the fee.
--
-- How the money is recorded: the fee is ADDED to debt_cents and named in setup_fee_cents, so the amount CHECK
-- (amount = items + delivery - refunded - debt) and every writer that recomputes from debt_cents stay right with no
-- change. The transfer is simply $2 smaller than the buyer's charge funds, and the platform keeps the difference.
--
-- Never touched: a row with a try already used (attempts > 0). Its Stripe idempotency key was sent with the old amount,
-- and a new amount under that key is refused. The fee then waits for the next sale.
-- A payout that cannot carry the fee and still send at least $1 waits too: the flag stays unset for the next sale.
--
-- REBUILT 2026-10-31 (LEAD-B49-REBUILD, Builder 31) from Builder 49's 20261031002445 (wip/b49-1030-id-rulings), which
-- never landed. Same SQL, new timestamp, every restated function re-read from origin/main's NEWEST CREATE (492d2b3241):
--   declutter_complete_handover     20261028232338_declutter_damage_no_enjoy_notice.sql (B49's base; only B49's notice lines added)
--   declutter_setup_fee_before_list 20261027170717_declutter_free_section.sql (B49's base; only B49's exempt early return added)
--   declutter_rebook_payout         20261031200034_declutter_payout_tries_restart.sql (NEWER than B49's base 20261027153244:
--                                   its attempts = 0 / next_attempt_at = now() restart is kept; only B49's fee lines added)
-- Note for review: with main's restart, a rebooked row has attempts = 0, so declutter_payout_take_setup_fee may add the fee
-- at the next send. The send is keyed on the row id (declutter-payout-<id>) and a rebook already changes the amount under
-- that key; the run adopts a transfer already made (declutter-money/index.ts). Same risk class as the rebook itself.
-- Replay-safe: ADD COLUMN IF NOT EXISTS, guarded CHECK, CREATE OR REPLACE, grants restated.
-- Proof: src/test/pglite/sellerSetupFeeFromPayout.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red).
-- Owner rule (OWNER-DECISIONS.md, 10-30): "Declutter seller: ID at listing. $2 from payout once items sell." Lead 10-31 confirmed.

ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS setup_fee_cents integer NOT NULL DEFAULT 0;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_payouts_setup_fee'
                   AND conrelid = 'public.declutter_payouts'::regclass) THEN
    ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_setup_fee
      CHECK (setup_fee_cents >= 0 AND setup_fee_cents <= 10000);
  END IF;
END
$do$;
COMMENT ON COLUMN public.declutter_payouts.setup_fee_cents IS
  'The one-time account setup fee taken out of this payout (owner 2026-10-30). Also counted inside debt_cents, so the amount CHECK holds. 0 for almost every row.';
GRANT SELECT (setup_fee_cents) ON TABLE public.declutter_payouts TO authenticated;

-- The fee this seller's next payout would carry: the platform's live amount while the ID check is on for them, they are
-- not an admin, and the account has never paid it. Else 0. Internal (definer callers only).
CREATE OR REPLACE FUNCTION public.declutter_setup_fee_from_payout_cents(p_seller uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_seller IS NULL OR public.identity_check_exempt(p_seller) OR public.has_role(p_seller, 'admin') THEN 0
    ELSE public.declutter_setup_fee_due_cents(p_seller)
  END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_from_payout_cents(uuid) FROM PUBLIC, anon, authenticated;

-- Right before the transfer: take the fee once and answer the amount to send. Idempotent: a row that already carries the
-- fee answers its stored amount, so a retry sends the same amount under the same Stripe key.
CREATE OR REPLACE FUNCTION public.declutter_payout_take_setup_fee(p_payout_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
  v_fee integer;
  v_won boolean;
  v_amount integer;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p.status NOT IN ('pending', 'failed') OR p.setup_fee_cents > 0 OR p.attempts > 0 THEN
    RETURN p.amount_cents;
  END IF;
  v_fee := public.declutter_setup_fee_from_payout_cents(p.seller_id);
  IF v_fee <= 0 OR p.amount_cents - v_fee < 100 THEN
    RETURN p.amount_cents;
  END IF;
  UPDATE public.profiles
     SET onboarding_fee_paid = true, onboarding_fee_charged_at = now()
   WHERE user_id = p.seller_id AND onboarding_fee_paid IS NOT TRUE
  RETURNING onboarding_fee_paid INTO v_won;
  IF v_won IS NOT TRUE THEN
    RETURN p.amount_cents;
  END IF;
  v_amount := p.amount_cents - v_fee;
  UPDATE public.declutter_payouts
     SET setup_fee_cents = v_fee, debt_cents = debt_cents + v_fee, amount_cents = v_amount
   WHERE id = p.id;
  PERFORM public.declutter_notify(p.seller_id, 'payment', 'One-time setup fee taken',
    format('We took the one-time $%s account setup fee from your payout for %s, so $%s is on its way. It is never charged again.',
           to_char(v_fee / 100.0, 'FM999990.00'), public.declutter_order_items_named(p.order_id), to_char(v_amount / 100.0, 'FM999990.00')),
    '/declutter?tab=selling', NULL);
  RETURN v_amount;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payout_take_setup_fee(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_take_setup_fee(uuid) TO service_role;

-- A refund after the claim and before the send puts the fee back. Restated from main's NEWEST CREATE,
-- 20261031200034_declutter_payout_tries_restart.sql (attempts restart on rebook kept), plus B49's fee lines.
CREATE OR REPLACE FUNCTION public.declutter_rebook_payout(p_order_id uuid, p_refunded_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
  v_ref text := 'declutter_order_' || p_order_id::text;
  v_debt integer;
  v_fee integer;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_missing' USING ERRCODE = 'P0002';
  END IF;
  IF p_refunded_cents IS NULL OR p_refunded_cents < 0 OR p_refunded_cents > p.items_cents + p.delivery_cents THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF NOT public.declutter_payout_unsent(p_order_id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000';
  END IF;
  -- A refund between the fee's claim and the send (declutter_payout_unsent says nothing has gone out). The debt below is
  -- recomputed from fee debts alone, so the fee would drop out of debt_cents while setup_fee_cents and the paid flag
  -- stayed: never collected. So it is put back whole: the row carries no fee, the account owes it again, and
  -- declutter_payout_take_setup_fee takes it at the send if what is left still sends $1, else from a later sale.
  -- Only a row carrying the fee clears the flag, and that row is what set it.
  v_fee := p.setup_fee_cents;
  IF v_fee > 0 AND p.seller_id IS NOT NULL THEN
    UPDATE public.profiles SET onboarding_fee_paid = false, onboarding_fee_charged_at = NULL
     WHERE user_id = p.seller_id;
    PERFORM public.declutter_notify(p.seller_id, 'declutter_sales', 'One-time setup fee put back',
      format('A refund changed your payout for %s, so we put back the one-time $%s account setup fee. It comes out of this payout or a later one instead, and it is only ever charged once.',
             public.declutter_order_items_named(p_order_id), to_char(v_fee / 100.0, 'FM999990.00')),
      '/declutter?tab=selling', NULL);
  END IF;
  IF p.seller_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || p.seller_id::text, 0));
    UPDATE public.declutter_seller_fee_debts d
       SET remaining_cents = d.remaining_cents + x.deducted_cents
      FROM public.declutter_fee_debt_deductions x
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    DELETE FROM public.declutter_fee_debt_deductions x
     USING public.declutter_seller_fee_debts d
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    v_debt := public.declutter_consume_fee_debt(p.seller_id, v_ref, p.items_cents + p.delivery_cents - p_refunded_cents);
  ELSE
    -- The seller's account is gone: nothing can be put back to them.
    v_debt := least(p.debt_cents - v_fee, p.items_cents + p.delivery_cents - p_refunded_cents);
  END IF;
  UPDATE public.declutter_payouts
     SET refunded_cents = p_refunded_cents, debt_cents = v_debt, setup_fee_cents = 0,
         amount_cents = items_cents + delivery_cents - p_refunded_cents - v_debt,
         status = CASE WHEN items_cents + delivery_cents - p_refunded_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
         -- A rebooked payout starts a fresh run of tries (B24, 10-31): one rebooked after its last try would
         -- otherwise sit 'pending' forever (declutter_payouts_due takes attempts < 12).
         attempts = 0, next_attempt_at = now()
   WHERE id = p.id;
  RETURN p.items_cents + p.delivery_cents - p_refunded_cents - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_rebook_payout(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_rebook_payout(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_setup_fee_before_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status IN ('pending_review', 'live') AND (TG_OP = 'INSERT' OR OLD.status IN ('draft', 'paused')) THEN
    IF public.is_server_context() OR auth.uid() IS NULL OR NEW.seller_id IS DISTINCT FROM auth.uid() THEN
      RETURN NEW;
    END IF;
    -- Admins and enrolled test accounts (is_seed AND a test_accounts row) are
    -- never asked. Spelled out here, NOT identity_check_exempt(): since
    -- 20261023213857 that is also true for every member while the ID switch is
    -- off, which would skip the setup fee at every first listing (PGlite step 10).
    IF public.has_role(auth.uid(), 'admin') OR COALESCE((
         SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
           FROM public.profiles p WHERE p.user_id = auth.uid()
       ), false) THEN
      RETURN NEW;
    END IF;
    -- A FREE item (20261027170717; owner 2026-10-27, "No fee for free listings") never charges the setup
    -- fee: it is charged once per account at the first PAID listing, purchase or job, as before.
    IF NEW.current_price_cents = 0 THEN
      RETURN NEW;
    END IF;
    -- Owner 2026-10-30: while the ID check is on for this seller, listing asks for no card: the fee comes out of
    -- their payout once items sell (declutter_payout_take_setup_fee). identity_check_exempt is TRUE while the switch
    -- is off, and admins and enrolled test accounts already left above, so off stays exactly as it was: a card here.
    IF NOT public.identity_check_exempt(auth.uid()) THEN
      RETURN NEW;
    END IF;
    IF public.declutter_setup_fee_due_cents(auth.uid()) > 0 THEN
      RAISE EXCEPTION 'setup_fee_required_to_list' USING ERRCODE = '42501',
        HINT = 'Your first listing needs the one-time account setup fee. It is charged once per account, and never again if you already paid it for Jobs.';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_setup_fee_before_list() FROM PUBLIC, anon, authenticated;

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
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed') THEN
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
    END
    -- Owner 2026-10-30: said before the money moves. Taken when the payout is sent (declutter_payout_take_setup_fee).
    || CASE WHEN public.declutter_setup_fee_from_payout_cents(o.seller_id) > 0
              AND o.items_cents + v_rate - v_debt - public.declutter_setup_fee_from_payout_cents(o.seller_id) >= 100 THEN
         format(' Your one-time $%s account setup fee comes out of your payout. It is only ever charged once.',
                to_char(public.declutter_setup_fee_from_payout_cents(o.seller_id) / 100.0, 'FM999990.00'))
       ELSE '' END,
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
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;
