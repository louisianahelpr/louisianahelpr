-- Manager mode phase 2b, the lead's condition on 266e149865: the admin money page lists, releases and settles a
-- held manager row. 20261101233256 let declutter-money hold a manager payout for review (status held_for_review),
-- but admin_payouts_held_for_review, admin_payout_release, admin_payout_settle_by_hand and payout_held_check knew
-- only the other six kinds, so a held manager share would sit unseen: no admin row, no daily page, no notice.
--
-- Here: the manager table takes 'settled_by_hand' and the settle columns (as declutter_payouts has them), the
-- settlements ledger takes the kind, and the four functions dispatch it. A manager's transfer id (tr_) is found by
-- money_ref_in_use already (it scans every *transfer_id column), so a sibling's transfer is never reused.
-- Replay-safe: DROP CONSTRAINT IF EXISTS + ADD, ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE. Grants unchanged: the
-- admin functions are authenticated + service_role and check has_role(admin) first; payout_held_check service only.
-- Proof: src/test/pglite/declutterManagerPayoutKind.pglite.mjs (A1-A5). Guard: src/test/declutterManagerPayoutKind.test.ts.

-- 1. The manager rows can be settled by hand; the ledger takes the kind.
DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_manager_payouts.declutter_manager_payouts_status_check
  ALTER TABLE public.declutter_manager_payouts DROP CONSTRAINT IF EXISTS declutter_manager_payouts_status_check;
  ALTER TABLE public.declutter_manager_payouts ADD CONSTRAINT declutter_manager_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.payout_settlements.payout_settlements_row_kind_check
  ALTER TABLE public.payout_settlements DROP CONSTRAINT IF EXISTS payout_settlements_row_kind_check;
  ALTER TABLE public.payout_settlements ADD CONSTRAINT payout_settlements_row_kind_check
    CHECK (row_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund', 'shop_refund', 'declutter_manager'));
END
$do$;
ALTER TABLE public.declutter_manager_payouts ADD COLUMN IF NOT EXISTS held_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
  ADD COLUMN IF NOT EXISTS settled_by_hand_note text;

-- 2. The admin money page lists a held manager row (restated from 20261019112103).
CREATE OR REPLACE FUNCTION public.admin_payouts_held_for_review()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(held.h || jsonb_build_object(
      'payee_account', (SELECT pr.stripe_account_id FROM public.profiles pr WHERE pr.user_id = (held.h ->> 'payee_id')::uuid),
      'sibling_refs', (SELECT COALESCE(jsonb_agg(to_jsonb(sb) ORDER BY sb.ref), '[]'::jsonb) FROM (
          SELECT 'declutter' AS kind, x.id, x.stripe_transfer_id AS ref, x.amount_cents FROM public.declutter_payouts x
           WHERE x.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'helpr_task', x.id, x.stripe_transfer_id, x.amount_cents FROM public.helpr_task_payouts x
           WHERE x.helpr_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'shop', x.id, x.stripe_transfer_id, x.amount_cents FROM public.shop_payouts x JOIN public.shop_orders so ON so.id = x.order_id
           WHERE so.seller_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          UNION ALL
          SELECT 'declutter_manager', x.id, x.stripe_transfer_id, x.amount_cents FROM public.declutter_manager_payouts x
           WHERE x.manager_id = (held.h ->> 'payee_id')::uuid AND x.stripe_transfer_id IS NOT NULL
          LIMIT 20) sb))
    ORDER BY held.h ->> 'held_at'), '[]'::jsonb) FROM (
    SELECT to_jsonb(x) AS h FROM (
      SELECT 'declutter' AS kind, p.id, p.seller_id AS payee_id, p.amount_cents, p.review_reason AS reason, p.review_held_at AS held_at,
             'declutter_order_' || p.order_id::text AS stripe_group
        FROM public.declutter_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      -- Manager mode: the manager's share, sent in the same order's transfer group as the seller's payout.
      SELECT 'declutter_manager', p.id, p.manager_id, p.amount_cents, p.review_reason, p.review_held_at,
             'declutter_order_' || p.order_id::text
        FROM public.declutter_manager_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      -- The REAL transfer group a Helpr's delivery payout is sent in: its Declutter order's.
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.review_held_at,
             CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || t.source_id::text END
        FROM public.helpr_task_payouts p LEFT JOIN public.helpr_tasks t ON t.id = p.task_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.review_held_at, 'shop_order_' || p.order_id::text
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id
        FROM public.declutter_refunds r LEFT JOIN public.declutter_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.review_held_at, d.stripe_payment_intent_id
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      -- Shops: an app refund held because a refund made in Stripe stands on its order.
      SELECT 'shop_refund', r.id, o.buyer_id, r.refund_cents, r.review_reason, r.review_held_at, r.stripe_payment_intent_id
        FROM public.shop_refunds r JOIN public.shop_orders o ON o.id = r.order_id WHERE r.status = 'held_for_review'
    ) x) held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payouts_held_for_review() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payouts_held_for_review() TO authenticated, service_role;

