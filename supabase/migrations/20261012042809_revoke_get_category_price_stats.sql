-- Q1579: get_category_price_stats(text, text) lost its only caller when the owner
-- removed suggested prices from Post a Job (2026-10-08). Nothing else calls it:
-- no rpc("get_category_price_stats") in src/, no edge function, no policy, view
-- or other function body in the migrations (git grep, 2026-10-12). A SECURITY
-- DEFINER function no client calls stays off the client roles (Q14), so EXECUTE
-- is revoked from them; service_role and the owner keep it.
-- Replay-safe: runs only when the function exists.
-- Guard: scripts/ci/definer-exec-allowlist.json (exact live set, two-way, checked by
-- scripts/check-live-privileges.mjs) + src/test/definerExecAllowlist.test.ts.
DO $$
BEGIN
  IF to_regprocedure('public.get_category_price_stats(text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.get_category_price_stats(text, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.get_category_price_stats(text, text) TO service_role;
  END IF;
END
$$;
