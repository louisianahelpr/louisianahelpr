-- DIRECT-OFFER POLICIES MUST ONLY REACH AN OPEN, UNASSIGNED JOB.
--
-- Two RLS policies on public.jobs let the *targeted* helper of a direct offer
-- act on "their" offer:
--   "Targeted helper can respond to direct offer" (UPDATE)
--   "Targeted helper can view direct offer"       (SELECT)
-- Both gated only on (offered_to_helper_id = auth.uid() AND direct_offer_status
-- = 'pending'). Neither checked that the job is still OPEN and UNASSIGNED.
--
-- The hole (found by the launch authz audit, proven live on a rolled-back
-- probe): a poster can RE-ARM a direct offer on a job that is already assigned
-- and funded — set offered_to_helper_id + direct_offer_status='pending' on an
-- in_progress/accepted job — which re-opens the UPDATE seat for that second
-- account. The helper_id TAKEOVER itself is already blocked
-- (prevent_job_field_escalation locks helper_id once funded), but `status` is
-- NOT on that seat's deny-list, so the re-armed target — a non-party to the
-- assigned job — could UPDATE jobs.status: '→open' relists a live funded job
-- (firing notify_helpers_on_job_post and enabling a second accept) and
-- '→in_progress' advances another helper's job. The twin SELECT policy leaked
-- the assigned job's address to the same non-party.
--
-- FIX: add `status = 'open' AND helper_id IS NULL` to both USING clauses. This
-- preserves the only legitimate client use — the direct-PATCH accept, which
-- prevent_job_field_escalation's carve-out already requires to be exactly
-- status='open' AND helper_id IS NULL — and matches respond_to_direct_offer's
-- own `job_not_open` guard. A re-armed offer on an assigned job now matches
-- neither policy, so the non-party can no longer read or write that job.
--
-- REPLAY-SAFE: guarded on the table existing; DROP POLICY IF EXISTS before
-- CREATE so a re-run (or a from-scratch rebuild that created the older form in
-- an earlier migration) lands the tightened form. Proof:
-- scripts/probes/direct-offer-policy-scope.pglite.mjs.

DO $direct_offer_scope$
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Targeted helper can respond to direct offer" ON public.jobs;
  CREATE POLICY "Targeted helper can respond to direct offer"
    ON public.jobs
    FOR UPDATE
    TO authenticated
    USING (
      offered_to_helper_id = (SELECT auth.uid())
      AND direct_offer_status = 'pending'
      AND status = 'open'::job_status
      AND helper_id IS NULL
    );

  DROP POLICY IF EXISTS "Targeted helper can view direct offer" ON public.jobs;
  CREATE POLICY "Targeted helper can view direct offer"
    ON public.jobs
    FOR SELECT
    TO authenticated
    USING (
      offered_to_helper_id IS NOT NULL
      AND offered_to_helper_id = (SELECT auth.uid())
      AND direct_offer_status = 'pending'
      AND status = 'open'::job_status
      AND helper_id IS NULL
    );
END
$direct_offer_scope$;
