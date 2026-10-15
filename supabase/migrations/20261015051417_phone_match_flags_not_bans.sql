-- Q1714 (owner decision 2026-10-15, pop-up via the lead: "JUST FLAG IT"):
-- a phone matching a banned account's flags the account for an admin's
-- second look. It never bans, and no SMS check is built.
--
-- Why: phones are typed, never confirmed by SMS (lh-authz-rls review of
-- lane3/q1586, finding lh-authz-rls@d1438994d#1). A member who saved someone
-- else's real number and was then banned left that number in retained_bans;
-- when its real owner later added it (sign-up, or any profile phone change
-- since Q1586) they were banned at once.
--
-- Changes (each restates the newest definition and its grants):
--   1. enforce_retained_ban (newest: 20261012065930) bans on the email and a
--      verified Stripe Identity fingerprint only. An exact phone match files
--      a doubt-check (ban_evasion_matches, auto_banned false) and answers
--      banned=false, matched_on 'phone', flagged=true. complete-signup and
--      handle_new_user therefore no longer refuse or ban on a phone.
--   2. The phone-change auto-ban (20261012042748: trigger
--      trg_retained_ban_on_phone_change and its function
--      enforce_retained_ban_on_phone) is dropped.
--   3. flag_possible_ban_evasion_by_phone (newest: 20261007043626) files the
--      exact number on INSERT too (it skipped it because sign-up banned it),
--      and skips test accounts (is_seed), as the dropped auto-ban did.
--   4. The test accounts' unresolved phone doubt-checks are resolved.
-- lh-authz-rls review of the first draft (b37cf6db0), folded in: the phone
-- is hashed inside the guarded block (a salt error never stops an email or
-- identity ban); an expired email/identity row is retired and the phone is
-- still checked; test accounts are skipped on both paths.
-- Nothing to undo: no account was ever banned by a phone match (measured on
-- prod 2026-10-15: 0 ban_evasion_matches rows matched_on 'phone' with
-- auto_banned true; 46 phone doubt-checks; 69 live retained phone bans).
--
-- Proof: src/test/pglite/phoneMatchFlagsNotBans.pglite.mjs (applied 3x).

-- ── 1. enforce_retained_ban: phone flags, never bans ─────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_retained_ban(p_user_id uuid, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_identity_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email_h text := CASE WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
                    ELSE encode(sha256(lower(btrim(p_email))::bytea), 'hex') END;
  -- Q1714: hashed inside the guarded doubt-check block below, so a missing
  -- salt there never stops the email or identity ban (lh-authz-rls review #1).
  v_phone_h text;
  v_retired boolean := false;
  v_found   boolean;
  v_ident_h text := NULLIF(btrim(COALESCE(p_identity_sha256, '')), '');
  v_row     RECORD;
  v_matched text;
  v_attempt text;
  v_cur_status text;
  v_cur_until  timestamptz;
  v_cur_rank   int;
  v_new_rank   int;
  v_own_reason CONSTANT text :=
    'This account is linked to an account closed for breaking our Platform Rules. '
    || 'Contact support if you think this is a mistake.';
BEGIN
  IF v_email_h IS NULL AND NULLIF(btrim(COALESCE(p_phone, '')), '') IS NULL AND v_ident_h IS NULL THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  -- Q1714 (owner 2026-10-15, "just flag it"): a phone is typed, never
  -- confirmed by SMS, so it is not a ban key. Only the email and a verified
  -- Stripe Identity fingerprint ban; an exact phone match is filed for an
  -- admin's second look below and bans nobody.
  SELECT * INTO v_row
    FROM public.retained_bans
   WHERE (v_email_h IS NOT NULL AND email_sha256    = v_email_h)
      OR (v_ident_h IS NOT NULL AND identity_sha256 = v_ident_h)
   ORDER BY (identity_sha256 IS NOT NULL AND identity_sha256 = v_ident_h) DESC,
            retained_at DESC
   LIMIT 1;
  v_found := FOUND;

  -- An expired email or identity ban is retired, and the phone is still
  -- checked below (lh-authz-rls review #2: returning here skipped it).
  IF v_found AND v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    v_retired := true;
  END IF;

  IF v_retired OR NOT v_found THEN
    -- Q1714: the exact phone of a live retained ban is a doubt-check
    -- (ban_evasion_matches, auto_banned false), the same record
    -- flag_possible_ban_evasion_by_phone files for a profile phone. Never a
    -- ban, never an error that stops a sign-up. Test accounts share fixture
    -- numbers, so they are skipped (is_seed is pinned against self-edits).
    IF NULLIF(btrim(COALESCE(p_phone, '')), '') IS NOT NULL AND p_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = p_user_id AND COALESCE(pr.is_seed, false)) THEN
      BEGIN
        v_phone_h := public.ban_fingerprint('phone', public.normalize_phone_for_ban(p_phone));
        SELECT * INTO v_row
          FROM public.retained_bans
         WHERE phone_sha256 = v_phone_h
           AND (expires_at IS NULL OR expires_at > now())
         ORDER BY retained_at DESC
         LIMIT 1;
        IF FOUND THEN
          INSERT INTO public.ban_evasion_matches (
            user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
            original_recorded_at, original_expires_at, auto_banned
          )
          VALUES (p_user_id, 'phone', v_phone_h, v_row.id, v_row.ban_status, v_row.reason,
                  v_row.retained_at, v_row.expires_at, false)
          ON CONFLICT (user_id, matched_on, retained_ban_id) DO NOTHING;
          RETURN jsonb_build_object('banned', false, 'matched_on', 'phone', 'flagged', true)
                 || CASE WHEN v_retired THEN jsonb_build_object('retired', true) ELSE '{}'::jsonb END;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'enforce_retained_ban: phone doubt-check failed for %: %', p_user_id, SQLERRM;
      END;
    END IF;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL)
           || CASE WHEN v_retired THEN jsonb_build_object('retired', true) ELSE '{}'::jsonb END;
  END IF;

  v_matched := CASE
    WHEN v_ident_h IS NOT NULL AND v_row.identity_sha256 = v_ident_h THEN 'identity'
    ELSE 'email'
  END;

  v_attempt := NULLIF(btrim(COALESCE(p_email, '')), '');
  IF v_attempt IS NULL AND p_user_id IS NOT NULL THEN
    SELECT email INTO v_attempt FROM public.profiles WHERE user_id = p_user_id;
  END IF;

  IF p_user_id IS NOT NULL THEN
    -- The one legitimate self-issued ban: a judgment from an account that no
    -- longer exists, re-applied with no admin present. Scoped to this
    -- transaction (`is_local => true`), so it cannot leak to any other write.
    -- Set BEFORE the profile write, so refuse_unban_during_ban_review sees it
    -- (lh-authz-rls review of f2644839e: set after, the open-review exemption
    -- never applied and stripe-idv-webhook still failed).
    PERFORM set_config('app.retained_ban_reapply', 'on', true);

    -- Never soften or re-date an existing ban (as enforce_retained_payment_ban
    -- does): complete-signup calls this with any signed-in user's JWT and a
    -- phone from the request body, so a weaker retained row matched by phone
    -- turned a permanent ban into a short temporary one, whose expiry then
    -- released a payout hold (same review). Only a stricter judgment applies.
    SELECT ban_status, auto_suspended_until INTO v_cur_status, v_cur_until
      FROM public.profiles WHERE user_id = p_user_id;
    v_cur_rank := CASE v_cur_status WHEN 'permanently_banned' THEN 3 WHEN 'banned' THEN 2 WHEN 'temp_banned' THEN 1 ELSE 0 END;
    v_new_rank := CASE v_row.ban_status WHEN 'permanently_banned' THEN 3 WHEN 'banned' THEN 2 WHEN 'temp_banned' THEN 1 ELSE 0 END;
    IF v_new_rank > v_cur_rank
       OR (v_new_rank = 1 AND v_cur_rank = 1 AND v_cur_until IS NOT NULL
           AND (v_row.expires_at IS NULL OR v_row.expires_at > v_cur_until)) THEN
      UPDATE public.profiles
         SET ban_status           = v_row.ban_status,
             auto_suspended_until = v_row.expires_at
       WHERE user_id = p_user_id;
    END IF;

    -- Q1324 (owner 2026-10-05, supersedes 2026-09-07): the reason this
    -- person sees on /account-banned and in their data export is about THEM,
    -- never the retained ban's own reason.
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by, expires_at, is_active)
    SELECT p_user_id,
           COALESCE(v_row.ban_type, v_row.ban_status),
           v_own_reason,
           p_user_id,
           v_row.expires_at,
           true
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_bans
        WHERE user_id = p_user_id AND is_active
          AND reason = v_own_reason
     );

    PERFORM set_config('app.retained_ban_reapply', 'off', true);

    -- The admin record. Everything the user-facing refusal deliberately
    -- withholds goes here instead.
    BEGIN
      INSERT INTO public.fraud_flags (user_id, flag_type, details)
      SELECT
        p_user_id,
        'ban_evasion_attempt',
        format(
          'Signup blocked: matched a ban retained on %s. Attempted email: %s. '
          || 'The retained ban it matched is in the admin match record (ban_evasion_matches).',
          v_matched,
          COALESCE(v_attempt, '(unknown)')
        )
      WHERE NOT EXISTS (
        SELECT 1 FROM public.fraud_flags f
         WHERE f.user_id = p_user_id
           AND f.flag_type = 'ban_evasion_attempt'
           AND NOT f.resolved
           AND f.details LIKE 'Signup blocked: matched a ban retained on ' || v_matched || '.%'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'enforce_retained_ban: fraud flag failed for %: %', p_user_id, SQLERRM;
    END;

    -- The retained ban's own details, for admins only (never exported).
    BEGIN
      INSERT INTO public.ban_evasion_matches (
        user_id, matched_on, match_sha256, retained_ban_id, original_ban_status, original_reason,
        original_recorded_at, original_expires_at, auto_banned
      )
      VALUES (p_user_id, v_matched,
              CASE v_matched WHEN 'identity' THEN v_ident_h ELSE v_email_h END,
              v_row.id, v_row.ban_status, v_row.reason, v_row.retained_at, v_row.expires_at, true)
      -- Q1497: a doubt-check filed earlier for this same match (a profile
      -- phone change before 20261012042748, auto_banned false) is now the
      -- ban's own record. DO NOTHING left it false, so the admin doubt-check
      -- list kept showing an account this call had just banned.
      ON CONFLICT (user_id, matched_on, retained_ban_id)
        DO UPDATE SET auto_banned = true
        WHERE NOT public.ban_evasion_matches.auto_banned;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'enforce_retained_ban: match record failed for %: %', p_user_id, SQLERRM;
    END;
  END IF;

  UPDATE public.retained_bans SET reapplied_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'banned',      true,
    'matched_on',  v_matched,
    'ban_status',  v_row.ban_status,
    'reason',      v_own_reason,
    'expires_at',  v_row.expires_at,
    'retained_at', v_row.retained_at,
    'retained_id', v_row.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) TO service_role;

