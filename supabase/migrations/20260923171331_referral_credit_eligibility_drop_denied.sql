-- Q205(c): enforce_referral_credit_eligibility no longer reads the retired
-- 'denied' approval state.
--
-- Q193 (20260923153703_retire_denied_approval_status) settled every row and
-- added CHECK profiles_approval_status_no_denied, so `approval_status =
-- 'denied'` can never be true again and the branch that read it is dead. This
-- restates the NEWEST definition (20260901035252_signup_consent_referral_integrity,
-- section 3) verbatim with ONLY that branch removed: the ban check, the
-- self-referral block, the no-profile block and every fraud_flags row are
-- unchanged. The flag's text drops the approval_status field and the
-- denied/banned CASE, since "banned" is now the only reason it can fire.
--
-- Replay-safe: CREATE OR REPLACE, and the trigger itself is not touched.
-- CREATE OR REPLACE keeps the existing ACL; the REVOKE below restates it
-- (20260916023649 revoked EXECUTE on every trigger function from client roles).

CREATE OR REPLACE FUNCTION public.enforce_referral_credit_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ban_status text;
BEGIN
  -- Self-payment. `referrals_no_self_referral` above stops the row that feeds
  -- check_referral_bonus, but credit is also minted by check-pro-subscription
  -- (a $10 subscription_bonus) off its own lookup, so the ledger gets its own
  -- guard rather than trusting every future minter.
  IF NEW.referred_user_id IS NOT NULL AND NEW.referred_user_id = NEW.user_id THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (
      NEW.user_id,
      'referral_abuse',
      format('Self-referral credit blocked (reason=%s, amount=%s).', NEW.reason, NEW.amount)
    );
    RETURN NULL;
  END IF;

  SELECT ban_status
  INTO v_ban_status
  FROM public.profiles
  WHERE user_id = NEW.user_id;

  -- No profile row: the recipient is not a live account. Credit that cannot be
  -- attributed to anyone is not credit — refuse it rather than growing an
  -- orphaned ledger row (referral_credits has no FK to profiles or auth.users,
  -- so nothing else would ever catch this).
  IF NOT FOUND THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (
      NEW.user_id,
      'referral_abuse',
      format('Referral credit blocked: no profile row for recipient (reason=%s).', NEW.reason)
    );
    RETURN NULL;
  END IF;

  IF v_ban_status IN ('banned', 'temp_banned', 'permanently_banned') THEN
    -- Recorded, not silent. `enforce_referral_cap` (the sibling trigger on this
    -- table) returns NULL with a fraud_flags row for exactly this reason: the
    -- INSERT is a trigger-side effect of a job completing, so RAISEing would
    -- roll back the completion itself. A flag is how an operator finds out.
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (
      NEW.user_id,
      'referral_abuse',
      format(
        'Referral credit blocked: recipient is banned (ban_status=%s, reason=%s, amount=%s).',
        COALESCE(v_ban_status, 'null'),
        NEW.reason,
        NEW.amount
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_referral_credit_eligibility() FROM PUBLIC, anon, authenticated;
