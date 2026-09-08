-- A banned person signs up again with a different email address, and nothing
-- stops them.
--
-- ── What the ban actually costs today, read from prod on 2026-09-07 ─────────
--
-- `retained_bans` has exactly eight columns and the only identifying one is
-- `email_sha256` (verified against information_schema, not against the
-- migration that created it). `handle_new_user()`'s live `prosrc` matches
-- `20260903014600` verbatim: one lookup, keyed on
-- `encode(sha256(lower(btrim(NEW.email))::bytea),'hex')`, and nothing else.
-- `purge_user_data()` and `retain_ban_on_deletion()` are the only other two
-- functions in the database whose source so much as mentions the table.
--
-- So the entire enforcement surface of a permanent ban is: *that one address
-- is spent*. A free Gmail alias defeats it in thirty seconds, and the person
-- comes back with the same phone, the same face and the same driving licence.
--
-- Worse, the retention only ever runs at DELETION. A user who is banned and
-- simply walks away — never touching the delete button — leaves no
-- `retained_bans` row at all, so the ban is not even email-bound: it lives
-- only in `profiles.ban_status` on a row nobody will ever read again.
--
-- ── The two layers this adds ────────────────────────────────────────────────
--
-- 1. PHONE. Retained alongside the email, at ban time as well as at deletion,
--    and checked in `complete-signup` — which is where the phone number is
--    first known, because email/password signup puts nothing in
--    `auth.users.phone` and `handle_new_user` therefore has no phone to hash.
--    Cheap to get around (a second SIM, a burner VOIP number) but it raises
--    the floor from "type a different address" to "acquire a second phone
--    number", and it costs a legitimate user nothing.
--
-- 2. IDENTITY. Stripe Identity returns `verified_outputs` — legal first name,
--    last name, date of birth, and (when the document type provides one) the
--    document number. A fingerprint of those four is retained on ban and
--    checked when an IDV session verifies. Identity is required to work, so
--    this is the layer that actually holds: the returning user must present a
--    different government document belonging to a different person.
--
-- ── Why these columns are not a PII expansion ───────────────────────────────
--
-- Nothing here stores a phone number, a name, a birth date or a document
-- number. Each is reduced to `sha256(salt || ':' || domain || ':' || value)`
-- where the salt is a 32-byte random value held in Supabase Vault
-- (`ban_fingerprint_salt`), i.e. encrypted at rest with a key that is NOT in
-- the database. That matters because the raw inputs have small or enumerable
-- domains: an unsalted SHA-256 of a US phone number is reversible by brute
-- force in seconds (10^10 candidates), and an unsalted digest of
-- name+DOB is reversible by anyone holding a voter file. Salted with a secret
-- the database cannot itself read back in plaintext, a leaked `retained_bans`
-- dump is inert — it answers "is this the same person as some other row" only
-- for someone who already holds both the salt and the candidate value.
--
-- `email_sha256` is deliberately left UNSALTED and unchanged. It is load-
-- bearing in `handle_new_user()` against rows already on file; re-hashing it
-- would silently orphan every existing retention. Its exposure is the one
-- `20260903014600` already argued and accepted.
--
-- Retention basis is unchanged: GDPR Art. 17(3)(e) / Art. 6(1)(f), fraud and
-- abuse prevention, with the same bounded expiry — a lapsed suspension is
-- retired rather than re-applied, on every one of the three keys.
--
-- ── Replay-safety ───────────────────────────────────────────────────────────
--
-- Every statement is guarded: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS, CREATE OR REPLACE, and the Supabase-only objects (roles, vault) sit
-- behind existence checks so a from-scratch PGlite replay applies cleanly
-- three times running. Proven, not asserted — see the probe committed with
-- this change.

-- ── 1. The salt ─────────────────────────────────────────────────────────────
--
-- Created once, never rotated in place: rotating it invalidates every hash on
-- file, which is a deliberate operation (it un-bans everyone previously
-- fingerprinted), not something a migration replay should do by accident.

