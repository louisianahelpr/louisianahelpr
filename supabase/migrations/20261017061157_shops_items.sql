-- SHOPS, SLICE 2: ITEMS (owner, 2026-10-16: "get to building shops in
-- parallel"). Owner decision record docs/specs/local-shops-prep.md, "Owner
-- answers" (cited L<n>) and section 5 S2; the choices the spec left open are
-- the dated "default chosen by lane, owner to confirm" rows there (cited D<n>).
--
-- WHAT A SHOP CAN LIST (L5-L16):
--   made       made by the maker, NEW (L16: no used items): candles, crafts,
--              decor, furniture, adult clothing, art (L14). Not children's
--              items (L12) and not soap/lotion/balms (L14, waiting on the
--              cosmetics rules): no subtype exists for them.
--   home_food  ONLY the R.S. 40:4.9(E) low-risk list, nothing with meat or
--              fish (L5): baked goods, candy, cane syrup, dry mixes, honey,
--              jams/jellies, pickles, sauces/syrups, spices. Permit foods
--              (L6: plate lunches, gumbo, boudin, seafood) need an admin-
--              checked health permit; that credential type does not exist yet
--              (docs/OPEN.md, the Shops admin queue item), so no permit-food subtype exists (D1).
--   farm       eggs from the seller's own hens (L9), whole uncut home-grown
--              produce (L10). Plants/seedlings/flowers are not at launch (L11).
--   rental     RESERVED only (spec section 5 lists it in S2's kinds; rentals
--              are S5, the Shops rentals item in docs/OPEN.md): the CHECK allows it, every RPC refuses it
--              ('rental_not_available'), as Declutter reserved 'auction'.
-- The subtypes are rows of shop_item_subtypes, so the server refuses
-- anything off the list whatever the client sends.
--
-- PER ITEM: price (display only: NO orders, checkout or money in this slice,
-- S3 reuses Declutter's checkout), lead time in days (L21), an optional
-- "ready now" stock count (L20; buying still goes to the maker to accept), 3
-- to 12 photos (Declutter's photo rules), the kind's own confirmations (L7,
-- L9, L10, L13, L16), the AI check (L51) and a server-side word check. PER
-- SHOP: the most orders it takes a day (L22: shops.daily_order_cap; the order
-- days are the shop's opening days, shop_hours, D4).
--
-- HOME FOOD (L7, L8): every home-food item shows the "made in a home
-- kitchen" notice in the app, and the baker ticks "my package label says it"
-- (the 'label_says_home_kitchen' confirmation, required to publish). The
-- yearly limit: the baker confirms each calendar year (Louisiana time) that
-- their home-food sales are under the state limit (shop_cottage_confirmations);
-- the app counts its OWN sales (shop_cottage_sales, written by the order slice
-- with the service role; nothing writes it yet), warns at 80% and, at the
-- limit, refuses new home-food listings here and new home-food orders in S3
-- (shop_cottage_cap_reached). The limit is a setting row, $30,000 (the code
-- page today; Act 801 of 2026 raises it to $100,000, effective date not
-- confirmed: D2).
--
-- REVIEW (L52): a shop's first 3 items wait for an admin; so does any item the
-- AI flagged or never checked, and any item whose words trip the banned-list
-- word check (shop_item_text_flag). Admins approve or reject with a reason
-- (shops_admin_review_item), never their own item, never for an owner who
-- cannot sell now; every decision is in admin_audit_log.
--
-- HIDDEN: behind slice 1's hidden switch 'shops' (still OFF). Every client RPC
-- starts PERFORM public.require_feature('shops'); the items read policy needs
-- shop_publicly_visible (switch on for the caller) for anyone but the owner.
--
-- GATES, server-side: every owner write runs slice 1's
-- shops_assert_owner_eligible (signed in, not banned, 18+, under 3 shared
-- marketplace strikes, payout setup finished: L3, L45, L82) and names
-- is_caller_banned() in its own body (the Q281 class). A hidden shop lists
-- nothing new (L75). Withdrawing your own item needs only signed in and not
-- banned (Declutter's rule: an under-18 or struck member may still take an
-- item down).
--
-- PRIVACY: the AI verdict, the word-check reason and the admin note live in
-- shop_item_private (RLS on, no policy, no client privilege), read through
-- shops_my_item_review (the owner) and shops_admin_pending_items (admins).
--
-- ALSO: shops_close_my_shop is restated so closing a shop returns the item
-- photo paths too (else they stayed public by URL after the CASCADE), and
-- export_my_data is restated from its NEWEST body (20261017052706, the
-- Declutter stack's Helpr-delivery export, which already carries the wanted
-- and delivery sections) adding the shop and item sections, which closes the
-- Shops export item in docs/OPEN.md. This file was re-cut from
-- 20261016212915 to a timestamp newer than 20261017052706 (2026-10-17) so
-- prod, which applies an out-of-order file last, still ends on this body.
--
-- Error codes: 42501 refusals, 22023 bad input, P0002 an item the caller
-- cannot act on (a stranger is never told "exists but not yours"), 40001 a
-- stale AI verdict.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT
-- DO NOTHING; grants restated by role name. Applied 3x in PGlite by
-- src/test/pglite/shopsItems.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. What may be listed (L5, L9-L14, L16): a fixed list, a table so a later
--    decision adds a row without a release. Written by migrations only.
CREATE TABLE IF NOT EXISTS public.shop_item_subtypes (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  kind text NOT NULL CHECK (kind IN ('made', 'home_food', 'farm', 'rental')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 40),
  position smallint NOT NULL
);
ALTER TABLE public.shop_item_subtypes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_item_subtypes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_item_subtypes TO authenticated;
GRANT ALL ON TABLE public.shop_item_subtypes TO service_role;
DROP POLICY IF EXISTS "shop item subtypes: readable by members" ON public.shop_item_subtypes;
CREATE POLICY "shop item subtypes: readable by members" ON public.shop_item_subtypes
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.shop_item_subtypes (slug, kind, label, position) VALUES
  -- L14: yes now. Soap/lotion/balms wait (no row); children's items (L12) none.
  ('candles', 'made', 'Candles', 100),
  ('crafts', 'made', 'Crafts', 101),
  ('decor', 'made', 'Decor', 102),
  ('furniture', 'made', 'Furniture', 103),
  ('adult_clothing', 'made', 'Clothing (adult)', 104),
  ('art', 'made', 'Art', 105),
  -- L5: R.S. 40:4.9(E), the low-risk list. No meat or fish protein.
  ('baked_goods', 'home_food', 'Baked goods', 200),
  ('candy', 'home_food', 'Candy', 201),
  ('cane_syrup', 'home_food', 'Cane syrup', 202),
  ('dried_mixes', 'home_food', 'Dry mixes', 203),
  ('honey', 'home_food', 'Honey', 204),
  ('jams_jellies', 'home_food', 'Jams, jellies and preserves', 205),
  ('pickles', 'home_food', 'Pickles and acidified foods', 206),
  ('sauces_syrups', 'home_food', 'Sauces and syrups', 207),
  ('spices', 'home_food', 'Spices', 208),
  -- L9, L10. Plants, seedlings and cut flowers are not at launch (L11).
  ('eggs', 'farm', 'Eggs (own hens)', 300),
  ('produce', 'farm', 'Fruit and vegetables (whole, uncut)', 301)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The shop's daily order limit (L22). NULL = no limit set yet. The order
--    slice greys out a full day; this slice only stores it.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS daily_order_cap smallint;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_daily_order_cap_range') THEN
    ALTER TABLE public.shops
      ADD CONSTRAINT shops_daily_order_cap_range CHECK (daily_order_cap IS NULL OR daily_order_cap BETWEEN 1 AND 200);
  END IF;
END
$do$;
GRANT SELECT (daily_order_cap) ON TABLE public.shops TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Items: the PUBLIC fields only.
CREATE TABLE IF NOT EXISTS public.shop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('made', 'home_food', 'farm', 'rental')),
  subtype text NOT NULL REFERENCES public.shop_item_subtypes(slug),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',           -- being written; only the owner sees it
    'pending_review',  -- L52: waits for an admin's OK
    'live',            -- listed on the shop page
    'withdrawn',       -- the owner took it down
    'rejected'         -- an admin refused it at review (the owner reads why)
  )),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  -- Display only in this slice (no orders or money until S3). D3: $1 to
  -- $1,000, Declutter's cap.
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 100000),
  -- L21: days the maker needs before an order can be ready (0 = same day).
  lead_time_days smallint NOT NULL DEFAULT 1 CHECK (lead_time_days BETWEEN 0 AND 60),
  -- L20: "ready now" with a count. NULL = made to order.
  stock_count integer CHECK (stock_count IS NULL OR stock_count BETWEEN 0 AND 9999),
  admin_approved_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  live_at timestamptz
);
CREATE INDEX IF NOT EXISTS shop_items_shop_idx ON public.shop_items (shop_id, status);
CREATE INDEX IF NOT EXISTS shop_items_owner_idx ON public.shop_items (owner_id);
CREATE INDEX IF NOT EXISTS shop_items_subtype_idx ON public.shop_items (subtype);
-- A subtype belongs to exactly one kind; the pair is checked by trigger 5b.

ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_items FROM PUBLIC, anon, authenticated;
-- Column grants (lh-authz-rls review nit 5): admin_approved_at (which items
-- went through an admin) is not client-readable; the owner reads their own
-- review state through shops_my_item_review.
GRANT SELECT (id, shop_id, owner_id, kind, subtype, status, title, description, price_cents, lead_time_days,
              stock_count, is_seed, created_at, updated_at, submitted_at, live_at)
  ON TABLE public.shop_items TO authenticated;
