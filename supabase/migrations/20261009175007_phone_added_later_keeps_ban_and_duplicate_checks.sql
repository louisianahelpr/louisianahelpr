-- Phone is added AFTER sign-up now (owner, 2026-10-09: sign-up step 2 asks only
-- name, city and ZIP). Two protections lived in the sign-up path and would have
-- gone with it (code review, 2026-10-09):
--
--   1. The exact-phone retained-ban AUTO-ban: complete-signup passed the phone
--      to enforce_retained_ban. A phone added later reached only
--      flag_possible_ban_evasion_by_phone, which flags for an admin.
--   2. The duplicate-phone refusal ("This phone number is already associated
--      with an account"), a client-side check in Signup.tsx.
--
-- What this does:
--
--   guard_profile_phone (BEFORE INSERT OR UPDATE OF phone): '' is stored as
--   NULL, and a number another real account already has (same last 10 digits)
--   is refused, on every write path (the Finish your profile prompt, Profile
--   edit, Complete Profile). Test accounts (is_seed) are exempt on both sides.
--   A re-save of the same number in a different format is not a change (2
--   real pairs already share a number on 2026-10-09; they can still save).
--   A banned account's number is not refused (the flag trigger must record
--   it); a number that is not 10 US digits is refused; concurrent saves of one
--   number are serialised.
--
--   The retained-ban side: a phone added later is checked by the existing
--   flag_possible_ban_evasion_by_phone (exact and last-7 matches -> an admin
--   doubt-check row in ban_evasion_matches), not auto-banned. An auto-ban from
--   the member's own write cannot apply: tr_prevent_self_escalation pins
--   ban_status back (code review, 2026-10-09). Restoring the sign-up-time
--   auto-ban for a first phone is filed in docs/OPEN.md.
--
-- Proof: src/test/pglite/phoneAddedLater.pglite.mjs (applied 3x).
-- Replay-safe: CREATE OR REPLACE; DROP TRIGGER/FUNCTION IF EXISTS; CREATE INDEX
-- IF NOT EXISTS. The trigger function is nobody's to call.

CREATE OR REPLACE FUNCTION public.guard_profile_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_d10 text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.phone IS NOT DISTINCT FROM OLD.phone THEN
    RETURN NEW;
  END IF;
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;
  v_d10 := regexp_replace(NEW.phone, '\D', '', 'g');
  -- US numbers only, as normalize_phone_for_ban reads them: a leading 1 is
  -- the country code; anything else that is not 10 digits (an extension, a
  -- stray digit) would slip past both this check and the ban-evasion keys.
  IF length(v_d10) = 11 AND left(v_d10, 1) = '1' THEN
    v_d10 := right(v_d10, 10);
  END IF;
  IF length(v_d10) <> 10 THEN
    RAISE EXCEPTION 'Enter a 10-digit phone number.' USING ERRCODE = 'check_violation', HINT = 'phone_invalid';
  END IF;
  -- The same number in a different format is not a new number.
  IF TG_OP = 'UPDATE' AND OLD.phone IS NOT NULL
     AND right(regexp_replace(OLD.phone, '\D', '', 'g'), 10) = v_d10 THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.is_seed, false) THEN
    RETURN NEW;
  END IF;
  -- Two saves of the same new number at once must not both pass the check.
  PERFORM pg_advisory_xact_lock(hashtextextended('profile_phone:' || v_d10, 0));
  -- A BANNED account's number is not "taken": refusing it here would abort the
  -- statement before trg_flag_possible_ban_evasion_by_phone (AFTER) records
  -- the exact-number match for an admin (code review round 3, 2026-10-09).
  IF EXISTS (
       SELECT 1 FROM public.profiles o
        WHERE o.user_id IS DISTINCT FROM NEW.user_id
          AND NOT COALESCE(o.is_seed, false)
          AND o.phone IS NOT NULL
          AND COALESCE(o.ban_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
          AND right(regexp_replace(o.phone, '\D', '', 'g'), 10) = v_d10
     ) THEN
    RAISE EXCEPTION 'This phone number is already on another account. Log in to that account instead.'
      USING ERRCODE = 'unique_violation', HINT = 'phone_in_use';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_profile_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_profile_phone ON public.profiles;
CREATE TRIGGER trg_guard_profile_phone
  BEFORE INSERT OR UPDATE OF phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_phone();

-- No auto-ban trigger: see the header (it could not apply from a member's own
-- write). Dropped in case an earlier draft of this file ever ran.
DROP TRIGGER IF EXISTS trg_enforce_retained_ban_on_first_phone ON public.profiles;
DROP FUNCTION IF EXISTS public.enforce_retained_ban_on_first_phone();

-- The duplicate lookup reads this instead of scanning every profile.
CREATE INDEX IF NOT EXISTS profiles_phone_last10_idx
  ON public.profiles ((right(regexp_replace(phone, '\D', '', 'g'), 10)))
  WHERE phone IS NOT NULL AND NOT COALESCE(is_seed, false);
