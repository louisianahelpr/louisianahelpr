-- A payout hold cannot be released while the Helpr is under an open ban
-- settlement review (Q1415 (d); lh-money-escrow + lh-authz-rls reviews of
-- fbdfa47c7, 2026-10-06).
--
-- An open review (ban_settlement_queue.review_state = 'open') is not itself a
-- payout block: only the Q1324 system hold it writes in payout_holds is.
-- instant-payout, cash-out-credits and Stripe's own automatic payouts read
-- payout_holds alone (checkPayoutHold), and so do the late-cancellation fee
-- paths of (e). So an admin who released that system hold, or released their
-- own hold that pre-empted it (the review then wrote none), let money reach an
-- account still under review. Every release goes through this one function;
-- it now refuses while a review is open ('ban_review_open'), and the review's
-- own decision (confirm or lift) is what clears the system hold.
--
-- Body = 20261004162921's (prosrc md5 d4d6707bb551a1a60d95da75ece54084, equal
-- to prod, read 2026-10-12) plus that one refusal, before anything is deleted.
-- Same signature, SECURITY DEFINER, search_path ''. Replay-safe: CREATE OR
-- REPLACE; the review table is checked with to_regclass, so a replay before it
-- exists behaves as before. Grants restated.

CREATE OR REPLACE FUNCTION public.admin_release_payout_hold(p_helper_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text;
  v_found boolean;
  v_open boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  -- Q1415 (d): the review decides the money, not a hold release.
  IF to_regclass('public.ban_settlement_queue') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = $1 AND q.review_state = ''open'')'
      INTO v_open USING p_helper_id;
  END IF;
  IF v_open THEN
    RAISE EXCEPTION 'ban_review_open'
      USING ERRCODE = 'P0001',
            DETAIL = 'This account is under an open ban settlement review. Its payouts stay held until the review is confirmed or lifted.';
  END IF;
  DELETE FROM public.payout_holds h WHERE h.helper_id = p_helper_id
  RETURNING h.reason INTO v_reason;
  v_found := FOUND;
  -- Audited only when a hold was actually cleared.
  IF v_found THEN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (v_uid, 'payout_hold_released', p_helper_id::text, 'user', jsonb_build_object('reason', v_reason));
  END IF;
  RETURN v_found;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_release_payout_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_payout_hold(uuid) TO authenticated, service_role;