GRANT ALL ON TABLE public.shop_items TO service_role;
DROP POLICY IF EXISTS "shop items: owner or switched-on members read live" ON public.shop_items;
CREATE POLICY "shop items: owner or switched-on members read live" ON public.shop_items
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    -- The shop's own rule (switch on for the caller, not hidden, no test shop
    -- while seeds are hidden, owner in good standing), so items and their
    -- shop are never visible apart.
    OR (status = 'live' AND public.shop_publicly_visible(shop_id)
        -- D12 (lh-authz-rls review should-fix 3): a shop that turned selling
        -- off shows no items.
        AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = shop_items.shop_id AND s.offers_selling))
  );
COMMENT ON TABLE public.shop_items IS
  'Shops slice 2: items a shop lists (docs/specs/local-shops-prep.md S2, L5-L22). PUBLIC fields only; the AI '
  'verdict and the admin note are in shop_item_private. Written only by shops_* RPCs. No orders or money here.';

-- ---------------------------------------------------------------------------
-- 4. The owner/admin-only half of an item. No policy, no client privilege.
CREATE TABLE IF NOT EXISTS public.shop_item_private (
  item_id uuid PRIMARY KEY REFERENCES public.shop_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_checked_at timestamptz,
  ai_flag_reason text CHECK (ai_flag_reason IS NULL OR char_length(ai_flag_reason) <= 300),
  -- The banned-list word check's reason at the last publish (shop_item_text_flag).
  text_flag_reason text CHECK (text_flag_reason IS NULL OR char_length(text_flag_reason) <= 300),
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  -- lh-authz-rls review must-fix 1: once an admin rejected the item, every
  -- later publish waits for an admin again, whatever the edit; cleared only
  -- when an admin approves it.
  admin_rejected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_item_private_owner_idx ON public.shop_item_private (owner_id);
ALTER TABLE public.shop_item_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_item_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shop_item_private TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Photos: 3 to 12 (Declutter's rule), in job-photos under
--    <owner uid>/shop-items/<item id>/<file>: a folder of its own, so slice 1's
--    "unattached shop photo" delete policy (which reads shop_photos only) can
--    never delete an ATTACHED item photo. Purged with the account
--    (_shared/purgeBuckets.ts IDENTITY_SUBFOLDERS).
CREATE TABLE IF NOT EXISTS public.shop_item_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path ~ '^[0-9a-f-]{36}/shop-items/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_item_photos_position_key UNIQUE (item_id, position)
);
CREATE INDEX IF NOT EXISTS shop_item_photos_owner_idx ON public.shop_item_photos (owner_id);
ALTER TABLE public.shop_item_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_item_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_item_photos TO authenticated;
GRANT ALL ON TABLE public.shop_item_photos TO service_role;
DROP POLICY IF EXISTS "shop item photos: readable with their item" ON public.shop_item_photos;
CREATE POLICY "shop item photos: readable with their item" ON public.shop_item_photos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shop_items i WHERE i.id = shop_item_photos.item_id));

DROP POLICY IF EXISTS "Owners delete own unattached shop item photos" ON storage.objects;
CREATE POLICY "Owners delete own unattached shop item photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] = 'shop-items'
    AND NOT EXISTS (SELECT 1 FROM public.shop_item_photos p WHERE p.storage_path = objects.name)
  );

-- ---------------------------------------------------------------------------
-- 6. The kind's confirmations, as ticked for the item as it is now described.
--    An edit to what the item IS (kind, type, title, description) deletes
--    them, so they are asked again.
CREATE TABLE IF NOT EXISTS public.shop_item_attestations (
  item_id uuid PRIMARY KEY REFERENCES public.shop_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  statements text[] NOT NULL CHECK (cardinality(statements) BETWEEN 1 AND 16),
  attested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_item_attestations_owner_idx ON public.shop_item_attestations (owner_id);
ALTER TABLE public.shop_item_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_item_attestations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_item_attestations TO authenticated;
GRANT ALL ON TABLE public.shop_item_attestations TO service_role;
DROP POLICY IF EXISTS "shop item attestations: owner reads own" ON public.shop_item_attestations;
CREATE POLICY "shop item attestations: owner reads own" ON public.shop_item_attestations
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. The home-food yearly limit (L8).
--    7a. The limit itself: one row, a setting (D2). Public law, readable.
CREATE TABLE IF NOT EXISTS public.shop_cottage_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cap_cents bigint NOT NULL CHECK (cap_cents BETWEEN 100000 AND 100000000),
  warn_percent smallint NOT NULL DEFAULT 80 CHECK (warn_percent BETWEEN 1 AND 99),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shop_cottage_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_cottage_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_cottage_settings TO authenticated;
GRANT ALL ON TABLE public.shop_cottage_settings TO service_role;
DROP POLICY IF EXISTS "shop cottage settings: readable by members" ON public.shop_cottage_settings;
CREATE POLICY "shop cottage settings: readable by members" ON public.shop_cottage_settings
  FOR SELECT TO authenticated USING (true);
INSERT INTO public.shop_cottage_settings (id, cap_cents, warn_percent, note)
VALUES (true, 3000000, 80,
        'La. R.S. 40:4.9(B) as the code page reads ($30,000). Act 801 of 2026 (HB 403) raises it to $100,000; '
        'its effective date is not confirmed (docs/specs/local-shops-prep.md D2).')
ON CONFLICT (id) DO NOTHING;

--    7b. The baker's yearly confirmation (calendar year, Louisiana time).
CREATE TABLE IF NOT EXISTS public.shop_cottage_confirmations (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  limit_year smallint NOT NULL CHECK (limit_year BETWEEN 2026 AND 2200),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, limit_year)
);
ALTER TABLE public.shop_cottage_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_cottage_confirmations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_cottage_confirmations TO authenticated;
GRANT ALL ON TABLE public.shop_cottage_confirmations TO service_role;
DROP POLICY IF EXISTS "shop cottage confirmations: owner reads own" ON public.shop_cottage_confirmations;
CREATE POLICY "shop cottage confirmations: owner reads own" ON public.shop_cottage_confirmations
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

