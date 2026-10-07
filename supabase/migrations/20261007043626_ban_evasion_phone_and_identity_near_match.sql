-- Q1416 (docs/OPEN.md; owner 2026-10-07 for (b)): two more ban-evasion
-- NEAR-match soft signals. Owner rule (2026-10-05): a near-match only raises an
-- admin doubt-check row (ban_evasion_matches, admin-only), never a ban.
--
-- (a) ID near-match. identity_fingerprint() folds the document number in, so
--     the same name + date of birth with a different (or no) document matched
--     nothing. stripe-idv-webhook now also computes the document-free hash
--     identity_fingerprint(first, last, dob, NULL) and hands it to
--     flag_possible_ban_evasion_by_identity(), which stores it server-side
--     (identity_soft_fingerprints, never exported, never readable by a
--     client) and flags a match against a retained ban's document-free hash
--     whose full identity hash differs (an exact match already auto-bans in
--     enforce_retained_ban).
-- (b) Phone near-match, defined by the owner 2026-10-07: the same LAST 7
--     DIGITS after normalising (digits only). A profile insert or phone change
--     whose last-7 hash matches a live retained ban's, where the full phone
--     hash differs (an exact phone already auto-bans), gets a 'phone_near'
--     doubt-check row.
-- retain_ban_for_user (restated from its newest definition, 20261006014801,
-- md5(prosrc) live 6fc2e076dbcd9de1828cc79ce0f07848, ACL service_role) also
-- keeps both soft keys on the retained ban.
--
-- Backfill: the 41 retained rows with a phone hash were written before the
-- last-7 key existed; rows whose banned profile still carries a phone get it
-- now (a hash cannot be re-derived from a hash, so a deleted account's row
-- keeps only its exact key).
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP-then-ADD constraint
-- with the same name; grants restated (service_role only for every function,
-- the table server-only).

-- ── 1. The soft keys on a retained ban ──────────────────────────────────────
ALTER TABLE public.retained_bans ADD COLUMN IF NOT EXISTS phone7_sha256 text;
ALTER TABLE public.retained_bans ADD COLUMN IF NOT EXISTS identity_nodoc_sha256 text;
CREATE INDEX IF NOT EXISTS retained_bans_phone7_idx ON public.retained_bans (phone7_sha256) WHERE phone7_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS retained_bans_identity_nodoc_idx ON public.retained_bans (identity_nodoc_sha256) WHERE identity_nodoc_sha256 IS NOT NULL;

