-- SHOPS, SLICE 1: free shop / business PROFILES (build queue item 9; owner
-- decision record docs/specs/local-shops-prep.md "Owner answers", cited as
-- L<n>; roadmap docs/specs/louisiana-hub-roadmap.md, cited as G<n>/B<n>).
--
-- What a shop is (L4, L53, L90): ONE free shop per member, and a shop IS the
-- business profile. Every account may have one (never role-based). It shows
-- name, logo, cover, photos, about, category (the fixed list, L54), parishes
-- served, area (never an address), a map pin (L50: approximate for a home
-- maker, exact only for a storefront), opening days and hours, badges (L47,
-- L55, L56), the owner's one star rating (G11, L46), and Follow (L92).
-- No phone, email or website anywhere on it (L49): the only contact is the
-- in-app Message button, and the contact-leak trigger below rejects contact
-- details typed into the name, about or area.
--
-- NOT in this slice (each has a hook here and a docs/OPEN.md placeholder):
-- selling items and orders (L17-L24, they reuse the Declutter engine),
-- equipment rentals (L25-L35), boosts and every payment (L57-L68), request-a-
-- quote routing (L53, the 'quotes' work), appointments (B1), punch cards (B5),
-- invoices (B6), the "Permit on file" badge (needs a food-permit credential
-- type), "new from shops you follow" alerts (L92, need items), the Shops admin
-- queue screen (L73), and export_my_data sections (restated on other branches;
-- docs/OPEN.md, shops export item).
--
-- HIDDEN: behind the hidden switch 'shops', created OFF. Every RPC starts
-- PERFORM public.require_feature('shops'), and the shops read policy needs the
-- switch too, so a member without it reads no other member's shop by REST.
--
-- GATES, server-side (the app's grey-outs are never the protection), on every
-- write that opens or changes a shop: signed in; not banned (is_caller_banned,
-- named in each RPC's own body: the Q281 ban-gate class); not under 18 (L82,
-- member_under_18); fewer than 3 active marketplace strikes (L45: ONE count
-- shared with Declutter, declutter_active_strike_count); Stripe payout setup
-- finished (L3: helper_award_block_reason, the gate Helprs and Declutter
-- sellers pass). Unconfirmed-email accounts are refused by the statement gate
-- attached to every new table (attach_unconfirmed_email_gate, Q807).
-- Following a shop needs only: signed in, not banned.
--
-- Error codes: 42501 for refusals (feature_disabled, not_authenticated,
-- account_restricted, shop_strikes_blocked, under_18, payout_setup_incomplete,
-- not_admin), 22023 for bad input, P0002 for a shop the caller cannot act on.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT
-- DO NOTHING; grants restated by role name. Applied 3x in PGlite by
-- src/test/pglite/shopsProfiles.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The hidden switch, OFF.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('shops', 'off',
        'Shops: free shop and business profiles (makers, bakers, trades, rentals, businesses). '
        'Gates every shops_* RPC and the shop reads.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Categories (L54): a fixed list the owner adds to. A table, not an enum,
--    so the "Suggest a category" approvals (I1) can add a row without a
--    release. Readable by every signed-in member; written by migrations only.
CREATE TABLE IF NOT EXISTS public.shop_categories (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  group_slug text NOT NULL CHECK (group_slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  group_label text NOT NULL CHECK (char_length(group_label) BETWEEN 2 AND 40),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 40),
  position smallint NOT NULL
);
ALTER TABLE public.shop_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_categories TO authenticated;
GRANT ALL ON TABLE public.shop_categories TO service_role;
DROP POLICY IF EXISTS "shop categories: readable by members" ON public.shop_categories;
CREATE POLICY "shop categories: readable by members" ON public.shop_categories
  FOR SELECT TO authenticated USING (true);

-- The owner's starter list (L54, 2026-10-14), in her order.
INSERT INTO public.shop_categories (slug, group_slug, group_label, label, position) VALUES
  ('bakery', 'food_drink', 'Food and drink', 'Bakery', 100),
  ('catering', 'food_drink', 'Food and drink', 'Catering', 101),
  ('food_truck', 'food_drink', 'Food and drink', 'Food truck', 102),
  ('restaurant', 'food_drink', 'Food and drink', 'Restaurant', 103),
  ('coffee', 'food_drink', 'Food and drink', 'Coffee', 104),
  ('snowballs', 'food_drink', 'Food and drink', 'Snowballs', 105),
  ('crawfish_seafood', 'food_drink', 'Food and drink', 'Crawfish and seafood', 106),
  ('bbq', 'food_drink', 'Food and drink', 'BBQ', 107),
  ('meal_prep', 'food_drink', 'Food and drink', 'Meal prep', 108),
  ('cleaning', 'home_services', 'Home services', 'Cleaning', 200),
  ('lawn_landscaping', 'home_services', 'Home services', 'Lawn and landscaping', 201),
  ('pest_control', 'home_services', 'Home services', 'Pest control', 202),
  ('pressure_washing', 'home_services', 'Home services', 'Pressure washing', 203),
  ('pool', 'home_services', 'Home services', 'Pool', 204),
  ('moving', 'home_services', 'Home services', 'Moving', 205),
  ('junk_removal', 'home_services', 'Home services', 'Junk removal', 206),
  ('organizing', 'home_services', 'Home services', 'Organizing', 207),
  ('electrical', 'trades', 'Trades', 'Electrical', 300),
  ('plumbing', 'trades', 'Trades', 'Plumbing', 301),
  ('hvac', 'trades', 'Trades', 'HVAC', 302),
  ('roofing', 'trades', 'Trades', 'Roofing', 303),
  ('welding', 'trades', 'Trades', 'Welding', 304),
  ('carpentry', 'trades', 'Trades', 'Carpentry', 305),
  ('flooring', 'trades', 'Trades', 'Flooring', 306),
  ('concrete_masonry', 'trades', 'Trades', 'Concrete and masonry', 307),
  ('fencing', 'trades', 'Trades', 'Fencing', 308),
  ('painting', 'trades', 'Trades', 'Painting', 309),
  ('remodeling', 'trades', 'Trades', 'Remodeling', 310),
  ('appliance_repair', 'trades', 'Trades', 'Appliance repair', 311),
  ('handyman', 'trades', 'Trades', 'Handyman', 312),
  ('mechanic', 'auto_marine', 'Auto and marine', 'Mechanic', 400),
  ('detailing', 'auto_marine', 'Auto and marine', 'Detailing', 401),
  ('towing', 'auto_marine', 'Auto and marine', 'Towing', 402),
  ('tires', 'auto_marine', 'Auto and marine', 'Tires', 403),
  ('boat_repair', 'auto_marine', 'Auto and marine', 'Boat repair', 404),
  ('hair', 'beauty', 'Beauty', 'Hair', 500),
  ('barber', 'beauty', 'Beauty', 'Barber', 501),
  ('nails', 'beauty', 'Beauty', 'Nails', 502),
  ('lashes_brows', 'beauty', 'Beauty', 'Lashes and brows', 503),
  ('makeup', 'beauty', 'Beauty', 'Makeup', 504),
  ('spa', 'beauty', 'Beauty', 'Spa', 505),
  ('tattoo', 'beauty', 'Beauty', 'Tattoo', 506),
  ('dj', 'events_party', 'Events and party', 'DJ', 600),
  ('photography', 'events_party', 'Events and party', 'Photography', 601),
  ('videography', 'events_party', 'Events and party', 'Videography', 602),
  ('venues', 'events_party', 'Events and party', 'Venues', 603),
  ('event_decor', 'events_party', 'Events and party', 'Decor', 604),
  ('party_rentals', 'events_party', 'Events and party', 'Party rentals', 605),
  ('bounce_houses', 'events_party', 'Events and party', 'Bounce houses', 606),
  ('florist', 'events_party', 'Events and party', 'Florist', 607),
  ('cakes', 'events_party', 'Events and party', 'Cakes', 608),
  ('personal_trainer', 'health_fitness', 'Health and fitness', 'Personal trainer', 700),
  ('gym', 'health_fitness', 'Health and fitness', 'Gym', 701),
  ('yoga', 'health_fitness', 'Health and fitness', 'Yoga', 702),
  ('massage', 'health_fitness', 'Health and fitness', 'Massage', 703),
  ('nutrition', 'health_fitness', 'Health and fitness', 'Nutrition', 704),
  ('pet_grooming', 'pets', 'Pets', 'Grooming', 800),
  ('pet_sitting_walking', 'pets', 'Pets', 'Sitting and walking', 801),
  ('pet_training', 'pets', 'Pets', 'Training', 802),
  ('pet_boarding', 'pets', 'Pets', 'Boarding', 803),
  ('boutique', 'shopping', 'Shopping', 'Boutique', 900),
  ('crafts_gifts', 'shopping', 'Shopping', 'Crafts and gifts', 901),
  ('home_decor', 'shopping', 'Shopping', 'Home decor', 902),
  ('plants_garden', 'shopping', 'Shopping', 'Plants and garden', 903),
  ('farmers_market', 'shopping', 'Shopping', 'Farmers market', 904),
  ('tutoring', 'learning', 'Learning', 'Tutoring', 1000),
  ('music_lessons', 'learning', 'Learning', 'Music lessons', 1001),
  ('driving_school', 'learning', 'Learning', 'Driving school', 1002),
  ('classes', 'learning', 'Learning', 'Classes', 1003),
  ('real_estate', 'professional', 'Professional', 'Real estate', 1100),
  ('insurance', 'professional', 'Professional', 'Insurance', 1101),
  ('tax_bookkeeping', 'professional', 'Professional', 'Tax and bookkeeping', 1102),
  ('notary', 'professional', 'Professional', 'Notary', 1103),
  ('printing', 'professional', 'Professional', 'Printing', 1104),
  ('it_phone_repair', 'professional', 'Professional', 'IT and phone repair', 1105),
  ('fishing_charters', 'outdoors', 'Outdoors', 'Fishing charters', 1200),
  ('hunting_guides', 'outdoors', 'Outdoors', 'Hunting guides', 1201),
  ('swamp_tours', 'outdoors', 'Outdoors', 'Swamp tours', 1202),
  ('other', 'other', 'Other', 'Other', 9999)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Shops: one per member (L4, L83), free.
CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  about text NOT NULL DEFAULT '' CHECK (char_length(about) <= 2000),
  category text NOT NULL REFERENCES public.shop_categories(slug),
  -- L53: parishes served (the exact strings profiles.parish / jobs.parish use).
  parishes_served text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(parishes_served) <= 64),
  -- L50: the area, never an address; the pin is 2 decimals (~1 km) for a
  -- home maker and the exact point only for a storefront (storefront = true).
  area_label text NOT NULL CHECK (char_length(btrim(area_label)) BETWEEN 2 AND 80),
  storefront boolean NOT NULL DEFAULT false,
  pin_lat numeric(8,5) NOT NULL CHECK (pin_lat BETWEEN 28 AND 34),
  pin_lng numeric(8,5) NOT NULL CHECK (pin_lng BETWEEN -95 AND -88),
  -- L53: what the business takes. Selling (S2/S3) and quotes (the 'quotes'
  -- work) are not built here: the profile only says which it will offer.
  offers_selling boolean NOT NULL DEFAULT true,
  offers_quotes boolean NOT NULL DEFAULT false,
  -- L84: vacation mode. Nothing new starts while paused (orders arrive later).
  paused boolean NOT NULL DEFAULT false,
  -- L56: optional Louisiana Secretary of State number; "Registered business"
  -- shows only once an admin checks it (sos_verified_at).
  sos_number text CHECK (sos_number IS NULL OR sos_number ~ '^[A-Za-z0-9-]{3,20}$'),
  sos_verified_at timestamptz,
  sos_verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- L75: an admin hides a shop (its owner still sees it, with the reason).
  hidden_at timestamptz,
  hidden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hidden_reason text CHECK (hidden_reason IS NULL OR char_length(hidden_reason) <= 500),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shops_offers_something CHECK (offers_selling OR offers_quotes),
  CONSTRAINT shops_sos_verified_has_number CHECK (sos_verified_at IS NULL OR sos_number IS NOT NULL),
  -- A home maker's pin is never finer than 2 decimals.
  CONSTRAINT shops_home_pin_is_coarse CHECK (
    storefront OR (pin_lat = round(pin_lat, 2) AND pin_lng = round(pin_lng, 2)))
);
CREATE INDEX IF NOT EXISTS shops_category_idx ON public.shops (category);
CREATE INDEX IF NOT EXISTS shops_pin_idx ON public.shops (pin_lat, pin_lng) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS shops_sos_verified_by_idx ON public.shops (sos_verified_by);
CREATE INDEX IF NOT EXISTS shops_hidden_by_idx ON public.shops (hidden_by);