-- ── 2. the phone-change auto-ban is gone ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_retained_ban_on_phone_change ON public.profiles;
DROP FUNCTION IF EXISTS public.enforce_retained_ban_on_phone();

-- ── 3. the doubt-check files an exact number on INSERT too ───────────────────
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
  -- Q1714: test accounts share fixture numbers (57 on 2 numbers on prod,
  -- 2026-10-15) and would fill the admin list; is_seed is pinned against
  -- self-edits (prevent_self_escalation), so no member can set it to skip this.
  IF COALESCE(NEW.is_seed, false) THEN
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
     WHERE (phone7_sha256 = v_h7 OR phone_sha256 = v_full)
       AND (expires_at IS NULL OR expires_at > now())
       AND email_sha256 IS DISTINCT FROM v_own_h
       -- Q1714 (owner 2026-10-15): an exact number is flagged on INSERT too.
       -- No path bans on a phone any more (a phone is never SMS-verified),
       -- so the doubt-check is the only record of the match.
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
  'Q1416 (b) + Q1714: a profile whose phone is a live retained ban''s exact number '
  '(matched_on phone) or shares its last 7 digits (phone_near) gets one admin-only '
  'ban_evasion_matches row. Soft signal: never bans, never raises.';

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

-- ── 4. the test accounts' phone doubt-checks leave the admin list ────────────
-- Measured on prod 2026-10-15: all 54 unresolved phone doubt-checks (46
-- 'phone', 8 'phone_near') are on is_seed accounts. Replay-safe: only rows
-- still unresolved.
UPDATE public.ban_evasion_matches m
   SET resolved = true
  FROM public.profiles p
 WHERE p.user_id = m.user_id
   AND COALESCE(p.is_seed, false)
   AND m.matched_on IN ('phone', 'phone_near')
   AND NOT m.resolved
   AND NOT m.auto_banned;
