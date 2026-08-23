-- The previous migration's REVOKE did nothing. This is the actual fix.
--
-- 20260823210000 ran `REVOKE EXECUTE ... FROM anon` on five unused definers and
-- reported success, but `anon` could still call all five afterwards. The reason
-- is the Postgres default nobody remembers: CREATE FUNCTION grants EXECUTE to
-- **PUBLIC**, and PUBLIC includes anon. Verified on prod immediately after that
-- migration deployed:
--
--   SELECT proacl FROM pg_proc WHERE proname='get_time_credit_balance';
--   {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--    ^^^^^^^^^^^ empty grantee == PUBLIC
--
-- The `anon=X` entry really was removed — there just never was one doing the
-- work. Revoking a role's direct grant while PUBLIC still holds the privilege
-- is the security equivalent of locking one of two unlocked doors, and it looks
-- identical to a successful fix in both the migration log and the deploy.
--
-- Revoking from PUBLIC is safe here precisely BECAUSE the explicit grants
-- exist: `authenticated` and `service_role` appear in the ACL in their own
-- right and keep working. `anon` holds no explicit grant, so it loses access —
-- which is the whole intent.
--
-- Replay-safe: guarded on existence; REVOKE is idempotent.

DO $$
DECLARE
  fn text;
  sigs text[] := ARRAY[
    'public.get_time_credit_balance(uuid)',
    'public.business_budget_alert_check(uuid)',
    'public.can_message_in_job(uuid, uuid)',
    'public.is_thread_muted(uuid, uuid, uuid)',
    'public.user_has_pending_application(uuid, uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY sigs LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
    END IF;
  END LOOP;
END $$;

-- Same blind spot, same fix, for the two mutating claim paths: 20260823200000
-- revoked those from `anon` only, so instant_book_claim and
-- accept_group_application were still reachable through PUBLIC. The explicit
-- NULL-auth guard added to instant_book_claim in that migration is what has
-- actually been holding the door; this closes it properly as well.
DO $$
DECLARE
  fn text;
  sigs text[] := ARRAY[
    'public.instant_book_claim(uuid)',
    'public.accept_group_application(uuid, timestamptz, text)'
  ];
BEGIN
  FOREACH fn IN ARRAY sigs LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
      -- authenticated must keep these — they are the real claim paths.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
  END LOOP;
END $$;
