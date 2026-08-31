-- Pay-It-Forward "search recipient by name" entry point.
--
-- profiles SELECT RLS is owner-only (see 20260312230949 — tightened
-- specifically to stop profile/email scraping). This adds the one
-- narrow, purpose-built text-search path a regular (non-admin) user needs
-- to pick a gift recipient by name, without reopening that scrape vector:
--   - authenticated callers only (auth.uid() IS NULL short-circuits to empty)
--   - returns ONLY user_id, full_name, avatar_url — never email, phone, or
--     any other PII (email resolution for the actual gift happens later,
--     server-side, in the create-pif-donation edge function via its
--     service-role client — this function must never return it)
--   - minimum 2-character query enforced server-side (not just client-side)
--     so blind enumeration by single letters isn't practical
--   - hard LIMIT 10 server-side
--   - excludes the caller's own row (mirrors the self-gift guard already
--     enforced in create-pif-donation) and excludes unapproved/banned
--     profiles, matching get_safe_profiles' visibility rules
DROP FUNCTION IF EXISTS public.search_profiles_by_name(text);

CREATE FUNCTION public.search_profiles_by_name(query text)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.user_id, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND length(trim(coalesce(query, ''))) >= 2
    AND p.user_id <> auth.uid()
    AND p.full_name IS NOT NULL
    AND p.full_name ILIKE '%' || trim(query) || '%'
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
  ORDER BY p.full_name ASC
  LIMIT 10;
$function$;

REVOKE ALL ON FUNCTION public.search_profiles_by_name(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles_by_name(text) TO authenticated;
