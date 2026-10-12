-- Q1586 / Q1495 (owner decision 2026-10-12, pop-up: "BAN AT ONCE, like
-- sign-up"): a phone written to a profile AFTER sign-up (the account's first
-- phone, or a later change) that is the EXACT number of a retained ban bans
-- the account at once, through the same enforce_retained_ban path sign-up
-- uses. Before this, that write only reached flag_possible_ban_evasion_by_phone
-- (an admin doubt-check, auto_banned false): phone moved out of sign-up on
-- 2026-10-09 (20261009175007), and an auto-ban from the member's own write
-- could not stick because tr_prevent_self_escalation pins ban_status back on
-- any write whose auth.uid() is a member.
--
-- How it can write ban_status from the member's own write:
--   enforce_retained_ban_on_phone() is an AFTER INSERT OR UPDATE OF phone
--   trigger, SECURITY DEFINER. When the new number's exact key matches a live
--   retained ban that is not this account's own (same exclusion as the flag),
--   it sets app.trusted_ladder_write = 'on' (transaction-local) around the
--   call to enforce_retained_ban(NEW.user_id, NULL, NEW.phone, NULL), then puts
--   the setting back to exactly what it was. prevent_self_escalation and
--   enforce_banned_profile_text_lock honour that setting for the nested
--   UPDATE inside enforce_retained_ban; refuse_unban_during_ban_review's rule 1
--   (never lower a ban) still applies, and enforce_retained_ban itself only
--   ever applies a STRICTER standing, so this path can raise a ban, never
--   lower one.
--
-- Who it can ban: only NEW.user_id, the row whose phone was written. A member
-- can write only their own row (RLS "Users can update their own safe fields",
-- auth.uid() = user_id), so a member can ban only themselves. An admin or the
-- service role writing an account's phone applies the same rule to that
-- account, exactly as sign-up does.
--
-- Not covered (on purpose):
--   * Test accounts (is_seed) are exempt, as guard_profile_phone exempts them:
--     56 test accounts share one fixture number, and a banned test account
--     retained it (prod, 2026-10-12: one retained_bans row, 46 'phone'
--     doubt-checks on test accounts on 2026-10-11). They keep the admin flag.
--   * An account that is already banned (nothing stricter to do here; the
--     ban itself never softens).
--   * Last-7 / normalised near matches stay an admin doubt-check
--     (flag_possible_ban_evasion_by_phone, unchanged). Trigger ORDER matters:
--     AFTER ROW triggers on one event fire in name order, and this one
--     (trg_retained_ban_on_phone_change) sorts AFTER
--     trg_flag_possible_ban_evasion_by_phone. The flag runs first and files
--     the exact number as a 'phone' doubt-check (auto_banned false); once the
--     ban is applied this trigger marks that row auto_banned, so the admin
--     doubt-check list does not show an account that is already banned. Run
--     the other way round, the ban's retention (retain_ban_for_user moves the
--     phone key to the newest ban) would leave the flag only a last-7 key and
--     a spurious 'phone_near' row (seen in the PGlite proof).
--
-- Failure: a lookup that cannot run (e.g. the fingerprint salt is missing)
-- logs to error_logs and lets the save through, like the flag and sign-up's
-- check; once a match IS found, a ban that fails aborts the phone save (the
-- number is on the ban list; refusing it beats keeping it unbanned).
--
-- Proof: src/test/pglite/phoneChangeRetainedBan.pglite.mjs (real
-- enforce_retained_ban, prevent_self_escalation and the rest of the profiles
-- ban chain from the migrations, an authenticated member context, applied 3x).
-- Guard: src/test/firstPhoneAutoBan.test.ts.
-- Replay-safe: CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE; the
-- function only references objects earlier migrations create.

