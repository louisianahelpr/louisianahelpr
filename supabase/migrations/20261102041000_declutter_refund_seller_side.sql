-- A3-74 (audit 11-01, Medium GAP): when a Declutter refund went to Louisiana Helpr, only the buyer's words and photos
-- reached the admin: "I don't agree" and "Offer part of it" sent nothing from the seller, and neither side was told how
-- long the decision takes (the seller's payout waits with no end date).
-- Lead 11-01 ~9:50 PM: decide_by = when it reaches Louisiana Helpr + 48 h. Display only ("Louisiana Helpr usually
-- decides within 2 days (by Tue 11/3, 9 PM)"), and the admin queue shows it and sorts overdue ones first. No new
-- alert, no sweep: nothing happens on its own at decide_by.
--
-- WHAT CHANGES:
--   * declutter_refund_requests: seller_note (1..1000), seller_photo_paths (up to 3), seller_side_at.
--   * declutter_problems: decide_by.
--   * declutter_answer_refund, RESTATED from its newest definition (20261031010243, checked by name), with ONLY:
--     p_note text DEFAULT NULL and p_photo_paths text[] DEFAULT '{}' (the 3-argument version is dropped; a call
--     with the three old named arguments resolves to the new one, so a cached app keeps working), validated and stored
--     on 'part' and 'decline'. Every money line (the 'full' arm, the part bounds, the notices) is unchanged.
--   * declutter_refund_request_view, RESTATED from 20261031010243 (newest), with ONLY four new keys in 'request':
--     seller_note, seller_photo_paths, problem_id, decide_by.
--   * NEW trigger declutter_problem_refund_side (BEFORE INSERT on declutter_problems): a problem on a sale with a refund
--     request gets decide_by = now() + 48 h, and, when the buyer reported it and the seller had given a side on the
--     request, that side as the problem's other side (other_side_note / photos / at), the column the admin's problem
--     card already shows (declutter_admin_open_problems).
--   * NEW trigger declutter_refund_seller_side_to_problem (AFTER UPDATE OF status, problem_id on
--     declutter_refund_requests): a request that reaches to_admin by joining a problem that was already open fills the
--     same two things there, never overwriting a side the seller already added or an earlier decide_by.
-- MONEY: no amount, refund, payout or fee line changes. Grants: the restated RPCs keep authenticated + service_role,
-- never PUBLIC or anon; the trigger functions are callable by nobody. REPLAY-SAFE: ADD COLUMN IF NOT EXISTS,
-- DROP FUNCTION IF EXISTS (old signature), CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- Proof: src/test/pglite/declutterRefundSellerSide.pglite.mjs (3x; Supabase's default anon grant emulated).

ALTER TABLE public.declutter_refund_requests
  ADD COLUMN IF NOT EXISTS seller_note text CHECK (seller_note IS NULL OR char_length(btrim(seller_note)) BETWEEN 1 AND 1000),
  ADD COLUMN IF NOT EXISTS seller_photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(seller_photo_paths) <= 3),
  ADD COLUMN IF NOT EXISTS seller_side_at timestamptz;
ALTER TABLE public.declutter_problems ADD COLUMN IF NOT EXISTS decide_by timestamptz;

-- DESTRUCTIVE-DDL-ACK: DROP FUNCTION public.declutter_answer_refund(uuid, text, integer) -- replaced by the 5-argument
-- version below (two new optional arguments); the old named-argument call resolves to it.
DROP FUNCTION IF EXISTS public.declutter_answer_refund(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.declutter_answer_refund(p_request_id uuid, p_answer text, p_offer_cents integer,
                                                         p_note text DEFAULT NULL, p_photo_paths text[] DEFAULT '{}')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_path text;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_answer IS NULL OR p_answer NOT IN ('full', 'part', 'decline') THEN
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Lock order: the order (and its items) first, then the request, as every other path.
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';
  END IF;
  -- CHANGED (A3-74): the seller's side on "I don't agree" and on a part offer: an optional note (up to 1,000
  -- characters) and up to 3 photos, only from the seller's own problem folder for this order and already uploaded (the
  -- rule of declutter_problem_add_side, 20261029225634). Stored on the request; when it reaches Louisiana Helpr it
  -- becomes the seller's side of the problem (declutter_refund_seller_side_to_problem). "Refund in full" takes none.
  IF p_answer IN ('part', 'decline') THEN
    IF char_length(COALESCE(v_note, '')) > 1000 THEN
      RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023', HINT = 'Keep it to 1,000 characters.';
    END IF;
    IF cardinality(COALESCE(p_photo_paths, '{}')) > 3 THEN
      RAISE EXCEPTION 'too_many_problem_photos' USING ERRCODE = '22023', HINT = 'Add up to 3 photos.';
    END IF;
    FOREACH v_path IN ARRAY COALESCE(p_photo_paths, '{}') LOOP
      IF v_path IS NULL
         OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text
         OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
         OR split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'
         OR split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text
         OR split_part(v_path, '/', 5) = ''
         OR split_part(v_path, '/', 6) <> ''
         OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN
        RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    UPDATE public.declutter_refund_requests
       SET seller_note = v_note, seller_photo_paths = COALESCE(p_photo_paths, '{}'),
           seller_side_at = CASE WHEN v_note IS NOT NULL OR cardinality(COALESCE(p_photo_paths, '{}')) > 0 THEN now() END
     WHERE id = r.id;
  END IF;
  IF p_answer = 'full' THEN
    -- #3558 answer 2: nothing is refunded yet. The refund is sent when the seller confirms the item is back
    -- (declutter_refund_item_returned); the payout stays held (declutter_sale_final reads 'returning').
    PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
    IF NOT public.declutter_payout_unsent(o.id) THEN
      RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
        HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
    END IF;
    -- CHANGED (BUY-25, owner 10-30): the buyer never got it, so there is nothing to bring back: refunded now, with the
    -- payout taken to nothing. Lead 10-30: reason seller_no_show, so fee policy full_seller_pays_fee: the buyer gets
    -- everything back, and the seller owes the card fee (declutter_record_refund's debt row, out of their next payout).
    -- A delivery fee that already paid a Helpr for the trip stays with the Helpr, as on every refund (B69).
    IF r.reason = 'not_received' THEN
      v_out := public.declutter_refund_after_handover(o.id, 'seller_no_show', NULL);
      UPDATE public.declutter_refund_requests
         SET status = 'agreed', refund_id = (v_out->>'refund_id')::uuid, settled_at = now()
       WHERE id = r.id;
      RETURN v_out || jsonb_build_object('result', 'refunded');
    END IF;
    UPDATE public.declutter_refund_requests
       SET status = 'returning', return_agreed_at = now(), return_by = now() + interval '72 hours'
     WHERE id = r.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller agreed to a full refund',
      format('Give the item back to the seller; message the seller from your order. Your refund of $%s is sent as soon as the seller confirms they have it back.',
             to_char(public.declutter_full_refund_cents(o.id) / 100.0, 'FM999990.00')),
      '/declutter?view=buying', v_uid);
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Full refund agreed',
      'When the buyer gives the item back, tap "I got it back" and the refund is sent. If you don''t confirm within 3 days, Louisiana Helpr decides.',
      '/declutter?view=selling', o.buyer_id);
    RETURN jsonb_build_object('result', 'returning', 'full_refund_cents', public.declutter_full_refund_cents(o.id));
  ELSIF p_answer = 'part' THEN
    IF o.tax_cents <> 0 THEN
      RAISE EXCEPTION 'part_refund_unavailable' USING ERRCODE = '55000';
    END IF;
    IF p_offer_cents IS NULL OR p_offer_cents <= 0 OR p_offer_cents >= o.items_cents THEN
      RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023',
        HINT = 'Offer an amount above $0 and below the item price. To give it all back, choose Refund in full.';
    END IF;
    UPDATE public.declutter_refund_requests
       SET status = 'offered', offer_cents = p_offer_cents, offered_at = now(), offer_answer_by = now() + interval '24 hours'
     WHERE id = r.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'The seller offered a part refund',
      format('The seller offered $%s back. Take it, or ask Louisiana Helpr to decide, within 24 hours. If you don''t answer, Louisiana Helpr decides.',
             to_char(p_offer_cents / 100.0, 'FM999990.00')),
      '/declutter?view=cart', v_uid);
    RETURN jsonb_build_object('result', 'offered', 'offer_cents', p_offer_cents);
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'declined', declined_at = now() WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'The seller said no',
    'The seller didn''t agree to a refund. If you still think something is wrong, report a problem within 24 hours and Louisiana Helpr decides.',
    '/declutter?view=cart', v_uid);
  RETURN jsonb_build_object('result', 'declined');
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund(uuid, text, integer, text, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_view(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_side text;
  v_refund public.declutter_refunds;
  v_show_address boolean;
  v_drop_address text;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF o.id IS NULL OR v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE order_id = o.id;
  IF r.refund_id IS NOT NULL THEN
    SELECT * INTO v_refund FROM public.declutter_refunds WHERE id = r.refund_id;
  END IF;
  v_show_address := COALESCE(r.status = 'returning' AND r.return_way = 'collect', false);
  -- CHANGED (BUY-23, owner 10-30): only while a drop-off is open, and only where the seller offered pickup: the same
  -- points the drop-off photo is measured from (declutter_return_dropped_off).
  IF r.status = 'returning' AND r.return_way = 'drop_off' AND o.handover IN ('pickup_home', 'porch') THEN
    SELECT string_agg(DISTINCT pt.address, '; ') INTO v_drop_address FROM public.declutter_order_pickup_points(o.id) pt;
  END IF;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'side', v_side,
    'handed_over', o.status = 'handed_over',
    'window_ends_at', CASE WHEN o.status = 'handed_over' THEN o.handed_over_at + interval '24 hours' END,
    'can_ask', COALESCE(v_side = 'buyer' AND o.status = 'handed_over' AND r.id IS NULL
               AND now() < o.handed_over_at + interval '24 hours'
               AND NOT public.declutter_sale_decided(o.id) AND public.declutter_payout_unsent(o.id)
               AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'can_report', COALESCE(v_side = 'buyer' AND public.declutter_problem_window_open(o.id)
                  AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open'), false),
    'items_cents', o.items_cents,
    'full_refund_cents', public.declutter_full_refund_cents(o.id),
    -- BUY-25: never got it, the seller refunds in full: everything back, less a delivery a Helpr already made.
    'never_got_it_refund_cents', o.total_cents - public.declutter_delivery_reserved_cents(o.id),
    'delivery_kept_cents', public.declutter_delivery_reserved_cents(o.id),
    'can_drop_off', o.handover IN ('pickup_home', 'porch'),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'answer_by', r.answer_by,
      -- D2-3: the buyer's photos (both sides read them through declutter-handover's read rule: the two parties and admins).
      'photo_paths', COALESCE(r.photo_paths, '{}'),
      'offer_cents', r.offer_cents, 'offer_answer_by', r.offer_answer_by, 'declined_at', r.declined_at,
      'return_by', r.return_by, 'returned_at', r.returned_at,
      'report_until', CASE WHEN r.status = 'declined' THEN greatest(r.declined_at, o.handed_over_at) + interval '24 hours' END,
      'refund_cents', v_refund.refund_cents, 'refund_status', v_refund.status, 'created_at', r.created_at,
      -- D2-5: the request ended with Louisiana Helpr's decision (not the seller's answer), so the panel says so.
      'admin_decided', r.status IN ('agreed', 'declined')
                       AND EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'decided'),
      'return_way', r.return_way, 'return_day', r.return_day, 'return_at', r.return_at,
      'return_dropped_off_at', r.return_dropped_off_at,
      'return_deadline', CASE WHEN r.status = 'returning' THEN public.declutter_return_backstop_at(r) END,
      'return_address', CASE WHEN v_show_address THEN r.return_address END,
      'return_lat', CASE WHEN v_show_address THEN r.return_lat END,
      'return_lng', CASE WHEN v_show_address THEN r.return_lng END,
      'drop_off_address', v_drop_address,
      -- CHANGED (A3-74): the seller's side (both parties read it; the photos through declutter-handover's read rule),
      -- the problem Louisiana Helpr decides, and when it usually decides (display only; nothing happens on its own).
      'seller_note', r.seller_note, 'seller_photo_paths', COALESCE(r.seller_photo_paths, '{}'),
      'problem_id', r.problem_id,
      'decide_by', (SELECT x.decide_by FROM public.declutter_problems x WHERE x.id = r.problem_id AND x.status = 'open')) END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.declutter_problem_refund_side()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r public.declutter_refund_requests;
