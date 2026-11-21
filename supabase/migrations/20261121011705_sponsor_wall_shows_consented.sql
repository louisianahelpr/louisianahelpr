-- 25 Days sponsor wall shows on no page (holiday audit C4, 2026-11-20).
--
-- WHAT WAS BROKEN: /sponsor promises "Featured on our sponsor wall: your logo on the 25 Days page all month", and the
-- sign-up form asks "OK to show our logo on the sponsor wall". sponsor_public_state (20261109162829) listed a
-- sign-up on the wall only when its status was confirmed / prize_received / posted AND show_on_wall AND wall_ok.
-- Measured on prod 2026-11-20 (read-only SELECT on sponsor_signups): all 49 real sign-ups are status 'pending'
-- (the admin never moves a sign-up off pending; sponsors already on the final lineup are pending too), 46 have
-- show_on_wall = true. So the wall ("Brands already joining the fun!") never rendered, and the logo endpoint
-- (sponsor_service_logo_path, same gate) served no logo.
--
-- WHY THIS FIXES IT: the wall is decided by the two switches that already say who may be on it: wall_ok (the
-- sponsor's own "OK to show our logo" tick, required by CHECK sponsor_signups_wall_needs_ok) and show_on_wall (the
-- admin's wall toggle in Admin -> Sponsors, sponsor_admin_set_wall; the admin turned it off for Microtel and
-- Wingate). Status no longer gates the wall. Test sign-ups still never show (is_seed_email). Nothing else changes:
-- both functions are restated verbatim from 20261109162829 (their newest definition) except the wall condition.
--
-- REPLAY-SAFE: CREATE OR REPLACE only; REVOKE/GRANT restated (FROM PUBLIC, anon, authenticated).
-- Proof: src/test/pglite/sponsor25days.pglite.mjs applies this on top 3x (WALL_FIX=skip -> RED).

-- ── Public read: the wall is the sponsors who said OK and the admin shows ───────
CREATE OR REPLACE FUNCTION public.sponsor_public_state(p_ref text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text := lower(btrim(COALESCE(p_ref, '')));
  v_settings public.sponsor_settings;
BEGIN
  IF NOT public.sponsor_25days_on_for((SELECT auth.uid())) THEN
    RETURN jsonb_build_object('on', false);
  END IF;
  SELECT * INTO v_settings FROM public.sponsor_settings WHERE id;
  RETURN jsonb_build_object(
    'on', true,
    'greeting_brand', (SELECT i.brand FROM public.sponsor_invites i WHERE v_ref <> '' AND i.ref_code = v_ref),
    -- Test data never counts (b62): a sign-up made with a test account's address takes no spot and is not shown.
    'day_counts', COALESCE((SELECT jsonb_object_agg(d.day::text, d.n)
                              FROM (SELECT sd.day, count(*)::int AS n
                                      FROM public.sponsor_days sd
                                      JOIN public.sponsor_signups ss ON ss.id = sd.signup_id
                                     WHERE NOT public.is_seed_email(ss.email)
                                     GROUP BY sd.day) d), '{}'::jsonb),
    'max_per_day', v_settings.max_per_day,
    'wall', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'brand', s.brand_name, 'website', s.website,
                                                          'hasLogo', s.logo_path IS NOT NULL) ORDER BY s.created_at)
                        FROM public.sponsor_signups s
                       WHERE s.show_on_wall AND s.wall_ok
                         AND NOT public.is_seed_email(s.email)), '[]'::jsonb),
    'testimonials', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'quote', t.quote, 'name', t.name, 'brand', t.brand)
                                               ORDER BY t.created_at)
                                FROM public.sponsor_testimonials t WHERE t.approved), '[]'::jsonb),
    'stats', jsonb_build_object('group_members', v_settings.group_members, 'page_followers', v_settings.page_followers,
                                'monthly_visitors', v_settings.monthly_visitors),
    'has_founder_photo', v_settings.founder_photo_path IS NOT NULL
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_public_state(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_public_state(text) TO anon, authenticated, service_role;

-- ── The wall's logo endpoint: same rule (p_any = the admin's own preview) ──────
CREATE OR REPLACE FUNCTION public.sponsor_service_logo_path(p_signup_id uuid, p_any boolean DEFAULT false)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.logo_path FROM public.sponsor_signups s
   WHERE s.id = p_signup_id
     AND (p_any OR (s.show_on_wall AND s.wall_ok));
$function$;
REVOKE ALL ON FUNCTION public.sponsor_service_logo_path(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_service_logo_path(uuid, boolean) TO service_role;
