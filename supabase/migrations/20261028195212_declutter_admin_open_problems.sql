-- Admin "Declutter problems" card: one read with everything needed to decide (Declutter audit 2 SH2-4 / lead's
-- A2-13, 2026-10-28, for builder 3's problem card and dispute screen). The card read declutter_problems alone,
-- so an admin saw only "Order d07a84de" and the note: no item, amounts, photos or names.
--
-- declutter_admin_open_problems(p_include_test boolean DEFAULT false) (new, read-only): every OPEN problem,
-- oldest first, with its order's handover, status and amounts, the items' titles and first photos (same
-- order), both people's names as the app shows them (member_display_name: "First L."), the handover photos
-- and times, and whether a Helpr carries it (handover 'delivery'). Test orders (declutter_orders.is_seed) are
-- left out unless the admin asks (owner rule: no test stuff in the admin panel by default).
-- Admins only (has_role 'admin', 42501 'not_admin'). No require_feature on purpose (row 62: open problems on
-- paid sales must stay decidable with the switch off). Admin-only personal data (names, photo paths): needs
-- lh-authz-rls. STABLE SECURITY DEFINER, search_path pinned; REVOKE FROM PUBLIC, anon; GRANT authenticated.
-- Proof: src/test/pglite/declutterAdminOpenProblems.pglite.mjs (applied 3x).
-- REPLAY-SAFETY: CREATE OR REPLACE (a new function, no earlier definition).

CREATE OR REPLACE FUNCTION public.declutter_admin_open_problems(p_include_test boolean DEFAULT false)
RETURNS TABLE(problem_id uuid, order_id uuid, reporter_side text, reason text, note text, problem_photo_paths text[],
  reported_at timestamptz, handover text, order_status text, items_cents integer, bundle_discount_cents integer,
  delivery_cents integer, premium_cents integer, tax_cents integer, total_cents integer, paid_at timestamptz,
  item_titles text[], item_photo_paths text[], buyer_id uuid, buyer_name text, seller_id uuid, seller_name text,
  set_out_photo_path text, set_out_at timestamptz, picked_up_photo_path text, picked_up_at timestamptz,
  picked_up_distance_m integer, confirmed_at timestamptz, confirmed_by text, helpr_delivery boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.has_role((SELECT auth.uid()), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.order_id, p.reporter_side, p.reason, p.note, p.photo_paths, p.created_at,
           o.handover, o.status, o.items_cents, o.bundle_discount_cents, o.delivery_cents, o.premium_cents,
           o.tax_cents, o.total_cents, o.paid_at,
           li.titles, li.photos,
           o.buyer_id, CASE WHEN o.buyer_id IS NULL THEN NULL ELSE public.member_display_name(bp.full_name) END,
           o.seller_id, CASE WHEN o.seller_id IS NULL THEN NULL ELSE public.member_display_name(sp.full_name) END,
           h.set_out_photo_path, h.set_out_at, h.picked_up_photo_path, h.picked_up_at, h.picked_up_distance_m,
           h.confirmed_at, h.confirmed_by,
           o.handover = 'delivery'
      FROM public.declutter_problems p
      JOIN public.declutter_orders o ON o.id = p.order_id
      LEFT JOIN public.profiles bp ON bp.user_id = o.buyer_id
      LEFT JOIN public.profiles sp ON sp.user_id = o.seller_id
      LEFT JOIN public.declutter_handovers h ON h.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(array_agg(i.title ORDER BY c.created_at, c.id), ARRAY[]::text[]) AS titles,
               COALESCE(array_agg((SELECT ph.storage_path FROM public.declutter_item_photos ph
                                    WHERE ph.item_id = c.item_id ORDER BY ph.position LIMIT 1)
                                  ORDER BY c.created_at, c.id), ARRAY[]::text[]) AS photos
          FROM public.declutter_cart_items c
          LEFT JOIN public.declutter_items i ON i.id = c.item_id
         WHERE c.order_id = o.id
      ) li ON true
     WHERE p.status = 'open'
       AND (COALESCE(p_include_test, false) OR NOT o.is_seed)
     ORDER BY p.created_at, p.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_open_problems(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_open_problems(boolean) TO authenticated, service_role;
