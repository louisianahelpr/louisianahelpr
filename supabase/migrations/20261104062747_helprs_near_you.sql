-- "HELPRS NEAR YOU" ROW ON HOME (Q2008, owner order 2026-10-17, lead 11-04: build).
--
-- A row of faces at the top of Home: Helprs in YOUR parish, with an "active
-- now" dot for anyone whose Available now is on. Privacy (the item's rule):
-- opt-in, and no exact location ever leaves the server.
--
-- 1. profiles.show_near_you: the member's own switch, default OFF (opt-in).
--    Prod grants `authenticated` UPDATE on a NAMED column list, so it is named
--    here; the existing own-row UPDATE policy limits it to the member's row.
--    enforce_banned_profile_text_lock refuses a banned member's change (and a
--    banned member is filtered out of the row below anyway).
-- 2. public.get_helprs_near_me(): for a signed-in member, up to 12 OTHER
--    members who turned the switch on and whose profile parish equals the
--    caller's. It returns only user_id, the masked display name
--    (display_name_for_viewer), avatar_url and active_now (available_until in
--    the future). NEVER the parish, location, zip or coordinates: matching is
--    done here and only the yes/no of "same parish" is implied. Filters the
--    same rules get_safe_profiles applies (email_verified, not banned, not
--    anonymized, the Q552 discovery seed clause) plus blocks in either direction. A
--    caller with no parish gets no rows. anon has no EXECUTE.
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_near_you boolean NOT NULL DEFAULT false;

GRANT UPDATE (show_near_you) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_helprs_near_me()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, active_now boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT p.user_id, p.parish
      FROM public.profiles p
     WHERE p.user_id = auth.uid()
       AND p.parish IS NOT NULL
       AND btrim(p.parish) <> ''
  )
  SELECT
    p.user_id,
    public.display_name_for_viewer(p.full_name, p.user_id) AS full_name,
    p.avatar_url,
    (p.available_until IS NOT NULL AND p.available_until > now()) AS active_now
  FROM public.profiles p
  JOIN me ON lower(btrim(p.parish)) = lower(btrim(me.parish))
  WHERE p.show_near_you
    AND p.user_id <> me.user_id
    AND p.email_verified
    AND COALESCE(p.ban_status, 'active') NOT IN ('banned', 'temp_banned', 'permanently_banned')
    AND p.anonymized_at IS NULL
    -- Q552: a stranger list is DISCOVERY (like open_jobs_browse), so test
    -- rows are hidden from admins too; only a test account keeps them.
    AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_in_discovery()))
    AND NOT public.are_users_blocked(me.user_id, p.user_id)
  ORDER BY (p.available_until IS NOT NULL AND p.available_until > now()) DESC,
           p.available_until DESC NULLS LAST,
           p.user_id
  LIMIT 12;
$function$;

REVOKE ALL ON FUNCTION public.get_helprs_near_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helprs_near_me() TO authenticated, service_role;
