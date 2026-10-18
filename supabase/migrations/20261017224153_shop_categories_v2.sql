-- Shops categories v2.2, FINAL (owner rules 2026-10-17 ~23:25Z to 2026-10-18 ~00:00Z,
-- relayed by the lead; list from the lead's draft
-- ~/.lh-wt/shop-categories-proposal-1017.md v2.2, which the owner made final; docs/specs/local-shops-prep.md "Shop categories").
--
-- The rule: Shops is for individuals and small, medium and large LOCAL
-- businesses that build a clientele, where people order, book or rent and pick
-- up or get served: a small-town outlet, NOT delivery-app food service.
--   Removed: Food truck, Restaurant, Coffee, Snowballs, Farmers market, Driving
--            school, Real estate, Insurance, Gym (owner ~00:00Z); Cakes folds into "Bakery and cakes".
--   Added:   Home kitchen, Tree service, Gutters, Window washing, Equipment
--            rental (tools, trailers, dumpsters; in Trades), Tables chairs and
--            tents, Mobile mechanic, Custom shirts and printing, Jewelry,
--            Candles and soap, Deer processing.
--   Groups:  "Food and drink" becomes "Food to order"; "Shopping" becomes
--            "Made locally"; "Learning" becomes "Lessons"; "Professional"
--            becomes "Local pros". "Events and party" keeps Events and party
--            together and gains Tables chairs and tents; no group is called
--            just "Rentals" (that is the homes section).
--   Labels in the draft's parentheses ("(pickup)", "(tools, trailers,
--   dumpsters)", "(king cakes, ...)") describe the category; they are not
--   part of its name.
-- This file states the WHOLE list (80 rows): every listed slug is upserted
-- (label, group, order), and every slug not listed is removed.
--
-- A shop on a removed slug is moved first (shops.category references
-- shop_categories(slug)): 'cakes' to 'bakery', every other removed slug to
-- 'other'. On prod (read-only, 2026-10-17 22:41Z) there are 0 shops in total,
-- so 0 are moved. What is lost: seed rows written by 20261017061155 (no member
-- data); a shop on one of them keeps existing under its new category.
--
-- REPLAY-SAFE: the upsert sets the same values again, and the moves and the
-- delete match nothing on a second run. The table comes from 20261017061155,
-- which runs first; the guard makes this a no-op on a database without it.
DO $do$
DECLARE
  v_keep text[];
