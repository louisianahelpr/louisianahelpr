-- Small Business Saturday "Featured local" listings (owner 2026-11-20: "add a feature on the small business page for
-- the louisana comanies where people can add their companies to be featured for free like submit a form or soemthing
-- and we review and then it gets added ot htat pae f they are particating in sall business saturdy"; approved the same
-- day: "ok lets do it. and our small business sponsers still get lsited a the to of the list with a badge").
--
-- A Louisiana business taking part in Small Business Saturday (Nov 28) asks, for free, to be listed on
-- /gift-guides/small-business-saturday. Every submission starts PENDING and shows nowhere until an admin approves it:
-- the owner asked for review here, which overrides the usual live-at-once rule for this one table.
--
-- AUTHZ (lh-authz-rls): 1 table, 1 private bucket, 6 functions.
--   * The table: RLS on, NO policy, every privilege revoked from PUBLIC, anon and authenticated. No browser reads
--     or writes it directly; the contact email is never readable by the public.
--   * Public read: sbs_public_featured() returns APPROVED rows only, never contact_email, never a test address's row.
--   * Public write: only the sbs-featured edge function (service role), which checks the fields, the link (it must
--     load), profanity and link spam, motels and inns (owner rule 11-20), and a per-address and per-device rate limit,
--     then calls sbs_service_create (service role only), which checks the town against louisiana_zip_parishes and
--     the duplicate/per-email caps again on the server.
--   * sbs_admin_list / sbs_admin_review: authenticated, each checks has_role(auth.uid(), 'admin') itself; review
--     writes an admin_audit_log row (Q76).
--   * sbs_service_logo_path: service role only (the edge function serves logos from the private bucket).
--
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT; grants restated by role name.

CREATE TABLE IF NOT EXISTS public.sbs_featured_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  business_name text NOT NULL CHECK (length(btrim(business_name)) BETWEEN 2 AND 80),
  town text NOT NULL CHECK (length(btrim(town)) BETWEEN 2 AND 60),
  -- One of the page's sections (SBS_CATEGORIES, checked by the edge function and again by sbs_service_create).
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 40),
  link text NOT NULL CHECK (length(link) BETWEEN 10 AND 300 AND link ~ '^https://[^\s]+$'),
  deal text CHECK (deal IS NULL OR length(deal) <= 200),
  logo_path text CHECK (logo_path IS NULL OR logo_path ~ '^submissions/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  -- Private: admins only (sbs_admin_list). Never in sbs_public_featured.
  contact_email text NOT NULL CHECK (length(contact_email) BETWEEN 6 AND 254 AND contact_email !~ '\s' AND contact_email LIKE '%_@_%.__%'),
  participating boolean NOT NULL CHECK (participating),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sbs_featured_submissions_status_idx ON public.sbs_featured_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS sbs_featured_submissions_email_idx ON public.sbs_featured_submissions (lower(contact_email), created_at);
CREATE INDEX IF NOT EXISTS sbs_featured_submissions_reviewed_by_idx ON public.sbs_featured_submissions (reviewed_by);

ALTER TABLE public.sbs_featured_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.sbs_featured_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sbs_featured_submissions TO service_role;
-- Every public table carries the unconfirmed-email gate trigger (20260927234313); the service role passes it.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The private logo bucket: no storage.objects policy, so only the service role (sbs-featured) reads or writes it.
-- 2 MB, PNG/JPEG/WebP (the function checks the bytes too). No SVG: a stranger's SVG is never stored.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sbs-logos', 'sbs-logos', false, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── The town key: "Saint Martinville", "St Martinville" and "st. martinville" are one town. ─────────────────────
CREATE OR REPLACE FUNCTION public.sbs_town_key(p_town text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(lower(btrim(COALESCE(p_town, ''))),
           '(,\s*|\s+)(la|louisiana)$', ''), '^(saint|st\.?)\s+', 'st '), '[^a-z0-9 ]+', '', 'g'));
$function$;
REVOKE ALL ON FUNCTION public.sbs_town_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sbs_town_key(text) TO service_role;

-- ── Public read: approved listings, no contact email, no test rows. ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sbs_public_featured()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.business_name, 'town', s.town, 'category', s.category, 'link', s.link,
           'deal', s.deal, 'has_logo', s.logo_path IS NOT NULL) ORDER BY s.reviewed_at, s.created_at), '[]'::jsonb)
    FROM public.sbs_featured_submissions s
   WHERE s.status = 'approved'
     AND NOT public.is_seed_email(s.contact_email);
$function$;
REVOKE ALL ON FUNCTION public.sbs_public_featured() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sbs_public_featured() TO anon, authenticated, service_role;

