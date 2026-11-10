-- F071 (owner UI audit 11-09, owner pop-up: "guests may VIEW /explore, /helprs and /search; only actions gated").
--
-- /helprs ("Find a Helpr") sent a guest straight to Log in because find_helprs refused any caller without a session
-- (not_signed_in) and was granted to authenticated only. A guest now gets the same list a member gets: names masked to
-- "First L." (display_name_for_viewer has no owner/admin/server branch for anon), town, parish, skills, photo and the
-- ID-checked flag; this list returns no rate, phone, email or address. A guest never sees a test account (seed or
-- test_accounts, is_test_member, whatever the seed switch says), and banned, deleted, unconfirmed and under-18 members
-- stay out as before. Offering a job still needs an account
-- (the page's Offer a job goes through sign-up). A banned member signed in is still refused.
--
-- The body is the LIVE definition (md5(prosrc) df8e3d14bf93a7609f8fb3ffa9fc45fa on prod 11-09, byte-equal to
-- 20261027201848) with only the caller checks, the "not the caller" clause and the guest test-account clause changed. Replay-safe: CREATE OR REPLACE.
-- Proof: src/test/pglite/findHelprsDirectory.pglite.mjs (now applies this migration too; anon reads masked rows).

CREATE OR REPLACE FUNCTION public.find_helprs(p_skill text DEFAULT NULL, p_town text DEFAULT NULL, p_limit integer DEFAULT 30)
RETURNS TABLE(user_id uuid, full_name text, avatar_url text, skills text, town text, parish text, is_id_verified boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_skill text := NULLIF(btrim(COALESCE(p_skill, '')), '');
  v_town text := NULLIF(btrim(COALESCE(p_town, '')), '');
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);
BEGIN
  -- F071 (owner 11-09): a guest may VIEW the list (the same masked names, towns and skills a public /u page shows);
  -- only acting on it (offering a job) needs an account. A signed-in member who is banned still gets nothing. The
  -- confirmed-email check is gone with the sign-in check: a guest reads the list without any account at all.
  -- is_caller_banned() is false for a NULL uid (profiles.user_id = NULL matches no row), so a guest passes without the
  -- bare-NULL-uid shape the DB smoke refuses (scripts/ci/null-uid-trust.sql, shape B).
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
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
   WHERE (v_me IS NULL OR p.user_id <> v_me)
     AND p.email_verified
     AND p.anonymized_at IS NULL
     AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
     AND NULLIF(btrim(COALESCE(p.skills, '')), '') IS NOT NULL
     AND NOT COALESCE(public.member_under_18(p.user_id), false)
     AND (p.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
     -- A guest never sees a test account, whatever the seed switch says (the public /u page's rule; review note).
     AND (v_me IS NOT NULL OR NOT public.is_test_member(p.user_id))
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
$function$;

REVOKE ALL ON FUNCTION public.find_helprs(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_helprs(text, text, integer) TO anon, authenticated;
