-- Q1939: a setup job the seller-fault trigger could not cancel is re-applied automatically.
--
-- What was broken: A10 (20261017073146). When a Declutter refund is the seller's fault (fee_policy
-- 'full_seller_pays_fee'), the AFTER INSERT trigger trg_declutter_refund_cancels_setup_jobs runs
-- declutter_apply_seller_fault, which cancels the buyer's linked Helpr setup jobs with no fee and marks them
-- (declutter_order_jobs.seller_fault_refund_id). A job it could not cancel (lock_timeout 1s, a refused write) was only
-- logged; nothing re-applied it, so the job later settled by the normal rules (a cancellation fee to the Helpr, the
-- card fee kept from the buyer) unless a person ran declutter_admin_apply_seller_fault by hand.
--
-- The fix: declutter_seller_fault_sweep(), service role only, called by void-cancelled-payments at the start of every
-- run (before it prices any cancelled job). It finds seller-fault refunds that still have an UNMARKED setup link which
-- the apply would cancel (job live, not marked done, money at rest, not a crew job, not a committed Helpr on a
-- buyer-reported no-show: those are left for an admin exactly as the apply leaves them), linked BEFORE the refund was
-- made (a link added later was never the trigger's to cancel), and runs declutter_apply_seller_fault on each. That
-- function is unchanged and idempotent (a marked job is skipped). A failure is one cron defect per refund, and the next
-- run tries again. Returns how many jobs it cancelled.
--
-- Replay-safe: CREATE OR REPLACE (plpgsql resolves declutter_apply_seller_fault at run time). Service role only.
-- Proof: src/test/pglite/declutterSellerFaultSweep.pglite.mjs. Guard: src/test/declutterSellerFaultSweep.test.ts.

CREATE OR REPLACE FUNCTION public.declutter_seller_fault_sweep()
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
    SELECT DISTINCT rf.id, rf.is_seed, rf.created_at
      FROM public.declutter_refunds rf
      JOIN public.declutter_order_jobs l ON l.order_id = rf.order_id AND l.purpose = 'setup'
                                        AND l.seller_fault_refund_id IS NULL AND l.created_at <= rf.created_at
      JOIN public.jobs jb ON jb.id = l.job_id
     WHERE rf.fee_policy = 'full_seller_pays_fee' AND rf.order_id IS NOT NULL
       AND jb.status::text IN ('open', 'accepted', 'in_progress', 'revision_requested')
       AND jb.helper_completed_at IS NULL
       AND COALESCE(jb.payment_status::text, 'unpaid') IN ('unpaid', 'abandoned', 'failed', 'escrow')
       AND NOT COALESCE(jb.is_group_job, false)
       AND NOT (rf.reason = 'seller_no_show' AND jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL)
     ORDER BY rf.created_at
     LIMIT 50
  LOOP
    BEGIN
      v_n := v_n + public.declutter_apply_seller_fault(r.id, false);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_seller_fault_sweep' || CASE WHEN r.is_seed THEN '-seed' ELSE '' END, r.id::text,
        format('could not re-apply seller-fault Declutter refund %s to its setup jobs: %s (%s); the next run retries, or run declutter_admin_apply_seller_fault(%s)',
               r.id, SQLERRM, SQLSTATE, r.id));
    END;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_fault_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_fault_sweep() TO service_role;