-- ── Public write (service role only, from the sbs-featured edge function after its own checks). ─────────────────
CREATE OR REPLACE FUNCTION public.sbs_service_create(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := COALESCE(nullif(p_row->>'id', '')::uuid, gen_random_uuid());
  v_name text := btrim(COALESCE(p_row->>'business_name', ''));
  v_town text := btrim(COALESCE(p_row->>'town', ''));
  v_email text := lower(btrim(COALESCE(p_row->>'contact_email', '')));
  v_city text;
BEGIN
  -- The town is in Louisiana: a USPS town in louisiana_zip_parishes (the same table the app's ZIP lookup reads),
  -- or a parish name ("Lafayette Parish").
  SELECT z.city INTO v_city
    FROM public.louisiana_zip_parishes z
   WHERE public.sbs_town_key(z.city) = public.sbs_town_key(v_town)
      OR public.sbs_town_key(z.parish) = regexp_replace(public.sbs_town_key(v_town), '\s+parish$', '')
   LIMIT 1;
  IF v_city IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'town');
  END IF;
  IF COALESCE(p_row->>'category', '') NOT IN ('Food & Sweets', 'Home & Decor', 'Art & Gifts', 'Fashion & Accessories',
                                             'Beauty & Wellness', 'Kids', 'Experiences & Tours', 'Services') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'category');
  END IF;
  -- Motels and inns are not listed (owner rule 11-20); the edge function checks this first, this holds it.
  IF v_name ~* '\m(motels?|inns?|motor (lodge|inn))\M' OR COALESCE(p_row->>'deal', '') ~* '\m(motels?|inns?|motor (lodge|inn))\M' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lodging');
  END IF;
  -- One listing per business and town (a resubmission while one is pending or approved is a duplicate).
  IF EXISTS (SELECT 1 FROM public.sbs_featured_submissions s
              WHERE lower(s.business_name) = lower(v_name) AND public.sbs_town_key(s.town) = public.sbs_town_key(v_town)
                AND s.status IN ('pending', 'approved')) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate');
  END IF;
  -- At most 3 submissions per contact email per day.
  IF (SELECT count(*) FROM public.sbs_featured_submissions s
       WHERE lower(s.contact_email) = v_email AND s.created_at > now() - interval '1 day') >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate');
  END IF;
  INSERT INTO public.sbs_featured_submissions (id, business_name, town, category, link, deal, logo_path, contact_email, participating)
  VALUES (v_id, v_name, v_town, p_row->>'category', p_row->>'link', nullif(btrim(COALESCE(p_row->>'deal', '')), ''),
          nullif(p_row->>'logo_path', ''), v_email, COALESCE((p_row->>'participating')::boolean, false));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'test', public.is_seed_email(v_email));
END;
$function$;
REVOKE ALL ON FUNCTION public.sbs_service_create(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sbs_service_create(jsonb) TO service_role;

-- The logo's storage path: an approved listing's for anyone (p_any false), any listing's for an admin (p_any true;
-- the edge function checks the admin role before asking).
CREATE OR REPLACE FUNCTION public.sbs_service_logo_path(p_id uuid, p_any boolean)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT s.logo_path FROM public.sbs_featured_submissions s
   WHERE s.id = p_id AND (p_any OR s.status = 'approved');
$function$;
REVOKE ALL ON FUNCTION public.sbs_service_logo_path(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sbs_service_logo_path(uuid, boolean) TO service_role;

-- ── Admin: the review queue and one-tap approve/reject. ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sbs_admin_list()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Test data never shows to the owner: a test address's submission is left out.
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', s.id, 'created_at', s.created_at, 'business_name', s.business_name, 'town', s.town,
            'category', s.category, 'link', s.link, 'deal', s.deal, 'has_logo', s.logo_path IS NOT NULL,
            'contact_email', s.contact_email, 'status', s.status, 'reviewed_at', s.reviewed_at)
            ORDER BY (s.status = 'pending') DESC, s.created_at DESC)
     FROM (SELECT * FROM public.sbs_featured_submissions x
            WHERE NOT public.is_seed_email(x.contact_email)
            ORDER BY x.created_at DESC LIMIT 500) s), '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sbs_admin_review(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.sbs_featured_submissions
     SET status = p_status, updated_at = now(),
         reviewed_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END,
         reviewed_by = CASE WHEN p_status = 'pending' THEN NULL ELSE (SELECT auth.uid()) END
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'PT404'; END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES ((SELECT auth.uid()), 'sbs_featured_review', 'sbs_featured_submission', p_id::text, jsonb_build_object('status', p_status));
END;
$function$;

REVOKE ALL ON FUNCTION public.sbs_admin_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sbs_admin_list() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sbs_admin_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sbs_admin_review(uuid, text) TO authenticated, service_role;

COMMENT ON TABLE public.sbs_featured_submissions IS
  'Small Business Saturday free "Featured local" listings (owner 2026-11-20). Pending until an admin approves. '
  'contact_email is admin-only. Written only by the sbs-featured edge function via sbs_service_create.';
