-- V-015 (lh-verifier, 2026-09-04): is_party_to_job(uuid, uuid) — added in
-- 20260904031655 to gate the messages/applications RLS fixes — was granted
-- EXECUTE TO authenticated but never had PUBLIC's default EXECUTE revoked
-- first, so PostgREST's `anon` role (which inherits PUBLIC) can call it with
-- only the anon key. Confirmed live: HTTP 200 with anon key alone, where
-- every sibling SECURITY DEFINER helper on this surface (are_users_blocked,
-- can_message_in_job, user_may_see_job_address) returns 401 for anon. It only
-- answers a boolean membership question (is uuid A a party to job uuid B),
-- not a data leak on its own, but it has no business being anon-callable and
-- is an enumeration primitive an unauthenticated caller shouldn't have.
REVOKE EXECUTE ON FUNCTION public.is_party_to_job(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_party_to_job(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_party_to_job(uuid, uuid) TO authenticated;
