-- Class check (Q1185 final review #1, 2026-10-03): every function in public
-- that reads CURRENT_DATE pins TimeZone to America/Chicago. Returns one row per
-- offender; ZERO ROWS = CLEAN.
--
-- Why: CURRENT_DATE is the SESSION's date, and prod sessions run in UTC, a day
-- ahead of Louisiana from 19:00 to 24:00 CDT. A job's date_needed is a
-- Louisiana date, so an unpinned `date_needed < CURRENT_DATE` calls a job dated
-- today "already passed" every evening. direct_accept_block_reason shipped in
-- review without the pin and refused a same-day direct accept from 19:00 CDT
-- (and never completed a pending one), while enforce_application_job_state,
-- pinned, admitted the same application in the same session. The six live
-- functions that read CURRENT_DATE were all pinned (measured 2026-10-03).
--
-- Scope: the calendar date read from the clock, in any spelling: CURRENT_DATE,
-- a clock value cast to date (now()::date, current_timestamp::date,
-- localtimestamp::date, ...) and date(now()) (re-review should-fix 7: an
-- unpinned now()::date has the same bug and the first version missed it). A
-- bare LOCALTIMESTAMP is a timestamp, not a date (prune_retention_tables uses
-- one for a retention cutoff). The ops monitors that bucket now() into UTC
-- days (date_trunc('day', now())) are out of scope: their windows are ops
-- time, not a job's date.
--
-- Shared by:
--   scripts/check-live-privileges.mjs   prod, after every db-deploy and nightly (db-drift-detect)
--   .github/workflows/db-smoke.yml      the replayed migration set, before a deploy
--   src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs   PGlite red/green proof
-- Keep it a single SELECT with no trailing semicolon-dependent statements.
SELECT p.proname::text AS function_name,
       coalesce(array_to_string(p.proconfig, ','), '') AS config
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g')
       ~* ('\mcurrent_date\M'
           || '|(\mnow\(\)|\mcurrent_timestamp\M|\mlocaltimestamp\M|\mtransaction_timestamp\(\)|\mstatement_timestamp\(\)|\mclock_timestamp\(\))\s*::\s*date\M'
           || '|\mdate\s*\(\s*(now\(\)|current_timestamp|localtimestamp)\s*\)')
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
                    WHERE lower(c) = 'timezone=america/chicago')
 ORDER BY 1
