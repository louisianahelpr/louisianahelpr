-- AM-002 (a): a card chargeback's evidence deadline (Stripe
-- dispute.evidence_details.due_by) was rendered into a Slack field and a
-- notification sentence and stored nowhere, so nothing could sort, query or
-- remind on it. stripe-webhook's charge.dispute.created handler now writes it
-- here; the admin job detail reads it.
--
-- jobs uses COLUMN-level SELECT grants (no table-level grant for
-- authenticated), so the new column is invisible until granted. SELECT only:
-- the webhook writes with the service role; no client may set it.
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS chargeback_evidence_due_by timestamptz;

COMMENT ON COLUMN public.jobs.chargeback_evidence_due_by IS
  'Stripe dispute evidence deadline for a card chargeback on this job (AM-002). Written by stripe-webhook charge.dispute.created; null when no chargeback.';

GRANT SELECT (chargeback_evidence_due_by) ON public.jobs TO authenticated;

-- The repo convention (offeredHelperPrivacy.test.ts): every jobs ADD COLUMN
-- ends with the grant sync. Equivalent to the GRANT above for this column.
SELECT public.sync_jobs_select_grants();
