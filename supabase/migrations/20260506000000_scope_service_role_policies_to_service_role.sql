-- Restrict every "Service role can ..." policy from roles={public}
-- down to roles={service_role}.
--
-- Why: each service-role policy gates with `auth.role() = 'service_role'`
-- in its body, so it can only ever match on a service_role connection.
-- But because the policy is registered on `public`, it shows up in the
-- policy set for every other role — and Supabase perf advisor counts
-- it as a `multiple_permissive_policies` overlap with the matching
-- admin/user policy on the same (table, role, action). Scoping to
-- {service_role} removes it from the authenticated/anon evaluation
-- entirely while preserving the original semantics (the body-check is
-- redundant once the policy is role-scoped, but harmless).
--
-- Closes 7 multiple_permissive_policies advisor entries:
--   - email_send_log SELECT (Admins + Service role)
--   - email_unsubscribe_tokens SELECT (no admin counterpart, but
--     paired with future ones; reduces evaluation cost)
--   - fraud_flags INSERT (Admins + Service role)
--   - notifications DELETE (Users + Service role)
--   - notifications INSERT (Admins + Service role)
--   - suppressed_emails SELECT (Admins + Service role)
--   - referral_credits UPDATE: only service-role policy on this action;
--     scoping just makes evaluation cheaper for non-service callers.

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND 'public' = ANY(roles)
      AND (
        qual LIKE '%service_role%' OR with_check LIKE '%service_role%'
      )
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO service_role',
                   p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
