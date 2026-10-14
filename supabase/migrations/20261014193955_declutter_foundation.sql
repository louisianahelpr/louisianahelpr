-- DECLUTTER, SLICE 1: the backend foundation (owner, 2026-10-14: "ok can we
-- start building it out?"). Every product rule here is a row of the owner's
-- decision record, docs/specs/declutter-auctions.md (cited as "row N"); the
-- choices the spec did not make are under "Build decisions (agent)" there
-- (cited as "B<n>").
--
-- LAUNCH MODE (row 55): seller-accepts OFFERS + daily price drops. No bidding
-- logic exists here. declutter_items.sale_mode is 'offers' | 'auction' so
-- bidding (rows 8-11) can be added later without reshaping the table; every
-- RPC here creates and publishes 'offers' only ('sale_mode_unavailable').
--
-- HIDDEN: everything is behind the hidden switch 'declutter', created OFF
-- (20261012031120's recipe). Every RPC starts PERFORM
-- public.require_feature('declutter'), and the items read policy needs the
-- switch too, so a non-tester reads no listing and writes nothing even by REST.
--
-- PRIVACY (rows 8/56, 27): the seller's hidden floor price and exact pickup
-- address live in public.declutter_item_private, NOT in declutter_items. RLS
-- filters rows, never columns, so a column on the public row would be readable
-- by every buyer who can read the item. declutter_item_private has RLS on, NO
-- policy and NO client privilege at all: it is read only through
--   declutter_seller_item_private(item)  floor + address, the seller only;
--   declutter_item_address(item)         address only (never the floor), for
--                                        whoever declutter_address_access()
--                                        names: the seller today. THE HOOK:
--                                        slices 4/5 add the paid buyer and the
--                                        Helpr who accepted the delivery there,
--                                        and nowhere else.
-- Buyers see area_label + coarse coordinates (2 decimals, ~1 km) only.
--
-- GATES, server-side (the app's grey-outs are never the protection):
--   every write RPC   switch on (require_feature), signed in, not banned
--                     (is_caller_banned, the Q281 class), fewer than 3 active
--                     Declutter strikes (rows 16/17: ONE count for buyer and
--                     seller strikes, separate from job strikes, each expiring
--                     1 year after it was given).
--   selling           (every seller RPC, answering included) also: not under 18 (row 53, the same
--                     member_under_18() rule jobs use, 20261013010621).
--   publish           also: Stripe payout setup finished (row 23, the same
--                     helper_award_block_reason() gate Helprs pass), 3-12
--                     photos (row 31), the four tax confirmations stored for
--                     this listing (row 54), at least one pickup time (row 52);
--                     a seller with fewer than 3 admin-approved listings goes
--                     to 'pending_review', not 'live' (row 33).
--
-- Error codes: 42501 for refusals (feature_disabled, not_authenticated,
-- account_restricted, declutter_strikes_blocked, under_18,
-- payout_setup_incomplete), 22023 for bad input, P0002 for an item the caller
-- cannot act on (a stranger is never told "exists but not yours").
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT
-- DO NOTHING; grants restated by role name. Applied 3x in PGlite by
-- src/test/pglite/declutterFoundation.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 0. The hidden switch, OFF: nobody, not even testers, until an admin flips it
--    in Admin -> Settings (B1).
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter', 'off',
        'Declutter: sell and buy used household items (offers + daily price drops). '
        'Gates every declutter_* RPC and the Declutter item reads.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. Items: the PUBLIC fields of a listing only.
CREATE TABLE IF NOT EXISTS public.declutter_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Row 55: 'offers' at launch; 'auction' reserved for licensed bidding.
  sale_mode text NOT NULL DEFAULT 'offers' CHECK (sale_mode IN ('offers', 'auction')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',           -- being written; only the seller sees it
    'pending_review',  -- row 33: waits for an admin's OK
    'live',            -- for sale
    'reserved',        -- an offer/Buy was accepted, checkout running (row 59)
    'sold',            -- paid, handover pending
    'completed',       -- handed over
    'ended',           -- off sale without a sale (relists exhausted, row 47)
    'withdrawn',       -- the seller took it down
    'rejected',        -- an admin refused it at review
    'removed'          -- an admin took it down after it was live
  )),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  condition_stars smallint NOT NULL CHECK (condition_stars BETWEEN 1 AND 5),
  delivery_size text NOT NULL CHECK (delivery_size IN ('small', 'large', 'xl')),
  -- Row 56: the seller's price; current_price_cents is what it costs now
  -- (the 5% evening drops lower it, never below the private floor).
  price_cents integer NOT NULL CHECK (price_cents BETWEEN 100 AND 1000000),
  current_price_cents integer NOT NULL CHECK (current_price_cents BETWEEN 100 AND 1000000),
  -- Rows 5 / 27: area + miles only. Coarse coordinates (2 decimals, ~1 km).
  area_label text NOT NULL CHECK (char_length(btrim(area_label)) BETWEEN 2 AND 80),
  area_lat numeric(5,2) NOT NULL CHECK (area_lat BETWEEN -90 AND 90),
  area_lng numeric(6,2) NOT NULL CHECK (area_lng BETWEEN -180 AND 180),
  -- Row 47: relisted at most 3 times.
  relist_count smallint NOT NULL DEFAULT 0 CHECK (relist_count BETWEEN 0 AND 3),
  -- Row 33: set when an admin OKs the listing (admin queue: a later slice).
  admin_approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  live_at timestamptz,
  ends_at timestamptz,
  CONSTRAINT declutter_items_current_le_price CHECK (current_price_cents <= price_cents)
);
CREATE INDEX IF NOT EXISTS declutter_items_seller_idx ON public.declutter_items (seller_id);
CREATE INDEX IF NOT EXISTS declutter_items_live_area_idx ON public.declutter_items (area_lat, area_lng)
  WHERE status IN ('live', 'reserved');

ALTER TABLE public.declutter_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_items TO authenticated;
GRANT ALL ON TABLE public.declutter_items TO service_role;
DROP POLICY IF EXISTS "declutter items: seller or switched-on members read live" ON public.declutter_items;
CREATE POLICY "declutter items: seller or switched-on members read live" ON public.declutter_items
  FOR SELECT TO authenticated
  USING (
    seller_id = (SELECT auth.uid())
    OR (status IN ('live', 'reserved') AND (SELECT public.feature_enabled_for('declutter')))
  );
COMMENT ON TABLE public.declutter_items IS
  'Declutter listings, PUBLIC fields only (spec docs/specs/declutter-auctions.md). The hidden floor '
  'price and exact pickup address are in declutter_item_private. Written only by declutter_* RPCs.';

-- ---------------------------------------------------------------------------
-- 2. The seller-only half of a listing: hidden floor + exact address.
CREATE TABLE IF NOT EXISTS public.declutter_item_private (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  floor_price_cents integer NOT NULL CHECK (floor_price_cents BETWEEN 100 AND 1000000),
  pickup_address text NOT NULL CHECK (char_length(btrim(pickup_address)) BETWEEN 5 AND 300),
  pickup_lat numeric(9,6) NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng numeric(9,6) NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_item_private_seller_idx ON public.declutter_item_private (seller_id);
ALTER TABLE public.declutter_item_private ENABLE ROW LEVEL SECURITY;
-- No policy and no client privilege, on purpose: not even the seller reads
-- this table directly (declutter_seller_item_private does, for them).
REVOKE ALL ON TABLE public.declutter_item_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_item_private TO service_role;
COMMENT ON TABLE public.declutter_item_private IS
  'Declutter: the seller''s hidden floor price and exact pickup address. No client privilege; read only '
  'through declutter_seller_item_private (seller) and declutter_item_address (declutter_address_access).';

-- ---------------------------------------------------------------------------
-- 3. Photos (row 31: 3 to 12). Stored in the existing public job-photos
--    bucket under <seller uid>/declutter/<item id>/<file>, which its existing
--    owner-folder INSERT policy already allows (B4). The cap of 12 is
--    structural: position 0-11, unique per item.
CREATE TABLE IF NOT EXISTS public.declutter_item_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path ~ '^[0-9a-f-]{36}/declutter/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_item_photos_position_key UNIQUE (item_id, position)
);
CREATE INDEX IF NOT EXISTS declutter_item_photos_seller_idx ON public.declutter_item_photos (seller_id);
ALTER TABLE public.declutter_item_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_item_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_item_photos TO authenticated;
GRANT ALL ON TABLE public.declutter_item_photos TO service_role;
DROP POLICY IF EXISTS "declutter photos: readable with their item" ON public.declutter_item_photos;
CREATE POLICY "declutter photos: readable with their item" ON public.declutter_item_photos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = declutter_item_photos.item_id));

