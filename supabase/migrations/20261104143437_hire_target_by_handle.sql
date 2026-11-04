-- "Hire me" on a Helpr's public page (owner 2026-11-04 8:31 AM, OWNER-DECISIONS: "'Hire me' on every Helpr's
-- page; link -> Hire me -> creates the listing offered to that Helpr; free for everyone").
--
-- rpc_hire_target_by_handle(p_handle) -> uuid: the user id Post a job's direct offer (?offerTo=) needs, for a
-- SIGNED-IN member only. The public page itself (public_profile_by_handle) still never returns a user id, so a
-- guest reads none; a member gets one only for a person they may actually offer a job to.
--
-- Direct offers carry no plan or membership check anywhere (measured on prod 2026-11-04: no function, policy or
-- jobs trigger behind offered_to_helper_id reads a subscription or tier), so this adds none. Every other rule
-- stays where it already is and is NOT relaxed here:
--   * the job insert: "Customers can create jobs" refuses an offer across a block (are_users_blocked), the ban
--     gate (enforce_ban_gate), the 5-open-jobs cap (enforce_open_job_limit), payment before it lists;
--   * the Helpr's answer: respond_to_direct_offer / direct_accept_block_reason (block, ban, shadowban,
--     credential tier, funded, dates), and the ID check at hire;
--   * a pass or no answer: expire_pending_direct_offers opens the job to everyone (unchanged).
--
-- Refusals (SQLSTATE 42501 for signed out/banned, P0001 otherwise; message = the code):
--   not_signed_in  - no caller;
--   account_restricted - the caller is banned or suspended (is_caller_banned);
--   hire_unavailable - no public page for that handle (unknown, banned, hidden, test, under 18, deleted: exactly
--                      public_profile_by_handle's NULL), OR the two members are blocked either way (one code, so a
--                      blocked member cannot learn the block from this answer);
--   hire_self      - your own handle.
CREATE OR REPLACE FUNCTION public.rpc_hire_target_by_handle(p_handle text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_page jsonb;
  v_target uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- The page's own rules decide who has one; the answer's handle is the CURRENT one (an old handle moves).
  v_page := public.public_profile_by_handle(p_handle);
  IF v_page IS NULL OR coalesce(v_page->>'handle', '') = '' THEN
    RAISE EXCEPTION 'hire_unavailable';
  END IF;
  SELECT p.user_id INTO v_target FROM public.profiles p WHERE p.handle = v_page->>'handle' LIMIT 1;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'hire_unavailable';
  END IF;
  IF v_target = v_me THEN
    RAISE EXCEPTION 'hire_self';
  END IF;
  IF public.are_users_blocked(v_me, v_target) THEN
    RAISE EXCEPTION 'hire_unavailable';
  END IF;
  RETURN v_target;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_hire_target_by_handle(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_hire_target_by_handle(text) TO authenticated, service_role;
