-- H3 (Declutter buy audit 11-08, High): "We can't see where buyers drop off or why their payments fail."
-- MEASURED on prod 11-08 (audit): analytics_events_real has no Declutter events of any kind in 7 days; no table stores
-- decline codes or 3D Secure failures; the 11-07 cup attempt left no row at all. Lead calls 11-08: first-party funnel
-- events only, in our own table, no third-party tracker; item view, Buy now tap, checkout opened, returned from
-- Stripe, paid, failed with the Stripe decline code; store NO card data, NO email and NO IP, only the member id or an
-- anonymous device id; a small admin read (count by step over 7 days); decline reasons stored on the attempt.
--
-- 1. public.declutter_funnel_events: one row per step. Columns: step, item_id, order_id, member_id (a signed-in
--    member) XOR device_id (a guest's random per-device id, the one declutter_item_views uses), detail (only a short
--    machine code: 'paid' / 'back' on a return, the Stripe error / decline code on a failure), created_at. RLS on and
--    NO client grant or policy; the functions below are the only way in or out. A member's rows go with their account
--    (ON DELETE CASCADE); an item's or order's rows keep the step with the id set NULL.
-- 2. declutter_orders.last_payment_error_code / last_decline_code / last_payment_failed_at: the attempt's latest
--    failure (Stripe's last_payment_error.code and .decline_code; never a card number, name or email).
-- 3. declutter_funnel_event(step, item, order, device, detail) for anon and authenticated: the four client steps
--    (item_view, buy_now_tap, checkout_opened, returned_from_stripe). Returns nothing, whatever happens (a refusal is
--    never an error a page could show). Never counted: a test account (is_test_member), a test item or order, an
--    order that is not the caller's. A guest must send a device id; a member's is ignored. CAPS (review 11-08): at
--    most 60 events per guest device per hour (the device id is the caller's choice), 5000 per hour for all guests
--    together (rotating ids cannot grow the table without limit), 300 per member per hour.
-- 4. declutter_funnel_server_event(step, order, error_code, decline_code), service_role only and server context
--    only (is_server_context(), the null-uid pattern of 20260915101102): 'paid' and 'payment_failed', from
--    stripe-webhook. A failure also stamps the order's three columns. Test orders write nothing.
-- 5. declutter_funnel_counts(days) for admins only (has_role admin; others 42501): per step (and per detail), the
--    events and the distinct people (member or device) over the last N days (1-90, default 7), test accounts left out.
--
-- MONEY: none (reads and writes no amount). AUTHZ: the client function writes only the caller's own member id (from
-- auth.uid(), never a parameter) or a guest device row; the server function refuses any member or anon caller; the
-- admin read refuses non-admins. REPLAY-SAFE: CREATE TABLE / INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE, grants restated by role name.
-- PGlite proof: src/test/pglite/declutterBuyFunnel.pglite.mjs (3x). Guard: src/test/declutterBuyFunnel.test.ts.

CREATE TABLE IF NOT EXISTS public.declutter_funnel_events (
  id bigserial PRIMARY KEY,
  step text NOT NULL CHECK (step IN ('item_view', 'buy_now_tap', 'checkout_opened', 'returned_from_stripe', 'paid', 'payment_failed')),
  item_id uuid REFERENCES public.declutter_items(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.declutter_orders(id) ON DELETE SET NULL,
  member_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid,
  detail text CHECK (detail IS NULL OR detail ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_funnel_events_one_who CHECK (NOT (member_id IS NOT NULL AND device_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS declutter_funnel_events_created ON public.declutter_funnel_events (created_at);
CREATE INDEX IF NOT EXISTS declutter_funnel_events_device ON public.declutter_funnel_events (device_id, created_at)
  WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS declutter_funnel_events_member ON public.declutter_funnel_events (member_id) WHERE member_id IS NOT NULL;

ALTER TABLE public.declutter_funnel_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_funnel_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_funnel_events TO service_role;
REVOKE ALL ON SEQUENCE public.declutter_funnel_events_id_seq FROM PUBLIC, anon, authenticated;

ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS last_payment_error_code text;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS last_decline_code text;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS last_payment_failed_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_funnel_event(p_step text, p_item_id uuid DEFAULT NULL, p_order_id uuid DEFAULT NULL,
  p_device_id uuid DEFAULT NULL, p_detail text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_device uuid := p_device_id;
  v_item uuid := p_item_id;
  v_order uuid := p_order_id;
  v_detail text;
BEGIN
  IF p_step IS NULL OR p_step NOT IN ('item_view', 'buy_now_tap', 'checkout_opened', 'returned_from_stripe') THEN
    RETURN;
  END IF;
  IF v_uid IS NOT NULL THEN
    IF public.is_test_member(v_uid) THEN
      RETURN;
    END IF;
    v_device := NULL; -- a member is counted by account
    IF (SELECT count(*) FROM public.declutter_funnel_events e
         WHERE e.member_id = v_uid AND e.created_at > now() - interval '1 hour') >= 300 THEN
      RETURN; -- the member cap (review 11-08)
    END IF;
  ELSIF v_device IS NULL THEN
    RETURN;
  ELSIF (SELECT count(*) FROM public.declutter_funnel_events e
          WHERE e.device_id = v_device AND e.created_at > now() - interval '1 hour') >= 60 THEN
    RETURN; -- the guest cap: a device id is the caller's own choice
  ELSIF (SELECT count(*) FROM public.declutter_funnel_events e
          WHERE e.device_id IS NOT NULL AND e.created_at > now() - interval '1 hour') >= 5000 THEN
    RETURN; -- the ceiling for all guests together: rotating device ids cannot grow the table without limit
  END IF;
  IF v_item IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = v_item AND i.is_seed IS NOT TRUE) THEN
      RETURN; -- a test item, or no such item
    END IF;
  END IF;
  IF v_order IS NOT NULL THEN
    -- Only the caller's own order; a guest has none.
    IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_orders o
                                      WHERE o.id = v_order AND o.buyer_id = v_uid AND o.is_seed IS NOT TRUE) THEN
      v_order := NULL;
    END IF;
  END IF;
  v_detail := CASE WHEN p_step = 'returned_from_stripe' AND p_detail IN ('paid', 'back') THEN p_detail END;
  INSERT INTO public.declutter_funnel_events (step, item_id, order_id, member_id, device_id, detail)
  VALUES (p_step, v_item, v_order, v_uid, v_device, v_detail);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_funnel_event(text, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_funnel_event(text, uuid, uuid, uuid, text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.declutter_funnel_event(text, uuid, uuid, uuid, text) IS
  'H3 (audit 11-08): records one client step of the Declutter buy funnel (item_view, buy_now_tap, checkout_opened, returned_from_stripe) for the caller (member id from auth.uid(), or a guest device id). No card data, email or IP. Returns nothing.';

CREATE OR REPLACE FUNCTION public.declutter_funnel_server_event(p_step text, p_order_id uuid, p_error_code text DEFAULT NULL,
  p_decline_code text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_buyer uuid;
  v_item uuid;
  v_err text := CASE WHEN p_error_code ~ '^[a-z0-9_]{1,64}$' THEN p_error_code END;
  v_decline text := CASE WHEN p_decline_code ~ '^[a-z0-9_]{1,64}$' THEN p_decline_code END;
BEGIN
  -- The null-uid pattern (20260915101102): only a trusted server write, never a member or anon request.
  IF NOT public.is_server_context() THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF p_step IS NULL OR p_step NOT IN ('paid', 'payment_failed') OR p_order_id IS NULL THEN
    RETURN;
  END IF;
  SELECT o.buyer_id INTO v_buyer FROM public.declutter_orders o WHERE o.id = p_order_id AND o.is_seed IS NOT TRUE;
  IF NOT FOUND OR (v_buyer IS NOT NULL AND public.is_test_member(v_buyer)) THEN
    RETURN; -- a test order or buyer, or no such order
  END IF;
  SELECT c.item_id INTO v_item FROM public.declutter_cart_items c WHERE c.order_id = p_order_id ORDER BY c.item_id LIMIT 1;
  IF p_step = 'payment_failed' THEN
    UPDATE public.declutter_orders
       SET last_payment_error_code = v_err, last_decline_code = v_decline, last_payment_failed_at = now()
     WHERE id = p_order_id;
  END IF;
  INSERT INTO public.declutter_funnel_events (step, item_id, order_id, member_id, device_id, detail)
  VALUES (p_step, v_item, p_order_id, v_buyer, NULL, CASE WHEN p_step = 'payment_failed' THEN COALESCE(v_decline, v_err, 'unknown') END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_funnel_server_event(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_funnel_server_event(text, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_funnel_counts(p_days integer DEFAULT 7)
RETURNS TABLE(step text, detail text, events integer, people integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 7), 1), 90);
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.step, e.detail, count(*)::integer,
           count(DISTINCT COALESCE(e.member_id, e.device_id))::integer
      FROM public.declutter_funnel_events e
     WHERE e.created_at > now() - make_interval(days => v_days)
       AND (e.member_id IS NULL OR NOT public.is_test_member(e.member_id))
     GROUP BY e.step, e.detail
     ORDER BY array_position(ARRAY['item_view', 'buy_now_tap', 'checkout_opened', 'returned_from_stripe', 'paid', 'payment_failed'], e.step),
              e.detail NULLS FIRST;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_funnel_counts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_funnel_counts(integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.declutter_funnel_counts(integer) IS
  'H3 (audit 11-08): admins only. The Declutter buy funnel over the last N days (1-90, default 7): events and distinct people per step and detail (decline codes on payment_failed), test accounts left out.';
