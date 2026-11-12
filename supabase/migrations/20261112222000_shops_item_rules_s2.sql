-- Shops audit 2 (11-12), Builder 3: two server rules the item editor relied on the app for.
--
-- 1. S2-002: RESTATED public.shops_record_item_ai_check from its NEWEST CREATE, 20261112204756_shops_live_item_photos.sql
--    (only the CHANGED (S2-002) block differs). A live photo add or remove clears the item's verdict and the check runs
--    again; until now only a flag held the item. An owner inside the 30-day hold after a rejection (Q1961) now waits
--    for an admin on a clean check too, as their live title, description and option-word edits already do
--    (shops_update_item, shops_set_item_variants).
-- 2. S2-003 (server half): a download has one price. Download checkout charges shop_items.price_cents, which the
--    option rollup sets to the LOWEST option price, and the buyer never picks an option, so a "$5 / $20" download
--    always sold for $5. The editor no longer offers options on a download (5bc9e990df); the database now refuses
--    them: no active option row on a download item, and no item turns into a download while it has option lists.
--    Any download that already has options keeps its current price (what it has been selling at) and drops them.
-- Proof: src/test/pglite/shopsItemRulesS2.pglite.mjs (3x; NEW_MIGRATION=skip RED).

-- ---------------------------------------------------------------------------
-- 1. The 30-day hold covers live photo changes (S2-002).
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
  v_flag text := NULLIF(left(btrim(COALESCE(p_flag_reason, '')), 300), '');
  v_recent_reject boolean;
BEGIN
  -- CHANGED (S009): a draft, or a LIVE item whose photos changed (the photo trigger cleared its verdict and any
  -- approval). A live item already judged, or one an admin approved since, is never re-judged, so a verdict cannot
  -- be swapped by asking again. Same rule as declutter_record_ai_check for a live listing.
  SELECT i.* INTO v_item FROM public.shop_items i
   WHERE i.id = p_item_id AND i.owner_id = p_owner_id
     AND (i.status = 'draft'
          OR (i.status = 'live' AND i.admin_approved_at IS NULL
              AND EXISTS (SELECT 1 FROM public.shop_item_private pv WHERE pv.item_id = i.id AND pv.ai_checked_at IS NULL)))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'PT404';
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
         ai_flag_reason = v_flag,
         updated_at = v_at
   WHERE item_id = p_item_id;
  -- NEW (S009): a live item flagged now comes off the shop for an admin, as a flagged live title edit does
  -- (shops_update_item: pending_review, submitted now, live_at cleared), and the seller is told why. Orders already
  -- placed stand, as they do for a held title edit.
  -- CHANGED (S2-002): the 30-day hold after a rejection (owner 11-10, Q1961) covers a live photo change too, the same
  -- rule shops_update_item uses for live words: an owner with a shop_item_rejected in the last 30 days waits for an
  -- admin even on a clean check.
  v_recent_reject := EXISTS (
    SELECT 1 FROM public.admin_audit_log l
     WHERE l.action = 'shop_item_rejected'
       AND l.details->>'owner_id' = v_item.owner_id::text
       AND l.created_at > now() - interval '30 days');
  IF v_item.status = 'live' AND (v_flag IS NOT NULL OR v_recent_reject) THEN
    UPDATE public.shop_items
       SET status = 'pending_review', submitted_at = v_at, live_at = NULL, updated_at = v_at
     WHERE id = p_item_id AND status = 'live';
    IF v_flag IS NOT NULL THEN
      PERFORM public.declutter_notify(v_item.owner_id, 'warning', 'Your item is waiting for a check',
        left(format('Our automatic check flagged a photo of "%s" (%s). Our team will look at it. Buyers can''t see it until then.',
                    v_item.title, v_flag), 1000), '/shops/mine');
    ELSE
      PERFORM public.declutter_notify(v_item.owner_id, 'info', 'Your item is waiting for a check',
        left(format('You changed the photos of "%s". For 30 days after an item isn''t approved, changes wait for our team. Buyers can''t see it until then.',
                    v_item.title), 1000), '/shops/mine');
    END IF;
  END IF;
  RETURN v_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shops_record_item_ai_check(uuid, uuid, uuid[], text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. A download has one price (S2-003).
-- Existing downloads with options: switch the options off and clear the lists. The price stays the rolled-up one
-- (the rollup only acts while option lists exist).
-- Money review should-fix 1: each owner is told, once per item, before its options go.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT i.owner_id, i.title FROM public.shop_items i
            WHERE i.kind = 'digital'
              AND (cardinality(i.option_names) > 0
                   OR EXISTS (SELECT 1 FROM public.shop_item_variants v WHERE v.item_id = i.id AND v.active))
  LOOP
    PERFORM public.declutter_notify(r.owner_id, 'info', 'A download has one price now',
      left(format('"%s" is a download, so buyers can''t pick an option for it. We took its options off; it sells at its current price. Change the price in My shop if you want.',
                  r.title), 1000), '/shops/mine');
  END LOOP;
END
$do$;
UPDATE public.shop_item_variants v SET active = false
  FROM public.shop_items i
 WHERE i.id = v.item_id AND i.kind = 'digital' AND v.active;
UPDATE public.shop_items SET option_names = '{}'::text[], updated_at = now()
 WHERE kind = 'digital' AND cardinality(option_names) > 0;

CREATE OR REPLACE FUNCTION public.shop_items_download_has_no_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  -- Money review should-fix 2: stale active option rows (lists already cleared) count too.
  IF NEW.kind = 'digital' AND (cardinality(NEW.option_names) > 0
       OR EXISTS (SELECT 1 FROM public.shop_item_variants v WHERE v.item_id = NEW.id AND v.active)) THEN
    RAISE EXCEPTION 'options_not_for_downloads' USING ERRCODE = '22023',
      HINT = 'A download has one price. Remove its options first, or pick another kind.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_items_download_has_no_options() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_items_download_has_no_options ON public.shop_items;
CREATE TRIGGER trg_shop_items_download_has_no_options BEFORE INSERT OR UPDATE OF kind, option_names ON public.shop_items
  FOR EACH ROW EXECUTE FUNCTION public.shop_items_download_has_no_options();

CREATE OR REPLACE FUNCTION public.shop_item_variants_not_on_downloads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF NEW.active AND EXISTS (SELECT 1 FROM public.shop_items i WHERE i.id = NEW.item_id AND i.kind = 'digital') THEN
    RAISE EXCEPTION 'options_not_for_downloads' USING ERRCODE = '22023',
      HINT = 'A download has one price. Remove its options first, or pick another kind.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.shop_item_variants_not_on_downloads() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_shop_item_variants_not_on_downloads ON public.shop_item_variants;
CREATE TRIGGER trg_shop_item_variants_not_on_downloads BEFORE INSERT OR UPDATE ON public.shop_item_variants
  FOR EACH ROW EXECUTE FUNCTION public.shop_item_variants_not_on_downloads();
