-- A banned user can delete their account. The ban does not go with it.
--
-- ── The two halves of AL-004, which point in opposite directions ────────────
--
-- Apple requires in-app account deletion (App Store Review Guideline
-- 5.1.1(v)) and App Review may exercise it. Today a banned user has no route
-- to it at all: `ProtectedRoute.tsx` runs the ban gate BEFORE the
-- `allowUnapproved` branch, so `banned` / `temp_banned` /
-- `permanently_banned` bounces off every protected route to /account-banned,
-- and that screen offers only Support, Rules and Sign Out. The companion
-- commit puts the delete control on /account-banned itself.
--
-- The API half is the mirror image: `delete-own-account` never reads
-- `ban_status`, so the path the UI blocks works fine for anyone who calls it
-- directly. And it works ALL the way — which is the problem this migration
-- exists for.
--
-- ── What deletion currently does to a ban, verified against prod ────────────
--
-- Read from prod (fncmgoasalhdgfwzhsqa) on 2026-09-03, not inferred from
-- migration history:
--
--   * `profiles_user_id_fkey` is ON DELETE CASCADE, so `profiles.ban_status`
--     and `auto_suspended_until` — the columns `is_caller_banned()` and every
--     UI gate read — are destroyed with the auth row.
--   * `user_bans` has exactly ONE constraint, `user_bans_pkey`. There is no
--     foreign key at all, so those rows survive — but they are keyed on a
--     `user_id` that no longer resolves to anybody, and a returning user gets
--     a fresh uuid. The surviving row is inert.
--   * `purge_user_data()` deletes `fraud_flags` outright ("a fraud flag is a
--     judgment about an identified individual"), so even that judgment goes.
--   * `profiles_email_lower_unique_idx` is the only thing that keeps a banned
--     person from re-registering the same address, and step 4e of the purge
--     nulls `profiles.email` before `auth.admin.deleteUser` frees it in
--     `auth.users`.
--
-- Net: self-deletion is a one-tap ban wipe that also frees the email, and
-- there is nothing left in the database that would recognise the returning
-- account. Making deletion reachable for banned users — which we must — turns
-- that from a path nobody can find into an advertised button on the ban
-- screen.
--
-- ── Why retain rather than refuse ───────────────────────────────────────────
--
-- Refusing deletion to banned users is not available: Apple's requirement has
-- no "unless we suspended them" clause, and it is also the wrong instinct —
-- erasure is a right, not a reward for good behaviour.
--
-- So the ban is retained, in the same shape the rest of this policy already
-- uses. `20260901033011` established the precedent and the vocabulary:
-- financial records, third-party reputation and the compliance trail are
-- ANONYMISED rather than deleted, because the platform has a legitimate
-- interest in each that outlives the person's account. `purge_user_data()`
-- already leaves `admin_audit_log.admin_id` completely untouched on exactly
-- that reasoning — "who did what to whom" is supposed to survive. A safety
-- judgment about a user is the same category, and this is the narrowest form
-- it can take:
--
--   * a SHA-256 of the lowercased email and NOTHING else identifying — no
--     name, no phone, no uuid, no address;
--   * the ban's own metadata (type, reason, expiry), which is the platform's
--     own writing, not the user's data;
--   * GDPR Art. 17(3)(e) / Art. 6(1)(f) — retention for the establishment of
--     claims and for fraud and abuse prevention. Recital 26 pseudonymisation:
--     the hash is still personal data, which is why the table is deny-all and
--     the retention is bounded (see the expiry rule below).
--
-- This does NOT make the ban stronger than it was. A banned user can already
-- sign up with a different address today and nothing stops them; there is no
-- device fingerprint and no phone-uniqueness index (`profiles` is unique on
-- `id`, `user_id`, `lower(email)` and `apple_original_transaction_id`, and on
-- nothing else). All this restores is the one enforcement the ban actually
-- had — that THIS address is spent — which deletion currently hands back.
--
-- ── Why re-apply on signup instead of refusing the signup ───────────────────
--
-- Raising inside `handle_new_user` would abort the auth INSERT, and GoTrue
-- surfaces that as "Database error saving new user": a 500 that is
-- indistinguishable from an outage, tells the person nothing, and leaves them
-- no appeal route. Instead the signup succeeds and the ban is re-applied to
-- the new profile, which lands them on /account-banned — the screen that
-- already reads `user_bans.reason` and already carries the "Contact Support"
-- appeal path. The existing BEFORE triggers from `20260824245000` then keep
-- them out of applications, jobs and messages at the data layer.
--
-- ── Expiry is honoured, and that half is not optional ───────────────────────
--
-- A 7-day suspension must not become permanent because the person deleted
-- their account inside it. `expires_at` is retained and checked at re-signup:
-- a lapsed suspension re-applies nothing and the retained row is retired.
-- Rows with no expiry are indefinite bans, which is what they were before.

-- ── 1. The retained judgment ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.retained_bans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- encode(sha256(lower(btrim(email))::bytea), 'hex'). Deliberately
  -- unpeppered: a pepper stored in the same database protects against nothing
  -- that reaching this table does not already imply, and an unpeppered digest
  -- is reproducible by `handle_new_user` without a secret to rotate.
  email_sha256  text NOT NULL,
  -- The `profiles.ban_status` value at deletion time, so re-application
  -- restores the exact state rather than flattening every ban to one kind.
  ban_status    text NOT NULL,
  ban_type      text,
  reason        text NOT NULL,
  -- NULL means indefinite. Non-NULL and in the past means the retained ban is
  -- spent; step 3 retires it rather than re-applying it.
  expires_at    timestamptz,
  retained_at   timestamptz NOT NULL DEFAULT now(),
  reapplied_at  timestamptz
);

