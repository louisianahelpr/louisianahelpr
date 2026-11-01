-- Declutter manager mode, phase 2: the money split (owner 11-01: the manager's share is a % of each sale OR a flat $
-- per sold item, paid through Stripe to each person's own payout account; lead plan + 5 additions, 11-01).
--
-- What was missing: phase 1 lets a manager sell for the seller, but every sale still paid the whole item money to the
-- seller. Now:
--   1. FIXED AT THE SALE. When an order turns 'paid', the seller's ACTIVE grant (if any) is copied into
--      declutter_order_manager_shares. Nothing changes that row: a grant ended after the payment keeps its share for
--      that order; one created or ended before the payment gives none. Free claims get none.
--   2. SPLIT AT THE HANDOVER (declutter_complete_handover, restated from 20261031231150 with only the split added).
--      share = floor(items * pct / 100), or least(cents * items sold, items): a flat share above the sale price is
--      capped, so the seller's row is never negative. Order (lead): items + rate - share, then the fee debt and the
--      setup fee from what is left; a debt that does not fit carries forward as today and never reduces the share.
--      The seller's declutter_payouts row records manager_share_cents; the manager gets their OWN row in
--      declutter_manager_payouts, sent by declutter-money as a SEPARATE transfer to the manager's own account.
--   3. REFUNDS (declutter_rebook_payout, restated from 20261031214749): the share is cut in proportion,
--      floor(share * (paid - refunded) / paid); a full refund leaves 0 (nothing_due). declutter_payout_unsent
--      (restated from 20261031204932) also answers false once the manager's transfer may have started, so a refund
--      after either send is refused (payout_already_sent), as today.
--   4. THE SEND ORDER (lead): declutter_manager_payouts_due offers a manager row only when the seller's own row is
--      payable by the same gates (sale final, no open problem, no part refund waiting, not held for review), and the
--      two people are not blocked. A manager without a payout account waits (declutter-money), never paid to the seller.
-- Not here (separate commit for review): declutter-money's transfer for the manager row and the payout_kind
-- 'declutter_manager' in the send-mark/skip tables.
-- Guard: src/test/declutterManagerShareSplit.test.ts; proof src/test/pglite/declutterManagerShareSplit.pglite.mjs.

-- 1. The share fixed at the sale.
CREATE TABLE IF NOT EXISTS public.declutter_order_manager_shares (
  order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  grant_id uuid REFERENCES public.declutter_manager_grants(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  share_type text NOT NULL CHECK (share_type IN ('percent', 'flat')),
  share_pct integer CHECK (share_pct BETWEEN 0 AND 100),
  share_cents integer CHECK (share_cents BETWEEN 0 AND 1000000),
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_order_manager_shares_share CHECK (
    (share_type = 'percent' AND share_pct IS NOT NULL AND share_cents IS NULL)
    OR (share_type = 'flat' AND share_cents IS NOT NULL AND share_pct IS NULL))
);
ALTER TABLE public.declutter_order_manager_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_order_manager_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_order_manager_shares TO authenticated;
GRANT ALL ON TABLE public.declutter_order_manager_shares TO service_role;
DROP POLICY IF EXISTS declutter_order_manager_shares_read ON public.declutter_order_manager_shares;
CREATE POLICY declutter_order_manager_shares_read ON public.declutter_order_manager_shares FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR manager_id = (SELECT auth.uid()));

-- 2. The manager's payout rows (one per order). Same shape and statuses as declutter_payouts.
CREATE TABLE IF NOT EXISTS public.declutter_manager_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
  seller_payout_id uuid NOT NULL REFERENCES public.declutter_payouts(id) ON DELETE RESTRICT,
  grant_id uuid REFERENCES public.declutter_manager_grants(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  share_cents integer NOT NULL CHECK (share_cents >= 0),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due')),
  stripe_transfer_id text UNIQUE CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id ~ '^tr_'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT declutter_manager_payouts_amount CHECK (amount_cents <= share_cents),
  CONSTRAINT declutter_manager_payouts_nothing_due CHECK ((status = 'nothing_due') = (amount_cents = 0)),
  CONSTRAINT declutter_manager_payouts_transfer CHECK (status <> 'succeeded' OR stripe_transfer_id IS NOT NULL)
);
ALTER TABLE public.declutter_manager_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_manager_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, order_id, seller_id, manager_id, share_cents, amount_cents, status, created_at, executed_at)
  ON TABLE public.declutter_manager_payouts TO authenticated;
