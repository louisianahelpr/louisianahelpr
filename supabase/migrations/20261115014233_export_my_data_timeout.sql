-- "Download my data" failed for a member with a long history: export-my-data answered 500 ("We couldn't put your
-- data together just now"), and the function logs said `export_my_data failed: 57014 canceling statement due to
-- statement timeout` (press-every-control 43007456468 and 43584967592, the shared poster test account).
--
-- Measured on prod 2026-11-14 (read-only): export_my_data took 12-13 s for that account (a 9.4 MB document: 834
-- jobs, 7575 notification logs), and the REST API cuts every call at the authenticator role's 8 s. Its 197 section
-- queries take 0.48 s together; the rest is the `v_out := v_out || jsonb_build_object(...)` shape, which copies
-- the growing document once per section. That rewrite is filed separately (docs/OPEN.md, export rebuild); this
-- gives the one call a member makes to get their own data the time it needs today.
--
-- The REST API applies a function's own statement_timeout to the call (Supabase docs, Database > Timeouts,
-- "Function level"). CREATE OR REPLACE drops a function's SET clauses, so every later definition of export_my_data
-- must carry `SET statement_timeout TO '60s'` in its header, or be followed by this ALTER again:
-- src/test/exportMyDataKeepsItsTimeout.test.ts fails otherwise.
--
-- REPLAY-SAFETY: only when the function exists (it is defined by earlier migrations; a rebuild reaches it first).
DO $do$
BEGIN
  IF to_regprocedure('public.export_my_data(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.export_my_data(uuid) SET statement_timeout TO '60s';
  END IF;
END
$do$;
