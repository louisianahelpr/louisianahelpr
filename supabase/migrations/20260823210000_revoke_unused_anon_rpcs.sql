-- Surface reduction: five SECURITY DEFINER RPCs that `anon` can execute and
-- that nothing in the app ever calls.
--
-- Each takes an identity as a PARAMETER and never consults auth.uid(), so it
-- answers questions about whoever you name rather than about the caller. That
-- is defensible for an internal helper invoked by another definer; it is not
-- defensible when the function is also reachable unauthenticated at
-- /rest/v1/rpc/<name>. The two that matter most:
--
--   get_time_credit_balance(p_user_id)      → a named user's credit balance
--   business_budget_alert_check(p_business_id) → a business's financial state
--
-- and two more that answer questions about relationships the caller is not part
-- of (can_message_in_job takes the sender id; is_thread_muted takes the user
-- id). Exploiting any of them needs a UUID first, so this is not mass
-- enumeration — but open_jobs_browse publishes customer_id, which is a source
-- of UUIDs, so the combination is worth closing rather than reasoning about.
--
-- VERIFIED UNUSED before revoking, not assumed: zero `.rpc("<name>")` call
-- sites across src/ and supabase/functions/ for all five. If one is ever needed
-- from the client, the grant comes back deliberately — and with a caller check
-- written into the function, which is what it should have had.
--
-- Replay-safe: guarded on existence, and REVOKE is idempotent.

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
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
      RAISE NOTICE 'revoked anon EXECUTE on %', fn;
    ELSE
      RAISE NOTICE 'skipped (not present): %', fn;
    END IF;
  END LOOP;
END $$;

-- DELIBERATELY NOT TOUCHED: has_role(uuid, app_role).
--
-- It is granted to `authenticated` and can be called with any UUID, which does
-- make it an admin-discovery primitive — a real finding. But it is referenced
-- by SEVENTY live RLS policies, and an RLS policy expression is evaluated with
-- the QUERYING user's privileges, so revoking EXECUTE from `authenticated`
-- would fail every one of those policies for every signed-in user. That trades
-- a boolean oracle for a total outage. Measured on prod 2026-08-23:
--
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname='public'
--      AND (coalesce(qual,'') LIKE '%has_role%'
--        OR coalesce(with_check,'') LIKE '%has_role%');   -- 70
--
-- If this is ever worth closing, the move is to narrow the FUNCTION (answer
-- only for _user_id = auth.uid(), after auditing all 70 policies for calls that
-- pass anything else), never to pull the grant.
