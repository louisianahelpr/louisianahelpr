-- The admin "Pay out" button moved no money, and wrote an audit row saying it did.
--
-- AdminPayoutBatches invoked `stripe-payouts` with {helper_id}. That function
-- never reads helper_id and never calls stripe.transfers.create — it returns
-- THE CALLER'S OWN Connect balance. An admin has no stripe_account_id, so it
-- answered {connected:false} with HTTP 200 and no `error`, the client's
-- `if (error) throw error` never fired, and after a biometric prompt and
-- "This moves real money and can't be undone" the UI wrote an
-- admin_audit_log `trigger_payout` row. Zero cents moved.
--
-- The transfer already exists — `release-payout` does it, with the claim
-- protocol from 20260831190418 in front of Stripe. It just takes a job_id, and
-- get_payout_batches() aggregates by helper and returns no job ids, so nothing
-- could name what to pay. This RPC closes that gap and nothing else.
--
-- The predicate is COPIED VERBATIM from get_payout_batches
-- (20260725113904): status='completed', payment_status IN
-- ('escrow','payout_pending'), helper_id NOT NULL, and the same
-- has_role(auth.uid(),'admin') gate — a non-admin gets zero rows rather than a
-- permission error, which is how the sibling behaves. If the two ever
-- disagree, an admin would see a batch total they cannot pay, or pay jobs the
-- batch never counted. They must be changed together.
CREATE OR REPLACE FUNCTION public.get_payout_batch_job_ids(p_helper_id uuid)
RETURNS TABLE(job_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT j.id
  FROM public.jobs j
  WHERE j.helper_id = p_helper_id
    AND j.status = 'completed'
    AND j.payment_status IN ('escrow', 'payout_pending')
    AND j.helper_id IS NOT NULL
    -- Same server-side authorization as get_payout_batches: non-admins get
    -- zero rows, not the data and not an error.
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_payout_batch_job_ids(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_payout_batch_job_ids(uuid) IS
  'Job ids behind one helper''s payout batch, for the admin batch-payout path. '
  'Predicate is kept identical to get_payout_batches(); change both together.';
