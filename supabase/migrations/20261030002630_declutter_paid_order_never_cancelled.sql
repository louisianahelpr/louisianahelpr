-- Owner rule (2026-10-29, Q2477): "once they pay it can only be rescheduled once. never cancelled."
--
-- Seller delivery (20261027153244) was the one paid handover that still had a member cancel:
--   * declutter_buyer_cancel_delivery: the buyer cancelled until 24 h before the slot;
--   * declutter_seller_cancel_delivery: the seller cancelled (seller fault, a strike).
-- Both worked ONLY on a paid order (status <> 'paid' raised not_a_seller_delivery), so after this
-- migration both always refuse: auth, the ban check and the membership check stay (so a stranger
-- still learns nothing), then RAISE 'paid_order_not_cancellable'. A problem with a paid order goes
-- through Report a problem (declutter_report_problem), which an admin decides; that path is unchanged.
-- The functions are kept, not dropped, so an app build that still shows the old button gets a plain
-- refusal instead of a missing-function error.
--
-- Restated from prod's EFFECTIVE pg_get_functiondef (read 2026-10-30 00:25Z, read-only SQL):
--   declutter_buyer_cancel_delivery  md5(prosrc) 839fd9dcadbf67a9f77c7d706402deb8 (= the repo text)
--   declutter_seller_cancel_delivery md5(prosrc) 4aec36888ce0e6f27c1b73078dadaa61 (its notice was
--     rewritten in place by 20261027172503; the refusal below keeps none of the old body past the
--     membership checks, so that text is gone either way)
--   declutter_seller_delivery_rules  md5(prosrc) 57a670c48f5b66f28a0f902aebca236e (= the repo text)
-- Codes these bodies no longer raise (problem_open, seller_delivered, cancel_window_closed,
-- not_reschedulable) are listed with this reason in scripts/migration-raise-codes-allowlist.json.
--
-- "Rescheduled once": seller delivery let each side ask for a new time proposals_per_side = 3
-- times. It is now 1 per side (the porch day and the pickup booking already allow one move per
-- side). buyer_cancel_hours is removed from the rules: nothing reads it once the buyer cannot cancel.
-- Prod had 0 declutter_seller_deliveries rows at the read (00:25Z), so no booking already used more
-- than one request.

CREATE OR REPLACE FUNCTION public.declutter_buyer_cancel_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'buyer' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Owner 2026-10-29: the buyer never cancels a paid order; it can be moved once.
  RAISE EXCEPTION 'paid_order_not_cancellable' USING ERRCODE = '55000',
    HINT = 'A paid order can''t be cancelled. You can ask for a new delivery time once, or report a problem.';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buyer_cancel_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buyer_cancel_delivery(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_cancel_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  -- Owner 2026-10-29: the seller never cancels a paid order; it can be moved once.
  RAISE EXCEPTION 'paid_order_not_cancellable' USING ERRCODE = '55000',
    HINT = 'A paid order can''t be cancelled. You can ask for a new delivery time once, or report a problem.';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_cancel_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_cancel_delivery(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'rate_min_cents', 500,                                -- owner 2026-10-22: $5, the raise ruling's floor
    'rate_max_cents', 15000,                              -- owner 2026-10-22: $150, the raise ruling's cap
    'free_rate_cents', 0,                                 -- owner 2026-10-27: a seller may deliver for free
    'free_over_min_cents', 100,                           -- owner 2026-10-27: "free on orders of $X or more", whole dollars
    'free_over_max_cents', 1000000,                       -- the item price cap ($10,000, declutter_items.price_cents)
    'radius_choices_miles', jsonb_build_array(5, 10, 25, 50), -- owner 2026-10-22
    'radius_default_miles', 10,                           -- owner 2026-10-22
    'slot_minutes', 60,                                   -- owner 2026-10-22: 1-hour slots
    'lead_hours', 24,                                     -- owner 2026-10-22: bookable from 24 h ahead
    'horizon_days', 14,                                   -- owner 2026-10-22: up to 14 days out
    'per_slot', 1,                                        -- owner 2026-10-22: one delivery per slot per seller
    'hold_minutes', 35,                                   -- the Stripe page lives 31 min; a little more
    'not_delivered_after_minutes', 15,                    -- owner 2026-10-22: "Not delivered" from slot end + 15 min
    'auto_confirm_hours', 24,                             -- as for porch: 24 h after the photo
    'proposals_per_side', 1,                              -- owner 2026-10-29: rescheduled once, never cancelled
    'reminder_hours', jsonb_build_array(24, 1),           -- the spec: 24 h and 1 h before
    'timezone', 'America/Chicago');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_rules() TO authenticated, service_role;
