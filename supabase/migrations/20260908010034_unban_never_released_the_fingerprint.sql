-- A pardon did not survive the pardon. My bug, found by the orchestrator.
--
-- `trg_retain_ban_on_ban` (20260908002148) writes a `retained_bans` row the
-- moment `profiles.ban_status` enters a banned value. NOTHING released it. An
-- admin lifting the ban through the console sets `user_bans.is_active = false`
-- and `profiles.ban_status = 'active'`, and the email / phone / identity
-- fingerprints stayed on file — so `enforce_retained_ban` re-applied the ban on
-- that person's next signup, `complete-signup` call, or IDV webhook.
--
-- The failure mode is the worst shape available: a user the platform decided to
-- forgive is silently re-banned, with the ORIGINAL reason quoted back at them,
-- and no admin action anywhere to explain it. It also compounds — the
-- re-application writes a fresh `retained_bans` row for the new address, so
-- each pardon-then-return cycle spends another identifier.
--
-- Before this migration, the retention was strictly one-way. `retained_bans`
-- was designed for deletion, where one-way is correct (the account is gone;
-- there is no unban path and nobody to pardon). Reusing it for ban time
-- inherited that assumption without re-examining it, and ban time is exactly
-- where the reverse transition exists.
--
-- ── What releases, and what does not ────────────────────────────────────────
--
--   * `retained_via = 'ban'`  → RELEASED when the account leaves a banned
--     status. The person is back; their identifiers must be spendable again.
--   * `retained_via = 'deletion'` → KEPT. The account no longer exists, so
--     there is no unban that could ever release it, and dropping it would undo
--     20260903014600 entirely.
--
-- Matching is by fingerprint, not by id: `retained_bans` deliberately holds no
-- `user_id` (that is the whole point — it is what survives the row being
-- deleted). So the release recomputes this account's three keys and deletes the
-- row that matches any of them.
--
-- ── The ban-lift paths this now covers, enumerated ──────────────────────────
--
-- A trigger rather than an edit to one caller, for the same reason the
-- retention is a trigger. Verified against the repo, three writers reach
-- `ban_status = 'active'`:
--   · `sweep_expired_auto_bans()` — the hourly cron that lifts a lapsed
--     suspension;
--   · `admin-user-actions`' `dismiss_message_ban_review` branch, which undoes
--     the ladder's reversible restriction (index.ts:683);
--   · a direct admin `profiles` UPDATE from the console.
-- Editing any one of them would have left the other two broken.

