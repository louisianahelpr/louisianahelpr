-- Q2338 (owner ruling 2026-10-22, Declutter terms #12: strikes stay tied to the verified ID; Phase B of Q2307; lead
-- 2026-11-01 9:35 PM: build it, keep only what is needed). declutter_strikes.user_id CASCADEs, so a member with strikes
-- could delete the account and re-register clean. B84 deferred this while ID checks were off (no fingerprint to key on);
-- the owner switched identity_check on for everyone 2026-11-01 8:13 PM.
--
-- What is kept, and nothing more (data minimisation):
--   declutter_retained_strikes: the one-way identity hash (profiles.identity_sha256, the Stripe Identity fingerprint
--   retained_bans already keys on), and per active strike its side, reason code and two dates (given, expires). No
--   user id, name, email, phone, address, item, appeal text or photo. A row is useless once it expires, so expired rows
--   are deleted whenever a deletion or a restore runs, and a restored row is deleted (moved back, not copied).
-- When:
--   * at account deletion: BEFORE DELETE ON auth.users (before the CASCADE removes profiles and strikes), the member's
--     ACTIVE strikes (not removed, not expired) are copied, only if the profile has an identity hash. A failure never
--     refuses a deletion: it is logged (log_cron_defect) and the delete goes on (the zz_log_account_deletion rule).
--   * at a new verification: declutter_restore_retained_strikes(user, identity hash), called by stripe-idv-webhook with
--     the same fingerprint it hands enforce_retained_ban, moves the matching unexpired rows back onto the new account
--     with their original dates, so each still ends a year after it was given (declutter_strike_expiry). The
--     seller-hidden trigger on declutter_strikes recomputes the new account's standing.
-- The Terms say this (src/pages/info/legal/TermsSection.tsx, Declutter strikes) and so does the Privacy Policy.
-- Law: not cited here. No statute was verified for this change; the Privacy Policy line states the purpose (stopping
-- repeat abuse) and the narrow data kept.
--
-- REPLAY-SAFE: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS; grants restated.
-- Proof: src/test/pglite/declutterStrikesSurviveDeletion.pglite.mjs.

CREATE TABLE IF NOT EXISTS public.declutter_retained_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_sha256 text NOT NULL CHECK (identity_sha256 ~ '^[0-9a-f]{64}$'),
  offender_side text NOT NULL CHECK (offender_side IN ('buyer', 'seller')),
  reason text NOT NULL,
  given_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_retained_strikes_expiry CHECK (expires_at > given_at)
);
CREATE INDEX IF NOT EXISTS declutter_retained_strikes_identity_idx ON public.declutter_retained_strikes (identity_sha256, expires_at);
ALTER TABLE public.declutter_retained_strikes ENABLE ROW LEVEL SECURITY;
-- No policy and no client privilege: written by the deletion trigger, read by the restore, both definer.
REVOKE ALL ON TABLE public.declutter_retained_strikes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_retained_strikes TO service_role;
COMMENT ON TABLE public.declutter_retained_strikes IS
  'Q2338: a deleted member''s active Declutter strikes, keyed only by the one-way Stripe Identity hash (no user id or '
  'contact details), restored when a new account verifies with the same identity. Expired rows are deleted.';

CREATE OR REPLACE FUNCTION public.declutter_retain_strikes_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_ident text;
BEGIN
  BEGIN
    DELETE FROM public.declutter_retained_strikes WHERE expires_at <= now();
    SELECT p.identity_sha256 INTO v_ident FROM public.profiles p WHERE p.user_id = OLD.id;
    IF v_ident IS NOT NULL THEN
      INSERT INTO public.declutter_retained_strikes (identity_sha256, offender_side, reason, given_at, expires_at)
      SELECT v_ident, s.offender_side, s.reason, s.given_at, s.expires_at
        FROM public.declutter_strikes s
       WHERE s.user_id = OLD.id AND s.removed_at IS NULL AND s.expires_at > now();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A deletion is never refused for this: on record where ops reads, and the delete goes on.
    RAISE WARNING 'declutter_retain_strikes_on_delete: strikes not retained: %', SQLERRM;
    PERFORM public.log_cron_defect('declutter_retain_strikes_on_delete', OLD.id::text, SQLERRM);
  END;
  RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_retain_strikes_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS declutter_retain_strikes_on_delete ON auth.users;
CREATE TRIGGER declutter_retain_strikes_on_delete
  BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.declutter_retain_strikes_on_delete();

-- Called by stripe-idv-webhook (service role) once a verification yields an identity hash. Returns strikes restored.
CREATE OR REPLACE FUNCTION public.declutter_restore_retained_strikes(p_user_id uuid, p_identity_sha256 text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_identity_sha256 IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM public.declutter_retained_strikes WHERE expires_at <= now();
  WITH moved AS (
    DELETE FROM public.declutter_retained_strikes r
     WHERE r.identity_sha256 = p_identity_sha256
    RETURNING r.offender_side, r.reason, r.given_at
  ), put AS (
    INSERT INTO public.declutter_strikes (user_id, offender_side, reason, given_at, expires_at)
    SELECT p_user_id, m.offender_side, m.reason, m.given_at, m.given_at + interval '1 year' FROM moved m
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM put;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_restore_retained_strikes(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_restore_retained_strikes(uuid, text) TO service_role;

-- Q807 (train 1 fix, B173 11-02): every public table created after Q807 gets the unconfirmed-email write gate in the
-- migration that creates it (attach_unconfirmed_email_gate is idempotent: it adds the trigger only where it is missing).
SELECT public.attach_unconfirmed_email_gate();
