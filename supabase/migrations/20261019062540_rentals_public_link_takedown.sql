-- HOMES: the public listing link (D12) and the admin take-down (Q2187).
--
-- D12 (owner 2026-10-18): a listing's link is viewable by ANYONE who has it
-- (signed out too), shows no exact address, and stays hidden from search
-- engines until Homes opens (the page sets noindex; robots.txt and the sitemap
-- leave /r/ out). The link is /r/<slug>, the listing's random 12-hex code.
--
--   rentals_public_listing(p_slug)  anon + authenticated. The same coarse
--     fields as the signed-in page (city + ZIP, never the street, Q12), no
--     owner id, no listing id, and PHOTO IDS instead of storage paths: a path
--     starts with the landlord's user id (Q2188), so a stranger gets ids only
--     and the photos are served by id through the listing-photo proxy.
--     Shown only while the listing is visible (live, not expired, ownership
--     approved, owner not banned, not taken down) and the 'rentals' switch is
--     not off. A stranger is never told a hidden listing exists (P0002).
--   rentals_public_listing_photo_path(p_photo_id)  service_role only: the
--     proxy's lookup. NULL unless the photo's listing is publicly visible.
--
-- Q2187: rentals_admin_remove_listing(p_listing_id, p_reason) lets an admin
-- take down a LIVE or PAUSED listing (rent or sale). The take-down is on the
-- PROPERTY (lead review of slices 2+3, 2026-10-19, must-fix 1, 2, 6, 7): every
-- open listing on it (draft, live, paused, either kind, any unit) is removed,
-- and nothing on that property can be saved, given photos or published again
-- (trigger rentals_listing_takedown_guard), so a new unit or the other kind
-- cannot dodge it. It writes admin_audit_log and tells the owner why.
-- rentals_admin_lift_takedown(p_property_id, p_note) undoes a mistaken one
-- (audited): the flag clears and each listing it removed goes back to draft
-- (a draft) or paused (a live or paused one) for its owner to publish again.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, constraints dropped before added,
-- CREATE OR REPLACE, grants restated by role name. Proof:
-- src/test/pglite/homesPublicLink.pglite.mjs (3x).

-- ---------------------------------------------------------------------------
-- 1. Who took a listing down, and why (the owner sees the reason).
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS removed_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS removed_reason text;
ALTER TABLE public.rental_listings ADD COLUMN IF NOT EXISTS removed_from_status text;
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_removed_from_status_check;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_removed_from_status_check
  CHECK (removed_from_status IS NULL OR removed_from_status IN ('draft', 'live', 'paused'));
-- The take-down is on the property: while set, nothing on it is listed again.
ALTER TABLE public.rental_properties ADD COLUMN IF NOT EXISTS listings_taken_down_at timestamptz;
ALTER TABLE public.rental_properties ADD COLUMN IF NOT EXISTS listings_taken_down_reason text;
-- The owner reads them (the take-down banner); rental_properties is column-granted (never ownership_reviewed_by).
GRANT SELECT (listings_taken_down_at, listings_taken_down_reason) ON public.rental_properties TO authenticated;
ALTER TABLE public.rental_listings DROP CONSTRAINT IF EXISTS rental_listings_removed_reason_len;
ALTER TABLE public.rental_listings ADD CONSTRAINT rental_listings_removed_reason_len
  CHECK (removed_reason IS NULL OR char_length(removed_reason) BETWEEN 5 AND 500);

