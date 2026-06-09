-- Public-safe RPC exposing the most recent login timestamp for a set of
-- users. Powers the "last active 2h ago" trust signal on the public
-- user-profile page (handoff item #28).
--
-- login_history is RLS-locked to owner+admin so the client can't read it
-- directly. This SECURITY DEFINER function returns ONLY the per-user
-- max(created_at) — no IP, no user-agent — which is the minimum data
-- needed to render the badge while leaking nothing about login cadence
-- or device fingerprints.
--
-- Replay-safe: nothing here depends on objects defined in later
-- migrations, and the function is idempotent via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_user_last_active(user_ids uuid[])
RETURNS TABLE(user_id uuid, last_active_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT lh.user_id, MAX(lh.created_at) AS last_active_at
  FROM public.login_history lh
  WHERE lh.user_id = ANY(user_ids)
  GROUP BY lh.user_id;
$function$;

-- Lock down + selectively grant. Default revoke from public so the
-- function can't be invoked anonymously.
REVOKE ALL ON FUNCTION public.get_user_last_active(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_last_active(uuid[]) TO authenticated;