-- ---------------------------------------------------------------------------
-- 4. Seller pickup times (row 52): the seller's usual weekly times, Louisiana
--    local time (America/Chicago). Per seller, not per item (B6).
CREATE TABLE IF NOT EXISTS public.declutter_pickup_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  starts_local time NOT NULL,
  ends_local time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_pickup_windows_order CHECK (ends_local > starts_local),
  CONSTRAINT declutter_pickup_windows_key UNIQUE (seller_id, weekday, starts_local)
);
ALTER TABLE public.declutter_pickup_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_pickup_windows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_pickup_windows TO authenticated;
GRANT ALL ON TABLE public.declutter_pickup_windows TO service_role;
DROP POLICY IF EXISTS "declutter pickup windows: seller reads own" ON public.declutter_pickup_windows;
CREATE POLICY "declutter pickup windows: seller reads own" ON public.declutter_pickup_windows
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Watchlist (row 46).
CREATE TABLE IF NOT EXISTS public.declutter_watchlist (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS declutter_watchlist_item_idx ON public.declutter_watchlist (item_id);
ALTER TABLE public.declutter_watchlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_watchlist FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_watchlist TO authenticated;
GRANT ALL ON TABLE public.declutter_watchlist TO service_role;
DROP POLICY IF EXISTS "declutter watchlist: member reads own" ON public.declutter_watchlist;
CREATE POLICY "declutter watchlist: member reads own" ON public.declutter_watchlist
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. Public Q&A (row 35), through the contact-leak filter (trigger below).
CREATE TABLE IF NOT EXISTS public.declutter_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  asker_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(btrim(question)) BETWEEN 2 AND 500),
  answer text CHECK (answer IS NULL OR char_length(btrim(answer)) BETWEEN 1 AND 1000),
  answered_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_questions_item_idx ON public.declutter_questions (item_id);
