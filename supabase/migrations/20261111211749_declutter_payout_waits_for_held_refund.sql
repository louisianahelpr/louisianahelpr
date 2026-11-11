-- Declutter payout waits while a refund on the order is held for review (money reviewer, 11-11, Builder 1).
--
-- WHAT WAS BROKEN: declutter_payouts_due held the seller's payout while the buyer's agreed PART refund was pending or
-- failed, but not while that refund row was 'held_for_review' (the refund run parks a row there for an admin when it
-- cannot send it safely). The payout run then sent the seller the full payout while the buyer's refund still stood
-- undecided: if the admin later released the refund, the platform had already paid that money to the seller.
-- declutter_manager_payouts_due had the same gap for the manager's share.
--
-- THE FIX: both queues skip an order while a declutter_refunds row on the order's OWN payment is 'held_for_review'
-- (a held refund is money the buyer may still get back out of the charge the seller is paid from), except a
-- delivery_damage refund: Q1934 deliberately never holds the seller's payout for it (the seller is paid whatever
-- happens). A refund on another payment (duplicate_payment, buyer_restarted_checkout, superseded) never touches the
-- seller's money, so it does not hold the payout either (lh-money-escrow review 11-11, should-fix 3).
-- When the admin settles the refund by hand ('succeeded' with a Stripe id, counted in
-- declutter_order_refunds_recorded_cents, or 'settled_by_hand'), the payout is offered again on the next run. When the
-- admin RELEASES it (admin_payout_release: back to 'pending'), this new clause no longer matches; only a
-- refund_request_part refund is still held, by the OLDER rf clause (refund_request_part pending/failed), until it goes
-- through. A released refund of another reason no longer holds the payout: the payout run's wholeCharge check
-- (declutter-money: refunds the app recorded vs the charge's own refunded amount) refuses a payout whose charge was
-- refunded after the run's read, but if that released refund FAILS at Stripe ('failed' holds only refund_request_part),
-- the payout can go out against the untouched charge and a later retry of the refund comes out of the platform balance.
-- That gap predates this file (not a regression) and is not closed here (re-review should-fix 2, 11-11): said, so no
-- reader takes the release path as fully guarded. A refund the refund step holds for review DURING a run does
-- not stop that run's payout (the queue was read before); it holds from the next run. (Review should-fix 2: said, not
-- widened.) Nothing else
-- changes: each body is restated VERBATIM from its newest definition (20261105032500_declutter_gift_payouts) plus the
-- one clause marked CHANGED. Same return type, so CREATE OR REPLACE; same grants. Replay-safe: every object read
-- already exists at this point in the timeline.

CREATE OR REPLACE FUNCTION public.declutter_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, attempts integer, refunds_recorded_cents integer,
               gift_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, p.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id, p.attempts,
         public.declutter_order_refunds_recorded_cents(o.id), public.declutter_order_gift_net_cents(o.id)
    FROM public.declutter_payouts p
    JOIN public.declutter_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')
     -- 141d: the buyer's 24 hours, a refund request or a seller's "no" still running holds the payout.
     AND public.declutter_sale_final(p.order_id)
     -- 141d (lh-money-escrow review, should-fix 1): after an agreed PART refund the seller is paid once the buyer's
     -- refund went through, so the payout run never reads the charge with a refund it has not recorded yet.
     AND NOT EXISTS (SELECT 1 FROM public.declutter_refunds rf
                      WHERE rf.order_id = p.order_id AND rf.stripe_payment_intent_id = o.stripe_payment_intent_id
                        AND rf.reason = 'refund_request_part' AND rf.status IN ('pending', 'failed'))
     -- CHANGED (11-11, money review): a refund on this order's own payment held for an admin's review holds the payout
     -- too (not delivery_damage: Q1934 never holds the seller for it), so the seller is not paid out of money the buyer
     -- may still get back. Once the admin settles it, the payout is offered again (see the header for a release).
     AND NOT EXISTS (SELECT 1 FROM public.declutter_refunds rh WHERE rh.order_id = p.order_id AND rh.status = 'held_for_review'
                      AND rh.stripe_payment_intent_id IS NOT DISTINCT FROM o.stripe_payment_intent_id AND rh.reason <> 'delivery_damage')
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payouts_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_manager_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, manager_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, attempts integer, refunds_recorded_cents integer,
               gift_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT m.id, m.order_id, o.buyer_id, m.seller_id, m.manager_id, m.amount_cents, pr.stripe_account_id,
         o.stripe_payment_intent_id, m.attempts, public.declutter_order_refunds_recorded_cents(o.id), public.declutter_order_gift_net_cents(o.id)
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
     -- CHANGED (11-11): the manager's share waits for a held refund exactly as the seller's payout does.
     AND NOT EXISTS (SELECT 1 FROM public.declutter_refunds rh WHERE rh.order_id = m.order_id AND rh.status = 'held_for_review'
                      AND rh.stripe_payment_intent_id IS NOT DISTINCT FROM o.stripe_payment_intent_id AND rh.reason <> 'delivery_damage')
     AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = m.seller_id AND b.blocked_id = m.manager_id)
                         OR (b.blocker_id = m.manager_id AND b.blocked_id = m.seller_id))
   ORDER BY m.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_manager_payouts_due(integer) TO service_role;
