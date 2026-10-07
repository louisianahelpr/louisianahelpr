-- Class check (Q1264 (2), lh-authz-rls review of Q1159/Q1174): every function in
-- public that READS public.error_logs, with how many of its reads carry no
-- tags.origin predicate. One row per reader; scripts/check-live-privileges.mjs
-- fails when a function has more unfiltered reads than
-- scripts/ci/error-log-unfiltered-readers.json allows.
--
-- Why live and not only from migrations: anon and authenticated may INSERT
-- error_logs rows, so a server throttle or dedupe that counts rows by
-- tags.source / job_id without `coalesce(tags ->> 'origin', '') <> 'client'`
-- can be muted by one forged row. src/test/errorLogDedupesIgnoreClientRows.test.ts
-- checks the migration text; a function edited on prod outside a migration
-- (detect_stuck_payments drifted that way, 2026-10-04) slips past it. This reads
-- the deployed bodies.
--
-- Counting rule, the same as the unit test: a read is `FROM|JOIN [public.]error_logs`;
-- a filter is `coalesce(<alias>.tags ->> 'origin', '') <> 'client'` or
-- `<alias>.tags ->> 'origin' (=|<>) 'client'|'server'`, ignoring NEW./OLD. (the
-- row being inserted, not a row being read). Line comments are blanked first.
-- Keep it a single SELECT with no trailing semicolon-dependent statements.
SELECT p.proname::text AS function_name,
       greatest(0,
         (SELECT count(*) FROM regexp_matches(s.src, '\m(from|join)\s+(public\.)?error_logs\M', 'gi'))
         - (SELECT count(*)
              FROM regexp_matches(s.src,
                     'coalesce\s*\(\s*((\w+\.)?)tags\s*->>\s*''origin''\s*,\s*''''\s*\)\s*<>\s*''client''|((\w+\.)?)tags\s*->>\s*''origin''\s*(=|<>)\s*''(client|server)''',
                     'gi') m
             WHERE coalesce(nullif(m[1], ''), m[3], '') !~* '^(new|old)\.$'))::int AS unfiltered
  FROM pg_proc p
  CROSS JOIN LATERAL (SELECT regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g') AS src) s
 WHERE p.pronamespace = 'public'::regnamespace
   AND s.src ~* '\m(from|join)\s+(public\.)?error_logs\M'
