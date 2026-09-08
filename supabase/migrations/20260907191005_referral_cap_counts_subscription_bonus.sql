-- SC-006: the anti-fraud referral cap did not count the LARGEST referral credit.
--
-- `enforce_referral_cap()` blocks a 6th referral credit and writes a
-- fraud_flags row. It counted `reason IN ('referrer_bonus','first_job_bonus')`
-- — a hand-written list of two, on a table that had grown a third reason.
-- `check-pro-subscription` mints a $10 `subscription_bonus` when a referred
-- user upgrades to a paid tier, and that reason was in neither branch of the
-- count.
--
-- What that actually did, measured in PGlite rather than reasoned about (the
-- first draft of this comment guessed and the probe corrected it): the cap
-- still fires on a credit of ANY reason once the two LISTED reasons alone
-- reach 5. What subscription_bonus rows never did was COUNT — they never
-- pushed the counter toward 5. So ORDER decided everything, which is the tell
-- for a broken guard. Five subscription_bonus credits followed by five
-- referrer_bonus credits leaves a user holding TEN credits against a cap of
-- FIVE, with not one fraud_flags row raised; the same ten in the other order
-- stop at five. The guard only woke up once the counted subset hit the
-- threshold on its own, by which point the damage was done.
--
-- The list also could not have been right for long. It is the same shape as
-- CC-019, which cost eleven entitlement gates on the same afternoon: a literal
-- membership list cannot fail for a member it never had, so `subscription_bonus`
-- was invisible to this guard from the moment it was introduced, with nothing
-- anywhere to notice.
--
-- THE FIX IS TO STOP LISTING REASONS. `referral_credits` IS the referral
-- ledger — every row in it is one issued credit, and there are no debit or
-- reversal rows (a spend flips the `redeemed` boolean on the row rather than
-- inserting a negative one; verified against prod, and the table has no
-- amount-signed column). So "how many referral credits does this user hold"
-- is `count(*)` for that user, full stop. A fourth reason added tomorrow is
-- then counted the day it exists rather than the day someone remembers to
-- edit this function.
--
-- Deliberately NOT changed:
--   * The threshold stays 5. This migration closes a hole in what is counted;
--     re-pricing the cap is a product decision for the owner.
--   * The cap stays a COUNT, not a dollar total. A count is what the fraud
--     signal actually is — ring-referral is about volume of fake accounts, not
--     about dollars — and switching to an amount here would silently loosen it
--     for the cheap credits.
--   * RETURN NULL + a fraud_flags row, rather than RAISE. The INSERT is a
--     trigger-side effect of a job completing or a checkout succeeding;
--     raising would roll back the completion itself. The flag is how an
--     operator finds out. `enforce_referral_credit_eligibility`, the sibling
--     trigger on this table, refuses the same way for the same reason.
--
-- Replay-safe: CREATE OR REPLACE on a function whose signature is unchanged,
-- no dependent objects touched, no grants altered (the trigger runs as its
-- SECURITY DEFINER owner and no role's EXECUTE changes), so applying this file
-- repeatedly is a no-op after the first. Proven with PGlite: three consecutive
-- applies, then the 5th credit granted and the 6th refused with the
-- subscription_bonus in the mix.

CREATE OR REPLACE FUNCTION public.enforce_referral_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  credit_count integer;
BEGIN
  -- EVERY credit this user already holds, whatever its reason. See the header:
  -- the two-reason list this replaces silently exempted the $10
  -- subscription_bonus, which is both the largest credit and the only one that
  -- was entirely uncapped.
  SELECT count(*) INTO credit_count
  FROM public.referral_credits
  WHERE user_id = NEW.user_id;

  IF credit_count >= 5 THEN
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (
      NEW.user_id,
      'referral_abuse',
      format(
        'User hit referral credit cap (5). Credit blocked (reason=%s, amount=%s).',
        NEW.reason,
        NEW.amount
      )
    );
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_referral_cap() IS
  'Blocks a 6th referral credit per user and records a fraud_flags row. Counts '
  'EVERY row in referral_credits, not a hand-written list of reasons — the '
  'previous list of two exempted the $10 subscription_bonus entirely (SC-006).';
