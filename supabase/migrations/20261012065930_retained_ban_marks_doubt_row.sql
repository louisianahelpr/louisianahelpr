-- Q1497 (lh-authz-rls re-check of Q1416, finding lh-authz-rls@74c0e6967#3):
-- a banned account could stay on the admin doubt-check list after its ban.
--
-- A profile phone change filed the exact number as a 'phone' doubt-check
-- (ban_evasion_matches, auto_banned false; flag_possible_ban_evasion_by_phone).
-- A later enforce_retained_ban run on the same match (complete-signup, the
-- stripe-idv-webhook, or 20261012042748's phone trigger) banned the account,
-- but its match-record INSERT ... ON CONFLICT DO NOTHING left that row at
-- auto_banned false, and AdminBanEvasionReview lists auto_banned = false rows
-- as doubt-checks. Rows filed that way before 20261012042748 deployed still
-- sit on prod in that state.
--
-- Change: the conflict branch marks the existing row auto_banned. Nothing
-- else in the function changes (body copied from the newest definition,
-- 20261006030849). Grants restated. Then a one-time backfill (lh-authz-rls
-- review of this change: the function only fixes a row when it runs again
-- for that user, and it never runs again for an account already banned):
-- an unresolved exact 'phone' doubt-check whose hash IS its retained ban's
-- phone, on an account that is banned and carries the retained-ban
-- re-application's own user_bans row, is that ban's record. Idempotent.
--
-- Proof: src/test/pglite/phoneChangeRetainedBan.pglite.mjs case 10
-- (NEW_MIGRATION=skip-1497 runs without this file: RED).

CREATE OR REPLACE FUNCTION public.enforce_retained_ban(p_user_id uuid, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_identity_sha256 text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_email_h text := CASE WHEN p_email IS NULL OR btrim(p_email) = '' THEN NULL
                    ELSE encode(sha256(lower(btrim(p_email))::bytea), 'hex') END;
  v_phone_h text := public.ban_fingerprint('phone', public.normalize_phone_for_ban(p_phone));
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
  IF v_email_h IS NULL AND v_phone_h IS NULL AND v_ident_h IS NULL THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  SELECT * INTO v_row
    FROM public.retained_bans
   WHERE (v_email_h IS NOT NULL AND email_sha256    = v_email_h)
      OR (v_phone_h IS NOT NULL AND phone_sha256    = v_phone_h)
      OR (v_ident_h IS NOT NULL AND identity_sha256 = v_ident_h)
   ORDER BY (identity_sha256 IS NOT NULL AND identity_sha256 = v_ident_h) DESC,
            (phone_sha256    IS NOT NULL AND phone_sha256    = v_phone_h) DESC,
            retained_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL);
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
  END IF;

  v_matched := CASE
    WHEN v_ident_h IS NOT NULL AND v_row.identity_sha256 = v_ident_h THEN 'identity'
    WHEN v_phone_h IS NOT NULL AND v_row.phone_sha256    = v_phone_h THEN 'phone'
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
              CASE v_matched WHEN 'identity' THEN v_ident_h WHEN 'phone' THEN v_phone_h ELSE v_email_h END,
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

-- ── One-time backfill (replay-safe: touches only rows still false) ────────
UPDATE public.ban_evasion_matches m
   SET auto_banned = true
  FROM public.retained_bans r, public.profiles p
 WHERE m.matched_on = 'phone'
   AND NOT m.auto_banned
   AND NOT m.resolved
   AND r.id = m.retained_ban_id
   AND r.phone_sha256 IS NOT NULL
   AND m.match_sha256 = r.phone_sha256
   AND p.user_id = m.user_id
   AND p.ban_status IN ('temp_banned', 'banned', 'permanently_banned')
   AND EXISTS (
     SELECT 1 FROM public.user_bans b
      WHERE b.user_id = m.user_id AND b.is_active
        AND b.reason = 'This account is linked to an account closed for breaking our Platform Rules. '
                       || 'Contact support if you think this is a mistake.'
   );