DO $$
DECLARE
  v_exists boolean;
BEGIN
  IF to_regprocedure('vault.create_secret(text,text,text)') IS NULL THEN
    -- PGlite / CI replay: no vault extension. ban_fingerprint_salt() falls
    -- back to its documented constant below.
    RETURN;
  END IF;

  EXECUTE 'SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = $1)'
    INTO v_exists USING 'ban_fingerprint_salt';

  IF NOT v_exists THEN
    EXECUTE 'SELECT vault.create_secret($1, $2, $3)'
      USING encode(gen_random_bytes(32), 'hex'),
            'ban_fingerprint_salt',
            'Peppers retained_bans.phone_sha256 / identity_sha256 and '
            'profiles.identity_sha256. Rotating this un-bans every '
            'fingerprinted account — treat as permanent.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'ban_fingerprint_salt: could not create vault secret (%)', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.ban_fingerprint_salt()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'pg_temp'
AS $$
DECLARE
  v_salt text;
BEGIN
  BEGIN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_salt USING 'ban_fingerprint_salt';
  EXCEPTION WHEN OTHERS THEN
    v_salt := NULL;
  END;

  IF v_salt IS NULL OR btrim(v_salt) = '' THEN
    -- A replay environment with no vault. Returning a constant keeps the
    -- fingerprint FUNCTIONS testable; it does not weaken prod, where the
    -- secret exists. Loud, because a prod fall-through here would mean every
    -- fingerprint written from now on is unsalted and mismatches the ones
    -- already on file.
    RAISE NOTICE 'ban_fingerprint_salt: vault secret unavailable — using replay constant';
    RETURN 'lh-ban-fingerprint-replay-salt-v1';
  END IF;

  RETURN v_salt;
END;
$$;

COMMENT ON FUNCTION public.ban_fingerprint_salt() IS
  'The pepper for retained-ban fingerprints, from Vault. Never rotate: every '
  'stored hash is keyed on it.';

REVOKE ALL ON FUNCTION public.ban_fingerprint_salt() FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.ban_fingerprint_salt() FROM anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 2. Normalisation and hashing ────────────────────────────────────────────

-- Digits only, US country code stripped, so "(337) 555-0134",
-- "+1 337-555-0134" and "13375550134" all fingerprint identically. Returns
-- NULL for anything too short to be a real number rather than hashing a
-- fragment — a 3-digit "phone" that matched a retained ban would lock out an
-- innocent person.
CREATE OR REPLACE FUNCTION public.normalize_phone_for_ban(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN d IS NULL THEN NULL
    WHEN length(d) = 11 AND left(d, 1) = '1' THEN right(d, 10)
    WHEN length(d) BETWEEN 7 AND 15 THEN d
    ELSE NULL
  END
  FROM (SELECT NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '') AS d) s;
$$;

COMMENT ON FUNCTION public.normalize_phone_for_ban(text) IS
  'Digits-only phone with a leading US 1 stripped; NULL when too short to be '
  'a real number. The canonical form fingerprinted into retained_bans.';

-- sha256(salt || ':' || domain || ':' || value). The domain separator stops a
-- phone hash from ever colliding with an identity hash, which matters because
-- both live in the same table and either one alone re-applies a ban.
CREATE OR REPLACE FUNCTION public.ban_fingerprint(p_domain text, p_value text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' OR p_domain IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(
    sha256((public.ban_fingerprint_salt() || ':' || p_domain || ':' || btrim(p_value))::bytea),
    'hex'
  );
END;
$$;

COMMENT ON FUNCTION public.ban_fingerprint(text, text) IS
  'Salted, domain-separated SHA-256 for retained-ban keys. Not reversible '
  'without the Vault salt, which is why phone and identity may be retained at '
  'all.';

