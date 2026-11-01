-- Manager mode phase 2b, the SQL half: the payout kind 'declutter_manager', so declutter-money can send the
-- manager's share (declutter_manager_payouts, 20261101230509) through the same wait / defer / send-mark / review
-- steps as every other payout, plus the lead's two conditions on 87b3df401b.
--
-- What was missing: the manager's rows had a queue (declutter_manager_payouts_due) but no payout kind. payout_defer
-- and payout_hold_for_review raised invalid_kind for them, payout_payee_wait_seen refused them, and the CHECKs on
-- payout_payee_waits and payout_send_marks refused the rows, so a manager payout could neither wait for the
-- manager's Stripe setup nor be marked before its transfer (the mark is what stops a re-send after a lost record).
-- declutter_payout_unsent (20261101230509) already reads a 'declutter_manager' send mark; until now none could exist.
--
-- Lead conditions (verdict on 87b3df401b, 11-01 5:30 PM):
--   a. declutter_manager_payouts_due never offers a row whose MANAGER is banned or suspended, or has a payout_holds
--      row (the seller's own row is gated in declutter-money; the manager is a second payee).
--   b. declutter_rebook_payout cuts the share by the ITEMS refund only. Before, a full refund that also returned a
--      seller delivery rate, or any refund counted against items + delivery, used the wrong denominator.
-- The manager rows can now also be held for review (status 'held_for_review', like declutter_payouts).
-- Not here: the admin money page (admin_payouts_held_for_review, admin_payout_release, admin_payout_settle_by_hand,
-- payout_held_check) does not list a held manager row yet. The declutter_manager switch stays OFF until it does.
-- The edge (declutter-money's manager loop) is a separate commit.
--
-- Replay-safe: CREATE OR REPLACE, DROP CONSTRAINT IF EXISTS + ADD, ADD COLUMN IF NOT EXISTS. Every function stays
-- service_role only (REVOKE ... FROM PUBLIC, anon, authenticated). Proof: src/test/pglite/declutterManagerPayoutKind.pglite.mjs
-- (applied 3x). Guard: src/test/declutterManagerPayoutKind.test.ts.

-- 1. The tables take the manager kind; the manager rows can be held for review.
DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.payout_payee_waits.payout_payee_waits_payout_kind_check
  ALTER TABLE public.payout_payee_waits DROP CONSTRAINT IF EXISTS payout_payee_waits_payout_kind_check;
  ALTER TABLE public.payout_payee_waits ADD CONSTRAINT payout_payee_waits_payout_kind_check
    CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund', 'declutter_manager'));
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.payout_send_marks.payout_send_marks_payout_kind_check
  ALTER TABLE public.payout_send_marks DROP CONSTRAINT IF EXISTS payout_send_marks_payout_kind_check;
  ALTER TABLE public.payout_send_marks ADD CONSTRAINT payout_send_marks_payout_kind_check
    CHECK (payout_kind IN ('declutter', 'helpr_task', 'shop', 'declutter_manager'));
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_manager_payouts.declutter_manager_payouts_status_check
  ALTER TABLE public.declutter_manager_payouts DROP CONSTRAINT IF EXISTS declutter_manager_payouts_status_check;
  ALTER TABLE public.declutter_manager_payouts ADD CONSTRAINT declutter_manager_payouts_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due', 'held_for_review'));
END
$do$;
ALTER TABLE public.declutter_manager_payouts ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS review_held_at timestamptz;

-- 2. payout_defer, restated from 20261019070737 with the manager kind.
CREATE OR REPLACE FUNCTION public.payout_defer(p_kind text, p_payout_id uuid, p_minutes integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_until timestamptz := now() + make_interval(mins => least(greatest(COALESCE(p_minutes, 60), 5), 1440));
BEGIN
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'declutter_manager' THEN
    UPDATE public.declutter_manager_payouts SET next_attempt_at = v_until WHERE id = p_payout_id AND status IN ('pending', 'failed');
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_defer(text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_defer(text, uuid, integer) TO service_role;

-- 3. payout_hold_for_review, restated from 20261019070737 with the manager kind.
CREATE OR REPLACE FUNCTION public.payout_hold_for_review(p_kind text, p_id uuid, p_category text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text := left(p_category || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''), 300);
  v_n integer;
BEGIN
  IF p_kind = 'declutter' THEN
    UPDATE public.declutter_payouts SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'helpr_task' THEN
    UPDATE public.helpr_task_payouts SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'shop' THEN
    UPDATE public.shop_payouts SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'declutter_refund' THEN
    UPDATE public.declutter_refunds SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'delivery_refund' THEN
    UPDATE public.declutter_delivery_refunds SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSIF p_kind = 'declutter_manager' THEN
    UPDATE public.declutter_manager_payouts SET status = 'held_for_review', review_reason = v_reason, review_held_at = now()
     WHERE id = p_id AND status IN ('pending', 'failed');
  ELSE
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.payout_payee_waits SET ops_paged_at = now(), paged_category = p_category
   WHERE payout_kind = p_kind AND payout_id = p_id;
  RETURN v_n = 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_hold_for_review(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_hold_for_review(text, uuid, text, text) TO service_role;

-- 4. payout_payee_wait_seen, restated from 20261031220849 (the newest) with the manager kind.
CREATE OR REPLACE FUNCTION public.payout_payee_wait_seen(p_kind text, p_payout_id uuid, p_payee uuid, p_amount_cents integer,
  p_category text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  w public.payout_payee_waits;
  v_page boolean := false;
  v_remind boolean := false;
  v_quiet boolean;
  v_bound interval;
  v_amount text := to_char(COALESCE(p_amount_cents, 0) / 100.0, 'FM999999990.00');
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('declutter', 'helpr_task', 'shop', 'declutter_refund', 'delivery_refund', 'declutter_manager') OR p_payout_id IS NULL
     OR p_category IS NULL OR p_category NOT IN ('no_account', 'setup_unfinished', 'under_review', 'rejected', 'unusable',
       'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'transient', 'record_failed', 'unreadable', 'held', 'ban_review',
       'suspended', 'needs_reconcile', 'identity') THEN
    RAISE EXCEPTION 'invalid_wait' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.payout_payee_waits (payout_kind, payout_id, payee_id, category, last_reason)
  VALUES (p_kind, p_payout_id, p_payee, p_category, left(p_category || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''), 200))
  ON CONFLICT (payout_kind, payout_id) DO UPDATE
    SET last_checked_at = now(), last_reason = EXCLUDED.last_reason, payee_id = EXCLUDED.payee_id, category = EXCLUDED.category
  RETURNING * INTO w;
  -- The payee is nudged only for what they can act on, never when banned or on payout hold.
  v_quiet := p_payee IS NULL
          OR p_category NOT IN ('no_account', 'setup_unfinished', 'under_review', 'rejected', 'unusable', 'identity')
          OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = p_payee
                       AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned'))
          OR EXISTS (SELECT 1 FROM public.payout_holds ph WHERE ph.helper_id = p_payee);
  IF NOT v_quiet AND NOT EXISTS (SELECT 1 FROM public.payout_payee_reminders r
                                  WHERE r.payee_id = p_payee AND r.last_reminded_at > now() - interval '3 days') THEN
    v_remind := true;
    INSERT INTO public.payout_payee_reminders (payee_id, last_reminded_at) VALUES (p_payee, now())
    ON CONFLICT (payee_id) DO UPDATE SET last_reminded_at = now();
    UPDATE public.payout_payee_waits SET last_reminded_at = now() WHERE payout_kind = p_kind AND payout_id = p_payout_id;
    PERFORM public.declutter_notify(p_payee, 'payment',
      CASE p_category
        WHEN 'identity' THEN 'Verify your ID to get paid'
        WHEN 'under_review' THEN 'Stripe is reviewing your payout account'
        WHEN 'rejected' THEN 'Your payout account needs help'
        WHEN 'unusable' THEN 'Set up payouts again to get paid'
        ELSE 'Finish payout setup to get paid' END,
      CASE p_category
        WHEN 'identity' THEN format('$%s is waiting for you. Verify your ID once with Stripe and we send it right away.', v_amount)
        WHEN 'under_review' THEN format('$%s is waiting for you. Stripe is reviewing your payout account; we send it as soon as they finish. Nothing to do unless Stripe asks you for something.', v_amount)
        WHEN 'rejected' THEN format('$%s is waiting for you, but Stripe would not approve your payout account. Contact Louisiana Helpr support and we will help you sort it out.', v_amount)
        WHEN 'unusable' THEN format('$%s is waiting for you, but your payout account can no longer be used. Set up payouts again in your profile''s Earnings tab.', v_amount)
        ELSE format('$%s is waiting for you. Finish payout setup in your profile''s Earnings tab and we send it right away.', v_amount) END,
      CASE p_category WHEN 'identity' THEN '/home?verify_id=1' ELSE '/profile?tab=earnings' END);
  END IF;
  -- Ops: ONCE per payout when its bound is reached; again only when the reason changed to
  -- one that will not fix itself. Only ANSWERED here: payout_payee_paged marks it after the
  -- Slack post went through.
  v_bound := CASE WHEN p_category IN ('rejected', 'unusable', 'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'needs_reconcile') THEN interval '0'
                  WHEN p_category IN ('transient', 'record_failed', 'unreadable') THEN interval '24 hours'
                  ELSE interval '7 days' END;
  IF (w.ops_paged_at IS NULL
      OR (w.paged_category IS DISTINCT FROM p_category AND p_category IN ('rejected', 'unusable', 'payee_deleted', 'mixed_parties', 'banned', 'data_defect', 'needs_reconcile')))
     AND w.first_waiting_at <= now() - v_bound THEN
    v_page := true;
  END IF;
  RETURN jsonb_build_object('page_due', v_page, 'reminded', v_remind, 'waiting_since', w.first_waiting_at,
    'payee_seed', COALESCE((SELECT pr.is_seed FROM public.profiles pr WHERE pr.user_id = p_payee), false));
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_payee_wait_seen(text, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_payee_wait_seen(text, uuid, uuid, integer, text, text) TO service_role;

-- 5. payout_payee_waits_prune, restated from 20261019070737 with the manager kind.
CREATE OR REPLACE FUNCTION public.payout_payee_waits_prune()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.payout_payee_waits w
   WHERE NOT EXISTS (
     SELECT 1 FROM public.declutter_payouts p WHERE w.payout_kind = 'declutter' AND p.id = w.payout_id
        AND p.status IN ('pending', 'failed') AND p.attempts < 12
     UNION ALL
     SELECT 1 FROM public.helpr_task_payouts p WHERE w.payout_kind = 'helpr_task' AND p.id = w.payout_id
        AND p.status IN ('pending', 'failed') AND p.attempts < 12
     UNION ALL
     SELECT 1 FROM public.shop_payouts p WHERE w.payout_kind = 'shop' AND p.id = w.payout_id
        AND p.status IN ('pending', 'failed') AND p.attempts < 12
     UNION ALL
     SELECT 1 FROM public.declutter_refunds r WHERE w.payout_kind = 'declutter_refund' AND r.id = w.payout_id
        AND r.status IN ('pending', 'failed') AND r.attempts < 12
     UNION ALL
     SELECT 1 FROM public.declutter_delivery_refunds r WHERE w.payout_kind = 'delivery_refund' AND r.id = w.payout_id
        AND r.status IN ('pending', 'failed') AND r.attempts < 12
     UNION ALL
     SELECT 1 FROM public.declutter_manager_payouts p WHERE w.payout_kind = 'declutter_manager' AND p.id = w.payout_id
        AND p.status IN ('pending', 'failed') AND p.attempts < 12);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- A send mark of a payout that ended is no longer needed (the ended row is never offered again);
  -- a held-for-review row keeps its mark until it is settled or released (a transfer may exist).
  DELETE FROM public.payout_send_marks m
   WHERE NOT EXISTS (
     SELECT 1 FROM public.declutter_payouts p WHERE m.payout_kind = 'declutter' AND p.id = m.payout_id AND p.status IN ('pending', 'failed', 'held_for_review')
     UNION ALL
     SELECT 1 FROM public.helpr_task_payouts p WHERE m.payout_kind = 'helpr_task' AND p.id = m.payout_id AND p.status IN ('pending', 'failed', 'held_for_review')
     UNION ALL
     SELECT 1 FROM public.shop_payouts p WHERE m.payout_kind = 'shop' AND p.id = m.payout_id AND p.status IN ('pending', 'failed', 'held_for_review')
     UNION ALL
     SELECT 1 FROM public.declutter_manager_payouts p WHERE m.payout_kind = 'declutter_manager' AND p.id = m.payout_id
        AND p.status IN ('pending', 'failed', 'held_for_review'));
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.payout_payee_waits_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_payee_waits_prune() TO service_role;

-- 6. declutter_rebook_payout, restated from 20261101230509: the share is cut by the items refund only.
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
    -- declutter_payout_unsent also answers false once the manager's transfer may have started. The share is a share of
    -- the ITEMS (lead condition b, 87b3df401b): only the items part of the refund cuts it, never a delivery rate that
    -- went back. Callers refund the items first (a part refund is below items_cents; a full one is items + any seller
    -- delivery rate), so the items part is least(refunded, items): floor(share * (items - items refunded) / items).
    v_share := CASE WHEN p.items_cents = 0 THEN 0
                    ELSE floor(v_m.share_cents::numeric * (p.items_cents - least(p_refunded_cents, p.items_cents))
                               / p.items_cents)::integer END;
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

-- 7. declutter_manager_payouts_due, restated from 20261101230509: a banned/suspended or held manager waits.
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
     -- Lead condition a (87b3df401b): never a banned or suspended manager, nor one on an admin payout hold.
     AND NOT EXISTS (SELECT 1 FROM public.profiles mp WHERE mp.user_id = m.manager_id
                      AND (mp.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                           OR mp.auto_suspended_until > now()))
     AND NOT EXISTS (SELECT 1 FROM public.payout_holds ph WHERE ph.helper_id = m.manager_id)
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
