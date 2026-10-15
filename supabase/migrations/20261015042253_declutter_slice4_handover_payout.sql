-- DECLUTTER, SLICE 4 (server half): after the buyer paid. Booking the pickup,
-- the exact address, the handover (QR / 4-digit code / buyer's "I got it" /
-- 24 h auto-pay), porch pickup, no-shows, Declutter's OWN problem reports with
-- an admin decision, the seller's payout (once), refund and payout retry
-- queues for the money edge function, and Declutter's OWN reviews.
-- Owner rows "row N" and build decisions "B<n>" from
-- docs/specs/declutter-auctions.md ("Slice 4 plan"; this slice adds B49-B58).
--
-- NOTHING HERE MOVES MONEY. Rows here say what is owed (declutter_payouts,
-- declutter_refunds); the declutter-money edge function (not built yet)
-- executes them with Stripe (idempotency key = the row id) and reports back
-- with declutter_payout_executed / declutter_refund_executed.
--
-- ONE TRANSITION (B50). A paid order leaves 'paid' exactly once, under its row
-- lock (items first, then the order: the same order as every 3b path), with a
-- status predicate: 'handed_over' (seller paid: scan, code, "I got it", auto,
-- admin) or 'refunded' (no-show, problem decided for the buyer). So a scan, an
-- "I got it", the auto-pay sweep, a no-show and a problem report can never
-- both win, and the payout row (UNIQUE order_id) is written at most once.
--
-- Row 62 (B44): none of these RPCs needs the switch: a sale already paid is
-- handed over, refunded or reviewed with Declutter switched off.
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS. Grants by role
-- name, REVOKE ... FROM PUBLIC, anon. Applied 3x by the PGlite proof
-- (src/test/pglite/declutterSlice4.pglite.mjs).

-- ---------------------------------------------------------------------------
-- 0. Order status gains 'handed_over' (the sale is final, the seller is owed).
DO $do$
BEGIN
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_status_check;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_status_check
    CHECK (status IN ('awaiting_payment', 'paid', 'superseded', 'expired', 'refunded', 'handed_over'));
  ALTER TABLE public.declutter_orders DROP CONSTRAINT IF EXISTS declutter_orders_close_reason;
  ALTER TABLE public.declutter_orders ADD CONSTRAINT declutter_orders_close_reason
    CHECK (close_reason IS NULL OR close_reason IN (
      'superseded', 'session_expired', 'missed_checkout', 'seller_cancelled', 'seller_blocked', 'seller_out',
      'not_payable', 'refunded',
      'handed_over'));   -- slice 4: the sale is final
END
$do$;
ALTER TABLE public.declutter_orders ADD COLUMN IF NOT EXISTS handed_over_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. Refund reasons for slice 4 (B51). The reason still decides the policy
--    and the amount (table CHECK), never the caller:
--   buyer_no_show     -> 'keep_buyer_fee': refund = EXACTLY the item price
--                        (row 95, owner confirmed 2026-10-15); the buyer's fee
--                        (which covers the card fee on a US card, B48) is kept.
--   seller_no_show, not_as_described -> 'full_seller_pays_fee' (rows 19, 60).
--   admin_buyer_fault -> 'keep_buyer_fee' (an admin decided for the buyer but
--                        the buyer caused it; never absorb a fee).
--   admin_no_fault    -> 'keep_card_fee' (nobody's fault: the owner's rule is
--                        that the platform never absorbs a fee).
ALTER TABLE public.declutter_refunds
  ADD COLUMN IF NOT EXISTS kept_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_error text;
DO $do$
BEGIN
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_reason_check CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out', 'seller_no_show', 'not_as_described',
    'buyer_cancelled', 'buyer_restarted_checkout',
    'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault'));
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_fee_policy_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_fee_policy_check
    CHECK (fee_policy IN ('full_platform_absorbs', 'full_seller_pays_fee', 'keep_card_fee', 'keep_buyer_fee'));
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault') THEN 'keep_card_fee'
                      WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                      ELSE 'full_platform_absorbs' END);
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_amount;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_amount CHECK (
    refund_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN paid_cents - card_fee_cents
                        WHEN fee_policy = 'keep_buyer_fee' THEN paid_cents - kept_cents
                        ELSE paid_cents END
    AND refund_cents > 0
    AND kept_cents >= 0
    AND (fee_policy = 'keep_buyer_fee' OR kept_cents = 0)
    AND (fee_policy <> 'keep_buyer_fee' OR kept_cents > 0));
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_attempts;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_attempts CHECK (attempts BETWEEN 0 AND 100);
END
$do$;

