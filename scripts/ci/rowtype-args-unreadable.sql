-- Class check: no function a client role may EXECUTE takes a whole row of a
-- relation that role cannot SELECT in full. Returns one row per (function,
-- relation, role); ZERO ROWS = CLEAN.
--
-- Why: PostgREST calls a computed field with the whole row
-- (`public.payment_captured("jobs")`), and a whole-row reference needs SELECT
-- on every column. authenticated may not read jobs.offered_to_helper_id
-- (20260915045110, owner decision), so payment_captured(jobs)
-- (20261002050635) made every admin money read fail with 42501 "permission
-- denied for table jobs" from 2026-10-02 09:12Z until 20261003050100 dropped
-- it. Such a function can never work for that role, and only a live read
-- finds out: the replayed schema answers it before deploy.
--
-- has_column_privilege(role, rel, attnum, 'SELECT') is also true under a
-- table-level grant, so a role that can read the whole row never appears. A
-- function nobody but the server may call is not a row (EXECUTE revoked).
--
-- Shared by:
--   .github/workflows/db-smoke.yml       replayed schema (deploy gate), after a
--                                        canary proves it fires
--   scripts/check-live-privileges.mjs    live prod catalog (db-deploy after
--                                        push, db-drift-detect nightly)
-- One SELECT, no inline comments: the live check embeds it as a subquery.
SELECT p.oid::regprocedure::text AS function_name,
       c.oid::regclass::text AS row_of,
       r.role
  FROM pg_proc p
 CROSS JOIN LATERAL unnest(p.proargtypes::oid[]) AS a(argtype)
  JOIN pg_type t ON t.oid = a.argtype
  JOIN pg_class c ON c.oid = t.typrelid AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
 CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
 WHERE p.pronamespace = 'public'::regnamespace
   AND has_function_privilege(r.role, p.oid, 'EXECUTE')
   AND EXISTS (SELECT 1
                 FROM pg_attribute att
                WHERE att.attrelid = c.oid
                  AND att.attnum > 0
                  AND NOT att.attisdropped
                  AND NOT has_column_privilege(r.role, c.oid, att.attnum, 'SELECT'))
 ORDER BY 1, 2, 3;
