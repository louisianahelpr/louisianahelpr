-- Security advisor follow-up (2026-05-05): tighten EXECUTE grants on
-- admin-only and server-only RPCs.
--
-- Verified each function's call-site usage in src/ and supabase/functions/
-- before grouping. service_role's grant is left untouched (cron + edge
-- functions invoking these via createClient(URL, SECRET_KEY) keep working).
--
-- count_profiles is INTENTIONALLY excluded — it's called from the public
-- landing page (SocialProofSection.tsx) and must remain anon-callable.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Admin-only RPCs — revoke from anon (keep authenticated since admin UIs use)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn_name TEXT;
  admin_only_fns TEXT[] := ARRAY[
    'get_helper_earnings_export',     -- helper viewing own earnings (auth required, not anon)
    'get_payout_batches',             -- admin: AdminPayoutBatches.tsx
    'get_pending_business_verifications', -- admin: AdminBusinessVerificationQueue.tsx
    'get_pending_credentials',        -- admin: AdminCredentialQueue.tsx
    'review_business_verification',   -- admin: AdminBusinessVerificationQueue.tsx
    'review_credential'               -- admin: AdminCredentialQueue.tsx
  ];
BEGIN
  FOREACH fn_name IN ARRAY admin_only_fns LOOP
    -- Only revoke from anon — authenticated stays so admins can call.
    -- The functions themselves still enforce has_role() checks internally,
    -- so revoking from anon is purely defense-in-depth at the gateway.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM anon', fn_name);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Server-only RPCs — revoke from anon AND authenticated
-- ──────────────────────────────────────────────────────────────────────────────
-- These are only invoked from edge functions and cron via service_role.
-- No client (anon or authenticated) should ever hit /rest/v1/rpc/<name>.
DO $$
DECLARE
  fn_name TEXT;
  server_only_fns TEXT[] := ARRAY[
    'cleanup_observability_tables',   -- 0 client callsites
    'cleanup_stripe_webhook_events',  -- 0 client callsites
    'extend_boosts_with_no_applications', -- cron only
    'expire_pending_direct_offers',   -- auto-expire-jobs edge function (service_role)
    'move_to_dlq',                    -- process-email-queue (service_role)
    'read_email_batch',               -- process-email-queue (service_role)
    'enqueue_email',                  -- engagement-automations (service_role)
    'delete_email'                    -- process-email-queue (service_role)
  ];
BEGIN
  FOREACH fn_name IN ARRAY server_only_fns LOOP
    -- Some entries (e.g. extend_boosts_with_no_applications) are
    -- Supabase-managed, not in any repo migration, so they're absent
    -- in fresh CI/dev DBs. Skip silently when missing rather than
    -- aborting the whole migration.
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM PUBLIC', fn_name);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM anon', fn_name);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I FROM authenticated', fn_name);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skipping REVOKE on missing function public.%: not present in this DB', fn_name;
    END;
  END LOOP;
END $$;
