-- Inventory (Q14): every SECURITY DEFINER function in public that a client role
-- (anon or authenticated) may EXECUTE, one row per (signature, role). The
-- signature is `name(arg types)` exactly as oidvectortypes prints them, the key
-- of scripts/ci/definer-exec-allowlist.json. scripts/check-live-privileges.mjs
-- compares this live set with that file in BOTH directions: a new client-callable
-- definer function, or a stale allowlist entry, fails. Supabase's security
-- advisor reports the same class as anon_/authenticated_security_definer_
-- function_executable.
-- `scoped` (Q1284): the body reads the caller (auth.uid()), a server or admin
-- check (is_server_context, has_role, is_admin). A definer function without one
-- answers the same for every caller about any id it is handed, so each such
-- function must be listed under "unscoped" in the allowlist with why that is fine.
-- Comments (/* */ and --) are stripped first, so a comment naming auth.uid()
-- does not count (lh-authz-rls review, 2026-10-05). KNOWN LIMIT: a string
-- literal that contains one of those names still counts as reading the caller.
SELECT format('%s(%s)', p.proname, oidvectortypes(p.proargtypes)) AS signature,
       r.role,
       regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^' || chr(10) || ']*', '', 'g')
         ~ 'auth\.uid\(\)|is_server_context|has_role|is_admin' AS scoped
  FROM pg_proc p
 CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosecdef
   AND has_function_privilege(r.role, p.oid, 'EXECUTE')
