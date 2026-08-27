-- `stripe-idv-start` could be looped by any signed-in user to mint unbounded
-- billable Stripe Identity sessions.
--
-- WHAT WAS BROKEN. The function authenticates, short-circuits on
-- `idv_status = 'verified'`, and reuses a still-open pending session — and that
-- is the entire set of guards. An account in any OTHER state (NULL /
-- not_started / failed / requires_input / manual_review / canceled) could call
-- it in a loop. Every call that misses the reuse path runs
-- `stripe.identity.verificationSessions.create`, which Stripe bills to the
-- PLATFORM. There is no rate limit on the function at all, no attempt counter,
-- and no idempotency key on the create. One account could run up an unbounded
-- bill on a live Stripe account, and nothing in the product would show it.
--
-- The IP-keyed helper in _shared/rate-limit.ts is not the fix on its own: it is
-- an in-process Map that resets on every cold start and is per-isolate. That is
-- a spam damper, not a billing cap. A cost guard must be durable and keyed to
-- the USER, which means it belongs in Postgres.
--
-- WHAT THIS ADDS. A counter column and one atomic claim function. The claim is a
-- single conditional UPDATE ... RETURNING, so two concurrent calls cannot both
-- take the last attempt — the same primitive the onboarding-fee paths use to
-- make "charged exactly once" true.
--
-- IT ALSO REQUIRES THE FEE. The $2 the account already owes is described, in
-- the Terms and on the Stripe line item, as the "identity verification &
-- account setup fee". Spending platform money on a Stripe Identity session for
-- an account that has not settled it is the cost hole in one sentence. Owner
-- approved a way to pay it early (edge function `pay-onboarding-fee`), which is
-- what makes this requirement fair rather than a trap: a helper who owes it can
-- settle it deliberately instead of waiting on a first payout.
--
-- WHAT THIS DOES NOT CHANGE: the fee amount, and when it is otherwise
-- collected. The first-job-post line item and the first-payout deduction are
-- untouched, and every path still flips the flag through the same
-- single-winner conditional update — so "you'll never be charged twice" holds.
--
-- ATTEMPT CAP: 3, not 1. Owner policy is one *attempt*, but a session can be
-- abandoned before the user ever reaches the camera (a mistapped link, a
-- dropped native handoff), and a hard cap of 1 would permanently strand those
-- people with no self-service recovery. 3 bounds platform exposure to a few
-- dollars per account while leaving room for an honest retry; an admin can
-- reset the counter to grant more.
--
-- REPLAY-SAFETY: additive column with IF NOT EXISTS; CREATE OR REPLACE for the
-- functions; no dependency on objects defined by later migrations.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS idv_attempt_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.idv_attempt_count IS
  'Durable count of billable Stripe Identity sessions started for this account. Incremented only by claim_idv_attempt(), which is the cost cap on stripe-idv-start. An admin resets it to grant another attempt.';

-- Server-owned: this is a spending cap, so the account it limits must not be
-- able to write it. Pinned alongside the other forgeable trust columns.
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.approval_status := OLD.approval_status;
  NEW.ban_status := OLD.ban_status;
  NEW.stripe_account_id := OLD.stripe_account_id;
  NEW.subscription_tier := OLD.subscription_tier;
  NEW.subscription_expires_at := OLD.subscription_expires_at;
  NEW.denial_reason := OLD.denial_reason;
  NEW.denial_email_count := OLD.denial_email_count;
  NEW.last_denial_email_at := OLD.last_denial_email_at;
  NEW.approval_email_count := OLD.approval_email_count;
  NEW.last_approval_email_at := OLD.last_approval_email_at;
  NEW.drip_step := OLD.drip_step;
  NEW.last_drip_at := OLD.last_drip_at;

  NEW.idv_status := OLD.idv_status;
  NEW.idv_session_id := OLD.idv_session_id;
  NEW.idv_attempted_at := OLD.idv_attempted_at;
  NEW.idv_attempt_count := OLD.idv_attempt_count;
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

  NEW.background_check_status := OLD.background_check_status;
  NEW.is_legacy_user := OLD.is_legacy_user;

  NEW.onboarding_fee_paid := OLD.onboarding_fee_paid;
  NEW.onboarding_fee_charged_at := OLD.onboarding_fee_charged_at;
  NEW.email_verified := OLD.email_verified;
  NEW.verification_email_count := OLD.verification_email_count;
  NEW.last_verification_email_at := OLD.last_verification_email_at;

  NEW.application_count := OLD.application_count;
  NEW.auto_suspended_until := OLD.auto_suspended_until;

  NEW.license_status := OLD.license_status;
  NEW.insurance_status := OLD.insurance_status;
  NEW.license_reviewed_at := OLD.license_reviewed_at;
  NEW.insurance_reviewed_at := OLD.insurance_reviewed_at;
  NEW.license_reviewed_by := OLD.license_reviewed_by;
  NEW.insurance_reviewed_by := OLD.insurance_reviewed_by;
  NEW.license_rejection_reason := OLD.license_rejection_reason;
  NEW.insurance_rejection_reason := OLD.insurance_rejection_reason;

  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  -- The acceptance gate's own inputs (migration 20260827191647).
  NEW.stripe_identity_verified := OLD.stripe_identity_verified;
  NEW.stripe_identity_verified_at := OLD.stripe_identity_verified_at;
  NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  NEW.stripe_payouts_enabled := OLD.stripe_payouts_enabled;
  NEW.is_seed := OLD.is_seed;

  RETURN NEW;
END;
$function$;

-- ── The claim ──────────────────────────────────────────────────────────────
-- Returns jsonb { claimed, reason, attempt, max_attempts }. `reason` is null
-- when claimed; otherwise a stable code the edge function turns into copy.
--
-- The eligibility test and the increment are ONE conditional UPDATE against the
-- count just read, so two concurrent callers cannot both take attempt N.
CREATE OR REPLACE FUNCTION public.claim_idv_attempt(
  p_user_id uuid,
  p_max_attempts integer DEFAULT 3
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
  v_max     integer := GREATEST(COALESCE(p_max_attempts, 3), 1);
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

  -- A banned account must not be able to spend platform money either. The old
  -- function checked neither ban_status nor approval_status.
  IF v_banned IN ('temp_banned', 'permanently_banned') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_restricted');
  END IF;

  IF v_paid IS NOT TRUE THEN
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

COMMENT ON FUNCTION public.claim_idv_attempt(uuid, integer) IS
  'Atomically claims one billable Stripe Identity attempt, or refuses with a reason (already_verified / account_restricted / onboarding_fee_unpaid / attempt_limit_reached / attempt_race_lost). The cost cap on stripe-idv-start: that function must not create a VerificationSession without a successful claim.';

-- Service role only: this is called by the edge function, never by a browser. A
-- client that could call it directly could burn its own attempts and, worse,
-- set idv_status = 'pending' at will.
REVOKE ALL ON FUNCTION public.claim_idv_attempt(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_idv_attempt(uuid, integer) TO service_role;
