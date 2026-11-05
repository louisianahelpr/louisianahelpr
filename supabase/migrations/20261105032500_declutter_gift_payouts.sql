-- Q2106 S2 (Builder 3, 11-04): declutter_payouts_due also returns the order's gift_cents, so declutter-money sends a
-- gift-paid order's seller payout from the platform balance (the card charge is smaller than the seller's share, and
-- Stripe refuses a source_transaction transfer above its charge). Restated VERBATIM from the newest definition
-- (20261026155251) plus that one column. The return type changes, so the function is dropped and made again, with the
-- same grants.
DROP FUNCTION IF EXISTS public.declutter_payouts_due(integer);
CREATE FUNCTION public.declutter_payouts_due(p_limit integer)
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
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payouts_due(integer) TO service_role;

-- Q2106 S2(d) (Builder 3, 11-04 night): the MANAGER's share and the Helpr's delivery pay on a gift-paid order are sent
-- from the platform balance too (the card paid less than the order; a gift-only order has no PaymentIntent), each only
-- under declutter-money's giftCovers guard. Both queues return the order's gift_cents. Restated VERBATIM from the newest
-- definitions (declutter_manager_payouts_due 20261101233256, helpr_task_payouts_due 20261028014848) plus that one
-- column; the return type changes, so each is dropped and made again, with the same grants.
-- S3: every queue's gift_cents is NET of what refunds gave back to the gift balance (declutter_order_gift_net_cents,
-- 20261105030604), so a restored gift share is never also paid out from the platform balance.
DROP FUNCTION IF EXISTS public.declutter_manager_payouts_due(integer);
CREATE FUNCTION public.declutter_manager_payouts_due(p_limit integer)
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
     AND NOT EXISTS (SELECT 1 FROM public.user_blocks b
                      WHERE (b.blocker_id = m.seller_id AND b.blocked_id = m.manager_id)
                         OR (b.blocker_id = m.manager_id AND b.blocked_id = m.seller_id))
   ORDER BY m.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_manager_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_manager_payouts_due(integer) TO service_role;

DROP FUNCTION IF EXISTS public.helpr_task_payouts_due(integer);
CREATE FUNCTION public.helpr_task_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, task_id uuid, source_kind text, source_id uuid, helpr_id uuid, customer_id uuid,
               pickup_contact_id uuid, amount_cents integer, stripe_account_id text, payment_intent_id text,
               transfer_group text, refunds_recorded_cents integer, attempts integer, raised_cents integer, raise_parts jsonb,
               tip_parts jsonb, gift_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, t.id, t.source_kind, t.source_id, p.helpr_id, t.customer_id, t.pickup_contact_id, p.amount_cents,
         pr.stripe_account_id,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN o.stripe_payment_intent_id END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || o.id::text END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN public.declutter_order_refunds_recorded_cents(o.id) END,
         p.attempts,
         t.raised_cents,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('raise_id', r.id, 'payment_intent_id', r.stripe_payment_intent_id,
                                                       'cents', r.raise_cents) ORDER BY r.applied_at, r.id)
                     FROM public.declutter_delivery_raises r
                    WHERE r.task_id = t.id AND r.status = 'applied'), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('tip_id', x.id, 'payment_intent_id', x.stripe_payment_intent_id,
                                                       'cents', x.tip_cents) ORDER BY x.paid_at, x.id)
                     FROM public.helpr_task_tips x
                    WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL), '[]'::jsonb),
         CASE WHEN t.source_kind = 'declutter_delivery' THEN public.declutter_order_gift_net_cents(o.id) ELSE 0 END
    FROM public.helpr_task_payouts p
    JOIN public.helpr_tasks t ON t.id = p.task_id
    LEFT JOIN public.declutter_orders o ON t.source_kind = 'declutter_delivery' AND o.id = t.source_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.helpr_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payouts_due(integer) TO service_role;