GRANT ALL ON TABLE public.declutter_manager_payouts TO service_role;
DROP POLICY IF EXISTS declutter_manager_payouts_read ON public.declutter_manager_payouts;
CREATE POLICY declutter_manager_payouts_read ON public.declutter_manager_payouts FOR SELECT TO authenticated
  USING (seller_id = (SELECT auth.uid()) OR manager_id = (SELECT auth.uid()));

-- 3. The seller's row records the share taken off it.
ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS manager_share_cents integer NOT NULL DEFAULT 0;
DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_payouts.declutter_payouts_amount
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_amount;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_amount
    CHECK (amount_cents = items_cents + delivery_cents - refunded_cents - manager_share_cents - debt_cents AND amount_cents >= 0);
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_manager_share;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_manager_share
    CHECK (manager_share_cents BETWEEN 0 AND items_cents);
END
$do$;
GRANT SELECT (manager_share_cents) ON TABLE public.declutter_payouts TO authenticated;

-- 4. The share of one order, from the row fixed at the sale (0 without one, or once the manager's account is gone).
CREATE OR REPLACE FUNCTION public.declutter_manager_share_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT CASE s.share_type
             WHEN 'percent' THEN floor(o.items_cents::numeric * s.share_pct / 100)::integer
             ELSE least(s.share_cents::bigint * (SELECT count(*) FROM public.declutter_cart_items c
                                                  WHERE c.order_id = o.id AND c.status = 'paid'),
                        o.items_cents)::integer
           END
      FROM public.declutter_order_manager_shares s JOIN public.declutter_orders o ON o.id = s.order_id
     WHERE s.order_id = p_order_id AND s.manager_id IS NOT NULL AND o.paid_with IS DISTINCT FROM 'free'), 0);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_share_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_manager_share_cents(uuid) TO service_role;

-- 5. Fix the share when the order is paid (every path that pays sets status 'paid' once: the guard on OLD keeps a
--    second 'paid' write from re-firing, and ON CONFLICT DO NOTHING keeps the first row).
CREATE OR REPLACE FUNCTION public.declutter_lock_manager_share()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.paid_with IS DISTINCT FROM 'free' THEN
    INSERT INTO public.declutter_order_manager_shares (order_id, grant_id, seller_id, manager_id, share_type, share_pct, share_cents)
    SELECT NEW.id, g.id, g.seller_id, g.manager_id, g.share_type, g.share_pct, g.share_cents
      FROM public.declutter_manager_grants g
     WHERE g.seller_id = NEW.seller_id AND g.status = 'active'
    ON CONFLICT (order_id) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_lock_manager_share() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_lock_manager_share ON public.declutter_orders;
