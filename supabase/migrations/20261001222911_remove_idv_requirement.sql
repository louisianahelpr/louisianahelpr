-- Identity verification no longer gates anything (owner, 2026-10-01:
-- "Remove finish verifying id we don't do that anymore").
--
-- Two server gates required it. Measured live on prod 2026-10-01
-- (pg_policy.polwithcheck / pg_get_functiondef):
--
--   1. jobs INSERT policy "Customers can create jobs" (roles {public},
--      permissive) carried, besides ownership / business_id / blocked-pair,
--      an EXISTS(...) clause requiring the poster's own profile to be verified.
--      Posting a job was refused at the RLS layer for every unverified account.
--   2. helper_award_block_reason(uuid), after the payout check, returned
--      'helper_identity_unverified'. Both award triggers
--      (enforce_helper_award_gate, enforce_group_roster_award_gate) call it, so
--      replacing the function lifts the requirement from both.
--
-- Everything else is carried over VERBATIM: the policy keeps ownership,
-- business_id and the blocked-pair clause; the function keeps helper_unknown,
-- the fixture carve-out and the payout-setup refusal, with the same signature,
-- volatility, SECURITY DEFINER and search_path.
--
-- Not changed on purpose: the profiles INSERT policy still makes a new row
-- start unverified. That is an anti-self-escalation guard (nobody can forge a
-- verified badge), not a requirement to verify.
--
-- Replay-safe: the policy is dropped before it is created and the function is
-- CREATE OR REPLACE; every object referenced (jobs, profiles,
-- are_users_blocked) is defined by an earlier migration.

DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;
CREATE POLICY "Customers can create jobs" ON public.jobs
  FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = customer_id
    AND business_id IS NULL
    AND (offered_to_helper_id IS NULL OR NOT are_users_blocked(customer_id, offered_to_helper_id))
  );

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

  -- Fixture data stays usable, but only while it is fixture-shaped: a profile
  -- holding a real Connect account is judged on Stripe's answer.
  IF v_seed IS TRUE AND v_acct IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_acct IS NULL OR v_payouts IS NOT TRUE THEN
    RETURN 'helper_payout_setup_incomplete';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_award_block_reason(uuid) TO authenticated, service_role;
