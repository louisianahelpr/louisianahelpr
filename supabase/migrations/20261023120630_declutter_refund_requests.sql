-- Board 141, Declutter side ("141d"; docs/OPEN.md Q2272, Q2151 (a)): a buyer asks the seller for a refund
-- within 24 hours of getting the item, and the seller's payout waits until the sale is final.
--
-- Owner rulings (~/.lh-wt/MASTER-LIST.md):
--   2026-10-21 AM: "Declutter refund within 24h of pickup, seller payout HELD until final; partial = exactly
--     amount offered; templates leave price EMPTY".
--   2026-10-22 (Declutter terms, Q2308): #2 the buyer ALWAYS gets the full 24 hours ("I got it" and the porch
--     photo do not end them); #3 the seller CAN say no (the buyer can then Report a problem, and Louisiana
--     Helpr decides); no seller answer in 24 hours -> Louisiana Helpr decides (payout held); a full refund is
--     everything back except the card fee, the buyer's fee included, and the item goes back to the seller;
--     #5 when a Helpr already made the delivery trip, the Helpr is paid for it and the delivery fee is not
--     refunded.
--
-- What changes:
--   1. THE HOLD. declutter_payouts_due offers a seller payout only once the sale is final
--      (declutter_sale_final): the handover was an admin's decision, or a reported problem was decided, or
--      a refund request was settled; otherwise 24 hours after the handover (and 24 hours after a seller's
--      "no", when that is later), with no request or problem still open, plus a 10-minute margin so a
--      request committed just before the deadline is always seen before any payout is offered. This covers
--      every handover (buyer "I got it", seller "Picked up", porch photo, Helpr delivery, the 24-hour
--      automatic finish); Q2151 (a) is this rule.
--   2. THE REQUEST (switch 'declutter_refund_requests', testers). declutter_ask_refund: the buyer, within
--      24 hours of the handover, one request per order, reason + words. The seller answers within 24 hours
--      (declutter_answer_refund):
--        * 'full': declutter_refund_after_handover(..., 'refund_request_full') at once: the payment minus
--          the card fee (fee policy keep_card_fee), the buyer's fee included; a delivery fee that paid a Helpr
--          for the trip stays with the Helpr; the seller's payout for the sale becomes $0; the item goes back
--          to the seller (listing 'withdrawn').
--        * 'part': an offer of EXACTLY an amount below the item price; the buyer takes it
--          (declutter_answer_refund_offer: refund 'refund_request_part', fee policy 'agreed_part', the amount
--          comes out of the seller's payout) or asks Louisiana Helpr to decide.
--        * 'decline': the buyer may Report a problem for 24 hours after the "no".
--      No seller answer in 24 hours, or no buyer answer to an offer in 24 hours: the sweep
--      (declutter_refund_request_sweep, cron 'declutter-refund-requests') opens a declutter_problems row and
--      an admin decides, as for any reported problem.
--   3. REPORT A PROBLEM AFTER THE HANDOVER. declutter_report_problem accepts the buyer's report on a
--      handed-over order while the window is open (it refused every one with 'sale_final'), and
--      declutter_admin_decide_problem decides it: "Pay the seller" ends the hold, "Refund the buyer" refunds
--      through declutter_refund_after_handover with the fault's usual fee policy.
--   4. THE PAYOUT IS REBOOKED, never sent and then clawed back: declutter_payouts.refunded_cents; the
--      seller's card-fee debt taken by this payout is put back and taken again from what is left
--      (declutter_rebook_payout). A payout already marked for sending, tried, or sent is never rebooked: the
--      refund fails closed ('payout_already_sent').
--   5. Copy: the handover notices no longer say the sale is final or that the money is on its way at once.
--
-- Restated from the NEWEST definitions on main (read 2026-10-23 at origin/main fa327a451b):
--   declutter_record_refund and the declutter_refunds reason/policy CHECKs from 20261017060455;
--   declutter_refunds_amount and declutter_refunds_fee_policy_check from 20261015042253;
--   declutter_payouts_amount from 20261015042253; declutter_payouts_due, declutter_complete_handover and
--   declutter_admin_decide_problem from 20261017055505; declutter_report_problem from 20261017055502.
-- Anyone restating these later starts from THIS file.
--
-- No person column on declutter_refund_requests (keyed by order_id, like declutter_handovers): the request's
-- words go to an admin as a declutter_problems row (exported by reporter_id) when it needs a decision.
-- RLS on, no client grant: members read their request through declutter_refund_request_view.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS + ADD in one DO block, the switch
-- ON CONFLICT DO NOTHING, the cron unschedule-then-schedule.
-- Proof: src/test/pglite/declutterRefundRequests.pglite.mjs (RED with NEW_MIGRATION=skip; this file 3x).

-- ── 1. The switch ─────────────────────────────────────────────────────────
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('declutter_refund_requests', 'testers',
        'Board 141 (Declutter side): within 24 hours of getting an item the buyer asks the seller for a refund; the seller refunds it all, offers part, or says no (Louisiana Helpr decides).')
ON CONFLICT (key) DO NOTHING;

-- ── 2. Refund reasons and policies ────────────────────────────────────────
--   refund_request_full -> keep_card_fee (owner #3: everything back except the card fee)
--   refund_request_part -> agreed_part   (owner 10-21: exactly the amount offered, below the item price)
DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_reason_check
  -- ACK-REASON: re-added on the next line with every reason it allowed plus 'refund_request_full' and 'refund_request_part'.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten, and every existing row's reason is still allowed.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_reason_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_reason_check CHECK (reason IN (
    'superseded', 'order_closed', 'amount_mismatch', 'duplicate_payment', 'order_missing', 'sold_elsewhere',
    'seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described',
    'buyer_cancelled', 'buyer_restarted_checkout',
    'buyer_no_show', 'admin_buyer_fault', 'admin_no_fault',
    'delivery_damage',
    'refund_request_full', 'refund_request_part'));   -- 141d (this file)
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_fee_policy_check
  -- ACK-REASON: re-added on the next line with the same policies plus 'agreed_part'.
  -- ACK-DATA-LOSS: none; every existing row's policy is still allowed.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_fee_policy_check;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_fee_policy_check
    CHECK (fee_policy IN ('full_platform_absorbs', 'full_seller_pays_fee', 'keep_card_fee', 'keep_buyer_fee', 'agreed_part'));
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_policy
  -- ACK-REASON: re-added on the next line with the same mapping plus the two 141d reasons; no existing reason changes policy.
  -- ACK-DATA-LOSS: none; no existing row has a 141d reason, so every row still validates.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_policy;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_policy CHECK (
    fee_policy = CASE WHEN reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                      WHEN reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                      WHEN reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                      WHEN reason = 'refund_request_part' THEN 'agreed_part'
                      ELSE 'full_platform_absorbs' END);
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_refunds.declutter_refunds_amount
  -- ACK-REASON: re-added on the next line with every arm unchanged plus 'agreed_part' (an amount above zero and below what was paid, no card fee kept).
  -- ACK-DATA-LOSS: none; no existing row has the new policy, so every row still validates.
  ALTER TABLE public.declutter_refunds DROP CONSTRAINT IF EXISTS declutter_refunds_amount;
  ALTER TABLE public.declutter_refunds ADD CONSTRAINT declutter_refunds_amount CHECK (
    refund_cents = CASE WHEN fee_policy = 'keep_card_fee' THEN paid_cents - card_fee_cents
                        WHEN fee_policy = 'keep_buyer_fee' THEN paid_cents - kept_cents
                        WHEN fee_policy = 'agreed_part' THEN refund_cents
                        ELSE paid_cents END
    AND refund_cents > 0
    AND kept_cents >= 0
    AND (fee_policy = 'keep_buyer_fee' OR kept_cents = 0)
    AND (fee_policy <> 'keep_buyer_fee' OR kept_cents > 0)
    AND (fee_policy <> 'agreed_part' OR (refund_cents < paid_cents AND card_fee_cents = 0)));
