-- A Declutter payout an admin released is never "unsent" again (LEAD-PAYOUT-RELEASE-UNSENT, from the review of
-- 20261031200034, B27 10-31).
--
-- declutter_payout_unsent says the seller's money has not been touched yet, and every refund and problem path
-- reads it before moving money: declutter_rebook_payout refuses to rebook a payout that is not unsent, and the
-- problem window, the seller's refund offer, the buyer's "never got it" and the admin decisions all close once it
-- is false. It read "untouched" as pending/nothing_due, no transfer, attempts = 0 and no send mark.
-- 20261031200034 made admin_payout_release set a released Declutter payout back to 'pending' with attempts = 0 (so
-- the payout run offers it again). That made a released payout look untouched: a buyer's later problem or a refund
-- could reopen the window and rebook the amount of a payout an admin had already decided to send.
-- Now a payout with an admin_payout_release row in admin_audit_log (target_type 'declutter', target_id the payout
-- id; admin_payout_release writes exactly that row in the same transaction) is not unsent, whatever its status.
-- Everything else is unchanged.
--
-- Restated from its NEWEST CREATE, 20261026155251_declutter_refund_requests.sql:281 (the only CREATE on
-- origin/main and on this branch). Same signature, language, security, search_path and grants.
-- The partial index keeps the added lookup an index probe (the function is read per order in the problem-window
-- lists).
-- Proof: src/test/pglite/declutterReleasedPayoutNotUnsent.pglite.mjs (NEW_MIGRATION=skip shows the [fix] checks red).

CREATE INDEX IF NOT EXISTS admin_audit_log_payout_release_idx
  ON public.admin_audit_log (target_type, target_id)
  WHERE action = 'admin_payout_release';

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
      FROM public.declutter_payouts p WHERE p.order_id = p_order_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payout_unsent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_unsent(uuid) TO service_role;