CREATE INDEX IF NOT EXISTS declutter_questions_asker_idx ON public.declutter_questions (asker_id, created_at);
ALTER TABLE public.declutter_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_questions TO authenticated;
GRANT ALL ON TABLE public.declutter_questions TO service_role;
DROP POLICY IF EXISTS "declutter questions: readable with their item" ON public.declutter_questions;
CREATE POLICY "declutter questions: readable with their item" ON public.declutter_questions
  FOR SELECT TO authenticated
  USING (removed_at IS NULL AND EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = declutter_questions.item_id));

-- ---------------------------------------------------------------------------
-- 7. Tax confirmations per listing (row 54, the LDR RR 15-001 occasional-sale
--    test). A row exists only when all four were confirmed.
CREATE TABLE IF NOT EXISTS public.declutter_tax_attestations (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bought_for_personal_use boolean NOT NULL CHECK (bought_for_personal_use),
  not_in_the_business boolean NOT NULL CHECK (not_in_the_business),
  not_a_frequent_seller boolean NOT NULL CHECK (not_a_frequent_seller),
  keeps_item_until_handover boolean NOT NULL CHECK (keeps_item_until_handover),
  wording_version text NOT NULL DEFAULT '2026-10-14',
  attested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_tax_attestations_seller_idx ON public.declutter_tax_attestations (seller_id);
ALTER TABLE public.declutter_tax_attestations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_tax_attestations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_tax_attestations TO authenticated;
GRANT ALL ON TABLE public.declutter_tax_attestations TO service_role;
DROP POLICY IF EXISTS "declutter tax attestations: seller reads own" ON public.declutter_tax_attestations;
CREATE POLICY "declutter tax attestations: seller reads own" ON public.declutter_tax_attestations
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 8. Business-like seller flag (row 54 (2)): a seller who looks like a
--    business is taxed. Server/admin only; who sets it is a later slice.
CREATE TABLE IF NOT EXISTS public.declutter_seller_flags (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_like boolean NOT NULL DEFAULT false,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  set_at timestamptz NOT NULL DEFAULT now(),
  set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS declutter_seller_flags_set_by_idx ON public.declutter_seller_flags (set_by);
ALTER TABLE public.declutter_seller_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_seller_flags FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_seller_flags TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Declutter strikes (rows 7, 16, 17, 49): ONE count for buyer and seller
--    strikes, separate from job strikes (user_violations). Each expires 1 year
--    after it was given. Issuing comes with the slices that create the
--    offences; appeals (once per strike) with the admin queue.
CREATE TABLE IF NOT EXISTS public.declutter_strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offender_side text NOT NULL CHECK (offender_side IN ('buyer', 'seller')),
  reason text NOT NULL CHECK (reason IN (
    'missed_checkout',        -- rows 7, 13, 59
    'not_picked_up',          -- row 18
    'seller_no_show',         -- row 19
    'item_gone_after_sale',   -- row 19
    'cancelled_after_offers', -- row 19
    'not_as_described',       -- rows 15, 19
    'fake_offer'              -- row 48
  )),
  item_id uuid REFERENCES public.declutter_items(id) ON DELETE SET NULL,
  given_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  removed_at timestamptz,
  removed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Row 49: one appeal per strike, note + optional photo; an admin keeps or
  -- removes the strike.
  appeal_note text CHECK (appeal_note IS NULL OR char_length(appeal_note) <= 1000),
  appeal_photo_path text,
  appealed_at timestamptz,
  appeal_decision text CHECK (appeal_decision IS NULL OR appeal_decision IN ('kept', 'removed')),
  appeal_decided_at timestamptz,
  appeal_decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT declutter_strikes_expiry CHECK (expires_at > given_at)
);
CREATE INDEX IF NOT EXISTS declutter_strikes_user_idx ON public.declutter_strikes (user_id, expires_at);
CREATE INDEX IF NOT EXISTS declutter_strikes_item_idx ON public.declutter_strikes (item_id);
CREATE INDEX IF NOT EXISTS declutter_strikes_removed_by_idx ON public.declutter_strikes (removed_by);
CREATE INDEX IF NOT EXISTS declutter_strikes_decided_by_idx ON public.declutter_strikes (appeal_decided_by);
ALTER TABLE public.declutter_strikes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_strikes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_strikes TO authenticated;
GRANT ALL ON TABLE public.declutter_strikes TO service_role;
DROP POLICY IF EXISTS "declutter strikes: member reads own" ON public.declutter_strikes;
CREATE POLICY "declutter strikes: member reads own" ON public.declutter_strikes
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- expires_at is always given_at + 1 year (row 7), whoever writes the row.
CREATE OR REPLACE FUNCTION public.declutter_strike_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.expires_at := NEW.given_at + interval '1 year';
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_strike_expiry() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS declutter_strike_expiry ON public.declutter_strikes;
CREATE TRIGGER declutter_strike_expiry
  BEFORE INSERT OR UPDATE OF given_at, expires_at ON public.declutter_strikes
  FOR EACH ROW EXECUTE FUNCTION public.declutter_strike_expiry();

-- Q807: every public table carries the unconfirmed-email statement gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 10. Contact-leak filter (row 35; the jobs/bios rule, 20260913020635):
--     rejected, never hidden. A trigger, so it covers every path that writes
--     these columns.
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_declutter()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text;
  v_where text;
BEGIN
  IF TG_TABLE_NAME = 'declutter_items' THEN
    IF TG_OP = 'INSERT' OR NEW.title IS DISTINCT FROM OLD.title THEN
      v_reason := public.contact_leak_reason(NEW.title); v_where := 'title';
    END IF;
    IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.description IS DISTINCT FROM OLD.description) THEN
      v_reason := public.contact_leak_reason(NEW.description); v_where := 'description';
    END IF;
    IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.area_label IS DISTINCT FROM OLD.area_label) THEN
      v_reason := public.contact_leak_reason(NEW.area_label); v_where := 'area';
    END IF;
  ELSIF TG_TABLE_NAME = 'declutter_questions' THEN
    IF TG_OP = 'INSERT' OR NEW.question IS DISTINCT FROM OLD.question THEN
      v_reason := public.contact_leak_reason(NEW.question); v_where := 'question';
    END IF;
    IF v_reason IS NULL AND (TG_OP = 'INSERT' OR NEW.answer IS DISTINCT FROM OLD.answer) THEN
      v_reason := public.contact_leak_reason(NEW.answer); v_where := 'answer';
    END IF;
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the ' || v_where || '. Keep contact details and payment off the listing; questions, payment and pickup happen in the app.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_declutter() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_declutter_item ON public.declutter_items;
CREATE TRIGGER trg_reject_contact_leak_in_declutter_item
  BEFORE INSERT OR UPDATE OF title, description, area_label ON public.declutter_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_declutter();
