-- is_seed is no longer self-grantable, and the payout gate that trusted it
-- now needs a real test-account enrolment (docs/OPEN.md Q2244; Oct 2026
-- money audit, finding 8).
--
-- WHAT WAS BROKEN
-- trg_profiles_seed_from_fixture_email (20260926040523) set profiles.is_seed =
-- true for ANY new account whose email looked like a fixture inbox
-- (is_fixture_email: %@mailinator.com, %@helpr.test, eli.test.% on any
-- domain). The profile row is written by handle_new_user in GoTrue's server
-- context, so a stranger signing up with a free @mailinator.com address became
-- a "test" account. Several rules trust is_seed: helper_award_block_reason
-- (the payout-setup gate on awarding a job: a seed account with no Connect
-- account was never blocked), the phone-reuse and ban-evasion checks, the
-- short-notice rule, alert routing. 20261007033530 and 20261020043346 already
-- moved the switch, ID and accept carve-outs to "is_seed AND enrolled in
-- public.test_accounts"; this closes the root and the payout gate.
--
-- THE FIX (owner via the lane-b lead, 2026-10-25, Q3: "stop deriving is_seed
-- from the email")
--   1. The trigger and its function are dropped. Every script and spec that
--      creates a fixture account already sets is_seed itself with the service
--      role (privacy-requests.spec.ts, e2e/journeys/throwaway.ts,
--      scripts/audit/prod-seed.mjs, scripts/e2e/declutterPayoutProof.mjs,
--      scripts/feature-switch-audience.mjs; src/test/fixtureWritersSetIsSeed.test.ts
--      holds every account-creating site to that). The client cannot set it:
--      the profiles INSERT policy requires is_seed = false and
--      prevent_self_escalation pins it on UPDATE. So after this, only the
--      service role or an admin can make an account seed.
--      public.is_fixture_email stays: email gates (testRecipient,
--      signup-lead-reminders, come-back emails) still use it.
--   2. helper_award_block_reason: the "fixture data stays usable" exemption
--      now also needs the enrolment, exactly as helper_accept_missing does
--      since 20261020043346.
--
-- MEASURED BEFORE (prod, read-only, 2026-10-25): profiles 293, is_seed 65,
-- test_accounts 63; is_seed but not enrolled 2 (both feature-switch-audience
-- probe accounts, kept out of test_accounts on purpose; 0 jobs, no Connect,
-- no Stripe customer); enrolled but not is_seed 0. Nothing is backfilled
-- (owner via lead, Q1: leave the 2 probes as they are).
--
-- Replay-safe: CREATE OR REPLACE, DROP ... IF EXISTS, table-guarded DDL.

-- 1. is_seed is no longer derived from the sign-up email.
DO $do$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_profiles_seed_from_fixture_email ON public.profiles;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.profiles_seed_from_fixture_email();

-- 2. The payout-setup gate on awarding a job.
CREATE OR REPLACE FUNCTION public.helper_award_block_reason(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acct     text;
  v_payouts  boolean;
  v_seed     boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'helper_unknown';
  END IF;

  SELECT p.stripe_account_id, p.stripe_payouts_enabled, p.is_seed
    INTO v_acct, v_payouts, v_seed
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'helper_unknown';
  END IF;

  -- Fixture data stays usable, but only while it is fixture-shaped (a profile
  -- holding a real Connect account is judged on Stripe's answer) AND it is an
  -- enrolled test account: is_seed alone is not ours (Q2244).
  IF v_seed IS TRUE AND v_acct IS NULL
     AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) THEN
    RETURN NULL;
  END IF;

  IF v_acct IS NULL OR v_payouts IS NOT TRUE THEN
    RETURN 'helper_payout_setup_incomplete';
  END IF;

  RETURN NULL;
END;
$function$;

-- Live ACL before (pg_proc.proacl, 2026-10-25): postgres + service_role only.
REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_award_block_reason(uuid) TO service_role;
