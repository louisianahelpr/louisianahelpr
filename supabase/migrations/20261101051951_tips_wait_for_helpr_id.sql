-- BUY-43 (Declutter buying; owner 2026-10-30, "tips: blocked until the Helpr is verified, no money taken").
--
-- BROKEN: helpr_task_tip_start (20261028014848, the newest CREATE on main) never asks about the delivery Helpr's ID
-- check, so a buyer could pay a tip to a Helpr whose payout is still waiting on it.
--
-- FIX: both functions restated VERBATIM from their newest CREATE on main plus one marked "BUY-43" block each:
--   * helpr_task_tip_start (from 20261028014848_helpr_task_tips.sql): refuses 'tip_waits_on_identity' (55000)
--     while public.payout_waits_on_identity(helpr) is true, BEFORE the tip row is written or any Stripe page
--     is opened (declutter-checkout calls this first), so no money is taken;
--   * declutter_delivery_tip_open (from 20261028210552_declutter_sale_notices_name_inline.sql): the notices'
--     "You can add a tip" line is not offered while the check is owed.
-- payout_waits_on_identity (newest 20261031220849) is FALSE while the identity_check switch is off for the
-- Helpr (identity_check_exempt), so nothing changes for anyone until that switch goes on.
-- Grants restated as they were. MONEY: none moves; a tip is refused earlier. REPLAY-SAFE: CREATE OR REPLACE only.
-- Proof: src/test/pglite/tipsWaitForHelprId.pglite.mjs (applied 3x).

CREATE OR REPLACE FUNCTION public.helpr_task_tip_start(p_task_id uuid, p_tip_cents integer, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  r public.helpr_task_tips;
  v_held boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_tip_cents IS NULL OR p_tip_cents < 300 OR p_tip_cents > 100000 OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'invalid_tip' USING ERRCODE = '22023', HINT = 'Tips are $3 to $1,000.';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  -- Only the delivery's own buyer: anyone else is told it does not exist.
  IF NOT FOUND OR t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  IF t.status <> 'confirmed' THEN
    RAISE EXCEPTION 'tip_not_yet' USING ERRCODE = '55000', HINT = 'You can add a tip once the delivery is done.';
  END IF;
  IF t.helpr_id IS NULL OR t.helpr_id = v_uid OR public.are_users_blocked(v_uid, t.helpr_id) THEN
    RAISE EXCEPTION 'tip_unavailable' USING ERRCODE = '55000', HINT = 'This delivery can''t take a tip.';
  END IF;
  -- Owner #3706: no payout account yet -> the tip is held with the delivery pay, which must still be waiting.
  v_held := NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL);
  IF v_held AND NOT EXISTS (SELECT 1 FROM public.helpr_task_payouts p
                             WHERE p.task_id = t.id AND p.status IN ('pending', 'failed', 'held_for_review')) THEN
    RAISE EXCEPTION 'tip_unavailable' USING ERRCODE = '55000', HINT = 'This delivery can''t take a tip.';
  END IF;
  -- BUY-43 (owner 2026-10-30): a tip waits until the Helpr has passed their one-time ID check, and no money is
  -- taken until then: refused here, before any tip row or Stripe page. payout_waits_on_identity is FALSE while
  -- the identity_check switch is off for the Helpr, or for an enrolled test account.
  IF public.payout_waits_on_identity(t.helpr_id) THEN
    RAISE EXCEPTION 'tip_waits_on_identity' USING ERRCODE = '55000',
      HINT = 'This Helpr can receive tips once verified. Nothing was charged.';
  END IF;
  INSERT INTO public.helpr_task_tips (task_id, tipper_id, helpr_id, tip_cents, attempt_id, held)
  VALUES (t.id, v_uid, t.helpr_id, p_tip_cents, p_attempt_id, v_held)
  ON CONFLICT (task_id, tipper_id, attempt_id, tip_cents) DO NOTHING;
  SELECT * INTO r FROM public.helpr_task_tips
   WHERE task_id = t.id AND tipper_id = v_uid AND attempt_id = p_attempt_id AND tip_cents = p_tip_cents;
  RETURN jsonb_build_object('tip_id', r.id, 'helpr_id', r.helpr_id, 'tip_cents', r.tip_cents, 'title', t.title,
    'payment_status', r.payment_status, 'stripe_session_id', r.stripe_session_id, 'held', r.held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_tip_start(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_tip_start(uuid, integer, uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.declutter_delivery_tip_open(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.declutter_orders o
      JOIN public.declutter_order_deliveries od ON od.order_id = o.id
      JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE o.id = p_order_id
       AND o.handover = 'delivery'
       AND t.status = 'confirmed'
       AND t.customer_id = o.buyer_id
       AND t.helpr_id IS NOT NULL AND t.helpr_id <> o.buyer_id
       AND NOT public.are_users_blocked(o.buyer_id, t.helpr_id)
       -- BUY-43: no tip prompt while the Helpr's ID check is still owed (helpr_task_tip_start refuses it).
       AND NOT public.payout_waits_on_identity(t.helpr_id)
       AND (EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL)
            OR EXISTS (SELECT 1 FROM public.helpr_task_payouts p
                        WHERE p.task_id = t.id AND p.status IN ('pending', 'failed', 'held_for_review'))));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_tip_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_tip_open(uuid) TO service_role;