DROP TRIGGER IF EXISTS trg_reject_contact_leak_in_declutter_question ON public.declutter_questions;
CREATE TRIGGER trg_reject_contact_leak_in_declutter_question
  BEFORE INSERT OR UPDATE OF question, answer ON public.declutter_questions
  FOR EACH ROW EXECUTE FUNCTION public.reject_contact_leak_in_declutter();

-- ---------------------------------------------------------------------------
-- 11. Internal helpers (no client EXECUTE).

-- Active Declutter strikes (rows 16/17). A NULL user matches no row -> 0;
-- every caller refuses a NULL caller before asking.
CREATE OR REPLACE FUNCTION public.declutter_active_strike_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::integer
    FROM public.declutter_strikes s
   WHERE s.user_id = p_user_id
     AND s.removed_at IS NULL
     AND s.expires_at > now();
$fn$;
REVOKE ALL ON FUNCTION public.declutter_active_strike_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_active_strike_count(uuid) TO service_role;

-- THE address hook (row 27). Returns WHY p_user_id may see the item's exact
-- address, or NULL (no access; also for any NULL argument). Today: the
-- seller. Slices 4/5 add 'paid_buyer' and 'delivery_helpr' here, only here.
CREATE OR REPLACE FUNCTION public.declutter_address_access(p_item_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN i.seller_id = p_user_id THEN 'seller' END
    FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND p_user_id IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_address_access(uuid, uuid) TO service_role;

-- The member gates every Declutter write runs (after require_feature).
-- Returns the caller. p_selling (anything but false) adds the under-18 rule
-- (row 53).
CREATE OR REPLACE FUNCTION public.declutter_assert_member(p_selling boolean)
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
  IF public.declutter_active_strike_count(v_uid) >= 3 THEN
    RAISE EXCEPTION 'declutter_strikes_blocked'
      USING ERRCODE = '42501', HINT = 'You have 3 Declutter strikes. Declutter opens again when one expires.';
  END IF;
  IF p_selling IS NOT FALSE AND public.member_under_18(v_uid) THEN
    RAISE EXCEPTION 'under_18'
      USING ERRCODE = '42501', HINT = 'You must be 18 or older to sell on Declutter.';
  END IF;
  RETURN v_uid;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_assert_member(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_assert_member(boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 12. Client RPCs. Each VOLATILE one names is_caller_banned() in its own body
--     (the Q281 class check, scripts/ci/ban-gate-coverage.sql, reads the
--     RPC's own body).

-- Create a DRAFT listing ('offers' only, row 55) with its private half.
CREATE OR REPLACE FUNCTION public.declutter_create_item(
  p_title text,
  p_description text,
  p_category text,
  p_condition_stars integer,
  p_delivery_size text,
  p_price_cents integer,
  p_floor_price_cents integer,
  p_area_label text,
  p_pickup_address text,
  p_pickup_lat numeric,
  p_pickup_lng numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  IF p_price_cents IS NULL OR p_floor_price_cents IS NULL
     OR p_floor_price_cents < 100 OR p_floor_price_cents > p_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price'
      USING ERRCODE = '22023', HINT = 'The lowest price must be at least $1 and no more than the price.';
  END IF;
  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL THEN
    RAISE EXCEPTION 'invalid_location' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.declutter_items (
    seller_id, sale_mode, status, title, description, category, condition_stars,
    delivery_size, price_cents, current_price_cents, area_label, area_lat, area_lng)
  VALUES (
    v_uid, 'offers', 'draft', btrim(p_title), COALESCE(btrim(p_description), ''), p_category,
    p_condition_stars, p_delivery_size, p_price_cents, p_price_cents, btrim(p_area_label),
    round(p_pickup_lat, 2), round(p_pickup_lng, 2))
  RETURNING id INTO v_id;

  INSERT INTO public.declutter_item_private (item_id, seller_id, floor_price_cents, pickup_address, pickup_lat, pickup_lng)
  VALUES (v_id, v_uid, p_floor_price_cents, btrim(p_pickup_address), p_pickup_lat, p_pickup_lng);

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_create_item(text, text, text, integer, text, integer, integer, text, text, numeric, numeric) TO authenticated, service_role;

-- Attach an uploaded photo to the seller's own draft (row 31).
CREATE OR REPLACE FUNCTION public.declutter_add_item_photo(p_item_id uuid, p_storage_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_pos smallint;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_editable' USING ERRCODE = '22023';
  END IF;
  -- The path is the caller's own folder for THIS item, and the object is
  -- really there, uploaded by the caller.
  IF p_storage_path IS NULL
     OR split_part(p_storage_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_storage_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_storage_path, '/', 3) IS DISTINCT FROM p_item_id::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'job-photos'
          AND o.name = p_storage_path
          AND (o.owner_id = v_uid::text OR o.owner = v_uid)
          -- Images only: job-photos also takes video, and a video keeps its
          -- GPS atoms (the app's re-encode strips images only).
          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
          AND COALESCE((o.metadata ->> 'size')::bigint, 0) BETWEEN 1 AND 15728640) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;

  SELECT g.p INTO v_pos
    FROM generate_series(0, 11) AS g(p)
   WHERE NOT EXISTS (SELECT 1 FROM public.declutter_item_photos ph WHERE ph.item_id = p_item_id AND ph.position = g.p)
   ORDER BY g.p
   LIMIT 1;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023', HINT = 'A listing has at most 12 photos.';
  END IF;

  INSERT INTO public.declutter_item_photos (item_id, seller_id, storage_path, position)
  VALUES (p_item_id, v_uid, p_storage_path, v_pos)
  RETURNING id INTO v_id;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = p_item_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_add_item_photo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_add_item_photo(uuid, text) TO authenticated, service_role;

-- Detach a photo from the seller's own draft. Returns the storage path so the
-- app removes the object (B5).
CREATE OR REPLACE FUNCTION public.declutter_remove_item_photo(p_photo_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_path text;
  v_item uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT ph.storage_path, ph.item_id INTO v_path, v_item
    FROM public.declutter_item_photos ph
    JOIN public.declutter_items i ON i.id = ph.item_id
   WHERE ph.id = p_photo_id AND i.seller_id = v_uid AND i.status = 'draft'
   FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'photo_not_found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.declutter_item_photos WHERE id = p_photo_id;
  UPDATE public.declutter_items SET updated_at = now() WHERE id = v_item;
  RETURN v_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_remove_item_photo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_remove_item_photo(uuid) TO authenticated, service_role;

-- The four tax confirmations for one listing (row 54). All four or nothing.
CREATE OR REPLACE FUNCTION public.declutter_attest_item(
  p_item_id uuid,
  p_bought_for_personal_use boolean,
  p_not_in_the_business boolean,
  p_not_a_frequent_seller boolean,
  p_keeps_item_until_handover boolean
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_at timestamptz;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  IF NOT EXISTS (SELECT 1 FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid AND status = 'draft') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_bought_for_personal_use IS NOT TRUE OR p_not_in_the_business IS NOT TRUE
     OR p_not_a_frequent_seller IS NOT TRUE OR p_keeps_item_until_handover IS NOT TRUE THEN
    RAISE EXCEPTION 'attestation_incomplete'
      USING ERRCODE = '22023', HINT = 'Confirm all four statements to list this item.';
  END IF;

  INSERT INTO public.declutter_tax_attestations (
    item_id, seller_id, bought_for_personal_use, not_in_the_business, not_a_frequent_seller, keeps_item_until_handover)
  VALUES (p_item_id, v_uid, true, true, true, true)
  ON CONFLICT (item_id) DO UPDATE SET attested_at = now(), wording_version = EXCLUDED.wording_version
  RETURNING attested_at INTO v_at;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_attest_item(uuid, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_attest_item(uuid, boolean, boolean, boolean, boolean) TO authenticated, service_role;

-- Replace the seller's usual pickup times (row 52). p_windows is a JSON array
-- of {"weekday": 0-6, "starts": "HH:MM", "ends": "HH:MM"}; 1 to 21 of them.
CREATE OR REPLACE FUNCTION public.declutter_set_pickup_windows(p_windows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  IF p_windows IS NULL OR jsonb_typeof(p_windows) <> 'array'
     OR jsonb_array_length(p_windows) < 1 OR jsonb_array_length(p_windows) > 21 THEN
    RAISE EXCEPTION 'invalid_pickup_windows'
      USING ERRCODE = '22023', HINT = 'Give between 1 and 21 pickup times.';
  END IF;

  DELETE FROM public.declutter_pickup_windows WHERE seller_id = v_uid;
  BEGIN
    INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
    SELECT v_uid, (w ->> 'weekday')::smallint, (w ->> 'starts')::time, (w ->> 'ends')::time
      FROM jsonb_array_elements(p_windows) AS w;
  EXCEPTION WHEN check_violation OR not_null_violation OR unique_violation
              OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_pickup_windows'
      USING ERRCODE = '22023', HINT = 'Each pickup time needs a day and a start before its end, with no repeats.';
  END;
  RETURN (SELECT count(*)::integer FROM public.declutter_pickup_windows WHERE seller_id = v_uid);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_pickup_windows(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_pickup_windows(jsonb) TO authenticated, service_role;

-- Publish a draft: every gate, then 'pending_review' (row 33) or 'live'.
CREATE OR REPLACE FUNCTION public.declutter_publish_item(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.declutter_items%ROWTYPE;
  v_floor integer;
  v_photos integer;
  v_payout text;
  v_approved integer;
  v_status text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  SELECT * INTO v_item FROM public.declutter_items WHERE id = p_item_id AND seller_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.status <> 'draft' THEN
    RAISE EXCEPTION 'item_not_a_draft' USING ERRCODE = '22023';
  END IF;
  IF v_item.sale_mode <> 'offers' THEN
    -- Row 55: bidding waits for the auctioneer licence.
    RAISE EXCEPTION 'sale_mode_unavailable' USING ERRCODE = '22023';
  END IF;

  -- Row 23: payout setup before the first listing, the Helprs' gate.
  v_payout := public.helper_award_block_reason(v_uid);
  IF v_payout IS NOT NULL THEN
    RAISE EXCEPTION 'payout_setup_incomplete'
      USING ERRCODE = '42501', HINT = 'Finish your payout setup before you list an item.';
  END IF;

  SELECT count(*)::integer INTO v_photos FROM public.declutter_item_photos WHERE item_id = p_item_id;
  IF v_photos < 3 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required'
      USING ERRCODE = '22023', HINT = 'Add at least 3 photos (up to 12).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_tax_attestations a WHERE a.item_id = p_item_id AND a.seller_id = v_uid) THEN
    RAISE EXCEPTION 'attestation_required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.declutter_pickup_windows w WHERE w.seller_id = v_uid) THEN
    RAISE EXCEPTION 'pickup_windows_required' USING ERRCODE = '22023';
  END IF;

  SELECT floor_price_cents INTO v_floor FROM public.declutter_item_private WHERE item_id = p_item_id;
  IF v_floor IS NULL OR v_floor > v_item.current_price_cents THEN
    RAISE EXCEPTION 'invalid_floor_price' USING ERRCODE = '22023';
  END IF;

  -- Row 33: until 3 of the seller's listings have an admin's OK, each waits.
  SELECT count(*)::integer INTO v_approved
    FROM public.declutter_items
   WHERE seller_id = v_uid AND admin_approved_at IS NOT NULL;
  v_status := CASE WHEN v_approved < 3 THEN 'pending_review' ELSE 'live' END;

  UPDATE public.declutter_items
     SET status = v_status,
         submitted_at = now(),
         live_at = CASE WHEN v_status = 'live' THEN now() END,
         updated_at = now()
   WHERE id = p_item_id;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_publish_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_publish_item(uuid) TO authenticated, service_role;

-- Watch / unwatch (row 46). Returns 'watching' or 'not_watching'.
CREATE OR REPLACE FUNCTION public.declutter_set_watch(p_item_id uuid, p_watch boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_seller uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(false);
  v_uid := (SELECT auth.uid());

  IF p_watch IS NOT TRUE THEN
    DELETE FROM public.declutter_watchlist WHERE user_id = v_uid AND item_id = p_item_id;
    RETURN 'not_watching';
  END IF;
  SELECT seller_id INTO v_seller FROM public.declutter_items
   WHERE id = p_item_id AND status IN ('live', 'reserved');
  -- A member the seller blocked (or who blocked the seller) does not see
  -- the item to act on it.
  IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_watchlist (user_id, item_id) VALUES (v_uid, p_item_id)
  ON CONFLICT (user_id, item_id) DO NOTHING;
  RETURN 'watching';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_watch(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_watch(uuid, boolean) TO authenticated, service_role;

-- Ask a public question on a live item (row 35). At most 20 a day per asker.
CREATE OR REPLACE FUNCTION public.declutter_ask_question(p_item_id uuid, p_question text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_seller uuid;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(false);
  v_uid := (SELECT auth.uid());

  SELECT seller_id INTO v_seller FROM public.declutter_items
   WHERE id = p_item_id AND status IN ('live', 'reserved');
  -- A member the seller blocked (or who blocked the seller) does not see
  -- the item to act on it.
  IF NOT FOUND OR public.are_users_blocked(v_seller, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_seller = v_uid THEN
    RAISE EXCEPTION 'own_item' USING ERRCODE = '22023';
  END IF;
  -- One asker at a time, so parallel calls cannot all pass the cap.
  PERFORM pg_advisory_xact_lock(hashtext('declutter_ask:' || v_uid::text));
  IF (SELECT count(*) FROM public.declutter_questions q
       WHERE q.asker_id = v_uid AND q.created_at > now() - interval '1 day') >= 20 THEN
    RAISE EXCEPTION 'question_rate_limited' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.declutter_questions (item_id, asker_id, question)
  VALUES (p_item_id, v_uid, btrim(p_question))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ask_question(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_question(uuid, text) TO authenticated, service_role;

-- The seller answers a question on their own item.
CREATE OR REPLACE FUNCTION public.declutter_answer_question(p_question_id uuid, p_answer text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_at timestamptz;
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.declutter_assert_member(true);
  v_uid := (SELECT auth.uid());

  UPDATE public.declutter_questions q
     SET answer = btrim(p_answer), answered_at = now()
    FROM public.declutter_items i
   WHERE q.id = p_question_id
     AND i.id = q.item_id
     AND i.seller_id = v_uid
     AND q.removed_at IS NULL
  RETURNING q.answered_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'question_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_answer_question(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_question(uuid, text) TO authenticated, service_role;

-- The seller's private half of their own item: floor + exact address.
-- Anyone else gets 'item_not_found' (never told the item exists).
CREATE OR REPLACE FUNCTION public.declutter_seller_item_private(p_item_id uuid)
RETURNS TABLE(floor_price_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  RETURN QUERY
    SELECT p.floor_price_cents, p.pickup_address, p.pickup_lat, p.pickup_lng
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id
       AND p.seller_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_item_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_item_private(uuid) TO authenticated, service_role;

-- The exact pickup address (never the floor) for whoever
-- declutter_address_access() names. Anyone else: 'item_not_found'.
CREATE OR REPLACE FUNCTION public.declutter_item_address(p_item_id uuid)
RETURNS TABLE(pickup_address text, pickup_lat numeric, pickup_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.require_feature('declutter');
  IF public.declutter_address_access(p_item_id, (SELECT auth.uid())) IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT p.pickup_address, p.pickup_lat, p.pickup_lng
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_address(uuid) TO authenticated, service_role;
