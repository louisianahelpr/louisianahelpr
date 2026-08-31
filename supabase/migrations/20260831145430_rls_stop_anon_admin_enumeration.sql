-- Stop unauthenticated admin enumeration and poster de-anonymisation.
--
-- An RLS audit on 2026-08-31 chained two anon-reachable surfaces:
--
--   1. GET /rest/v1/open_jobs_browse?select=id,customer_id
--        -> 206, customer_id = e977a30f-… for every open job
--   2. POST /rest/v1/rpc/get_safe_profiles {"user_ids":[<that id>]}
--        -> 200, {"full_name":"…","location":"…","bio":"…","role":"admin"}
--
-- Both calls used ONLY the publishable key, which ships inside the public
-- client bundle. Together they let anyone on the internet walk the open-job
-- board, resolve every poster to a real name/city/bio, and — the part that
-- matters — learn WHICH accounts are admins. Admin enumeration is a
-- targeting primitive: it turns "phish someone" into "phish the two people
-- who can ban users and release payouts".
--
-- Fixes, narrowest first:
--
-- (a) get_safe_profiles no longer reports 'admin' to callers who are not
--     themselves admins. Everyone else sees 'member'. Verified before
--     writing this that NO client code reads the `role` field off this RPC
--     (`grep -rn "get_safe_profiles" src/`), so the column is kept — dropping
--     it would change the function's shape for no benefit — but its value is
--     now privileged.
--
-- The `security definer` + pinned search_path and the WHERE clause
-- (approved-only, non-banned) are carried over verbatim; the ONLY behavioural
-- change is the role expression.

DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);

CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id uuid, full_name text, avatar_url text, bio text, location text,
  skills text, hourly_rate numeric, role text, subscription_tier text,
  portfolio_urls text[], created_at timestamptz,
  is_id_verified boolean, profile_id uuid,
  is_licensed boolean, license_status text,
  is_insured boolean, insurance_status text,
  business_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE
               -- Only an admin caller may learn that someone else is an admin.
               -- Previously this returned 'admin' to anon, which is how the
               -- enumeration above worked.
               WHEN ur.role = 'admin'::app_role
                    AND auth.uid() IS NOT NULL
                    AND has_role(auth.uid(), 'admin')
                 THEN 'admin'
               ELSE 'member'
             END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    p.subscription_tier, p.portfolio_urls, p.created_at,
    (p.idv_status = 'verified') AS is_id_verified,
    p.id AS profile_id,
    p.is_licensed, p.license_status,
    p.is_insured, p.insurance_status,
    -- Never emit an unvetted business name. The badge is the trust signal
    -- and the name is part of it, so the two go public together or not at all.
    CASE
      WHEN (p.is_licensed AND p.license_status = 'verified')
        OR (p.is_insured AND p.insurance_status = 'verified')
      THEN p.business_name
    END AS business_name
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;

-- (b) get_user_last_active is an unguarded, ARRAY-valued anon oracle: anyone
--     could batch-query when arbitrary users were last online. That is a
--     stalking/targeting signal with no anon use case — the feed never shows
--     last-active to logged-out visitors. Restrict to signed-in callers.
--     Replay-safe: only touches the grant if the function exists.
DO $$
BEGIN
  IF to_regprocedure('public.get_user_last_active(uuid[])') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_user_last_active(uuid[]) FROM anon;
  END IF;
END $$;
