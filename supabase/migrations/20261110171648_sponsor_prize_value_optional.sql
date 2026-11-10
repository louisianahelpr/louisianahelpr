-- 25 Days sponsor sign-ups: the prize value is no longer asked (owner 11-10: "I don't like asking the approximate
-- value of the gift"). sponsor_signups.prize_value (20261109162829) becomes optional: NULL = not given. The CHECK
-- (1..100000) stays and still bounds any value that IS given (a CHECK passes on NULL). sponsor_create_signup and
-- sponsor_admin_add_signup are restated verbatim except that an absent, JSON-null or blank prize_value is stored
-- as NULL (nullif(btrim(...), '')) instead of failing the old NOT NULL. Grants restated as they were.
-- Replay-safe: DROP NOT NULL and CREATE OR REPLACE are idempotent; the ALTER is guarded on the table.

DO $do$
BEGIN
  IF to_regclass('public.sponsor_signups') IS NOT NULL THEN
    ALTER TABLE public.sponsor_signups ALTER COLUMN prize_value DROP NOT NULL;
  END IF;
END
$do$;

-- ── The sign-up (service role only: the sponsor-25days function, after validating) ──
CREATE OR REPLACE FUNCTION public.sponsor_create_signup(p_user_id uuid, p_signup jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := COALESCE((p_signup->>'id')::uuid, gen_random_uuid());
  v_days smallint[];
  v_any boolean := COALESCE((p_signup->>'any_day')::boolean, false);
  v_max integer;
  v_full smallint[];
BEGIN
  IF NOT public.sponsor_25days_on_for(p_user_id) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT d::smallint ORDER BY d::smallint), '{}')
    INTO v_days
    FROM jsonb_array_elements_text(COALESCE(p_signup->'days', '[]'::jsonb)) AS d;
  IF EXISTS (SELECT 1 FROM unnest(v_days) d WHERE d NOT BETWEEN 1 AND 25) THEN
    RAISE EXCEPTION 'invalid_day' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_days) = 0 AND NOT v_any THEN
    RAISE EXCEPTION 'no_day' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_days) > 0 THEN v_any := false; END IF;

  -- The cap: one sign-up at a time decides it (transaction-scoped lock), so two brands racing for the last
  -- spot on a day cannot both get it.
  PERFORM pg_advisory_xact_lock(hashtext('sponsor_25days_days'));
  SELECT max_per_day INTO v_max FROM public.sponsor_settings WHERE id;
  IF v_max IS NOT NULL AND cardinality(v_days) > 0 THEN
    SELECT COALESCE(array_agg(d ORDER BY d), '{}') INTO v_full
      FROM unnest(v_days) d
     WHERE (SELECT count(*) FROM public.sponsor_days sd
              JOIN public.sponsor_signups ss ON ss.id = sd.signup_id
             WHERE sd.day = d AND NOT public.is_seed_email(ss.email)) >= v_max;  -- the same count the page shows
    IF cardinality(v_full) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'full_days', to_jsonb(v_full));
    END IF;
  END IF;

  INSERT INTO public.sponsor_signups (id, brand_name, contact_name, email, phone, website, instagram, facebook, tiktok,
                                      prize_description, prize_value, ship_to, notes, any_day, wall_ok, show_on_wall,
                                      logo_path, ref_code, source)
  VALUES (v_id, btrim(p_signup->>'brand_name'), btrim(p_signup->>'contact_name'), lower(btrim(p_signup->>'email')),
          nullif(btrim(p_signup->>'phone'), ''), nullif(btrim(p_signup->>'website'), ''),
          nullif(btrim(p_signup->>'instagram'), ''), nullif(btrim(p_signup->>'facebook'), ''),
          nullif(btrim(p_signup->>'tiktok'), ''), btrim(p_signup->>'prize_description'),
          nullif(btrim(p_signup->>'prize_value'), '')::integer, nullif(p_signup->>'ship_to', ''), nullif(btrim(p_signup->>'notes'), ''),
          v_any, COALESCE((p_signup->>'wall_ok')::boolean, false), COALESCE((p_signup->>'wall_ok')::boolean, false),
          nullif(p_signup->>'logo_path', ''), nullif(p_signup->>'ref_code', ''), 'form');
  INSERT INTO public.sponsor_days (signup_id, day) SELECT v_id, d FROM unnest(v_days) d;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'days', to_jsonb(v_days), 'any_day', v_any);
END;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_create_signup(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sponsor_create_signup(uuid, jsonb) TO service_role;

-- A sponsor added by hand (e.g. one who signed up by email). Skips the cap; no emails are sent.
CREATE OR REPLACE FUNCTION public.sponsor_admin_add_signup(p_signup jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := gen_random_uuid();
  v_days smallint[];
  v_wall boolean := COALESCE((p_signup->>'wall_ok')::boolean, false);
BEGIN
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.sponsor_require_admin();  -- the admin check again, plus the switch
  SELECT COALESCE(array_agg(DISTINCT d::smallint ORDER BY d::smallint), '{}')
    INTO v_days FROM jsonb_array_elements_text(COALESCE(p_signup->'days', '[]'::jsonb)) AS d;
  INSERT INTO public.sponsor_signups (id, brand_name, contact_name, email, prize_description, prize_value, any_day,
                                      status, wall_ok, show_on_wall, source)
  VALUES (v_id, btrim(p_signup->>'brand_name'), btrim(p_signup->>'contact_name'), lower(btrim(p_signup->>'email')),
          btrim(p_signup->>'prize_description'), nullif(btrim(p_signup->>'prize_value'), '')::integer, cardinality(v_days) = 0,
          COALESCE(nullif(p_signup->>'status', ''), 'pending'), v_wall, v_wall AND COALESCE((p_signup->>'show_on_wall')::boolean, false),
          'admin');
  INSERT INTO public.sponsor_days (signup_id, day) SELECT v_id, d FROM unnest(v_days) d;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES ((SELECT auth.uid()), 'sponsor_signup_added', 'sponsor_signup', v_id::text,
          jsonb_build_object('brand', btrim(p_signup->>'brand_name'), 'days', to_jsonb(v_days)));
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.sponsor_admin_add_signup(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sponsor_admin_add_signup(jsonb) TO authenticated, service_role;