BEGIN
  SELECT * INTO r FROM public.declutter_refund_requests WHERE order_id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  NEW.decide_by := COALESCE(NEW.decide_by, now() + interval '48 hours');
  -- seller_side_at is set only when the seller gave words or photos; photos alone read "The seller added photos.".
  IF NEW.reporter_side = 'buyer' AND NEW.other_side_note IS NULL AND r.seller_side_at IS NOT NULL THEN
    NEW.other_side_note := COALESCE(r.seller_note, 'The seller added photos.');
    NEW.other_side_photo_paths := COALESCE(r.seller_photo_paths, '{}');
    NEW.other_side_at := r.seller_side_at;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_problem_refund_side() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_problem_refund_side ON public.declutter_problems;
CREATE TRIGGER trg_declutter_problem_refund_side
  BEFORE INSERT ON public.declutter_problems
  FOR EACH ROW EXECUTE FUNCTION public.declutter_problem_refund_side();

CREATE OR REPLACE FUNCTION public.declutter_refund_seller_side_to_problem()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fill boolean;
BEGIN
  -- The seller's side fills the problem's other side only when the buyer reported it, nobody added one yet, and the
  -- seller gave words or photos on the request.
  SELECT p.reporter_side = 'buyer' AND p.other_side_note IS NULL AND NEW.seller_side_at IS NOT NULL INTO v_fill
    FROM public.declutter_problems p WHERE p.id = NEW.problem_id;
  UPDATE public.declutter_problems p
     SET decide_by = COALESCE(p.decide_by, now() + interval '48 hours'),
         other_side_note = CASE WHEN v_fill THEN COALESCE(NEW.seller_note, 'The seller added photos.') ELSE p.other_side_note END,
         other_side_photo_paths = CASE WHEN v_fill THEN COALESCE(NEW.seller_photo_paths, '{}') ELSE p.other_side_photo_paths END,
         other_side_at = CASE WHEN v_fill THEN NEW.seller_side_at ELSE p.other_side_at END
   WHERE p.id = NEW.problem_id AND p.status = 'open';
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.declutter_refund_seller_side_to_problem() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_refund_seller_side_to_problem ON public.declutter_refund_requests;
CREATE TRIGGER trg_declutter_refund_seller_side_to_problem
  AFTER UPDATE OF status, problem_id ON public.declutter_refund_requests
  FOR EACH ROW
  WHEN (NEW.status = 'to_admin' AND NEW.problem_id IS NOT NULL
        AND (OLD.status IS DISTINCT FROM 'to_admin' OR OLD.problem_id IS DISTINCT FROM NEW.problem_id))
  EXECUTE FUNCTION public.declutter_refund_seller_side_to_problem();
