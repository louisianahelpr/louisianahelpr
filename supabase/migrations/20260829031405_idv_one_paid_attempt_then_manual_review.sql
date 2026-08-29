-- ONE paid Stripe Identity attempt per account, then a human looks at it.
--
-- Owner policy, verbatim (2026-08-28): "1 try for $2 and then send to admin
-- for manual verification" — and, on who pays: "i will not pay for this ever.
-- it either gets paid with their first posting or gets taken out first job."
--
-- WHAT WAS WRONG. `claim_idv_attempt` shipped with `p_max_attempts DEFAULT 3`
-- (20260827193414), and `stripe-idv-start` calls it with no argument, so the
-- effective cap was 3. Stripe bills the PLATFORM for every *submitted*
-- verification regardless of outcome ("You're charged for every submitted
-- verification, regardless of the outcome" — Stripe Identity docs), so three
-- attempts is three charges against a $2 fee that was collected once. The cap
-- and the fee have to be the same number of things, and that number is one.
--
-- WHERE THE CAP LIVES, AND WHY HERE. It is hard-coded in this function and the
-- `p_max_attempts` argument is now ignored, rather than being enforced by the
-- caller in `stripe-idv-start`:
--
--   * This function is the only thing that increments the counter and the only
--     thing that stands between a caller and a billable session. A cap the
--     caller supplies is a cap the caller can raise — a future edge function,
--     or a redeploy of this one with a stray argument, silently buys more
--     attempts. Enforced here, there is no argument that can.
--   * It is `SECURITY DEFINER` and granted to `service_role` alone, so nothing
--     a browser can reach chooses this number.
--   * The signature is preserved deliberately. Dropping the two-argument form
--     would orphan the REVOKE/GRANT set and break any in-flight caller that
--     still passes the argument; ignoring the parameter is the replay-safe way
--     to retire it.
--
-- THE GRANT PATH IS STILL THERE. One attempt is not one chance. An admin
-- resets `profiles.idv_attempt_count` to hand back an attempt, and — the
-- normal route — approves the person outright from the identity review queue.
-- The point of the cap is that no *user action* can spend platform money
-- twice, not that a failure is final.
--
-- REPLAY-SAFETY: CREATE OR REPLACE on a function that already exists at an
-- earlier timestamp; no new objects; no reference to anything defined later.

CREATE OR REPLACE FUNCTION public.claim_idv_attempt(
  p_user_id uuid,
  p_max_attempts integer DEFAULT 1
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
  -- Hard-coded on purpose: see the header. `p_max_attempts` is accepted for
  -- signature compatibility and deliberately not read.
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
  'Atomically claims THE ONE billable Stripe Identity attempt this account gets, or refuses with a reason (already_verified / in_manual_review / account_restricted / onboarding_fee_unpaid / attempt_limit_reached / attempt_race_lost). The cap is hard-coded at 1 here — p_max_attempts is ignored — because the $2 onboarding fee funds exactly one Stripe charge. An admin grants another by resetting profiles.idv_attempt_count, or verifies the person outright from the identity review queue.';

REVOKE ALL ON FUNCTION public.claim_idv_attempt(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_idv_attempt(uuid, integer) TO service_role;

-- ── Rescue the people the old dead end already stranded ────────────────────
-- `stripe-idv-webhook` wrote idv_status='failed' on a failed or cancelled
-- check, and the client rendered that as "We don't re-run this check" with a
-- pointer at Stripe Connect payout setup — a different column that does not
-- satisfy the jobs INSERT policy. Anyone in that state is permanently unable
-- to post and has no next step. 'manual_review' is a legal value of the
-- idv_status CHECK constraint and puts them in front of an admin instead.
--
-- Scoped to 'failed' only: 'not_started', 'pending' and 'processing' are all
-- live states with their own next step, and 'verified' must never be touched.
UPDATE public.profiles
   SET idv_status = 'manual_review'
 WHERE idv_status = 'failed';
