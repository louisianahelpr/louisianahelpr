-- H5 slice 2 (share-profile audit 11-05): one public profile link. Old /user/<id> and /book/<id> links forward to
-- /u/<handle>, so the app needs a member's current handle from their user id, signed out too.
--
-- handle_for_user(p_user_id) returns the member's current handle, or NULL exactly when public_profile_by_handle
-- (newest: 20261105165059_public_profile_full) would return NULL for that member: no handle, unverified email, banned
-- in any form, seed, deleted (anonymized), out of Declutter (declutter_member_out), under 18 or unknown age
-- (member_under_18), or a test member. The predicate below is that function's own visibility block (a NULL from
-- declutter_member_out or is_test_member counts as "not out", as a NULL IF condition does there);
-- src/test/pglite/handleForUser.pglite.mjs runs both functions over every case and fails when they disagree.
--
-- What it reveals: a public handle for a user id. User ids are already in every /user and /book link, and the handle
-- is the public page's own address, so this answers nothing a link does not already show. No other column.
-- REPLAY-SAFE: CREATE OR REPLACE; grants restated.

CREATE OR REPLACE FUNCTION public.handle_for_user(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT p.handle
    FROM public.profiles p
   WHERE p.user_id = p_user_id
     AND p.handle IS NOT NULL
     AND p.email_verified
     AND p.ban_status IS DISTINCT FROM 'banned'
     AND p.ban_status IS DISTINCT FROM 'temp_banned'
     AND p.ban_status IS DISTINCT FROM 'permanently_banned'
     AND p.is_seed IS NOT TRUE
     AND p.anonymized_at IS NULL
     AND public.declutter_member_out(p.user_id) IS NOT TRUE
     AND NOT COALESCE(public.member_under_18(p.user_id), true)
     AND public.is_test_member(p.user_id) IS NOT TRUE
   LIMIT 1;
$function$;

COMMENT ON FUNCTION public.handle_for_user(uuid) IS
  'H5 (audit 11-05): the current /u handle for a user id, NULL under exactly public_profile_by_handle''s visibility rules. Behind the /user/<id> and /book/<id> forwards.';

REVOKE ALL ON FUNCTION public.handle_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_for_user(uuid) TO anon, authenticated, service_role;