--    7c. The app's own home-food sales, one row per sale. Written by the
--        order slice (S3) with the service role only; NOTHING writes it in
--        this slice. source_ref is the order id, so a sale counts once.
CREATE TABLE IF NOT EXISTS public.shop_cottage_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_ref uuid NOT NULL UNIQUE,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000),
  sold_at timestamptz NOT NULL DEFAULT now(),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shop_cottage_sales_owner_idx ON public.shop_cottage_sales (owner_id, sold_at);
ALTER TABLE public.shop_cottage_sales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_cottage_sales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.shop_cottage_sales TO authenticated;
GRANT ALL ON TABLE public.shop_cottage_sales TO service_role;
DROP POLICY IF EXISTS "shop cottage sales: owner reads own" ON public.shop_cottage_sales;
CREATE POLICY "shop cottage sales: owner reads own" ON public.shop_cottage_sales
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 8. Triggers.
--    8a. is_seed from birth: a test account's items and sales are seed data.
CREATE OR REPLACE FUNCTION public.shop_rows_seed_from_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NOT NEW.is_seed AND EXISTS (
       SELECT 1 FROM public.profiles p WHERE p.user_id = NEW.owner_id AND p.is_seed
     ) THEN
    NEW.is_seed := true;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_rows_seed_from_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_items_seed_from_owner ON public.shop_items;
CREATE TRIGGER trg_shop_items_seed_from_owner
  BEFORE INSERT ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_rows_seed_from_owner();
DROP TRIGGER IF EXISTS trg_shop_cottage_sales_seed_from_owner ON public.shop_cottage_sales;
CREATE TRIGGER trg_shop_cottage_sales_seed_from_owner
  BEFORE INSERT ON public.shop_cottage_sales
  FOR EACH ROW EXECUTE FUNCTION public.shop_rows_seed_from_owner();

--    8b. The kind and the type agree, whoever writes the row.
CREATE OR REPLACE FUNCTION public.shop_items_kind_matches_subtype()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shop_item_subtypes s WHERE s.slug = NEW.subtype AND s.kind = NEW.kind) THEN
    RAISE EXCEPTION 'invalid_subtype' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_items_kind_matches_subtype() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_items_kind_matches_subtype ON public.shop_items;
CREATE TRIGGER trg_shop_items_kind_matches_subtype
  BEFORE INSERT OR UPDATE OF kind, subtype ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_items_kind_matches_subtype();

--    8c. Contact-leak filter on the item's words (L49), rejected, never hidden.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_shop_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
  v_where text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
    v_reason := public.contact_leak_reason(NEW.title); v_where := 'title';
  END IF;
  IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.description IS DISTINCT FROM OLD.description) THEN
    v_reason := public.contact_leak_reason(NEW.description); v_where := 'description';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      -- lh-silent-failure re-review: shops have no Message button yet
      -- (the Shops Message button item in docs/OPEN.md), so the refusal no longer points at one.
      MESSAGE = v_reason || ' in the ' || v_where || '. Keep phone numbers, emails and websites off your items; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_shop_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_shop_item ON public.shop_items;
CREATE TRIGGER trg_reject_contact_leak_in_shop_item
  BEFORE INSERT OR UPDATE OF title, description ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_shop_item();

--    8c'. Slice 1's shop-profile filter (newest body: 20261017061155), restated
--         verbatim but for its last words: it told members to use a Message
--         button shops do not have yet (the Shops Message button item in docs/OPEN.md). The trigger
--         itself is slice 1's and is not touched.
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
      MESSAGE = v_reason || ' in the ' || v_where || '. Keep phone numbers, emails and websites off your shop; Louisiana Helpr does not allow contact details in Shops.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_shop() FROM PUBLIC, anon, authenticated;

--    8d. A photo added or removed voids the AI check (Declutter's rule): the
--        photos it judged changed. It also voids the admin approval (N3).
CREATE OR REPLACE FUNCTION public.shop_item_photos_void_ai_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  UPDATE public.shop_item_private
     SET ai_checked_at = NULL, ai_flag_reason = NULL, updated_at = now()
   WHERE item_id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END)
     AND (ai_checked_at IS NOT NULL OR ai_flag_reason IS NOT NULL);
  -- lh-authz-rls re-review N3: an approval covers the photos an admin saw,
  -- so new or removed photos drop it, as a word edit does (should-fix 4):
  -- the item no longer counts toward the shop's first 3.
  UPDATE public.shop_items
     SET admin_approved_at = NULL
   WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.item_id ELSE NEW.item_id END)
     AND admin_approved_at IS NOT NULL;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_photos_void_ai_check() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_item_photos_void_ai_check ON public.shop_item_photos;
CREATE TRIGGER trg_shop_item_photos_void_ai_check
  AFTER INSERT OR DELETE ON public.shop_item_photos
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_photos_void_ai_check();

-- ---------------------------------------------------------------------------
-- 9. Internal helpers (no client EXECUTE).

