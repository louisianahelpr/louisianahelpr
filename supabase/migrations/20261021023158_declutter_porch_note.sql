-- Board 159 / Q2266 (owner approved 2026-10-21): the seller's "Where exactly?" note on the porch photo.
--
-- A nullable note on the order's handover row, written by the SELLER right after the porch photo (the client
-- calls declutter_porch_note after declutter_porch_photo succeeds), and read only through declutter_my_handover,
-- which already answers only the order's two parties on a PAID or HANDED-OVER order. So the buyer sees it only
-- after paying. declutter_handovers keeps RLS on with no policy and no grant: the RPCs are the only door.
--
-- No contact-leak filter: the two parties can already message each other after checkout. Capped at 200 letters.
-- Replay-safe: ADD COLUMN IF NOT EXISTS, a named CHECK added only when missing, CREATE OR REPLACE functions.

ALTER TABLE public.declutter_handovers ADD COLUMN IF NOT EXISTS set_out_note text;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'declutter_handovers_set_out_note_len') THEN
    ALTER TABLE public.declutter_handovers
      ADD CONSTRAINT declutter_handovers_set_out_note_len
      CHECK (set_out_note IS NULL OR char_length(set_out_note) BETWEEN 1 AND 200);
  END IF;
END
$do$;

-- The seller's note. Only the order's seller, only a paid porch order, only once the porch photo is in.
-- An empty note clears it. Returns the note as saved.
CREATE OR REPLACE FUNCTION public.declutter_porch_note(p_order_id uuid, p_note text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_note text;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Refuse a huge input before normalising it (lh-authz-rls review #5).
  IF char_length(coalesce(p_note, '')) > 1000 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023', HINT = 'Keep it to 200 letters.';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  -- Never say whether someone else's order exists.
  IF o.id IS NULL OR o.seller_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = o.id AND h.set_out_at IS NOT NULL) THEN
    RAISE EXCEPTION 'photo_first' USING ERRCODE = '55000', HINT = 'Take the porch photo first.';
  END IF;
  v_note := NULLIF(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023', HINT = 'Keep it to 200 letters.';
  END IF;
  UPDATE public.declutter_handovers SET set_out_note = v_note WHERE order_id = o.id;
  RETURN v_note;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_note(uuid, text) TO authenticated, service_role;

-- Restated from 20261018183715 (body md5 87abf7084725373e7d2edd40a18f8e38 matched prod 2026-10-21) with one
-- new key, set_out_note. Same gate: the order's two parties, paid or handed over.
CREATE OR REPLACE FUNCTION public.declutter_my_handover(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  h public.declutter_handovers;
  v_side text;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL OR o.status NOT IN ('paid', 'handed_over') THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  -- No code and no QR reach either side (owner 2026-10-18: porch pickup only).
  RETURN jsonb_build_object(
    'order_id', o.id, 'status', o.status, 'side', v_side,
    'confirmed_by', h.confirmed_by, 'confirmed_at', h.confirmed_at,
    'set_out_at', h.set_out_at, 'set_out_photo_path', h.set_out_photo_path,
    'set_out_note', h.set_out_note,
    'picked_up_at', h.picked_up_at, 'picked_up_photo_path', h.picked_up_photo_path);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_handover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_handover(uuid) TO authenticated, service_role;
