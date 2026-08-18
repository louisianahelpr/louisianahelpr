-- SEC-001, take two. 20260818070000 did not work, and I verified that rather
-- than assuming it had.
--
--   select has_column_privilege('authenticated','public.businesses','seat_tier','UPDATE');
--   -- still true, AFTER that migration deployed successfully
--
-- Why: `REVOKE UPDATE (col) ... FROM role` removes a COLUMN-level grant. There
-- were none. The privilege comes from a TABLE-level grant --
--
--   pg_class.relacl = {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--                      authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--                                        ^ w = UPDATE on every column
--
-- and a column REVOKE cannot subtract from a table grant. Postgres accepted the
-- statement and changed nothing, which is the worst shape a security fix can
-- take: green deploy, hole still open.
--
-- The correct construct is revoke the table grant, then re-grant the columns
-- that should stay writable.
--
-- anon loses UPDATE outright: RLS already requires owner_id = auth.uid() and
-- anon has no auth.uid(), so it could never have updated a row anyway. The
-- grant was reachable-but-useless; removing it costs nothing.
--
-- authenticated keeps every column EXCEPT the four Stripe-owned ones. Deliberately
-- minimal: the seat/subscription columns are the entire attack surface for
-- SEC-001, and re-granting the rest verbatim means no existing client write can
-- start failing on a missing column privilege. Narrowing further (verification_*,
-- owner_id) is worth doing but is a separate change with its own blast radius --
-- verification_status is already pinned to OLD for non-admins by
-- enforce_business_verification_safety, so it is defended, just not by grants.
--
-- service_role is untouched, so check-business-seat-subscription keeps
-- reconciling seat_tier from Stripe.
REVOKE UPDATE ON public.businesses FROM authenticated, anon;

GRANT UPDATE (
  id,
  owner_id,
  name,
  created_at,
  updated_at,
  verification_status,
  verification_document_url,
  verification_document_type,
  verification_reviewed_at,
  verification_reviewed_by,
  verification_rejection_reason,
  require_approval_above,
  require_2fa,
  default_payment_method_id,
  monthly_budget,
  monthly_budget_alert_at,
  billing_mode,
  report_recipients,
  report_cadence
) ON public.businesses TO authenticated;