-- The identity fingerprint. Built from Stripe Identity `verified_outputs`:
-- legal first + last name, date of birth, and the document number when the
-- document type carries one. Names are case- and whitespace-normalised;
-- the document number is upper-cased and stripped of separators, because
-- Stripe returns the same licence as "A1234567" and "A-1234567" across
-- document types.
--
-- The document number participates only when present. Two rows for the same
-- human — one fingerprinted with a document number, one without — will NOT
-- match each other, which is the conservative direction: this function is
-- allowed to miss a repeat offender, it is never allowed to ban a stranger.
CREATE OR REPLACE FUNCTION public.identity_fingerprint(
  p_first_name  text,
  p_last_name   text,
  p_dob         text,
  p_doc_number  text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_first text := lower(btrim(COALESCE(p_first_name, '')));
  v_last  text := lower(btrim(COALESCE(p_last_name, '')));
  v_dob   text := btrim(COALESCE(p_dob, ''));
  v_doc   text := upper(regexp_replace(COALESCE(p_doc_number, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  -- Name + DOB is the minimum that identifies a person. Anything less and the
  -- fingerprint would collide across unrelated people.
  IF v_first = '' OR v_last = '' OR v_dob = '' THEN
    RETURN NULL;
  END IF;
  RETURN public.ban_fingerprint('identity', v_first || '|' || v_last || '|' || v_dob || '|' || v_doc);
END;
$$;

COMMENT ON FUNCTION public.identity_fingerprint(text, text, text, text) IS
  'Salted hash of Stripe Identity verified_outputs (first, last, DOB, document '
  'number). NULL unless name and DOB are all present.';

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.normalize_phone_for_ban(text) FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION public.ban_fingerprint(text, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.identity_fingerprint(text, text, text, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ban_fingerprint(text, text) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.identity_fingerprint(text, text, text, text) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_phone_for_ban(text) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ban_fingerprint_salt() TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 3. The retained columns ─────────────────────────────────────────────────

ALTER TABLE public.retained_bans
  ADD COLUMN IF NOT EXISTS phone_sha256    text,
  ADD COLUMN IF NOT EXISTS identity_sha256 text,
  -- 'deletion' | 'ban'. Which event put this row here, so an operator reading
  -- the table can tell a ban that was retained pre-emptively from one that
  -- was rescued out of a purge.
  ADD COLUMN IF NOT EXISTS retained_via    text;

COMMENT ON COLUMN public.retained_bans.phone_sha256 IS
  'ban_fingerprint(''phone'', normalize_phone_for_ban(profiles.phone)). Salted '
  'with the Vault secret — not brute-forceable from a table dump the way an '
  'unsalted phone digest would be.';
COMMENT ON COLUMN public.retained_bans.identity_sha256 IS
  'identity_fingerprint() over Stripe Identity verified_outputs. Salted. The '
  'layer a new email and a new SIM do not defeat.';

-- Partial uniques: many rows legitimately have no phone and no identity on
-- file, and NULLs must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS retained_bans_phone_sha256_key
  ON public.retained_bans (phone_sha256) WHERE phone_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS retained_bans_identity_sha256_key
  ON public.retained_bans (identity_sha256) WHERE identity_sha256 IS NOT NULL;

-- Where the identity fingerprint is carried while the account is alive, so
-- that ban-time retention has something to copy. Written once, by
-- stripe-idv-webhook, at the moment the session verifies.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identity_sha256 text;

COMMENT ON COLUMN public.profiles.identity_sha256 IS
  'Salted fingerprint of the Stripe Identity verified_outputs this account was '
  'approved on. Not reversible without the Vault salt; holds no name, DOB or '
  'document number. Copied into retained_bans when the account is banned.';

CREATE INDEX IF NOT EXISTS profiles_identity_sha256_idx
  ON public.profiles (identity_sha256) WHERE identity_sha256 IS NOT NULL;

-- ── 4. Retention, now reachable from both events ────────────────────────────
--
-- One body, two callers: the deletion path (which must run BEFORE
-- purge_user_data() nulls the email — unchanged) and a new AFTER trigger on
-- the ban itself. Retaining at ban time is the half that was missing entirely:
-- a banned user who never deletes their account left nothing on file at all.
--
-- Returns rows retained (0 or 1) so a null `error` can never be mistaken for a
-- write that happened.

CREATE OR REPLACE FUNCTION public.retain_ban_for_user(p_user_id uuid, p_via text DEFAULT 'ban')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_email    text;
  v_phone    text;
  v_ident    text;
  v_status   text;
  v_until    timestamptz;
  v_ban      RECORD;
  v_reason   text;
  v_expires  timestamptz;
  v_phone_h  text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'retain_ban_for_user: p_user_id is required';
  END IF;

  SELECT email, phone, identity_sha256, ban_status, auto_suspended_until
    INTO v_email, v_phone, v_ident, v_status, v_until
    FROM public.profiles
   WHERE user_id = p_user_id;

  -- Not banned, or already anonymised (email NULL) — nothing to retain. Both
  -- are ordinary outcomes. `final_warning` stays deliberately absent: it is a
  -- warning, not a restriction, and `is_caller_banned()` ignores it.
  IF v_email IS NULL
     OR COALESCE(v_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
  THEN
    RETURN 0;
  END IF;

  SELECT ban_type, reason, expires_at
    INTO v_ban
    FROM public.user_bans
   WHERE user_id = p_user_id
     AND is_active
   ORDER BY created_at DESC
   LIMIT 1;

  v_reason := COALESCE(NULLIF(btrim(v_ban.reason), ''), 'A violation of our Platform Rules.');

  v_expires := CASE
    WHEN v_status = 'permanently_banned' THEN NULL
    ELSE COALESCE(v_until, v_ban.expires_at)
  END;

  -- An already-lapsed suspension is not retained at all.
  IF v_expires IS NOT NULL AND v_expires <= now() THEN
    RETURN 0;
  END IF;

  v_phone_h := public.ban_fingerprint('phone', public.normalize_phone_for_ban(v_phone));

  -- A phone or identity hash already claimed by a DIFFERENT retained row would
  -- violate the partial uniques and abort the caller. That happens when two
  -- accounts shared a number; the newer judgment wins and the older row gives
  -- the key up, rather than the whole retention failing.
  IF v_phone_h IS NOT NULL THEN
    UPDATE public.retained_bans SET phone_sha256 = NULL
     WHERE phone_sha256 = v_phone_h
       AND email_sha256 IS DISTINCT FROM encode(sha256(lower(btrim(v_email))::bytea), 'hex');
  END IF;
  IF v_ident IS NOT NULL THEN
    UPDATE public.retained_bans SET identity_sha256 = NULL
     WHERE identity_sha256 = v_ident
       AND email_sha256 IS DISTINCT FROM encode(sha256(lower(btrim(v_email))::bytea), 'hex');
  END IF;

  INSERT INTO public.retained_bans (
    email_sha256, phone_sha256, identity_sha256, ban_status, ban_type, reason, expires_at, retained_via
  )
  VALUES (
    encode(sha256(lower(btrim(v_email))::bytea), 'hex'),
    v_phone_h,
    v_ident,
    v_status,
    v_ban.ban_type,
    v_reason,
    v_expires,
    COALESCE(p_via, 'ban')
  )
  ON CONFLICT (email_sha256) DO UPDATE
     SET ban_status      = EXCLUDED.ban_status,
         ban_type        = EXCLUDED.ban_type,
         reason          = EXCLUDED.reason,
         expires_at      = EXCLUDED.expires_at,
         -- COALESCE, not EXCLUDED: a re-retention that happens after the
         -- profile was anonymised must not erase a phone or identity key that
         -- an earlier retention captured while the data was still there.
         phone_sha256    = COALESCE(EXCLUDED.phone_sha256, public.retained_bans.phone_sha256),
         identity_sha256 = COALESCE(EXCLUDED.identity_sha256, public.retained_bans.identity_sha256),
         retained_via    = EXCLUDED.retained_via,
         retained_at     = now(),
         reapplied_at    = NULL;

  RETURN 1;
END;
$$;

COMMENT ON FUNCTION public.retain_ban_for_user(uuid, text) IS
  'Records an active ban against salted hashes of the account email, phone and '
  'Stripe Identity fingerprint so it survives both deletion and a fresh signup '
  'from a new address. Returns rows retained (0 or 1).';

-- The deletion caller keeps its name and signature — `_shared/accountPurge.ts`
-- calls it by name and treats a failure as a stop — and now delegates.
CREATE OR REPLACE FUNCTION public.retain_ban_on_deletion(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN public.retain_ban_for_user(p_user_id, 'deletion');
END;
$$;

COMMENT ON FUNCTION public.retain_ban_on_deletion(uuid) IS
  'Deletion-time wrapper over retain_ban_for_user(). MUST be called before '
  'purge_user_data(), which nulls profiles.email. Returns rows retained (0/1).';

-- Retention at BAN time. An AFTER trigger rather than an edit to
-- admin-user-actions, because a ban is written from four places (the strike
-- ladder, the message-scanner review, the admin ban action, and direct
-- `profiles` UPDATEs) and a retention that only covers one of them is the same
-- silent gap this migration exists to close.
--
-- Never raises: a failure here must not roll back the ban itself.
CREATE OR REPLACE FUNCTION public.retain_ban_on_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF COALESCE(NEW.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status IS DISTINCT FROM OLD.ban_status
          OR NEW.auto_suspended_until IS DISTINCT FROM OLD.auto_suspended_until)
  THEN
    BEGIN
      PERFORM public.retain_ban_for_user(NEW.user_id, 'ban');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'retain_ban_on_ban: retention failed for %: %', NEW.user_id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_retain_ban_on_ban ON public.profiles;
CREATE TRIGGER trg_retain_ban_on_ban
  AFTER UPDATE OF ban_status, auto_suspended_until ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.retain_ban_on_ban();

-- ── 5. Enforcement, on every key ────────────────────────────────────────────
--
-- One entry point for all three checks. Callers:
--   · handle_new_user()      — email, at auth.users INSERT
--   · complete-signup        — email + phone, where the phone is first known
--   · stripe-idv-webhook     — identity fingerprint, at the moment it verifies
--
-- Applies the retained judgment to the named account (so the person lands on
-- /account-banned with the original reason and appeal route, exactly as the
-- email path already did) and reports it back, so an edge caller can also
-- refuse the action outright.
--
-- Lapsed rows are retired on sight, on whichever key matched.

CREATE OR REPLACE FUNCTION public.enforce_retained_ban(
  p_user_id         uuid,
  p_email           text DEFAULT NULL,
  p_phone           text DEFAULT NULL,
  p_identity_sha256 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_email_h text := CASE WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
                    ELSE encode(sha256(lower(btrim(p_email))::bytea), 'hex') END;
  v_phone_h text := public.ban_fingerprint('phone', public.normalize_phone_for_ban(p_phone));
  v_ident_h text := NULLIF(btrim(COALESCE(p_identity_sha256, '')), '');
  v_row     RECORD;
  v_matched text;
BEGIN
  IF v_email_h IS NULL AND v_phone_h IS NULL AND v_ident_h IS NULL THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  SELECT * INTO v_row
    FROM public.retained_bans
   WHERE (v_email_h IS NOT NULL AND email_sha256    = v_email_h)
      OR (v_phone_h IS NOT NULL AND phone_sha256    = v_phone_h)
      OR (v_ident_h IS NOT NULL AND identity_sha256 = v_ident_h)
   -- Prefer the strongest evidence when more than one row could match: an
   -- identity is a person, a phone is a device, an address is a login.
   ORDER BY (identity_sha256 IS NOT NULL AND identity_sha256 = v_ident_h) DESC,
            (phone_sha256    IS NOT NULL AND phone_sha256    = v_phone_h) DESC,
            retained_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  -- Spent. Retire rather than leaving a lapsed judgment to be re-evaluated on
  -- every future signup.
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
  END IF;

  v_matched := CASE
    WHEN v_ident_h IS NOT NULL AND v_row.identity_sha256 = v_ident_h THEN 'identity'
    WHEN v_phone_h IS NOT NULL AND v_row.phone_sha256    = v_phone_h THEN 'phone'
    ELSE 'email'
  END;

  IF p_user_id IS NOT NULL THEN
    UPDATE public.profiles
       SET ban_status           = v_row.ban_status,
           auto_suspended_until = v_row.expires_at
     WHERE user_id = p_user_id;

    -- The row /account-banned reads to show the reason. Without it the screen
    -- falls back to generic wording and the returning user cannot tell what
    -- happened or what to appeal. `banned_by` is NOT NULL and no admin is
    -- acting here, so it names the account itself.
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at, is_active)
    SELECT p_user_id,
           COALESCE(v_row.ban_type, v_row.ban_status),
           v_row.reason,
           p_user_id,
           v_row.expires_at,
           true
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_bans
        WHERE user_id = p_user_id AND is_active
          AND reason = v_row.reason
     );
  END IF;

  UPDATE public.retained_bans SET reapplied_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'banned',     true,
    'matched_on', v_matched,
    'ban_status', v_row.ban_status,
    'reason',     v_row.reason,
    'expires_at', v_row.expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) IS
  'Looks a signup up against every retained-ban key (email, phone, Stripe '
  'Identity fingerprint), re-applies the judgment to the given account, and '
  'reports which key matched so the caller can also refuse the action.';

REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC;
DO $$
BEGIN
  -- Named explicitly: REVOKE ... FROM PUBLIC does NOT revoke anon, which
  -- Supabase grants individually via ALTER DEFAULT PRIVILEGES.
  EXECUTE 'REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.retain_ban_for_user(uuid, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.retain_ban_on_ban() FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.retain_ban_for_user(uuid, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 6. handle_new_user delegates its email check ────────────────────────────
--
-- Behaviour on the email key is unchanged; the lookup body moves into
-- enforce_retained_ban so the three callers cannot drift apart. Re-applying
-- rather than raising is still deliberate: raising here aborts the auth INSERT
-- and GoTrue surfaces it as "Database error saving new user" — a 500 that
-- tells the person nothing and offers no appeal.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  -- A ban this address — or this phone, for a provider that supplies one —
  -- carried out of a previous account. Email/password signup leaves
  -- NEW.phone NULL, which is why complete-signup runs the phone check again
  -- once it actually has the number.
  BEGIN
    IF to_regprocedure('public.enforce_retained_ban(uuid,text,text,text)') IS NOT NULL THEN
      PERFORM public.enforce_retained_ban(NEW.id, NEW.email, NEW.phone, NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'handle_new_user: retained-ban check failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Seeds profiles/user_roles/notification_preferences for a new auth user, and '
  're-applies any ban retained against this email or phone by a prior account '
  '(see retained_bans / enforce_retained_ban). Never raises: a failure here '
  'would fail the signup.';

-- ── 7. Backfill: bans that are live right now ───────────────────────────────
--
-- Zero rows on prod today (`count(*) WHERE ban_status IN (...)` = 0 on
-- 2026-09-07), so this is a no-op there. It exists so the trigger's "at ban
-- time" guarantee is not silently false for anyone banned before this
-- deployed.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT user_id FROM public.profiles
     WHERE ban_status IN ('banned', 'temp_banned', 'permanently_banned')
  LOOP
    BEGIN
      PERFORM public.retain_ban_for_user(r.user_id, 'ban');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'retained-ban backfill skipped %: %', r.user_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
