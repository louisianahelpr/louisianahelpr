-- Signup consent + referral integrity.
--
-- Three defects, one migration, because they share one root cause: the signup
-- transaction records facts about a user (they agreed to the Terms; someone
-- referred them) into columns and tables that no single writer owns, so each
-- fact drifted into a different shape depending on which screen produced it.
--
-- 1. TWO CONSENT COLUMNS THAT DO NOT KNOW ABOUT EACH OTHER.
--    `profiles.accepted_terms_at` (added 2026-04-27) is written only by
--    CompleteProfile.tsx. `profiles.terms_accepted_at` +
--    `terms_version_accepted` (added 2026-07-08) are written only by the
--    complete-signup edge function and TermsReconsentDialog. Neither migration
--    mentions the other. Measured in prod 2026-09-01 (30 profiles):
--      accepted_terms_at IS NULL .......... 12
--      terms_accepted_at IS NULL .......... 22
--      BOTH NULL .......................... 8
--    and where both are set they disagree by minutes, because they were
--    stamped by different screens at different moments.
--
--    This migration gives the two columns DISTINCT, documented meanings rather
--    than leaving one dead:
--      accepted_terms_at  = the FIRST time this user ever accepted. Immutable
--                           once set (enforced below). This is the legally
--                           load-bearing one — the original consent.
--      terms_accepted_at  = when they accepted the version currently named in
--                           terms_version_accepted. Moves on a version bump.
--      legal_acceptances  = append-only, one row per acceptance EVENT.
--    "Overwritten on re-submit" was the reported defect. Re-stamping the
--    *current version's* timestamp is correct; destroying the *original*
--    consent is not. The trigger below makes the second one impossible at the
--    database, so no future writer can reintroduce it by forgetting.
--
-- 2. REFERRALS COULD NEVER BE RECORDED.
--    `process_referral` was hardened on 2026-08-19 to require
--    `auth.uid() = p_new_user_id`, and is GRANTed to `authenticated` only. Its
--    sole caller ran inside Signup.tsx immediately after `supabase.auth.signUp`
--    — which, with email confirmation on, returns NO session. Verified against
--    prod 2026-09-01:
--      anon key      -> 401 {"code":"42501","message":"permission denied for
--                            function process_referral"}
--      service role  -> 400 {"code":"23514","message":"not_authorized"}
--    So the call failed 100% of the time and the client only report()ed it.
--    Prod: 29 rows in referral_codes, 0 rows in referrals, and the only 2
--    referral_credits are hand-seeded (referral_code_id IS NULL).
--
--    The fix moves the write to the one place that already proves account
--    ownership without a session: the complete-signup edge function (30-minute
--    window from account creation + never-signed-in + empty profile, or a valid
--    JWT). That function runs service-role, where `auth.uid()` is NULL — so it
--    CANNOT call process_referral, which would raise `not_authorized` by
--    design. Rather than duplicate the lookup logic there (a second copy is
--    exactly how the consequence-ladder drift happened), the body moves into
--    `record_referral_signup`, granted to service_role ONLY, and
--    `process_referral` keeps its identity check and delegates to it.
--
--    This grants service_role nothing it did not already have — service_role
--    bypasses RLS and could already INSERT into `referrals` directly. What it
--    buys is one implementation instead of two. The authenticated-facing
--    entry point is unchanged in behaviour: same signature, same return
--    values, same `not_authorized` on an identity mismatch, same GRANTs
--    (CREATE OR REPLACE preserves the ACL).
--
-- 3. A BANNED OR DENIED REFERRER WAS STILL PAID, AND A SELF-REFERRAL WOULD BE
--    PAID TWICE.
--    Neither `process_referral` nor `check_referral_bonus` nor
--    `check-pro-subscription` (which mints a $10 subscription_bonus) looks at
--    the recipient's `ban_status` or `approval_status`. The ban gate
--    (`enforce_ban_gate`, 2026-08-24) is attached to applications/jobs/messages
--    and keys on the CALLER — the referrer is never the caller when their
--    credit is minted, so it has never applied here.
--
--    The guard goes on `referral_credits` BEFORE INSERT rather than inside
--    `check_referral_bonus` for two reasons: it covers every minting path at
--    once (the jobs trigger AND the subscription edge function AND anything
--    added later), and it avoids a CREATE OR REPLACE of `check_referral_bonus`,
--    whose live body was last rewritten IN PLACE by
--    20260831232514_notification_links_land_on_the_right_spot.sql via
--    pg_get_functiondef + regexp_replace. Replacing that function from a static
--    body here would silently revert that migration's notification-link fix.
--
-- Replay-safe: every statement is guarded (IF NOT EXISTS / DROP ... IF EXISTS /
-- CREATE OR REPLACE / a NOT VALID-free CHECK added only when absent), and the
-- backfill is idempotent by construction (it only ever moves a timestamp
-- backwards to the earliest known value, so a second run is a no-op).
-- Applied 3x consecutively against a prod-shaped PGlite schema before shipping.

-- ---------------------------------------------------------------------------
-- 1. CONSENT: give the two columns distinct meanings, then make the first one
--    immutable so nothing can destroy an original consent again.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.profiles.accepted_terms_at IS
  'FIRST-EVER acceptance of the Terms / Privacy / Platform Rules by this user. '
  'Immutable once set — pinned to its existing value by '
  'tr_preserve_first_consent. This is the original consent event and the one '
  'that matters legally. For "which version are they on and when did they '
  'accept it", read terms_version_accepted + terms_accepted_at. For the full '
  'audit trail, read public.legal_acceptances (append-only, one row per '
  'acceptance event).';

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'When this user accepted the version named in terms_version_accepted. '
  'Re-stamped on a material policy bump (TermsReconsentDialog). NOT the '
  'original consent — see accepted_terms_at for that.';

-- Backfill: where only one of the two columns was ever written, the other is
-- describing the same consent event and should not stay null. accepted_terms_at
-- takes the EARLIEST of the two known timestamps, because it means "first ever".
-- Idempotent: a second run finds nothing left to move.
UPDATE public.profiles
SET accepted_terms_at = LEAST(
      COALESCE(accepted_terms_at, terms_accepted_at),
      COALESCE(terms_accepted_at, accepted_terms_at)
    )
WHERE (accepted_terms_at IS NULL AND terms_accepted_at IS NOT NULL)
   OR (accepted_terms_at IS NOT NULL AND terms_accepted_at IS NOT NULL
       AND terms_accepted_at < accepted_terms_at);

UPDATE public.profiles
SET terms_accepted_at = accepted_terms_at
WHERE terms_accepted_at IS NULL
  AND accepted_terms_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.preserve_first_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Once a user has accepted, that moment is history. Every writer is free to
  -- keep sending `accepted_terms_at: now()` (they all do, and asking each of
  -- them to read-then-write would be a race); the database quietly keeps the
  -- first value instead of trusting the newest caller.
  --
  -- Deliberately NOT exempt for admins or service_role: there is no legitimate
  -- reason for any actor to move a recorded consent forward in time, and the
  -- one operation that would need it (correcting a wrong row) should be an
  -- explicit, reviewed statement that drops this trigger, not an accident.
  IF OLD.accepted_terms_at IS NOT NULL THEN
    NEW.accepted_terms_at := OLD.accepted_terms_at;
  END IF;

  -- A user cannot un-accept by clearing the column either.
  IF NEW.accepted_terms_at IS NULL AND OLD.accepted_terms_at IS NOT NULL THEN
    NEW.accepted_terms_at := OLD.accepted_terms_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_preserve_first_consent ON public.profiles;
CREATE TRIGGER tr_preserve_first_consent
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.preserve_first_consent();

-- ---------------------------------------------------------------------------
-- 2. REFERRALS: one implementation, two entry points.
-- ---------------------------------------------------------------------------

-- Structural guarantee that a self-referral row cannot exist at all. The only
-- code path that inserts into `referrals` already refuses one, but
-- `check_referral_bonus` credits BOTH `referred_id` and `referrer_id` off a
-- single row, so a self-referral written by any other means (service role, a
-- future admin tool, a hand-run statement) would pay the same person twice for
-- their own job. A constraint is the only guard that survives a new writer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.referrals'::regclass
      AND conname = 'referrals_no_self_referral'
  ) THEN
    -- No NOT VALID: prod holds 0 rows in this table (verified 2026-09-01), so
    -- the validating scan is free and a pre-existing violation would be a
    -- finding we want surfaced loudly rather than parked.
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_no_self_referral CHECK (referrer_id <> referred_id);
  END IF;