END
$do$;

-- Record a refund (restated from 20261017060455): the two 141d reasons join the CASE. A part refund has no
-- amount rule here (it is EXACTLY what the seller offered), so it is never recorded through this function:
-- declutter_refund_after_handover writes it with the offered amount.
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
  v_policy := CASE WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described') THEN 'full_seller_pays_fee'
                   WHEN p_reason IN ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'refund_request_full') THEN 'keep_card_fee'
                   WHEN p_reason IN ('buyer_no_show', 'admin_buyer_fault') THEN 'keep_buyer_fee'
                   WHEN p_reason = 'refund_request_part' THEN 'agreed_part'
                   ELSE 'full_platform_absorbs' END;
  IF v_policy = 'agreed_part' THEN
    -- Only the offered amount is right for a part refund; this function cannot know it.
    RAISE EXCEPTION 'refund_amount_unknown' USING ERRCODE = '55000';
  END IF;
  v_fee := least(p_paid_cents, greatest(0, COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(p_paid_cents))));
  IF v_policy = 'keep_card_fee' THEN
    -- A refund is never zero: at least 1 cent goes back.
    v_fee := least(v_fee, p_paid_cents - 1);
  ELSIF v_policy = 'keep_buyer_fee' THEN
    SELECT o.items_cents, o.premium_cents, o.tax_cents, o.delivery_cents INTO v_order
      FROM public.declutter_orders o WHERE o.id = p_order_id;
    IF v_order.premium_cents IS NULL OR v_order.premium_cents <= 0
       OR p_paid_cents IS DISTINCT FROM v_order.items_cents + v_order.premium_cents + v_order.tax_cents
                                        + v_order.delivery_cents - public.declutter_delivery_reserved_cents(p_order_id) THEN
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