COMMENT ON TABLE public.retained_bans IS
  'A ban that outlived the account it was written against. Holds a SHA-256 of '
  'the lowercased email and the ban''s own metadata — no name, no uuid, no '
  'other PII. Written by retain_ban_on_deletion() during account deletion, '
  'read by handle_new_user() when that address signs up again. Retention '
  'basis: GDPR Art. 17(3)(e) / Art. 6(1)(f), fraud and abuse prevention.';

-- One row per address: a second deletion of the same address updates the
-- judgment rather than stacking duplicates for handle_new_user to arbitrate.
CREATE UNIQUE INDEX IF NOT EXISTS retained_bans_email_sha256_key
  ON public.retained_bans (email_sha256);

-- Deny-all. RLS on with ZERO policies, plus the grants revoked, so neither
-- `anon` nor `authenticated` can read it through PostgREST — and a signed-in
-- user cannot probe whether an address is banned. The two functions below
-- reach it as SECURITY DEFINER, which bypasses RLS as the owner.
ALTER TABLE public.retained_bans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.retained_bans FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.retained_bans FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN
  -- A from-scratch PGlite/CI replay has no Supabase roles. Nothing to revoke.
  NULL;
END;
$$;
DO $$
BEGIN
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.retained_bans TO service_role';
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;

-- ── 2. Capture, called immediately before the purge ─────────────────────────
--
-- Deliberately NOT folded into purge_user_data(). That function is ~500 lines
-- and is CREATE OR REPLACEd wholesale by every migration that touches it;
-- adding a clause there means re-transcribing all of it, and the ordering
-- constraint here is one line long. This runs as its own step so the caller
-- can fail closed on it by name, and so `purge.steps` records whether a ban
-- was retained.
--
-- ORDERING: must run BEFORE purge_user_data(), which nulls `profiles.email`
-- in step 4e. Reading it afterwards yields NULL and the retention silently
-- becomes a no-op — the failure mode that would be invisible until somebody
-- came back. `_shared/accountPurge.ts` enforces the order and treats a
-- failure here as a stop, not a warning.
--
-- Returns the number of rows retained (0 or 1) so a null `error` can never be
-- mistaken for a write that happened.

