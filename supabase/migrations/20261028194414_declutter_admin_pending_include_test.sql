-- Admin "Declutter: listings to review" can show test listings on request (lead 2026-10-28, item #14, for
-- builder 3's admin "show test listings" switch).
--
-- declutter_admin_pending_items gains p_include_test boolean DEFAULT false. The default keeps the owner's rule
-- (2026-10-25/27: "i should never see test stuff in my admin panel"): a call with no argument, which every
-- installed app build makes, resolves to this function through the DEFAULT and still leaves test listings out.
-- Body restated from 20261028022715 (its newest definition) with one change: the is_seed filter is skipped only
-- when the admin asks (p_include_test). Same gates: require_feature('declutter'), then the admin role.
-- declutter_admin_review_item is NOT changed: it never refused a test seller's listing (read 2026-10-28,
-- newest 20261027182550: no is_seed check), so an admin can already decide one.
--
-- Replay-safety: DROP FUNCTION IF EXISTS of the no-argument signature (a second run finds none: the one-argument
-- function is a different signature and stays), then CREATE OR REPLACE.
-- Proof: src/test/pglite/declutterAdminPendingIncludeTest.pglite.mjs (applied 3x).

DROP FUNCTION IF EXISTS public.declutter_admin_pending_items();

CREATE OR REPLACE FUNCTION public.declutter_admin_pending_items(p_include_test boolean DEFAULT false)
 RETURNS TABLE(item_id uuid, seller_id uuid, title text, description text, category text, condition_stars smallint, delivery_size text, price_cents integer, area_label text, submitted_at timestamp with time zone, ai_checked_at timestamp with time zone, ai_flag_reason text, approved_listings integer, photo_paths text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.require_feature('declutter');
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT i.id, i.seller_id, i.title, i.description, i.category, i.condition_stars, i.delivery_size,
           i.price_cents, i.area_label, i.submitted_at, p.ai_checked_at, p.ai_flag_reason,
           (SELECT count(*)::integer FROM public.declutter_items a
             WHERE a.seller_id = i.seller_id AND a.admin_approved_at IS NOT NULL),
           (SELECT COALESCE(array_agg(ph.storage_path ORDER BY ph.position), ARRAY[]::text[])
              FROM public.declutter_item_photos ph WHERE ph.item_id = i.id)
      FROM public.declutter_items i
      JOIN public.declutter_item_private p ON p.item_id = i.id
     WHERE i.status = 'pending_review'
       -- Test listings reach the admin card only when the admin asks (p_include_test); never by default.
       AND (COALESCE(p_include_test, false) OR NOT EXISTS (SELECT 1 FROM public.profiles sp WHERE sp.user_id = i.seller_id AND sp.is_seed))
     ORDER BY i.submitted_at NULLS LAST, i.id
     LIMIT 200;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_admin_pending_items(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_pending_items(boolean) TO authenticated, service_role;
