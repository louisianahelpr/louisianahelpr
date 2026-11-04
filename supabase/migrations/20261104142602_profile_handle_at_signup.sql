-- Owner 2026-11-04 (via lead): profile links "should be made when they sign up,
-- it's not something they should have to create." Every member gets their
-- louisianahelpr.com/u/<handle> link automatically.
--
-- WHAT WAS WRONG. 20261101034834_profile_handle made handles LAZILY: only
-- rpc_ensure_my_handle() (Share my profile, Settings) gave a member one, so
-- measured 2026-11-04 14:20Z (read-only): 0 of 336 profiles (0 of 260 real
-- members) had a handle, and nobody had a link to share.
--
-- WHAT THIS DOES
--   * profile_handle_pick(user, name): the default handle for a member, the
--     SAME rule and candidate order as rpc_ensure_my_handle (profile_handle_base
--     of the public name, then "-2", "-3" ... up to 500, then a letters-only
--     tail; profile_handle_problem() refuses every candidate it would refuse),
--     skipping a handle another member holds or retired. It takes the same
--     advisory lock as profile_handle_retire ('profile_handle:' || handle), so
--     (the backfill holds a table lock instead) two sign-ups with the same name, or a sign-up racing a member's
--     rpc_set_my_handle/rpc_ensure_my_handle, never pick the same handle: the
--     second waits for the first to commit and then sees it taken.
--   * trg_profile_handle_zz_default: BEFORE INSERT on profiles, fills
--     NEW.handle when it is empty. Named to run AFTER
--     trg_profile_handle_insert_server_owned (which still refuses a handle a
--     client tries to supply) and trg_profile_handle_retire (Postgres fires
--     BEFORE row triggers in name order). It sets the column on the row being
--     inserted, so no second UPDATE and no profiles UPDATE trigger runs.
--     A failure to pick never blocks a sign-up: the handle stays NULL and the
--     lazy rpc_ensure_my_handle still makes one later (a WARNING is raised).
--   * Backfill: every profile with no handle gets one (deleted, anonymized
--     accounts excepted: no name is reserved for an account that is gone), oldest first (so the
--     member who joined first keeps the plain "eli-b"). profiles.updated_at is
--     the win-back email's inactivity clock (engagement-automations) and the
--     IDV-review fallback clock (idv_review_waiting_since), so the backfill
--     must not move it: update_profiles_updated_at is disabled for this one
--     statement and re-enabled right after, inside this migration's
--     transaction. handle_changed_at stays NULL, so every member keeps their
--     one-time "Change link".
--
-- PRIVACY: unchanged. The handle is made from the name the app already shows
-- publicly ("Eli B."), and public_profile_by_handle still returns public
-- fields only.
--
-- REPLAY-SAFE: CREATE OR REPLACE; DROP TRIGGER IF EXISTS before CREATE; the
-- backfill touches only rows whose handle IS NULL (none on a replay); the
-- trigger is re-enabled in the same block.
-- Proof: src/test/pglite/profileHandleAtSignup.pglite.mjs (--before is red).

CREATE OR REPLACE FUNCTION public.profile_handle_pick(p_user_id uuid, p_full_name text, p_lock boolean DEFAULT true)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_base text := rtrim(left(public.profile_handle_base(p_full_name), 23), '-');
  v_try text := v_base;
  v_n int := 1;
BEGIN
  LOOP
    IF public.profile_handle_problem(v_try) IS NULL THEN
      -- The lock profile_handle_retire takes for the same handle: a concurrent claim
      -- of this handle commits (or rolls back) before the checks below read it.
      -- The backfill passes false: it holds a table lock instead (one advisory lock per try
      -- across ~340 rows would fill the shared lock table).
      IF p_lock THEN
        PERFORM pg_advisory_xact_lock(hashtext('profile_handle:' || v_try));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.handle = v_try AND p.user_id IS DISTINCT FROM p_user_id)
         AND NOT EXISTS (SELECT 1 FROM public.profile_handles_retired r
                          WHERE r.handle = v_try AND r.user_id IS DISTINCT FROM p_user_id) THEN
        RETURN v_try;
      END IF;
    END IF;
    v_n := v_n + 1;
    IF v_n > 2000 THEN
      RETURN NULL;
    ELSIF v_n > 1000 THEN
      v_try := 'neighbor-' || translate(substr(md5(p_user_id::text || clock_timestamp()::text), 1, 6), '0123456789', 'ghijklmnop');
    ELSIF v_n > 500 THEN
      v_try := v_base || '-' || translate(substr(md5(p_user_id::text || clock_timestamp()::text), 1, 6), '0123456789', 'ghijklmnop');
    ELSE
      v_try := v_base || '-' || v_n::text;
    END IF;
  END LOOP;
END;
$function$;

-- Internal only: it would answer "is this handle taken" for any name.
REVOKE ALL ON FUNCTION public.profile_handle_pick(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_handle_pick(uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.profile_handle_default_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- A deleted (anonymized) account never gets a handle: no name is reserved for an account that is gone.
  IF NEW.handle IS NULL AND NEW.user_id IS NOT NULL AND NEW.anonymized_at IS NULL THEN
    BEGIN
      NEW.handle := public.profile_handle_pick(NEW.user_id, NEW.full_name);
    EXCEPTION WHEN OTHERS THEN
      -- Never block a sign-up over a link: rpc_ensure_my_handle makes one later.
      RAISE WARNING 'profile_handle_default_on_insert: no handle for %: %', NEW.user_id, SQLERRM;
      NEW.handle := NULL;
    END;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.profile_handle_default_on_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profile_handle_zz_default ON public.profiles;
CREATE TRIGGER trg_profile_handle_zz_default
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profile_handle_default_on_insert();

-- Backfill every existing member, oldest first, without moving updated_at.
DO $backfill$
DECLARE
  r record;
  v_handle text;
  v_has_trigger boolean := EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'update_profiles_updated_at' AND NOT tgisinternal);
BEGIN
  -- No member writes a handle (or signs up) while the backfill picks: SHARE ROW EXCLUSIVE
  -- blocks every other INSERT/UPDATE/DELETE on profiles until this migration commits.
  LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
  IF v_has_trigger THEN
    EXECUTE 'ALTER TABLE public.profiles DISABLE TRIGGER update_profiles_updated_at';
  END IF;
  PERFORM set_config('app.profile_handle_rpc', '1', true);
  FOR r IN
    SELECT p.user_id, p.full_name FROM public.profiles p
     WHERE p.handle IS NULL AND p.user_id IS NOT NULL
       AND p.anonymized_at IS NULL  -- deleted accounts: no handle reserved for them (lead review 11-04)
     ORDER BY p.created_at NULLS LAST, p.user_id
  LOOP
    v_handle := public.profile_handle_pick(r.user_id, r.full_name, false);
    IF v_handle IS NOT NULL THEN
      UPDATE public.profiles SET handle = v_handle WHERE user_id = r.user_id AND handle IS NULL;
    END IF;
  END LOOP;
  PERFORM set_config('app.profile_handle_rpc', '0', true);
  IF v_has_trigger THEN
    EXECUTE 'ALTER TABLE public.profiles ENABLE TRIGGER update_profiles_updated_at';
  END IF;
END
$backfill$;
