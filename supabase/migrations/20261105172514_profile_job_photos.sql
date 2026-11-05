-- Owner 11-05 (~1:40 PM, after the share-profile audit H4): the shareable profile shows "any of the work they put
-- pictures of". All three options combined:
--   (1) Recent-work uploads (profiles.portfolio_urls) always show: already in public_profile_by_handle.
--   (2) A job's AFTER photos may show, but only while the poster AND every Helpr booked on that job allow sharing
--       (profiles.share_job_photos, the "Let Helpr share my job photos" consent of 20261021001940).
--   (3) The Helpr PICKS which of their job photos go on their page; nothing from a job shows by default.
-- A photo shows only while (2) AND (3) both hold, the job is completed and real (not test), the photo is still one
-- of that job's after photos, and the Helpr's page itself is public (the gate public_profile_by_handle uses).
--
-- What leaves the database for a visitor: a random pick id, the job's category and the month it was completed.
-- Never the job id, the storage path (it names a job or a member), the address or the customer's name. The image
-- itself is served by the profile-work-photo edge function, which calls profile_work_photo_object (service_role
-- only) to re-check every rule on every fetch and re-encodes the image before it leaves the server.
--
-- NEW: table profile_job_photos (no table grants; RPCs only), job_photos_withheld (service_role only; NOT the rule of
-- job_photos_shareable, without its admin gate), profile_page_hidden (service_role only; public_profile_by_handle's
-- page gate, inverted), my_job_photos / set_job_photo_shown (authenticated: the Helpr's own picks),
-- public_profile_work_photos (anon + authenticated), profile_work_photo_object (service_role only).
-- REPLAY-SAFE: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, grants restated. MONEY: none.
-- Proof: src/test/pglite/profileJobPhotos.pglite.mjs (3x; --before red).

CREATE TABLE IF NOT EXISTS public.profile_job_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  photo_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_job_photos_once UNIQUE (user_id, job_id, photo_path)
);
CREATE INDEX IF NOT EXISTS profile_job_photos_job_idx ON public.profile_job_photos (job_id);
COMMENT ON TABLE public.profile_job_photos IS
  'Owner 11-05: the job after photos a Helpr picked for their public page. Shown only while the poster and every booked Helpr allow sharing (NOT job_photos_withheld). Written only through set_job_photo_shown.';
ALTER TABLE public.profile_job_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_job_photos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.profile_job_photos TO service_role;

