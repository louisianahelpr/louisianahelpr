-- DECLUTTER: THE SELLER DELIVERS, THE BUYER PICKS A DATE AND TIME
-- (owner request 2026-10-21 night; spec ~/.lh-wt/declutter-seller-delivery-spec.md,
-- mirrored in docs/specs/declutter-seller-delivery.md). Behind the switch
-- 'declutter_seller_delivery', created OFF here.
--
-- What was missing: a seller could not say "I can deliver this myself", so a
-- buyer without a car had only porch pickup, pickup at the door, or a Helpr.
--
-- What this adds (every number is ONE value in declutter_seller_delivery_rules();
-- each was confirmed by the owner on 2026-10-22):
--   1. Seller settings: "I can deliver" (off by default), a flat whole-dollar
--      rate per order, a distance limit, weekly delivery windows and days off.
--      Per item, the seller can switch delivery off (on by default: an item is
--      deliverable unless it is in declutter_item_no_seller_delivery).
--   2. Checkout handover 'seller_delivery' with a chosen 1-hour slot
--      (declutter_start_checkout gains p_slot_start). The slot is HELD for the
--      Stripe page's life (31 min + margin) and becomes the booking when the
--      payment lands (the order-status trigger, so every path that marks an
--      order paid books it). A slot someone else took in the meantime is
--      refused at checkout ("slot_unavailable"); a payment that lands after
--      its hold lapsed AND the slot went to someone else leaves the booking
--      'needs_time' (the buyer picks again; no money moves on its own).
--   3. Range: every item's pickup point (rounded, as Helpr delivery prices it)
--      within the seller's distance of the buyer's geocoded drop-off.
--   4. Money: the rate is part of the ONE order charge (delivery_cents); the
--      buyer's fee is 5% of (items + rate) + 70c, so the card fee on the rate
--      is covered (the shipping rule, owner decision 2 of 2026-10-20) and the
--      seller keeps the whole rate; it is paid to the seller WITH the items at
--      the handover (declutter_payouts.delivery_cents). Seller proceeds are
--      not rounded (the whole-dollar ruling covers Helpr payouts only).
--      Refunds: seller cancels / does not deliver -> everything back, delivery
--      included, the seller pays the card fee (full_seller_pays_fee); the buyer
--      cancels for their own reason until 24 h before the slot -> everything
--      back except the card fee (keep_card_fee, owner 2026-10-22), after that
--      Report a problem; the rate is never refunded on its own
--      (declutter_delivery_refund refuses it).
--   5. After payment: the buyer's address reaches the seller only then. The
--      buyer chose at booking (owner 2026-10-22) "Leave it at my door" (the
--      seller's "Delivered" needs a photo, confirmed like porch) or "Hand it to
--      me" (the seller's "Handed over", photo optional); then the buyer's "I
--      got it" (existing confirm) or the 24 h auto-pay after the seller's mark;
--      a "Hand it to me" nobody answered is Report a problem (the admin
--      decides). Reminders 24 h and 1 h before; either side proposes a new
--      time, the other accepts.
--
--   6. FREE DELIVERY (owner 2026-10-27): the rate may be $0 ("Free delivery"),
--      and a paid rate may carry "Free delivery on orders of $X or more"
--      (free_over_cents, whole dollars). X is the order's items total from that
--      seller before fees (every in-cart line of the one order, so a several-item
--      order counts whole). Below X the rate applies. One pure rule,
--      declutter_seller_delivery_rate_cents(rate, free_over, items), used by the
--      check that checkout and the offer both read; the order freezes the rate it
--      charged. A free delivery carries no delivery charge, so the buyer's fee is
--      5% of the items + 70c (the same fee rule with a 0 rate) and the seller's
--      payout is the items alone. Every refund and seller-fault rule is unchanged
--      with a $0 rate (proven in the PGlite proof). Caps for a PAID rate stay $5-$150.
--
-- Restated, each from its NEWEST definition on main + board 141d
-- (origin/ready/declutter-refund-requests, 20261026155251, not deployed yet; the
-- PGlite proof replays every migration in order and checks each body):
--   declutter_orders_fee_rule_f1        20261015023613
--   declutter_start_checkout            20261026154738  (Q2352 setup fee kept)
--   declutter_complete_handover         20261026155251  (141d: paid once the sale is final; kept)
--   declutter_bookings_not_delivery     20261017055505
--   declutter_delivery_refund           20261017055505
--   declutter_address_access            20261015042253
--   declutter_handover_sweep            20261018183715
--   declutter_rebook_payout             20261026155251  (141d; + the seller's rate)
--   declutter_refund_after_handover     20261026155251  (141d; a full refund undoes the rate too)
--   declutter_payouts_amount / declutter_payouts_refunded CHECKs  20261026155251
-- NOT restated (they already do the right thing for 'seller_delivery', proven
-- in the PGlite proof): declutter_mark_order_paid, declutter_close_paid_order,
-- declutter_record_refund, declutter_delivery_reserved_cents (0 on an order
-- with no Helpr task and no delivery refund, so a refund is the whole order),
-- declutter_confirm_handover, declutter_orders_fee_rule_frozen,
-- declutter_full_refund_cents.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS / ON CONFLICT.
-- Grants by role name, REVOKE ... FROM PUBLIC, anon. Applied 3x by
-- src/test/pglite/declutterSellerDelivery.pglite.mjs.

-- ---------------------------------------------------------------------------
-- 1. The switch: testers only (owner 2026-10-27, via the lead: it ships for
--    testers and opens with the Declutter launch, owner 2026-10-22; opening it
--    is the owner's flip in Admin -> Settings, never a migration).
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_seller_delivery', 'testers',
        'Declutter: the seller delivers for a flat rate and the buyer picks a date and time at checkout.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The rules: ONE place for every number (the app reads them from
--    declutter_my_seller_delivery / declutter_seller_delivery_offer; its
--    mirror src/lib/declutter/sellerDelivery.ts is pinned to this text by
--    src/test/declutterSellerDelivery.test.ts).
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
    'proposals_per_side', 3,                              -- owner 2026-10-22: new-time requests per side
    'buyer_cancel_hours', 24,                             -- owner 2026-10-22: the buyer cancels until 24 h before
    'reminder_hours', jsonb_build_array(24, 1),           -- the spec: 24 h and 1 h before
    'timezone', 'America/Chicago');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_rules() TO authenticated, service_role;

-- The buyer's fee on a seller-delivered order counts the rate (the shipping
-- rule; owner 2026-10-22): 5% of (items + rate) + 70c, once per order.
CREATE OR REPLACE FUNCTION public.declutter_buyer_fee_cents_seller_delivery(p_items_cents integer, p_delivery_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT round((greatest(COALESCE(p_items_cents, 0), 0) + greatest(COALESCE(p_delivery_cents, 0), 0)) * 0.05)::integer + 70;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buyer_fee_cents_seller_delivery(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buyer_fee_cents_seller_delivery(integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Tables. No client privilege on any of them: members read and write
--    through the RPCs below (the buyer's address must never reach the seller
--    before payment).

-- The seller's "I can deliver" setting.
CREATE TABLE IF NOT EXISTS public.declutter_seller_delivery (
  seller_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  -- 0 = free delivery (owner 2026-10-27); a paid rate is whole dollars inside the rules' caps.
  rate_cents integer NOT NULL CHECK (rate_cents >= 0 AND rate_cents % 100 = 0),
  radius_miles integer NOT NULL CHECK (radius_miles BETWEEN 1 AND 100),
  -- "Free delivery on orders of $X or more" (owner 2026-10-27): only with a paid rate.
  free_over_cents integer CHECK (free_over_cents IS NULL OR (free_over_cents > 0 AND free_over_cents % 100 = 0)),
  CONSTRAINT declutter_seller_delivery_free_over_needs_rate CHECK (free_over_cents IS NULL OR rate_cents > 0),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.declutter_seller_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_seller_delivery FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_seller_delivery TO service_role;

-- Weekly delivery windows, Louisiana local time (several per day OK).
CREATE TABLE IF NOT EXISTS public.declutter_delivery_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  starts_local time NOT NULL,
  ends_local time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_delivery_windows_order CHECK (ends_local > starts_local),
  CONSTRAINT declutter_delivery_windows_key UNIQUE (seller_id, weekday, starts_local)
);
ALTER TABLE public.declutter_delivery_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_delivery_windows FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_delivery_windows TO service_role;

-- Days off (local dates with no delivery).
CREATE TABLE IF NOT EXISTS public.declutter_delivery_days_off (
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, day)
);
ALTER TABLE public.declutter_delivery_days_off ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_delivery_days_off FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_delivery_days_off TO service_role;

-- Per item: deliverable unless the seller switched it off here (on by default).
CREATE TABLE IF NOT EXISTS public.declutter_item_no_seller_delivery (
  item_id uuid PRIMARY KEY REFERENCES public.declutter_items(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_item_no_seller_delivery_seller_idx ON public.declutter_item_no_seller_delivery (seller_id);
ALTER TABLE public.declutter_item_no_seller_delivery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_item_no_seller_delivery FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_item_no_seller_delivery TO service_role;

-- One per seller-delivered order: the slot (held, then booked), the frozen
-- drop-off, a proposed new time, the reminders sent.
--   held        checkout started; counts against the slot until held_until
--   booked      paid; the slot is the order's
--   needs_time  paid, but the slot went to someone else after the hold lapsed
--   released    the checkout ended unpaid (superseded / expired)
--   cancelled   the order was refunded
--   done        the handover is done
CREATE TABLE IF NOT EXISTS public.declutter_seller_deliveries (
  order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('held', 'booked', 'needs_time', 'released', 'cancelled', 'done')),
  slot_start timestamptz,
  slot_end timestamptz,
  held_until timestamptz,
  dropoff_address text NOT NULL CHECK (char_length(btrim(dropoff_address)) BETWEEN 5 AND 300),
  dropoff_area text NOT NULL,
  dropoff_lat numeric NOT NULL CHECK (dropoff_lat BETWEEN -90 AND 90),
  dropoff_lng numeric NOT NULL CHECK (dropoff_lng BETWEEN -180 AND 180),
  -- Owner 2026-10-22: the buyer's choice at booking. 'leave' = leave it at the
  -- door with a photo (confirms like porch); 'hand' = hand it to me.
  handoff text NOT NULL DEFAULT 'leave' CHECK (handoff IN ('leave', 'hand')),
  proposed_start timestamptz,
  proposed_by text CHECK (proposed_by IS NULL OR proposed_by IN ('buyer', 'seller')),
  proposed_at timestamptz,
  buyer_proposals smallint NOT NULL DEFAULT 0 CHECK (buyer_proposals >= 0),
  seller_proposals smallint NOT NULL DEFAULT 0 CHECK (seller_proposals >= 0),
  reminded_hours integer[] NOT NULL DEFAULT '{}',
  -- The seller's "Delivered" / "Handed over" (its photo, when there is one, is on declutter_handovers).
  delivered_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_seller_deliveries_slot CHECK ((slot_start IS NULL) = (slot_end IS NULL)
                                                    AND (slot_start IS NULL OR slot_end > slot_start)),
  CONSTRAINT declutter_seller_deliveries_has_slot CHECK (status NOT IN ('held', 'booked') OR slot_start IS NOT NULL),
  CONSTRAINT declutter_seller_deliveries_hold CHECK (status <> 'held' OR held_until IS NOT NULL),
  CONSTRAINT declutter_seller_deliveries_proposal CHECK ((proposed_start IS NULL) = (proposed_by IS NULL)),
  CONSTRAINT declutter_seller_deliveries_not_own CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_seller_deliveries_slot_idx ON public.declutter_seller_deliveries (seller_id, slot_start)
  WHERE status IN ('held', 'booked');
CREATE INDEX IF NOT EXISTS declutter_seller_deliveries_buyer_idx ON public.declutter_seller_deliveries (buyer_id);
CREATE INDEX IF NOT EXISTS declutter_seller_deliveries_due_idx ON public.declutter_seller_deliveries (slot_start)
  WHERE status = 'booked';
ALTER TABLE public.declutter_seller_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_seller_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_seller_deliveries TO service_role;

-- is_seed: the setting from the seller's profile, the delivery from its order.
CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT p.is_seed FROM public.profiles p WHERE p.user_id = NEW.seller_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_seller_delivery_seed ON public.declutter_seller_delivery;
CREATE TRIGGER trg_declutter_seller_delivery_seed BEFORE INSERT ON public.declutter_seller_delivery
  FOR EACH ROW EXECUTE FUNCTION public.declutter_seller_delivery_seed();
DROP TRIGGER IF EXISTS trg_declutter_seller_deliveries_seed ON public.declutter_seller_deliveries;
CREATE TRIGGER trg_declutter_seller_deliveries_seed BEFORE INSERT ON public.declutter_seller_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.declutter_order_rows_seed();
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 4. Orders and payouts carry the rate.
-- DESTRUCTIVE-DDL-ACK: declutter_orders_handover_check, declutter_orders_delivery,
-- declutter_orders_fee_rule, declutter_orders_premium_rule, declutter_payouts_amount
-- and declutter_payouts_refunded
-- ACK-REASON: each CHECK is dropped only to be re-added in the same block with
--   'seller_delivery' / fee rule 'f1_seller_delivery' / declutter_payouts.delivery_cents
--   in it; every existing row (no 'seller_delivery' order exists, delivery_cents = 0 on
--   every payout) satisfies the new CHECK, which only ever allows one more case.
--   The payout CHECKs keep 141d's refunded_cents (20261026155251) exactly.
-- ACK-DATA-LOSS: none; no column, table or row is dropped.
ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS delivery_cents integer NOT NULL DEFAULT 0;
DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_handover_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_handover_check
    CHECK (handover IN ('pickup_home', 'porch', 'delivery', 'seller_delivery'));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_delivery;
  -- A Helpr delivery carries its fee (>= $10); a seller delivery a whole-dollar rate: 0 when
  -- free, else inside the rules' $5-$150 (declutter_seller_delivery_rules; lh-money-escrow note 5).
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_delivery
    CHECK (delivery_cents >= 0 AND (handover <> 'delivery' OR delivery_cents >= 1000)
           AND (handover <> 'seller_delivery'
                OR (delivery_cents % 100 = 0 AND (delivery_cents = 0 OR delivery_cents BETWEEN 500 AND 15000))));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_fee_rule;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_fee_rule
    CHECK (fee_rule IN ('premium15', 'f1', 'f1_ship', 'f1_seller_delivery'));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_premium_rule;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_premium_rule CHECK (
    (fee_rule = 'f1' AND shipping_cents = 0 AND premium_cents = round(items_cents * 0.05)::integer + 70)
    OR (fee_rule = 'f1_ship' AND shipping_cents > 0
        AND premium_cents = round((items_cents + shipping_cents) * 0.05)::integer + 70)
    OR (fee_rule = 'f1_seller_delivery' AND shipping_cents = 0 AND handover = 'seller_delivery'
        AND premium_cents = round((items_cents + delivery_cents) * 0.05)::integer + 70)
    OR (fee_rule = 'premium15' AND shipping_cents = 0
        AND premium_cents = greatest(round(items_cents * 0.15)::integer, 100)));
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_delivery;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_delivery CHECK (delivery_cents >= 0);
  -- 141d's rule (20261026155251) with the seller's rate: items + rate - refunded - debt.
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_amount;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_amount
    CHECK (amount_cents = items_cents + delivery_cents - refunded_cents - debt_cents AND amount_cents >= 0);
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_refunded;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_refunded
    CHECK (refunded_cents BETWEEN 0 AND items_cents + delivery_cents);
END
$do$;
GRANT SELECT (delivery_cents) ON TABLE public.declutter_payouts TO authenticated;

-- Every NEW order's fee rule, whatever a caller passes (restated from
-- 20261015023613): a seller-delivered order is on 'f1_seller_delivery'.
CREATE OR REPLACE FUNCTION public.declutter_orders_fee_rule_f1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.fee_rule := CASE WHEN NEW.handover = 'seller_delivery' THEN 'f1_seller_delivery' ELSE 'f1' END;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_orders_fee_rule_f1() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Internals (service only).

-- Every slot start of a seller's schedule in [p_from, p_to]: each window,
-- each local day, stepped by the slot length, days off removed.
CREATE OR REPLACE FUNCTION public.declutter_delivery_slot_starts(p_seller uuid, p_from timestamptz, p_to timestamptz)
RETURNS SETOF timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  WITH r AS (SELECT make_interval(mins => (public.declutter_seller_delivery_rules() ->> 'slot_minutes')::integer) AS len,
                    public.declutter_seller_delivery_rules() ->> 'timezone' AS tz)
  SELECT DISTINCT g.s
    FROM r
    CROSS JOIN LATERAL generate_series((p_from AT TIME ZONE r.tz)::date::timestamp,
                                       (p_to AT TIME ZONE r.tz)::date::timestamp, interval '1 day') AS d(day)
    JOIN public.declutter_delivery_windows w
      ON w.seller_id = p_seller AND w.weekday = extract(dow FROM d.day)::smallint
    CROSS JOIN LATERAL generate_series((d.day::date + w.starts_local) AT TIME ZONE r.tz,
                                       ((d.day::date + w.ends_local) AT TIME ZONE r.tz) - r.len, r.len) AS g(s)
   WHERE p_seller IS NOT NULL AND g.s >= p_from AND g.s <= p_to
     AND NOT EXISTS (SELECT 1 FROM public.declutter_delivery_days_off x
                      WHERE x.seller_id = p_seller AND x.day = d.day::date)
   ORDER BY g.s;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_slot_starts(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_slot_starts(uuid, timestamptz, timestamptz) TO service_role;

-- How many OTHER orders hold or have booked this slot (a lapsed hold does not count).
CREATE OR REPLACE FUNCTION public.declutter_delivery_slot_used(p_seller uuid, p_start timestamptz, p_except_order uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT count(*)::integer FROM public.declutter_seller_deliveries d
   WHERE d.seller_id = p_seller AND d.slot_start = p_start
     AND d.order_id IS DISTINCT FROM p_except_order
     AND (d.status = 'booked' OR (d.status = 'held' AND d.held_until > now()));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_slot_used(uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_slot_used(uuid, timestamptz, uuid) TO service_role;

-- The open slots a buyer may pick: lead_hours ahead to horizon_days out,
-- under the per-slot limit. p_except_order's own hold does not count (the
-- buyer coming back to their own open checkout still sees their time).
CREATE OR REPLACE FUNCTION public.declutter_delivery_open_slots(p_seller uuid, p_except_order uuid)
RETURNS SETOF timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT s FROM public.declutter_delivery_slot_starts(p_seller,
           now() + make_interval(hours => (public.declutter_seller_delivery_rules() ->> 'lead_hours')::integer),
           now() + make_interval(days => (public.declutter_seller_delivery_rules() ->> 'horizon_days')::integer)) s
   WHERE public.declutter_delivery_slot_used(p_seller, s, p_except_order)
         < (public.declutter_seller_delivery_rules() ->> 'per_slot')::integer;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_open_slots(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_open_slots(uuid, uuid) TO service_role;

-- Can this seller deliver these cart lines to this buyer? reason NULL = yes.
--   seller_not_delivering  setting off, missing, or a rate outside today's caps
--   item_not_deliverable   an item the seller switched off, or with no pickup point
--   address_needed         no drop-off geocoded for this seller in the last 24 h
--   out_of_range           an item's pickup point is farther than the seller goes
-- Range is measured from the ROUNDED pickup point (2 decimals, ~1 km), as
-- Helpr delivery prices it, and only yes/no reaches the buyer: no distance an
-- address-probing buyer could use to find the seller's home.
-- The rate a buyer pays for one order (owner 2026-10-27): 0 when the seller
-- delivers free, 0 when the order's items total (before fees) reaches the
-- seller's free-delivery amount, else the seller's rate.
CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_rate_cents(p_rate_cents integer, p_free_over_cents integer, p_items_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN COALESCE(p_rate_cents, 0) <= 0 THEN 0
              WHEN p_free_over_cents IS NOT NULL AND COALESCE(p_items_cents, 0) >= p_free_over_cents THEN 0
              ELSE p_rate_cents END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_rate_cents(integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_rate_cents(integer, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_check(p_buyer uuid, p_seller uuid, p_lines uuid[])
RETURNS TABLE (reason text, rate_cents integer, radius_miles integer, dropoff_address text, dropoff_area text,
               dropoff_lat numeric, dropoff_lng numeric, base_rate_cents integer, free_over_cents integer, items_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  s public.declutter_seller_delivery;
  d public.declutter_delivery_dropoffs;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_far integer;
  v_unplaced boolean;
  v_items integer;
  v_rate integer;
BEGIN
  SELECT * INTO s FROM public.declutter_seller_delivery x WHERE x.seller_id = p_seller;
  -- A setting outside the rules (a rate the caps no longer allow) offers nothing; $0 is free delivery.
  IF NOT FOUND OR NOT s.enabled
     OR NOT (s.rate_cents = (v_rules ->> 'free_rate_cents')::integer
             OR s.rate_cents BETWEEN (v_rules ->> 'rate_min_cents')::integer AND (v_rules ->> 'rate_max_cents')::integer) THEN
    RETURN QUERY SELECT 'seller_not_delivering'::text, NULL::integer, NULL::integer, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        NULL::integer, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  -- The order's items total from this seller, before fees: every line of the one order (owner 2026-10-27).
  SELECT COALESCE(sum(c.price_cents), 0)::integer INTO v_items FROM public.declutter_cart_items c WHERE c.id = ANY (p_lines);
  v_rate := public.declutter_seller_delivery_rate_cents(s.rate_cents, s.free_over_cents, v_items);
  IF p_lines IS NULL OR cardinality(p_lines) = 0 OR EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_item_no_seller_delivery n ON n.item_id = c.item_id
        WHERE c.id = ANY (p_lines)) THEN
    RETURN QUERY SELECT 'item_not_deliverable'::text, v_rate, s.radius_miles, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  SELECT * INTO d FROM public.declutter_delivery_dropoffs x WHERE x.buyer_id = p_buyer AND x.seller_id = p_seller;
  IF NOT FOUND OR d.geocoded_at < now() - interval '24 hours' THEN
    RETURN QUERY SELECT 'address_needed'::text, v_rate, s.radius_miles, NULL::text, NULL::text, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  SELECT bool_or(p.pickup_lat IS NULL OR p.pickup_lng IS NULL),
         max(public.declutter_road_miles(round(p.pickup_lat, 2), round(p.pickup_lng, 2), d.lat, d.lng))
    INTO v_unplaced, v_far
    FROM public.declutter_cart_items c
    LEFT JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.id = ANY (p_lines);
  IF v_unplaced IS NOT FALSE OR v_far IS NULL THEN
    RETURN QUERY SELECT 'item_not_deliverable'::text, v_rate, s.radius_miles, NULL::text, d.area_label, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  IF v_far > s.radius_miles THEN
    RETURN QUERY SELECT 'out_of_range'::text, v_rate, s.radius_miles, NULL::text, d.area_label, NULL::numeric, NULL::numeric,
                        s.rate_cents, s.free_over_cents, v_items;
    RETURN;
  END IF;
  RETURN QUERY SELECT NULL::text, v_rate, s.radius_miles, d.address, d.area_label, d.lat, d.lng,
                      s.rate_cents, s.free_over_cents, v_items;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_check(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_check(uuid, uuid, uuid[]) TO service_role;

-- The local time words used in notices ("Sat Oct 25 at 2:00 PM").
CREATE OR REPLACE FUNCTION public.declutter_delivery_when(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT to_char(p_at AT TIME ZONE (public.declutter_seller_delivery_rules() ->> 'timezone'), 'Dy Mon FMDD at FMHH12:MI AM');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_when(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_when(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. The seller's settings (member RPCs; the switch is required: new work).

CREATE OR REPLACE FUNCTION public.declutter_my_seller_delivery()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rules jsonb := public.declutter_seller_delivery_rules();
  s public.declutter_seller_delivery;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  SELECT * INTO s FROM public.declutter_seller_delivery x WHERE x.seller_id = v_uid;
  RETURN jsonb_build_object(
    'enabled', COALESCE(s.enabled, false),
    'rate_cents', s.rate_cents,
    'free_over_cents', s.free_over_cents,
    'radius_miles', COALESCE(s.radius_miles, (v_rules ->> 'radius_default_miles')::integer),
    'windows', COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday', w.weekday, 'starts', to_char(w.starts_local, 'HH24:MI'),
                                                             'ends', to_char(w.ends_local, 'HH24:MI'))
                                          ORDER BY w.weekday, w.starts_local)
                           FROM public.declutter_delivery_windows w WHERE w.seller_id = v_uid), '[]'::jsonb),
    'days_off', COALESCE((SELECT jsonb_agg(x.day ORDER BY x.day) FROM public.declutter_delivery_days_off x
                           WHERE x.seller_id = v_uid
                             AND x.day >= (now() AT TIME ZONE (v_rules ->> 'timezone'))::date), '[]'::jsonb),
    'items_off', COALESCE((SELECT jsonb_agg(n.item_id ORDER BY n.created_at) FROM public.declutter_item_no_seller_delivery n
                            WHERE n.seller_id = v_uid), '[]'::jsonb),
    'rules', v_rules);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_seller_delivery() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_seller_delivery() TO authenticated, service_role;

-- "I can deliver": on/off, the rate ($0 = free, or whole dollars inside the caps), the distance (one of
-- the choices) and, with a paid rate, "free on orders of $X or more". The 3-argument door of the
-- unlanded first draft is dropped so no caller can reach an ambiguous overload.
DROP FUNCTION IF EXISTS public.declutter_set_seller_delivery(boolean, integer, integer);
CREATE OR REPLACE FUNCTION public.declutter_set_seller_delivery(p_enabled boolean, p_rate_cents integer, p_radius_miles integer,
  p_free_over_cents integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_rules jsonb := public.declutter_seller_delivery_rules();
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_delivery_setting' USING ERRCODE = '22023';
  END IF;
  -- $0 is free delivery (owner 2026-10-27); a paid rate keeps the caps.
  IF p_rate_cents IS NULL OR p_rate_cents % 100 <> 0
     OR NOT (p_rate_cents = (v_rules ->> 'free_rate_cents')::integer
             OR p_rate_cents BETWEEN (v_rules ->> 'rate_min_cents')::integer AND (v_rules ->> 'rate_max_cents')::integer) THEN
    RAISE EXCEPTION 'invalid_delivery_rate' USING ERRCODE = '22023',
      HINT = format('Deliver for free, or pick a whole-dollar rate from $%s to $%s.', (v_rules ->> 'rate_min_cents')::integer / 100,
                    (v_rules ->> 'rate_max_cents')::integer / 100);
  END IF;
  -- "Free on orders of $X or more": whole dollars, and only with a paid rate (free is already free).
  IF p_free_over_cents IS NOT NULL AND (p_rate_cents = 0 OR p_free_over_cents % 100 <> 0
     OR p_free_over_cents NOT BETWEEN (v_rules ->> 'free_over_min_cents')::integer AND (v_rules ->> 'free_over_max_cents')::integer) THEN
    RAISE EXCEPTION 'invalid_free_delivery_amount' USING ERRCODE = '22023',
      HINT = format('Pick a whole-dollar amount from $%s to $%s, or leave it off.', (v_rules ->> 'free_over_min_cents')::integer / 100,
                    (v_rules ->> 'free_over_max_cents')::integer / 100);
  END IF;
  IF p_radius_miles IS NULL OR NOT (v_rules -> 'radius_choices_miles') @> to_jsonb(p_radius_miles) THEN
    RAISE EXCEPTION 'invalid_delivery_distance' USING ERRCODE = '22023', HINT = 'Pick one of the distances shown.';
  END IF;
  INSERT INTO public.declutter_seller_delivery (seller_id, enabled, rate_cents, radius_miles, free_over_cents)
  VALUES (v_uid, p_enabled, p_rate_cents, p_radius_miles, p_free_over_cents)
  ON CONFLICT (seller_id) DO UPDATE SET enabled = EXCLUDED.enabled, rate_cents = EXCLUDED.rate_cents,
    radius_miles = EXCLUDED.radius_miles, free_over_cents = EXCLUDED.free_over_cents, updated_at = now();
  RETURN public.declutter_my_seller_delivery();
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_seller_delivery(boolean, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_seller_delivery(boolean, integer, integer, integer) TO authenticated, service_role;

-- Replace the weekly windows and the days off. p_windows: a JSON array of
-- {"weekday": 0-6, "starts": "HH:MM", "ends": "HH:MM"}, 0 to 28 of them, each
-- at least one slot long. p_days_off: local dates from today up to a year out
-- (at most 60; past ones are dropped). A booking already made keeps its time.
CREATE OR REPLACE FUNCTION public.declutter_set_delivery_schedule(p_windows jsonb, p_days_off date[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_today date;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  v_today := (now() AT TIME ZONE (v_rules ->> 'timezone'))::date;
  IF p_windows IS NULL OR jsonb_typeof(p_windows) <> 'array' OR jsonb_array_length(p_windows) > 28 THEN
    RAISE EXCEPTION 'invalid_delivery_windows' USING ERRCODE = '22023', HINT = 'Give up to 28 delivery times.';
  END IF;
  IF p_days_off IS NOT NULL AND (cardinality(p_days_off) > 60
     OR EXISTS (SELECT 1 FROM unnest(p_days_off) x WHERE x IS NULL OR x > v_today + 366)) THEN
    RAISE EXCEPTION 'invalid_days_off' USING ERRCODE = '22023', HINT = 'Pick up to 60 days off within the next year.';
  END IF;
  DELETE FROM public.declutter_delivery_windows WHERE seller_id = v_uid;
  BEGIN
    INSERT INTO public.declutter_delivery_windows (seller_id, weekday, starts_local, ends_local)
    SELECT v_uid, (w ->> 'weekday')::smallint, (w ->> 'starts')::time, (w ->> 'ends')::time
      FROM jsonb_array_elements(p_windows) AS w;
  EXCEPTION WHEN check_violation OR not_null_violation OR unique_violation
              OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_delivery_windows' USING ERRCODE = '22023',
      HINT = 'Each delivery time needs a day and a start before its end, with no repeats.';
  END;
  IF EXISTS (SELECT 1 FROM public.declutter_delivery_windows w WHERE w.seller_id = v_uid
               AND w.ends_local - w.starts_local < make_interval(mins => (v_rules ->> 'slot_minutes')::integer)) THEN
    RAISE EXCEPTION 'invalid_delivery_windows' USING ERRCODE = '22023',
      HINT = format('Each delivery time must be at least %s minutes long.', v_rules ->> 'slot_minutes');
  END IF;
  DELETE FROM public.declutter_delivery_days_off WHERE seller_id = v_uid;
  INSERT INTO public.declutter_delivery_days_off (seller_id, day)
  SELECT DISTINCT v_uid, x FROM unnest(COALESCE(p_days_off, '{}'::date[])) x WHERE x >= v_today;
  RETURN public.declutter_my_seller_delivery();
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_delivery_schedule(jsonb, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_delivery_schedule(jsonb, date[]) TO authenticated, service_role;

-- Per item: switch seller delivery off (too heavy) or back on.
CREATE OR REPLACE FUNCTION public.declutter_set_item_seller_delivery(p_item_id uuid, p_on boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_item_id IS NULL OR p_on IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.declutter_items i WHERE i.id = p_item_id AND i.seller_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_on THEN
    DELETE FROM public.declutter_item_no_seller_delivery WHERE item_id = p_item_id;
  ELSE
    INSERT INTO public.declutter_item_no_seller_delivery (item_id, seller_id) VALUES (p_item_id, v_uid)
    ON CONFLICT (item_id) DO NOTHING;
  END IF;
  RETURN p_on;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_item_seller_delivery(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_item_seller_delivery(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The buyer's offer for their cart with one seller: is seller delivery
--    available, the rate, and the open times. Answers ONLY a buyer with
--    in-cart lines from that seller (the cart first, as checkout does: no
--    schedule or "is this seller out" oracle on an arbitrary id).
CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_offer(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_lines uuid[];
  v_rules jsonb := public.declutter_seller_delivery_rules();
  c record;
  v_open uuid;
  v_held timestamptz;
  v_slots timestamptz[] := '{}';
  v_reason text;
BEGIN
  PERFORM public.require_feature('declutter');
  PERFORM public.require_feature('declutter_seller_delivery');
  v_uid := public.declutter_assert_member(false);
  IF p_seller_id IS NULL OR p_seller_id = v_uid THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_lines := ARRAY(SELECT x.id FROM public.declutter_cart_items x
                    WHERE x.buyer_id = v_uid AND x.seller_id = p_seller_id AND x.status = 'in_cart'
                      AND x.checkout_by > now() ORDER BY x.id);
  IF cardinality(v_lines) = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
  SELECT o.id INTO v_open FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment';
  SELECT d.slot_start INTO v_held FROM public.declutter_seller_deliveries d
   WHERE d.order_id = v_open AND d.status = 'held' AND d.held_until > now();
  IF c.reason IS NULL THEN
    v_slots := ARRAY(SELECT s FROM public.declutter_delivery_open_slots(p_seller_id, v_open) s);
  END IF;
  v_reason := COALESCE(c.reason, CASE WHEN cardinality(v_slots) = 0 THEN 'no_times' END);
  RETURN jsonb_build_object(
    'available', v_reason IS NULL,
    'reason', v_reason,
    -- What this order pays (0 = free) and why: the seller's rate, their free-delivery amount,
    -- and this order's items total from the seller (owner 2026-10-27).
    'rate_cents', c.rate_cents,
    'base_rate_cents', c.base_rate_cents,
    'free_over_cents', c.free_over_cents,
    'items_cents', c.items_cents,
    'radius_miles', c.radius_miles,
    'dropoff_area', c.dropoff_area,
    'slot_minutes', (v_rules ->> 'slot_minutes')::integer,
    'slots', to_jsonb(v_slots),
    'held_slot', v_held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_offer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_offer(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Checkout, restated from 20261026154738 (its newest definition, Q2352's setup fee kept) with
--    'seller_delivery' and p_slot_start. A new argument, so the old
--    signature is dropped first (the edge function names its arguments; the
--    third defaults to NULL, so an older edge build still calls it).
--    For 'seller_delivery': the switch, the check above (setting, items,
--    address, range), the slot among the open ones; the rate frozen as
--    delivery_cents, the fee on items + rate; the slot HELD for the page's
--    life, under a lock on the seller's setting row so two buyers cannot
--    take the last place in one slot. The idempotent return also compares
--    the slot and needs the hold still live.
DROP FUNCTION IF EXISTS public.declutter_start_checkout(uuid, text);
DROP FUNCTION IF EXISTS public.declutter_start_checkout(uuid, text, timestamptz);
CREATE OR REPLACE FUNCTION public.declutter_start_checkout(p_seller_id uuid, p_handover text, p_slot_start timestamptz DEFAULT NULL,
  p_handoff text DEFAULT NULL)
RETURNS TABLE (order_id uuid, items_cents integer, premium_cents integer, tax_cents integer,
               total_cents integer, superseded_session_id text, checkout_session_id text, delivery_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_items integer;
  v_premium integer;
  v_order uuid;
  v_old_session text;
  v_n integer;
  v_lines uuid[];
  v_existing record;
  v_delivery integer := 0;
  v_setup integer := 0;
  v_dropoff_key text;
  q record;
  sd record;
  v_sd_dropoff text;
  v_rules jsonb := public.declutter_seller_delivery_rules();
BEGIN
  -- Row 62 (B44): no require_feature here. Nothing NEW can start without the
  -- switch (offer, Buy and accept all require it); a line already in the cart
  -- is a sale already agreed, and checkout below needs one.
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  v_uid := public.declutter_assert_member(true);
  IF p_handover IS NULL OR p_handover NOT IN ('pickup_home', 'porch', 'delivery', 'seller_delivery') THEN
    RAISE EXCEPTION 'handover_unavailable' USING ERRCODE = '22023',
      HINT = 'Choose porch pickup, pickup at the seller''s home, delivery by the seller, or Helpr delivery.';
  END IF;
  -- Slice 5: delivery is new work for a Helpr, so it needs the switch (row 62:
  -- a member the switch is off for can still finish with a pickup).
  IF p_handover = 'delivery' THEN
    PERFORM public.require_feature('declutter');
  END IF;
  -- Seller delivery is new work for the seller: both switches. The buyer says
  -- how they want it: left at the door or handed to them (owner 2026-10-22).
  IF p_handover = 'seller_delivery' THEN
    PERFORM public.require_feature('declutter');
    PERFORM public.require_feature('declutter_seller_delivery');
    IF p_handoff IS NULL OR p_handoff NOT IN ('leave', 'hand') THEN
      RAISE EXCEPTION 'invalid_handoff' USING ERRCODE = '22023',
        HINT = 'Choose "Leave it at my door" or "Hand it to me".';
    END IF;
  ELSE
    p_slot_start := NULL;
    p_handoff := NULL;
  END IF;

  -- Lock order: items -> orders -> lines.
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c
                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart')
   ORDER BY i.id FOR UPDATE;
  SELECT o.id, o.handover, o.stripe_checkout_session_id, o.items_cents, o.premium_cents, o.tax_cents, o.total_cents,
         o.delivery_cents, o.setup_fee_cents,
         (SELECT od.dropoff_address || '|' || od.road_miles FROM public.declutter_order_deliveries od WHERE od.order_id = o.id) AS dropoff_key,
         (SELECT x.slot_start FROM public.declutter_seller_deliveries x
           WHERE x.order_id = o.id AND x.status = 'held' AND x.held_until > now()) AS held_slot,
         (SELECT x.dropoff_address FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id) AS sd_dropoff,
         ARRAY(SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'in_cart' ORDER BY c.id) AS lines
    INTO v_existing
    FROM public.declutter_orders o
   WHERE o.buyer_id = v_uid AND o.seller_id = p_seller_id AND o.status = 'awaiting_payment'
   FOR UPDATE;
  PERFORM 1 FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
   ORDER BY c.item_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(c.price_cents), 0), ARRAY(SELECT c2.id FROM public.declutter_cart_items c2
           WHERE c2.buyer_id = v_uid AND c2.seller_id = p_seller_id AND c2.status = 'in_cart'
             AND c2.checkout_by > now() ORDER BY c2.id)
    INTO v_n, v_items, v_lines
    FROM public.declutter_cart_items c
   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id AND c.status = 'in_cart'
     AND c.checkout_by > now();
  -- The caller's own cart first: an empty cart says nothing about the seller
  -- (no ban / strike / tax-flag oracle on an arbitrary id).
  IF v_n = 0 THEN
    RAISE EXCEPTION 'cart_empty' USING ERRCODE = '55000', HINT = 'Nothing from this seller is waiting for checkout.';
  END IF;
  -- B33 tax hook: a business-like seller's sale is never taken untaxed.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_flags f
              WHERE f.user_id = p_seller_id AND f.business_like) THEN
    RAISE EXCEPTION 'seller_tax_not_ready' USING ERRCODE = '55000',
      HINT = 'Checkout for this seller is not available yet.';
  END IF;
  IF public.declutter_seller_out(p_seller_id) OR public.are_users_blocked(p_seller_id, v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Row 101: porch only when EVERY line's item allows it. Read from the lines
  -- this checkout groups (v_lines), under the item locks taken above. Before the
  -- idempotent return, so no open porch order is handed back either.
  IF p_handover = 'porch' AND EXISTS (
       SELECT 1 FROM public.declutter_cart_items c
         JOIN public.declutter_items i ON i.id = c.item_id
        WHERE c.id = ANY (v_lines) AND NOT i.porch_ok) THEN
    RAISE EXCEPTION 'porch_unavailable' USING ERRCODE = '22023',
      HINT = 'The seller asked buyers to meet at their home for this item. Choose pickup at the seller''s home.';
  END IF;
  -- Slice 5: the delivery for exactly these lines, from server data only.
  IF p_handover = 'delivery' THEN
    SELECT * INTO q FROM public.declutter_delivery_compute(v_uid, p_seller_id, v_lines);
    v_delivery := q.delivery_cents;
    v_dropoff_key := q.dropoff_address || '|' || q.road_miles;
  END IF;
  -- Seller delivery: under the seller's setting-row lock (held to the end of
  -- this transaction), taken BEFORE the setting is read (lh-money-escrow review
  -- of the free-delivery change #1): a seller saving a new price or turning
  -- delivery off mid-checkout is either seen here or waits, so the order never
  -- freezes terms the seller already changed. Then the setting, items, address,
  -- range and the rate; then the slot.
  IF p_handover = 'seller_delivery' THEN
    PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = p_seller_id FOR UPDATE;
    SELECT * INTO sd FROM public.declutter_seller_delivery_check(v_uid, p_seller_id, v_lines);
    IF sd.reason = 'address_needed' THEN
      RAISE EXCEPTION 'delivery_address_needed' USING ERRCODE = '22023', HINT = 'Enter the address to deliver to.';
    ELSIF sd.reason = 'out_of_range' THEN
      RAISE EXCEPTION 'delivery_out_of_range' USING ERRCODE = '22023',
        HINT = 'This seller doesn''t deliver that far. Choose pickup or another delivery.';
    ELSIF sd.reason IS NOT NULL THEN
      RAISE EXCEPTION 'seller_delivery_unavailable' USING ERRCODE = '22023',
        HINT = 'This seller can''t deliver these items. Choose another way to get them.';
    END IF;
    IF p_slot_start IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.declutter_delivery_open_slots(p_seller_id, v_existing.id) s WHERE s = p_slot_start) THEN
      RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = '22023',
        HINT = 'That delivery time was just taken or is no longer open. Pick another time.';
    END IF;
    v_delivery := sd.rate_cents;
    v_sd_dropoff := sd.dropoff_address;
  END IF;

  -- Q2352 (owner 2026-10-22, terms #9): the one-time account setup fee rides
  -- the buyer's first Declutter purchase when the account never paid it. It is
  -- frozen on the order OUTSIDE total_cents (the sale's own amount, which every
  -- refund is computed from), so a refund of the sale never returns it.
  v_setup := public.declutter_setup_fee_due_cents(v_uid);

  -- Idempotent (money review #3): the same lines and the same handover return
  -- the order already open, and its Stripe session for the app to reuse.
  -- Slice 5: and the same delivery (fee and drop-off). Seller delivery: and
  -- the same slot, still held, to the same address.
  IF v_existing.id IS NOT NULL AND v_existing.handover = p_handover AND v_existing.lines = v_lines
     AND v_existing.delivery_cents = v_delivery
     AND v_existing.dropoff_key IS NOT DISTINCT FROM v_dropoff_key
     -- Q2352: and the same setup fee (paid elsewhere since: a fresh order without it).
     AND v_existing.setup_fee_cents = v_setup
     AND (p_handover <> 'seller_delivery'
          OR (v_existing.held_slot = p_slot_start AND v_existing.sd_dropoff IS NOT DISTINCT FROM v_sd_dropoff)) THEN
    -- lh-money-escrow review #1: an order handed back with NO page yet (the
    -- last try failed before Stripe attached one) gets a new page that lives
    -- 31 min from now, so its hold is re-armed from now too (the setting row
    -- is locked above). An order with a page keeps its hold: the page dies first.
    IF p_handover = 'seller_delivery' AND v_existing.stripe_checkout_session_id IS NULL THEN
      UPDATE public.declutter_seller_deliveries x
         SET held_until = now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer), updated_at = now()
       WHERE x.order_id = v_existing.id AND x.status = 'held' AND x.held_until > now();
    END IF;
    -- A changed door choice moves no money: it is updated on the order already open.
    IF p_handover = 'seller_delivery' THEN
      UPDATE public.declutter_seller_deliveries x SET handoff = p_handoff, updated_at = now()
       WHERE x.order_id = v_existing.id AND x.handoff IS DISTINCT FROM p_handoff;
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.items_cents, v_existing.premium_cents, v_existing.tax_cents,
                        v_existing.total_cents, NULL::text, v_existing.stripe_checkout_session_id, v_existing.delivery_cents;
    RETURN;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.declutter_orders SET status = 'superseded', close_reason = 'superseded', closed_at = now()
     WHERE id = v_existing.id AND status = 'awaiting_payment';
    v_old_session := v_existing.stripe_checkout_session_id;
  END IF;

  -- F1: 5% of the item total + 70c, once per checkout (card cost inside it).
  -- The Helpr delivery fee is not part of the item total (row 29 prices it
  -- alone); the seller's delivery rate is (owner 2026-10-22, the shipping rule).
  v_premium := CASE WHEN p_handover = 'seller_delivery'
                    THEN public.declutter_buyer_fee_cents_seller_delivery(v_items, v_delivery)
                    ELSE public.declutter_buyer_fee_cents(v_items) END;
  INSERT INTO public.declutter_orders (buyer_id, seller_id, handover, items_cents, premium_cents, tax_cents,
                                       delivery_cents, total_cents, setup_fee_cents)
  VALUES (v_uid, p_seller_id, p_handover, v_items, v_premium, 0, v_delivery, v_items + v_premium + v_delivery, v_setup)
  RETURNING id INTO v_order;
  UPDATE public.declutter_cart_items c SET order_id = v_order
   WHERE c.id = ANY (v_lines);
  IF p_handover = 'delivery' THEN
    INSERT INTO public.declutter_order_deliveries (order_id, dropoff_address, dropoff_area, dropoff_lat, dropoff_lng,
                                                   road_miles, size, delivery_cents)
    VALUES (v_order, q.dropoff_address, q.dropoff_area, q.dropoff_lat, q.dropoff_lng, q.road_miles, q.size, v_delivery);
  END IF;
  IF p_handover = 'seller_delivery' THEN
    INSERT INTO public.declutter_seller_deliveries (order_id, buyer_id, seller_id, status, slot_start, slot_end, held_until,
                                                    dropoff_address, dropoff_area, dropoff_lat, dropoff_lng, handoff)
    VALUES (v_order, v_uid, p_seller_id, 'held', p_slot_start,
            p_slot_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
            now() + make_interval(mins => (v_rules ->> 'hold_minutes')::integer),
            sd.dropoff_address, sd.dropoff_area, sd.dropoff_lat, sd.dropoff_lng, p_handoff);
  END IF;

  RETURN QUERY SELECT v_order, v_items, v_premium, 0, v_items + v_premium + v_delivery, v_old_session, NULL::text, v_delivery;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_start_checkout(uuid, text, timestamptz, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The slot follows the order (AFTER UPDATE OF status, so every path that
--    pays, supersedes, expires, refunds or completes an order moves it):
--      paid        held -> booked (re-checked: if the hold lapsed and another
--                  order has the slot, 'needs_time' and both are told);
--                  a payment honoured late (B41, expired -> paid) re-claims it
--      superseded / expired (from awaiting_payment)  held -> released
--      refunded    -> cancelled (the slot is free again)
--      handed_over -> done
CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_on_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  d public.declutter_seller_deliveries;
BEGIN
  IF NEW.handover IS DISTINCT FROM 'seller_delivery' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'paid' AND d.status IN ('held', 'released') THEN
    -- The same lock checkout takes, so no checkout can take this slot meanwhile.
    PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = NEW.seller_id FOR UPDATE;
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (NEW.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
    IF d.slot_start > now()
       AND public.declutter_delivery_slot_used(NEW.seller_id, d.slot_start, NEW.id)
           < (public.declutter_seller_delivery_rules() ->> 'per_slot')::integer THEN
      UPDATE public.declutter_seller_deliveries SET status = 'booked', held_until = NULL, updated_at = now()
       WHERE order_id = NEW.id;
      PERFORM public.declutter_notify(NEW.seller_id, 'payment', 'Delivery booked',
        format('Deliver to %s on %s. %s The address is on the sale.', d.dropoff_area, public.declutter_delivery_when(d.slot_start),
               CASE WHEN d.handoff = 'hand' THEN 'The buyer wants it handed to them.' ELSE 'The buyer wants it left at the door, with a photo.' END),
        '/declutter?view=sales', NEW.buyer_id);
      PERFORM public.declutter_notify(NEW.buyer_id, 'payment', 'Delivery booked',
        format('The seller delivers on %s.', public.declutter_delivery_when(d.slot_start)),
        '/declutter?view=cart', NEW.seller_id);
    ELSE
      UPDATE public.declutter_seller_deliveries
         SET status = 'needs_time', slot_start = NULL, slot_end = NULL, held_until = NULL, updated_at = now()
       WHERE order_id = NEW.id;
      PERFORM public.declutter_notify(NEW.buyer_id, 'payment', 'Pick a new delivery time',
        'Your payment came through after your delivery time was given to someone else. Pick a new time from the seller''s open times.',
        '/declutter?view=cart', NEW.seller_id);
      PERFORM public.declutter_notify(NEW.seller_id, 'payment', 'Buyer is picking a delivery time',
        'The buyer paid, but their time was taken in the meantime. They will pick a new one.',
        '/declutter?view=sales', NEW.buyer_id);
    END IF;
  ELSIF OLD.status = 'awaiting_payment' AND NEW.status IN ('superseded', 'expired') THEN
    UPDATE public.declutter_seller_deliveries SET status = 'released', updated_at = now()
     WHERE order_id = NEW.id AND status = 'held';
  ELSIF NEW.status = 'refunded' THEN
    UPDATE public.declutter_seller_deliveries SET status = 'cancelled', proposed_start = NULL, proposed_by = NULL,
           proposed_at = NULL, updated_at = now()
     WHERE order_id = NEW.id;
  ELSIF NEW.status = 'handed_over' THEN
    UPDATE public.declutter_seller_deliveries SET status = 'done', proposed_start = NULL, proposed_by = NULL,
           proposed_at = NULL, updated_at = now()
     WHERE order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_on_order() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_orders_seller_delivery ON public.declutter_orders;
CREATE TRIGGER trg_declutter_orders_seller_delivery AFTER UPDATE OF status ON public.declutter_orders
  FOR EACH ROW EXECUTE FUNCTION public.declutter_seller_delivery_on_order();

-- ---------------------------------------------------------------------------
-- 10. The handover pays the seller the rate WITH the items, restated from
--     20261026155251 (its newest definition, board 141d). Only the payout lines change:
--     on a 'seller_delivery' order the payout is items + rate (less any fee
--     debt, capped at that sum) and the notice names that amount. Seller
--     proceeds are exact cents (the whole-dollar rule is for Helpr payouts).
CREATE OR REPLACE FUNCTION public.declutter_complete_handover(p_order_id uuid, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_debt integer;
  v_payout uuid;
  v_task public.helpr_tasks;
  v_task_out jsonb;
  v_rate integer;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status IS DISTINCT FROM 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF p_by <> 'admin' AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  -- Slice 5: a delivery.
  IF o.handover = 'delivery' THEN
    SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
     WHERE od.order_id = o.id FOR UPDATE OF t;
    IF v_task.status IN ('picked_up', 'delivered') THEN
      v_task_out := public.helpr_task_confirm(v_task.id,
        CASE p_by WHEN 'code' THEN 'code' WHEN 'buyer' THEN 'customer' WHEN 'admin' THEN 'admin' ELSE 'auto' END, NULL);
    ELSIF v_task.status = 'confirmed' OR (p_by = 'admin' AND v_task.status = 'failed') THEN
      -- Already confirmed, or the damage decision (row 43) that failed the
      -- task itself and refunds the whole order on its own: nothing more here.
      NULL;
    ELSIF p_by = 'admin' AND (v_task.id IS NULL OR v_task.status IN ('open', 'accepted')) THEN
      IF v_task.id IS NOT NULL THEN
        PERFORM public.helpr_task_close(v_task.id, 'cancelled', 'The sale was decided without a delivery');
      END IF;
      PERFORM public.declutter_delivery_refund(o.id, 'delivery_not_done');
    ELSE
      RAISE EXCEPTION 'delivery_not_done' USING ERRCODE = '55000',
        HINT = 'The Helpr has not picked the item up yet.';
    END IF;
  END IF;
  -- Seller delivery: the rate is the seller's, paid with the items.
  v_rate := CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents + v_rate);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, delivery_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_rate, v_debt, o.items_cents + v_rate - v_debt,
          CASE WHEN o.items_cents + v_rate - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    CASE
      WHEN o.items_cents + v_rate - v_debt = 0 THEN
        format('This sale paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents + v_rate - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?view=selling', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    CASE WHEN p_by = 'admin' THEN 'The handover is done and the sale is final. Leave the seller a review.'
         ELSE 'The handover is done. If something is wrong with it, you can ask the seller for a refund within 24 hours. Leave the seller a review.' END,
    '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by)
         || CASE WHEN v_task_out IS NOT NULL THEN jsonb_build_object('helpr_payout_id', v_task_out->'helpr_payout_id') ELSE '{}'::jsonb END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 11. Three guards restated from their newest definitions.

-- No pickup booking on a seller-delivered order either (restated from
-- 20261017055505): its time is the delivery slot, and the pickup sweep must
-- never auto-pay or no-show it through a booking.
CREATE OR REPLACE FUNCTION public.declutter_bookings_not_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'delivery') THEN
    RAISE EXCEPTION 'delivery_order' USING ERRCODE = '55000',
      HINT = 'A Helpr is delivering this order and picks the pickup time.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = NEW.order_id AND o.handover = 'seller_delivery') THEN
    RAISE EXCEPTION 'delivery_order' USING ERRCODE = '55000',
      HINT = 'The seller is delivering this order at the time you picked.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_bookings_not_delivery() FROM PUBLIC, anon, authenticated;

-- The delivery fee given back on its own is a HELPR-delivery path only
-- (restated from 20261017055505): a seller's rate is never refunded alone,
-- it goes back only with the whole order (spec: "never refunded on its own").
CREATE OR REPLACE FUNCTION public.declutter_delivery_refund(p_order_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_id uuid;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.delivery_cents <= 0 OR o.stripe_payment_intent_id IS NULL OR o.handover = 'seller_delivery' THEN
    RAISE EXCEPTION 'no_delivery_fee' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.declutter_delivery_refunds (order_id, stripe_payment_intent_id, reason, refund_cents)
  VALUES (o.id, o.stripe_payment_intent_id, p_reason, o.delivery_cents)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.declutter_delivery_refunds WHERE order_id = o.id;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_refund(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_refund(uuid, text) TO service_role;

-- The seller's exact address goes to the buyer of a paid order who comes to
-- get the item (restated from 20261015042253); a buyer the seller delivers to
-- has no need of it, so a seller delivery does not reveal it.
CREATE OR REPLACE FUNCTION public.declutter_address_access(p_item_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE
           WHEN i.seller_id = p_user_id THEN 'seller'
           WHEN EXISTS (SELECT 1 FROM public.declutter_cart_items c
                          JOIN public.declutter_orders o ON o.id = c.order_id
                         WHERE c.item_id = i.id AND c.status = 'paid'
                           AND o.status = 'paid' AND o.buyer_id = p_user_id
                           AND o.handover <> 'seller_delivery') THEN 'paid_buyer'
         END
    FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND p_user_id IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_address_access(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 12. After payment (member RPCs). No switch: like every handover step
--     (row 62) these finish a sale already paid for, so turning the switch
--     off never strands one.

-- Either side's view of the delivery. The buyer's address reaches the seller
-- only while the order is paid: not before, not after a refund, and not after
-- the handover (lh-authz-rls review #2: the address is never the seller's to keep).
CREATE OR REPLACE FUNCTION public.declutter_seller_delivery_booking(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rules jsonb := public.declutter_seller_delivery_rules();
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  h public.declutter_handovers;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id;
  IF v_side IS NULL OR o.handover IS DISTINCT FROM 'seller_delivery' OR d.order_id IS NULL
     OR NOT (o.status IN ('paid', 'handed_over') OR (v_side = 'buyer' AND o.status = 'awaiting_payment')) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  RETURN jsonb_build_object(
    'order_id', o.id, 'side', v_side, 'order_status', o.status, 'status', d.status,
    'slot_start', d.slot_start, 'slot_end', d.slot_end, 'delivery_cents', o.delivery_cents,
    'dropoff_area', d.dropoff_area, 'handoff', d.handoff,
    'dropoff_address', CASE WHEN v_side = 'buyer' OR o.status = 'paid' THEN d.dropoff_address END,
    'proposed_start', d.proposed_start, 'proposed_by', d.proposed_by,
    'proposals_left', (v_rules ->> 'proposals_per_side')::integer
                      - CASE WHEN v_side = 'buyer' THEN d.buyer_proposals ELSE d.seller_proposals END,
    'delivered_at', d.delivered_at, 'delivered_photo_path', h.set_out_photo_path,
    'confirmed_at', h.confirmed_at,
    'not_delivered_from', d.slot_end + make_interval(mins => (v_rules ->> 'not_delivered_after_minutes')::integer));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivery_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivery_booking(uuid) TO authenticated, service_role;

-- The open times a paid seller delivery can move to (the same list checkout
-- offers: the seller's schedule, 24 h ahead to 14 days out, under the per-slot
-- limit, this order's own slot not counted), for either side of the order.
CREATE OR REPLACE FUNCTION public.declutter_delivery_open_times(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object(
    'slot_minutes', (public.declutter_seller_delivery_rules() ->> 'slot_minutes')::integer,
    'slots', to_jsonb(ARRAY(SELECT s FROM public.declutter_delivery_open_slots(o.seller_id, o.id) s)));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_open_times(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_open_times(uuid) TO authenticated, service_role;

-- The seller's "Delivered" (left at the door: a photo is required) or
-- "Handed over" (handed to the buyer: a photo is optional), from the booked
-- time. It does not pay by itself: the buyer's "I got it" or, 24 h after the
-- seller's mark, the sweep does (as for porch).
CREATE OR REPLACE FUNCTION public.declutter_seller_delivered(p_order_id uuid, p_photo_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
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
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'seller_delivery' THEN
    RAISE EXCEPTION 'not_a_seller_delivery' USING ERRCODE = '55000';
  END IF;
  IF v_side <> 'seller' THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF now() < d.slot_start THEN
    RAISE EXCEPTION 'before_delivery_time' USING ERRCODE = '55000',
      HINT = 'You can mark it delivered from the booked delivery time.';
  END IF;
  p_photo_path := NULLIF(btrim(p_photo_path), '');
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RETURN jsonb_build_object('result', 'delivered');
  END IF;
  IF (p_photo_path IS NULL AND d.handoff = 'leave') OR (p_photo_path IS NOT NULL AND (
        split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path))) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  IF p_photo_path IS NOT NULL THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now()
     WHERE order_id = o.id AND confirmed_at IS NULL;
  END IF;
  UPDATE public.declutter_seller_deliveries SET delivered_at = now(), proposed_start = NULL, proposed_by = NULL, proposed_at = NULL,
         updated_at = now()
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your items were delivered',
    CASE WHEN d.handoff = 'hand' THEN 'The seller says they handed you your items. Tap "I got it". If something is wrong, report a problem within 24 hours; after that the seller is paid.'
         ELSE 'The seller left your items at your door and took a photo. Tap "I got it" when you have them. If something is wrong, report a problem within 24 hours; after that the seller is paid.' END,
    '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'delivered');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_delivered(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_delivered(uuid, text) TO authenticated, service_role;

-- The buyer's "It wasn't delivered", from the slot's end + 15 min, while the
-- seller has no "Delivered" photo: everything back, delivery included; the
-- seller gets a strike and pays the card fee (seller fault, row 60).
CREATE OR REPLACE FUNCTION public.declutter_report_not_delivered(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
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
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF now() < d.slot_end + make_interval(mins => (public.declutter_seller_delivery_rules() ->> 'not_delivered_after_minutes')::integer) THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000', HINT = 'Wait 15 minutes after the delivery time ends.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_delivered' USING ERRCODE = '55000',
      HINT = 'The seller marked it delivered. If you don''t have it, report a problem.';
  END IF;
  RETURN public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show',
    'You did not deliver a booked Declutter order. The buyer got everything back, delivery included; the card fee comes out of your next Declutter payout.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_report_not_delivered(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_not_delivered(uuid) TO authenticated, service_role;

-- The seller cancels a paid delivery before delivering: the same seller-fault
-- rules (everything back, delivery included; strike; the seller pays the card fee).
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
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_delivered' USING ERRCODE = '55000',
      HINT = 'You already marked it delivered. Report a problem instead.';
  END IF;
  -- lh-money-escrow review #2: while the buyer is picking a new time
  -- because theirs was lost, a cancel is not the seller's fault, so it is not
  -- a seller-fault cancel either: the seller reports a problem and we decide.
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries d WHERE d.order_id = o.id AND d.status = 'needs_time') THEN
    RAISE EXCEPTION 'not_reschedulable' USING ERRCODE = '55000',
      HINT = 'The buyer is picking a new time. To cancel, report a problem and Louisiana Helpr will sort it out.';
  END IF;
  RETURN public.declutter_close_paid_order(o.id, 'seller_backed_out', 'seller', 'item_gone_after_sale',
    'You cancelled a paid Declutter delivery. The buyer got everything back, delivery included; the card fee comes out of your next Declutter payout.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_cancel_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_cancel_delivery(uuid) TO authenticated, service_role;

-- The buyer's door choice, changeable until the seller marks it delivered
-- (owner 2026-10-22: the seller can message the buyer about it). No money moves.
CREATE OR REPLACE FUNCTION public.declutter_set_delivery_handoff(p_order_id uuid, p_handoff text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
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
  IF p_handoff IS NULL OR p_handoff NOT IN ('leave', 'hand') THEN
    RAISE EXCEPTION 'invalid_handoff' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status NOT IN ('booked', 'needs_time')
     OR EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_reschedulable' USING ERRCODE = '55000';
  END IF;
  IF d.handoff IS DISTINCT FROM p_handoff THEN
    UPDATE public.declutter_seller_deliveries SET handoff = p_handoff, updated_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Delivery changed',
      CASE WHEN p_handoff = 'hand' THEN 'The buyer now wants it handed to them.' ELSE 'The buyer now wants it left at the door, with a photo.' END,
      '/declutter?view=sales', o.buyer_id);
  END IF;
  RETURN p_handoff;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_delivery_handoff(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_delivery_handoff(uuid, text) TO authenticated, service_role;

-- The buyer cancels a paid seller delivery for their own reason (owner
-- 2026-10-22): until buyer_cancel_hours (24) before the slot, and before the
-- seller marked it delivered. Everything back (items + rate) EXCEPT the card
-- fee ('buyer_cancelled' = keep_card_fee); no strike; the items go back on
-- sale and the slot is free again (the order-status trigger). A buyer whose
-- time was lost ('needs_time', no slot) may cancel on the same terms. After
-- the cutoff it is Report a problem only.
CREATE OR REPLACE FUNCTION public.declutter_buyer_cancel_delivery(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
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
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'seller_delivered' USING ERRCODE = '55000',
      HINT = 'The seller marked it delivered. If you don''t have it, report a problem.';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.slot_start IS NOT NULL
     AND now() > d.slot_start - make_interval(hours => (public.declutter_seller_delivery_rules() ->> 'buyer_cancel_hours')::integer) THEN
    RAISE EXCEPTION 'cancel_window_closed' USING ERRCODE = '55000',
      HINT = 'It''s less than 24 hours to the delivery, so you can''t cancel now. Report a problem if something is wrong.';
  END IF;
  RETURN public.declutter_close_paid_order(o.id, 'buyer_cancelled', NULL, NULL, NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_buyer_cancel_delivery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_buyer_cancel_delivery(uuid) TO authenticated, service_role;

-- A new time: either side proposes one of the seller's open times, the other
-- accepts. A buyer whose time was lost ('needs_time') books one directly.
CREATE OR REPLACE FUNCTION public.declutter_propose_delivery_time(p_order_id uuid, p_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rules jsonb := public.declutter_seller_delivery_rules();
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
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
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.status NOT IN ('booked', 'needs_time')
     OR EXISTS (SELECT 1 FROM public.declutter_seller_deliveries x WHERE x.order_id = o.id AND x.delivered_at IS NOT NULL) THEN
    RAISE EXCEPTION 'not_reschedulable' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = o.seller_id FOR UPDATE;
  IF p_slot_start IS NULL OR p_slot_start IS NOT DISTINCT FROM d.slot_start
     OR NOT EXISTS (SELECT 1 FROM public.declutter_delivery_open_slots(o.seller_id, o.id) s WHERE s = p_slot_start) THEN
    RAISE EXCEPTION 'slot_unavailable' USING ERRCODE = '22023',
      HINT = 'That delivery time is not open. Pick another time.';
  END IF;
  IF d.status = 'needs_time' AND v_side = 'buyer' THEN
    UPDATE public.declutter_seller_deliveries
       SET status = 'booked', slot_start = p_slot_start,
           slot_end = p_slot_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
           proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, reminded_hours = '{}', updated_at = now()
     WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Delivery booked',
      format('Deliver to %s on %s. The address is on the sale.', d.dropoff_area, public.declutter_delivery_when(p_slot_start)),
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'booked', 'slot_start', p_slot_start);
  END IF;
  IF d.proposed_start = p_slot_start AND d.proposed_by = v_side THEN
    -- The same request again (a double tap): nothing new, no request used.
    RETURN jsonb_build_object('result', 'proposed', 'proposed_start', p_slot_start);
  END IF;
  IF (CASE WHEN v_side = 'buyer' THEN d.buyer_proposals ELSE d.seller_proposals END)
     >= (v_rules ->> 'proposals_per_side')::integer THEN
    RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You can''t ask for another new time on this order.';
  END IF;
  UPDATE public.declutter_seller_deliveries
     SET proposed_start = p_slot_start, proposed_by = v_side, proposed_at = now(),
         buyer_proposals = buyer_proposals + CASE WHEN v_side = 'buyer' THEN 1 ELSE 0 END,
         seller_proposals = seller_proposals + CASE WHEN v_side = 'seller' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'payment',
    'New delivery time asked',
    format('The %s asked to move the delivery to %s. Accept or keep the current time.',
           v_side, public.declutter_delivery_when(p_slot_start)),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
  RETURN jsonb_build_object('result', 'proposed', 'proposed_start', p_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_propose_delivery_time(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_propose_delivery_time(uuid, timestamptz) TO authenticated, service_role;

-- Accept (the OTHER side only) or turn down / withdraw (either side) a proposed time.
CREATE OR REPLACE FUNCTION public.declutter_answer_delivery_time(p_order_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_rules jsonb := public.declutter_seller_delivery_rules();
  o public.declutter_orders;
  d public.declutter_seller_deliveries;
  v_side text;
  v_other uuid;
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
  SELECT * INTO d FROM public.declutter_seller_deliveries WHERE order_id = o.id FOR UPDATE;
  IF d.proposed_start IS NULL OR p_accept IS NULL THEN
    RAISE EXCEPTION 'no_proposal' USING ERRCODE = '55000';
  END IF;
  v_other := CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END;
  IF p_accept AND EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_accept AND d.proposed_by = v_side THEN
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501', HINT = 'The other side accepts the time you asked for.';
  END IF;
  IF NOT p_accept THEN
    UPDATE public.declutter_seller_deliveries SET proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, updated_at = now()
     WHERE order_id = o.id;
    IF d.proposed_by <> v_side THEN
      PERFORM public.declutter_notify(v_other, 'payment', 'Delivery time kept',
        format('The new time was turned down. The delivery stays %s.', COALESCE(public.declutter_delivery_when(d.slot_start), 'to be picked')),
        '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
    END IF;
    RETURN jsonb_build_object('result', 'kept');
  END IF;
  PERFORM 1 FROM public.declutter_seller_delivery s WHERE s.seller_id = o.seller_id FOR UPDATE;
  IF d.proposed_start <= now()
     OR public.declutter_delivery_slot_used(o.seller_id, d.proposed_start, o.id)
        >= (v_rules ->> 'per_slot')::integer THEN
    UPDATE public.declutter_seller_deliveries SET proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, updated_at = now()
     WHERE order_id = o.id;
    RETURN jsonb_build_object('result', 'slot_taken');
  END IF;
  UPDATE public.declutter_seller_deliveries
     SET status = 'booked', slot_start = d.proposed_start,
         slot_end = d.proposed_start + make_interval(mins => (v_rules ->> 'slot_minutes')::integer),
         proposed_start = NULL, proposed_by = NULL, proposed_at = NULL, reminded_hours = '{}', updated_at = now()
   WHERE order_id = o.id;
  PERFORM public.declutter_notify(v_other, 'payment', 'Delivery time changed',
    format('The delivery is now %s.', public.declutter_delivery_when(d.proposed_start)),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
  RETURN jsonb_build_object('result', 'moved', 'slot_start', d.proposed_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_answer_delivery_time(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_delivery_time(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. The sweep (every 10 min), restated from 20261018183715 (its newest
--     definition). Changes: the two pickup loops skip 'seller_delivery' (it
--     has no pickup booking and no 7-day pickup deadline: without this the
--     second loop would refund a paid delivery as a buyer no-show on day 7);
--     two new loops for seller delivery: (c) auto-pay 24 h after the seller's
--     "Delivered" photo unless a problem is open, (d) the reminders.
CREATE OR REPLACE FUNCTION public.declutter_handover_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  o public.declutter_orders;
  v_auto integer := 0;
  v_noshow integer := 0;
  v_sd_auto integer := 0;
  v_reminders integer := 0;
  v_rules jsonb := public.declutter_seller_delivery_rules();
  v_h integer;
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery') AND b.slot_start IS NOT NULL AND b.slot_start + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
       AND (o2.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                               WHERE h.order_id = o2.id AND h.set_out_photo_path IS NOT NULL))
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND b.slot_start + interval '24 hours' <= now())
         -- Porch (owner 2026-10-18): no "Left on porch" photo, no auto-pay.
         AND (o.handover <> 'porch' OR EXISTS (SELECT 1 FROM public.declutter_handovers h
                                                WHERE h.order_id = o.id AND h.set_out_photo_path IS NOT NULL)) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_auto := v_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad order never stops the rest; it is logged and retried next run.
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      LEFT JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover NOT IN ('delivery', 'seller_delivery') AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover NOT IN ('delivery', 'seller_delivery')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
        PERFORM public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
          'You did not pick up a paid Declutter item within 7 days. The item price was refunded; the buyer''s fee was not.');
        v_noshow := v_noshow + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (c) Seller delivery: 24 h after the seller's "Delivered" (a photo, when left at the
  -- door) or "Handed over", unless a problem is open.
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_seller_deliveries d ON d.order_id = o2.id
      JOIN public.declutter_handovers h ON h.order_id = o2.id
     WHERE o2.status = 'paid' AND o2.handover = 'seller_delivery' AND d.status = 'booked'
       AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
       AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid' AND o.handover = 'seller_delivery'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_handovers h JOIN public.declutter_seller_deliveries d ON d.order_id = h.order_id
                      WHERE h.order_id = o.id AND d.delivered_at IS NOT NULL AND (d.handoff = 'hand' OR h.set_out_photo_path IS NOT NULL)
                        AND d.delivered_at + make_interval(hours => (v_rules ->> 'auto_confirm_hours')::integer) <= now()) THEN
        PERFORM public.declutter_complete_handover(o.id, 'auto');
        v_sd_auto := v_sd_auto + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.id::text, SQLERRM);
    END;
  END LOOP;
  -- (d) Reminders before a booked delivery (24 h and 1 h, from the rules). One
  -- per run per order: the nearest one due; any earlier one not sent yet is
  -- marked sent too, so a late booking never gets "tomorrow" after "soon".
  FOR r IN
    SELECT d.order_id, d.buyer_id, d.seller_id, d.slot_start, d.dropoff_area, d.reminded_hours
      FROM public.declutter_seller_deliveries d
      JOIN public.declutter_orders o2 ON o2.id = d.order_id
     WHERE d.status = 'booked' AND o2.status = 'paid' AND d.slot_start > now()
       AND d.slot_start <= now() + make_interval(hours => (SELECT max(x::integer) FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x))
     ORDER BY d.slot_start LIMIT 500
  LOOP
    BEGIN
      SELECT min(x::integer) INTO v_h FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
       WHERE r.slot_start <= now() + make_interval(hours => x::integer)
         AND NOT x::integer = ANY (r.reminded_hours);
      IF v_h IS NOT NULL THEN
        UPDATE public.declutter_seller_deliveries d
           SET reminded_hours = (SELECT array_agg(DISTINCT y ORDER BY y)
                                   FROM unnest(d.reminded_hours || ARRAY(SELECT x::integer FROM jsonb_array_elements_text(v_rules -> 'reminder_hours') x
                                                                         WHERE x::integer >= v_h)) y),
               updated_at = now()
         WHERE d.order_id = r.order_id;
        PERFORM public.declutter_notify(r.seller_id, 'payment', 'Delivery coming up',
          format('You deliver to %s on %s.', r.dropoff_area, public.declutter_delivery_when(r.slot_start)),
          '/declutter?view=sales', r.buyer_id);
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Delivery coming up',
          format('The seller delivers on %s.', public.declutter_delivery_when(r.slot_start)),
          '/declutter?view=cart', r.seller_id);
        v_reminders := v_reminders + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('declutter_handover_sweep', r.order_id::text, SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow,
                            'delivery_auto_paid', v_sd_auto, 'delivery_reminders', v_reminders);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;

-- ---------------------------------------------------------------------------
-- 14. Board 141d's refund after the handover, with the seller's rate
--     (restated from 20261026155251, its newest definition). The payout is
--     items + rate - refunded - debt; a part refund comes out of the item price
--     only (141d: below the item price); a full refund undoes the items AND the
--     rate for the seller (the buyer's refund is the whole order less the card
--     fee, declutter_full_refund_cents, rate included), so nothing is paid twice.
CREATE OR REPLACE FUNCTION public.declutter_rebook_payout(p_order_id uuid, p_refunded_cents integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  p public.declutter_payouts;
  v_ref text := 'declutter_order_' || p_order_id::text;
  v_debt integer;
BEGIN
  SELECT * INTO p FROM public.declutter_payouts WHERE order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout_missing' USING ERRCODE = 'P0002';
  END IF;
  IF p_refunded_cents IS NULL OR p_refunded_cents < 0 OR p_refunded_cents > p.items_cents + p.delivery_cents THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF NOT public.declutter_payout_unsent(p_order_id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000';
  END IF;
  IF p.seller_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('declutter_fee_debt:' || p.seller_id::text, 0));
    UPDATE public.declutter_seller_fee_debts d
       SET remaining_cents = d.remaining_cents + x.deducted_cents
      FROM public.declutter_fee_debt_deductions x
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    DELETE FROM public.declutter_fee_debt_deductions x
     USING public.declutter_seller_fee_debts d
     WHERE x.debt_id = d.id AND x.payout_ref = v_ref AND d.seller_id = p.seller_id;
    v_debt := public.declutter_consume_fee_debt(p.seller_id, v_ref, p.items_cents + p.delivery_cents - p_refunded_cents);
  ELSE
    -- The seller's account is gone: nothing can be put back to them.
    v_debt := least(p.debt_cents, p.items_cents + p.delivery_cents - p_refunded_cents);
  END IF;
  UPDATE public.declutter_payouts
     SET refunded_cents = p_refunded_cents, debt_cents = v_debt,
         amount_cents = items_cents + delivery_cents - p_refunded_cents - v_debt,
         status = CASE WHEN items_cents + delivery_cents - p_refunded_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END
   WHERE id = p.id;
  RETURN p.items_cents + p.delivery_cents - p_refunded_cents - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_rebook_payout(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_rebook_payout(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_after_handover(p_order_id uuid, p_reason text, p_part_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_reserved integer;
  v_paid integer;
  v_refund uuid;
  v_refunded integer;
  v_cents integer;
  v_title text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('refund_request_full', 'refund_request_part', 'not_as_described', 'admin_no_fault', 'admin_buyer_fault') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF o.status <> 'handed_over' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_handed_over' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = o.stripe_payment_intent_id) THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = '55000';
  END IF;
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'payout_already_sent' USING ERRCODE = '55000',
      HINT = 'The seller was already paid for this sale. Louisiana Helpr settles it by hand.';
  END IF;
  -- A delivery fee that paid a Helpr for the trip stays with the Helpr (owner #5, B69).
  v_reserved := public.declutter_delivery_reserved_cents(o.id);
  v_paid := o.total_cents - v_reserved;
  IF p_reason = 'refund_request_part' THEN
    -- Q1998: tax on a part refund is never guessed. Declutter charges no tax today (declutter-checkout refuses it).
    IF o.tax_cents <> 0 THEN
      RAISE EXCEPTION 'part_refund_unavailable' USING ERRCODE = '55000';
    END IF;
    IF p_part_cents IS NULL OR p_part_cents <= 0 OR p_part_cents >= o.items_cents THEN
      RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                          kept_cents, refund_cents)
    VALUES (o.id, o.stripe_payment_intent_id, 'refund_request_part', 'agreed_part', v_paid, 0, 0, p_part_cents)
    RETURNING id INTO v_refund;
    v_refunded := p_part_cents;
  ELSE
    v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, v_paid, o.card_fee_cents);
    -- The whole sale is undone for the seller: nothing of the item price is theirs, and the item goes back.
    -- A seller delivery's rate went back to the buyer with it (no Helpr was paid for the trip), so it
    -- leaves the seller's payout too: their payout for this sale is 0 (20261027153244).
    v_refunded := o.items_cents + CASE WHEN o.handover = 'seller_delivery' THEN o.delivery_cents ELSE 0 END;
    UPDATE public.declutter_items SET status = 'withdrawn', updated_at = now()
     WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
       AND status = 'completed';
  END IF;
  PERFORM public.declutter_rebook_payout(o.id, v_refunded);
  SELECT r.refund_cents INTO v_cents FROM public.declutter_refunds r WHERE r.id = v_refund;
  SELECT string_agg(i.title, ', ' ORDER BY i.title) INTO v_title
    FROM public.declutter_cart_items c JOIN public.declutter_items i ON i.id = c.item_id WHERE c.order_id = o.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('$%s is coming back to your card for "%s". Keep the item.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         WHEN p_reason = 'refund_request_full'
         THEN format('$%s is coming back to your card for "%s". The seller confirmed they have the item back.%s',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN v_reserved > 0 THEN ' The delivery fee paid the Helpr who made the trip.' ELSE '' END)
         ELSE format('$%s is coming back to your card for "%s".%s%s Please give the item back to the seller; arrange it in Messages.',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN p_reason = 'admin_buyer_fault' THEN ' Your buyer''s fee is not refunded.' ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' The delivery fee paid the Helpr who made the trip.' ELSE '' END)
    END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer refunded',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('The buyer got $%s back for "%s". It comes out of your payout for this sale.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         WHEN p_reason = 'refund_request_full'
         THEN format('You have "%s" back and the buyer was refunded, so there is no payout for this sale.', COALESCE(v_title, 'your item'))
         ELSE format('The buyer was refunded for "%s", so there is no payout for this sale. The buyer gives the item back; arrange it in Messages.', COALESCE(v_title, 'your item'))
    END,
    '/declutter?view=selling', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund) || jsonb_build_object('refunded_items_cents', v_refunded);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) TO service_role;
