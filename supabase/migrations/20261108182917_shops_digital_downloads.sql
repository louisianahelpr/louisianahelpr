-- Shops DIGITAL DOWNLOADS, slice 1: the item kind, its private files and who may download them (owner 11-08: the
-- owner sells their own coloring books as PDFs; "Digital download" is a Shops item kind, not Declutter).
--
-- 1. A new kind 'digital' with its own types. Its tax answer rides on the type (shop_item_subtypes.tax_kind) and is
--    snapshotted onto the order line like a service's (the trigger restated from its NEWEST body, 20261106205852,
--    keeping the custom-request fallback and the at-buyer flag; money review 11-08): 'digital_book'
--    (Stripe txcd_10302000 "Digital Books - downloaded - non subscription - with permanent rights") or 'digital_art'
--    (txcd_10505001 "Digital Finished Artwork - downloaded - ... - with permanent rights"); both codes read on
--    docs.stripe.com/tax/tax-codes 2026-11-08 and spelled only in _shared/salesTax.ts. Louisiana taxes digital
--    products from 2025-01-01 (Acts 2024, 3rd Ex. Sess., No. 10 (HB 8); "digital product" defined in
--    La. R.S. 47:301, cited by LDR's Digital Products Guidance (rev. 11-20-2025) as 47:301(31)-(32)).
-- 2. shop_item_files: 1 to 5 files per digital item (PDF, ZIP, PNG or JPG, at most 100 MB each). The row is written
--    by shops_digital_file_begin (the seller, through shop-digital, which then hands a one-time signed upload link)
--    and marked checked by shop_digital_file_checked (service role only: shop-digital read the file's first bytes
--    and they match its extension; executables never do). The seller reads their own rows; the storage path is
--    never granted to members.
-- 3. A PRIVATE storage bucket 'shop-digital' with NO storage.objects policy for it: every prod storage.objects policy
--    that names no bucket is RESTRICTIVE (read 2026-11-08: the unconfirmed-email and ban gates), so no member can
--    read, list, write or delete in it. Only the service role (shop-digital) signs upload and download links.
-- 4. shop_digital_download_path(file, user): service role only. The seller of the item, or a buyer of a download
--    order for it from the charge on (accepted + captured, then handed_over), through shop_digital_access_ok: a
--    refund in the app, a refund made in Stripe by hand (shop_hand_refunds) or a chargeback
--    (shop_orders.digital_access_revoked_at, set by slice 2's dispute hook) ends it (money review 11-08). Access never
--    expires otherwise while the account exists. shop_orders.is_digital (added here) marks a download order.
-- 5. Restated with only the digital lines changed: shops_check_item_fields (no stock, no lead time),
--    shop_item_required_statements (rights + file matches), shop_item_text_flag (a file is never "used", a
--    children's product, a skin product, a plant or a live animal: a kids' coloring book is fine) and
--    shops_publish_item (no order days needed; 1-5 checked files, none waiting).
-- Not in this slice (handoff ~/.lh-shots/handoffs-1108/builder4-digital.md): web checkout + the iPhone link-out,
-- the paid -> complete step, the 72-hour payout, refund revoking access, emails, Download My Data.
-- Shops stays behind its switch (require_feature('shops'), audience testers).
-- Replay-safe: IF NOT EXISTS, DROP CONSTRAINT IF EXISTS + ADD, ON CONFLICT, CREATE OR REPLACE, DROP POLICY IF EXISTS.
-- AUTHZ: new table + bucket + 3 functions (lh-authz-rls). MONEY: none yet (tax code mapping only).
-- Proof: src/test/pglite/shopsDigitalDownloads.pglite.mjs.

-- 1. The kind and its types.
ALTER TABLE public.shop_item_subtypes DROP CONSTRAINT IF EXISTS shop_item_subtypes_kind_check;
ALTER TABLE public.shop_item_subtypes ADD CONSTRAINT shop_item_subtypes_kind_check
  CHECK (kind IN ('made', 'home_food', 'farm', 'service', 'rental', 'digital'));
ALTER TABLE public.shop_item_subtypes DROP CONSTRAINT IF EXISTS shop_item_subtypes_tax_kind_valid;
ALTER TABLE public.shop_item_subtypes ADD CONSTRAINT shop_item_subtypes_tax_kind_valid
  CHECK (tax_kind IS NULL
         OR (kind = 'service' AND tax_kind IN ('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations'))
         OR (kind = 'digital' AND tax_kind IN ('digital_book', 'digital_art')));
-- Every digital type names its tax answer (a digital line is never taxed at a guessed rate).
ALTER TABLE public.shop_item_subtypes DROP CONSTRAINT IF EXISTS shop_item_subtypes_digital_has_tax_kind;
ALTER TABLE public.shop_item_subtypes ADD CONSTRAINT shop_item_subtypes_digital_has_tax_kind
  CHECK (kind <> 'digital' OR tax_kind IS NOT NULL);

ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_kind_check;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_kind_check
  CHECK (kind IN ('made', 'home_food', 'farm', 'service', 'rental', 'digital'));
-- A download never runs out.
ALTER TABLE public.shop_items DROP CONSTRAINT IF EXISTS shop_items_digital_no_stock;
ALTER TABLE public.shop_items ADD CONSTRAINT shop_items_digital_no_stock
  CHECK (kind <> 'digital' OR (stock_count IS NULL AND lead_time_days = 0));

ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_kind_check;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_kind_check
  CHECK (kind IN ('made', 'home_food', 'farm', 'service', 'rental', 'digital'));
ALTER TABLE public.shop_order_lines DROP CONSTRAINT IF EXISTS shop_order_lines_tax_kind_valid;
ALTER TABLE public.shop_order_lines ADD CONSTRAINT shop_order_lines_tax_kind_valid
  CHECK (tax_kind IS NULL
         OR (kind = 'service' AND tax_kind IN ('item_repair', 'fabric_cleaning', 'clothes_cleaning', 'clothing_alterations'))
         OR (kind = 'digital' AND tax_kind IN ('digital_book', 'digital_art')));

INSERT INTO public.shop_item_subtypes (slug, kind, label, position, tax_kind) VALUES
  ('digital_coloring', 'digital', 'Coloring books and pages', 600, 'digital_book'),
  ('digital_book', 'digital', 'E-books and guides', 601, 'digital_book'),
  ('digital_printable', 'digital', 'Printables and planners', 602, 'digital_book'),
  ('digital_pattern', 'digital', 'Patterns and templates', 603, 'digital_book'),
  ('digital_art', 'digital', 'Digital art and prints', 604, 'digital_art')
ON CONFLICT (slug) DO NOTHING;

-- Restated from shop_order_line_snapshot_tax_kind's NEWEST body (20261106205852_shops_custom_order_accept.sql: the
-- custom-request service fallback and the at-buyer cleaning flag kept); only the kind line changes.
CREATE OR REPLACE FUNCTION public.shop_order_line_snapshot_tax_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- CHANGED (digital): a download line keeps its type's answer too (the custom-request fallback finds none for it).
  NEW.tax_kind := CASE WHEN NEW.kind IN ('service', 'digital') THEN
    COALESCE(
      (SELECT st.tax_kind FROM public.shop_items i JOIN public.shop_item_subtypes st ON st.slug = i.subtype
        WHERE i.id = NEW.item_id),
      (SELECT st.tax_kind FROM public.shop_custom_requests cr JOIN public.shop_item_subtypes st ON st.slug = cr.subtype
        WHERE NEW.item_id IS NULL AND cr.id = NEW.custom_request_id)) END;
  -- H8 (b), kept from 20261106164313: done at the buyer's place, only for carpet or furniture cleaning. A custom
  -- line has no item, so it is never at the buyer's place.
  NEW.at_buyer := COALESCE(NEW.tax_kind = 'fabric_cleaning' AND
    (SELECT i.at_buyer FROM public.shop_items i WHERE i.id = NEW.item_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_order_line_snapshot_tax_kind() FROM PUBLIC, anon, authenticated;

-- 2. The files.
CREATE TABLE IF NOT EXISTS public.shop_item_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.shop_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- <owner uid>/<item id>/<file id>.<ext>: nothing the seller typed is in the path.
  storage_path text NOT NULL UNIQUE
    CHECK (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|zip|png|jpg)$'),
  -- The name the buyer's download is saved as (the seller's own file name, cleaned by shop-digital).
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 120 AND file_name !~ '[/\\[:cntrl:]]'),
  ext text NOT NULL CHECK (ext IN ('pdf', 'zip', 'png', 'jpg')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 104857600),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 4),
  -- Set once shop-digital read the uploaded object's first bytes and they matched ext (and a ZIP held no program).
  checked_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_item_files_path_is_owner_item CHECK (
    split_part(storage_path, '/', 1) = owner_id::text AND split_part(storage_path, '/', 2) = item_id::text),
  CONSTRAINT shop_item_files_ext_matches_path CHECK (storage_path LIKE '%.' || ext),
  UNIQUE (item_id, position)
);
CREATE INDEX IF NOT EXISTS shop_item_files_item_idx ON public.shop_item_files (item_id);
CREATE INDEX IF NOT EXISTS shop_item_files_owner_idx ON public.shop_item_files (owner_id);
ALTER TABLE public.shop_item_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_item_files FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, item_id, owner_id, file_name, ext, byte_size, position, checked_at, created_at)
  ON TABLE public.shop_item_files TO authenticated;
