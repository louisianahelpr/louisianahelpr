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

-- 1. The manager rows can be settled by hand (the ledger's kind: 20261102150413).
DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_manager_payouts.declutter_manager_payouts_status_check
  ALTER TABLE public.declutter_manager_payouts DROP CONSTRAINT IF EXISTS declutter_manager_payouts_status_check;
  ALTER TABLE public.declutter_manager_payouts ADD CONSTRAINT declutter_manager_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review', 'settled_by_hand'));
  -- The settlements ledger's kind list (with 'declutter_manager') is set in 20261102150413, after 20261102054153
  -- adds 'raise_refund', so neither list drops the other's kind.
END
$do$;
ALTER TABLE public.declutter_manager_payouts ADD COLUMN IF NOT EXISTS held_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by_hand_ref text, ADD COLUMN IF NOT EXISTS settled_by_hand_cents integer,
  ADD COLUMN IF NOT EXISTS settled_by_hand_note text;

-- 2. admin_payouts_held_for_review: moved to 20261102150413 (restated there from the newest train body,
--    20261102054153, plus the manager's row), so an out-of-order deploy cannot drop the gave-up hunks.

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

-- 4. admin_payout_settle_by_hand: moved to 20261102150413 for the same reason.

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
