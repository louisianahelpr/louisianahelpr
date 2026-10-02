-- Q871: a blank stripe_account_id ('' or whitespace) can never onboard.
-- stripe-connect getOrCreateAccount treats '' as "no account yet" (falsy), but
-- its Q868 compare-and-set links the new account with
-- .is("stripe_account_id", null), which matches no row holding '', so every
-- attempt 500s. The column is either NULL (no account) or a real acct_ id.
-- Measured 2026-10-02 on prod: 0 profiles hold a blank id, so this validates.
-- Replay-safe: guarded on pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_stripe_account_id_not_blank'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_stripe_account_id_not_blank
      CHECK (stripe_account_id IS NULL OR btrim(stripe_account_id) <> '');
  END IF;
END
$$;