-- ---------------------------------------------------------------------------
-- 2b. Whether a shop owner may be seen by others (L45: 3 marketplace strikes
--     = out of Declutter AND Shops; a banned or currently suspended account
--     is out too). Read by the shops policy and shop_visible_to; definer
--     because the strike count is not client-callable. Replay-safe: the
--     strike table comes from 20261014193955, which runs first.
CREATE OR REPLACE FUNCTION public.shop_owner_in_good_standing(p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- Answers only for a member who has a shop, so it reveals nothing a
  -- shop's own visibility does not already show.
  SELECT p_owner_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.shops s WHERE s.owner_id = p_owner_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = p_owner_id
          AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
          AND (p.ban_status <> 'temp_banned' OR p.auto_suspended_until IS NULL OR p.auto_suspended_until > now()))
     AND public.declutter_active_strike_count(p_owner_id) < 3;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owner_in_good_standing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_in_good_standing(uuid) TO service_role;

-- The WHOLE rule for whether a member other than the owner sees a shop, in
-- one place: the switch is on for the caller, the shop is not hidden, not a
-- test account's while seeds are hidden, and its owner is in good standing.
-- Client-callable because the shops read policy calls it; it answers nothing
-- REST does not already show (re-review finding 1: the standing helper alone
-- was an oracle for hidden shops and switched-off members).
CREATE OR REPLACE FUNCTION public.shop_publicly_visible(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT public.feature_enabled_for('shops')
     AND COALESCE((
       SELECT s.hidden_at IS NULL
          AND NOT (s.is_seed AND public.seed_jobs_hidden_publicly())
          AND public.shop_owner_in_good_standing(s.owner_id)
         FROM public.shops s WHERE s.id = p_shop_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_publicly_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_publicly_visible(uuid) TO authenticated, service_role;

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shops FROM PUBLIC, anon, authenticated;
-- Column grants (review finding 3): the Secretary of State number, who
-- checked it, who hid a shop and why are NOT client-readable; the owner gets
-- sos_number and hidden_reason through shops_get_shop.
GRANT SELECT (id, owner_id, name, about, category, parishes_served, area_label, storefront, pin_lat, pin_lng,
              offers_selling, offers_quotes, paused, hidden_at, is_seed, created_at, updated_at)
  ON TABLE public.shops TO authenticated;
GRANT ALL ON TABLE public.shops TO service_role;
DROP POLICY IF EXISTS "shops: owner or switched-on members read visible" ON public.shops;
CREATE POLICY "shops: owner or switched-on members read visible" ON public.shops
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    -- Not hidden, switch on, no test shop while seeds are hidden, owner not
    -- banned or at 3 marketplace strikes (L45): shop_publicly_visible, the
    -- same rule shop_visible_to uses, so the RPCs and REST agree.
    OR public.shop_publicly_visible(id)
  );
COMMENT ON TABLE public.shops IS
  'Shops: one free shop / business profile per member (docs/specs/local-shops-prep.md L4, L53, L90). '
  'Written only by shops_* RPCs. No contact details (L49).';

-- ---------------------------------------------------------------------------
-- 3. Photos (L50, L53): one logo, one cover, up to 12 gallery photos. Stored
--    in the public job-photos bucket under <owner uid>/shops/<file>, which its
--    owner-folder INSERT policy already allows; purged with the account
--    (_shared/purgeBuckets.ts IDENTITY_SUBFOLDERS).
CREATE TABLE IF NOT EXISTS public.shop_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_kind text NOT NULL CHECK (photo_kind IN ('logo', 'cover', 'gallery')),
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path ~ '^[0-9a-f-]{36}/shops/[A-Za-z0-9._-]{1,100}$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_photos_one_logo_one_cover CHECK (photo_kind = 'gallery' OR position = 0),
  CONSTRAINT shop_photos_position_key UNIQUE (shop_id, photo_kind, position)
);
CREATE INDEX IF NOT EXISTS shop_photos_owner_idx ON public.shop_photos (owner_id);
ALTER TABLE public.shop_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_photos TO authenticated;
GRANT ALL ON TABLE public.shop_photos TO service_role;
DROP POLICY IF EXISTS "shop photos: readable with their shop" ON public.shop_photos;
CREATE POLICY "shop photos: readable with their shop" ON public.shop_photos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = shop_photos.shop_id));