GRANT ALL ON TABLE public.shop_item_files TO service_role;
DROP POLICY IF EXISTS "shop item files: the seller reads their own" ON public.shop_item_files;
CREATE POLICY "shop item files: the seller reads their own" ON public.shop_item_files
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

-- Q807: an unconfirmed email cannot write the new table either (the same guarded call as 20261106202917).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;

-- A file only on a digital item, and only on the item's owner; seed like its item.
CREATE OR REPLACE FUNCTION public.shop_item_files_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_item public.shop_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item FROM public.shop_items WHERE id = NEW.item_id;
  IF NOT FOUND OR v_item.kind <> 'digital' OR v_item.owner_id IS DISTINCT FROM NEW.owner_id THEN
    RAISE EXCEPTION 'item_not_digital' USING ERRCODE = '22023';
  END IF;
  NEW.is_seed := v_item.is_seed;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_files_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_item_files_guard ON public.shop_item_files;
CREATE TRIGGER trg_shop_item_files_guard BEFORE INSERT OR UPDATE OF item_id, owner_id ON public.shop_item_files
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_files_guard();

-- 3. The private bucket. 100 MB a file; the allowed types are what the browser declares (shop-digital checks the
--    bytes themselves; a declared type alone is never trusted).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shop-digital', 'shop-digital', false, 104857600,
        ARRAY['application/pdf', 'application/zip', 'application/x-zip-compressed', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2b. The seller starts an upload: a file row waiting for its check. Called by shop-digital with the member's own
--     token (auth.uid()), so the owner check is the database's. Returns the id and the path to sign.
CREATE OR REPLACE FUNCTION public.shops_digital_file_begin(p_item_id uuid, p_file_name text, p_ext text, p_byte_size bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_item public.shop_items%ROWTYPE;
  v_pos smallint;
  v_id uuid := gen_random_uuid();
  v_name text := btrim(regexp_replace(COALESCE(p_file_name, ''), '[/\\[:cntrl:]]', '', 'g'));
  v_path text;
BEGIN
  PERFORM public.require_feature('shops');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.shops_assert_owner_eligible();
  v_item := public.shops_lock_own_item(p_item_id, v_uid);
  IF v_item.kind <> 'digital' THEN
    RAISE EXCEPTION 'item_not_digital' USING ERRCODE = '22023';
  END IF;
  IF p_ext IS NULL OR p_ext NOT IN ('pdf', 'zip', 'png', 'jpg') THEN
    RAISE EXCEPTION 'file_type_not_allowed' USING ERRCODE = '22023', HINT = 'Upload a PDF, ZIP, PNG or JPG file.';
  END IF;
  IF p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 104857600 THEN
    RAISE EXCEPTION 'file_too_big' USING ERRCODE = '22023', HINT = 'Each file can be up to 100 MB.';
  END IF;
  IF char_length(v_name) = 0 THEN
    v_name := 'download.' || p_ext;
  END IF;
  v_name := left(v_name, 120);
  -- At most 5 files an item, waiting ones included.
  SELECT min(g)::smallint INTO v_pos FROM generate_series(0, 4) g
   WHERE NOT EXISTS (SELECT 1 FROM public.shop_item_files f WHERE f.item_id = p_item_id AND f.position = g);
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'too_many_files' USING ERRCODE = '22023', HINT = 'An item can have up to 5 files.';
  END IF;
  v_path := v_uid::text || '/' || p_item_id::text || '/' || v_id::text || '.' || p_ext;
  INSERT INTO public.shop_item_files (id, item_id, owner_id, storage_path, file_name, ext, byte_size, position)
  VALUES (v_id, p_item_id, v_uid, v_path, v_name, p_ext, p_byte_size, v_pos);
  RETURN jsonb_build_object('file_id', v_id, 'storage_path', v_path, 'position', v_pos);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_digital_file_begin(uuid, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shops_digital_file_begin(uuid, text, text, bigint) TO authenticated, service_role;

-- 2c. shop-digital checked the upload: the real size it read from storage is recorded and the file is usable.
--     Service role only. p_owner is the caller shop-digital read from the token, never from the request body.
CREATE OR REPLACE FUNCTION public.shop_digital_file_checked(p_file_id uuid, p_owner uuid, p_byte_size bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 104857600 THEN
    RAISE EXCEPTION 'file_too_big' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shop_item_files SET checked_at = now(), byte_size = p_byte_size
   WHERE id = p_file_id AND owner_id = p_owner AND checked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'file_not_found' USING ERRCODE = 'PT404';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_digital_file_checked(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_digital_file_checked(uuid, uuid, bigint) TO service_role;

-- 2d. The seller removes a file (or shop-digital removes one that failed its check). Returns the path so the
--     caller deletes the object. A LIVE item keeps at least one checked file (buyers already paid for it).
CREATE OR REPLACE FUNCTION public.shop_digital_file_remove(p_file_id uuid, p_owner uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  f public.shop_item_files%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO f FROM public.shop_item_files WHERE id = p_file_id AND owner_id = p_owner FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'file_not_found' USING ERRCODE = 'PT404';
  END IF;
  SELECT status INTO v_status FROM public.shop_items WHERE id = f.item_id FOR UPDATE;
  IF f.checked_at IS NOT NULL AND v_status <> 'draft'
     AND (SELECT count(*) FROM public.shop_item_files x WHERE x.item_id = f.item_id AND x.checked_at IS NOT NULL) <= 1 THEN
    RAISE EXCEPTION 'last_file' USING ERRCODE = '22023', HINT = 'Add the new file first, then remove this one.';
  END IF;
  DELETE FROM public.shop_item_files WHERE id = f.id;
  RETURN f.storage_path;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_digital_file_remove(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_digital_file_remove(uuid, uuid) TO service_role;

-- 4. Who may download a file: its seller, or a buyer of a download order for its item from the moment the charge is
--    taken ('accepted' + captured) and while it is final ('handed_over'); a refund ('refunded', 'partially_refunded')
--    or any other end takes it away. Service role only (shop-digital signs a 10-minute link with the path it
--    returns). NULL = no access. shop_orders.is_digital marks a download order (the buying RPCs are slice 2).
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS is_digital boolean NOT NULL DEFAULT false;
GRANT SELECT (is_digital) ON TABLE public.shop_orders TO authenticated;
-- A chargeback on a download's charge suspends the download (shop_digital_dispute_event, slice 2): set when the
-- dispute opens, kept when it is lost, cleared when it is won. Server-only (not granted to members).
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS digital_access_revoked_at timestamptz;

-- 4a. One rule for "this buyer may download what this order bought": a charged download order that is accepted or
--     final, no chargeback holding it, and no refund made in Stripe by hand (shop_hand_refunds, any amount, not
--     failed). A refund through the app sets the order 'refunded' / 'partially_refunded', which the status test
--     already ends. Service role only; both readers below call it.
CREATE OR REPLACE FUNCTION public.shop_digital_access_ok(p_order_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.shop_orders o
     WHERE o.id = p_order_id
       AND p_user IS NOT NULL
       AND o.is_digital
       AND o.buyer_id = p_user
       AND o.status IN ('accepted', 'handed_over')
       AND o.captured_at IS NOT NULL
       AND o.digital_access_revoked_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = o.id AND hr.failed_at IS NULL));
$fn$;
REVOKE ALL ON FUNCTION public.shop_digital_access_ok(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_digital_access_ok(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.shop_digital_download_path(p_file_id uuid, p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object('storage_path', f.storage_path, 'file_name', f.file_name)
    FROM public.shop_item_files f
   WHERE f.id = p_file_id
     AND p_user IS NOT NULL
     AND f.checked_at IS NOT NULL
     AND (f.owner_id = p_user
          OR EXISTS (
            SELECT 1 FROM public.shop_order_lines l
             WHERE l.item_id = f.item_id
               AND l.kind = 'digital'
               AND public.shop_digital_access_ok(l.order_id, p_user)));
$fn$;
REVOKE ALL ON FUNCTION public.shop_digital_download_path(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_digital_download_path(uuid, uuid) TO service_role;

-- 5. The newest bodies, restated (only the digital lines change).

-- Restated from shops_check_item_fields (20261105235833_shops_every_category_sells.sql).
CREATE OR REPLACE FUNCTION public.shops_check_item_fields(
  p_kind text, p_subtype text, p_title text, p_description text, p_price_cents integer,
  p_lead_time_days integer, p_stock_count integer)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental', 'digital') THEN
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
  -- Owner 11-05 (answer 5): up to $5,000 an item, for catering and big orders.
  IF p_price_cents IS NULL OR p_price_cents NOT BETWEEN 100 AND 500000 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = '22023', HINT = 'Set a price from $1 to $5,000.';
  END IF;
  IF p_lead_time_days IS NULL OR p_lead_time_days NOT BETWEEN 0 AND 60 THEN
    RAISE EXCEPTION 'invalid_lead_time' USING ERRCODE = '22023';
  END IF;
  IF p_stock_count IS NOT NULL AND p_stock_count NOT BETWEEN 0 AND 9999 THEN
    RAISE EXCEPTION 'invalid_stock' USING ERRCODE = '22023';
  END IF;
  -- CHANGED (digital): a download never runs out and is ready at once (no stock count, no lead time).
  IF p_kind = 'digital' AND (p_stock_count IS NOT NULL OR p_lead_time_days <> 0) THEN
    RAISE EXCEPTION 'digital_no_stock' USING ERRCODE = '22023', HINT = 'A download has no stock count and no wait.';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_check_item_fields(text, text, text, text, integer, integer, integer) TO service_role;

-- Restated from shop_item_required_statements (20261105235833_shops_every_category_sells.sql).
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
    -- H8 (owner 11-05, answer 1): services and rentals sell too.
    WHEN 'service' THEN ARRAY['i_do_this_work', 'licensed_if_needed', 'not_banned']
    WHEN 'rental' THEN ARRAY['i_own_it', 'safe_to_use', 'not_inflatable', 'not_banned']
    -- Digital downloads (owner 11-08): the seller owns the rights, and the file is what the listing says.
    WHEN 'digital' THEN ARRAY['i_own_the_rights', 'file_matches_listing', 'not_banned']
  END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_required_statements(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_item_required_statements(text, text) TO service_role;

-- Restated from shop_item_text_flag (20261105235833_shops_every_category_sells.sql).
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
  IF p_kind NOT IN ('service', 'rental', 'digital') AND v ~ '\m(puppy|puppies|kitten|kittens|chicks|ducklings|live animals?|piglets?)\M' THEN
    RETURN 'Mentions live animals (not allowed in Shops).';
  END IF;
  IF v ~ '\m(gun|guns|firearms?|ammo|ammunition|rifle|pistol|knives)\M' THEN
    RETURN 'Mentions weapons (not allowed in Shops).';
  END IF;
  IF p_kind NOT IN ('service', 'rental', 'digital') AND v ~ '\m(used|pre-owned|preowned|secondhand|second-hand|gently worn|thrifted|vintage)\M' THEN
    RETURN 'Sounds used. Shops sell new things the maker made; used things go in Declutter.';
  END IF;
  IF p_kind NOT IN ('service', 'rental', 'digital') AND v ~ '\m(baby|babies|infant|toddler|kids|children''?s|toy|toys|crib|bib|onesie)\M' THEN
    RETURN 'Sounds like a children''s item (not at launch: federal safety testing).';
  END IF;
  IF p_kind NOT IN ('service', 'rental', 'digital') AND v ~ '\m(soap|soaps|lotion|lotions|balm|balms|salve|salves|cosmetics?|skincare|skin care|lip gloss|scrub)\M' THEN
    RETURN 'Sounds like a skin product (soap, lotion and balms are not at launch).';
  END IF;
  IF p_kind NOT IN ('service', 'rental', 'digital') AND v ~ '\m(seedlings?|plants?|succulents?|cut flowers|bouquets?|nursery)\M' THEN
    RETURN 'Sounds like plants or flowers (not at launch: plant dealer permit).';
  END IF;
  IF p_kind = 'home_food' AND v ~ '\m(meat|beef|pork|chicken|turkey|sausage|boudin|andouille|jerky|bacon|ham|crawfish|shrimp|crab|fish|seafood|oysters?|gumbo|jambalaya|tamales?|meat pies?|cracklins?|plate lunch)\M' THEN
    RETURN 'Home-kitchen food cannot contain meat or fish (needs a health permit).';
  END IF;
  IF p_kind = 'home_food' AND v ~ '\m(canned (vegetables|beans|corn|green beans|okra|tomatoes|meat)|home-canned)\M' THEN
    RETURN 'Home-canned vegetables or meat are not allowed (pickles and acidified foods are).';
  END IF;
  IF p_kind = 'rental' AND v ~ '\m(bounce houses?|bouncy castles?|bouncers?|inflatables?|moonwalks?|water slides?)\M' THEN
    RETURN 'Sounds like an inflatable (bounce houses need state inspection paperwork, coming later).';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_text_flag(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shop_item_text_flag(text, text, text) TO service_role;

-- Restated from shops_publish_item (20261106194243_shops_option_words_checked.sql).
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
  v_text_flag text;
  v_status text;
  v_recent_rejection boolean;
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
  IF v_item.kind NOT IN ('made', 'home_food', 'farm', 'service', 'rental', 'digital') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_shop FROM public.shops WHERE id = v_item.shop_id;
  IF NOT v_shop.offers_selling THEN
    RAISE EXCEPTION 'shop_not_selling' USING ERRCODE = '22023', HINT = 'Turn on selling for your shop first.';
  END IF;
  -- L21: buyers pick a ready date from the shop's open days.
  -- CHANGED (digital): a download has no ready date, so it needs no order days.
  IF v_item.kind <> 'digital' AND NOT EXISTS (SELECT 1 FROM public.shop_hours h WHERE h.shop_id = v_shop.id) THEN
    RAISE EXCEPTION 'order_days_required' USING ERRCODE = '22023',
      HINT = 'Add the days your shop fills orders (opening hours) first.';
  END IF;

  SELECT count(*)::integer INTO v_photos FROM public.shop_item_photos WHERE item_id = p_item_id;
  IF v_photos < 3 OR v_photos > 12 THEN
    RAISE EXCEPTION 'photos_required' USING ERRCODE = '22023', HINT = 'Add at least 3 photos (up to 12).';
  END IF;
  -- CHANGED (digital): 1 to 5 files, every one checked (shop-digital confirmed its type from its first bytes), and
  -- none still waiting on its check.
  IF v_item.kind = 'digital' THEN
    IF (SELECT count(*) FROM public.shop_item_files f WHERE f.item_id = p_item_id AND f.checked_at IS NOT NULL) NOT BETWEEN 1 AND 5
       OR EXISTS (SELECT 1 FROM public.shop_item_files f WHERE f.item_id = p_item_id AND f.checked_at IS NULL) THEN
      RAISE EXCEPTION 'files_required' USING ERRCODE = '22023', HINT = 'Add 1 to 5 files for buyers to download.';
    END IF;
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
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
  END IF;
  -- The option lists and choices are checked with the title and description (shop_item_option_words, above).
  v_text_flag := public.shop_item_text_flag(v_item.kind, v_item.title,
                   COALESCE(v_item.description, '') || ' ' || public.shop_item_option_words(v_item.id));

  -- Owner 2026-11-05 (answer 2, the 10-29 rule): live at once when the
  -- automatic checks pass. Only a failed check, or a past rejection, waits.
  -- Hold after a rejection (owner 2026-10-17): any of this owner's items
  -- rejected by an admin in the last 30 days sends every publish to an admin,
  -- so taking a rejected item down and listing it again never skips review.
  v_recent_rejection := EXISTS (
    SELECT 1 FROM public.admin_audit_log l
     WHERE l.action = 'shop_item_rejected'
       AND l.details->>'owner_id' = v_uid::text
       AND l.created_at > now() - interval '30 days');
  -- An AI check that never answered fails open to the word check, as
  -- declutter_publish_item does; one that answered "flagged" holds it.
  v_status := CASE
    WHEN v_priv.admin_rejected_at IS NOT NULL THEN 'pending_review'
    WHEN v_recent_rejection THEN 'pending_review'
    WHEN v_priv.ai_checked_at IS NOT NULL AND v_priv.ai_flag_reason IS NOT NULL THEN 'pending_review'
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