END;
$$;

-- The referral-recording body, with NO caller authorization of its own. Every
-- entry point below is responsible for establishing that the caller may enrol
-- p_new_user_id; this function only enforces the referral rules themselves.
-- It is granted to service_role ONLY (see the REVOKE/GRANT pair below) — it
-- must never be reachable from `anon` or `authenticated`, or it would reopen
-- the hole 20260819060000_security_authz_hardening.sql closed.
CREATE OR REPLACE FUNCTION public.record_referral_signup(
  p_referral_code text,
  p_new_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code_record RECORD;
  v_inserted integer;
BEGIN
  IF p_referral_code IS NULL OR btrim(p_referral_code) = '' OR p_new_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT id, user_id INTO v_code_record
  FROM public.referral_codes
  WHERE code = UPPER(btrim(p_referral_code));

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Self-referral.
  IF v_code_record.user_id = p_new_user_id THEN
    RETURN FALSE;
  END IF;

  -- Already referred by someone. `referrals.referred_id` is UNIQUE, so this is
  -- belt-and-braces for the message rather than the constraint; the ON CONFLICT
  -- below is what makes a concurrent double-submit safe.
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = p_new_user_id) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.referrals (referrer_id, referred_id, referral_code_id)
  VALUES (v_code_record.user_id, p_new_user_id, v_code_record.id)
  ON CONFLICT (referred_id) DO NOTHING;

  -- A null `error` is not a write. The unique index means two concurrent
  -- completions of the same signup resolve to ONE row, and the loser must be
  -- told FALSE rather than reporting a referral it did not create.
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.record_referral_signup(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_referral_signup(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.record_referral_signup(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_referral_signup(text, uuid) TO service_role;

-- The authenticated-facing entry point. Behaviour is unchanged from
-- 20260819060000_security_authz_hardening.sql — same signature, same
-- `not_authorized` on an identity mismatch, same return values — it just no
-- longer carries its own copy of the referral rules. CREATE OR REPLACE
-- preserves the existing ACL (GRANT EXECUTE ... TO authenticated, granted by
-- 20260529072718_grant_execute_client_rpcs_audit_2026_05_28.sql).
CREATE OR REPLACE FUNCTION public.process_referral(p_referral_code text, p_new_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- The caller may only enrol THEMSELVES. Without this, p_new_user_id is an
  -- unauthenticated assertion — and every other uuid on the platform is
  -- readable from jobs.customer_id / get_safe_profiles.
  IF auth.uid() IS NULL OR auth.uid() <> p_new_user_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'check_violation';
  END IF;

  RETURN public.record_referral_signup(p_referral_code, p_new_user_id);
END;
$$;

-- Belt and braces on the ACL. CREATE OR REPLACE preserves the existing grants,
-- and prod already answers `anon` with 42501 (verified 2026-09-01), so this
-- changes nothing today — it exists because a bare `CREATE FUNCTION` grants
-- EXECUTE to PUBLIC by default, and if this function is ever dropped and
-- recreated instead of replaced, the pre-2026-08-19 hole comes back silently.
-- Stating the intended ACL is cheaper than trusting that it never happens.
REVOKE ALL ON FUNCTION public.process_referral(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_referral(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_referral(text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. CREDIT ELIGIBILITY: a banned or denied account does not accrue credit,
--    and no one is ever paid for referring themselves.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_referral_credit_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ban_status text;
  v_approval_status text;
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

  SELECT ban_status, approval_status
  INTO v_ban_status, v_approval_status
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

  IF v_ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     OR v_approval_status = 'denied' THEN
    -- Recorded, not silent. `enforce_referral_cap` (the sibling trigger on this
    -- table) returns NULL with a fraud_flags row for exactly this reason: the
    -- INSERT is a trigger-side effect of a job completing, so RAISEing would
    -- roll back the completion itself. A flag is how an operator finds out.
    INSERT INTO public.fraud_flags (user_id, flag_type, details)
    VALUES (
      NEW.user_id,
      'referral_abuse',
      format(
        'Referral credit blocked: recipient is %s (ban_status=%s, approval_status=%s, reason=%s, amount=%s).',
        CASE WHEN v_approval_status = 'denied' THEN 'denied' ELSE 'banned' END,
        COALESCE(v_ban_status, 'null'),
        COALESCE(v_approval_status, 'null'),
        NEW.reason,
        NEW.amount
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_credit_eligibility ON public.referral_credits;
CREATE TRIGGER trg_referral_credit_eligibility
  BEFORE INSERT ON public.referral_credits
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_referral_credit_eligibility();