-- The confirmations each kind and type needs (L7, L9, L10, L12-L16;
-- R.S. 40:4.9 A(2), C, D(1), D(2), F). The words the member ticks are
-- SHOP_ITEM_STATEMENTS in src/lib/shops/items.ts; src/test/shopsItems.test.ts
-- holds the two lists equal.
CREATE OR REPLACE FUNCTION public.shop_item_required_statements(p_kind text, p_subtype text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE p_kind
    WHEN 'made' THEN ARRAY['made_by_me', 'new_not_used', 'not_for_children', 'not_skin_product', 'not_banned']
    WHEN 'home_food' THEN ARRAY['made_in_my_home_kitchen', 'low_risk_no_meat_fish', 'label_says_home_kitchen',
                                'kitchen_rules', 'no_cbd_or_alcohol', 'sales_tax_registered', 'not_banned']
    WHEN 'farm' THEN CASE p_subtype
      WHEN 'eggs' THEN ARRAY['own_hens', 'kept_cold', 'no_cracked_dirty', 'not_banned']
      WHEN 'produce' THEN ARRAY['home_grown', 'whole_uncut', 'not_banned']
    END
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_required_statements(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_item_required_statements(text, text) TO service_role;

-- The banned-list WORD check (L11-L14, L16): returns why the words look like
-- something Shops cannot list, or NULL. A hit never refuses (a "rum cake" or
-- "fishing lure" may be fine): it sends the item to an admin with the reason.
-- The AI check (L51) judges the photos; this catches what the words say.
CREATE OR REPLACE FUNCTION public.shop_item_text_flag(p_kind text, p_title text, p_description text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v text := lower(COALESCE(p_title, '') || ' ' || COALESCE(p_description, ''));
BEGIN
  IF v ~ '\m(beer|wine|liquor|whiskey|whisky|vodka|moonshine|alcohol|alcoholic|rum|bourbon|tequila|daiquiri|spirits)\M' THEN
    RETURN 'Mentions alcohol (not allowed in Shops).';
  END IF;
  IF v ~ '\m(cbd|thc|delta[- ]?8|delta[- ]?9|hemp|cannabis|marijuana|kratom)\M' THEN
    RETURN 'Mentions CBD, THC or hemp (not allowed in Shops).';
  END IF;
  IF v ~ '\m(vape|vapes|vaping|e-cig|e-cigarette|nicotine|tobacco|cigars?)\M' THEN
    RETURN 'Mentions vapes or tobacco (not allowed in Shops).';
  END IF;
  IF v ~ '\m(raw milk|unpasteurized)\M' THEN
    RETURN 'Mentions raw or unpasteurized milk (not allowed in Shops).';
  END IF;
  IF v ~ '\m(supplements?|vitamins?|medicine|medicinal|remedy|remedies|cures?|tinctures?)\M' THEN
    RETURN 'Mentions medicines or supplements (not allowed in Shops).';
  END IF;
  IF v ~ '\m(puppy|puppies|kitten|kittens|chicks|ducklings|live animals?|piglets?)\M' THEN
    RETURN 'Mentions live animals (not allowed in Shops).';
  END IF;
  IF v ~ '\m(gun|guns|firearms?|ammo|ammunition|rifle|pistol|knives)\M' THEN
    RETURN 'Mentions weapons (not allowed in Shops).';
  END IF;
  IF v ~ '\m(used|pre-owned|preowned|secondhand|second-hand|gently worn|thrifted|vintage)\M' THEN
    RETURN 'Sounds used. Shops sell new things the maker made; used things go in Declutter.';
  END IF;
  IF v ~ '\m(baby|babies|infant|toddler|kids|children''?s|toy|toys|crib|bib|onesie)\M' THEN
    RETURN 'Sounds like a children''s item (not at launch: federal safety testing).';
  END IF;
  IF v ~ '\m(soap|soaps|lotion|lotions|balm|balms|salve|salves|cosmetics?|skincare|skin care|lip gloss|scrub)\M' THEN
    RETURN 'Sounds like a skin product (soap, lotion and balms are not at launch).';
  END IF;
  IF v ~ '\m(seedlings?|plants?|succulents?|cut flowers|bouquets?|nursery)\M' THEN
    RETURN 'Sounds like plants or flowers (not at launch: plant dealer permit).';
  END IF;
  IF p_kind = 'home_food' AND v ~ '\m(meat|beef|pork|chicken|turkey|sausage|boudin|andouille|jerky|bacon|ham|crawfish|shrimp|crab|fish|seafood|oysters?|gumbo|jambalaya|tamales?|meat pies?|cracklins?|plate lunch)\M' THEN
    RETURN 'Home-kitchen food cannot contain meat or fish (needs a health permit).';
  END IF;
  IF p_kind = 'home_food' AND v ~ '\m(canned (vegetables|beans|corn|green beans|okra|tomatoes|meat)|home-canned)\M' THEN
    RETURN 'Home-canned vegetables or meat are not allowed (pickles and acidified foods are).';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_text_flag(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_item_text_flag(text, text, text) TO service_role;

-- The calendar year of the home-food limit, Louisiana time (D5).
CREATE OR REPLACE FUNCTION public.shop_cottage_year()
RETURNS smallint
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT extract(year FROM (now() AT TIME ZONE 'America/Chicago'))::smallint;
$fn$;
REVOKE ALL ON FUNCTION public.shop_cottage_year() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_cottage_year() TO service_role;

-- The owner's app home-food sales in the current limit year.
CREATE OR REPLACE FUNCTION public.shop_cottage_sales_cents(p_owner_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(sum(s.amount_cents), 0)::bigint
    FROM public.shop_cottage_sales s
   WHERE s.owner_id = p_owner_id
     AND extract(year FROM (s.sold_at AT TIME ZONE 'America/Chicago')) = public.shop_cottage_year();
$fn$;
REVOKE ALL ON FUNCTION public.shop_cottage_sales_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_cottage_sales_cents(uuid) TO service_role;

-- TRUE = the owner is at the yearly home-food limit: no new home-food
-- listings (here) and no new home-food orders (S3). Fails safe: a NULL owner,
-- or no limit row, is TRUE.
CREATE OR REPLACE FUNCTION public.shop_cottage_cap_reached(p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_owner_id IS NULL
      OR COALESCE((SELECT public.shop_cottage_sales_cents(p_owner_id) >= c.cap_cents
                     FROM public.shop_cottage_settings c WHERE c.id), true);
$fn$;
REVOKE ALL ON FUNCTION public.shop_cottage_cap_reached(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_cottage_cap_reached(uuid) TO service_role;

-- Why the member cannot sell right now, or NULL: banned or suspended, 3
-- shared marketplace strikes (L45), under 18 (L82), payout setup not done
-- (L3). The same four rules as slice 1's shops_assert_owner_eligible (which
-- raises them for the CALLER); this one judges another member, for the admin
-- approval (lh-authz-rls review should-fix 2).
CREATE OR REPLACE FUNCTION public.shop_owner_sell_block_reason(p_owner_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
    WHEN p_owner_id IS NULL THEN 'no_owner'
    WHEN EXISTS (SELECT 1 FROM public.profiles pr
                  WHERE pr.user_id = p_owner_id
                    AND pr.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                    AND (pr.ban_status <> 'temp_banned' OR pr.auto_suspended_until IS NULL OR pr.auto_suspended_until > now()))
      THEN 'account_restricted'
    WHEN public.declutter_active_strike_count(p_owner_id) >= 3 THEN 'shop_strikes_blocked'
    WHEN public.member_under_18(p_owner_id) THEN 'under_18'
    WHEN public.helper_award_block_reason(p_owner_id) IS NOT NULL THEN 'payout_setup_incomplete'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_owner_sell_block_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_owner_sell_block_reason(uuid) TO service_role;

-- The caller's own item, locked, with its shop checked: the caller's shop,
-- not hidden by an admin (L75). Raises item_not_found for anyone else's.
CREATE OR REPLACE FUNCTION public.shops_lock_own_item(p_item_id uuid, p_uid uuid)
RETURNS public.shop_items
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item public.shop_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.shop_items WHERE id = p_item_id AND owner_id = p_uid FOR UPDATE;
  IF NOT FOUND OR p_uid IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shops s WHERE s.id = v_item.shop_id AND s.hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  RETURN v_item;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_lock_own_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_lock_own_item(uuid, uuid) TO service_role;

-- The checks every item write makes on what the item says (create + update).
CREATE OR REPLACE FUNCTION public.shops_check_item_fields(
  p_kind text, p_subtype text, p_title text, p_description text, p_price_cents integer,
  p_lead_time_days integer, p_stock_count integer)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind = 'rental' THEN
    -- Reserved for the rentals slice (S5, the Shops rentals item in docs/OPEN.md).
    RAISE EXCEPTION 'rental_not_available' USING ERRCODE = '22023',
      HINT = 'Renting things out is coming later.';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF p_subtype IS NULL OR NOT EXISTS (SELECT 1 FROM public.shop_item_subtypes s WHERE s.slug = p_subtype AND s.kind = p_kind) THEN
    RAISE EXCEPTION 'invalid_subtype' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 3 AND 80 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(p_description, '')) > 2000 THEN
    RAISE EXCEPTION 'description_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 100000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023';
  END IF;
  IF p_lead_time_days IS NULL OR p_lead_time_days NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'invalid_lead_time' USING ERRCODE = '22023';
  END IF;
  IF p_stock_count IS NOT NULL AND p_stock_count NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION 'invalid_stock' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 10. Owner RPCs. Each VOLATILE one names is_caller_banned() in its own body.

-- Create a DRAFT item in the caller's shop. Returns its id.
CREATE OR REPLACE FUNCTION public.shops_create_item(
  p_kind text,
  p_subtype text,
  p_title text,
  p_description text,
  p_price_cents integer,
  p_lead_time_days integer,
  p_stock_count integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_shop public.shops%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  SELECT * INTO v_shop FROM public.shops WHERE owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_shop.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501', HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  IF NOT v_shop.offers_selling THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '22023', HINT = 'Turn on selling for your shop first.';
  END IF;
  PERFORM public.shops_check_item_fields(p_kind, p_subtype, p_title, p_description, p_price_cents, p_lead_time_days, p_stock_count);
  -- D6: at most 100 items a shop keeps (withdrawn ones do not count).
  IF (SELECT count(*) FROM public.shop_items i WHERE i.shop_id = v_shop.id AND i.status <> 'withdrawn') >= 100 THEN
    RAISE EXCEPTION 'too_many_items' USING ERRCODE = '22023', HINT = 'A shop can list up to 100 items.';
  END IF;

  INSERT INTO public.shop_items (shop_id, owner_id, kind, subtype, title, description, price_cents, lead_time_days, stock_count)
  VALUES (v_shop.id, v_uid, p_kind, p_subtype, btrim(p_title), COALESCE(btrim(p_description), ''),
          p_price_cents, p_lead_time_days, p_stock_count)
  RETURNING id INTO v_id;
  INSERT INTO public.shop_item_private (item_id, owner_id) VALUES (v_id, v_uid);
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_create_item(text, text, text, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_create_item(text, text, text, text, integer, integer, integer) TO authenticated, service_role;

-- Edit the caller's own item. An item under review, live or rejected goes back
-- to DRAFT (off the shop page) until it is published again, so nothing an
-- admin or the AI judged can change while it stays up. A change to what the
-- item IS (kind, type, title, description) clears the AI verdict and asks for
-- the confirmations again. Returns the item's status after the edit.
CREATE OR REPLACE FUNCTION public.shops_update_item(
  p_item_id uuid,
  p_kind text,
  p_subtype text,
  p_title text,
  p_description text,
  p_price_cents integer,
  p_lead_time_days integer,
  p_stock_count integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status = 'withdrawn' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  PERFORM public.shops_check_item_fields(p_kind, p_subtype, p_title, p_description, p_price_cents, p_lead_time_days, p_stock_count);

  IF v_item.kind IS DISTINCT FROM p_kind
     OR v_item.subtype IS DISTINCT FROM p_subtype
     OR v_item.title IS DISTINCT FROM btrim(p_title)
     OR v_item.description IS DISTINCT FROM COALESCE(btrim(p_description), '') THEN
    UPDATE public.shop_item_private
       SET ai_checked_at = NULL, ai_flag_reason = NULL, text_flag_reason = NULL, updated_at = now()
     WHERE item_id = p_item_id;
    DELETE FROM public.shop_item_attestations WHERE item_id = p_item_id;
    -- lh-authz-rls review should-fix 4: an approval covers the item an admin
    -- saw, so a rewritten item no longer counts toward the shop's first 3.
    UPDATE public.shop_items SET admin_approved_at = NULL WHERE id = p_item_id;
  END IF;

  UPDATE public.shop_items
     SET kind = p_kind,
         subtype = p_subtype,
         title = btrim(p_title),
         description = COALESCE(btrim(p_description), ''),
         price_cents = p_price_cents,
         lead_time_days = p_lead_time_days,
         stock_count = p_stock_count,
         status = 'draft',
         live_at = NULL,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN 'draft';
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_update_item(uuid, text, text, text, text, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_update_item(uuid, text, text, text, text, integer, integer, integer) TO authenticated, service_role;

-- Stock count and lead time (L20, L21): logistics, not what the item is, so
-- they change while the item stays up. Returns the new stock count.
CREATE OR REPLACE FUNCTION public.shops_set_item_stock(p_item_id uuid, p_stock_count integer, p_lead_time_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status NOT IN ('draft', 'pending_review', 'live') THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  IF p_stock_count IS NOT NULL AND p_stock_count NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION 'invalid_stock' USING ERRCODE = '22023';
  END IF;
  IF p_lead_time_days IS NULL OR p_lead_time_days NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'invalid_lead_time' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_items
     SET stock_count = p_stock_count, lead_time_days = p_lead_time_days, updated_at = now()
   WHERE id = p_item_id;
  RETURN p_stock_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_item_stock(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_item_stock(uuid, integer, integer) TO authenticated, service_role;

-- The shop's daily order limit (L22). NULL clears it. Returns it.
CREATE OR REPLACE FUNCTION public.shops_set_daily_order_cap(p_cap integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF p_cap IS NOT NULL AND p_cap NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_daily_cap' USING ERRCODE = '22023', HINT = 'Between 1 and 200 orders a day.';
  END IF;
  UPDATE public.shops SET daily_order_cap = p_cap, updated_at = now() WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_cap;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_set_daily_order_cap(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_set_daily_order_cap(integer) TO authenticated, service_role;

-- Attach an uploaded photo to the caller's own DRAFT item. Returns the photo id.
CREATE OR REPLACE FUNCTION public.shops_add_item_photo(p_item_id uuid, p_storage_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_pos smallint;
  v_id uuid;
  v_constraint text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- The caller's own folder for THIS item, and the object is really there,
  -- uploaded by the caller, an image (job-photos also takes video, which keeps GPS).
  IF p_storage_path IS NULL
     OR p_storage_path !~ '^[0-9a-f-]{36}/shop-items/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_item_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  SELECT g.p INTO v_pos
    FROM generate_series(0, 11) AS g(p)
   WHERE NOT EXISTS (SELECT 1 FROM public.shop_item_photos ph WHERE ph.item_id = p_item_id AND ph.position = g.p)
   ORDER BY g.p
   LIMIT 1;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'An item has at most 12 photos.';
  END IF;
  BEGIN
    INSERT INTO public.shop_item_photos (item_id, owner_id, storage_path, position)
    VALUES (p_item_id, v_uid, p_storage_path, v_pos)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'shop_item_photos_storage_path_key' THEN
      RAISE EXCEPTION 'photo_already_attached' USING ERRCODE = '22023';
    END IF;
    RAISE;
  END;
  UPDATE public.shop_items SET updated_at = now() WHERE id = p_item_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_add_item_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_add_item_photo(uuid, text) TO authenticated, service_role;

-- Detach a photo from the caller's own DRAFT item. Returns its path so the
-- app removes the object.
CREATE OR REPLACE FUNCTION public.shops_remove_item_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item_id uuid;
  v_item public.shop_items%ROWTYPE;
  v_path text;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT item_id INTO v_item_id FROM public.shop_item_photos WHERE id = p_photo_id AND owner_id = v_uid;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_item := public.shops_lock_own_item(v_item_id, v_uid);
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.shop_item_photos WHERE id = p_photo_id AND owner_id = v_uid
  RETURNING storage_path INTO v_path;
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.shop_items SET updated_at = now() WHERE id = v_item_id;
  RETURN v_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_remove_item_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_remove_item_photo(uuid) TO authenticated, service_role;

-- The kind's confirmations for the item as it is now (L7, L9, L10, L13, L16):
-- exactly the required set, no more, no fewer. Returns when they were recorded.
CREATE OR REPLACE FUNCTION public.shops_attest_item(p_item_id uuid, p_statements text[])
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_need text[];
  v_at timestamptz := now();
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  v_need := public.shop_item_required_statements(v_item.kind, v_item.subtype);
  IF v_need IS NULL OR p_statements IS NULL
     OR EXISTS (SELECT 1 FROM unnest(p_statements) x WHERE x IS NULL)
     OR (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(p_statements) x)
        IS DISTINCT FROM (SELECT array_agg(DISTINCT y ORDER BY y) FROM unnest(v_need) y) THEN
    RAISE EXCEPTION 'attestation_incomplete' USING ERRCODE = '22023',
      HINT = 'Tick every statement for this kind of item.';
  END IF;
  INSERT INTO public.shop_item_attestations (item_id, owner_id, statements, attested_at)
  VALUES (p_item_id, v_uid, (SELECT array_agg(DISTINCT y ORDER BY y) FROM unnest(v_need) y), v_at)
  ON CONFLICT (item_id) DO UPDATE SET statements = EXCLUDED.statements, attested_at = EXCLUDED.attested_at;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_attest_item(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_attest_item(uuid, text[]) TO authenticated, service_role;

-- The baker confirms this year's home-food sales are under the limit (L8).
-- Returns the year confirmed.
CREATE OR REPLACE FUNCTION public.shops_confirm_cottage_year()
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_year smallint := public.shop_cottage_year();
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  IF NOT EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.shop_cottage_confirmations (owner_id, limit_year) VALUES (v_uid, v_year)
  ON CONFLICT (owner_id, limit_year) DO NOTHING;
  RETURN v_year;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_confirm_cottage_year() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_confirm_cottage_year() TO authenticated, service_role;

-- The caller's home-food limit this year (L8): the limit, the app's count,
-- the 80% warning, whether new home-food items are stopped, and whether the
-- yearly confirmation is in.
CREATE OR REPLACE FUNCTION public.shops_my_cottage_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_year smallint := public.shop_cottage_year();
  v_cap bigint;
  v_warn smallint;
  v_sales bigint;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT c.cap_cents, c.warn_percent INTO v_cap, v_warn FROM public.shop_cottage_settings c WHERE c.id;
  v_sales := public.shop_cottage_sales_cents(v_uid);
  RETURN jsonb_build_object(
    'year', v_year,
    'cap_cents', v_cap,
    'sales_cents', v_sales,
    'warn', v_cap IS NULL OR v_sales * 100 >= v_cap * v_warn,
    'reached', public.shop_cottage_cap_reached(v_uid),
    'confirmed', EXISTS (SELECT 1 FROM public.shop_cottage_confirmations c WHERE c.owner_id = v_uid AND c.limit_year = v_year));
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_cottage_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_cottage_status() TO authenticated, service_role;

-- Publish the caller's DRAFT item. 'pending_review' (an admin first: a shop's
-- first 3 items, an AI flag or no AI check, a word-check hit) or 'live'.
CREATE OR REPLACE FUNCTION public.shops_publish_item(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_shop public.shops%ROWTYPE;
  v_priv public.shop_item_private%ROWTYPE;
  v_photos integer;
  v_approved integer;
  v_text_flag text;
  v_status text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023';
  END IF;
  IF v_item.kind NOT IN ('made', 'home_food', 'farm') THEN
    RAISE EXCEPTION 'rental_not_available' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shop FROM public.shops WHERE id = v_item.shop_id;
  IF NOT v_shop.offers_selling THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '22023', HINT = 'Turn on selling for your shop first.';
  END IF;
  -- L21: buyers pick a ready date from the shop's open days.
  IF NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = v_shop.id) THEN
    RAISE EXCEPTION 'order_days_required' USING ERRCODE = '22023',
      HINT = 'Add the days your shop fills orders (opening hours) first.';
  END IF;

  SELECT count(*)::integer INTO v_photos FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_photos < 3 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required' USING ERRCODE = '22023', HINT = 'Add at least 3 photos (up to 12).';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM public.shop_item_attestations a
        WHERE a.item_id = p_item_id AND a.owner_id = v_uid
          AND a.statements = (SELECT array_agg(DISTINCT y ORDER BY y)
                                FROM unnest(public.shop_item_required_statements(v_item.kind, v_item.subtype)) y)) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  IF v_item.kind = 'home_food' THEN
    -- L8: the yearly confirmation, and not at the limit.
    IF NOT EXISTS (SELECT 1 FROM public.shop_cottage_confirmations c
                    WHERE c.owner_id = v_uid AND c.limit_year = public.shop_cottage_year()) THEN
      RAISE EXCEPTION 'cottage_confirmation_required' USING ERRCODE = '22023';
    END IF;
    IF public.shop_cottage_cap_reached(v_uid) THEN
      RAISE EXCEPTION 'cottage_cap_reached' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_priv FROM public.shop_item_private WHERE item_id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Every item is created with its private row (shops_create_item); a
    -- missing one is a bug, never a pass (lh-silent-failure review nit 11).
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title, v_item.description);

  -- L52: until 3 of the shop's items have an admin's OK, each waits; so does
  -- one the AI flagged or never checked, and one the word check flagged.
  SELECT count(*)::integer INTO v_approved
    FROM public.shop_items WHERE shop_id = v_item.shop_id AND admin_approved_at IS NOT NULL;
  v_status := CASE
    WHEN v_approved < 3 THEN 'pending_review'
    WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'
    WHEN v_priv.ai_checked_at IS NULL OR v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review'
    WHEN v_text_flag IS NOT NULL THEN 'pending_review'
    ELSE 'live'
  END;

  UPDATE public.shop_item_private
     SET text_flag_reason = v_text_flag, review_note = NULL, updated_at = now()
   WHERE item_id = p_item_id;
  UPDATE public.shop_items
     SET status = v_status,
         submitted_at = now(),
         live_at = CASE WHEN v_status = 'live' THEN now() END,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_publish_item(uuid) TO authenticated, service_role;

-- Take an item down (Declutter's withdraw). A draft is deleted outright; a
-- pending, live or rejected one becomes 'withdrawn'. Either way its photo
-- rows go and the paths come back so the app deletes the objects. Only
-- signed in and not banned: an under-18 or struck member may still take
-- their own item down; so may the owner of a hidden shop.
CREATE OR REPLACE FUNCTION public.shops_withdraw_item(p_item_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_item public.shop_items%ROWTYPE;
  v_paths text[];
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.shop_items WHERE id = p_item_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status = 'withdrawn' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(array_agg(storage_path ORDER BY position), ARRAY[]::text[]) INTO v_paths
    FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_item.status = 'draft' THEN
    DELETE FROM public.shop_items WHERE id = p_item_id;
  ELSE
    DELETE FROM public.shop_item_photos WHERE item_id = p_item_id;
    UPDATE public.shop_items SET status = 'withdrawn', live_at = NULL, updated_at = now() WHERE id = p_item_id;
  END IF;
  RETURN v_paths;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_withdraw_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_withdraw_item(uuid) TO authenticated, service_role;

-- A shop's items for its page. Visitors get the live ones of a shop they may
-- see; the owner gets every item that is not withdrawn, with its status.
-- home_kitchen = true marks the L7 notice the app shows on the item.
CREATE OR REPLACE FUNCTION public.shops_shop_items(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_mine boolean;
BEGIN
  PERFORM public.require_feature('shops');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.shop_visible_to(p_shop_id, v_uid) THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_mine := EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.owner_id = v_uid);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', i.id,
             'kind', i.kind,
             'subtype', i.subtype,
             'status', CASE WHEN v_mine THEN i.status ELSE 'live' END,
             'title', i.title,
             'description', i.description,
             'price_cents', i.price_cents,
             'lead_time_days', i.lead_time_days,
             'stock_count', i.stock_count,
             'home_kitchen', i.kind = 'home_food',
             'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ph.id, 'storage_path', ph.storage_path, 'position', ph.position)
                                          ORDER BY ph.position)
                                   FROM public.shop_item_photos ph WHERE ph.item_id = i.id), '[]'::jsonb))
           ORDER BY i.live_at DESC NULLS FIRST, i.created_at DESC, i.id)
      FROM public.shop_items i
     WHERE i.shop_id = p_shop_id
       AND (CASE WHEN v_mine THEN i.status <> 'withdrawn'
                 -- D12: a shop that turned selling off shows visitors no items.
                 ELSE i.status = 'live' AND EXISTS (SELECT 1 FROM public.shops s WHERE s.id = p_shop_id AND s.offers_selling) END)), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_shop_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_shop_items(uuid) TO authenticated, service_role;

-- The owner's own review state for one item: the admin's note on a rejected
-- item, and whether the AI or the word check flagged it (the reasons stay
-- with the admins). Anyone else gets item_not_found.
CREATE OR REPLACE FUNCTION public.shops_my_item_review(p_item_id uuid)
RETURNS TABLE(review_note text, ai_checked boolean, ai_flagged boolean, text_flagged boolean, attested boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('shops');
  RETURN QUERY
    SELECT p.review_note, (p.ai_checked_at IS NOT NULL), (p.ai_flag_reason IS NOT NULL), (p.text_flag_reason IS NOT NULL),
           EXISTS (SELECT 1 FROM public.shop_item_attestations a WHERE a.item_id = p.item_id)
      FROM public.shop_item_private p
     WHERE p.item_id = p_item_id
       AND p.owner_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_my_item_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_my_item_review(uuid) TO authenticated, service_role;

-- Record the AI verdict (L51), service role only: the declutter-ai-draft edge
-- function (target 'shop_item') calls it after judging. Lands only if the
-- photos and words judged are still exactly the item's, under the item row
-- lock that add_photo / update / publish also take (Declutter's rule).
CREATE OR REPLACE FUNCTION public.shops_record_item_ai_check(
  p_item_id uuid,
  p_owner_id uuid,
  p_judged_photo_ids uuid[],
  p_judged_kind text,
  p_judged_subtype text,
  p_judged_title text,
  p_judged_description text,
  p_flag_reason text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item public.shop_items%ROWTYPE;
  v_current uuid[];
  v_at timestamptz := now();
BEGIN
  SELECT * INTO v_item FROM public.shop_items
   WHERE id = p_item_id AND owner_id = p_owner_id AND status = 'draft' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_current
    FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_current IS DISTINCT FROM (SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[]) FROM unnest(p_judged_photo_ids) AS x)
     OR v_item.kind IS DISTINCT FROM p_judged_kind
     OR v_item.subtype IS DISTINCT FROM p_judged_subtype
     OR v_item.title IS DISTINCT FROM p_judged_title
     OR v_item.description IS DISTINCT FROM p_judged_description THEN
    RAISE EXCEPTION 'ai_check_stale' USING ERRCODE = '40001';
  END IF;
  UPDATE public.shop_item_private
     SET ai_checked_at = v_at,
         ai_flag_reason = NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), ''),
         updated_at = v_at
   WHERE item_id = p_item_id;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. Admin review (L52, L73's back end). Admins only, switch on, every
--     decision in admin_audit_log.
CREATE OR REPLACE FUNCTION public.shops_admin_pending_items()
RETURNS TABLE(
  item_id uuid, shop_id uuid, shop_name text, owner_id uuid, kind text, subtype text, title text,
  description text, price_cents integer, submitted_at timestamptz, ai_checked_at timestamptz,
  ai_flag_reason text, text_flag_reason text, approved_items integer, photo_paths text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('shops');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id, i.shop_id, s.name, i.owner_id, i.kind, i.subtype, i.title, i.description, i.price_cents,
           i.submitted_at, p.ai_checked_at, p.ai_flag_reason, p.text_flag_reason,
           (SELECT count(*)::integer FROM public.shop_items a
             WHERE a.shop_id = i.shop_id AND a.admin_approved_at IS NOT NULL),
           (SELECT COALESCE(array_agg(ph.storage_path ORDER BY ph.position), ARRAY[]::text[])
              FROM public.shop_item_photos ph WHERE ph.item_id = i.id)
      FROM public.shop_items i
      JOIN public.shops s ON s.id = i.shop_id
      LEFT JOIN public.shop_item_private p ON p.item_id = i.id
     WHERE i.status = 'pending_review'
     ORDER BY i.submitted_at NULLS LAST, i.id
     LIMIT 200;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_pending_items() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_pending_items() TO authenticated, service_role;

-- lh-authz-rls re-review N1: the decision names the submission the admin saw
-- (shops_admin_pending_items' submitted_at). An owner who edits a pending item
-- sends it back to draft, and publishing again stamps a new submitted_at, so a
-- decision on words or photos the admin never saw is refused (item_changed).
DROP FUNCTION IF EXISTS public.shops_admin_review_item(uuid, boolean, text);
CREATE OR REPLACE FUNCTION public.shops_admin_review_item(p_item_id uuid, p_approve boolean, p_note text, p_submitted_at timestamptz)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_owner uuid;
  v_shop uuid;
  v_kind text;
  v_submitted timestamptz;
  v_status text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'review_note_required' USING ERRCODE = '22023',
      HINT = 'Say why the item is not approved.';
  END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN
    RAISE EXCEPTION 'review_note_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT owner_id, shop_id, kind, submitted_at INTO v_owner, v_shop, v_kind, v_submitted
    FROM public.shop_items WHERE id = p_item_id AND status = 'pending_review' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  IF v_submitted IS DISTINCT FROM p_submitted_at THEN
    RAISE EXCEPTION 'item_changed' USING ERRCODE = '22023',
      HINT = 'The owner changed this item after you opened it. Reload and review it again.';
  END IF;
  -- An admin never reviews their own item.
  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '42501', HINT = 'Another admin must review your own item.';
  END IF;
  -- Approval puts the item in front of members NOW, so the owner must still
  -- be allowed to sell now (not banned, under 3 marketplace strikes, 18+,
  -- payouts set up), the shop must not be hidden, and a home-food item's
  -- owner must not be at the yearly limit.
  IF p_approve AND (
       public.shop_owner_sell_block_reason(v_owner) IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.shops s WHERE s.id = v_shop AND s.hidden_at IS NULL AND s.offers_selling)
       OR (v_kind = 'home_food' AND public.shop_cottage_cap_reached(v_owner))) THEN
    RAISE EXCEPTION 'owner_not_eligible' USING ERRCODE = '22023',
      HINT = 'The shop cannot sell right now (restricted, strikes, age, payouts, hidden or at the home-food limit). Reject it instead.';
  END IF;

  v_status := CASE WHEN p_approve THEN 'live' ELSE 'rejected' END;
  UPDATE public.shop_items
     SET status = v_status,
         admin_approved_at = CASE WHEN p_approve THEN now() ELSE admin_approved_at END,
         live_at = CASE WHEN p_approve THEN now() ELSE live_at END,
         updated_at = now()
   WHERE id = p_item_id AND status = 'pending_review';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_pending' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.shop_item_private
     SET review_note = v_note,
         admin_rejected_at = CASE WHEN p_approve THEN NULL ELSE now() END,
         updated_at = now()
   WHERE item_id = p_item_id;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, CASE WHEN p_approve THEN 'shop_item_approved' ELSE 'shop_item_rejected' END,
          'shop_item', p_item_id::text, jsonb_build_object('note', v_note));
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_admin_review_item(uuid, boolean, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_admin_review_item(uuid, boolean, text, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Close the caller's own shop: slice 1's body (20261017061155), plus the
--     item photo paths, so the app removes those objects too (the item rows
--     CASCADE with the shop; their objects would stay public by URL).
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
  -- Review finding 1 (slice 1): a shop an admin hid cannot be closed and
  -- reopened clean (that would undo L75). Account deletion still cascades it away.
  IF EXISTS (SELECT 1 FROM public.shops WHERE owner_id = v_uid AND hidden_at IS NOT NULL) THEN
    RAISE EXCEPTION 'shop_hidden' USING ERRCODE = '42501',
      HINT = 'Louisiana Helpr hid this shop. Contact support.';
  END IF;
  SELECT COALESCE(array_agg(p), '{}') INTO v_paths FROM (
    SELECT ph.storage_path AS p FROM public.shop_photos ph WHERE ph.owner_id = v_uid
    UNION ALL
    SELECT ip.storage_path FROM public.shop_item_photos ip WHERE ip.owner_id = v_uid) x;
  DELETE FROM public.shops WHERE owner_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_paths;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_close_my_shop() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_close_my_shop() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. Download My Data (closes the Shops export item in docs/OPEN.md). The
--     body is the NEWEST export_my_data,
--     20261017052706_export_my_data_helpr_delivery.sql, verbatim, with the
--     Shops sections added before RETURN (body-diffed 2026-10-17: 0 lines
--     removed, 27 added). Any later
--     restatement must start from THIS body. Grants restated as there:
--     EXECUTE for service_role only, revoked from PUBLIC, anon and
--     authenticated; the no-argument door stays dropped (Q408). Every table
--     it reads is created above or by an earlier migration (plpgsql resolves
--     names at call time).
DROP FUNCTION IF EXISTS public.export_my_data();

CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  -- Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  -- Refunds have no person column (they hang off an order, exported above);
  -- each section is scoped to the caller by its own column only.
  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));

  -- Declutter slice 4 (20261015042253): bookings (either side), the problems
  -- the member reported (the deciding admin's id dropped), the seller's payouts
  -- (the Stripe transfer id is ours), and reviews: those the member wrote, and
  -- those about them once visible (row 45: both sides reviewed or 14 days),
  -- without the reviewer's id.
  v_out := v_out || jsonb_build_object('declutter_bookings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bookings t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_problems', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id = v_uid));
  -- Problems the OTHER side of the member's order reported about them (RLS
  -- already lets both sides read a problem). Without the reporter's private
  -- fields: who reported it (reporter_id), the reporter's photo paths, and
  -- which admin decided (decided_by, never exported).
  v_out := v_out || jsonb_build_object('declutter_problems_about_me', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by' - 'reporter_id' - 'photo_paths'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id IS DISTINCT FROM v_uid
        AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
                     AND (o.buyer_id = v_uid OR o.seller_id = v_uid))));
  v_out := v_out || jsonb_build_object('declutter_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.declutter_payouts t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_reviews', (SELECT coalesce(jsonb_agg(CASE WHEN t.reviewer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'reviewer_id' END), '[]'::jsonb) FROM public.declutter_reviews t
      WHERE t.reviewer_id = v_uid
         OR (t.reviewee_id = v_uid AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
               AND (o.handed_over_at <= now() - interval '14 days'
                    OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = t.order_id) = 2)))));

  -- "Suggest a category" (20261015051141, I1): the caller's own suggestions.
  -- reviewed_by (the staff reviewer) and admin_note (staff-only) are stripped.
  v_out := v_out || jsonb_build_object('category_suggestions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reviewed_by' - 'admin_note'), '[]'::jsonb) FROM public.category_suggestions t
      WHERE t.user_id = v_uid));

  -- Declutter wanted posts (20261016053541). The match ledger holds no person
  -- column; a seller's alerts are in 'notifications' above.
  v_out := v_out || jsonb_build_object('declutter_wanted', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_wanted t
      WHERE t.user_id = v_uid));

  -- Slice 5, Helpr delivery (20261017052705): the Helpr's vehicle, the
  -- deliveries the member made as the Helpr (area words only: the buyer's and
  -- the seller's exact addresses, points and ids, the drop-off code and the
  -- staff close note belong to them or to us, not the Helpr),
  -- the steps they took on any delivery, their delivery pay (the Stripe transfer
  -- id is ours), and the drop-off addresses they typed as a buyer.
  v_out := v_out || jsonb_build_object('helpr_vehicles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_vehicles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_tasks', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'dropoff_code' - 'pickup_address' - 'pickup_lat' - 'pickup_lng'
      - 'dropoff_address' - 'dropoff_lat' - 'dropoff_lng' - 'customer_id' - 'pickup_contact_id' - 'close_note'), '[]'::jsonb) FROM public.helpr_tasks t
      WHERE t.helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helpr_task_events t
      WHERE t.actor_id = v_uid));
  v_out := v_out || jsonb_build_object('helpr_task_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.helpr_task_payouts t
      WHERE t.helpr_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_delivery_dropoffs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_delivery_dropoffs t
      WHERE t.buyer_id = v_uid));

  -- Shops slice 1 (20261017061155) and slice 2 (20261017061157): the
  -- member's own shop (who checked its registration and who hid it are staff
  -- ids, dropped; the hide reason is about them and stays), photo paths, the shops they follow, their items and item photos, the item
  -- review state (the AI and word-check reasons are staff-only, dropped; the
  -- admin's note stays), the confirmations they ticked, and the home-food
  -- yearly confirmations and counted sales. Opening hours (shop_hours) carry
  -- no person column and are public on the shop page, so they stay out, as
  -- every table without one does.
  v_out := v_out || jsonb_build_object('shops', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'sos_verified_by' - 'hidden_by'), '[]'::jsonb) FROM public.shops t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_follows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_follows t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_items t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason' - 'text_flag_reason'), '[]'::jsonb) FROM public.shop_item_private t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_photos t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_item_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_item_attestations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_confirmations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_confirmations t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('shop_cottage_sales', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.shop_cottage_sales t
      WHERE t.owner_id = v_uid));
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