-- The owner removes their own shop photo objects once the server detached
-- them (replaced logo/cover, a removed photo, a closed shop): review finding
-- 2. Modelled on "Sellers delete own unattached declutter photos"
-- (20261014200728). An ATTACHED photo cannot be deleted this way (the
-- NOT EXISTS reads shop_photos as the caller, who reads every row of their
-- own shop, hidden or not).
DROP POLICY IF EXISTS "Owners delete own unattached shop photos" ON storage.objects;
CREATE POLICY "Owners delete own unattached shop photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] = 'shops'
    AND NOT EXISTS (SELECT 1 FROM public.shop_photos p WHERE p.storage_path = objects.name)
  );

-- ---------------------------------------------------------------------------
-- 4. Opening days and hours (L50, L53), Louisiana local time
--    (America/Chicago). 0 = Sunday.
CREATE TABLE IF NOT EXISTS public.shop_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_local time NOT NULL,
  closes_local time NOT NULL,
  CONSTRAINT shop_hours_order CHECK (closes_local > opens_local),
  CONSTRAINT shop_hours_key UNIQUE (shop_id, weekday, opens_local)
);
ALTER TABLE public.shop_hours ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_hours FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_hours TO authenticated;
GRANT ALL ON TABLE public.shop_hours TO service_role;
DROP POLICY IF EXISTS "shop hours: readable with their shop" ON public.shop_hours;
CREATE POLICY "shop hours: readable with their shop" ON public.shop_hours
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shops s WHERE s.id = shop_hours.shop_id));

