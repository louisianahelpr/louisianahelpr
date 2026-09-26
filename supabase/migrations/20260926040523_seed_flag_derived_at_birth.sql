-- Test data is seed data from birth (docs/OPEN.md Q46, fixture-writer half).
--
-- WHY THE DATABASE, NOT ONLY THE WRITERS
-- Two tables carry is_seed: public.jobs and public.profiles (measured on prod
-- 2026-09-26: information_schema.columns, both NOT NULL DEFAULT false). A row
-- is born in one of these ways, and only the first can be fixed in the writer:
--   1. a script / probe / spec INSERTs with the service role. It can send
--      is_seed, and src/test/fixtureWritersSetIsSeed.test.ts now makes it.
--   2. a signed-in test account INSERTs a job (the app's post form, a journey,
--      a REST POST with the poster's JWT). enforce_jobs_insert_column_lock
--      discards whatever the client sent and DERIVES is_seed from the poster's
--      profiles.is_seed (newest: 20260924044812; live pg_get_functiondef 2026-09-26).
--   3. an edge function INSERTs a job for an account with the service role:
--      charge-recurring-visits creates each visit's child job (index.ts ~815)
--      without is_seed, and the lock returns early for a server context. A
--      seed series' visits would be born is_seed = false.
--   4. GoTrue creates a user (UI signup, admin API, generate_link) and
--      handle_new_user INSERTs the profiles row with the column default,
--      false. Nothing marked a new @mailinator.com account seed until a
--      script PATCHed it afterwards (prod-seed.mjs, privacy-requests.spec.ts);
--      an account made any other way stayed real.
-- 3 and 4 have no test writer to fix. The row crosses the database whatever
-- made it, so the flag is derived here, for the server context only (the
-- client context of jobs is already the lock's, and the profiles INSERT
-- policy requires is_seed = false from a client, which this leaves alone).
--
-- Both triggers only ever RAISE the flag (false -> true), never clear it, so
-- a writer that sets is_seed explicitly is unaffected and no real row can be
-- hidden: a real account's jobs stay real, and the email rule matches only
-- the fixture inboxes the 20260825184500 backfill keyed on.
--
-- MEASURED BEFORE (prod 2026-09-26 ~04:00Z): jobs 383 (379 seed); jobs with a
-- seed poster or helper but is_seed = false: 0; profiles 60 (57 seed); a
-- profile whose email is a fixture inbox but is_seed = false: 0. So nothing is
-- backfilled; this closes the door for rows not yet born.
--
-- Replay-safe: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS before each
-- CREATE TRIGGER, and each trigger guarded by to_regclass of its table.

CREATE OR REPLACE FUNCTION public.is_fixture_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $fn$
  -- The fixture inboxes: @mailinator.com (every audit / E2E account),
  -- @helpr.test (the demo cast), eli.test.* (the payout fixtures' helper).
  -- Same predicate as the 20260825184500 backfill.
  SELECT coalesce(
           lower(btrim(p_email)) LIKE '%@mailinator.com'
        OR lower(btrim(p_email)) LIKE '%@helpr.test'
        OR lower(btrim(p_email)) LIKE 'eli.test.%',
         false)
$fn$;

REVOKE ALL ON FUNCTION public.is_fixture_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_fixture_email(text) TO service_role;

-- profiles: a fixture inbox is a seed account from its first row.
CREATE OR REPLACE FUNCTION public.profiles_seed_from_fixture_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF public.is_server_context() AND public.is_fixture_email(NEW.email) THEN
    NEW.is_seed := true;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.profiles_seed_from_fixture_email() FROM PUBLIC, anon, authenticated;

-- jobs: a seed account's job is a seed job, whoever inserts it.
CREATE OR REPLACE FUNCTION public.jobs_seed_from_poster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  -- A signed-in poster's INSERT is enforce_jobs_insert_column_lock's to judge.
  IF NOT public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF NOT NEW.is_seed AND EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = NEW.customer_id
          AND p.is_seed
     ) THEN
    NEW.is_seed := true;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_seed_from_poster() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_profiles_seed_from_fixture_email ON public.profiles;
    CREATE TRIGGER trg_profiles_seed_from_fixture_email
      BEFORE INSERT ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.profiles_seed_from_fixture_email();
  END IF;

  IF to_regclass('public.jobs') IS NOT NULL THEN
    -- Sorts after trg_jobs_insert_column_lock ('trg_jobs_s' > 'trg_jobs_i'),
    -- though it no-ops in the lock's (client) context either way.
    DROP TRIGGER IF EXISTS trg_jobs_seed_from_poster ON public.jobs;
    CREATE TRIGGER trg_jobs_seed_from_poster
      BEFORE INSERT ON public.jobs
      FOR EACH ROW EXECUTE FUNCTION public.jobs_seed_from_poster();
  END IF;
END
$do$;
