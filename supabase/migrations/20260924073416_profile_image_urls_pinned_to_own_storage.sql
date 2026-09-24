-- A-007: profiles.avatar_url and profiles.portfolio_urls are client-writable
-- free text, and 14 render sites put them straight into <img src>. A user could
-- store a URL on a host they own and get a tracking pixel that fires whenever
-- anyone (notably an admin reviewing the account) renders the profile. Every
-- legitimate client write is a public URL from THIS project's storage
-- (Profile.tsx avatar upload, usePortfolio uploadPortfolioImage); seeded rows
-- also use this project's brand-asset function. So a CLIENT
-- write of anything else is refused. Server context (seeding, complete-signup,
-- account purge) is not restricted. Values already stored are untouched: live
-- on 2026-09-24 every value was this project's host (storage or brand-asset) or a seeded
-- data:image URI.
CREATE OR REPLACE FUNCTION public.enforce_profile_image_urls()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok  constant text := '^https://fncmgoasalhdgfwzhsqa\.supabase\.co/'; -- A-007 this project's host
  v_url text;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
     AND NULLIF(NEW.avatar_url, '') IS NOT NULL
     AND NEW.avatar_url !~ v_ok THEN -- A-007 own host only
    RAISE EXCEPTION 'profile_image_url_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF NEW.portfolio_urls IS DISTINCT FROM OLD.portfolio_urls THEN
    FOREACH v_url IN ARRAY COALESCE(NEW.portfolio_urls, '{}'::text[]) LOOP
      IF v_url !~ v_ok THEN
        RAISE EXCEPTION 'profile_image_url_not_allowed' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_profile_image_urls() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_profile_image_urls ON public.profiles;
CREATE TRIGGER trg_enforce_profile_image_urls
  BEFORE UPDATE OF avatar_url, portfolio_urls ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_image_urls();
