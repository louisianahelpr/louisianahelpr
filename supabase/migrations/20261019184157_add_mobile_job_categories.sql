-- Mobile / "we come to you" job categories (owner decision 2026-10-19 ~18:50Z,
-- relayed by the lead): Automotive, Pets, Home, Beauty & Self-Care and Events
-- gain the services people book to come to them. IV hydration and other
-- medical services are deliberately left out (owner: not for now).
--
-- ADD VALUE IF NOT EXISTS is replay-safe (a second run is a no-op). Since PG 12
-- it may run inside the migration's transaction block; the one restriction is
-- that a value added in a transaction cannot be USED in that same transaction,
-- so this migration only adds values. Everything that reads them (the
-- license-required set, the apply/quote/award gates, the sales-tax set) lives
-- in the next migration, which runs in its own transaction.
-- Old clients (iOS 1.0.4) render an unknown category through their fallbacks
-- (getCategoryIcon -> Briefcase, categoryColors.other, formatCategory for the
-- label), so a job in a new category does not break them.
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'tire_service';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'dent_windshield';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'car_detailing';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'locksmith';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'pet_grooming';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'pet_waste_removal';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'mobile_vet';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'gutter_cleaning';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'window_washing';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'tv_mounting';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'hair_stylist';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'makeup_spray_tan';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'massage';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'mobile_bartending';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'drink_carts';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'food_truck';
ALTER TYPE public.job_category ADD VALUE IF NOT EXISTS 'photo_booth';
