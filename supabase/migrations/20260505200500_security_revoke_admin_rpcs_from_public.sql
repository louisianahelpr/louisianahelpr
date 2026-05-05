-- Follow-up to 20260505200000_security_revoke_admin_and_server_rpcs.sql:
-- anon's EXECUTE on these admin-only RPCs came from PUBLIC inheritance
-- (no explicit anon grant in pg_proc.proacl), so REVOKE FROM anon was a
-- no-op. REVOKE FROM PUBLIC strips anon's access while leaving the
-- explicit authenticated grant intact.
--
-- Verified post-apply: all 6 functions now show anon=false, authed=true,
-- svc=true. count_profiles is intentionally still anon=true for the
-- public landing-page social-proof section.

DO $$
DECLARE
  fn_name TEXT;
  fn_sig TEXT;
  admin_only_fns TEXT[][] := ARRAY[
    ARRAY['get_helper_earnings_export', '(_helper_id uuid, _start_date date, _end_date date)'],
    ARRAY['get_payout_batches', '()'],
    ARRAY['get_pending_business_verifications', '()'],
    ARRAY['get_pending_credentials', '()'],
    ARRAY['review_business_verification', '(_business_id uuid, _decision text, _reason text)'],
    ARRAY['review_credential', '(_user_id uuid, _credential text, _decision text, _reason text)']
  ];
BEGIN
  FOR i IN 1..array_length(admin_only_fns, 1) LOOP
    fn_name := admin_only_fns[i][1];
    fn_sig := admin_only_fns[i][2];
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I%s FROM PUBLIC', fn_name, fn_sig);
  END LOOP;
END $$;