CREATE OR REPLACE FUNCTION public.retain_ban_on_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_was_banned boolean := COALESCE(OLD.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned');
  v_is_banned  boolean := COALESCE(NEW.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned');
  v_email_h    text;
  v_phone_h    text;
BEGIN
  -- ── Into a ban: retain ────────────────────────────────────────────────────
  IF v_is_banned
     AND (NEW.ban_status IS DISTINCT FROM OLD.ban_status
          OR NEW.auto_suspended_until IS DISTINCT FROM OLD.auto_suspended_until)
  THEN
    BEGIN
      PERFORM public.retain_ban_for_user(NEW.user_id, 'ban');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'retain_ban_on_ban: retention failed for %: %', NEW.user_id, SQLERRM;
    END;

  -- ── Out of a ban: RELEASE ─────────────────────────────────────────────────
  --
  -- Guarded like its twin: a release that throws must never roll back the
  -- pardon. A stranded row re-bans someone unfairly, but a failed unban leaves
  -- them banned with an admin who believes otherwise — and the release is
  -- re-attempted on every subsequent ban_status write.
  ELSIF v_was_banned AND NOT v_is_banned THEN
    BEGIN
      v_email_h := CASE WHEN NEW.email IS NULL OR btrim(NEW.email) = '' THEN NULL
                   ELSE encode(sha256(lower(btrim(NEW.email))::bytea), 'hex') END;
      v_phone_h := public.ban_fingerprint('phone', public.normalize_phone_for_ban(NEW.phone));

      DELETE FROM public.retained_bans
       WHERE COALESCE(retained_via, 'ban') <> 'deletion'
         AND (
              (v_email_h        IS NOT NULL AND email_sha256    = v_email_h)
           OR (v_phone_h        IS NOT NULL AND phone_sha256    = v_phone_h)
           OR (NEW.identity_sha256 IS NOT NULL AND identity_sha256 = NEW.identity_sha256)
         );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'retain_ban_on_ban: release failed for %: %', NEW.user_id, SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.retain_ban_on_ban() IS
  'Keeps retained_bans in step with profiles.ban_status in BOTH directions: '
  'retains the fingerprints when an account is banned, and releases them when '
  'the ban is lifted, so a pardoned user is not silently re-banned on their '
  'next signup. Deletion-retained rows (retained_via = ''deletion'') are never '
  'released — that account is gone and has no unban path.';

-- The trigger already fires on the columns that matter; recreated so a replay
-- that predates the release branch still ends up bound to the new body.
DROP TRIGGER IF EXISTS trg_retain_ban_on_ban ON public.profiles;
CREATE TRIGGER trg_retain_ban_on_ban
  AFTER UPDATE OF ban_status, auto_suspended_until ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.retain_ban_on_ban();

-- ── A ban must name the admin who issued it ─────────────────────────────────
--
-- `user_bans.banned_by` is NOT NULL but nothing constrained it, so a row could
-- name the banned account as its own issuer. That is how an admin account got
-- locked out of the console during this lane's own live proof: the ban read as
-- self-inflicted, there was no admin in the record to answer for it, and no
-- audit row pointed anywhere.
--
-- Zero legitimate self-bans exist in prod (`count(*) WHERE banned_by = user_id`
-- = 0, read before writing this), so nothing is grandfathered.
--
-- ONE carve-out, and it is the reason this is a trigger with a flag rather than
-- a CHECK constraint: `enforce_retained_ban` re-applies a retained judgment
-- when there is genuinely no admin present — the ban was issued long ago
-- against an account that no longer exists, and `banned_by` has nowhere else to
-- point. It sets `app.retained_ban_reapply` for the statement, so the exemption
-- is scoped to that one write and cannot be reached from a client (a `SET
-- LOCAL` by an untrusted caller dies with its transaction and, more to the
-- point, `enforce_retained_ban` is the only path that sets it).
CREATE OR REPLACE FUNCTION public.reject_self_issued_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.banned_by IS NOT NULL
     AND NEW.banned_by = NEW.user_id
     AND COALESCE(current_setting('app.retained_ban_reapply', true), '') <> 'on'
  THEN
    RAISE EXCEPTION
      'A ban must name the admin who issued it: user_bans.banned_by cannot equal user_id.'
      USING ERRCODE = '22023',
            HINT = 'Pass the acting admin''s user id as banned_by. Only the retained-ban '
                   're-application may name the account itself, and it sets '
                   'app.retained_ban_reapply to say so.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_self_issued_ban ON public.user_bans;
CREATE TRIGGER trg_reject_self_issued_ban
  BEFORE INSERT OR UPDATE OF banned_by, user_id ON public.user_bans
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_self_issued_ban();

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.reject_self_issued_ban() FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── enforce_retained_ban declares its one exemption ─────────────────────────
--
-- Identical to 20260908004351 except for the `set_config` immediately before
-- the `user_bans` INSERT. Re-stated in full rather than patched, because a
-- function split across two definitions is how the enum drift in
-- `admin-delete-user` happened.

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
    UPDATE public.profiles
       SET ban_status           = v_row.ban_status,
           auto_suspended_until = v_row.expires_at
     WHERE user_id = p_user_id;

    -- The one legitimate self-issued ban: a judgment from an account that no
    -- longer exists, re-applied with no admin present. Scoped to this
    -- transaction (`is_local => true`), so it cannot leak to any other write.
    PERFORM set_config('app.retained_ban_reapply', 'on', true);

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

REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.enforce_retained_ban(uuid, text, text, text) TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

-- ── Repair: rows stranded by a lift that happened before this shipped ───────
--
-- Anyone currently NOT banned whose fingerprints are still on file under
-- `retained_via = 'ban'` was pardoned into a trap. Release them.
DO $$
DECLARE
  r RECORD;
  v_freed integer := 0;
BEGIN
  FOR r IN
    SELECT user_id, email, phone, identity_sha256 FROM public.profiles
     WHERE COALESCE(ban_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
  LOOP
    DELETE FROM public.retained_bans
     WHERE COALESCE(retained_via, 'ban') <> 'deletion'
       AND (
            (r.email IS NOT NULL AND email_sha256 = encode(sha256(lower(btrim(r.email))::bytea), 'hex'))
         OR (phone_sha256 IS NOT NULL
             AND phone_sha256 = public.ban_fingerprint('phone', public.normalize_phone_for_ban(r.phone)))
         OR (r.identity_sha256 IS NOT NULL AND identity_sha256 = r.identity_sha256)
       );
    GET DIAGNOSTICS v_freed = ROW_COUNT;
    IF v_freed > 0 THEN
      RAISE NOTICE 'released % stranded retained_bans row(s) for %', v_freed, r.user_id;
    END IF;
  END LOOP;
END;
$$;
