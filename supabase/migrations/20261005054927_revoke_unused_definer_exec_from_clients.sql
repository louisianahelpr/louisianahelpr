-- Q14 (Supabase security advisor "authenticated_security_definer_function_executable",
-- 122 findings 2026-10-05): every SECURITY DEFINER function a signed-in client may
-- EXECUTE was checked against the client source (a quoted `rpc("<name>")` in src/),
-- the live policies, the views and every SECURITY INVOKER function in public
-- (read live 2026-10-05). These six are called by none of them: only by other
-- SECURITY DEFINER functions, triggers that run as their owner, or the
-- service-role marketing-publish edge function. Four of them answer about
-- ANOTHER person for any id the caller passes:
--   resolve_auto_tip(uuid, numeric)          another user's auto-tip mode/value/cap
--   is_thread_muted(uuid, uuid, uuid)        whether another user muted a thread
--   user_has_pending_application(uuid, uuid) whether another user applied to a job
--   helper_award_block_reason(uuid)          whether another user finished payout setup
-- and two are harmless but unused by clients:
--   application_cap(text)                    platform application caps
--   marketing_published_today(marketing_channel) today's published marketing count
-- So EXECUTE is revoked from the client roles. service_role and the owner keep it.
-- Replay-safe: each REVOKE runs only when the function exists.
-- Guard: scripts/ci/definer-exec-allowlist.json (exact live set, two-way, checked by
-- scripts/check-live-privileges.mjs) + src/test/definerExecAllowlist.test.ts.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.resolve_auto_tip(uuid, numeric)',
    'public.is_thread_muted(uuid, uuid, uuid)',
    'public.user_has_pending_application(uuid, uuid)',
    'public.helper_award_block_reason(uuid)',
    'public.application_cap(text)',
    'public.marketing_published_today(public.marketing_channel)'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END
$$;