-- ── 3. The payout remembers what was refunded out of it ───────────────────
ALTER TABLE public.declutter_payouts ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0;
DO $do$
BEGIN
  -- DESTRUCTIVE-DDL-ACK: DROP CONSTRAINT public.declutter_payouts.declutter_payouts_amount
  -- ACK-REASON: re-added on the next line as items - refunded - debt; every existing row has refunded_cents = 0, so the rule it enforced is unchanged for them.
  -- ACK-DATA-LOSS: none; no rows are deleted or rewritten.
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_amount;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_amount
    CHECK (amount_cents = items_cents - refunded_cents - debt_cents AND amount_cents >= 0);
  ALTER TABLE public.declutter_payouts DROP CONSTRAINT IF EXISTS declutter_payouts_refunded;
  ALTER TABLE public.declutter_payouts ADD CONSTRAINT declutter_payouts_refunded
    CHECK (refunded_cents BETWEEN 0 AND items_cents);
END
$do$;
-- The seller reads their own payout rows (fetchMyPayouts): the refunded part explains the amount.
GRANT SELECT (refunded_cents) ON TABLE public.declutter_payouts TO authenticated;

-- ── 4. declutter_refund_requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.declutter_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One request per sale. The buyer and seller are the order's.
  order_id uuid NOT NULL UNIQUE REFERENCES public.declutter_orders(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('not_as_described', 'damaged', 'not_received')),
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 1000),
  -- open: waiting for the seller; offered: the seller offered part, waiting for the buyer; agreed: settled
  -- (refund_id); declined: the seller said no; to_admin: an admin decides (problem_id); withdrawn: the buyer
  -- took it back.
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'offered', 'agreed', 'declined', 'to_admin', 'withdrawn')),
  answer_by timestamptz NOT NULL,
  -- The seller's part offer: EXACTLY this much back (owner 2026-10-21), below the item price.
  offer_cents integer CHECK (offer_cents IS NULL OR offer_cents > 0),
  offered_at timestamptz,
  offer_answer_by timestamptz,
  declined_at timestamptz,
  settled_at timestamptz,
  refund_id uuid REFERENCES public.declutter_refunds(id) ON DELETE SET NULL,
  problem_id uuid REFERENCES public.declutter_problems(id) ON DELETE SET NULL,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_refund_requests_offer CHECK (
    (status = 'offered') <= (offer_cents IS NOT NULL AND offered_at IS NOT NULL AND offer_answer_by IS NOT NULL)),
  CONSTRAINT declutter_refund_requests_declined CHECK ((status = 'declined') <= (declined_at IS NOT NULL)),
  CONSTRAINT declutter_refund_requests_agreed CHECK ((status = 'agreed') <= (refund_id IS NOT NULL AND settled_at IS NOT NULL)),
  CONSTRAINT declutter_refund_requests_to_admin CHECK ((status = 'to_admin') <= (problem_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS declutter_refund_requests_due_idx ON public.declutter_refund_requests (answer_by) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS declutter_refund_requests_offer_due_idx ON public.declutter_refund_requests (offer_answer_by) WHERE status = 'offered';
CREATE INDEX IF NOT EXISTS declutter_refund_requests_refund_idx ON public.declutter_refund_requests (refund_id);
CREATE INDEX IF NOT EXISTS declutter_refund_requests_problem_idx ON public.declutter_refund_requests (problem_id);
ALTER TABLE public.declutter_refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_refund_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_refund_requests TO service_role;
COMMENT ON TABLE public.declutter_refund_requests IS
  'Board 141 (Declutter side): a buyer''s request for a refund within 24 hours of the handover. Written only by the declutter_*refund* RPCs and the service sweep; members read it through declutter_refund_request_view (20261023120630).';

DROP TRIGGER IF EXISTS update_declutter_refund_requests_updated_at ON public.declutter_refund_requests;
CREATE TRIGGER update_declutter_refund_requests_updated_at
  BEFORE UPDATE ON public.declutter_refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed rows follow their order (the is_seed convention of the Declutter tables).
CREATE OR REPLACE FUNCTION public.declutter_refund_requests_seed()
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
REVOKE ALL ON FUNCTION public.declutter_refund_requests_seed() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_refund_requests_seed ON public.declutter_refund_requests;
CREATE TRIGGER trg_declutter_refund_requests_seed BEFORE INSERT ON public.declutter_refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.declutter_refund_requests_seed();

-- ── 5. When is a sale final, and is its payout still untouched ────────────
-- The seller's payout row has never been tried, marked for sending or sent.
CREATE OR REPLACE FUNCTION public.declutter_payout_unsent(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT p.status IN ('pending', 'nothing_due') AND p.stripe_transfer_id IS NULL AND p.attempts = 0
           AND NOT EXISTS (SELECT 1 FROM public.payout_send_marks m WHERE m.payout_kind = 'declutter' AND m.payout_id = p.id)
      FROM public.declutter_payouts p WHERE p.order_id = p_order_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payout_unsent(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payout_unsent(uuid) TO service_role;

-- The handover was decided by an admin, or a problem on the sale was decided: no window after it.
CREATE OR REPLACE FUNCTION public.declutter_sale_decided(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.declutter_handovers h WHERE h.order_id = p_order_id AND h.confirmed_by = 'admin')
      OR EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p_order_id AND x.status = 'decided')
      OR EXISTS (SELECT 1 FROM public.declutter_refund_requests r WHERE r.order_id = p_order_id AND r.status = 'agreed');
$fn$;
REVOKE ALL ON FUNCTION public.declutter_sale_decided(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_sale_decided(uuid) TO service_role;

-- The buyer may still report a problem on a handed-over sale: inside the 24 hours after the handover, while
-- a refund request is waiting, or within 24 hours of the seller's "no"; never once the sale was decided or
-- the payout was touched.
CREATE OR REPLACE FUNCTION public.declutter_problem_window_open(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT o.status = 'handed_over'
           AND NOT public.declutter_sale_decided(o.id)
           AND public.declutter_payout_unsent(o.id)
           AND (now() < o.handed_over_at + interval '24 hours'
                OR EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                            WHERE r.order_id = o.id
                              AND (r.status IN ('open', 'offered')
                                   OR (r.status = 'declined' AND now() < r.declined_at + interval '24 hours'))))
      FROM public.declutter_orders o WHERE o.id = p_order_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_problem_window_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_problem_window_open(uuid) TO service_role;

-- The sale is final, so the seller may be paid. A margin of 10 minutes past each window: a request or report
-- that started before a deadline commits long before any payout run can see the sale as final.
CREATE OR REPLACE FUNCTION public.declutter_sale_final(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE((
    SELECT CASE
             WHEN o.status <> 'handed_over' THEN true
             WHEN public.declutter_sale_decided(o.id) THEN true
             WHEN EXISTS (SELECT 1 FROM public.declutter_refund_requests r
                           WHERE r.order_id = o.id AND r.status IN ('open', 'offered')) THEN false
             WHEN o.handed_over_at IS NULL THEN true
             ELSE now() >= greatest(o.handed_over_at + interval '24 hours',
                                    COALESCE((SELECT r.declined_at + interval '24 hours' FROM public.declutter_refund_requests r
                                               WHERE r.order_id = o.id AND r.status = 'declined'), o.handed_over_at))
                           + interval '10 minutes'
           END
      FROM public.declutter_orders o WHERE o.id = p_order_id), true);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_sale_final(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_sale_final(uuid) TO service_role;

-- ── 6. The payout queue waits for the sale to be final ────────────────────
-- Restated from 20261017055505: one more condition, declutter_sale_final.
CREATE OR REPLACE FUNCTION public.declutter_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, order_id uuid, buyer_id uuid, seller_id uuid, amount_cents integer,
               stripe_account_id text, payment_intent_id text, attempts integer, refunds_recorded_cents integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, p.order_id, o.buyer_id, p.seller_id, p.amount_cents, pr.stripe_account_id, o.stripe_payment_intent_id, p.attempts,
         public.declutter_order_refunds_recorded_cents(o.id)
    FROM public.declutter_payouts p
    JOIN public.declutter_orders o ON o.id = p.order_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.seller_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = p.order_id AND x.status = 'open')
     -- 141d: the buyer's 24 hours, a refund request or a seller's "no" still running holds the payout.
     AND public.declutter_sale_final(p.order_id)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_payouts_due(integer) TO service_role;

-- ── 7. Rebook the payout after a refund came out of it ────────────────────
-- The seller's card-fee debt this payout took is put back, then taken again from what is left.
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
  IF p_refunded_cents IS NULL OR p_refunded_cents < 0 OR p_refunded_cents > p.items_cents THEN
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
    v_debt := public.declutter_consume_fee_debt(p.seller_id, v_ref, p.items_cents - p_refunded_cents);
  ELSE
    -- The seller's account is gone: nothing can be put back to them.
    v_debt := least(p.debt_cents, p.items_cents - p_refunded_cents);
  END IF;
  UPDATE public.declutter_payouts
     SET refunded_cents = p_refunded_cents, debt_cents = v_debt,
         amount_cents = items_cents - p_refunded_cents - v_debt,
         status = CASE WHEN items_cents - p_refunded_cents - v_debt = 0 THEN 'nothing_due' ELSE 'pending' END
   WHERE id = p.id;
  RETURN p.items_cents - p_refunded_cents - v_debt;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_rebook_payout(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_rebook_payout(uuid, integer) TO service_role;

-- ── 8. THE one money path for a refund after the handover ────────────────
-- p_reason: 'refund_request_full', 'refund_request_part' (p_part_cents, below the item price), or an admin's
-- decision on a reported problem ('not_as_described', 'admin_no_fault', 'admin_buyer_fault').
-- Writes the refund row (declutter-money sends it) and rebooks the payout, under the order's lock.
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
    v_refunded := o.items_cents;
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
         ELSE format('$%s is coming back to your card for "%s".%s%s Please give the item back to the seller; arrange it in Messages.',
                     to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'),
                     CASE WHEN p_reason IN ('refund_request_full', 'admin_no_fault') THEN ' The card fee is not refunded.'
                          WHEN p_reason = 'admin_buyer_fault' THEN ' Your buyer''s fee is not refunded.' ELSE '' END,
                     CASE WHEN v_reserved > 0 THEN ' The delivery fee paid the Helpr who made the trip.' ELSE '' END)
    END,
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Buyer refunded',
    CASE WHEN p_reason = 'refund_request_part'
         THEN format('The buyer got $%s back for "%s". It comes out of your payout for this sale.', to_char(v_cents / 100.0, 'FM999990.00'), COALESCE(v_title, 'your item'))
         ELSE format('The buyer was refunded for "%s", so there is no payout for this sale. The buyer gives the item back; arrange it in Messages.', COALESCE(v_title, 'your item'))
    END,
    '/declutter?view=sales', o.buyer_id);
  RETURN public.declutter_refund_answer(v_refund) || jsonb_build_object('refunded_items_cents', v_refunded);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_after_handover(uuid, text, integer) TO service_role;

-- ── 9. A request an admin must decide ─────────────────────────────────────
-- Opens (or joins) the order's problem report as the buyer's, with the request's words and what happened.
CREATE OR REPLACE FUNCTION public.declutter_refund_request_to_admin(p_request_id uuid, p_why text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.declutter_refund_requests;
  o public.declutter_orders;
  v_problem uuid;
  a record;
BEGIN
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = r.order_id;
  SELECT x.id INTO v_problem FROM public.declutter_problems x WHERE x.order_id = r.order_id AND x.status = 'open';
  IF v_problem IS NULL THEN
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
    VALUES (r.order_id, o.buyer_id, 'buyer', r.reason,
            left(btrim(r.note) || E'\n\n[Refund request: ' || p_why || ']', 1000), '{}')
    RETURNING id INTO v_problem;
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter refund to decide',
        'A buyer asked for a refund after the handover and the two sides did not agree. The seller''s payout is held until you decide.', '/admin');
    END LOOP;
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'to_admin', problem_id = v_problem WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Louisiana Helpr will decide',
    'Your refund request goes to Louisiana Helpr. We look at both sides and decide. The seller isn''t paid until then.',
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Louisiana Helpr will decide',
    'The buyer''s refund request goes to Louisiana Helpr. We look at both sides and decide. Your payout waits until then.',
    '/declutter?view=sales', o.buyer_id);
  RETURN v_problem;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) TO service_role;

-- ── 10. What a side sees ──────────────────────────────────────────────────
-- Shared by the view and the answers: the full-refund amount the buyer would get.
CREATE OR REPLACE FUNCTION public.declutter_full_refund_cents(p_order_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- The keep_card_fee arm of declutter_record_refund, on what a refund after the handover can return.
  SELECT CASE WHEN x.paid <= 0 THEN 0
              ELSE x.paid - least(least(x.paid, greatest(0, COALESCE(x.fee, public.declutter_card_fee_estimate(x.paid)))), x.paid - 1) END
    FROM (SELECT o.total_cents - public.declutter_delivery_reserved_cents(o.id) AS paid, o.card_fee_cents AS fee
            FROM public.declutter_orders o WHERE o.id = p_order_id) x;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_full_refund_cents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_full_refund_cents(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_view(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_side text;
  v_refund public.declutter_refunds;
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
    'delivery_kept_cents', public.declutter_delivery_reserved_cents(o.id),
    'request', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'status', r.status, 'reason', r.reason, 'note', r.note, 'answer_by', r.answer_by,
      'offer_cents', r.offer_cents, 'offer_answer_by', r.offer_answer_by, 'declined_at', r.declined_at,
      'report_until', CASE WHEN r.status = 'declined' THEN greatest(r.declined_at, o.handed_over_at) + interval '24 hours' END,
      'refund_cents', v_refund.refund_cents, 'refund_status', v_refund.status, 'created_at', r.created_at) END);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_view(uuid) TO authenticated, service_role;

-- ── 11. The buyer asks ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.declutter_ask_refund(p_order_id uuid, p_reason text, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  o := public.declutter_lock_order(p_order_id);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'handed_over' THEN
    RAISE EXCEPTION 'not_handed_over' USING ERRCODE = '55000',
      HINT = 'You can ask for a refund once you have the item. Before that, report a problem.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_refund_requests r WHERE r.order_id = o.id) THEN
    RAISE EXCEPTION 'refund_already_asked' USING ERRCODE = '55000';
  END IF;
  IF now() >= o.handed_over_at + interval '24 hours' OR public.declutter_sale_decided(o.id) THEN
    RAISE EXCEPTION 'refund_window_over' USING ERRCODE = '55000',
      HINT = 'The 24 hours to ask for a refund are over, so this sale is final.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_problems x WHERE x.order_id = o.id AND x.status = 'open') THEN
    RAISE EXCEPTION 'problem_open' USING ERRCODE = '55000',
      HINT = 'A problem was reported on this sale. Louisiana Helpr decides before anyone is paid.';
  END IF;
  PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
  IF NOT public.declutter_payout_unsent(o.id) THEN
    RAISE EXCEPTION 'refund_window_over' USING ERRCODE = '55000',
      HINT = 'The 24 hours to ask for a refund are over, so this sale is final.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('not_as_described', 'damaged', 'not_received') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023', HINT = 'Tell the seller what''s wrong (up to 1,000 characters).';
  END IF;
  INSERT INTO public.declutter_refund_requests (order_id, reason, note, answer_by)
  VALUES (o.id, p_reason, btrim(p_note), now() + interval '24 hours')
  RETURNING id INTO v_id;
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Refund request',
    'The buyer asked for a refund. Answer within 24 hours: refund it all, offer part, or say no. If you don''t answer, Louisiana Helpr decides. Your payout waits until then.',
    '/declutter?view=sales', v_uid);
  RETURN jsonb_build_object('result', 'asked', 'request_id', v_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_ask_refund(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_ask_refund(uuid, text, text) TO authenticated, service_role;

-- ── 12. The seller answers ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.declutter_answer_refund(p_request_id uuid, p_answer text, p_offer_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
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
  IF p_answer = 'full' THEN
    v_out := public.declutter_refund_after_handover(o.id, 'refund_request_full', NULL);
    UPDATE public.declutter_refund_requests
       SET status = 'agreed', refund_id = (v_out->>'refund_id')::uuid, settled_at = now()
     WHERE id = r.id;
    RETURN v_out || jsonb_build_object('result', 'refunded');
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
$fn$;
REVOKE ALL ON FUNCTION public.declutter_answer_refund(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund(uuid, text, integer) TO authenticated, service_role;

-- ── 13. The buyer answers a part offer ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.declutter_answer_refund_offer(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
  v_out jsonb;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = '22023';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status <> 'offered' THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  IF now() >= r.offer_answer_by THEN
    RAISE EXCEPTION 'refund_answer_late' USING ERRCODE = '55000',
      HINT = 'The 24 hours to answer are over, so Louisiana Helpr decides this one.';
  END IF;
  IF p_accept THEN
    v_out := public.declutter_refund_after_handover(o.id, 'refund_request_part', r.offer_cents);
    UPDATE public.declutter_refund_requests
       SET status = 'agreed', refund_id = (v_out->>'refund_id')::uuid, settled_at = now()
     WHERE id = r.id;
    RETURN v_out || jsonb_build_object('result', 'refunded');
  END IF;
  PERFORM public.declutter_refund_request_to_admin(r.id,
    format('the seller offered $%s back and the buyer asked Louisiana Helpr to decide', to_char(r.offer_cents / 100.0, 'FM999990.00')));
  RETURN jsonb_build_object('result', 'to_admin');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_answer_refund_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_answer_refund_offer(uuid, boolean) TO authenticated, service_role;

-- ── 14. The buyer takes it back ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.declutter_withdraw_refund(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_order uuid;
  o public.declutter_orders;
  r public.declutter_refund_requests;
BEGIN
  PERFORM public.require_feature('declutter_refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT x.order_id INTO v_order FROM public.declutter_refund_requests x WHERE x.id = p_request_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  o := public.declutter_lock_order(v_order);
  IF public.declutter_order_side(o.buyer_id, o.seller_id, v_uid) IS DISTINCT FROM 'buyer' THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status NOT IN ('open', 'offered') THEN
    RAISE EXCEPTION 'refund_already_answered' USING ERRCODE = '55000';
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'withdrawn' WHERE id = r.id;
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Refund request withdrawn',
    'The buyer took back their refund request. You''re paid when the sale is final, 24 hours after the handover.',
    '/declutter?view=sales', v_uid);
  RETURN jsonb_build_object('result', 'withdrawn');
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_withdraw_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_withdraw_refund(uuid) TO authenticated, service_role;

-- ── 15. The clock: an unanswered request or offer goes to an admin ────────
CREATE OR REPLACE FUNCTION public.declutter_refund_request_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  d record;
  r public.declutter_refund_requests;
  v_n integer := 0;
BEGIN
  FOR d IN
    SELECT x.id, x.order_id FROM public.declutter_refund_requests x
     WHERE (x.status = 'open' AND x.answer_by <= now()) OR (x.status = 'offered' AND x.offer_answer_by <= now())
     ORDER BY x.created_at
     LIMIT 200
  LOOP
    PERFORM public.declutter_lock_order(d.order_id);
    SELECT * INTO r FROM public.declutter_refund_requests WHERE id = d.id FOR UPDATE;
    IF (r.status = 'open' AND r.answer_by <= now()) OR (r.status = 'offered' AND r.offer_answer_by <= now()) THEN
      PERFORM public.declutter_refund_request_to_admin(r.id,
        CASE WHEN r.status = 'open' THEN 'the seller did not answer in 24 hours'
             ELSE format('the seller offered $%s back and the buyer did not answer in 24 hours', to_char(r.offer_cents / 100.0, 'FM999990.00')) END);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('to_admin', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_sweep() TO service_role;

-- ── 16. Report a problem after the handover (restated from 20261017055502) ─
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
    -- 141d: the BUYER may still report a problem in the 24 hours after the handover (owner 2026-10-22 #2),
    -- while a refund request waits, and for 24 hours after the seller says no (#3). The payout waits.
    PERFORM 1 FROM public.declutter_payouts p WHERE p.order_id = o.id FOR UPDATE;
    IF v_side <> 'buyer' OR NOT public.declutter_problem_window_open(o.id) THEN
      RAISE EXCEPTION 'sale_final' USING ERRCODE = '55000', HINT = 'The time to report a problem is over, so this sale is final.';
    END IF;
  ELSIF o.status <> 'paid' THEN
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
       OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
  VALUES (o.id, v_uid, v_side, p_reason, btrim(p_note), COALESCE(p_photo_paths, '{}'))
  RETURNING id INTO v_id;
  -- 141d: a refund request still waiting (or one the seller said no to) now goes to the admin with this report.
  UPDATE public.declutter_refund_requests SET status = 'to_admin', problem_id = v_id
   WHERE order_id = o.id AND status IN ('open', 'offered', 'declined');
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

-- ── 17. An admin decides a problem reported after the handover ────────────
-- Restated from 20261017055505: a handed-over order is decided here (pay the seller = the sale is final;
-- refund the buyer = declutter_refund_after_handover with the fault's usual fee policy); every other order
-- exactly as before.
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
  v_task public.helpr_tasks;
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
  -- Slice 5: the order's Helpr task, if any.
  SELECT t.* INTO v_task FROM public.declutter_order_deliveries od JOIN public.helpr_tasks t ON t.id = od.task_id
   WHERE od.order_id = o.id;
  IF v_task.id IS NOT NULL AND v_uid IS NOT DISTINCT FROM v_task.helpr_id THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501', HINT = 'Another admin must decide a delivery you made.';
  END IF;
  SELECT * INTO p FROM public.declutter_problems WHERE id = p_problem_id FOR UPDATE;
  IF p.status <> 'open' THEN
    RAISE EXCEPTION 'problem_already_decided' USING ERRCODE = '55000';
  END IF;
  -- Slice 5 (lh-money-escrow review #1): refunding the buyer on a delivery the
  -- Helpr already has pays the Helpr for the trip (B69). For an item reported
  -- damaged or not received that would pay the Helpr who may have caused it,
  -- so the admin decides it explicitly instead: "Damaged in delivery" (row 43,
  -- declutter_admin_decide_delivery_damage: the Helpr is not paid) or
  -- "Pay the seller".
  -- B77: after a Helpr's "the seller wasn't there" the item never left the
  -- seller, so "Pay the seller" would close a sale the buyer never received
  -- (lh-money-escrow re-review #2). The admin refunds the buyer instead (whose
  -- fault decides the card fee); the item stays with the seller.
  IF p_decision = 'pay_seller' AND p.reporter_side = 'helpr' THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The item never left the seller. Refund the buyer, and say whose fault it was.';
  END IF;
  IF p_decision = 'refund_buyer' AND p.reason IN ('damaged', 'not_received')
     AND v_task.status IN ('picked_up', 'delivered') THEN
    RAISE EXCEPTION 'delivery_decision_needed' USING ERRCODE = '55000',
      HINT = 'The Helpr has this item. Decide it as damaged in delivery, or pay the seller.';
  END IF;
  UPDATE public.declutter_problems
     SET status = 'decided', decision = p_decision, fault = p_fault, strike_given = p_strike,
         admin_note = left(p_note, 1000), decided_by = v_uid, decided_at = now()
   WHERE id = p.id;
  IF o.status = 'handed_over' THEN
    -- 141d: a problem reported in the window after the handover. The payout is still held (never sent).
    IF p_decision = 'pay_seller' THEN
      v_out := jsonb_build_object('result', 'seller_keeps', 'order_id', o.id);
      PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Louisiana Helpr decided',
        'We looked at both sides. The seller keeps the payment, and the sale is final.', '/declutter?view=cart', o.seller_id);
      PERFORM public.declutter_notify(o.seller_id, 'payment', 'Louisiana Helpr decided',
        'We looked at both sides. You keep the payment; we send it to your payout account.', '/declutter?view=sales', o.buyer_id);
    ELSE
      v_out := public.declutter_refund_after_handover(o.id,
        CASE p_fault WHEN 'seller' THEN 'not_as_described' WHEN 'buyer' THEN 'admin_buyer_fault' ELSE 'admin_no_fault' END, NULL);
    END IF;
    IF p_strike THEN
      PERFORM public.declutter_give_strike(CASE WHEN p_fault = 'seller' THEN o.seller_id ELSE o.buyer_id END, p_fault,
        CASE WHEN p_fault = 'seller' THEN 'not_as_described' ELSE 'not_picked_up' END,
        (SELECT c.item_id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1),
        'Louisiana Helpr decided a reported problem on a Declutter sale against you.',
        (SELECT c.id FROM public.declutter_cart_items c WHERE c.order_id = o.id ORDER BY c.id LIMIT 1));
    END IF;
  ELSIF p_decision = 'pay_seller' THEN
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

-- ── 18. The handover notices (restated from 20261017055505; copy only) ─────
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
  -- 141d: the payout waits until the sale is final, 24 hours after the handover (an admin's decision is final at once).
  PERFORM public.declutter_notify(o.seller_id, 'payment', 'Handover done',
    CASE
      WHEN o.items_cents - v_debt = 0 THEN
        format('This sale paid off the $%s card fee you owed, so there is nothing to send.', to_char(v_debt / 100.0, 'FM999990.00'))
      WHEN NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = o.seller_id AND pr.stripe_account_id IS NOT NULL) THEN
        format(CASE WHEN p_by = 'admin' THEN 'Set up payouts in Settings to get your $%s. We send it as soon as you do.'
                    ELSE 'Set up payouts in Settings to get your $%s. We send it once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.' END,
               to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
      WHEN p_by = 'admin' THEN format('$%s is on its way to your payout account.', to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
      ELSE format('We send your $%s once the sale is final, 24 hours after the handover, unless the buyer asks for a refund.',
                  to_char((o.items_cents - v_debt) / 100.0, 'FM999990.00'))
    END,
    '/declutter?view=sales', o.buyer_id);
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

-- ── 19. The cron ──────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('declutter-refund-requests', interval '30 minutes',
            'Declutter (board 141): a refund request the seller did not answer in 24 hours, or a part offer the buyer did not answer in 24 hours, goes to an admin as a reported problem.',
            'exempt', 'Almost every run finds nothing due: a request goes to an admin only when a side did not answer in time.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('declutter-refund-requests', '5-59/10 * * * *',
      $c$SELECT public.cron_record_work('declutter-refund-requests', to_jsonb(public.declutter_refund_request_sweep()));$c$);
  END IF;
END
$do$;