-- (2) The consent rule of job_photos_shareable (20261021001940), without its admin gate, as a DENY: TRUE = this job's
-- photos are withheld (no poster, no Helpr, or anyone on it has not allowed sharing). Deny-shaped so a NULL job says
-- TRUE (withheld), the safe answer (scripts/ci/null-arg-validators.sql).
CREATE OR REPLACE FUNCTION public.job_photos_withheld(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_poster uuid;
  v_helprs uuid[];
BEGIN
  SELECT j.customer_id INTO v_poster FROM public.jobs j WHERE j.id = p_job_id;
  IF v_poster IS NULL THEN
    RETURN true;
  END IF;
  v_helprs := public.job_booked_helpr_ids(p_job_id);
  IF v_helprs IS NULL OR cardinality(v_helprs) = 0 THEN
    RETURN true;
  END IF;
  RETURN (SELECT count(*) FROM public.profiles p
           WHERE p.user_id = ANY (v_helprs || v_poster) AND p.share_job_photos)
         <> cardinality(ARRAY(SELECT DISTINCT u FROM unnest(v_helprs || v_poster) u));
END;
$fn$;
REVOKE ALL ON FUNCTION public.job_photos_withheld(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_photos_withheld(uuid) TO service_role;

-- The page gate of public_profile_by_handle (20261105165059), as a DENY: TRUE = no public page (no handle, unverified,
-- banned in any form, seed, deleted, out of Declutter, under 18 or a test member). A NULL member is hidden.
CREATE OR REPLACE FUNCTION public.profile_page_hidden(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
  SELECT NOT (EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = p_user_id
                    AND p.handle IS NOT NULL
                    AND p.email_verified
                    AND p.ban_status IS DISTINCT FROM 'banned'
                    AND p.ban_status IS DISTINCT FROM 'temp_banned'
                    AND p.ban_status IS DISTINCT FROM 'permanently_banned'
                    AND p.is_seed IS NOT TRUE
                    AND p.anonymized_at IS NULL)
     AND NOT public.declutter_member_out(p_user_id)
     AND NOT COALESCE(public.member_under_18(p_user_id), true)
     AND NOT public.is_test_member(p_user_id));
$fn$;
REVOKE ALL ON FUNCTION public.profile_page_hidden(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_page_hidden(uuid) TO service_role;

-- A completed, real job's after photos that belong to this Helpr: the job's own after photos when they are its
-- booked Helpr, and their own roster row's after photos on a crew job. Bare storage paths only (a legacy full URL
-- is never offered or served).
CREATE OR REPLACE FUNCTION public.helpr_job_after_photos(p_user_id uuid)
RETURNS TABLE (job_id uuid, photo_path text, category text, completed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
  SELECT DISTINCT x.job_id, x.photo_path, x.category, x.completed_at
    FROM (
      SELECT j.id AS job_id, u AS photo_path, j.category::text AS category, coalesce(j.completed_at, j.updated_at) AS completed_at
        FROM public.jobs j
        CROSS JOIN LATERAL unnest(coalesce(j.proof_after_urls, ARRAY[]::text[])) u
       WHERE p_user_id = ANY (public.job_booked_helpr_ids(j.id))
         AND (j.helper_id = p_user_id OR j.is_group_job IS TRUE)
      UNION ALL
      SELECT j.id, u, j.category::text, coalesce(j.completed_at, j.updated_at)
        FROM public.group_job_helpers g
        JOIN public.jobs j ON j.id = g.job_id AND j.is_group_job IS TRUE
        CROSS JOIN LATERAL unnest(coalesce(g.proof_after_urls, ARRAY[]::text[])) u
       WHERE g.helper_id = p_user_id
    ) x
    JOIN public.jobs j2 ON j2.id = x.job_id
   WHERE p_user_id IS NOT NULL
     AND j2.status::text = 'completed'
     AND j2.is_seed IS NOT TRUE
     AND NOT public.is_test_member(j2.customer_id)
     AND x.photo_path IS NOT NULL
     AND x.photo_path <> ''
     AND x.photo_path !~ '://'
     AND x.photo_path !~ '(^/|\.\.)'
     -- A photo belongs to the job it is listed on: its storage path starts with that job's id. Without this, an
     -- assigned Helpr (who can still edit proof_after_urls on a completed job) could copy job A's in-home photo,
     -- whose customer said no, into job B's list and show it under job B's consent (lh-authz-rls BLOCK, 11-05).
     -- Every one of the 146 live after-photo paths on completed jobs starts with its own job id.
     AND split_part(x.photo_path, '/', 1) = x.job_id::text;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_job_after_photos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_job_after_photos(uuid) TO service_role;

-- (3) The Helpr's own list: every after photo they could show, whether it is shown, and whether the job's people
-- allow sharing (so the page can say why a ticked photo is not showing yet).
CREATE OR REPLACE FUNCTION public.my_job_photos()
RETURNS TABLE (job_id uuid, photo_path text, category text, month text, shown boolean, consented boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
SET "TimeZone" TO 'America/Chicago'
AS $fn$
  SELECT a.job_id, a.photo_path, a.category, to_char(a.completed_at, 'YYYY-MM'),
         EXISTS (SELECT 1 FROM public.profile_job_photos pp
                  WHERE pp.user_id = auth.uid() AND pp.job_id = a.job_id AND pp.photo_path = a.photo_path),
         NOT public.job_photos_withheld(a.job_id)
    FROM public.helpr_job_after_photos(auth.uid()) a
   ORDER BY a.completed_at DESC, a.photo_path
   LIMIT 200;
$fn$;
REVOKE ALL ON FUNCTION public.my_job_photos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_job_photos() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_job_photo_shown(p_job_id uuid, p_photo_path text, p_shown boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_shown IS NOT TRUE THEN
    -- Taking a photo off is always allowed (even a photo no longer on the job).
    DELETE FROM public.profile_job_photos
     WHERE user_id = v_uid AND job_id = p_job_id AND photo_path = p_photo_path;
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.helpr_job_after_photos(v_uid) a
                  WHERE a.job_id = p_job_id AND a.photo_path = p_photo_path) THEN
    RAISE EXCEPTION 'not_your_job_photo' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.profile_job_photos (user_id, job_id, photo_path)
  VALUES (v_uid, p_job_id, p_photo_path)
  ON CONFLICT ON CONSTRAINT profile_job_photos_once DO NOTHING;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_job_photo_shown(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_job_photo_shown(uuid, text, boolean) TO authenticated, service_role;

-- Every rule at once, for one pick: (2) consent, (3) picked, still that Helpr's after photo of a completed real job,
-- and the Helpr's page is public. The one definition both reads below use.
CREATE OR REPLACE FUNCTION public.profile_job_photo_visible(p_pick_id uuid)
RETURNS TABLE (user_id uuid, photo_path text, category text, month text, completed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
SET "TimeZone" TO 'America/Chicago'
AS $fn$
  SELECT pp.user_id, pp.photo_path, a.category, to_char(a.completed_at, 'YYYY-MM'), a.completed_at
    FROM public.profile_job_photos pp
    JOIN LATERAL public.helpr_job_after_photos(pp.user_id) a
      ON a.job_id = pp.job_id AND a.photo_path = pp.photo_path
   WHERE pp.id = p_pick_id
     AND NOT public.profile_page_hidden(pp.user_id)
     AND NOT public.job_photos_withheld(pp.job_id)
   LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.profile_job_photo_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_job_photo_visible(uuid) TO service_role;

-- The visitor's read: pick id, category and month only, newest first, 60 at most.
CREATE OR REPLACE FUNCTION public.public_profile_work_photos(p_handle text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
DECLARE
  v_handle text := lower(btrim(coalesce(p_handle, '')));
  v_uid uuid;
BEGIN
  IF v_handle = '' OR length(v_handle) > 30 THEN
    RETURN '[]'::jsonb;
  END IF;
  -- The same handle resolution as public_profile_by_handle (a retired handle opens its owner's current page).
  SELECT p.user_id INTO v_uid
    FROM public.profiles p
   WHERE p.handle = v_handle
      OR (p.handle IS NOT NULL
          AND p.user_id = (SELECT r.user_id FROM public.profile_handles_retired r
                            WHERE r.handle = v_handle AND r.user_id IS NOT NULL))
   ORDER BY (p.handle = v_handle) DESC
   LIMIT 1;
  IF v_uid IS NULL OR public.profile_page_hidden(v_uid) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', q.id, 'category', q.category, 'month', q.month) ORDER BY q.completed_at DESC, q.id)
      FROM (
        SELECT pp.id, v.category, v.month, v.completed_at
          FROM public.profile_job_photos pp
          CROSS JOIN LATERAL public.profile_job_photo_visible(pp.id) v
         WHERE pp.user_id = v_uid
         ORDER BY v.completed_at DESC, pp.id
         LIMIT 60
      ) q), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.public_profile_work_photos(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_profile_work_photos(text) TO anon, authenticated, service_role;

-- The edge function's lookup: the storage path of a pick that is visible right now, else NULL (one answer for every
-- refusal).
CREATE OR REPLACE FUNCTION public.profile_work_photo_object(p_pick_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $fn$
  SELECT v.photo_path FROM public.profile_job_photo_visible(p_pick_id) v LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.profile_work_photo_object(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_work_photo_object(uuid) TO service_role;