CREATE OR REPLACE FUNCTION public.enforce_retained_ban_on_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_full    text;
  v_own_h   text;
  v_match   boolean := false;
  v_prev    text;
  v_result  jsonb;
  v_try     int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NULL;
  END IF;
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
    RETURN NULL;
  END IF;
  -- Test accounts share fixture numbers (guard_profile_phone exempts them too).
  IF COALESCE(NEW.is_seed, false) THEN
    RETURN NULL;
  END IF;
  -- Already banned: enforce_retained_ban never softens, and there is nothing
  -- stricter to apply from here.
  IF COALESCE(NEW.ban_status, 'active') IN ('banned', 'temp_banned', 'permanently_banned') THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_full := public.ban_fingerprint('phone', public.normalize_phone_for_ban(NEW.phone));
    IF v_full IS NULL THEN
      RETURN NULL;
    END IF;
    v_own_h := CASE WHEN NEW.email IS NULL OR btrim(NEW.email) = '' THEN NULL
                    ELSE encode(sha256(lower(btrim(NEW.email))::bytea), 'hex') END;
    -- The account's OWN retained ban (same email) is not evasion: an unban
    -- releases it, and a ban in force is handled above.
    SELECT EXISTS (
      SELECT 1 FROM public.retained_bans r
       WHERE r.phone_sha256 = v_full
         AND (r.expires_at IS NULL OR r.expires_at > now())
         AND r.email_sha256 IS DISTINCT FROM v_own_h
    ) INTO v_match;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enforce_retained_ban_on_phone: lookup failed for %: %', NEW.user_id, SQLERRM;
    BEGIN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        format('Q1586 retained-ban phone check did not run for account %s: %s', NEW.user_id, SQLERRM),
        jsonb_build_object('source', 'enforce_retained_ban_on_phone', 'origin', 'server'),
        jsonb_build_object('user_id', NEW.user_id)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_retained_ban_on_phone: error_logs write failed too: %', SQLERRM;
    END;
    RETURN NULL;
  END;

  IF NOT v_match THEN
    RETURN NULL;
  END IF;

  -- The one place a member's own write may set ban_status: scoped to this
  -- call, transaction-local, and restored to exactly what it was, so a later
  -- statement in the same transaction (e.g. a self-unban) is pinned again.
  v_prev := current_setting('app.trusted_ladder_write', true);
  PERFORM set_config('app.trusted_ladder_write', 'on', true);
  -- enforce_retained_ban takes the newest phone match; an expired one it
  -- retires (deletes) and answers banned=false, so try the next (bounded).
  FOR v_try IN 1..5 LOOP
    v_result := public.enforce_retained_ban(NEW.user_id, NULL, NEW.phone, NULL);
    EXIT WHEN COALESCE((v_result->>'banned')::boolean, false)
           OR NOT COALESCE((v_result->>'retired')::boolean, false);
  END LOOP;
  PERFORM set_config('app.trusted_ladder_write', COALESCE(v_prev, ''), true);

  IF COALESCE((v_result->>'banned')::boolean, false) THEN
    -- The flag (it fired first) filed this exact number as a doubt-check;
    -- it is enforced now, so it leaves the admin's doubt-check list.
    UPDATE public.ban_evasion_matches
       SET auto_banned = true
     WHERE user_id = NEW.user_id
       AND matched_on = 'phone'
       AND match_sha256 = v_full
       AND NOT auto_banned;
  ELSE
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      'error',
      format('Q1586: account %s saved a retained-ban phone but enforce_retained_ban did not ban it', NEW.user_id),
      jsonb_build_object('source', 'enforce_retained_ban_on_phone', 'origin', 'server'),
      jsonb_build_object('user_id', NEW.user_id, 'result', v_result)
    );
  END IF;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.enforce_retained_ban_on_phone() IS
  'Q1586/Q1495 (owner 2026-10-12): a phone written after sign-up that is the exact number of a '
  'live retained ban (not the account''s own) bans the account at once via enforce_retained_ban, '
  'as sign-up does. Only the written row is affected. Test accounts and already-banned accounts are skipped.';

REVOKE ALL ON FUNCTION public.enforce_retained_ban_on_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_retained_ban_on_phone_change ON public.profiles;
CREATE TRIGGER trg_retained_ban_on_phone_change
  AFTER INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_retained_ban_on_phone();