-- 3. Release a held manager row (restated from 20261031200034, the newest).
CREATE OR REPLACE FUNCTION public.admin_payout_release(p_kind text, p_id uuid, p_note text, p_confirm_no_transfer boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_status text;
  v_order uuid;
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why, in under 500 characters.';
  END IF;
  IF p_confirm_no_transfer IS NOT TRUE THEN
    RAISE EXCEPTION 'confirm_no_transfer_required' USING ERRCODE = '22023',
      HINT = 'Confirm you checked Stripe and no transfer or refund was made for this row outside the app.';
  END IF;
  -- Shops: the order row lock first (one lock order for every Shops money path: the order,
  -- then its refund / payout rows, then hand-refund rows).
  IF p_kind = 'shop' THEN
    SELECT order_id INTO v_order FROM public.shop_payouts WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT order_id INTO v_order FROM public.shop_refunds WHERE id = p_id;
  END IF;
  IF v_order IS NOT NULL THEN
    SELECT * INTO o FROM public.shop_orders WHERE id = v_order FOR UPDATE;
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status INTO v_status FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT status INTO v_status FROM public.shop_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_manager' THEN
    SELECT status INTO v_status FROM public.declutter_manager_payouts WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF v_status IS DISTINCT FROM 'held_for_review' THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- Shops: a release the queue would never send is refused, so nothing sits 'pending' forever.
  -- While a refund made in Stripe that the app has not accounted for stands on the order
  -- (shop_order_unaccounted_hand_refund: every Shops queue skips it), or the order was closed by
  -- one, the row STAYS held and the admin decides it by hand.
  IF p_kind IN ('shop', 'shop_refund') THEN
    IF public.shop_order_unaccounted_hand_refund(v_order) OR (p_kind = 'shop' AND o.close_reason = 'refunded_by_hand') THEN
      RAISE EXCEPTION 'refunded_in_stripe' USING ERRCODE = '55000',
        HINT = 'A refund made in Stripe stands on this order, so this stays held. Settle it by hand once you have decided.';
    END IF;
    IF p_kind = 'shop' AND NOT (
         (o.status = 'handed_over' OR (o.status = 'cancelled' AND o.close_reason IN ('buyer_cancelled_late', 'buyer_no_show')))
         AND NOT EXISTS (SELECT 1 FROM public.shop_handovers h WHERE h.order_id = v_order AND h.problem_at IS NOT NULL
                           AND h.confirmed_how IS DISTINCT FROM 'admin')) THEN
      RAISE EXCEPTION 'shop_payout_not_due' USING ERRCODE = '55000',
        HINT = 'The shop is not paid for this order automatically (open problem, or not handed over). Settle it by hand.';
    END IF;
  END IF;
  IF p_kind = 'declutter' THEN
    -- A released Declutter payout starts a fresh run of tries, as a Shops one does (B24, 10-31): one held on its
    -- last try would otherwise never be offered again (declutter_payouts_due takes attempts < 12). No double pay:
    -- the run lists the order's transfer group before any send and keys the send on the row id.
    UPDATE public.declutter_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'helpr_task' THEN
    -- The same for a Helpr's delivery pay (its run also lists the transfer group before any send).
    UPDATE public.helpr_task_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'shop' THEN
    -- A released Shops row starts a fresh run of tries (run-3 review #4): one held on its last
    -- try would otherwise never be offered again (the queues take attempts < 12).
    UPDATE public.shop_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = 'pending', next_attempt_at = now(), review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'shop_refund' THEN
    -- Fresh tries AND a fresh run of idempotency keys (shop-refund-<id>-v<reversals>[-r<n>], as
    -- shop_refund_reversed does): resetting attempts alone would rebuild a key already used, and Stripe
    -- would replay its stored answer (run-3 review M1).
    UPDATE public.shop_refunds SET status = 'pending', next_attempt_at = now(), attempts = 0, reversals = least(reversals + 1, 100),
           review_reason = NULL, review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSIF p_kind = 'declutter_manager' THEN
    -- Fresh tries, as the seller's row: the run lists the order's group by payout_id before any send and keys it on the id.
    UPDATE public.declutter_manager_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, review_reason = NULL,
           review_held_at = NULL
     WHERE id = p_id AND status = 'held_for_review';
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_release', p_kind, p_id::text, jsonb_build_object('note', v_note, 'confirmed_no_transfer', true));
  RETURN jsonb_build_object('result', 'released', 'kind', p_kind, 'id', p_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_release(text, uuid, text, boolean) TO authenticated, service_role;

-- 4. Settle a held manager row by hand (restated from 20261019112103).
CREATE OR REPLACE FUNCTION public.admin_payout_settle_by_hand(p_kind text, p_id uuid, p_ref text, p_amount_cents integer, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  v_ref text := btrim(COALESCE(p_ref, ''));
  v_stripe text;
  v_other text;
  v_status text;
  v_pi text;
  v_adopted boolean := false;
  v_payout boolean := p_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_manager');
  v_succeeded boolean;
  v_refund_cents integer;
  v_order uuid;
  o public.shop_orders;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say how it was settled, in under 500 characters.';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023', HINT = 'Enter the amount it was settled for.';
  END IF;
  IF v_ref ~* '^other:' THEN
    v_other := left(btrim(regexp_replace(v_ref, '^other:', '', 'i')), 300);
    IF char_length(v_other) < 3 THEN
      RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023', HINT = 'Say how it was paid outside Stripe, after "other:".';
    END IF;
  ELSIF (v_payout AND v_ref ~ '^(tr|po)_[A-Za-z0-9]+$') OR (NOT v_payout AND v_ref ~ '^(re|pyr)_[A-Za-z0-9]+$') THEN
    v_stripe := v_ref;
  ELSE
    RAISE EXCEPTION 'invalid_stripe_ref' USING ERRCODE = '22023',
      HINT = 'A Stripe transfer / payout id (tr_..., po_...) for a payout, a refund id (re_...) for a refund, or "other: how it was paid".';
  END IF;
  -- Shops: the order row lock first (one lock order for every Shops money path: the order,
  -- then its refund / payout rows, then hand-refund rows).
  IF p_kind = 'shop' THEN
    SELECT order_id INTO v_order FROM public.shop_payouts WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT order_id INTO v_order FROM public.shop_refunds WHERE id = p_id;
  END IF;
  IF v_order IS NOT NULL THEN
    SELECT * INTO o FROM public.shop_orders WHERE id = v_order FOR UPDATE;
  END IF;
  IF p_kind = 'declutter' THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'helpr_task' THEN
    SELECT status INTO v_status FROM public.helpr_task_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop' THEN
    SELECT status INTO v_status FROM public.shop_payouts WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.declutter_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'delivery_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.declutter_delivery_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'shop_refund' THEN
    SELECT status, refund_cents INTO v_status, v_refund_cents FROM public.shop_refunds WHERE id = p_id FOR UPDATE;
  ELSIF p_kind = 'declutter_manager' THEN
    SELECT status INTO v_status FROM public.declutter_manager_payouts WHERE id = p_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF v_status IS DISTINCT FROM 'held_for_review' THEN
    RAISE EXCEPTION 'not_held_for_review' USING ERRCODE = '55000';
  END IF;
  -- Shops refund (run-3 review #2/#3): a Stripe refund id is checked WITH Stripe first, so it goes
  -- only through shop-checkout's admin_settle_held_refund (service-only shops_admin_settle_held_refund);
  -- here only "other: ...", and only for the WHOLE refund the row owes (CHECK shop_refunds_settled_in_full).
  IF p_kind = 'shop_refund' AND v_stripe IS NOT NULL THEN
    RAISE EXCEPTION 'stripe_check_required' USING ERRCODE = '22023',
      HINT = 'Settle a Shops refund with a Stripe refund id from Payouts held for review: it is checked with Stripe first.';
  END IF;
  IF p_kind = 'shop_refund' AND p_amount_cents <> v_refund_cents THEN
    RAISE EXCEPTION 'settle_amount_differs' USING ERRCODE = '22023',
      HINT = format('A Shops refund is settled only for its whole amount, $%s.', to_char(v_refund_cents / 100.0, 'FM999999990.00'));
  END IF;
  -- A transfer on a payout / a refund (re_ or pyr_) on a refund: 'succeeded' with that id (the
  -- ledgers and the webhooks know it). A Stripe payout id or money paid outside Stripe:
  -- 'settled_by_hand'.
  v_succeeded := v_stripe IS NOT NULL AND (NOT v_payout OR v_stripe ~ '^tr_');
  -- A refund reaches 'succeeded' only for the WHOLE amount owed: a short Stripe refund would
  -- close the row (and count as refunded) while the buyer is still owed the rest.
  IF NOT v_payout AND v_succeeded AND p_amount_cents < COALESCE(v_refund_cents, 0) THEN
    RAISE EXCEPTION 'settle_amount_short' USING ERRCODE = '22023',
      HINT = 'Refund the rest in Stripe first, then record the full amount.';
  END IF;
  IF v_stripe IS NOT NULL THEN
    -- A Dashboard refund the hand-refund ledger recorded with no row, on THIS row's payment, is
    -- the refund that settled it: adopted (linked), not refused.
    IF p_kind = 'declutter_refund' THEN
      SELECT r.stripe_payment_intent_id INTO v_pi FROM public.declutter_refunds r WHERE r.id = p_id;
      UPDATE public.declutter_hand_refunds SET refund_row_id = p_id, hand_outcome = 'settled'
       WHERE stripe_refund_id = v_stripe AND stripe_payment_intent_id = v_pi AND refund_row_id IS NULL AND failed_at IS NULL;
      v_adopted := FOUND;
    END IF;
    IF NOT v_adopted AND public.money_ref_in_use(v_stripe) THEN
      RAISE EXCEPTION 'ref_already_used' USING ERRCODE = '23505',
        HINT = 'That Stripe id is already recorded on another payout or refund. Check you have the right one.';
    END IF;
  END IF;
  INSERT INTO public.payout_settlements (stripe_ref, off_stripe_note, row_kind, row_id, amount_cents)
  VALUES (v_stripe, v_other, p_kind, p_id, p_amount_cents);
  IF p_kind = 'declutter_refund' AND v_stripe IS NOT NULL AND NOT v_adopted THEN
    INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, refund_row_id, amount_cents,
                                               livemode, hand_outcome)
    SELECT v_stripe, r.stripe_payment_intent_id, r.order_id, r.id, p_amount_cents, COALESCE(r.payment_livemode, true), 'settled'
      FROM public.declutter_refunds r WHERE r.id = p_id;
  END IF;
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_refund_ref = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_refund_ref END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'declutter_manager' THEN
    UPDATE public.declutter_manager_payouts SET status = CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END,
           stripe_transfer_id = CASE WHEN v_succeeded THEN v_stripe ELSE stripe_transfer_id END,
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSIF p_kind = 'shop_refund' THEN
    -- Only "other: ..." reaches here (above): settled by hand, never 'succeeded'.
    UPDATE public.shop_refunds SET status = 'settled_by_hand',
           settled_by_hand_ref = v_ref, settled_by_hand_cents = p_amount_cents, settled_by_hand_note = v_note, executed_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.payout_payee_waits WHERE payout_kind = p_kind AND payout_id = p_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'admin_payout_settle_by_hand', p_kind, p_id::text,
          jsonb_build_object('note', v_note, 'ref', v_ref, 'amount_cents', p_amount_cents, 'adopted_hand_refund', v_adopted));
  RETURN jsonb_build_object('result', 'settled', 'kind', p_kind, 'id', p_id, 'adopted_hand_refund', v_adopted,
    'status', CASE WHEN v_succeeded THEN 'succeeded' ELSE 'settled_by_hand' END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_payout_settle_by_hand(text, uuid, text, integer, text) TO authenticated, service_role;

-- 5. The daily held-row page and the payee's one notice cover a held manager row (restated from 20261019112103).
CREATE OR REPLACE FUNCTION public.payout_held_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT x.* FROM (
      SELECT 'declutter'::text AS kind, p.id, p.seller_id AS payee, p.amount_cents, p.review_reason, p.held_notified_at,
             COALESCE(o.is_seed, false) AS is_seed
        FROM public.declutter_payouts p LEFT JOIN public.declutter_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_manager', p.id, p.manager_id, p.amount_cents, p.review_reason, p.held_notified_at, p.is_seed
        FROM public.declutter_manager_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'helpr_task', p.id, p.helpr_id, p.amount_cents, p.review_reason, p.held_notified_at, false
        FROM public.helpr_task_payouts p WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'shop', p.id, o.seller_id, p.amount_cents, p.review_reason, p.held_notified_at, COALESCE(o.is_seed, false)
        FROM public.shop_payouts p JOIN public.shop_orders o ON o.id = p.order_id WHERE p.status = 'held_for_review'
      UNION ALL
      SELECT 'declutter_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.held_notified_at, COALESCE(d.is_seed, false)
        FROM public.declutter_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      SELECT 'delivery_refund', d.id, o.buyer_id, d.refund_cents, d.review_reason, d.held_notified_at, COALESCE(d.is_seed, false)
        FROM public.declutter_delivery_refunds d LEFT JOIN public.declutter_orders o ON o.id = d.order_id WHERE d.status = 'held_for_review'
      UNION ALL
      -- Shops: the buyer is NOT sent "needs a quick review ... before it can be sent" (payee NULL):
      -- this row is held because a refund was already made to them in Stripe. Ops still see it daily.
      SELECT 'shop_refund', sr.id, NULL::uuid, sr.refund_cents, sr.review_reason, sr.held_notified_at, sr.is_seed
        FROM public.shop_refunds sr WHERE sr.status = 'held_for_review'
    ) x LIMIT 500
  LOOP
    v_n := v_n + 1;
    -- Nested (not AND): plpgsql plans the inner statements only when the table exists.
    IF to_regclass('public.error_logs') IS NOT NULL THEN
     IF NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE jsonb_typeof(e.tags) = 'object'
         AND coalesce(e.tags ->> 'origin', '') <> 'client'
         AND e.tags ->> 'source' = 'payout-held-for-review'
         AND e.tags ->> 'row_id' = r.id::text
         AND e.created_at > date_trunc('day', now())
     ) THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Payout or refund held for review: decide it on the admin money page — %s %s ($%s). %s',
                     r.kind, r.id, to_char(r.amount_cents / 100.0, 'FM999990.00'), coalesce(left(r.review_reason, 200), '')),
              jsonb_strip_nulls(jsonb_build_object('source', 'payout-held-for-review', 'area', 'payouts',
                                                   'row_kind', r.kind, 'row_id', r.id::text,
                                                   'seed', CASE WHEN r.is_seed THEN 'true' END)),
              jsonb_build_object('row_kind', r.kind, 'row_id', r.id, 'amount_cents', r.amount_cents));
     END IF;
    END IF;
    IF r.held_notified_at IS NULL AND r.payee IS NOT NULL THEN
      PERFORM public.declutter_notify(r.payee, 'payment',
        CASE WHEN r.kind LIKE '%refund' THEN 'Your refund needs a quick review' ELSE 'Your payout needs a quick review' END,
        format('Your $%s %s needs a quick review by our team before it can be sent. You do not need to do anything; we will tell you when it is on its way.',
               to_char(r.amount_cents / 100.0, 'FM999990.00'), CASE WHEN r.kind LIKE '%refund' THEN 'refund' ELSE 'payout' END),
        '/profile?tab=earnings');
    END IF;
    IF r.held_notified_at IS NULL THEN
      IF r.kind = 'declutter' THEN UPDATE public.declutter_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'helpr_task' THEN UPDATE public.helpr_task_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'shop' THEN UPDATE public.shop_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'declutter_refund' THEN UPDATE public.declutter_refunds SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'delivery_refund' THEN UPDATE public.declutter_delivery_refunds SET held_notified_at = now() WHERE id = r.id;
      ELSIF r.kind = 'declutter_manager' THEN UPDATE public.declutter_manager_payouts SET held_notified_at = now() WHERE id = r.id;
      ELSE UPDATE public.shop_refunds SET held_notified_at = now() WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_held_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_held_check() TO service_role;
