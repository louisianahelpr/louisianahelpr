-- Job-posting IDV no longer requires the $2 setup fee to be paid FIRST, in a
-- separate Stripe Checkout, before Stripe Identity can even open.
--
-- Owner call (2026-08-29): "i dont want them to pay for id seperatly" — the
-- checkout screen a poster sees right before this dialog already itemizes the
-- $2 as part of THIS job's total (create-payment's `owesOnboardingFee` adds it
-- automatically, see supabase/functions/create-payment/index.ts). Forcing a
-- second, standalone $2 checkout before IDV can run was redundant: the fee was
-- always going to be collected in the very next screen anyway.
--
-- THE COST-GATE REASONING THIS OVERRIDES, AND WHY IT'S SAFE HERE. The gate
-- exists because Stripe bills the platform for every VerificationSession the
-- moment it's created, whether or not the person ever pays for anything else
-- (see 20260827193414_idv_start_cost_guard.sql). For a HELPER accepting a job,
-- their $2 is collected out of a FUTURE payout that may be weeks away, so
-- requiring it paid up front is the only guarantee the platform ever sees that
-- money. For a POSTER mid-checkout, the $2 rides on the SAME job payment they
-- are about to complete in this same session, seconds later — the exposure
-- window is one abandoned checkout, not an indefinite wait on a job that may
-- never finish. That is an accepted, bounded risk, not a removed control.
--
-- SCOPE: this only skips the fee check. It does NOT touch the one-paid-attempt
-- cap, the manual-review path, or the ban check — a job-posting caller can
-- still only claim ONE billable attempt, same as before.
--
-- REPLAY-SAFETY: CREATE OR REPLACE on a function that already exists at an
-- earlier timestamp; the new parameter is appended with a default, so any
-- caller still invoking the two-argument form is unaffected.

CREATE OR REPLACE FUNCTION public.claim_idv_attempt(
  p_user_id uuid,
  p_max_attempts integer DEFAULT 1,
  p_skip_fee_gate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status  text;
  v_paid    boolean;
  v_count   integer;
  v_banned  text;
  v_claimed integer;
  -- Hard-coded on purpose: see 20260829031405. `p_max_attempts` is accepted
  -- for signature compatibility and deliberately not read.
  v_max     integer := 1;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_authenticated');
  END IF;

  SELECT p.idv_status, p.onboarding_fee_paid, p.idv_attempt_count, p.ban_status
    INTO v_status, v_paid, v_count, v_banned
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'profile_not_found');
  END IF;

  IF v_status = 'verified' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_verified');
  END IF;

  -- Already with a human. Spending a second session on an account an admin is
  -- actively reviewing is the exact double-charge this migration exists to
  -- stop, and it would also stomp the reviewable state back to 'pending'.
  IF v_status = 'manual_review' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_manual_review');
  END IF;

  -- A banned account must not be able to spend platform money either.
  IF v_banned IN ('temp_banned', 'permanently_banned') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_restricted');
  END IF;

  IF v_paid IS NOT TRUE AND NOT p_skip_fee_gate THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'onboarding_fee_unpaid');
  END IF;

  IF COALESCE(v_count, 0) >= v_max THEN
    RETURN jsonb_build_object(
      'claimed', false, 'reason', 'attempt_limit_reached',
      'attempt', COALESCE(v_count, 0), 'max_attempts', v_max
    );
  END IF;

  UPDATE public.profiles
     SET idv_attempt_count = COALESCE(idv_attempt_count, 0) + 1,
         idv_attempted_at  = now(),
         idv_status        = 'pending'
   WHERE user_id = p_user_id
     AND COALESCE(idv_attempt_count, 0) = COALESCE(v_count, 0)
  RETURNING idv_attempt_count INTO v_claimed;

  IF v_claimed IS NULL THEN
    -- Someone else took this attempt between the read and the write.
    RETURN jsonb_build_object('claimed', false, 'reason', 'attempt_race_lost');
  END IF;

  RETURN jsonb_build_object(
    'claimed', true, 'reason', NULL,
    'attempt', v_claimed, 'max_attempts', v_max
  );
END;
$$;

COMMENT ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean) IS
  'Atomically claims THE ONE billable Stripe Identity attempt this account gets, or refuses with a reason (already_verified / in_manual_review / account_restricted / onboarding_fee_unpaid / attempt_limit_reached / attempt_race_lost). p_skip_fee_gate lets a caller (job-posting only, as of 2026-08-29) proceed without the $2 already settled, because that fee is guaranteed to be collected in the same checkout session moments later — see 20260829090211. The cap is hard-coded at 1 — p_max_attempts is ignored — because the $2 onboarding fee funds exactly one Stripe charge.';

REVOKE ALL ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean) TO service_role;