-- ---------------------------------------------------------------------------
-- 2. The admin take-down (Q2187), on the property.
CREATE OR REPLACE FUNCTION public.rentals_admin_remove_listing(p_listing_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_l public.rental_listings%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
BEGIN
  -- Moderation is never gated by the feature switch (review fix #7): an admin can take a listing down
  -- whatever the 'rentals' audience is.
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 5 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_l FROM public.rental_listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Only a listing people can see or the owner can put back up (live or paused); history (sold, leased,
  -- removed) is not taken down (lead review must-fix 6).
  IF v_l.status NOT IN ('live', 'paused') THEN
    RAISE EXCEPTION 'listing_not_live' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.rental_properties WHERE id = v_l.property_id FOR UPDATE;
  UPDATE public.rental_properties
     SET listings_taken_down_at = now(), listings_taken_down_reason = v_reason
   WHERE id = v_l.property_id;
  -- Every OPEN listing on the property goes, either kind, any unit (must-fix 2).
  WITH gone AS (
    UPDATE public.rental_listings
       SET removed_from_status = status, status = 'removed', removed_by_admin = true, removed_reason = v_reason,
           updated_at = now()
     WHERE property_id = v_l.property_id AND status IN ('draft', 'live', 'paused')
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM gone;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_listing_removed', 'rental_listing', p_listing_id::text,
          jsonb_build_object('reason', v_reason, 'kind', v_l.kind, 'status_before', v_l.status,
                             'property_id', v_l.property_id, 'listings_removed', to_jsonb(v_ids)));
  PERFORM public.rentals_notify(v_l.owner_id, 'Listing removed',
    'Louisiana Helpr removed your listing "' || v_l.headline || '": ' || v_reason, '/rentals', true, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_remove_listing(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_remove_listing(uuid, text) TO authenticated, service_role;

-- 2b. Lifting a mistaken take-down (must-fix 6): audited; each listing it removed goes back to draft or
--     paused, never straight to live (the owner publishes again, through every publish check).
CREATE OR REPLACE FUNCTION public.rentals_admin_lift_takedown(p_property_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_p public.rental_properties%ROWTYPE;
  v_note text := btrim(coalesce(p_note, ''));
  v_ids uuid[];
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) < 5 OR char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_p FROM public.rental_properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND OR v_p.listings_taken_down_at IS NULL THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.rental_properties SET listings_taken_down_at = NULL, listings_taken_down_reason = NULL WHERE id = p_property_id;
  WITH back AS (
    UPDATE public.rental_listings
       SET status = CASE WHEN removed_from_status = 'draft' THEN 'draft' ELSE 'paused' END,
           removed_by_admin = false, removed_reason = NULL, removed_from_status = NULL, updated_at = now()
     WHERE property_id = p_property_id AND removed_by_admin AND status = 'removed' AND removed_from_status IS NOT NULL
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM back;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'rentals_takedown_lifted', 'rental_property', p_property_id::text,
          jsonb_build_object('note', v_note, 'reason_was', v_p.listings_taken_down_reason, 'listings_restored', to_jsonb(v_ids)));
  PERFORM public.rentals_notify(v_p.owner_id, 'Listing back',
    'Louisiana Helpr lifted the removal of your listings at ' || v_p.label || '. Open them to publish again.', '/rentals', true, true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_lift_takedown(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_lift_takedown(uuid, text) TO authenticated, service_role;

-- 2e. The take-down cannot be dodged by adding the same home again (lead review round 3, must-fix 3, and
--     round 4 #2). The address key is normalised: case, spacing and punctuation ignored, street suffixes and
--     directions shortened (street/st, avenue/ave, road/rd, north/n ...), a unit or apartment part dropped
--     (apt, unit, suite, #, ...: the take-down is on the building), ZIP+4 cut to the ZIP.
--       The SAME owner cannot add (or edit a property into) an address under one of their take-downs.
--       ANY OTHER owner's matching property is flagged to the ownership reviewer, who sees the matched
--       taken-down address (rentals_admin_takedown_matches, admin only). The ownership review also shows
--       the owner's own take-down history.
CREATE OR REPLACE FUNCTION public.rentals_address_key(p_street text, p_zip text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH s AS (
    -- '#4' is a unit too; then everything but letters and digits becomes one space, padded for the word match.
    SELECT ' ' || btrim(regexp_replace(replace(lower(coalesce(p_street, '')), '#', ' unit '), '[^a-z0-9]+', ' ', 'g')) || ' ' AS t
  ), h AS (
    SELECT t, substring(t from '^ [^ ]*') AS head FROM s
  ), u AS (
    -- The unit part goes, from its first designator on (never the first word: that is the house number).
    SELECT btrim(head || regexp_replace(substr(t, char_length(head) + 1),
                 ' (apt|apartment|unit|suite|ste|bldg|building|rm|room|trlr|trailer|spc|space)( .*)?$', ' ')) AS t FROM h
  )
  SELECT coalesce((SELECT string_agg(coalesce(m.short, w.tok), ' ' ORDER BY w.ord)
                     FROM unnest(string_to_array(u.t, ' ')) WITH ORDINALITY AS w(tok, ord)
                     LEFT JOIN (VALUES ('street', 'st'), ('str', 'st'), ('avenue', 'ave'), ('av', 'ave'), ('road', 'rd'),
                                       ('drive', 'dr'), ('drv', 'dr'), ('lane', 'ln'), ('boulevard', 'blvd'), ('blv', 'blvd'),
                                       ('court', 'ct'), ('place', 'pl'), ('highway', 'hwy'), ('hiway', 'hwy'), ('parkway', 'pkwy'),
                                       ('pky', 'pkwy'), ('circle', 'cir'), ('terrace', 'ter'), ('trail', 'trl'), ('square', 'sq'),
                                       ('expressway', 'expy'), ('freeway', 'fwy'), ('crossing', 'xing'), ('cove', 'cv'),
                                       ('point', 'pt'), ('loop', 'lp'), ('route', 'rte'), ('north', 'n'), ('south', 's'),
                                       ('east', 'e'), ('west', 'w'), ('northeast', 'ne'), ('northwest', 'nw'),
                                       ('southeast', 'se'), ('southwest', 'sw')) AS m(word, short) ON m.word = w.tok
                    WHERE w.tok <> ''), '')
         || '|' || left(regexp_replace(coalesce(p_zip, ''), '[^0-9]', '', 'g'), 5)
    FROM u;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_address_key(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_address_key(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rentals_property_takedown_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- The same owner is refused; another owner's match is flagged to the reviewer (rentals_admin_takedown_matches).
  IF EXISTS (SELECT 1 FROM public.rental_properties rp
              WHERE rp.owner_id = NEW.owner_id
                AND rp.id <> NEW.id
                AND rp.listings_taken_down_at IS NOT NULL
                AND public.rentals_address_key(rp.street_address, rp.zip_code) = public.rentals_address_key(NEW.street_address, NEW.zip_code)) THEN
    RAISE EXCEPTION 'property_taken_down' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_property_takedown_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rentals_property_takedown_guard ON public.rental_properties;
CREATE TRIGGER rentals_property_takedown_guard BEFORE INSERT OR UPDATE OF street_address, zip_code ON public.rental_properties
  FOR EACH ROW EXECUTE FUNCTION public.rentals_property_takedown_guard();

-- 2f. The ownership reviewer's flag (round 4 #2): for each property asked about, the taken-down properties
--     (ANY owner's) at the same normalised address, with the matched address. Admin only; the street is
--     shown here and nowhere outside the admin review.
CREATE OR REPLACE FUNCTION public.rentals_admin_takedown_matches(p_property_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF cardinality(coalesce(p_property_ids, '{}'::uuid[])) > 200 THEN
    RAISE EXCEPTION 'too_many' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'property_id', p.id, 'matched_property_id', t.id, 'matched_label', t.label,
             'matched_street', t.street_address, 'matched_city', t.city, 'matched_zip', t.zip_code,
             'reason', t.listings_taken_down_reason, 'taken_down_at', t.listings_taken_down_at,
             'same_owner', t.owner_id = p.owner_id)
           ORDER BY p.id, t.listings_taken_down_at DESC)
      FROM public.rental_properties p
      JOIN public.rental_properties t
        ON t.id <> p.id
       AND t.listings_taken_down_at IS NOT NULL
       AND public.rentals_address_key(t.street_address, t.zip_code) = public.rentals_address_key(p.street_address, p.zip_code)
     WHERE p.id = ANY (coalesce(p_property_ids, '{}'::uuid[]))), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_takedown_matches(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_takedown_matches(uuid[]) TO authenticated, service_role;

-- 2d. What the admin card lists (admin only, never switch-gated): live and paused listings to take down,
--     and properties under a take-down to lift. City + ZIP and the property label, never the street.
--     Round 4 #5: a search (a listing's link code, words of its headline or the property label, a ZIP) and
--     25 a page with totals, so no listing is out of reach.
CREATE OR REPLACE FUNCTION public.rentals_admin_listings(p_query text DEFAULT NULL, p_open_offset integer DEFAULT 0,
                                                         p_taken_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_open_off integer := greatest(coalesce(p_open_offset, 0), 0);
  v_taken_off integer := greatest(coalesce(p_taken_offset, 0), 0);
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_q) > 100 THEN
    RAISE EXCEPTION 'bad_query' USING ERRCODE = '22023';
  END IF;
  RETURN (
    WITH open_rows AS (
      SELECT l.id, l.kind, l.status, l.headline, l.slug, l.published_at, rp.label AS property_label, rp.city, rp.zip_code
        FROM public.rental_listings l
        JOIN public.rental_properties rp ON rp.id = l.property_id
       WHERE l.status IN ('live', 'paused')
         AND (v_q = '' OR l.slug = v_q OR rp.zip_code = v_q
              OR strpos(lower(l.headline), v_q) > 0 OR strpos(lower(rp.label), v_q) > 0)
    ), taken_rows AS (
      SELECT rp.id AS property_id, rp.label AS property_label, rp.city, rp.zip_code,
             rp.listings_taken_down_reason AS reason, rp.listings_taken_down_at AS taken_down_at
        FROM public.rental_properties rp
       WHERE rp.listings_taken_down_at IS NOT NULL
         AND (v_q = '' OR rp.zip_code = v_q OR strpos(lower(rp.label), v_q) > 0
              OR EXISTS (SELECT 1 FROM public.rental_listings l
                          WHERE l.property_id = rp.id AND (l.slug = v_q OR strpos(lower(l.headline), v_q) > 0)))
    )
    SELECT jsonb_build_object(
      'page_size', 25,
      'open_total', (SELECT count(*) FROM open_rows),
      'open', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.published_at DESC NULLS LAST, x.id)
                          FROM (SELECT * FROM open_rows ORDER BY published_at DESC NULLS LAST, id
                                 OFFSET v_open_off LIMIT 25) x), '[]'::jsonb),
      'taken_down_total', (SELECT count(*) FROM taken_rows),
      'taken_down', COALESCE((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.taken_down_at DESC, y.property_id)
                                FROM (SELECT * FROM taken_rows ORDER BY taken_down_at DESC, property_id
                                       OFFSET v_taken_off LIMIT 25) y), '[]'::jsonb)));
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_admin_listings(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_admin_listings(text, integer, integer) TO authenticated, service_role;

-- 2c. Nothing on a taken-down property is saved, given photos or published (must-fix 1, 7): one trigger
--     per table, so every writer (draft save, sale save, status, photo attach) is refused up front.
CREATE OR REPLACE FUNCTION public.rentals_listing_takedown_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_property uuid;
BEGIN
  IF TG_TABLE_NAME = 'rental_listings' THEN
    IF NEW.status = 'removed' THEN
      RETURN NEW;
    END IF;
    v_property := NEW.property_id;
  ELSE
    SELECT l.property_id INTO v_property FROM public.rental_listings l WHERE l.id = NEW.listing_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.rental_properties rp WHERE rp.id = v_property AND rp.listings_taken_down_at IS NOT NULL) THEN
    RAISE EXCEPTION 'listing_taken_down' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_listing_takedown_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS rentals_listing_takedown_guard ON public.rental_listings;
CREATE TRIGGER rentals_listing_takedown_guard BEFORE INSERT OR UPDATE ON public.rental_listings
  FOR EACH ROW EXECUTE FUNCTION public.rentals_listing_takedown_guard();
DROP TRIGGER IF EXISTS rentals_listing_takedown_guard ON public.rental_listing_photos;
CREATE TRIGGER rentals_listing_takedown_guard BEFORE INSERT ON public.rental_listing_photos
  FOR EACH ROW EXECUTE FUNCTION public.rentals_listing_takedown_guard();

-- ---------------------------------------------------------------------------
-- 3. Visible to the public: the signed-in rule, Homes open to everyone, a real (not test/seed) owner.
--    (rentals_listing_visible already excludes removed: it requires 'live'.)
CREATE OR REPLACE FUNCTION public.rentals_public_listing_visible(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- Public only once Homes is open to EVERYONE (not while testers-only), and never a test account's or
  -- seed account's listing (review fix #6).
  SELECT public.rentals_listing_visible(p_listing_id)
     AND EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'rentals' AND s.audience = 'everyone')
     AND NOT EXISTS (SELECT 1 FROM public.rental_listings l
                      WHERE l.id = p_listing_id
                        AND (EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = l.owner_id)
                             OR EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = l.owner_id AND pr.is_seed IS TRUE)));
$fn$;
REVOKE ALL ON FUNCTION public.rentals_public_listing_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing_visible(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The public read (D12). No require_feature: the link works for anyone
--    while the switch is not off (a signed-out visitor has no audience).
CREATE OR REPLACE FUNCTION public.rentals_public_listing(p_slug text)
RETURNS TABLE (
  kind text,
  headline text,
  description text,
  rent_cents integer,
  rent_frequency text,
  deposit_cents integer,
  sale_price_cents bigint,
  beds numeric,
  baths numeric,
  sq_ft integer,
  lot_sq_ft integer,
  year_built smallint,
  available_on date,
  lease_months_min smallint,
  lease_months_max smallint,
  pets text,
  pet_rules text,
  parking text,
  utilities_included text[],
  accepts_vouchers text,
  accessibility text[],
  city text,
  zip_code text,
  photo_ids uuid[],
  published_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT l.id INTO v_id FROM public.rental_listings l WHERE l.slug = p_slug;
  IF v_id IS NULL OR NOT public.rentals_public_listing_visible(v_id) THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  -- A stranger never gets home size + lot size + year built next to the ZIP of a home FOR SALE: together
  -- they name the parcel in the assessor's records (review fix #5). Signed-in members see them on the page.
  -- Nor a headline or description that could name the street, the year or the lot (must-fix 4): for a home
  -- for sale a stranger gets a plain headline and no description; signed-in members read the owner's words.
  SELECT l.kind,
         CASE WHEN l.kind = 'sale' THEN trim_scale(l.beds)::text || ' bed, ' || trim_scale(l.baths)::text || ' bath home for sale'
              ELSE l.headline END,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.description END,
         l.rent_cents, l.rent_frequency, l.deposit_cents, l.sale_price_cents,
         l.beds, l.baths,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.sq_ft END,
         CASE WHEN l.kind = 'sale' THEN NULL ELSE l.lot_sq_ft END,
         CASE WHEN l.kind = 'sale' THEN NULL::smallint ELSE l.year_built END,
         l.available_on, l.lease_months_min, l.lease_months_max,
         l.pets, l.pet_rules, l.parking, l.utilities_included, l.accepts_vouchers, l.accessibility,
         rp.city, rp.zip_code,
         ARRAY(SELECT ph.id FROM public.rental_listing_photos ph WHERE ph.listing_id = l.id ORDER BY ph.position),
         l.published_at
    FROM public.rental_listings l
    JOIN public.rental_properties rp ON rp.id = l.property_id
   WHERE l.id = v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_public_listing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The photo proxy's lookup (server only): the object path for a photo of a
--    publicly visible listing, else NULL.
CREATE OR REPLACE FUNCTION public.rentals_public_listing_photo_path(p_photo_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT ph.storage_path
    FROM public.rental_listing_photos ph
   WHERE ph.id = p_photo_id
     AND public.rentals_public_listing_visible(ph.listing_id);
$fn$;
REVOKE ALL ON FUNCTION public.rentals_public_listing_photo_path(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rentals_public_listing_photo_path(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Status: 20261019061241's body with two changes: publishing is refused
--    on a property an admin took down ('listing_taken_down'), and a sold or
--    leased listing cannot be removed by its owner (final).
CREATE OR REPLACE FUNCTION public.rentals_set_listing_status(p_listing_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_l public.rental_listings%ROWTYPE;
  v_photos integer;
  v_fee integer;
  v_flags text[];
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  IF p_status IS NULL OR p_status NOT IN ('live', 'paused', 'leased', 'sold', 'removed') THEN
    RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
  END IF;
  v_l := public.rentals_lock_own_listing(p_listing_id, v_uid);
  IF v_l.status = 'removed' THEN
    RAISE EXCEPTION 'listing_not_editable' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'live' THEN
    -- A rented listing stays rented (lh-authz-rls review of 390bbc7a9 #3): the
    -- unit is listed again with a NEW listing, so the one-open-listing rule
    -- never surfaces as a raw unique violation. A sold one stays sold.
    IF v_l.status IN ('leased', 'sold') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_identity_verified(v_uid) THEN
      RAISE EXCEPTION 'identity_not_verified' USING ERRCODE = '42501';
    END IF;
    -- A take-down is on the PROPERTY (lead review must-fix 1): no unit and neither kind on it goes live
    -- again until an admin lifts it (the trigger refuses it too; this answers first, with the same code).
    IF EXISTS (SELECT 1 FROM public.rental_properties rp
                WHERE rp.id = v_l.property_id AND rp.listings_taken_down_at IS NOT NULL) THEN
      RAISE EXCEPTION 'listing_taken_down' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rental_properties rp
                    WHERE rp.id = v_l.property_id AND rp.owner_id = v_uid AND rp.ownership_status = 'approved') THEN
      RAISE EXCEPTION 'ownership_not_approved' USING ERRCODE = '42501';
    END IF;
    -- The check is re-run on the stored text (the phrase list may have grown since the last save).
    IF v_l.kind = 'sale' THEN
      v_flags := public.homes_sale_wording_flags(concat_ws(' ', v_l.headline, v_l.description));
    ELSE
      v_flags := public.rentals_listing_wording_flags(concat_ws(' ', v_l.headline, v_l.description, v_l.pet_rules));
    END IF;
    IF cardinality(v_flags) > 0 THEN
      -- A sale listing's words are named in the sale copy (haggling or who may live there), a rent listing's in the
      -- fair-housing copy; both carry the phrases.
      IF v_l.kind = 'sale' THEN
        RAISE EXCEPTION 'sale_wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
      END IF;
      RAISE EXCEPTION 'wording_flagged' USING ERRCODE = '22023', DETAIL = array_to_string(v_flags, ', ');
    END IF;
    SELECT count(*) INTO v_photos FROM public.rental_listing_photos WHERE listing_id = p_listing_id;
    IF v_photos < 5 THEN
      RAISE EXCEPTION 'too_few_photos' USING ERRCODE = '22023';
    END IF;
    -- THE FEE GATE (owner: flat fee, amount TBD). No payment flow exists, so a
    -- fee above 0 refuses the publish rather than letting it through unpaid.
    IF v_l.kind = 'sale' THEN
      -- Fail closed: no settings row (or no value) refuses too, never publishes free by accident.
      SELECT ps.homes_sale_listing_fee_cents INTO v_fee FROM public.platform_settings ps LIMIT 1;
      IF v_fee IS NULL OR v_fee > 0 THEN
        RAISE EXCEPTION 'listing_fee_not_ready' USING ERRCODE = '22023';
      END IF;
    END IF;
    UPDATE public.rental_listings
       SET status = 'live', published_at = COALESCE(published_at, now()), expires_at = now() + interval '30 days',
           updated_at = now()
     WHERE id = p_listing_id;
  ELSIF p_status = 'paused' THEN
    IF v_l.status <> 'live' THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'paused', updated_at = now() WHERE id = p_listing_id;
  ELSIF p_status = 'leased' THEN
    IF v_l.kind <> 'rent' OR v_l.status NOT IN ('live', 'paused') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'leased', updated_at = now() WHERE id = p_listing_id;
  ELSIF p_status = 'sold' THEN
    IF v_l.kind <> 'sale' OR v_l.status NOT IN ('live', 'paused') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'sold', updated_at = now() WHERE id = p_listing_id;
  ELSE
    -- Sold and leased are final (must-fix 5): the record stays as it is.
    IF v_l.status IN ('sold', 'leased') THEN
      RAISE EXCEPTION 'bad_status' USING ERRCODE = '22023';
    END IF;
    UPDATE public.rental_listings SET status = 'removed', updated_at = now() WHERE id = p_listing_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_set_listing_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_set_listing_status(uuid, text) TO authenticated, service_role;
