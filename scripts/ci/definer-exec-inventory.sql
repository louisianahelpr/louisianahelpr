-- Inventory (Q14): every SECURITY DEFINER function in public that a client role
-- (anon or authenticated) may EXECUTE, one row per (signature, role). The
-- signature is `name(arg types)` exactly as oidvectortypes prints them, the key
-- of scripts/ci/definer-exec-allowlist.json. scripts/check-live-privileges.mjs
-- compares this live set with that file in BOTH directions: a new client-callable
-- definer function, or a stale allowlist entry, fails. Supabase's security
-- advisor reports the same class as anon_/authenticated_security_definer_
-- function_executable.
SELECT format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) AS signature,
       r.role
  FROM pg_proc p
 CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosecdef
   AND has_function_privilege(r.role, p.oid, 'EXECUTE')
