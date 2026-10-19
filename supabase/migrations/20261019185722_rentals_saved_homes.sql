-- HOMES: save a home (owner-approved card design, 2026-10-19 14:55Z: the
-- Zillow / Airbnb heart on every Homes card, and a Saved list under Homes).
--
-- 1. saved_homes: one row per (member, listing). The member reads only their
--    own rows (RLS: user_id = auth.uid()); there is no client write grant.
--    Rows go when the member's account goes (auth.users cascade) and when
--    the listing row is deleted (rental_listings cascade). A listing that is
--    paused, expired or taken down keeps its row but drops out of the Saved
--    list (rentals_saved_listings reads through rentals_listing_visible), so
--    it comes back if the home is listed again.
-- 2. rentals_set_saved_home(listing, saved): the one write. Saving needs the
--    'rentals' switch, a member who is not banned, and a listing the member
--    can see in Browse (rentals_listing_visible); it is never their own
--    listing; at most 100 per member (the Saved list shows 100, so nothing is
--    ever silently hidden: too_many_saved_homes). Unsaving always works for a confirmed member.
-- 3. rentals_saved_listings(): the Saved list, both kinds, newest saved first,
--    with exactly the public facts Browse shows (city and ZIP, never the
--    street; photo refs, never storage paths: Q2213).
--
-- Download My Data gains saved_homes in 20261019185723.
-- Replay-safe: IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE.

CREATE TABLE IF NOT EXISTS public.saved_homes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.rental_listings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS saved_homes_listing_idx ON public.saved_homes (listing_id);
-- The unconfirmed-email write gate every member table carries (20260927234313; DB Smoke checks it).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;
ALTER TABLE public.saved_homes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saved_homes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.saved_homes TO authenticated;
GRANT ALL ON TABLE public.saved_homes TO service_role;
DROP POLICY IF EXISTS "saved homes: member reads own" ON public.saved_homes;
CREATE POLICY "saved homes: member reads own" ON public.saved_homes
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
COMMENT ON TABLE public.saved_homes IS
  'Homes a member saved (the heart on a Homes card). Written only by rentals_set_saved_home.';

CREATE OR REPLACE FUNCTION public.rentals_set_saved_home(p_listing_id uuid, p_saved boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_saved IS NOT TRUE THEN
    DELETE FROM public.saved_homes WHERE user_id = v_uid AND listing_id = p_listing_id;
    RETURN false;
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_listing_id IS NULL OR NOT public.rentals_listing_visible(p_listing_id) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rental_listings l WHERE l.id = p_listing_id AND l.owner_id = v_uid) THEN
    RAISE EXCEPTION 'own_listing' USING ERRCODE = '22023';
  END IF;
  -- One member's saves are counted under one lock, so two saves at once never pass 100.
  PERFORM pg_advisory_xact_lock(hashtext('saved_homes:' || v_uid::text));
  IF NOT EXISTS (SELECT 1 FROM public.saved_homes WHERE user_id = v_uid AND listing_id = p_listing_id)
     AND (SELECT count(*) FROM public.saved_homes WHERE user_id = v_uid) >= 100 THEN
    RAISE EXCEPTION 'too_many_saved_homes' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.saved_homes (user_id, listing_id) VALUES (v_uid, p_listing_id)
  ON CONFLICT (user_id, listing_id) DO NOTHING;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_saved_home(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_saved_home(uuid, boolean) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.rentals_saved_listings();
CREATE OR REPLACE FUNCTION public.rentals_saved_listings()
RETURNS TABLE (
  id uuid,
  kind text,
  headline text,
  rent_cents integer,
  rent_frequency text,
  sale_price_cents bigint,
  beds numeric,
  baths numeric,
  sq_ft integer,
  available_on date,
  city text,
  zip_code text,
  photo_refs text[],
  saved_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('rentals');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.id, l.kind, l.headline, l.rent_cents, l.rent_frequency, l.sale_price_cents,
         l.beds, l.baths, l.sq_ft, l.available_on,
         rp.city, rp.zip_code,
         ARRAY(SELECT public.rentals_photo_ref(ph.id, 'm') FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position LIMIT 5),
         s.created_at
    FROM public.saved_homes s
    JOIN public.rental_listings l ON l.id = s.listing_id
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE s.user_id = v_uid
     AND public.rentals_listing_visible(l.id)
   ORDER BY s.created_at DESC, l.id
   LIMIT 100;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_saved_listings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_saved_listings() TO authenticated, service_role;
