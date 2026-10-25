-- Referral code after sign-up (owner 2026-10-25: "make sure there's a place to
-- enter the referral code"). The email sign-up form has an optional field, but
-- an Apple or Google sign-up never asked for one, and a person who forgot to
-- type it had no second chance. Measured 2026-10-25: 283 referral codes,
-- 3 referrals ever recorded.
--
-- claim_my_referral_code: the signed-in member enters a friend's code within
-- 7 days of creating their account, once. It records the referral through the
-- same record_referral_signup the sign-up uses (same checks: the code exists,
-- it is not their own, they have no referral yet). Answers a word the app
-- turns into copy: recorded, no_such_code, own_code, already_referred,
-- too_late, invalid.
CREATE OR REPLACE FUNCTION public.claim_my_referral_code(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_created timestamptz;
  v_owner uuid;
BEGIN
  IF v_uid IS NULL OR v_code = '' OR length(v_code) > 32 THEN
    RETURN 'invalid';
  END IF;
  SELECT u.created_at INTO v_created FROM auth.users u WHERE u.id = v_uid;
  IF v_created IS NULL OR v_created < now() - interval '7 days' THEN
    RETURN 'too_late';
  END IF;
  IF EXISTS (SELECT 1 FROM public.referrals r WHERE r.referred_id = v_uid) THEN
    RETURN 'already_referred';
  END IF;
  SELECT c.user_id INTO v_owner FROM public.referral_codes c WHERE c.code = v_code;
  IF NOT FOUND THEN
    RETURN 'no_such_code';
  END IF;
  IF v_owner = v_uid THEN
    RETURN 'own_code';
  END IF;
  IF public.record_referral_signup(v_code, v_uid) THEN
    RETURN 'recorded';
  END IF;
  RETURN 'already_referred';
END;
$fn$;
REVOKE ALL ON FUNCTION public.claim_my_referral_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_referral_code(text) TO authenticated;
COMMENT ON FUNCTION public.claim_my_referral_code(text) IS
  'A signed-in member enters a friend''s referral code within 7 days of joining, once (Apple/Google sign-ups and anyone who forgot it at sign-up). Records through record_referral_signup. Answers recorded / no_such_code / own_code / already_referred / too_late / invalid.';