-- ── 2. The live account's document-free identity hash (server-only) ─────────
CREATE TABLE IF NOT EXISTS public.identity_soft_fingerprints (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nodoc_sha256 text NOT NULL CHECK (nodoc_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.identity_soft_fingerprints IS
  'Q1416: identity_fingerprint(first, last, dob, NULL) per verified person: a salted '
  'hash, no name or date. Copied into retained_bans when the person is banned; '
  'matched only as an admin doubt-check (never a ban). Server-only.';
ALTER TABLE public.identity_soft_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.identity_soft_fingerprints FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.identity_soft_fingerprints FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT ALL ON TABLE public.identity_soft_fingerprints TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 3. The two new doubt-check kinds ───────────────────────────────────────
ALTER TABLE public.ban_evasion_matches DROP CONSTRAINT IF EXISTS ban_evasion_matches_matched_on_check;
ALTER TABLE public.ban_evasion_matches ADD CONSTRAINT ban_evasion_matches_matched_on_check
  CHECK (matched_on = ANY (ARRAY['card', 'bank', 'name', 'email', 'phone', 'identity', 'phone_near', 'identity_near']));

-- ── 4. Last-7-digits normaliser ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.normalize_phone7_for_ban(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  -- Digits only; the last 7 when there are at least 7 (owner 2026-10-07:
  -- "same last 7 digits after normalizing"). Fewer than 7 is no key.
  SELECT CASE WHEN length(d) >= 7 THEN right(d, 7) ELSE NULL END
    FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS d) s;
$$;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.normalize_phone7_for_ban(text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_phone7_for_ban(text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 5. retain_ban_for_user keeps the soft keys ──────────────────────────────
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
  v_name     text;
  v_status   text;
  v_until    timestamptz;
  v_ban      RECORD;
  v_reason   text;
  v_expires  timestamptz;
  v_phone_h  text;
  v_phone7_h text;
  v_nodoc_h  text;
  v_name_h   text;
  v_cards    text[];
  v_banks    text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'retain_ban_for_user: p_user_id is required';
  END IF;

  SELECT email, phone, identity_sha256, full_name, ban_status, auto_suspended_until
    INTO v_email, v_phone, v_ident, v_name, v_status, v_until
    FROM public.profiles
   WHERE user_id = p_user_id;

  -- Not banned, or already anonymised (email NULL): nothing to retain.
  -- final_warning is a warning, not a restriction.
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
  v_name_h  := public.ban_fingerprint('name', public.normalize_name_for_ban(v_name));
  -- Q1416: the soft (doubt-check) keys. Never unique, never a ban on their own.
  v_phone7_h := public.ban_fingerprint('phone7', public.normalize_phone7_for_ban(v_phone));
  SELECT f.nodoc_sha256 INTO v_nodoc_h
    FROM public.identity_soft_fingerprints f
   WHERE f.user_id = p_user_id;

  -- Q1324: every card that paid and every payout account attached.
  SELECT COALESCE(array_agg(fingerprint_sha256 ORDER BY fingerprint_sha256)
                    FILTER (WHERE fingerprint_kind = 'card'), '{}'::text[]),
         COALESCE(array_agg(fingerprint_sha256 ORDER BY fingerprint_sha256)
                    FILTER (WHERE fingerprint_kind = 'bank'), '{}'::text[])
    INTO v_cards, v_banks
    FROM public.payment_fingerprints
   WHERE user_id = p_user_id;

  -- A phone or identity hash already claimed by a DIFFERENT retained row would
  -- violate the partial uniques and abort the caller; the newer judgment wins.
  -- (Cards, banks and names have no unique index: two banned accounts may
  -- share one, and either still matches.)
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
    email_sha256, phone_sha256, identity_sha256, card_sha256, bank_sha256, name_sha256,
    phone7_sha256, identity_nodoc_sha256,
    ban_status, ban_type, reason, expires_at, retained_via
  )
  VALUES (
    encode(sha256(lower(btrim(v_email))::bytea), 'hex'),
    v_phone_h,
    v_ident,
    v_cards,
    v_banks,
    v_name_h,
    v_phone7_h,
    v_nodoc_h,
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
         -- COALESCE / union, not EXCLUDED: a re-retention after the profile was
         -- anonymised must not erase a key an earlier retention captured.
         phone_sha256    = COALESCE(EXCLUDED.phone_sha256, public.retained_bans.phone_sha256),
         identity_sha256 = COALESCE(EXCLUDED.identity_sha256, public.retained_bans.identity_sha256),
         name_sha256     = COALESCE(EXCLUDED.name_sha256, public.retained_bans.name_sha256),
         phone7_sha256   = COALESCE(EXCLUDED.phone7_sha256, public.retained_bans.phone7_sha256),
         identity_nodoc_sha256 = COALESCE(EXCLUDED.identity_nodoc_sha256, public.retained_bans.identity_nodoc_sha256),
         card_sha256     = ARRAY(SELECT DISTINCT u FROM unnest(public.retained_bans.card_sha256 || EXCLUDED.card_sha256) u ORDER BY u),
         bank_sha256     = ARRAY(SELECT DISTINCT u FROM unnest(public.retained_bans.bank_sha256 || EXCLUDED.bank_sha256) u ORDER BY u),
         retained_via    = EXCLUDED.retained_via,
         retained_at     = now(),
         reapplied_at    = NULL;

  RETURN 1;
END;
$$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.retain_ban_for_user(uuid, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.retain_ban_for_user(uuid, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 6. (b) the phone near-match flag ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.flag_possible_ban_evasion_by_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_h7    text;
  v_full  text;
  v_own_h text;
  v_row   RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NULL;
  END IF;
  -- Already banned: there is nothing for an admin to doubt-check.
  IF COALESCE(NEW.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned') THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_h7 := public.ban_fingerprint('phone7', public.normalize_phone7_for_ban(NEW.phone));
    IF v_h7 IS NULL THEN
      RETURN NULL;
    END IF;
    v_full := public.ban_fingerprint('phone', public.normalize_phone_for_ban(NEW.phone));
    v_own_h := CASE WHEN NEW.email IS NULL OR btrim(NEW.email) = '' THEN NULL
                    ELSE encode(sha256(lower(btrim(NEW.email))::bytea), 'hex') END;

    -- The full key too on UPDATE: 40 of the 41 phone bans retained before
    -- this migration belong to deleted accounts and can never get a last-7
    -- key (lh-authz-rls re-review), but their exact number is on file.
    SELECT * INTO v_row
      FROM public.retained_bans
     WHERE (phone7_sha256 = v_h7 OR (TG_OP = 'UPDATE' AND phone_sha256 = v_full))
       AND (expires_at IS NULL OR expires_at > now())
       AND email_sha256 IS DISTINCT FROM v_own_h
       -- At signup the same full number is an EXACT match that
       -- handle_new_user / complete-signup already ban (enforce_retained_ban).
       -- A phone CHANGED later is enforced by nobody (lh-authz-rls review of
       -- Q1416), so on UPDATE the exact number is flagged too.
       AND (TG_OP = 'UPDATE' OR phone_sha256 IS DISTINCT FROM v_full)
     -- The exact number first, so it is filed as 'phone' even when a newer
     -- ban shares only the last 7 digits (lh-authz-rls re-check, nit 1).
     ORDER BY (phone_sha256 IS NOT DISTINCT FROM v_full) DESC, retained_at DESC
     LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.ban_evasion_matches (
        user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
        original_recorded_at, original_expires_at, auto_banned
      )
      -- The exact number is the stronger signal: filed as 'phone' (not
      -- auto-banned), a last-7 match as 'phone_near'.
      VALUES (NEW.user_id,
              CASE WHEN v_row.phone_sha256 = v_full THEN 'phone' ELSE 'phone_near' END,
              CASE WHEN v_row.phone_sha256 = v_full THEN v_full ELSE v_h7 END,
              v_row.id, v_row.ban_status, v_row.reason,
              v_row.retained_at, v_row.expires_at, false)
      ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A soft signal never fails the signup or the profile edit, and is never
    -- skipped silently: ops reads error_logs.
    RAISE WARNING 'flag_possible_ban_evasion_by_phone: check failed for %: %', NEW.user_id, SQLERRM;
    BEGIN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Q1416 phone doubt-check did not run for account %s: %s', NEW.user_id, SQLERRM),
        jsonb_build_object('source', 'flag_possible_ban_evasion_by_phone', 'origin', 'server'),
        jsonb_build_object('user_id', NEW.user_id)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'flag_possible_ban_evasion_by_phone: error_logs write failed too: %', SQLERRM;
    END;
  END;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.flag_possible_ban_evasion_by_phone() IS
  'Q1416 (b): a profile whose phone shares its last 7 digits with a live retained ban '
  '(and is not the same full number) gets one admin-only ban_evasion_matches row '
  '(matched_on phone_near). Soft signal: never bans, never raises.';

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.flag_possible_ban_evasion_by_phone() FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_possible_ban_evasion_by_phone ON public.profiles;
CREATE TRIGGER trg_flag_possible_ban_evasion_by_phone
  AFTER INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.flag_possible_ban_evasion_by_phone();

-- ── 7. (a) the ID near-match, from stripe-idv-webhook ───────────────────────
CREATE OR REPLACE FUNCTION public.flag_possible_ban_evasion_by_identity(p_user_id uuid, p_nodoc_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status text;
  v_ident  text;
  v_email  text;
  v_own_h  text;
  v_row    RECORD;
BEGIN
  IF p_user_id IS NULL OR p_nodoc_sha256 IS NULL OR p_nodoc_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('flagged', false, 'reason', 'no_key');
  END IF;

  -- Kept for retain_ban_for_user, whatever this account's standing.
  INSERT INTO public.identity_soft_fingerprints (user_id, nodoc_sha256, updated_at)
  VALUES (p_user_id, p_nodoc_sha256, now())
  ON CONFLICT (user_id) DO UPDATE SET nodoc_sha256 = EXCLUDED.nodoc_sha256, updated_at = now();

  SELECT ban_status, identity_sha256, email INTO v_status, v_ident, v_email
    FROM public.profiles WHERE user_id = p_user_id;
  v_own_h := CASE WHEN v_email IS NULL OR btrim(v_email) = '' THEN NULL
                  ELSE encode(sha256(lower(btrim(v_email))::bytea), 'hex') END;
  IF COALESCE(v_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned') THEN
    -- An ID check finished after the ban was retained: keep its key on that
    -- retained ban too (lh-authz-rls review of Q1416).
    IF v_own_h IS NOT NULL THEN
      UPDATE public.retained_bans
         SET identity_nodoc_sha256 = p_nodoc_sha256
       WHERE email_sha256 = v_own_h AND identity_nodoc_sha256 IS NULL;
    END IF;
    RETURN jsonb_build_object('flagged', false, 'reason', 'already_banned');
  END IF;

  SELECT * INTO v_row
    FROM public.retained_bans
   -- A ban retained before this migration has no document-free key, but one
   -- whose ID carried no document number hashed to exactly this value.
   WHERE (identity_nodoc_sha256 = p_nodoc_sha256 OR identity_sha256 = p_nodoc_sha256)
     AND (expires_at IS NULL OR expires_at > now())
     AND email_sha256 IS DISTINCT FROM v_own_h
     -- An EXACT identity match never reaches here: stripe-idv-webhook runs
     -- enforce_retained_ban on the full identity first and returns on a ban.
     -- This clause only keeps a profile whose stored identity already equals
     -- the retained one (a re-verification) from flagging itself.
     AND identity_sha256 IS DISTINCT FROM v_ident
   ORDER BY retained_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('flagged', false);
  END IF;

  INSERT INTO public.ban_evasion_matches (
    user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
    original_recorded_at, original_expires_at, auto_banned
  )
  VALUES (p_user_id, 'identity_near', p_nodoc_sha256, v_row.id, v_row.ban_status, v_row.reason,
          v_row.retained_at, v_row.expires_at, false)
  ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;
  RETURN jsonb_build_object('flagged', true);
END;
$$;

COMMENT ON FUNCTION public.flag_possible_ban_evasion_by_identity(uuid, text) IS
  'Q1416 (a): stores the document-free identity hash and flags (admin-only, never a ban) '
  'a match against a live retained ban whose full identity differs. Called by stripe-idv-webhook.';

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.flag_possible_ban_evasion_by_identity(uuid, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.flag_possible_ban_evasion_by_identity(uuid, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── 8. Backfill the last-7 key where the banned profile still has a phone ───
UPDATE public.retained_bans r
   SET phone7_sha256 = public.ban_fingerprint('phone7', public.normalize_phone7_for_ban(p.phone))
  FROM public.profiles p
 WHERE r.phone7_sha256 IS NULL
   AND p.email IS NOT NULL
   AND p.phone IS NOT NULL
   AND r.email_sha256 = encode(sha256(lower(btrim(p.email))::bytea), 'hex');