-- ---------------------------------------------------------------------------
-- 5. Follows (L92). A member reads only their own follows; follower counts
--    come from shops_get_shop.
CREATE TABLE IF NOT EXISTS public.shop_follows (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shop_id)
);
CREATE INDEX IF NOT EXISTS shop_follows_shop_idx ON public.shop_follows (shop_id);
ALTER TABLE public.shop_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_follows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_follows TO authenticated;
GRANT ALL ON TABLE public.shop_follows TO service_role;
DROP POLICY IF EXISTS "shop follows: member reads own" ON public.shop_follows;
CREATE POLICY "shop follows: member reads own" ON public.shop_follows
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 6. Contact-leak filter (L49; the jobs/bios rule, 20260913020635): rejected,
--    never hidden. A trigger, so it covers every path that writes these.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_shop()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
  v_where text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.name IS DISTINCT FROM OLD.name THEN
    v_reason := public.contact_leak_reason(NEW.name); v_where := 'name';
  END IF;
  IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.about IS DISTINCT FROM OLD.about) THEN
    v_reason := public.contact_leak_reason(NEW.about); v_where := 'about';
  END IF;
  IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.area_label IS DISTINCT FROM OLD.area_label) THEN
    v_reason := public.contact_leak_reason(NEW.area_label); v_where := 'area';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the ' || v_where || '. Keep phone numbers, emails and websites off your shop; members reach you with the Message button.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_shop() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_shop ON public.shops;
CREATE TRIGGER trg_reject_contact_leak_in_shop
  BEFORE INSERT OR UPDATE OF name, about, area_label ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_shop();

-- ---------------------------------------------------------------------------
-- 7. Internal helpers (no client EXECUTE).

