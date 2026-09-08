-- A refused ban-evasion attempt told the person too much and told the operator
-- nothing.
--
-- Owner decision, 2026-09-07, two halves pointing in opposite directions:
--
--   · The USER gets a plain, non-probing refusal. It must not name which
--     signal matched or when they were banned. The message shipped in
--     20260908002148 said "This phone number belongs to an account that was
--     removed" — which is an oracle: type a number, learn whether that number
--     belongs to a banned account. That is a lookup service for anyone with a
--     list of phone numbers, and it is free.
--
--   · The ADMIN gets everything: which signal matched (email / phone /
--     identity), the original ban's date and reason, and the email the person
--     attempted to sign up with.
--
-- ── Why the record is written HERE and not in the callers ───────────────────
--
-- 20260908002148 wrote its fraud flag inside `stripe-idv-webhook`, which meant
-- exactly one of the three enforcement paths produced an admin record. The
-- email match in `handle_new_user()` — the oldest path, the one that has
-- existed since 20260903014600 — recorded NOTHING: the returning account was
-- silently re-banned and no operator ever learned an evasion had been
-- attempted. Moving the write into `enforce_retained_ban` means every path
-- that refuses also reports, and a fourth caller added later cannot forget to.
--
-- One flag type, `ban_evasion_attempt`, rather than one per signal: the
-- console filters by type, and an operator looking for evasion wants all of it
-- in one list. WHICH signal matched is in `details`, where it is read, not in
-- the type, where it would fragment the filter. The type is added to
-- `FLAG_TYPES` in AdminFraudDashboard.tsx in the same change — that file's own
-- rule is that only types something actually writes belong in the filter, and
-- the converse (a type written but not listed) is the failure this migration
-- would otherwise ship: a flag that lands in a table no filter can surface.
--
-- ── What is NOT in the flag ─────────────────────────────────────────────────
--
-- The attempted email is named because the operator needs to identify the
-- account in front of them. The prior account's email, phone and identity are
-- NOT: they exist only as salted hashes and are not recoverable, which is the
-- point of the design. `retained_bans.id` is included so an operator can join
-- back to the retained judgment itself.

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
  v_attempt text;
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
  -- every future signup. No flag: a person whose suspension has run out coming
  -- back is the system working, not an evasion.
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    DELETE FROM public.retained_bans WHERE id = v_row.id;
    RETURN jsonb_build_object('banned', false, 'matched_on', NULL, 'retired', true);
  END IF;

  v_matched := CASE
    WHEN v_ident_h IS NOT NULL AND v_row.identity_sha256 = v_ident_h THEN 'identity'
    WHEN v_phone_h IS NOT NULL AND v_row.phone_sha256    = v_phone_h THEN 'phone'
    ELSE 'email'
  END;

  -- The address the person is attempting to use. Prefer what the caller was
  -- handed; fall back to the profile, because the IDV path knows the account
  -- but not the address it was created with.
  v_attempt := NULLIF(btrim(COALESCE(p_email, '')), '');
  IF v_attempt IS NULL AND p_user_id IS NOT NULL THEN
    SELECT email INTO v_attempt FROM public.profiles WHERE user_id = p_user_id;
  END IF;

  IF p_user_id IS NOT NULL THEN
    UPDATE public.profiles
       SET ban_status           = v_row.ban_status,
           auto_suspended_until = v_row.expires_at
     WHERE user_id = p_user_id;

    -- The row /account-banned reads to show the reason.
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

    -- ── The admin record ──────────────────────────────────────────────────
    --
    -- Everything the refusal message deliberately withholds from the person
    -- goes here instead. Guarded so a fraud_flags failure can never be the
    -- thing that lets an evasion through — the ban is already applied above,
    -- and losing the operator's notice is bad, losing the enforcement is worse.
    --
    -- Not stacked: a person who retries the same signup should not produce a
    -- new row on every attempt, or the console becomes unreadable exactly when
    -- it matters most. One open flag per account per matched signal.
    BEGIN
      INSERT INTO public.fraud_flags (user_id, flag_type, details)
      SELECT
        p_user_id,
        'ban_evasion_attempt',
        format(
          'Signup blocked: matched a ban retained on %s. Attempted email: %s. '
          || 'Original ban: %s, %s, recorded %s%s. Retained ban id %s. '
          || 'The prior account''s own email, phone and identity are stored only as '
          || 'salted hashes and are not recoverable.',
          v_matched,
          COALESCE(v_attempt, '(unknown)'),
          v_row.ban_status,
          v_row.reason,
          to_char(v_row.retained_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD HH24:MI') || ' CT',
          CASE WHEN v_row.expires_at IS NULL THEN ' (indefinite)'
               ELSE ' (expires ' || to_char(v_row.expires_at AT TIME ZONE 'America/Chicago', 'YYYY-MM-DD') || ')' END,
          v_row.id
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
  END IF;

  UPDATE public.retained_bans SET reapplied_at = now() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'banned',      true,
    'matched_on',  v_matched,
    'ban_status',  v_row.ban_status,
    'reason',      v_row.reason,
    'expires_at',  v_row.expires_at,
    'retained_at', v_row.retained_at,
    'retained_id', v_row.id
  );
END;
$$;

COMMENT ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) IS
  'Looks a signup up against every retained-ban key (email, phone, Stripe '
  'Identity fingerprint), re-applies the judgment, files a ban_evasion_attempt '
  'fraud flag naming the matched signal / original ban / attempted email for '
  'admins, and reports the match so the caller can refuse the action. The '
  'user-facing refusal must stay plain: naming the matched signal turns this '
  'into a lookup oracle.';

REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;
