-- Shipping S6 (Q2259; docs/specs/shipping-draft.md 5.3 row "ship_damaged / not as described": "a return label if the
-- admin wants the item back = seller debt"). Before: nothing could ask for the item back; Help and Terms no longer
-- promise it (b56b004a8f). EasyPost TEST mode only (owner 11-01: no real labels until the owner's switch).
--
-- Now, the database half (the label worker's EasyPost buy is supabase/functions/_shared/shipReturnLabel.ts):
--   1. shipping_return_labels: ONE return label per order, ever (order_id UNIQUE). label_mode CHECK = 'test': a live
--      return label cannot be stored at all until a later migration widens it. No member column: the seller and
--      buyer are read from the order; the admin who asked is in admin_audit_log.
--   2. declutter_admin_request_return_label(order, note): admin only, behind declutter_shipping. Only a SHIPPED order
--      with a not_as_described refund row, before or after the handover (the 5.3 row; a damaged parcel is refunded under that reason) whose
--      outbound TEST label was bought and delivered. A live outbound label is refused (return_label_test_only: arrange
--      it by hand). The same order again answers already_requested and writes nothing. An admin_audit_log row.
--   3. declutter_ship_return_label_bought(return, provider shipment, tracking, label url, cost): service role (the
--      worker). requested -> bought once (compare-and-set); books the cost as ONE seller debt (source_kind
--      'ship_label', source_ref = the return row id: the ledger's existing shipping kind, so 2e's "an open shipping
--      debt stops new ship sales" counts it too); tells the buyer to send it back and the seller what it costs.
--      A replay answers already and books nothing more.
--   4. declutter_ship_return_label_failed(return, why): service role; requested -> failed, ops paged through
--      log_cron_defect (the admin arranges the return by hand). No debt.
--   5. declutter_my_return_label(order): the order's BUYER only, switch on: the label URL and tracking once bought;
--      anyone else gets order_not_found.
-- Proof: src/test/pglite/shippingReturnLabel.pglite.mjs (applied 3x; NEW_MIGRATION=skip is red; planted defects;
-- Supabase's default execute grant emulated). REPLAY-SAFETY: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE.

CREATE TABLE IF NOT EXISTS public.shipping_return_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE RESTRICT,
  label_mode text NOT NULL CHECK (label_mode = 'test'),
  state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'bought', 'failed')),
  provider_shipment_id text UNIQUE,
  tracking_code text,
  label_url text CHECK (label_url IS NULL OR label_url LIKE 'https://%'),
  label_cost_cents integer CHECK (label_cost_cents > 0),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 500),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipping_return_bought_has_label CHECK (state <> 'bought'
    OR (provider_shipment_id IS NOT NULL AND tracking_code IS NOT NULL AND label_url IS NOT NULL AND label_cost_cents IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS shipping_return_labels_shipment_idx ON public.shipping_return_labels (shipment_id);
CREATE INDEX IF NOT EXISTS shipping_return_labels_due_idx ON public.shipping_return_labels (next_attempt_at) WHERE state = 'requested';
ALTER TABLE public.shipping_return_labels ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shipping_return_labels FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.shipping_return_labels TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_admin_request_return_label(p_order_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_note text := btrim(COALESCE(p_note, ''));
  o public.declutter_orders;
  s record;
  v_prior public.shipping_return_labels;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter_shipping');
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_note) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'invalid_note' USING ERRCODE = '22023', HINT = 'Say why the item should come back, in under 500 characters.';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  SELECT * INTO v_prior FROM public.shipping_return_labels r WHERE r.order_id = o.id;
  IF FOUND THEN
    RETURN jsonb_build_object('result', 'already_requested', 'return_id', v_prior.id, 'state', v_prior.state);
  END IF;
  IF o.handover IS DISTINCT FROM 'ship' THEN
    RAISE EXCEPTION 'not_a_shipped_order' USING ERRCODE = '22023', HINT = 'A return label is only for an order that was shipped.';
  END IF;
  -- A refund after the handover leaves the order 'handed_over' with its refund row; before it, the order is 'refunded'.
  IF o.status NOT IN ('refunded', 'handed_over') OR NOT EXISTS (SELECT 1 FROM public.declutter_refunds d
                                           WHERE d.order_id = o.id AND d.reason = 'not_as_described') THEN
    RAISE EXCEPTION 'return_not_allowed' USING ERRCODE = '55000',
      HINT = 'A return label is only for an order refunded as damaged or not as described.';
  END IF;
  SELECT x.id, x.label_state, x.label_mode, x.delivered_at INTO s
    FROM public.shipments x WHERE x.declutter_order_id = o.id ORDER BY x.created_at DESC, x.id LIMIT 1;
  IF s.id IS NULL OR s.label_state <> 'bought' OR s.delivered_at IS NULL THEN
    RAISE EXCEPTION 'not_delivered' USING ERRCODE = '55000', HINT = 'The package was never delivered, so there is nothing to send back.';
  END IF;
  IF s.label_mode IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION 'return_label_test_only' USING ERRCODE = '55000',
      HINT = 'Return labels are test-only until shipping goes live. Arrange this return by hand.';
  END IF;
  INSERT INTO public.shipping_return_labels (order_id, shipment_id, label_mode, note, is_seed)
  VALUES (o.id, s.id, 'test', v_note, COALESCE(o.is_seed, false))
  RETURNING id INTO v_id;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_admin_request_return_label', 'declutter_order', o.id::text,
          jsonb_build_object('return_id', v_id, 'shipment_id', s.id, 'note', v_note));
  RETURN jsonb_build_object('result', 'requested', 'return_id', v_id, 'state', 'requested');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_request_return_label(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_request_return_label(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_ship_return_label_bought(p_return_id uuid, p_provider_shipment_id text,
  p_tracking_code text, p_label_url text, p_cost_cents integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.shipping_return_labels;
  o record;
  v_title text;
  v_debt uuid;
BEGIN
  IF p_cost_cents IS NULL OR p_cost_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.shipping_return_labels x WHERE x.id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'return_not_found' USING ERRCODE = 'PT404';
  END IF;
  IF r.state = 'bought' THEN
    RETURN 'already';
  END IF;
  IF r.state <> 'requested' THEN
    RAISE EXCEPTION 'return_not_requested' USING ERRCODE = '55000';
  END IF;
  UPDATE public.shipping_return_labels
     SET state = 'bought', provider_shipment_id = p_provider_shipment_id, tracking_code = p_tracking_code,
         label_url = p_label_url, label_cost_cents = p_cost_cents, last_error = NULL, updated_at = now()
   WHERE id = r.id;
  SELECT d.seller_id, d.buyer_id INTO o FROM public.declutter_orders d WHERE d.id = r.order_id;
  SELECT i.title INTO v_title FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id
   WHERE c.order_id = r.order_id ORDER BY c.id LIMIT 1;
  IF o.seller_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.seller_id) THEN
    INSERT INTO public.declutter_seller_fee_debts (seller_id, source_kind, source_ref, amount_cents, remaining_cents)
    VALUES (o.seller_id, 'ship_label', r.id, p_cost_cents, p_cost_cents)
    ON CONFLICT (source_kind, source_ref) DO NOTHING
    RETURNING id INTO v_debt;
    IF v_debt IS NOT NULL THEN
      PERFORM public.declutter_notify(o.seller_id, 'declutter_refunds', 'Return label added to what you owe',
        format('%s is coming back to you. Its return label cost $%s, which comes out of your next Declutter payout.',
               COALESCE('"' || v_title || '"', 'Your item'), to_char(p_cost_cents / 100.0, 'FM999999990.00')),
        '/declutter?tab=selling');
    END IF;
  ELSE
    PERFORM public.log_cron_defect('declutter_ship_return_label-no-seller', r.order_id::text,
      format('return label %s was bought but the seller of order %s is gone; nobody to bill', r.id, r.order_id));
  END IF;
  IF o.buyer_id IS NOT NULL THEN
    PERFORM public.declutter_notify(o.buyer_id, 'declutter_refunds', 'Send the item back',
      format('Your return label for %s is ready. Print it from your order, tape it to the package and drop it at the post office. You don''t pay for it.',
             COALESCE('"' || v_title || '"', 'your item')),
      '/declutter?tab=buying');
  END IF;
  RETURN 'bought';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_return_label_bought(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_return_label_bought(uuid, text, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_ship_return_label_failed(p_return_id uuid, p_why text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.shipping_return_labels;
BEGIN
  UPDATE public.shipping_return_labels SET state = 'failed', last_error = left(COALESCE(p_why, 'unknown'), 500), updated_at = now()
   WHERE id = p_return_id AND state = 'requested'
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RETURN 'unchanged';
  END IF;
  PERFORM public.log_cron_defect('declutter_ship_return_label-failed', r.order_id::text,
    format('the return label for order %s could not be bought (%s); arrange the return by hand', r.order_id, r.last_error));
  RETURN 'failed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ship_return_label_failed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_ship_return_label_failed(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_my_return_label(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  r public.shipping_return_labels;
BEGIN
  PERFORM public.require_feature('declutter_shipping');
  SELECT x.* INTO r FROM public.shipping_return_labels x JOIN public.declutter_orders o ON o.id = x.order_id
   WHERE x.order_id = p_order_id AND v_uid IS NOT NULL AND o.buyer_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'PT404';
  END IF;
  RETURN jsonb_build_object('state', r.state,
    'label_url', CASE WHEN r.state = 'bought' THEN r.label_url END,
    'tracking_code', CASE WHEN r.state = 'bought' THEN r.tracking_code END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_return_label(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_return_label(uuid) TO authenticated, service_role;
