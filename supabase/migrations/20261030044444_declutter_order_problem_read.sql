-- Declutter audit 1030 DB-1 (same root as DA-7, DC-15): the order card's problem read failed on prod.
--
-- Measured on prod 2026-10-30 (role authenticated, read-only transaction): authenticated holds a COLUMN grant on
-- declutter_problems for 15 columns, but not decided_by, other_side_note, other_side_photo_paths or other_side_at.
-- fetchOrderProblem (src/lib/declutter/handover.ts) read select("*"), so every call was refused 42501 ("permission
-- denied for table declutter_problems"; 36 refusals in the audit's network log), and DeclutterProblemSides showed
-- nothing: neither side saw the report, its photos or the other side's answer. (fetchOpenProblems names four granted
-- columns and works; measured with the same role.)
--
-- Fix: one party-scoped read. The buyer or the seller of the order, or an admin, gets the order's newest problem with
-- ONLY the columns the card renders (DeclutterProblemSides.tsx: id, reporter_side, reason, note, photo_paths, status,
-- other_side_note, other_side_photo_paths; created_at for the order). Never the admin's note, decision, fault,
-- strike, decided_by or the reporter's id. Anyone else is told nothing exists (problem_not_found), the same answer as
-- an order with no such id. No problem on the order: NULL. The table grants are unchanged.
--
-- Replay-safe: CREATE OR REPLACE with the same signature; grants restated.

CREATE OR REPLACE FUNCTION public.declutter_order_problem(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o record;
  p record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT x.id, x.buyer_id, x.seller_id INTO o FROM public.declutter_orders x WHERE x.id = p_order_id;
  -- The two sides of the sale and admins; a stranger is not told the order exists.
  IF o.id IS NULL
     OR NOT (o.buyer_id IS NOT DISTINCT FROM v_uid AND o.buyer_id IS NOT NULL
             OR o.seller_id IS NOT DISTINCT FROM v_uid AND o.seller_id IS NOT NULL
             OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT x.id, x.reporter_side, x.reason, x.note, x.photo_paths, x.status, x.created_at,
         x.other_side_note, x.other_side_photo_paths
    INTO p
    FROM public.declutter_problems x
   WHERE x.order_id = o.id
   ORDER BY x.created_at DESC, x.id DESC
   LIMIT 1;
  IF p.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', p.id,
    'reporter_side', p.reporter_side,
    'reason', p.reason,
    'note', p.note,
    'photo_paths', COALESCE(to_jsonb(p.photo_paths), '[]'::jsonb),
    'status', p.status,
    'created_at', p.created_at,
    'other_side_note', p.other_side_note,
    'other_side_photo_paths', COALESCE(to_jsonb(p.other_side_photo_paths), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_order_problem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_problem(uuid) TO authenticated, service_role;