-- The gates every shop-owner write runs (after require_feature). Returns the caller.
CREATE OR REPLACE FUNCTION public.shops_assert_owner_eligible()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted'
      USING ERRCODE = '42501', HINT = 'This account is suspended or banned. See /account-banned for details.';
  END IF;
  IF public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18' USING ERRCODE = '42501', HINT = 'You must be 18 or older to have a shop.';
  END IF;
  -- L45: one marketplace strike count shared with Declutter.
  IF public.declutter_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'shop_strikes_blocked'
      USING ERRCODE = '42501', HINT = 'You have 3 marketplace strikes. Shops open again when one expires.';
  END IF;
  -- L3: Stripe payout setup finished.
  IF public.helper_award_block_reason(v_uid) IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete'
      USING ERRCODE = '42501', HINT = 'Finish payout setup before opening a shop.';
  END IF;
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_assert_owner_eligible() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_assert_owner_eligible() TO service_role;

-- The badges (L47, L55, L56) for one shop, each checked by someone other
-- than the owner:
--   id_checked   identity_is_verified() on the owner's profile (Stripe Identity)
--   licensed     the owner's trade_license credential, verified by an admin in
--                the credentials queue and not expired
--   insured      the owner's insurance credential, same rule
--   registered   the Secretary of State number, checked by an admin
--   permit       "Permit on file": NOT BUILT (needs a food-permit credential
--                type; docs/OPEN.md). Always false until then.
CREATE OR REPLACE FUNCTION public.shop_badges(p_shop_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET "TimeZone" TO 'America/Chicago'
AS $fn$
  SELECT jsonb_build_object(
    'id_checked', COALESCE((SELECT public.identity_is_verified(p.idv_status, p.stripe_identity_verified)
                              FROM public.profiles p WHERE p.user_id = s.owner_id), false),
    'licensed', EXISTS (SELECT 1 FROM public.helper_credentials c
                         WHERE c.user_id = s.owner_id AND c.credential_type = 'trade_license'
                           AND c.status = 'verified'
                           AND (c.expiration_date IS NULL OR c.expiration_date >= current_date)),
    'insured', EXISTS (SELECT 1 FROM public.helper_credentials c
                        WHERE c.user_id = s.owner_id AND c.credential_type = 'insurance'
                          AND c.status = 'verified'
                          AND (c.expiration_date IS NULL OR c.expiration_date >= current_date)),
    'registered', s.sos_verified_at IS NOT NULL,
    'permit', false)
  FROM public.shops s
  WHERE s.id = p_shop_id;
$fn$;
REVOKE ALL ON FUNCTION public.shop_badges(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_badges(uuid) TO service_role;

-- The owner's one star rating (G11, L46): published reviews past their reveal,
-- the same rows the reviews read policy shows a stranger.
CREATE OR REPLACE FUNCTION public.shop_owner_rating(p_owner_id uuid)
RETURNS TABLE (rating numeric, review_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT round(avg(r.rating)::numeric, 2), count(*)::integer
    FROM public.reviews r
   WHERE r.reviewee_id = p_owner_id
     AND r.status = 'published'
     AND r.feedback_visible_at IS NOT NULL
     AND r.feedback_visible_at <= now()
     AND NOT public.seed_review_hidden(r.reviewer_id, r.reviewee_id, r.job_id);
$fn$;
REVOKE ALL ON FUNCTION public.shop_owner_rating(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_rating(uuid) TO service_role;

-- Whether p_viewer may see the shop: the owner always; anyone else only while
-- it is not hidden, and a test account's shop not while the launch switch
-- hides seed data (seed_jobs_hidden_publicly, the profiles rule).
CREATE OR REPLACE FUNCTION public.shop_visible_to(p_shop_id uuid, p_viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT s.owner_id = p_viewer
        OR public.shop_publicly_visible(s.id)
      FROM public.shops s WHERE s.id = p_shop_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.shop_visible_to(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_visible_to(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Client RPCs. Each VOLATILE one names is_caller_banned() in its own body
--    (the Q281 class check, scripts/ci/ban-gate-coverage.sql).

-- Create or update the caller's own shop. Returns the shop id.
CREATE OR REPLACE FUNCTION public.shops_save_my_shop(
  p_name text,
  p_about text,
  p_category text,
  p_parishes_served text[],
  p_area_label text,
  p_storefront boolean,
  p_pin_lat numeric,
  p_pin_lng numeric,
  p_offers_selling boolean,
  p_offers_quotes boolean,
  p_sos_number text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_sos text := nullif(btrim(COALESCE(p_sos_number, '')), '');
  v_lat numeric;
  v_lng numeric;
  v_seed boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();

  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023', HINT = 'A shop name is 2 to 60 characters.';
  END IF;
  IF char_length(COALESCE(p_about, '')) > 2000 THEN
    RAISE EXCEPTION 'about_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_area_label IS NULL OR char_length(btrim(p_area_label)) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'invalid_area' USING ERRCODE = '22023';
  END IF;
  IF p_category IS NULL OR NOT EXISTS (SELECT 1 FROM public.shop_categories c WHERE c.slug = p_category) THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF p_pin_lat IS NULL OR p_pin_lng IS NULL OR p_pin_lat NOT BETWEEN 28 AND 34 OR p_pin_lng NOT BETWEEN -95 AND -88 THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023', HINT = 'The shop must be in Louisiana.';
  END IF;
  IF p_parishes_served IS NOT NULL AND (
       cardinality(p_parishes_served) > 64
       OR EXISTS (SELECT 1 FROM unnest(p_parishes_served) x WHERE x IS NULL OR x !~ '^[A-Za-z][A-Za-z. ''-]{1,39}$')) THEN
    RAISE EXCEPTION 'invalid_parishes' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_offers_selling, false) = false AND COALESCE(p_offers_quotes, false) = false THEN
    RAISE EXCEPTION 'offers_required' USING ERRCODE = '22023', HINT = 'Choose selling, quotes, or both.';
  END IF;
  IF v_sos IS NOT NULL AND v_sos !~ '^[A-Za-z0-9-]{3,20}$' THEN
    RAISE EXCEPTION 'invalid_sos_number' USING ERRCODE = '22023';
  END IF;
  IF public.declutter_area_label_problem(p_area_label, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'area_looks_like_address' USING ERRCODE = '22023';
  END IF;
  -- L50: a home maker's pin is the area (2 decimals); a storefront's is exact.
  IF COALESCE(p_storefront, false) THEN
    v_lat := round(p_pin_lat, 5); v_lng := round(p_pin_lng, 5);
  ELSE
    v_lat := round(p_pin_lat, 2); v_lng := round(p_pin_lng, 2);
  END IF;
  SELECT COALESCE(p.is_seed, false) INTO v_seed FROM public.profiles p WHERE p.user_id = v_uid;

  INSERT INTO public.shops AS s (
    owner_id, name, about, category, parishes_served, area_label, storefront, pin_lat, pin_lng,
    offers_selling, offers_quotes, sos_number, is_seed)
  VALUES (
    v_uid, btrim(p_name), COALESCE(btrim(p_about), ''), p_category,
    COALESCE((SELECT array_agg(DISTINCT btrim(x)) FROM unnest(p_parishes_served) x), '{}'),
    btrim(p_area_label), COALESCE(p_storefront, false), v_lat, v_lng,
    COALESCE(p_offers_selling, false), COALESCE(p_offers_quotes, false), v_sos, COALESCE(v_seed, false))
  ON CONFLICT (owner_id) DO UPDATE SET
    name = EXCLUDED.name,
    about = EXCLUDED.about,
    category = EXCLUDED.category,
    parishes_served = EXCLUDED.parishes_served,
    area_label = EXCLUDED.area_label,
    storefront = EXCLUDED.storefront,
    pin_lat = EXCLUDED.pin_lat,
    pin_lng = EXCLUDED.pin_lng,
    offers_selling = EXCLUDED.offers_selling,
    offers_quotes = EXCLUDED.offers_quotes,
    sos_number = EXCLUDED.sos_number,
    -- A changed number is checked again.
    sos_verified_at = CASE WHEN s.sos_number IS NOT DISTINCT FROM EXCLUDED.sos_number THEN s.sos_verified_at END,
    sos_verified_by = CASE WHEN s.sos_number IS NOT DISTINCT FROM EXCLUDED.sos_number THEN s.sos_verified_by END,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_save_my_shop(text, text, text, text[], text, boolean, numeric, numeric, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_save_my_shop(text, text, text, text[], text, boolean, numeric, numeric, boolean, boolean, text) TO authenticated, service_role;

-- Replace the caller's opening hours: [{weekday, opens, closes}, ...].
CREATE OR REPLACE FUNCTION public.shops_set_hours(p_hours jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_n integer;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT id INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_hours IS NULL OR jsonb_typeof(p_hours) <> 'array' OR jsonb_array_length(p_hours) > 21 THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.shop_hours WHERE shop_id = v_shop;
  BEGIN
    INSERT INTO public.shop_hours (shop_id, weekday, opens_local, closes_local)
    SELECT v_shop, (e ->> 'weekday')::smallint, (e ->> 'opens')::time, (e ->> 'closes')::time
      FROM jsonb_array_elements(p_hours) e;
  EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation
             OR unique_violation OR invalid_datetime_format OR datetime_field_overflow
             OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_hours' USING ERRCODE = '22023',
      HINT = 'Each time needs a day, and an opening time before its closing time.';
  END;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.shops SET updated_at = now() WHERE id = v_shop;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_hours(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_hours(jsonb) TO authenticated, service_role;

-- Vacation mode (L84).
CREATE OR REPLACE FUNCTION public.shops_set_paused(p_paused boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_paused IS NULL THEN
    RAISE EXCEPTION 'invalid_paused' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops SET paused = p_paused, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_paused;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_paused(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_paused(boolean) TO authenticated, service_role;

-- Attach an uploaded photo to the caller's shop. For 'logo' and 'cover' the
-- new photo replaces the old one; the old path comes back in replaced_path so
-- the app removes the object.
CREATE OR REPLACE FUNCTION public.shops_attach_photo(p_kind text, p_storage_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop uuid;
  v_pos smallint;
  v_old text;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT id INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('logo', 'cover', 'gallery') THEN
    RAISE EXCEPTION 'invalid_photo_kind' USING ERRCODE = '22023';
  END IF;
  -- The caller's own shops folder, and the object is really there, uploaded
  -- by the caller, an image (job-photos also takes video, which keeps GPS).
  IF p_storage_path IS NULL
     OR p_storage_path !~ '^[0-9a-f-]{36}/shops/[A-Za-z0-9._-]{1,100}$'
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'gallery' THEN
    SELECT g.p INTO v_pos
      FROM generate_series(0, 11) AS g(p)
     WHERE NOT EXISTS (SELECT 1 FROM public.shop_photos ph
                        WHERE ph.shop_id = v_shop AND ph.photo_kind = 'gallery' AND ph.position = g.p)
     ORDER BY g.p
     LIMIT 1;
    IF v_pos IS NULL THEN
      RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A shop has at most 12 photos.';
    END IF;
  ELSE
    v_pos := 0;
    DELETE FROM public.shop_photos
     WHERE shop_id = v_shop AND photo_kind = p_kind
     RETURNING storage_path INTO v_old;
  END IF;

  -- A path already attached (to this shop) is bad input, not a raw 23505:
  -- review finding 4. The shop row is locked FOR UPDATE above, so the only
  -- unique key this insert can hit is storage_path.
  BEGIN
    INSERT INTO public.shop_photos (shop_id, owner_id, photo_kind, storage_path, position)
    VALUES (v_shop, v_uid, p_kind, p_storage_path, v_pos)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'photo_already_attached' USING ERRCODE = '22023';
  END;
  UPDATE public.shops SET updated_at = now() WHERE id = v_shop;
  RETURN jsonb_build_object('id', v_id, 'replaced_path', v_old);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_attach_photo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_attach_photo(text, text) TO authenticated, service_role;

-- Detach one of the caller's photos. Returns its path so the app removes the object.
CREATE OR REPLACE FUNCTION public.shops_remove_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_path text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.shop_photos WHERE id = p_photo_id AND owner_id = v_uid
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_remove_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_remove_photo(uuid) TO authenticated, service_role;

-- Close (delete) the caller's own shop. Returns the photo paths so the app
-- removes the objects. HOOK: once orders exist, refuse while one is open.
CREATE OR REPLACE FUNCTION public.shops_close_my_shop()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_paths text[];
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Review finding 1: a shop an admin hid cannot be closed and reopened
  -- clean (that would undo L75). Account deletion still cascades it away.
  IF EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid AND hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  SELECT COALESCE(array_agg(ph.storage_path), '{}') INTO v_paths
    FROM public.shop_photos ph WHERE ph.owner_id = v_uid;
  DELETE FROM public.shops WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_paths;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_close_my_shop() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_close_my_shop() TO authenticated, service_role;

-- Follow / unfollow (L92). Not your own shop; not a shop you cannot see.
CREATE OR REPLACE FUNCTION public.shops_set_follow(p_shop_id uuid, p_follow boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_follow IS NULL THEN
    RAISE EXCEPTION 'invalid_follow' USING ERRCODE = '22023';
  END IF;
  -- Unfollow needs no visibility: a member can always drop their own follow,
  -- even once the shop is hidden or its owner banned (review finding 1). It
  -- deletes only the caller's own row and answers the same either way.
  IF NOT p_follow THEN
    DELETE FROM public.shop_follows WHERE user_id = v_uid AND shop_id = p_shop_id;
    RETURN false;
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.owner_id = v_uid) THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  IF p_follow THEN
    INSERT INTO public.shop_follows (user_id, shop_id) VALUES (v_uid, p_shop_id)
    ON CONFLICT (user_id, shop_id) DO NOTHING;
  ELSE
    DELETE FROM public.shop_follows WHERE user_id = v_uid AND shop_id = p_shop_id;
  END IF;
  RETURN COALESCE(p_follow, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_follow(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_follow(uuid, boolean) TO authenticated, service_role;

-- One shop's page (L50): the shop, its badges, rating, follower count, hours
-- and photos. The owner also gets the hidden reason and the SoS number.
CREATE OR REPLACE FUNCTION public.shops_get_shop(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_s public.shops%ROWTYPE;
  v_mine boolean;
  v_rating numeric;
  v_count integer;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_s FROM public.shops WHERE id = p_shop_id;
  v_mine := v_s.owner_id = v_uid;
  SELECT r.rating, r.review_count INTO v_rating, v_count FROM public.shop_owner_rating(v_s.owner_id) r;
  RETURN jsonb_build_object(
    'id', v_s.id,
    'owner_id', v_s.owner_id,
    'name', v_s.name,
    'about', v_s.about,
    'category', v_s.category,
    'parishes_served', to_jsonb(v_s.parishes_served),
    'area_label', v_s.area_label,
    'storefront', v_s.storefront,
    'pin_lat', v_s.pin_lat,
    'pin_lng', v_s.pin_lng,
    'offers_selling', v_s.offers_selling,
    'offers_quotes', v_s.offers_quotes,
    'paused', v_s.paused,
    'badges', public.shop_badges(v_s.id),
    'rating', v_rating,
    'review_count', COALESCE(v_count, 0),
    'follower_count', (SELECT count(*) FROM public.shop_follows f WHERE f.shop_id = v_s.id),
    'following', EXISTS (SELECT 1 FROM public.shop_follows f WHERE f.shop_id = v_s.id AND f.user_id = v_uid),
    'mine', v_mine,
    'sos_number', CASE WHEN v_mine THEN v_s.sos_number END,
    'hidden', CASE WHEN v_mine THEN v_s.hidden_at IS NOT NULL END,
    'hidden_reason', CASE WHEN v_mine THEN v_s.hidden_reason END,
    'hours', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'weekday', h.weekday, 'opens', to_char(h.opens_local, 'HH24:MI'), 'closes', to_char(h.closes_local, 'HH24:MI'))
               ORDER BY h.weekday, h.opens_local) FROM public.shop_hours h WHERE h.shop_id = v_s.id), '[]'::jsonb),
    'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'id', ph.id, 'kind', ph.photo_kind, 'storage_path', ph.storage_path, 'position', ph.position)
               ORDER BY ph.photo_kind, ph.position) FROM public.shop_photos ph WHERE ph.shop_id = v_s.id), '[]'::jsonb),
    'created_at', v_s.created_at);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_get_shop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_get_shop(uuid) TO authenticated, service_role;

-- The caller's own shop id (NULL when they have none).
CREATE OR REPLACE FUNCTION public.shops_my_shop_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT id FROM public.shops WHERE owner_id = v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_shop_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_shop_id() TO authenticated, service_role;

-- Browse (L69, L87): all of Louisiana, nearest first, then rating. Hidden and
-- (while seeds are hidden) test shops are left out; paused shops still show,
-- marked paused. HOOK (L58, L61): boosted shops go first, marked "Ad", once
-- boosts exist; nothing here ranks by money today.
CREATE OR REPLACE FUNCTION public.shops_browse(
  p_lat numeric,
  p_lng numeric,
  p_category text DEFAULT NULL,
  p_group text DEFAULT NULL,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  category text,
  area_label text,
  pin_lat numeric,
  pin_lng numeric,
  paused boolean,
  miles numeric,
  rating numeric,
  review_count integer,
  badges jsonb,
  logo_path text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.name, s.category, s.area_label,
         -- The list never needs a storefront's exact pin: always 2 decimals.
         round(s.pin_lat, 2), round(s.pin_lng, 2), s.paused,
         CASE WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
              ELSE round((3958.8 * 2 * asin(sqrt(
                     power(sin(radians((s.pin_lat - p_lat) / 2)), 2)
                     + cos(radians(p_lat)) * cos(radians(s.pin_lat))
                       * power(sin(radians((s.pin_lng - p_lng) / 2)), 2))))::numeric, 1)
         END AS miles,
         r.rating, COALESCE(r.review_count, 0),
         public.shop_badges(s.id),
         (SELECT ph.storage_path FROM public.shop_photos ph WHERE ph.shop_id = s.id AND ph.photo_kind = 'logo' LIMIT 1)
    FROM public.shops s
    JOIN public.shop_categories c ON c.slug = s.category
    LEFT JOIN LATERAL public.shop_owner_rating(s.owner_id) r ON true
   WHERE public.shop_visible_to(s.id, v_uid)
     AND (p_category IS NULL OR s.category = p_category)
     AND (p_group IS NULL OR c.group_slug = p_group)
   ORDER BY 8 ASC NULLS LAST, r.rating DESC NULLS LAST, s.created_at DESC, s.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_browse(numeric, numeric, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_browse(numeric, numeric, text, text, integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Admin RPCs (L56, L75). Audited in admin_audit_log. The Shops admin
--    queue screen (L73) is a later slice; these are its back end.

-- Mark the Secretary of State number checked (or not).
CREATE OR REPLACE FUNCTION public.shops_admin_check_registration(p_shop_id uuid, p_verified boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id AND sos_number IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops
     SET sos_verified_at = CASE WHEN p_verified THEN now() END,
         sos_verified_by = CASE WHEN p_verified THEN v_uid END,
         updated_at = now()
   WHERE id = p_shop_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'shop_registration_check', 'shop', p_shop_id::text, jsonb_build_object('verified', COALESCE(p_verified, false)));
  RETURN COALESCE(p_verified, false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_check_registration(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_check_registration(uuid, boolean) TO authenticated, service_role;

-- Hide or unhide a shop (L75). HOOK: once orders and boosts exist, hiding
-- also refunds open orders in full and unused boost days.
CREATE OR REPLACE FUNCTION public.shops_admin_set_hidden(p_shop_id uuid, p_hidden boolean, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_hidden IS NULL THEN
    RAISE EXCEPTION 'invalid_hidden' USING ERRCODE = '22023';
  END IF;
  IF p_hidden AND (p_reason IS NULL OR char_length(btrim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'hide_reason_required' USING ERRCODE = '22023';
  END IF;
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_shop' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shops
     SET hidden_at = CASE WHEN p_hidden THEN now() END,
         hidden_by = CASE WHEN p_hidden THEN v_uid END,
         hidden_reason = CASE WHEN p_hidden THEN left(btrim(p_reason), 500) END,
         updated_at = now()
   WHERE id = p_shop_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_hidden THEN 'shop_hidden' ELSE 'shop_unhidden' END, 'shop', p_shop_id::text,
          jsonb_build_object('reason', p_reason));
  RETURN p_hidden;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_set_hidden(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_set_hidden(uuid, boolean, text) TO authenticated, service_role;