-- Record a refund (B40 + B51). Restated from 20261014224914: the slice 4
-- reasons, and keep_buyer_fee keeps EXACTLY the order's buyer's fee
-- (premium_cents); the refund is the item price plus any sales tax. Tax is not
-- a fee and never ours to keep: a refunded sale owes no tax, so it goes back
-- with the price (money review 2.7; the never-absorb rule is about FEES, and
-- the whole buyer's fee is still kept). Every order's tax is 0 today (casual
-- sellers, row 54), so row 95's "exactly the item price" is unchanged.
-- Idempotent per PaymentIntent.
CREATE OR REPLACE FUNCTION public.declutter_record_refund(p_order_id uuid, p_payment_intent_id text, p_reason text,
  p_paid_cents integer, p_card_fee_cents integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_id uuid;
  v_policy text;
  v_fee integer;
  v_kept integer := 0;
  v_seller uuid;
  v_order record;
BEGIN
  SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   ELSE 'full_platform_absorbs' END;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  ELSIF v_policy = 'keep_buyer_fee' THEN
    SELECT o.items_cents, o.premium_cents, o.tax_cents INTO v_order FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_order.premium_cents IS NULL OR v_order.premium_cents <= 0
       OR p_paid_cents IS DISTINCT FROM v_order.items_cents + v_order.premium_cents + v_order.tax_cents THEN
      -- Only a whole paid order can keep its fee; anything else is a bug, never a guess.
      RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
    END IF;
    v_kept := v_order.premium_cents;
  END IF;
  INSERT INTO public.declutter_refunds (order_id, stripe_payment_intent_id, reason, fee_policy, paid_cents, card_fee_cents,
                                        kept_cents, refund_cents)
  VALUES (p_order_id, p_payment_intent_id, p_reason, v_policy, p_paid_cents, v_fee, v_kept,
          CASE WHEN v_policy = 'keep_card_fee' THEN p_paid_cents - v_fee
               WHEN v_policy = 'keep_buyer_fee' THEN p_paid_cents - v_kept
               ELSE p_paid_cents END)
  ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT r.id INTO v_id FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id;
    RETURN v_id;
  END IF;
  IF v_policy = 'full_seller_pays_fee' AND v_fee > 0 THEN
    SELECT o.seller_id INTO v_seller FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_seller IS NOT NULL THEN
      INSERT INTO public.declutter_seller_fee_debts (seller_id, refund_id, amount_cents, remaining_cents)
      VALUES (v_seller, v_id, v_fee, v_fee)
      ON CONFLICT (refund_id) DO NOTHING;
    END IF;
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_refund(uuid, text, text, integer, integer) TO service_role;

-- What Stripe did with a refund row (restated from 20261014224914): a
-- succeeded row is final; a failure counts an attempt and backs off (B57).
CREATE OR REPLACE FUNCTION public.declutter_refund_executed(p_refund_id uuid, p_stripe_refund_id text, p_succeeded boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  UPDATE public.declutter_refunds
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_refund_ref = COALESCE(p_stripe_refund_id, stripe_refund_ref),
         executed_at = now(),
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_refund_id AND status <> 'succeeded'
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_refunds WHERE id = p_refund_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) TO service_role;

-- Which Stripe mode took the payment a refund row belongs to (money review
-- 3.6). The webhook records it from event.livemode when it writes the row;
-- declutter-money then refunds on THAT key. Without it an ORDERLESS refund row
-- (order_missing: no order, so no parties) was refunded on the live key even
-- when a test-mode payment made it. NULL = not recorded (rows written before
-- this, or a write that failed): the cron then decides by the parties and
-- refuses an orderless row rather than guess.
ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS payment_livemode boolean;
CREATE OR REPLACE FUNCTION public.declutter_refund_set_mode(p_refund_id uuid, p_livemode boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_mode boolean;
BEGIN
  IF p_livemode IS NULL THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = '22023';
  END IF;
  -- Set once: a later call with the other mode is a bug, never a rewrite.
  UPDATE public.declutter_refunds SET payment_livemode = p_livemode WHERE id = p_refund_id AND payment_livemode IS NULL;
  SELECT r.payment_livemode INTO v_mode FROM public.declutter_refunds r WHERE r.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_mode IS DISTINCT FROM p_livemode THEN
    RAISE EXCEPTION 'refund_mode_conflict' USING ERRCODE = '55000';
  END IF;
  RETURN v_mode;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_set_mode(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_set_mode(uuid, boolean) TO service_role;

-- Stripe moved a refund it had taken to failed / canceled (charge.refund.updated;
-- the money never left). Only the refund the row RECORDED reopens it (an older
-- failed attempt's late event changes nothing): the row goes back to 'failed',
-- due now, so declutter-money sends a NEW refund under a new key (its reconcile
-- never adopts a failed refund).
-- The reversal COUNTS as a try (lh-money-escrow re-review should-fix 1): a
-- refund Stripe takes and then fails usually fails for a reason a new refund
-- to the same card repeats (closed or expired card), so an uncounted reversal
-- could loop forever, a new refund and a critical page every 10 minutes. The
-- 12-try cap (declutter_refunds_due offers attempts < 12) stays the one bound;
-- when this reversal reaches it the row is NOT offered again and the answer
-- is 'gave_up', so the webhook pages "refund it by hand" instead of promising
-- a new refund. Returns 'reopened', 'gave_up' or 'unchanged'.
CREATE OR REPLACE FUNCTION public.declutter_refund_reversed(p_refund_id uuid, p_stripe_refund_id text, p_why text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE public.declutter_refunds
     SET status = 'failed', attempts = least(attempts + 1, 100), next_attempt_at = now(),
         last_error = left('Stripe moved refund ' || p_stripe_refund_id || ' to ' || COALESCE(p_why, 'failed'), 500)
   WHERE id = p_refund_id AND stripe_refund_ref = p_stripe_refund_id AND status = 'succeeded'
  RETURNING attempts INTO v_attempts;
  IF NOT FOUND THEN
    RETURN 'unchanged';
  END IF;
  -- Same cap as declutter_refunds_due (attempts < 12).
  RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_reversed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_reversed(uuid, text, text) TO service_role;

-- The answer the webhook acts on (restated from 20261014224914) now carries the
-- row's order_id (lh-money-escrow re-review should-fix 2): the webhook and
-- declutter-money both send refunds.create under `declutter-refund-<row id>`,
-- and Stripe refuses a reused key with other parameters. Both now build the
-- metadata from the ROW (order_id NULL -> ""), never from the Checkout page's
-- metadata (an order_missing row has no order, while its page still names one).
-- VOLATILE on purpose: it reads the row declutter_record_refund just wrote.
CREATE OR REPLACE FUNCTION public.declutter_refund_answer(p_refund_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object('result', 'refund', 'refund_id', r.id, 'reason', r.reason, 'fee_policy', r.fee_policy,
                            'refund_cents', r.refund_cents, 'refund_status', r.status, 'order_id', r.order_id)
    FROM public.declutter_refunds r WHERE r.id = p_refund_id;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_answer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_answer(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Tables.
-- Booking (rows 14, 52, 97, 98; B49). One per paid order. A slot is 30 min,
-- inside one of the seller's pickup windows (America/Chicago), before the
-- 7-day pickup deadline. Each side may reschedule once; a buyer who missed
-- once may rebook once (row 95).
CREATE TABLE IF NOT EXISTS public.declutter_bookings (
  order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  buyer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  seller_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_start timestamptz,           -- NULL after a buyer no-show until the rebook
  slot_end timestamptz,
  porch_mode text CHECK (porch_mode IS NULL OR porch_mode IN ('all_day', 'until')),
  porch_until timestamptz,
  buyer_reschedules smallint NOT NULL DEFAULT 0 CHECK (buyer_reschedules BETWEEN 0 AND 1),
  seller_reschedules smallint NOT NULL DEFAULT 0 CHECK (seller_reschedules BETWEEN 0 AND 1),
  buyer_missed_at timestamptz,      -- the first buyer no-show (row 95)
  buyer_rebooked boolean NOT NULL DEFAULT false,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_bookings_slot CHECK ((slot_start IS NULL) = (slot_end IS NULL)
                                           AND (slot_start IS NULL OR slot_end = slot_start + interval '30 minutes')),
  CONSTRAINT declutter_bookings_porch CHECK (
    (porch_mode IS NULL AND porch_until IS NULL) OR (porch_mode = 'all_day' AND porch_until IS NULL)
    OR (porch_mode = 'until' AND porch_until IS NOT NULL)),
  CONSTRAINT declutter_bookings_rebook CHECK (NOT buyer_rebooked OR buyer_missed_at IS NOT NULL),
  CONSTRAINT declutter_bookings_not_own CHECK (buyer_id <> seller_id)
);
CREATE INDEX IF NOT EXISTS declutter_bookings_buyer_idx ON public.declutter_bookings (buyer_id);
CREATE INDEX IF NOT EXISTS declutter_bookings_seller_idx ON public.declutter_bookings (seller_id);
CREATE INDEX IF NOT EXISTS declutter_bookings_due_idx ON public.declutter_bookings (slot_start) WHERE slot_start IS NOT NULL;
ALTER TABLE public.declutter_bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.declutter_bookings TO authenticated;
GRANT ALL ON TABLE public.declutter_bookings TO service_role;
DROP POLICY IF EXISTS "declutter bookings: the two sides read" ON public.declutter_bookings;
CREATE POLICY "declutter bookings: the two sides read" ON public.declutter_bookings
  FOR SELECT TO authenticated
  USING (buyer_id = (SELECT auth.uid()) OR seller_id = (SELECT auth.uid()));

-- Handover (rows 25, 26, 28; B50, B52). The 4-digit code is shown to the buyer
-- only (declutter_my_handover); the QR encodes order id + code. No client
-- privilege on this table at all: the code must never reach the seller.
CREATE TABLE IF NOT EXISTS public.declutter_handovers (
  order_id uuid PRIMARY KEY REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[0-9]{4}$'),
  wrong_attempts smallint NOT NULL DEFAULT 0 CHECK (wrong_attempts BETWEEN 0 AND 5),
  confirmed_at timestamptz,
  confirmed_by text CHECK (confirmed_by IS NULL OR confirmed_by IN ('scan', 'code', 'buyer', 'porch', 'auto', 'admin')),
  -- Porch (row 26): the seller's "set out" photo, the buyer's "picked up" photo + how far from the address.
  set_out_photo_path text,
  set_out_at timestamptz,
  picked_up_photo_path text,
  picked_up_at timestamptz,
  picked_up_distance_m integer CHECK (picked_up_distance_m IS NULL OR picked_up_distance_m >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_handovers_confirmed CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
  CONSTRAINT declutter_handovers_set_out CHECK ((set_out_at IS NULL) = (set_out_photo_path IS NULL)),
  CONSTRAINT declutter_handovers_picked_up CHECK ((picked_up_at IS NULL) = (picked_up_photo_path IS NULL))
);
ALTER TABLE public.declutter_handovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_handovers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_handovers TO service_role;

-- Problems (rows 15, 67, 96; B54). Declutter's OWN table (lead 2026-10-15: the
-- job disputes table keys on job_id NOT NULL and stays untouched). Either side,
-- any time until the seller is paid. An open problem holds the money.
CREATE TABLE IF NOT EXISTS public.declutter_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_side text NOT NULL CHECK (reporter_side IN ('buyer', 'seller')),
  reason text NOT NULL CHECK (reason IN ('not_as_described', 'damaged', 'not_received', 'no_show', 'safety', 'other')),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000),
  photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 6),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided')),
  decision text CHECK (decision IS NULL OR decision IN ('refund_buyer', 'pay_seller')),
  fault text CHECK (fault IS NULL OR fault IN ('seller', 'buyer', 'none')),
  strike_given boolean NOT NULL DEFAULT false,
  admin_note text CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_problems_decided CHECK (
    (status = 'open' AND decision IS NULL AND fault IS NULL AND decided_at IS NULL)
    OR (status = 'decided' AND decision IS NOT NULL AND fault IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS declutter_problems_order_idx ON public.declutter_problems (order_id);
CREATE INDEX IF NOT EXISTS declutter_problems_reporter_idx ON public.declutter_problems (reporter_id);
CREATE INDEX IF NOT EXISTS declutter_problems_decided_by_idx ON public.declutter_problems (decided_by);
-- One open problem per order.
CREATE UNIQUE INDEX IF NOT EXISTS declutter_problems_one_open ON public.declutter_problems (order_id) WHERE status = 'open';
ALTER TABLE public.declutter_problems ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_problems FROM PUBLIC, anon, authenticated;
-- Every column but decided_by: members never learn which admin decided (lh-authz-rls review 2.3).
GRANT SELECT (id, order_id, reporter_id, reporter_side, reason, note, photo_paths, status, decision, fault,
              strike_given, admin_note, decided_at, is_seed, created_at) ON TABLE public.declutter_problems TO authenticated;
GRANT ALL ON TABLE public.declutter_problems TO service_role;
DROP POLICY IF EXISTS "declutter problems: the two sides and admins read" ON public.declutter_problems;
CREATE POLICY "declutter problems: the two sides and admins read" ON public.declutter_problems
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin')
         OR EXISTS (SELECT 1 FROM public.declutter_orders o
                     WHERE o.id = declutter_problems.order_id
                       AND (o.buyer_id = (SELECT auth.uid()) OR o.seller_id = (SELECT auth.uid()))));

-- Payouts (rows 22, 93; B53). One per order, ever (UNIQUE order_id). amount =
-- items - the seller's card-fee debt taken from it. A row is written even when
-- the debt took everything ('nothing_due'), so the answer is stable (3b money
-- review #8).
CREATE TABLE IF NOT EXISTS public.declutter_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
  seller_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  items_cents integer NOT NULL CHECK (items_cents > 0),
  debt_cents integer NOT NULL CHECK (debt_cents >= 0),
  amount_cents integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'nothing_due')),
  stripe_transfer_id text UNIQUE CHECK (stripe_transfer_id IS NULL OR stripe_transfer_id ~ '^tr_'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  CONSTRAINT declutter_payouts_amount CHECK (amount_cents = items_cents - debt_cents AND amount_cents >= 0),
  CONSTRAINT declutter_payouts_nothing_due CHECK ((status = 'nothing_due') = (amount_cents = 0)),
  CONSTRAINT declutter_payouts_transfer CHECK (status <> 'succeeded' OR stripe_transfer_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS declutter_payouts_seller_idx ON public.declutter_payouts (seller_id);
CREATE INDEX IF NOT EXISTS declutter_payouts_due_idx ON public.declutter_payouts (next_attempt_at) WHERE status IN ('pending', 'failed');
ALTER TABLE public.declutter_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, order_id, seller_id, items_cents, debt_cents, amount_cents, status, created_at, executed_at)
  ON TABLE public.declutter_payouts TO authenticated;
GRANT ALL ON TABLE public.declutter_payouts TO service_role;
DROP POLICY IF EXISTS "declutter payouts: seller reads own" ON public.declutter_payouts;
CREATE POLICY "declutter payouts: seller reads own" ON public.declutter_payouts
  FOR SELECT TO authenticated USING (seller_id = (SELECT auth.uid()));

-- Reviews (row 45; B58). Declutter's OWN table (lead 2026-10-15), both ways
-- after handover, hidden until both reviewed or 14 days passed (the job rule).
CREATE TABLE IF NOT EXISTS public.declutter_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewee_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_side text NOT NULL CHECK (reviewer_side IN ('buyer', 'seller')),
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_reviews_once UNIQUE (order_id, reviewer_side)
);
CREATE INDEX IF NOT EXISTS declutter_reviews_reviewee_idx ON public.declutter_reviews (reviewee_id);
CREATE INDEX IF NOT EXISTS declutter_reviews_reviewer_idx ON public.declutter_reviews (reviewer_id);
ALTER TABLE public.declutter_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_reviews TO service_role;
-- No client SELECT: the blind period is enforced by declutter_visible_reviews().

-- is_seed at birth (B16's rule) for the new order-keyed tables.
CREATE OR REPLACE FUNCTION public.declutter_order_rows_seed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.is_seed := COALESCE((SELECT o.is_seed FROM public.declutter_orders o WHERE o.id = NEW.order_id), false);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_rows_seed() FROM PUBLIC, anon, authenticated;
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['declutter_bookings', 'declutter_problems', 'declutter_payouts', 'declutter_reviews'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_seed ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_seed BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.declutter_order_rows_seed()', t, t);
  END LOOP;
END
$do$;

-- Q807: an account whose email is unconfirmed cannot write the new tables either
-- (the same call slices 1, 3 and 3b make after their CREATE TABLEs; it skips a
-- table that already has the trigger, so a replay is a no-op).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 3. Internals (service only).

-- Lock an order the one way every path does: its items, then the order.
CREATE OR REPLACE FUNCTION public.declutter_lock_order(p_order_id uuid)
RETURNS public.declutter_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
BEGIN
  PERFORM 1 FROM public.declutter_items i
   WHERE i.id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = p_order_id)
   ORDER BY i.id FOR UPDATE;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN o;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_lock_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_lock_order(uuid) TO service_role;

-- A fresh 4-digit handover code. From a CSPRNG (authz review 2.6): random() is
-- a seeded PRNG whose state other sessions' draws can reveal, so the code is
-- taken from the first 32 bits of gen_random_uuid() (core PG13+, strong random
-- source; those bits are never the v4 version/variant bits). 2^32 mod 10000
-- gives a bias below 1 in 400,000 per code, far under the 5-try lock.
CREATE OR REPLACE FUNCTION public.declutter_new_handover_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 10000)::text, 4, '0');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_new_handover_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_new_handover_code() TO service_role;

-- The handover (B50). Caller holds the lock. paid -> handed_over exactly once;
-- writes the payout row (once, UNIQUE) with the seller's fee debt taken out.
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
  INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
  ON CONFLICT (order_id) DO NOTHING;
  UPDATE public.declutter_handovers SET confirmed_at = now(), confirmed_by = p_by WHERE order_id = o.id AND confirmed_at IS NULL;
  UPDATE public.declutter_orders SET status = 'handed_over', close_reason = 'handed_over', handed_over_at = now(), closed_at = now()
   WHERE id = o.id AND status = 'paid';
  UPDATE public.declutter_items SET status = 'completed', updated_at = now()
   WHERE id IN (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id AND c.status = 'paid')
     AND status = 'sold';
  v_debt := public.declutter_consume_fee_debt(o.seller_id, 'declutter_order_' || o.id::text, o.items_cents);
  INSERT INTO public.declutter_payouts (order_id, seller_id, items_cents, debt_cents, amount_cents, status)
  VALUES (o.id, o.seller_id, o.items_cents, v_debt, o.items_cents - v_debt,
          CASE WHEN o.items_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_payout;
  -- The words depend on what is due and whether the seller can be paid (lh-money-escrow review 2.1).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    CASE
      WHEN o.items_cents - v_debt = 0 THEN
        format('This sale paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format('Set up payouts in Settings to get your $%s. We send it as soon as you do.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('$%s is on its way to your payout account.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?view=sales', o.buyer_id);
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Enjoy your item',
    'The handover is done and the sale is final. Leave the seller a review.', '/declutter?view=cart', o.seller_id);
  RETURN jsonb_build_object('result', 'handed_over', 'payout_id', v_payout, 'by', p_by);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_complete_handover(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_complete_handover(uuid, text) TO service_role;

-- Close a paid order with a refund (B51, B55). Caller holds the lock.
-- p_strike_side names who gets a strike (NULL = nobody). Seller fault: items
-- withdrawn; otherwise relisted free (rows 18, 95).
CREATE OR REPLACE FUNCTION public.declutter_close_paid_order(p_order_id uuid, p_reason text, p_strike_side text,
  p_strike_reason text, p_why text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  o public.declutter_orders;
  v_refund uuid;
  v_seller_fault boolean := p_reason IN ('seller_no_show', 'not_as_described', 'seller_backed_out');
  r record;
  v_struck boolean := false;
BEGIN
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF o.status IS DISTINCT FROM 'paid' OR o.stripe_payment_intent_id IS NULL THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_payouts p WHERE p.order_id = o.id) THEN
    RAISE EXCEPTION 'already_paid_out' USING ERRCODE = '55000';
  END IF;
  v_refund := public.declutter_record_refund(o.id, o.stripe_payment_intent_id, p_reason, o.total_cents, o.card_fee_cents);
  UPDATE public.declutter_orders SET status = 'refunded', close_reason = 'refunded', closed_at = now() WHERE id = o.id;
  FOR r IN
    UPDATE public.declutter_cart_items c
       SET status = CASE WHEN v_seller_fault THEN 'cancelled_by_seller' ELSE 'missed' END, closed_at = now()
     WHERE c.order_id = o.id AND c.status = 'paid'
    RETURNING c.item_id, c.id
  LOOP
    UPDATE public.declutter_items SET status = CASE WHEN v_seller_fault THEN 'withdrawn' ELSE 'live' END, updated_at = now()
     WHERE id = r.item_id AND status = 'sold';
    -- One strike per order, recorded against its first line.
    IF p_strike_side IS NOT NULL AND NOT v_struck THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_strike_side = 'seller' THEN o.seller_id ELSE o.buyer_id END,
        p_strike_side, p_strike_reason, r.item_id, p_why, r.id);
      v_struck := true;
    END IF;
  END LOOP;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Refund on its way',
    CASE WHEN v_seller_fault
         THEN format('All $%s is coming back to your card.', to_char(o.total_cents / 100.0, 'FM999990.00'))
         WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault')
         THEN format(CASE WHEN o.tax_cents > 0 THEN 'The item price and its tax, $%s, is coming back to your card. Your buyer''s fee is not refunded.'
                          ELSE 'The item price, $%s, is coming back to your card. Your buyer''s fee is not refunded.' END,
                     to_char((o.items_cents + o.tax_cents) / 100.0, 'FM999990.00'))
         ELSE 'Your refund is on its way. The card fee is not refunded.' END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Sale cancelled',
    CASE WHEN v_seller_fault THEN 'This sale was cancelled and the buyer refunded.'
         ELSE 'This sale was cancelled and the buyer refunded. Your item is back on sale.' END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_close_paid_order(uuid, text, text, text, text) TO service_role;

-- Is a 30-minute slot starting at p_start inside one of the seller's windows
-- (local Louisiana time, same day)?
CREATE OR REPLACE FUNCTION public.declutter_slot_in_windows(p_seller uuid, p_start timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.declutter_pickup_windows w
     WHERE w.seller_id = p_seller
       AND w.weekday = extract(dow FROM (p_start AT TIME ZONE 'America/Chicago'))::smallint
       AND (p_start AT TIME ZONE 'America/Chicago')::time >= w.starts_local
       AND w.ends_local >= w.starts_local + interval '30 minutes'
       AND (p_start AT TIME ZONE 'America/Chicago')::time <= w.ends_local - interval '30 minutes');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_slot_in_windows(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_slot_in_windows(uuid, timestamptz) TO service_role;

-- The caller's side of an order ('buyer' / 'seller' / NULL).
CREATE OR REPLACE FUNCTION public.declutter_order_side(p_buyer uuid, p_seller uuid, p_uid uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN p_uid IS NULL THEN NULL WHEN p_buyer = p_uid THEN 'buyer' WHEN p_seller = p_uid THEN 'seller' END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_order_side(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_order_side(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Member RPCs. Each VOLATILE one names is_caller_banned() in its own body
--    (Q281 class check). None needs the switch (row 62). Anyone who is not a
--    side of the order gets 'item_not_found' (never told it exists).

-- Book (or move) the pickup (rows 14, 52, 98; B49). The buyer books inside
-- the seller's pickup times; either side may move it once (the seller any
-- time before the deadline: the windows are theirs); a buyer who missed once
-- rebooks once (row 95).
CREATE OR REPLACE FUNCTION public.declutter_book_pickup(p_order_id uuid, p_slot_start timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  v_side text;
  v_kind text;
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
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  IF p_slot_start IS NULL OR p_slot_start <= now() OR p_slot_start + interval '30 minutes' > o.paid_at + interval '7 days' THEN
    RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023',
      HINT = 'Pick a time in the future, before the 7-day pickup deadline.';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF v_side = 'buyer' THEN
    IF NOT public.declutter_slot_in_windows(o.seller_id, p_slot_start) THEN
      RAISE EXCEPTION 'invalid_slot' USING ERRCODE = '22023', HINT = 'Pick a time inside the seller''s pickup times.';
    END IF;
    IF b.order_id IS NULL THEN
      v_kind := 'booked';
    ELSIF b.slot_start IS NULL THEN
      IF b.buyer_rebooked THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000';
      END IF;
      v_kind := 'rebooked';
    ELSE
      IF b.buyer_reschedules >= 1 THEN
        RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
      END IF;
      v_kind := 'rescheduled';
    END IF;
  ELSE
    IF b.order_id IS NULL OR b.slot_start IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000', HINT = 'The buyer books the pickup first.';
    END IF;
    IF b.seller_reschedules >= 1 THEN
      RAISE EXCEPTION 'reschedule_used' USING ERRCODE = '55000', HINT = 'You already moved this pickup once.';
    END IF;
    v_kind := 'seller_rescheduled';
  END IF;
  IF b.order_id IS NULL THEN
    INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
    VALUES (o.id, o.buyer_id, o.seller_id, p_slot_start, p_slot_start + interval '30 minutes');
    INSERT INTO public.declutter_handovers (order_id, code) VALUES (o.id, public.declutter_new_handover_code())
    ON CONFLICT (order_id) DO NOTHING;
  ELSE
    UPDATE public.declutter_bookings
       SET slot_start = p_slot_start, slot_end = p_slot_start + interval '30 minutes', updated_at = now(),
           -- a moved porch slot asks the seller again (row 97)
           porch_mode = NULL, porch_until = NULL,
           buyer_reschedules = buyer_reschedules + CASE WHEN v_kind = 'rescheduled' THEN 1 ELSE 0 END,
           seller_reschedules = seller_reschedules + CASE WHEN v_kind = 'seller_rescheduled' THEN 1 ELSE 0 END,
           buyer_rebooked = buyer_rebooked OR v_kind = 'rebooked'
     WHERE order_id = o.id;
  END IF;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'payment',
    CASE v_kind WHEN 'booked' THEN 'Pickup booked' ELSE 'Pickup time changed' END,
    format('Pickup is %s.', to_char(p_slot_start AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END,
    v_uid);
  RETURN jsonb_build_object('result', v_kind, 'slot_start', p_slot_start);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_book_pickup(uuid, timestamptz) TO authenticated, service_role;

-- Porch timing (row 97): the seller says "out all day" or "out until <time>"
-- (same Louisiana day, after the booked slot).
CREATE OR REPLACE FUNCTION public.declutter_set_porch_time(p_order_id uuid, p_mode text, p_until timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF b.order_id IS NULL OR b.slot_start IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF p_mode = 'all_day' THEN
    p_until := NULL;
  ELSIF p_mode = 'until' THEN
    IF p_until IS NULL OR p_until < b.slot_end
       OR (p_until AT TIME ZONE 'America/Chicago')::date <> (b.slot_start AT TIME ZONE 'America/Chicago')::date THEN
      RAISE EXCEPTION 'invalid_porch_time' USING ERRCODE = '22023',
        HINT = 'Pick a time after the booked pickup, on the same day.';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid_porch_time' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_bookings SET porch_mode = p_mode, porch_until = p_until, updated_at = now() WHERE order_id = o.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_set_porch_time(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_set_porch_time(uuid, text, timestamptz) TO authenticated, service_role;

-- The handover card (row 25). The BUYER gets the 4-digit code and the QR
-- payload; the seller never gets the code from here (they type or scan it).
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
  RETURN jsonb_build_object(
    'order_id', o.id, 'status', o.status, 'side', v_side,
    'code', CASE WHEN v_side = 'buyer' AND o.status = 'paid' THEN h.code END,
    'qr', CASE WHEN v_side = 'buyer' AND o.status = 'paid' AND h.code IS NOT NULL
               THEN 'lhdeclutter:' || o.id::text || ':' || h.code END,
    'code_locked', COALESCE(h.wrong_attempts, 0) >= 5,
    'confirmed_by', h.confirmed_by, 'confirmed_at', h.confirmed_at,
    'set_out_at', h.set_out_at, 'set_out_photo_path', h.set_out_photo_path,
    'picked_up_at', h.picked_up_at, 'picked_up_photo_path', h.picked_up_photo_path);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_my_handover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_my_handover(uuid) TO authenticated, service_role;

-- Confirm the handover (rows 25, 28, 93; B50, B52). The SELLER scans the
-- buyer's QR ('scan') or types the 4 digits ('code'); the BUYER taps "I got
-- it" ('buyer'). Wrong codes are counted and RETURNED (not raised, so the
-- count survives); 5 wrong = locked, the buyer taps "I got it" instead.
CREATE OR REPLACE FUNCTION public.declutter_confirm_handover(p_order_id uuid, p_method text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  h public.declutter_handovers;
  v_side text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('scan', 'code', 'buyer') THEN
    RAISE EXCEPTION 'invalid_method' USING ERRCODE = '22023';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF (p_method = 'buyer') <> (v_side = 'buyer') THEN
    -- the buyer cannot "scan" themself paid; the seller cannot tap "I got it"
    RAISE EXCEPTION 'wrong_side' USING ERRCODE = '42501';
  END IF;
  IF p_method IN ('scan', 'code') THEN
    SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id FOR UPDATE;
    IF h.order_id IS NULL THEN
      RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
    END IF;
    IF h.wrong_attempts >= 5 THEN
      RETURN jsonb_build_object('result', 'code_locked');
    END IF;
    IF p_code IS NULL OR p_code IS DISTINCT FROM h.code THEN
      UPDATE public.declutter_handovers SET wrong_attempts = wrong_attempts + 1 WHERE order_id = o.id;
      RETURN jsonb_build_object('result', 'wrong_code', 'attempts_left', 4 - h.wrong_attempts);
    END IF;
  END IF;
  RETURN public.declutter_complete_handover(o.id, p_method);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_confirm_handover(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_confirm_handover(uuid, text, text) TO authenticated, service_role;

-- Porch photos (row 26; B52). Seller: "Set out" photo. Buyer: "Picked up"
-- photo taken at the pickup point (<= 200 m from the private address; the
-- distance is stored, never the address). Paths live in job-photos under
-- <uid>/declutter/handover/<order>/<file> and must exist.
-- Owner 2026-10-15: the buyer's "Picked up" photo + tap PAYS THE SELLER RIGHT
-- AWAY (same as "I got it"); the 24 h auto-pay only covers buyers who never
-- tap. An open problem still holds the money: the photo is kept, nobody is
-- paid, and the admin decides (paid = false in the result).
CREATE OR REPLACE FUNCTION public.declutter_porch_photo(p_order_id uuid, p_photo_path text, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_m integer;
  v_done jsonb;
BEGIN
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status = 'handed_over' AND o.handover = 'porch' THEN
    RETURN jsonb_build_object('result', 'already_handed_over');
  END IF;
  IF o.status <> 'paid' OR o.handover <> 'porch' THEN
    RAISE EXCEPTION 'not_a_porch_pickup' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL) THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) IS DISTINCT FROM v_uid::text
     OR split_part(p_photo_path, '/', 2) IS DISTINCT FROM 'declutter'
     OR split_part(p_photo_path, '/', 3) IS DISTINCT FROM 'handover'
     OR split_part(p_photo_path, '/', 4) IS DISTINCT FROM o.id::text
     OR split_part(p_photo_path, '/', 5) = ''
     OR split_part(p_photo_path, '/', 6) <> ''
     OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'job-photos' AND so.name = p_photo_path) THEN
    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
  END IF;
  IF v_side = 'seller' THEN
    UPDATE public.declutter_handovers SET set_out_photo_path = p_photo_path, set_out_at = now() WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your item is on the porch',
      'The seller set your item out. Take a photo when you pick it up.', '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'set_out');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'location_required' USING ERRCODE = '22023';
  END IF;
  -- Haversine, metres, to the NEAREST pickup point of ANY item in the order
  -- (authz review 2.7: the exact address is per item, so a multi-item order
  -- may have more than one; the first item alone refused a buyer standing at
  -- another item's address).
  SELECT min(round(2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians((p_lat - p.pickup_lat) / 2)), 2)
           + cos(radians(p.pickup_lat)) * cos(radians(p_lat)) * power(sin(radians((p_lng - p.pickup_lng) / 2)), 2)))))::integer)
    INTO v_m
    FROM public.declutter_cart_items c
    JOIN public.declutter_item_private p ON p.item_id = c.item_id
   WHERE c.order_id = o.id AND p.pickup_lat IS NOT NULL AND p.pickup_lng IS NOT NULL;
  IF v_m IS NULL OR v_m > 200 THEN
    RAISE EXCEPTION 'not_at_pickup' USING ERRCODE = '22023', HINT = 'Take the photo at the pickup address.';
  END IF;
  UPDATE public.declutter_handovers
     SET picked_up_photo_path = p_photo_path, picked_up_at = now(), picked_up_distance_m = v_m
   WHERE order_id = o.id;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    PERFORM public.declutter_notify(o.seller_id, 'payment', 'Your item was picked up',
      'The buyer picked up the item from your porch. A problem report is open, so Louisiana Helpr decides before anyone is paid.',
      '/declutter?view=sales', o.buyer_id);
    RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', false);
  END IF;
  v_done := public.declutter_complete_handover(o.id, 'porch');
  RETURN jsonb_build_object('result', 'picked_up', 'distance_m', v_m, 'paid', true, 'payout_id', v_done->'payout_id');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_porch_photo(uuid, text, numeric, numeric) TO authenticated, service_role;

-- "They didn't show" (rows 94, 95, 19, 97; B55). By the waiting side, 15 min
-- after the booked time (porch: the seller after their "out until", or the end
-- of that Louisiana day for "out all day"; the buyer only if no set-out photo).
--   Seller reports the buyer: first miss = the buyer may rebook once before the
--   7-day deadline; second miss (or no time left) = refund of EXACTLY the item
--   price (buyer_no_show), 1 buyer strike, items relisted free.
--   Buyer reports the seller: full refund (seller_no_show; the card fee is the
--   seller's debt, row 60), 1 seller strike.
CREATE OR REPLACE FUNCTION public.declutter_report_no_show(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  b public.declutter_bookings;
  h public.declutter_handovers;
  v_side text;
  v_from timestamptz;
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
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO b FROM public.declutter_bookings WHERE order_id = o.id FOR UPDATE;
  IF b.order_id IS NULL OR b.slot_start IS NULL THEN
    RAISE EXCEPTION 'not_booked_yet' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO h FROM public.declutter_handovers WHERE order_id = o.id;
  v_from := b.slot_start + interval '15 minutes';
  IF o.handover = 'porch' AND v_side = 'seller' THEN
    IF h.picked_up_at IS NOT NULL THEN
      RAISE EXCEPTION 'already_picked_up' USING ERRCODE = '55000';
    END IF;
    v_from := COALESCE(b.porch_until,
      ((b.slot_start AT TIME ZONE 'America/Chicago')::date + 1)::timestamp AT TIME ZONE 'America/Chicago');
  ELSIF o.handover = 'porch' AND v_side = 'buyer' AND h.set_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'seller_set_out' USING ERRCODE = '55000',
      HINT = 'The seller set the item out. If it is not there, report a problem.';
  END IF;
  IF now() < v_from THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = '55000', HINT = 'Wait 15 minutes after the booked time.';
  END IF;
  IF v_side = 'buyer' THEN
    RETURN public.declutter_close_paid_order(o.id, 'seller_no_show', 'seller', 'seller_no_show',
      'You did not show up for a booked Declutter pickup. The buyer got everything back; the card fee comes out of your next Declutter payout.');
  END IF;
  IF b.buyer_missed_at IS NULL AND now() + interval '30 minutes' <= o.paid_at + interval '7 days' THEN
    UPDATE public.declutter_bookings
       SET buyer_missed_at = now(), slot_start = NULL, slot_end = NULL, porch_mode = NULL, porch_until = NULL, updated_at = now()
     WHERE order_id = o.id;
    PERFORM public.declutter_notify(o.buyer_id, 'warning', 'You missed your pickup',
      'The seller says you did not show up. You can book one new time before your 7-day pickup deadline. Miss again and the sale is cancelled with a strike.',
      '/declutter?view=cart', o.seller_id);
    RETURN jsonb_build_object('result', 'buyer_may_rebook');
  END IF;
  RETURN public.declutter_close_paid_order(o.id, 'buyer_no_show', 'buyer', 'not_picked_up',
    'You missed a booked Declutter pickup again. The item price was refunded; the buyer''s fee was not.');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_report_no_show(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_no_show(uuid) TO authenticated, service_role;

-- "Report a problem" (rows 15, 67, 96; B54): either side, until the seller is
-- paid. Holds the money until an admin decides. A second report while one is
-- open returns the open one.
CREATE OR REPLACE FUNCTION public.declutter_report_problem(p_order_id uuid, p_reason text, p_note text, p_photo_paths text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_id uuid;
  v_path text;
  a record;
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
    RAISE EXCEPTION 'sale_final' USING ERRCODE = '55000', HINT = 'The seller was paid, so this sale is final.';
  END IF;
  IF o.status <> 'paid' THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = '55000';
  END IF;
  SELECT p.id INTO v_id FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open';
  IF FOUND THEN
    RETURN v_id;
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('not_as_described', 'damaged', 'not_received', 'no_show', 'safety', 'other') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell us what happened (up to 1,000 characters).';
  END IF;
  IF cardinality(COALESCE(p_photo_paths, '{}')) > 6 THEN
    RAISE EXCEPTION 'too_many_photos' USING ERRCODE = '22023';
  END IF;
  FOREACH v_path IN ARRAY COALESCE(p_photo_paths, '{}') LOOP
    IF v_path IS NULL
       OR split_part(v_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(v_path, '/', 2) IS DISTINCT FROM 'declutter'
       OR split_part(v_path, '/', 3) IS DISTINCT FROM 'problem'
       OR split_part(v_path, '/', 4) IS DISTINCT FROM o.id::text
       OR split_part(v_path, '/', 5) = ''
       OR split_part(v_path, '/', 6) <> ''
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'job-photos' AND so.name = v_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
  VALUES (o.id, v_uid, v_side, p_reason, btrim(p_note), COALESCE(p_photo_paths, '{}'))
  RETURNING id INTO v_id;
  PERFORM public.declutter_notify(CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, 'warning',
    'A problem was reported on your sale',
    'The money stays held until Louisiana Helpr looks at it. We may ask you for photos.',
    '/declutter?view=' || CASE WHEN v_side = 'buyer' THEN 'sales' ELSE 'cart' END, v_uid);
  FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter problem reported',
      'A buyer or seller reported a problem on a paid sale. The money is held until you decide it.', '/admin');
  END LOOP;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_report_problem(uuid, text, text, text[]) TO authenticated, service_role;

-- Admin decides a problem (row 67; B54). 'refund_buyer' by fault: seller ->
-- full refund, card fee to the seller's debt (not_as_described); buyer -> the
-- item price back, buyer's fee kept (admin_buyer_fault); none -> refund minus
-- the card fee (admin_no_fault; never absorb a fee). 'pay_seller' -> the
-- handover completes ('admin'). p_strike gives the at-fault side a strike.
-- A split (part refund, part payout) is NOT built: one refund per payment.
CREATE OR REPLACE FUNCTION public.declutter_admin_decide_problem(p_problem_id uuid, p_decision text, p_fault text,
  p_strike boolean, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  p public.declutter_problems;
  o public.declutter_orders;
  v_order uuid;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('refund_buyer', 'pay_seller')
     OR p_fault IS NULL OR p_fault NOT IN ('seller', 'buyer', 'none')
     OR p_strike IS NULL OR (p_strike AND p_fault = 'none') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_problems x WHERE x.id = p_problem_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'problem_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF v_uid IN (o.buyer_id, o.seller_id) THEN
    -- Another admin decides a sale you are part of (both reviews, 2026-10-15).
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a sale you are part of.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = p_decision, fault = p_fault, strike_given = p_strike,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF p_decision = 'pay_seller' THEN
    v_out := public.declutter_complete_handover(o.id, 'admin');
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Louisiana Helpr decided a reported problem on a Declutter sale against you.', NULL);
    END IF;
  ELSE
    v_out := public.declutter_close_paid_order(o.id,
      CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END,
      CASE WHEN p_strike THEN p_fault END,
      CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
      'Louisiana Helpr decided a reported problem on a Declutter sale against you.');
  END IF;
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'declutter_problem_decided', 'declutter_problem', p.id::text,
          jsonb_build_object('order_id', o.id, 'decision', p_decision, 'fault', p_fault, 'strike', p_strike, 'result', v_out));
  RETURN v_out;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_admin_decide_problem(uuid, text, text, boolean, text) TO authenticated, service_role;

-- Leave a review (row 45; B58): each side once, after the handover.
CREATE OR REPLACE FUNCTION public.declutter_leave_review(p_order_id uuid, p_stars integer, p_comment text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_side text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  v_side := public.declutter_order_side(o.buyer_id, o.seller_id, v_uid);
  IF v_side IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'not_handed_over' USING ERRCODE = '55000', HINT = 'Reviews open after the handover.';
  END IF;
  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_stars' USING ERRCODE = '22023';
  END IF;
  p_comment := NULLIF(btrim(p_comment), '');
  IF p_comment IS NOT NULL AND char_length(p_comment) > 1000 THEN
    RAISE EXCEPTION 'comment_too_long' USING ERRCODE = '22023';
  END IF;
  IF p_comment IS NOT NULL AND public.contact_leak_reason(p_comment) IS NOT NULL THEN
    RAISE EXCEPTION 'review_contact_info' USING ERRCODE = '23514',
      HINT = 'Reviews cannot include phone numbers, emails or links.';
  END IF;
  INSERT INTO public.declutter_reviews (order_id, reviewer_id, reviewee_id, reviewer_side, stars, comment)
  VALUES (o.id, v_uid, CASE WHEN v_side = 'buyer' THEN o.seller_id ELSE o.buyer_id END, v_side, p_stars, p_comment)
  ON CONFLICT (order_id, reviewer_side) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'already_reviewed' USING ERRCODE = '23505';
  END IF;
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_leave_review(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_leave_review(uuid, integer, text) TO authenticated, service_role;

-- A member's Declutter reviews that are visible (row 45: both sides reviewed,
-- or 14 days after the handover), plus the caller's own.
CREATE OR REPLACE FUNCTION public.declutter_visible_reviews(p_user_id uuid)
RETURNS TABLE (id uuid, reviewer_side text, stars smallint, comment text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- No order id (lh-authz-rls review 2.5); a test account's review stays hidden under the seed switch (Q552).
  SELECT r.id, r.reviewer_side, r.stars, r.comment, r.created_at
    FROM public.declutter_reviews r
    JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE r.reviewee_id = p_user_id
     AND (SELECT auth.uid()) IS NOT NULL
     AND (r.reviewer_id = (SELECT auth.uid())
          OR o.handed_over_at <= now() - interval '14 days'
          OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = r.order_id) = 2)
     AND (r.reviewee_id = (SELECT auth.uid()) OR r.is_seed IS NOT TRUE OR NOT (SELECT public.seed_hidden_from_caller()))
   ORDER BY r.created_at DESC;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_visible_reviews(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_visible_reviews(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The exact address (rows 27, 62, 98; B56). declutter_address_access gains
--    'paid_buyer' (the buyer of a PAID order holding the item). The two
--    readers need the switch only when the caller has no agreed sale on the
--    item (row 62, authz NOTE 5).
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
                           AND o.status = 'paid' AND o.buyer_id = p_user_id) THEN 'paid_buyer'
         END
    FROM public.declutter_items i
   WHERE i.id = p_item_id
     AND p_user_id IS NOT NULL;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_address_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_address_access(uuid, uuid) TO service_role;

-- An agreed sale on this item (in a cart or paid) that p_user_id is a side of.
CREATE OR REPLACE FUNCTION public.declutter_in_agreed_sale(p_item_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.declutter_cart_items c
     WHERE c.item_id = p_item_id AND c.status IN ('in_cart', 'paid')
       AND (c.buyer_id = p_user_id OR c.seller_id = p_user_id));
$fn$;
REVOKE ALL ON FUNCTION public.declutter_in_agreed_sale(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_in_agreed_sale(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_seller_item_private(p_item_id uuid)
RETURNS TABLE(floor_price_cents integer, pickup_address text, pickup_lat numeric, pickup_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.declutter_in_agreed_sale(p_item_id, (SELECT auth.uid())) THEN
    PERFORM public.require_feature('declutter');
  END IF;
  RETURN QUERY
    SELECT p.floor_price_cents, p.pickup_address, p.pickup_lat, p.pickup_lng
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id
       AND p.seller_id = (SELECT auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_seller_item_private(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_seller_item_private(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.declutter_item_address(p_item_id uuid)
RETURNS TABLE(pickup_address text, pickup_lat numeric, pickup_lng numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_access text := public.declutter_address_access(p_item_id, (SELECT auth.uid()));
BEGIN
  IF v_access IS DISTINCT FROM 'paid_buyer' AND NOT public.declutter_in_agreed_sale(p_item_id, (SELECT auth.uid())) THEN
    PERFORM public.require_feature('declutter');
  END IF;
  IF v_access IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
    SELECT p.pickup_address, p.pickup_lat, p.pickup_lng
      FROM public.declutter_item_private p
     WHERE p.item_id = p_item_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_item_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_item_address(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Sweep (cron) and the money queues (service only).

-- Every 10 min (B57): (a) auto-pay 24 h after the booked time unless a problem
-- is open (rows 26, 28); (b) a paid order with no booked time left at the
-- 7-day deadline (never booked, or a missed buyer who never rebooked) = buyer
-- no-show (rows 18, 95). Each order is re-checked under its own lock.
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
BEGIN
  FOR r IN
    SELECT o2.id FROM public.declutter_orders o2
      JOIN public.declutter_bookings b ON b.order_id = o2.id
     WHERE o2.status = 'paid' AND b.slot_start IS NOT NULL AND b.slot_start + interval '24 hours' <= now()
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid'
         AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o.id AND p.status = 'open')
         AND EXISTS (SELECT 1 FROM public.declutter_bookings b WHERE b.order_id = o.id AND b.slot_start IS NOT NULL
                       AND b.slot_start + interval '24 hours' <= now()) THEN
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
     WHERE o2.status = 'paid' AND o2.paid_at + interval '7 days' <= now()
       AND (b.order_id IS NULL OR b.slot_start IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.declutter_problems p WHERE p.order_id = o2.id AND p.status = 'open')
     ORDER BY o2.id LIMIT 200
  LOOP
    BEGIN
      o := public.declutter_lock_order(r.id);
      IF o.status = 'paid'
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
  RETURN jsonb_build_object('auto_paid', v_auto, 'not_picked_up', v_noshow);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_handover_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_handover_sweep() TO service_role;

-- Payouts the money edge function should send now (B53, B57). Held while a
-- problem is open on the order (row 67).
CREATE OR REPLACE FUNCTION public.declutter_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, attempts integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, p.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id, p.attempts
    FROM public.declutter_payouts p
    JOIN public.declutter_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payouts_due(integer) TO service_role;

-- What Stripe did with a payout (B53). Succeeded is final; a failure counts an
-- attempt and backs off.
CREATE OR REPLACE FUNCTION public.declutter_payout_executed(p_payout_id uuid, p_transfer_id text, p_succeeded boolean,
  p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded AND (p_transfer_id IS NULL OR p_transfer_id !~ '^tr_') THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_payouts
     SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
         stripe_transfer_id = CASE WHEN p_succeeded THEN p_transfer_id ELSE stripe_transfer_id END,
         executed_at = now(),
         last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         attempts = CASE WHEN p_succeeded THEN attempts ELSE least(attempts + 1, 100) END,
         next_attempt_at = CASE WHEN p_succeeded THEN next_attempt_at
                                ELSE now() + least(interval '10 minutes' * power(2, least(attempts, 8)), interval '1 day') END
   WHERE id = p_payout_id AND status IN ('pending', 'failed')
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_payouts WHERE id = p_payout_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payout_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payout_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_executed(uuid, text, boolean, text) TO service_role;

-- Refunds to (re)execute (3b money review #7, B57): pending rows older than
-- 2 minutes (the webhook executes fresh ones itself; the idempotency key = row
-- id makes an overlap harmless) and failed rows whose back-off is over.
-- checkout_session_id (lh-money-escrow re-review should-fix 3): rows written
-- by SQL (declutter_close_paid_order, problem decisions) carry no recorded
-- payment_livemode; declutter-money then reads the mode off the order's
-- Checkout Session id prefix (cs_live_ / cs_test_) before the parties.
CREATE OR REPLACE FUNCTION public.declutter_refunds_due(p_limit integer)
RETURNS TABLE (refund_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, livemode boolean, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- buyer/seller pick the Stripe mode (test accounts on the test key) in declutter-money.
  SELECT r.id, r.reason, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents, r.attempts,
         r.payment_livemode, o.stripe_checkout_session_id
    FROM public.declutter_refunds r
    LEFT JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE ((r.status = 'pending' AND r.created_at <= now() - interval '2 minutes')
          OR (r.status = 'failed' AND r.next_attempt_at <= now()))
     AND r.attempts < 12
   ORDER BY r.created_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refunds_due(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Cron + dead-cron expectation. Every 10 minutes; heals itself on its next
--    run, so (like declutter-deadlines) it has no catch-up policy row.
--    DEPLOY ORDER (money review 3.9): the declutter-money cron posts to an edge
--    function that functions-deploy ships on the SAME merge that db-deploy
--    applies this file on. Until the function is live a run gets a 404 (no
--    money moves: the queues are only read by the function). Land and deploy
--    the function first, or check its first runs after the merge
--    (cron.job_run_details / net._http_response for 'declutter-money'); the
--    lead lands this, see docs/specs/declutter-auctions.md "Deploy order".
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES
      ('declutter-handovers', interval '30 minutes',
       'Declutter: auto-pays the seller 24 h after the booked pickup unless a problem is open, and cancels paid sales never picked up in 7 days.',
       'exempt', 'While Declutter is off or quiet, a run that changes nothing is the healthy state.'),
      ('declutter-money', interval '30 minutes',
       'Declutter: the edge function sends due seller payouts as Stripe transfers grouped by order, and retries or reconciles refunds the webhook did not finish.',
       'exempt', 'No payout or refund due is the healthy state. A Stripe or database failure answers 500 through cronResult.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-handovers', '6-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-handovers', to_jsonb(public.declutter_handover_sweep()));$c$);
    -- Two minutes after the sweep, so a payout it wrote goes out in the same 10 minutes.
    PERFORM cron.schedule('declutter-money', '8-59/10 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'declutter-money')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 90000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/declutter-money',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- 8. "Download My Data" (B9): export_my_data restated from 20261014224914
--    verbatim, plus the slice 4 sections. The no-argument door stays dropped (Q408).
DROP FUNCTION IF EXISTS public.export_my_data();
CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_requests t
      WHERE t.requested_by = v_uid));
  v_out := v_out || jsonb_build_object('job_detail_change_answers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_detail_change_answers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  -- Declutter (20261014200728, B9).
  v_out := v_out || jsonb_build_object('declutter_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_items t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_private', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'ai_flag_reason'), '[]'::jsonb) FROM public.declutter_item_private t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_item_photos', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_item_photos t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_pickup_windows', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_pickup_windows t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_questions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_questions t
      WHERE t.asker_id = v_uid OR t.item_id IN (SELECT i.id FROM public.declutter_items i WHERE i.seller_id = v_uid)));
  v_out := v_out || jsonb_build_object('declutter_watchlist', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_watchlist t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_tax_attestations', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_tax_attestations t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'removed_by' - 'appeal_decided_by'), '[]'::jsonb) FROM public.declutter_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_seller_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'set_by'), '[]'::jsonb) FROM public.declutter_seller_flags t
      WHERE t.user_id = v_uid));
  -- Declutter slice 3 (20261014210518): offers (their current amount and
  -- status; the step history has no person column), orders and cart lines on
  -- either side of the trade; the saved card's brand + last 4 (the Stripe ids
  -- are ours, not the member's data, and are never shown to them, B31).
  v_out := v_out || jsonb_build_object('declutter_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_offers t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_orders', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_checkout_session_id' - 'stripe_payment_intent_id'), '[]'::jsonb) FROM public.declutter_orders t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_cart_items', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_cart_items t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_buyer_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_customer_id' - 'payment_method_id'), '[]'::jsonb) FROM public.declutter_buyer_cards t
      WHERE t.user_id = v_uid));

  -- Declutter slice 3b (20261014224914): a seller's card-fee debts (row 60).
  -- Refunds have no person column (they hang off an order, exported above);
  -- each section is scoped to the caller by its own column only.
  v_out := v_out || jsonb_build_object('declutter_seller_fee_debts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_seller_fee_debts t
      WHERE t.seller_id = v_uid));

  -- Declutter slice 4 (20261015042253): bookings (either side), the problems
  -- the member reported (the deciding admin's id dropped), the seller's payouts
  -- (the Stripe transfer id is ours), and reviews: those the member wrote, and
  -- those about them once visible (row 45: both sides reviewed or 14 days),
  -- without the reviewer's id.
  v_out := v_out || jsonb_build_object('declutter_bookings', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.declutter_bookings t
      WHERE t.buyer_id = v_uid OR t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_problems', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.declutter_problems t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'stripe_transfer_id' - 'last_error'), '[]'::jsonb) FROM public.declutter_payouts t
      WHERE t.seller_id = v_uid));
  v_out := v_out || jsonb_build_object('declutter_reviews', (SELECT coalesce(jsonb_agg(CASE WHEN t.reviewer_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'reviewer_id' END), '[]'::jsonb) FROM public.declutter_reviews t
      WHERE t.reviewer_id = v_uid
         OR (t.reviewee_id = v_uid AND EXISTS (SELECT 1 FROM public.declutter_orders o WHERE o.id = t.order_id
               AND (o.handed_over_at <= now() - interval '14 days'
                    OR (SELECT count(*) FROM public.declutter_reviews r2 WHERE r2.order_id = t.order_id) = 2)))));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Evidence photos stay put (lh-authz-rls review 2.2). The slice 2 policy
--    let a member delete any of their own unattached <uid>/declutter/... objects,
--    which now includes the porch set-out / picked-up photos and problem photos
--    (<uid>/declutter/handover/... and <uid>/declutter/problem/...). Restated
--    from 20261014200728 with those two folders excluded; listing photos live
--    under <uid>/declutter/<item uuid>/ and are unaffected.
DROP POLICY IF EXISTS "Sellers delete own unattached declutter photos" ON storage.objects;
CREATE POLICY "Sellers delete own unattached declutter photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
    AND (storage.foldername(name))[2] = 'declutter'
    AND (storage.foldername(name))[3] NOT IN ('handover', 'problem')
    AND NOT EXISTS (SELECT 1 FROM public.declutter_item_photos p WHERE p.storage_path = objects.name)
  );
