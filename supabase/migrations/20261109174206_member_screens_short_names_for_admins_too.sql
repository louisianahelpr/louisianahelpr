-- Member screens show "First L." to every signed-in viewer, admins included (owner UI audit 2026-11-09, F136, HIGH).
--
-- WHAT WAS WRONG. /helprs (Find a Helpr), signed in as the owner, showed "Lexi Lombas", "Yusef Hill", ... while
-- Edit profile promises "Your full name stays private" and public profiles show "Lexi L.". Measured live
-- (pg_get_functiondef, 2026-11-09): find_helprs returns public.display_name_for_viewer(p.full_name, p.user_id), and
-- display_name_for_viewer (20261021131322) returns the FULL name to any caller with has_role(auth.uid(), 'admin').
-- The owner's account is an admin (user_roles: Admin, Lexi Lombas, Seed Admin Tester), so every member-facing
-- reader built on it gave her surnames: find_helprs, get_helprs_near_me, get_my_saved_helpers,
-- get_public_profile_reviews, get_quotes_for_request, get_safe_profiles, search_profiles_by_name (and
-- admin_booking_sources, which is admin-gated itself). An ordinary member already got "First L." from all of them.
--
-- FIX. display_name_for_viewer drops the admin branch: the full name goes only to the caller's own row and to a
-- trusted server context (service role, cron). Admin screens are unaffected: they read profiles directly under the
-- admin RLS policy (every row, full_name), and the admin-only RPCs that need a full name read p.full_name behind their
-- own has_role gate (src/test/memberNamesMaskedInResponses.test.ts lists each). Signature, return type, volatility and
-- grants unchanged, so every reader keeps working and no client changes are needed.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a function 20261021131322 defines, same signature; is_server_context and
-- member_display_name exist before this file. Grants restated to prod's proacl (service_role only).
CREATE OR REPLACE FUNCTION public.display_name_for_viewer(p_full_name text, p_owner_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN p_owner_id IS NOT NULL AND p_owner_id = (SELECT auth.uid()) THEN p_full_name
           WHEN (SELECT public.is_server_context()) THEN p_full_name
           ELSE public.member_display_name(p_full_name, NULL)
         END
$fn$;
COMMENT ON FUNCTION public.display_name_for_viewer(text, uuid) IS
  'The name a reader may see: the full name for the caller''s own row (p_owner_id = auth.uid()) or a trusted server context; otherwise member_display_name(full_name, NULL) = formatName''s "First L.", admins included (F136, 2026-11-09: admin screens read profiles directly). Every member-facing reader of profiles.full_name goes through this (src/test/memberNamesMaskedInResponses.test.ts).';
REVOKE ALL ON FUNCTION public.display_name_for_viewer(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.display_name_for_viewer(text, uuid) TO service_role;

-- admin_booking_sources is an ADMIN screen (Growth links, AdminGrowthLinks.tsx): it keeps the full name, read directly
-- behind its own has_role gate like every other admin-only reader (review of this migration, lh-authz-rls note 2).
-- Restated verbatim from 20261030013347_book_me_booking_source.sql (live definition read 2026-11-09); only the name
-- line changes.
CREATE OR REPLACE FUNCTION public.admin_booking_sources()
RETURNS TABLE(helpr_id uuid, helpr_name text, posters_brought integer, posters_who_posted integer, last_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT b.helpr_id,
         -- Admin only (the gate above): the full name, read directly.
         max(hp.full_name),
         count(*)::integer,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.jobs j WHERE j.customer_id = b.user_id))::integer,
         max(b.created_at)
    FROM public.booking_sources b
    LEFT JOIN public.profiles hp ON hp.user_id = b.helpr_id
    LEFT JOIN public.profiles up ON up.user_id = b.user_id
   -- Test data never counts (owner rule): neither a test Helpr nor a test poster.
   WHERE hp.is_seed IS NOT TRUE AND up.is_seed IS NOT TRUE
     AND NOT EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id IN (b.helpr_id, b.user_id))
   GROUP BY b.helpr_id
   ORDER BY count(*) DESC, max(b.created_at) DESC;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_booking_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_booking_sources() TO authenticated;
