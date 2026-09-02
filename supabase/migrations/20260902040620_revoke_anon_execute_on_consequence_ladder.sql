-- apply_consequence_ladder was executable by `anon`.
--
-- It is the shared core of the consequence ladder: SECURITY DEFINER, it takes
-- the TARGET user as a parameter (p_user), and it deliberately sets
-- `app.trusted_ladder_write` so its writes survive prevent_self_escalation().
-- It has no auth.uid() check and no admin check, because it was only ever meant
-- to be called BY other SECURITY DEFINER functions
-- (apply_message_violation_consequence, apply_cancellation_violation_consequence,
-- apply_job_denial_consequence, apply_low_rating_flag, auto_restrict_repeat_violators).
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default, and that grant
-- was never revoked. PostgREST exposes public functions as RPC, and the anon key
-- ships inside the client bundle by design, so ANY unauthenticated caller could
-- permanently ban ANY user by uuid -- including every admin, which locks the team
-- out of /admin -- and could inject arbitrary user_bans / user_violations rows
-- and spam notifications.
--
-- Proven end-to-end against a test account on 2026-09-02
-- ({"action":"permanent"} -> ban_status = permanently_banned) and reverted
-- immediately.
--
-- Revoking from anon and authenticated does NOT break the ladder: every
-- legitimate caller is itself SECURITY DEFINER and executes as the function
-- owner, which retains EXECUTE.

REVOKE EXECUTE ON FUNCTION public.apply_consequence_ladder(
  uuid, text, text, uuid, integer, text[], text[], jsonb, boolean, integer, boolean, text, text
) FROM PUBLIC, anon, authenticated;
