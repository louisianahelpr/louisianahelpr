-- The award gate's seed exemption was letting the only two REAL Stripe
-- accounts on the platform straight through it.
--
-- WHAT I FOUND, on live data, right after 20260827191647 deployed:
--
--   is_seed | has stripe_account_id | count
--   --------+-----------------------+------
--   false   | false                 |   3
--   true    | false                 |  18
--   true    | true                  |   2     <-- both real Connect accounts
--
-- `helper_award_block_reason` exempts `is_seed` profiles so fixture data stays
-- usable, on the stated reasoning that "seeded helpers have no real Stripe
-- account". That premise is false in prod: the ONLY two profiles carrying a
-- live `stripe_account_id` are both flagged as seeds — and they are the same
-- two accounts _shared/stripeIdentity.ts pins as having payouts_enabled while
-- Stripe reported "Provided identity information could not be verified".
--
-- So the exemption written to protect test fixtures was, in practice,
-- exempting exactly the accounts the gate exists to stop. Every other real
-- account was correctly blocked (3 of 3 on payout setup); these two sailed
-- through.
--
-- THE FIX is to hold the exemption to its own premise: a seed profile is
-- exempt only while it has NO Stripe account. The moment a profile has a real
-- Connect account it is judged on Stripe's answer like anyone else, whatever
-- its fixture flag says. Genuine fixtures (18 of 20) are unaffected — they have
-- no stripe_account_id and stay exempt.
--
-- Not fixed by clearing `is_seed` on those two rows instead: the flag may be
-- load-bearing for other fixture behaviour, and a data edit would leave the
-- same trapdoor open for the next profile that gets flagged. The rule is the
-- thing that was wrong.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a function whose table already exists at
-- this point in the timeline; no new objects.

CREATE OR REPLACE FUNCTION public.helper_award_block_reason(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acct     text;
  v_payouts  boolean;
  v_identity boolean;
  v_seed     boolean;
  v_paused   boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'helper_unknown';
  END IF;

  SELECT p.stripe_account_id, p.stripe_payouts_enabled, p.stripe_identity_verified, p.is_seed
    INTO v_acct, v_payouts, v_identity, v_seed
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'helper_unknown';
  END IF;

  -- Fixture data stays usable — but ONLY while it is actually fixture-shaped.
  -- A profile holding a real Connect account is judged on Stripe's answer no
  -- matter what its seed flag says; see the header for why that mattered.
  IF v_seed IS TRUE AND v_acct IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_acct IS NULL OR v_payouts IS NOT TRUE THEN
    RETURN 'helper_payout_setup_incomplete';
  END IF;

  -- Operator kill switch — the same flag the client honours
  -- (feature_flags.idv_requirement_paused, Admin → Settings) so a Stripe
  -- Identity outage cannot freeze the whole marketplace. Fails CLOSED: a
  -- missing row or missing key leaves the identity requirement in force.
  SELECT COALESCE((s.feature_flags ->> 'idv_requirement_paused')::boolean, false)
    INTO v_paused
  FROM public.platform_settings s
  LIMIT 1;

  IF v_identity IS NOT TRUE AND COALESCE(v_paused, false) IS NOT TRUE THEN
    RETURN 'helper_identity_unverified';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.helper_award_block_reason(uuid) IS
  'NULL when this helper may be awarded a job; otherwise helper_payout_setup_incomplete / helper_identity_unverified / helper_unknown. Seed fixtures are exempt ONLY while they hold no stripe_account_id — a profile with a real Connect account is always judged on Stripe''s answer. The single source of truth for the acceptance gate.';
