-- Q2437 (owner-approved 2026-10-27, via the lead): "Find a Helpr". A signed-in
-- member browses Helprs by skill and town, then offers a job through the
-- existing direct-offer flow (/post-job?offerTo=<id>, jobs.offered_to_helper_id)
-- at THEIR OWN price. No Helpr rates anywhere: this returns no hourly_rate.
--
-- What it returns is a subset of what get_safe_profiles already returns to any
-- caller for a known id (live 2026-10-27): the display name (first name + last
-- initial for a member, display_name_for_viewer), avatar, skills, the town the
-- member typed (profiles.location: a town on prod, 0 of 184 real values hold a
-- digit, measured 2026-10-27) and parish. Never an address, phone or email.
-- What is new is the LIST: so it is for signed-in, unbanned members only
-- (REVOKE from PUBLIC and anon) whose own email is confirmed, capped at 50
-- rows a call, and it lists only members who have skills on their profile
-- (a non-empty profiles.skills; there is no separate opt-in setting).
--
-- Left out: the caller, banned / anonymised / unverified accounts, under-18
-- members (refuse_under_18_member would refuse the hire anyway), anyone
-- either side has blocked, and test (seed) accounts unless the caller may see
-- them (seed_hidden_from_caller, the get_safe_profiles clause).
--
-- Ratings and jobs done come from the existing get_public_profile_stats, so the
-- card and the profile page can never disagree.

CREATE OR REPLACE FUNCTION public.find_helprs(p_skill text DEFAULT NULL, p_town text DEFAULT NULL, p_limit integer DEFAULT 30)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, skills text, town text, parish text, is_id_verified boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me uuid := auth.uid();
  v_skill text := NULLIF(btrim(COALESCE(p_skill, '')), '');
  v_town text := NULLIF(btrim(COALESCE(p_town, '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- A throwaway account that never confirmed its email does not get the list.
  IF NOT EXISTS (SELECT 1 FROM public.profiles me WHERE me.user_id = v_me AND me.email_verified) THEN
    RAISE EXCEPTION 'email_not_confirmed' USING ERRCODE = '42501';
  END IF;
  IF length(v_skill) > 60 OR length(v_town) > 60 THEN
    RAISE EXCEPTION 'search_too_long' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT p.user_id,
         public.display_name_for_viewer(p.full_name, p.user_id),
         p.avatar_url,
         p.skills,
         NULLIF(btrim(p.location), ''),
         p.parish,
         (p.idv_status IS NOT DISTINCT FROM 'verified')
    FROM public.profiles p
   WHERE p.user_id <> v_me
     AND p.email_verified
     AND p.anonymized_at IS NULL
     AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
     AND NULLIF(btrim(COALESCE(p.skills, '')), '') IS NOT NULL
     AND NOT COALESCE(public.member_under_18(p.user_id), false)
     AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
     AND NOT EXISTS (
       SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_id = v_me AND b.blocked_id = p.user_id)
           OR (b.blocker_id = p.user_id AND b.blocked_id = v_me)
     )
     -- Typed text is matched as literal text: LIKE's % _ and \ are escaped.
     AND (v_skill IS NULL OR p.skills ILIKE '%' || replace(replace(replace(v_skill, '\', '\\'), '%', '\%'), '_', '\_') || '%' ESCAPE '\')
     AND (v_town IS NULL
          OR p.location ILIKE replace(replace(replace(v_town, '\', '\\'), '%', '\%'), '_', '\_') || '%' ESCAPE '\'
          OR p.parish ILIKE replace(replace(replace(v_town, '\', '\\'), '%', '\%'), '_', '\_') || '%' ESCAPE '\')
   ORDER BY (p.avatar_url IS NOT NULL) DESC, p.created_at ASC, p.user_id
   LIMIT v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.find_helprs(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_helprs(text, text, integer) TO authenticated;
