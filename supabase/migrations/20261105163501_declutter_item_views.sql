-- Owner request 11-05: "add a way for me to see how many people saw each item." Nothing counted views of a Declutter
-- listing: no table, no column. This adds a count of UNIQUE PEOPLE per item that only the seller can read.
--
-- Lead decisions (2026-11-05, ~OWNER-DECISIONS.md):
--   - one row per (item, person): a signed-in viewer by user id, a guest by a random per-device id the app keeps in
--     localStorage, so opening the same item again never adds to it;
--   - never counted: the seller themselves, admins, test accounts (is_test_member: profiles.is_seed or
--     test_accounts), and test listings (declutter_items.is_seed);
--   - a view is recorded when the item page opens, fire-and-forget from the client (it never blocks the page);
--   - only the seller reads the count (declutter_my_item_view_counts: the caller's own items only).
--
-- public.declutter_item_views: RLS on and NO client grant or policy at all; the two SECURITY DEFINER functions below
-- are the only way in or out. A viewer's row goes with their account (ON DELETE CASCADE), an item's with the item.
--
-- declutter_record_item_view(item, device): records the caller's view and returns nothing, whatever happened (a
-- refusal is never an error a page could show). Counted only while the item is live or reserved, not test data and
-- not a hidden seller's, and while Declutter is open to the caller (feature_enabled_for for a member,
-- declutter_open_to_guests for a guest). A guest must send a device id; a member's device id is ignored. GUEST CAP:
-- at most 30 new guest views per item per hour (the device id is the caller's choice; lh-authz-rls review 11-05).
-- A member counts once per account, uncapped.
--
-- declutter_my_item_view_counts(): (item_id, views) for the caller's own items that have a view. It also drops a
-- viewer who became a test account after viewing (is_test_member at read time).
--
-- REPLAY-SAFETY: CREATE TABLE / INDEX IF NOT EXISTS, CREATE OR REPLACE, policies none, grants restated. Reads only
-- objects that exist before this timestamp (declutter_items, has_role, is_test_member 20261030015205,
-- feature_enabled_for 20261012031120, declutter_open_to_guests 20261031060656).
-- PGlite proof: src/test/pglite/declutterItemViews.pglite.mjs. Guard: src/lib/declutter/itemViews.test.ts.

CREATE TABLE IF NOT EXISTS public.declutter_item_views (
  item_id uuid NOT NULL REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  viewer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_item_views_one_viewer CHECK ((viewer_id IS NULL) <> (device_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS declutter_item_views_member_once
  ON public.declutter_item_views (item_id, viewer_id) WHERE viewer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS declutter_item_views_guest_once
  ON public.declutter_item_views (item_id, device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS declutter_item_views_viewer
  ON public.declutter_item_views (viewer_id) WHERE viewer_id IS NOT NULL;

ALTER TABLE public.declutter_item_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_item_views FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_item_views TO service_role;

-- Q807: refuse writes from an unconfirmed email on the new table (standard guarded attach, as 20261105021744).
DO $gate$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gate$;

CREATE OR REPLACE FUNCTION public.declutter_record_item_view(p_item_id uuid, p_device_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_seller uuid;
BEGIN
  IF p_item_id IS NULL OR (v_uid IS NULL AND p_device_id IS NULL) THEN
    RETURN;
  END IF;
  IF v_uid IS NULL THEN
    IF NOT public.declutter_open_to_guests() THEN RETURN; END IF;
  ELSIF NOT public.feature_enabled_for('declutter') THEN
    RETURN;
  END IF;

  SELECT i.seller_id INTO v_seller
    FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND i.status IN ('live', 'reserved')
     AND i.is_seed IS NOT TRUE
     AND i.seller_hidden IS NOT TRUE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_uid IS NOT NULL THEN
    IF v_uid = v_seller
       OR COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false)
       OR public.is_test_member(v_uid) THEN
      RETURN;
    END IF;
    INSERT INTO public.declutter_item_views (item_id, viewer_id)
    VALUES (p_item_id, v_uid)
    ON CONFLICT (item_id, viewer_id) WHERE viewer_id IS NOT NULL DO NOTHING;
  ELSE
    -- The guest cap (lh-authz-rls review): a device id is the caller's own choice, so at most 30 NEW guest views per
    -- item per hour count; a script sending random ids cannot push a count up without limit.
    IF (SELECT count(*) FROM public.declutter_item_views v
         WHERE v.item_id = p_item_id AND v.device_id IS NOT NULL AND v.created_at > now() - interval '1 hour') >= 30 THEN
      RETURN;
    END IF;
    INSERT INTO public.declutter_item_views (item_id, device_id)
    VALUES (p_item_id, p_device_id)
    ON CONFLICT (item_id, device_id) WHERE device_id IS NOT NULL DO NOTHING;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_record_item_view(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_item_view(uuid, uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_record_item_view(uuid, uuid) IS
  'Owner request 11-05: records one unique view of a live/reserved Declutter item (member by user id, guest by device id); never the seller, an admin, a test account or a test listing. Returns nothing.';

CREATE OR REPLACE FUNCTION public.declutter_my_item_view_counts()
RETURNS TABLE(item_id uuid, views integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT v.item_id, count(*)::integer AS views
    FROM public.declutter_item_views v
    JOIN public.declutter_items i ON i.id = v.item_id
   WHERE i.seller_id = (SELECT auth.uid())
     AND (v.viewer_id IS NULL OR NOT public.is_test_member(v.viewer_id))
   GROUP BY v.item_id;
$fn$;

REVOKE ALL ON FUNCTION public.declutter_my_item_view_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_my_item_view_counts() TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_my_item_view_counts() IS
  'Owner request 11-05: how many unique people viewed each of the CALLER''s own Declutter items (seller only).';
