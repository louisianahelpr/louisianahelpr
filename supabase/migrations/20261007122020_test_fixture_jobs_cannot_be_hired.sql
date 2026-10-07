-- Q946 (owner, 2026-10-07): ONE durable test-only job, marked funded in the
-- database only (payment_status 'escrow', no Stripe charge, no PaymentIntent),
-- so the browse journey has a job to find, open, apply to and withdraw from.
--
-- Who can see it: it is is_seed, so seed_hidden_in_discovery() (Q552, live
-- since 20261007033530) keeps it off every discovery surface for everyone but
-- the registered test accounts.
--
-- Why it must never be hired: an 'escrow' row with no PaymentIntent that got
-- hired, completed and released would make release-payout transfer from the
-- LIVE platform balance with no charge behind it. So a job listed in
-- test_fixture_jobs can be applied to and withdrawn from, and nothing else:
--   * it never gets a Helpr (helper_id) or a direct offer (offered_to_helper_id);
--   * its status only stays 'open' or ends ('cancelled');
--   * its payment_status never moves except as part of that ending.
-- Refused for every role, service role included, so no RPC, cron or console
-- write can walk it into the money path. scripts/e2e/browseFixture.mjs
-- replaces a fixture that ended with a new one.
--
-- The money crons already skip is_seed jobs unless asked (?include_seed=1);
-- this is the stop that does not depend on each of them remembering.
--
-- REPLAY-SAFETY: creates only its own table, function and trigger, each with
-- IF NOT EXISTS / OR REPLACE / DROP IF EXISTS; public.jobs exists long before.
-- Guard: src/test/testFixtureJobsCannotBeHired.test.ts.

CREATE TABLE IF NOT EXISTS public.test_fixture_jobs (
  job_id     uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  purpose    text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.test_fixture_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.test_fixture_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_fixture_jobs TO service_role;

-- Q807: every new public table carries the unconfirmed-email write gate.
DO $$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END $$;

COMMENT ON TABLE public.test_fixture_jobs IS
  'Q946: durable test-only jobs (is_seed, escrow with no Stripe charge). A listed job can be applied to and withdrawn from, never hired: trg_jobs_test_fixture_never_hired.';

CREATE OR REPLACE FUNCTION public.enforce_test_fixture_job_never_hired()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.test_fixture_jobs f WHERE f.job_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  IF NEW.helper_id IS NOT NULL AND NEW.helper_id IS DISTINCT FROM OLD.helper_id THEN
    RAISE EXCEPTION 'test fixture job % cannot be hired (Q946)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.offered_to_helper_id IS NOT NULL AND NEW.offered_to_helper_id IS DISTINCT FROM OLD.offered_to_helper_id THEN
    RAISE EXCEPTION 'test fixture job % cannot receive a direct offer (Q946)', OLD.id USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text NOT IN ('open', 'cancelled') THEN
    RAISE EXCEPTION 'test fixture job % cannot move to %, only stay open or end (Q946)', OLD.id, NEW.status USING ERRCODE = '42501';
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND NEW.status::text <> 'cancelled' THEN
    RAISE EXCEPTION 'test fixture job % keeps its payment_status while open (Q946)', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_test_fixture_job_never_hired() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_test_fixture_never_hired ON public.jobs;
CREATE TRIGGER trg_jobs_test_fixture_never_hired
  BEFORE UPDATE OF helper_id, offered_to_helper_id, status, payment_status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_test_fixture_job_never_hired();