CREATE TRIGGER trg_declutter_lock_manager_share
  AFTER UPDATE OF status ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_lock_manager_share();

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
      PERFORM public.declutter_notify(v_ms.manager_id, 'payment', 'You earned a share',
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
  -- Manager mode phase 2: the share at the time of sale, cut in proportion to what is refunded.
  v_m public.declutter_manager_payouts;
  v_share integer := 0;
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
  SELECT * INTO v_m FROM public.declutter_manager_payouts WHERE order_id = p_order_id FOR UPDATE;
  IF v_m.id IS NOT NULL THEN
    -- declutter_payout_unsent also answers false once the manager's transfer may have started, so this is the share
    -- of what is left: floor(share * (paid - refunded) / paid). A full refund leaves 0.
    v_share := CASE WHEN p.items_cents + p.delivery_cents = 0 THEN 0
                    ELSE floor(v_m.share_cents::numeric * (p.items_cents + p.delivery_cents - p_refunded_cents)
                               / (p.items_cents + p.delivery_cents))::integer END;
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
    v_debt := public.declutter_consume_fee_debt(p.seller_id, v_ref, p.items_cents + p.delivery_cents - p_refunded_cents - v_share);
  ELSE
    -- The seller's account is gone: nothing can be put back to them.
    v_debt := least(p.debt_cents - v_fee, p.items_cents + p.delivery_cents - p_refunded_cents - v_share);
  END IF;
  UPDATE public.declutter_payouts
     SET refunded_cents = p_refunded_cents, debt_cents = v_debt, setup_fee_cents = 0, manager_share_cents = v_share,
         amount_cents = items_cents + delivery_cents - p_refunded_cents - v_share - v_debt,
         status = CASE WHEN items_cents + delivery_cents - p_refunded_cents - v_share - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END,
         -- A rebooked payout starts a fresh run of tries (B24, 10-31): one rebooked after its last try would
         -- otherwise sit 'pending' forever (declutter_payouts_due takes attempts < 12).
         attempts = 0, next_attempt_at = now()
   WHERE id = p.id;
  IF v_m.id IS NOT NULL THEN
    UPDATE public.declutter_manager_payouts
       SET amount_cents = v_share, status = CASE WHEN v_share = 0 THEN 'nothing_due' ELSE 'pending' END,
           attempts = 0, next_attempt_at = now()
     WHERE id = v_m.id;
  END IF;
  RETURN p.items_cents + p.delivery_cents - p_refunded_cents - v_share - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_rebook_payout(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_rebook_payout(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_payout_unsent(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT p.status IN ('pending', 'nothing_due') AND p.stripe_transfer_id IS NULL AND p.attempts = 0
           AND NOT EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id)
           AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                            WHERE a.action = 'admin_payout_release' AND a.target_type = 'declutter' AND a.target_id = p.id::text)
      FROM public.declutter_payouts p WHERE p.order_id = p_order_id), false)
    -- Manager mode phase 2: and the manager's share has not started to go either.
    AND NOT EXISTS (SELECT 1 FROM public.declutter_manager_payouts m
                     WHERE m.order_id = p_order_id
                       AND (m.status NOT IN ('pending', 'nothing_due') OR m.stripe_transfer_id IS NOT NULL OR m.attempts > 0
                            OR EXISTS (SELECT 1 FROM public.payout_send_marks k WHERE k.payout_kind = 'declutter_manager' AND k.payout_id = m.id)));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payout_unsent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_unsent(uuid) TO service_role;

-- 6. The manager rows declutter-money may send now: the same gates as the seller's own row (declutter_payouts_due,
--    20261026155251), and the seller's row itself payable (not held for review), and no block between the two.
CREATE OR REPLACE FUNCTION public.declutter_manager_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, manager_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, attempts integer, refunds_recorded_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT m.id, m.order_id, o.buyer_id, m.seller_id, m.manager_id, m.amount_cents, pr.stripe_account_id,
         o.stripe_payment_intent_id, m.attempts, public.declutter_order_refunds_recorded_cents(o.id)
    FROM public.declutter_manager_payouts m
    JOIN public.declutter_orders o ON o.id = m.order_id
    JOIN public.declutter_payouts sp ON sp.id = m.seller_payout_id
    LEFT JOIN public.profiles pr ON pr.user_id = m.manager_id
   WHERE m.status IN ('pending', 'failed') AND m.next_attempt_at <= now() AND m.attempts < 12
     AND m.manager_id IS NOT NULL
     AND sp.status IN ('pending', 'failed', 'succeeded', 'nothing_due') AND sp.review_held_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = m.order_id AND x.status = 'open')
     AND public.declutter_sale_final(m.order_id)
     AND NOT EXISTS (SELECT 1 FROM public.declutter_refunds rf
                      WHERE rf.order_id = m.order_id AND rf.stripe_payment_intent_id = o.stripe_payment_intent_id
                        AND rf.reason = 'refund_request_part' AND rf.status IN ('pending', 'failed'))
     AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = m.seller_id AND b.blocked_id = m.manager_id)
                         OR (b.blocker_id = m.manager_id AND b.blocked_id = m.seller_id))
   ORDER BY m.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_manager_payouts_due(integer) TO service_role;

-- 7. Record a manager transfer (the seller's declutter_payout_executed, 20261015042253, for the manager's table).
CREATE OR REPLACE FUNCTION public.declutter_manager_payout_executed(p_payout_id uuid, p_transfer_id text, p_succeeded boolean,
  p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded AND (p_transfer_id IS NULL OR p_transfer_id !~ '^tr_') THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_manager_payouts
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_transfer_id = CASE WHEN p_succeeded THEN p_transfer_id ELSE stripe_transfer_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_payout_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_manager_payouts WHERE id = p_payout_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_payout_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_manager_payout_executed(uuid, text, boolean, text) TO service_role;