BEGIN
  IF to_regclass('public.shop_categories') IS NULL OR to_regclass('public.shops') IS NULL THEN
    RETURN;
  END IF;

  WITH upserted AS (
  INSERT INTO public.shop_categories (slug, group_slug, group_label, label, position) VALUES
    ('bakery', 'food_to_order', 'Food to order', 'Bakery and cakes', 100),
    ('catering', 'food_to_order', 'Food to order', 'Catering', 101),
    ('crawfish_seafood', 'food_to_order', 'Food to order', 'Crawfish and seafood', 102),
    ('bbq', 'food_to_order', 'Food to order', 'BBQ and smoked meats', 103),
    ('meal_prep', 'food_to_order', 'Food to order', 'Meal prep', 104),
    ('home_kitchen', 'food_to_order', 'Food to order', 'Home kitchen', 105),
    ('cleaning', 'home_services', 'Home services', 'Cleaning', 200),
    ('lawn_landscaping', 'home_services', 'Home services', 'Lawn and landscaping', 201),
    ('pressure_washing', 'home_services', 'Home services', 'Pressure washing', 202),
    ('pest_control', 'home_services', 'Home services', 'Pest control', 203),
    ('pool', 'home_services', 'Home services', 'Pool', 204),
    ('moving', 'home_services', 'Home services', 'Moving', 205),
    ('junk_removal', 'home_services', 'Home services', 'Junk removal', 206),
    ('organizing', 'home_services', 'Home services', 'Organizing', 207),
    ('tree_service', 'home_services', 'Home services', 'Tree service', 208),
    ('gutters', 'home_services', 'Home services', 'Gutters', 209),
    ('window_washing', 'home_services', 'Home services', 'Window washing', 210),
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
    ('equipment_rental', 'trades', 'Trades', 'Equipment rental', 313),
    ('dj', 'events_party', 'Events and party', 'DJ', 400),
    ('photography', 'events_party', 'Events and party', 'Photography', 401),
    ('videography', 'events_party', 'Events and party', 'Videography', 402),
    ('venues', 'events_party', 'Events and party', 'Venues', 403),
    ('event_decor', 'events_party', 'Events and party', 'Decor', 404),
    ('florist', 'events_party', 'Events and party', 'Florist', 405),
    ('party_rentals', 'events_party', 'Events and party', 'Party rentals', 406),
    ('bounce_houses', 'events_party', 'Events and party', 'Bounce houses', 407),
    ('tables_chairs_tents', 'events_party', 'Events and party', 'Tables, chairs and tents', 408),
    ('mechanic', 'auto_marine', 'Auto and marine', 'Mechanic', 500),
    ('mobile_mechanic', 'auto_marine', 'Auto and marine', 'Mobile mechanic', 501),
    ('detailing', 'auto_marine', 'Auto and marine', 'Detailing', 502),
    ('towing', 'auto_marine', 'Auto and marine', 'Towing', 503),
    ('tires', 'auto_marine', 'Auto and marine', 'Tires', 504),
    ('boat_repair', 'auto_marine', 'Auto and marine', 'Boat repair', 505),
    ('hair', 'beauty', 'Beauty', 'Hair', 600),
    ('barber', 'beauty', 'Beauty', 'Barber', 601),
    ('nails', 'beauty', 'Beauty', 'Nails', 602),
    ('lashes_brows', 'beauty', 'Beauty', 'Lashes and brows', 603),
    ('makeup', 'beauty', 'Beauty', 'Makeup', 604),
    ('spa', 'beauty', 'Beauty', 'Spa', 605),
    ('tattoo', 'beauty', 'Beauty', 'Tattoo', 606),
    ('personal_trainer', 'health_fitness', 'Health and fitness', 'Personal trainer', 700),
    ('yoga', 'health_fitness', 'Health and fitness', 'Yoga', 702),
    ('massage', 'health_fitness', 'Health and fitness', 'Massage', 703),
    ('nutrition', 'health_fitness', 'Health and fitness', 'Nutrition', 704),
    ('pet_grooming', 'pets', 'Pets', 'Grooming', 800),
    ('pet_sitting_walking', 'pets', 'Pets', 'Sitting and walking', 801),
    ('pet_training', 'pets', 'Pets', 'Training', 802),
    ('pet_boarding', 'pets', 'Pets', 'Boarding', 803),
    ('boutique', 'made_locally', 'Made locally', 'Boutique', 900),
    ('crafts_gifts', 'made_locally', 'Made locally', 'Crafts and gifts', 901),
    ('home_decor', 'made_locally', 'Made locally', 'Home decor', 902),
    ('plants_garden', 'made_locally', 'Made locally', 'Plants and garden', 903),
    ('custom_shirts_printing', 'made_locally', 'Made locally', 'Custom shirts and printing', 904),
    ('jewelry', 'made_locally', 'Made locally', 'Jewelry', 905),
    ('candles_soap', 'made_locally', 'Made locally', 'Candles and soap', 906),
    ('tutoring', 'lessons', 'Lessons', 'Tutoring', 1000),
    ('music_lessons', 'lessons', 'Lessons', 'Music lessons', 1001),
    ('classes', 'lessons', 'Lessons', 'Classes', 1002),
    ('tax_bookkeeping', 'local_pros', 'Local pros', 'Tax and bookkeeping', 1100),
    ('notary', 'local_pros', 'Local pros', 'Notary', 1101),
    ('printing', 'local_pros', 'Local pros', 'Printing', 1102),
    ('it_phone_repair', 'local_pros', 'Local pros', 'IT and phone repair', 1103),
    ('fishing_charters', 'outdoors', 'Outdoors', 'Fishing charters', 1200),
    ('hunting_guides', 'outdoors', 'Outdoors', 'Hunting guides', 1201),
    ('swamp_tours', 'outdoors', 'Outdoors', 'Swamp tours', 1202),
    ('deer_processing', 'outdoors', 'Outdoors', 'Deer processing', 1203),
    ('other', 'other', 'Other', 'Other', 9999)
  ON CONFLICT (slug) DO UPDATE
    SET group_slug = EXCLUDED.group_slug, group_label = EXCLUDED.group_label,
        label = EXCLUDED.label, position = EXCLUDED.position
  RETURNING slug)
  SELECT array_agg(slug) INTO v_keep FROM upserted;
  -- The whole list or nothing (lh-authz-rls review of 6c5fb1672, note 5): a
  -- later edit can never quietly shrink it, and a NULL list never deletes.
  IF cardinality(v_keep) IS DISTINCT FROM 80 THEN
    RAISE EXCEPTION 'shop_categories_v2: expected 80 categories, got %', cardinality(v_keep);
  END IF;

  -- Every slug this file does not list goes: its shops move first.
  UPDATE public.shops SET category = CASE WHEN category = 'cakes' THEN 'bakery' ELSE 'other' END, updated_at = now()
   WHERE category <> ALL (v_keep);
  DELETE FROM public.shop_categories WHERE slug <> ALL (v_keep);
END
$do$;
