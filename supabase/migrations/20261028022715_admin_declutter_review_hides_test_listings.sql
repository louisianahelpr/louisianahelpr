-- Admin "Declutter: listings to review" never shows a test listing (owner rule
-- 2026-10-25/27: "i should never see test stuff in my admin panel"). The lead's
-- visual walkthrough on prod (2026-10-28) saw "Fixture side table
-- [E2E-PRODAUDIT]" in the card. Restated from prod's live body
-- (pg_get_functiondef 2026-10-28; newest file 20261014200728) with one change:
-- listings whose seller is a test account (profiles.is_seed) are left out.
CREATE OR REPLACE FUNCTION public.declutter_admin_pending_items()
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
       -- Test listings never reach the admin card.
       AND NOT EXISTS (SELECT 1 FROM public.profiles sp WHERE sp.user_id = i.seller_id AND sp.is_seed)
     ORDER BY i.submitted_at NULLS LAST, i.id
     LIMIT 200;
END;
$function$;
