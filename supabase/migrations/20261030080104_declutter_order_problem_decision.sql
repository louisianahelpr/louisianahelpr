-- Declutter audit 1030 DB-12: after Louisiana Helpr decided a reported problem, the order card said only "Handed over."
--
-- The card reads the order's newest problem through declutter_order_problem (20261030044444), which returned no
-- decision, so DeclutterProblemSides hid a decided problem and nothing on the card said what Louisiana Helpr decided
-- (the two "Louisiana Helpr decided" notices were the only place it was said).
--
-- Fix: the same party-scoped read also returns decision and decided_at, so the card can say "Louisiana Helpr decided:
-- the seller keeps the payment" (or the refund). Both columns are already in authenticated's column grant on
-- declutter_problems (measured on prod 2026-10-30, information_schema.column_privileges), readable by the two sides
-- under RLS, so this shows a member nothing they could not already read. Still never the admin's note, the fault, the
-- strike, decided_by or the reporter's id. Everything else is the 20261030044444 body unchanged.
--
-- Replay-safe: CREATE OR REPLACE with the same signature and return type; grants restated.

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
         x.other_side_note, x.other_side_photo_paths, x.decision, x.decided_at
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
    'other_side_photo_paths', COALESCE(to_jsonb(p.other_side_photo_paths), '[]'::jsonb),
    -- DB-12: what Louisiana Helpr decided (refund_buyer, refund_part, pay_seller or delivery_damage) and when; NULL while open.
    'decision', p.decision,
    'decided_at', p.decided_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.declutter_order_problem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_order_problem(uuid) TO authenticated, service_role;