CREATE OR REPLACE FUNCTION public.retain_ban_on_deletion(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email    text;
  v_status   text;
  v_until    timestamptz;
  v_ban      RECORD;
  v_reason   text;
  v_expires  timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'retain_ban_on_deletion: p_user_id is required';
  END IF;

  SELECT email, ban_status, auto_suspended_until
    INTO v_email, v_status, v_until
    FROM public.profiles
   WHERE user_id = p_user_id;

  -- Not banned, or already anonymised by an earlier attempt (email NULL) —
  -- nothing to retain. Both are ordinary outcomes, not failures: the vast
  -- majority of deletions are by users in good standing.
  --
  -- `final_warning` is deliberately absent from this list. It is a warning,
  -- not a restriction: it blocks nothing, `is_caller_banned()` ignores it, and
  -- carrying it across a deletion would punish someone the platform had
  -- decided not to punish.
  IF v_email IS NULL
     OR COALESCE(v_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
  THEN
    RETURN 0;
  END IF;

  -- The reason the user is shown on /account-banned, so the same words follow
  -- them back. `user_bans.reason` is `text NOT NULL` and every writer
  -- populates it, but a ban set by a direct `profiles` UPDATE with no
  -- `user_bans` row is a shape this schema permits, so fall back rather than
  -- retaining nothing.
  SELECT ban_type, reason, expires_at
    INTO v_ban
    FROM public.user_bans
   WHERE user_id = p_user_id
     AND is_active
   ORDER BY created_at DESC
   LIMIT 1;

  v_reason := COALESCE(NULLIF(btrim(v_ban.reason), ''), 'A violation of our Platform Rules.');

  -- Same precedence AccountBanned.tsx uses to tell the user when they get back
  -- in: `auto_suspended_until` governs the lift (sweep_expired_auto_bans reads
  -- only that column), `user_bans.expires_at` is the fallback for rows that
  -- predate it. A permanent ban has neither and stays indefinite.
  v_expires := CASE
    WHEN v_status = 'permanently_banned' THEN NULL
    ELSE COALESCE(v_until, v_ban.expires_at)
  END;

  -- An already-lapsed suspension is not retained at all. The hourly sweeper
  -- would have lifted it; deleting the account inside the last hour of a
  -- 7-day ban must not convert it into a permanent one.
  IF v_expires IS NOT NULL AND v_expires <= now() THEN
    RETURN 0;
  END IF;

  INSERT INTO public.retained_bans (email_sha256, ban_status, ban_type, reason, expires_at)
  VALUES (
    encode(sha256(lower(btrim(v_email))::bytea), 'hex'),
    v_status,
    v_ban.ban_type,
    v_reason,
    v_expires
  )
  ON CONFLICT (email_sha256) DO UPDATE
     SET ban_status   = EXCLUDED.ban_status,
         ban_type     = EXCLUDED.ban_type,
         reason       = EXCLUDED.reason,
         expires_at   = EXCLUDED.expires_at,
         retained_at  = now(),
         reapplied_at = NULL;

  RETURN 1;
END;
$$;

COMMENT ON FUNCTION public.retain_ban_on_deletion(uuid) IS
  'Records an active ban against a hash of the account email so it survives '
  'deletion. MUST be called before purge_user_data(), which nulls '
  'profiles.email. Returns rows retained (0 or 1).';

REVOKE ALL ON FUNCTION public.retain_ban_on_deletion(uuid) FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.retain_ban_on_deletion(uuid) FROM anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.retain_ban_on_deletion(uuid) TO service_role';
EXCEPTION WHEN undefined_object THEN
  NULL;
END;
$$;

-- ── 3. Re-application, on the way back in ───────────────────────────────────
--
-- handle_new_user() is CREATE OR REPLACEd here in full because it is short and
-- because a trigger split across two definitions is how the enum drift in
-- `admin-delete-user` happened. The first three statements below are the live
-- prod definition, read from pg_proc on 2026-09-03; the final block is new.
--
-- Everything new is inside its own BEGIN/EXCEPTION: this trigger must never be
-- the thing that fails a signup, which is the same reason the
-- notification_preferences INSERT above it carries ON CONFLICT DO NOTHING. A
-- ban that fails to re-apply is a gap; a signup that 500s is an outage.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_retained RECORD;
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );

  -- Always 'customer' — the universal "member" value. Helper-vs-customer
  -- distinction lives nowhere in the UI; capability gates (IDV, Stripe
  -- Connect) determine what each user can do, not their role.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer'::app_role);

  -- Every column takes its DEFAULT. Without this row transactional email is
  -- silently dead for the account and the push gate is skipped entirely.
  -- ON CONFLICT because this trigger must never be the thing that fails a
  -- signup.
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- A ban this address carried into a previous deletion.
  BEGIN
    IF NEW.email IS NOT NULL AND to_regclass('public.retained_bans') IS NOT NULL THEN
      SELECT * INTO v_retained
        FROM public.retained_bans
       WHERE email_sha256 = encode(sha256(lower(btrim(NEW.email))::bytea), 'hex');

      IF FOUND THEN
        IF v_retained.expires_at IS NOT NULL AND v_retained.expires_at <= now() THEN
          -- Spent. Retire it rather than leaving a lapsed judgment on file to
          -- be re-evaluated on every future signup.
          DELETE FROM public.retained_bans WHERE id = v_retained.id;
        ELSE
          UPDATE public.profiles
             SET ban_status           = v_retained.ban_status,
                 auto_suspended_until = v_retained.expires_at
           WHERE user_id = NEW.id;

          -- The row /account-banned reads to show the reason. Without it the
          -- screen falls back to "a violation of our Platform Rules" and the
          -- returning user cannot tell what happened or what to appeal.
          -- `banned_by` is NOT NULL and there is no admin acting here, so it
          -- names the account itself; the retained_bans row is the provenance.
          INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at, is_active)
          VALUES (
            NEW.id,
            COALESCE(v_retained.ban_type, v_retained.ban_status),
            v_retained.reason,
            NEW.id,
            v_retained.expires_at,
            true
          );

          UPDATE public.retained_bans
             SET reapplied_at = now()
           WHERE id = v_retained.id;
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'handle_new_user: retained-ban check failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Seeds profiles/user_roles/notification_preferences for a new auth user, and '
  're-applies any ban retained against this email address by a prior account '
  'deletion (see retained_bans). Never raises: a failure here would fail the '
  'signup.';
