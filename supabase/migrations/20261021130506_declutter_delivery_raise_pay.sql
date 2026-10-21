-- DECLUTTER DELIVERY: THE BUYER MAY RAISE THE PAY (spec row 40, "buyer may
-- raise the pay to attract a Helpr"; Q1929; owner 2026-10-21: build it).
--
-- WHAT WAS MISSING. When no Helpr takes a delivery, the only thing that
-- happens is the 48 h fallback (declutter_delivery_refund, reason no_helpr):
-- the delivery fee goes back and the order becomes a pickup. The buyer had no
-- way to offer more to get a Helpr. That needs a SECOND payment on an order
-- that is already paid, and the Helpr's pay to follow it.
--
-- WHAT THIS BUILDS.
--   1. declutter_delivery_raises: one row per raise the buyer starts. Each is
--      its own Stripe Checkout page (declutter-checkout action raise_pay) for
--      the raise only plus its card fee, so the buyer pays the card cost of
--      the second charge (declutter_delivery_raise_card_fee_cents: the amount
--      Stripe keeps, 2.9% + 30c, grossed up so the raise arrives whole).
--   2. Only a PAID raise changes anything (declutter_delivery_raise_paid, the
--      webhook's call). Under the order lock and then the task lock, a raise
--      on a task still OPEN for Helprs bumps helpr_tasks.pay_cents by the raise,
--      re-prices the Helpr's fee with the same rule the task was created with
--      (helpr_task_fee_cents: jobs' 5% + 70c, row 42) and stamps it
--      (helpr_tasks.raised_cents, the raise row 'applied'). The task stays open;
--      its open window is NOT restarted (see REFUND RULE). A raise paid on a
--      task that is no longer waiting (taken, delivered, closed, cancelled, a
--      problem open, the window passed), a replaced page, a wrong amount, or
--      one past the cap changes nothing and is refunded in full.
--      An unpaid or expired page changes nothing at all: no row is touched
--      until Stripe says paid. A replayed webhook finds the row already holding
--      its PaymentIntent and answers 'already'.
--   3. The Helpr's payout is unchanged code: helpr_task_confirm copies the
--      task's pay_cents and fee_cents, so the one helpr_task_payouts row is the
--      raised pay minus the fee. helpr_task_payouts_due now also names the
--      applied raises (raise_parts), because a transfer funded from a charge
--      (source_transaction) may not exceed that charge: declutter-money funds
--      the raise part of the SAME payout from each raise's own charge, in the
--      order's transfer group, never from the platform balance.
--   4. REFUND RULE (one of the two the owner's task allowed, chosen here):
--      every paid raise is refunded in full when the task ends without its
--      Helpr being paid (unfilled = no Helpr, cancelled, failed = damaged in
--      delivery). The open window is NOT restarted by a raise. Why: restarting
--      it would push the no-Helpr fallback later into the 7-day pickup clock,
--      and under 48 h before that deadline the fallback is B76's no-fault
--      cancellation, which keeps the card fee: a raise would then cost the
--      buyer more than doing nothing. Keeping the window means a raise only
--      ever adds to the pay inside the time the buyer was already promised.
--      A raise is refused with under 1 hour of the window left (a page lives
--      31 minutes), so a raise is never sold with no time to work.
--      Exactly once: the delivery fee keeps its one declutter_delivery_refunds
--      row per order (UNIQUE order_id, the order's charge); each raise is its
--      own row, refunded once on its OWN charge (status 'applied' ->
--      'refunding' happens once, by an AFTER UPDATE trigger on the task's
--      status, so every closing path is covered, and declutter-money's key is
--      the raise id). Neither refund touches the other's charge.
--      The card fee of a raise goes back too (the delivery we sold did not
--      happen, as B68 for the delivery fee), EXCEPT when the sale itself is
--      cancelled for the buyer's own reason or no one's fault: then the raise's
--      card fee is kept, as the order's refund keeps its own (owner 2026-10-14,
--      "never absorb any fee" except our own mistake; lh-money-escrow review).
--      A seller-fault cancel refunds the raise in full and the platform pays
--      its card fee (not billed to the seller: owner to confirm).
--      Each raise transfer to the Helpr is recorded on its raise
--      (payout_transfer_id); a refund made by hand in Stripe on a raise's
--      charge settles that raise (declutter_delivery_raise_hand_refund).
--   5. declutter_delivery_raise_status: the buyer's own order only, what the
--      "Raise the pay" panel shows.
--
-- Hidden switch: 'declutter' (the Declutter switch delivery already uses);
-- both member RPCs start with require_feature('declutter').
-- Replay-safe: IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS. Grants by role
-- name, REVOKE ... FROM PUBLIC, anon. Applied 3x by the PGlite proof
-- (src/test/pglite/declutterDeliveryRaise.pglite.mjs).

-- 1. The stamp on the task: how much of pay_cents came from paid raises.
ALTER TABLE public.helpr_tasks ADD COLUMN IF NOT EXISTS raised_cents integer NOT NULL DEFAULT 0;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'helpr_tasks_raised') THEN
    ALTER TABLE public.helpr_tasks ADD CONSTRAINT helpr_tasks_raised CHECK (raised_cents >= 0 AND raised_cents < pay_cents);
  END IF;
END
$do$;

-- 2. The raises.
CREATE TABLE IF NOT EXISTS public.declutter_delivery_raises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.declutter_orders(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES public.helpr_tasks(id) ON DELETE RESTRICT,
  raise_cents integer NOT NULL CHECK (raise_cents > 0),
  card_fee_cents integer NOT NULL CHECK (card_fee_cents >= 0),
  total_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment',  -- a page is (or was) open; nothing has changed
    'superseded',        -- the buyer started another raise; this page was closed
    'applied',           -- paid, and the task's pay went up by raise_cents
    'refunding',         -- paid, and the payment is to go back in full
    'refunded')),        -- Stripe took the refund
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text UNIQUE,
  paid_cents integer,
  paid_at timestamptz,
  livemode boolean,
  applied_at timestamptz,
  -- Why a paid raise goes back. Every reason refunds everything paid (our side: the delivery we
  -- sold did not happen, or our system took a payment it could not use) EXCEPT
  -- 'delivery_cancelled_buyer': the sale was cancelled for the buyer's own reason (or no one's
  -- fault), so the raise's card fee is kept, as declutter_record_refund keeps the order's
  -- (owner 2026-10-14: we never absorb a fee except our own mistake). CHECK _refund_amount.
  refund_reason text CHECK (refund_reason IS NULL OR refund_reason IN (
    'no_helpr', 'delivery_cancelled', 'delivery_cancelled_buyer', 'delivery_failed', 'not_waiting', 'page_replaced',
    'amount_mismatch', 'raise_limit')),
  refund_cents integer,
  stripe_refund_ref text,
  -- The transfer that paid this raise to the Helpr (the raise part of the task's ONE payout,
  -- funded from this raise's own charge; declutter-money records it).
  payout_transfer_id text UNIQUE CHECK (payout_transfer_id IS NULL OR payout_transfer_id ~ '^tr_'),
  refund_attempts integer NOT NULL DEFAULT 0 CHECK (refund_attempts BETWEEN 0 AND 100),
  refund_next_attempt_at timestamptz,
  refund_last_error text,
  refunded_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT declutter_delivery_raises_total CHECK (total_cents = raise_cents + card_fee_cents),
  CONSTRAINT declutter_delivery_raises_paid CHECK ((status IN ('awaiting_payment', 'superseded')) = (stripe_payment_intent_id IS NULL)
                                                   AND (stripe_payment_intent_id IS NULL) = (paid_cents IS NULL)
                                                   AND (paid_cents IS NULL OR paid_cents > 0)),
  CONSTRAINT declutter_delivery_raises_applied CHECK (status <> 'applied' OR applied_at IS NOT NULL),
  CONSTRAINT declutter_delivery_raises_refund CHECK ((status IN ('refunding', 'refunded')) = (refund_reason IS NOT NULL)
                                                     AND (refund_reason IS NULL) = (refund_cents IS NULL)
                                                     AND (refund_cents IS NULL OR (refund_cents > 0 AND refund_cents <= paid_cents))),
  CONSTRAINT declutter_delivery_raises_refund_amount CHECK (refund_reason IS NULL OR refund_cents =
    CASE WHEN refund_reason = 'delivery_cancelled_buyer' THEN paid_cents - card_fee_cents ELSE paid_cents END),
  CONSTRAINT declutter_delivery_raises_payout CHECK (payout_transfer_id IS NULL OR status = 'applied'),
  CONSTRAINT declutter_delivery_raises_refunded CHECK (status <> 'refunded' OR stripe_refund_ref IS NOT NULL)
);
-- One open page per task at a time.
CREATE UNIQUE INDEX IF NOT EXISTS declutter_delivery_raises_one_open ON public.declutter_delivery_raises (task_id)
  WHERE status = 'awaiting_payment';
CREATE INDEX IF NOT EXISTS declutter_delivery_raises_order_idx ON public.declutter_delivery_raises (order_id);
CREATE INDEX IF NOT EXISTS declutter_delivery_raises_task_idx ON public.declutter_delivery_raises (task_id);
CREATE INDEX IF NOT EXISTS declutter_delivery_raises_refund_due_idx ON public.declutter_delivery_raises (refund_next_attempt_at)
  WHERE status = 'refunding';
ALTER TABLE public.declutter_delivery_raises ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_delivery_raises FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_delivery_raises TO service_role;
-- No client privilege: the buyer reads their own raises through declutter_delivery_raise_status().
DROP TRIGGER IF EXISTS trg_declutter_delivery_raises_seed ON public.declutter_delivery_raises;
CREATE TRIGGER trg_declutter_delivery_raises_seed BEFORE INSERT ON public.declutter_delivery_raises
  FOR EACH ROW EXECUTE FUNCTION public.declutter_order_rows_seed();
-- Q807: an account whose email is unconfirmed cannot write the new table (the member RPC is callable
-- straight through PostgREST, past the edge's own check).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- 3. The card fee on a raise: what Stripe keeps on the raise's own charge
-- (2.9% + 30c, the rate declutter_card_fee_estimate and _shared/stripeFees.ts
-- use), grossed up so the raise reaches the Helpr's pay whole. The client
-- mirror is src/lib/declutter/deliveryRaise.ts (raiseCardFeeCents); the PGlite
-- proof compares the two.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_card_fee_cents(p_raise_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN COALESCE(p_raise_cents, 0) <= 0 THEN 0
              ELSE ceil((p_raise_cents + 30) * 1000 / 971.0)::integer - p_raise_cents END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_card_fee_cents(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_card_fee_cents(integer) TO authenticated, service_role;

-- The rules, in one place: whole dollars, at least $5 a raise, at most $150
-- raised on one delivery (so the Helpr's fee on the raised pay never exceeds
-- the original delivery fee: the order's charge always funds a positive part
-- of the payout), and at least 1 hour of the open window left.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object('min_cents', 500, 'max_total_cents', 15000, 'step_cents', 100, 'min_window_minutes', 60);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_rules() TO authenticated, service_role;

-- Is this task waiting for a Helpr with time left to raise (caller holds the
-- locks, or only reads)? NULL in, false out.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_open(p_order public.declutter_orders, p_task public.helpr_tasks,
  p_minutes integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(p_order.status = 'paid' AND p_order.handover = 'delivery'
     AND p_task.id IS NOT NULL AND p_task.status = 'open'
     AND p_task.open_until > now() + make_interval(mins => greatest(COALESCE(p_minutes, 0), 0))
     AND NOT public.helpr_task_source_held(p_task.source_kind, p_task.source_id), false);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_open(public.declutter_orders, public.helpr_tasks, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_open(public.declutter_orders, public.helpr_tasks, integer) TO service_role;

-- 4. Start a raise (the BUYER, through declutter-checkout's raise_pay, which
-- then opens the Stripe page for total_cents and attaches it). Any raise page
-- still open for the task is superseded here; the edge closes it first.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_start(p_order_id uuid, p_raise_cents integer)
RETURNS TABLE (raise_id uuid, raise_cents integer, card_fee_cents integer, total_cents integer,
               superseded_session_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  t public.helpr_tasks;
  v_task uuid;
  v_old text;
  v_fee integer;
  v_id uuid;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Anyone but the buyer: item_not_found (never told the order exists).
  IF p_order_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.declutter_orders x WHERE x.id = p_order_id AND x.buyer_id = v_uid) THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_raise_cents IS NULL OR p_raise_cents < 500 OR p_raise_cents % 100 <> 0 THEN
    RAISE EXCEPTION 'invalid_raise' USING ERRCODE = '22023', HINT = 'Raise the pay by whole dollars, at least $5.';
  END IF;
  SELECT od.task_id INTO v_task FROM public.declutter_order_deliveries od WHERE od.order_id = p_order_id;
  IF v_task IS NULL THEN
    RAISE EXCEPTION 'delivery_not_waiting' USING ERRCODE = '55000',
      HINT = 'A Helpr already took this delivery, or it closed.';
  END IF;
  -- Lock order: the order (its items first), then the task: helpr_task_lock's own order.
  t := public.helpr_task_lock(v_task);
  SELECT * INTO o FROM public.declutter_orders WHERE id = p_order_id;
  IF NOT public.declutter_delivery_raise_open(o, t, 0) THEN
    RAISE EXCEPTION 'delivery_not_waiting' USING ERRCODE = '55000',
      HINT = 'A Helpr already took this delivery, or it closed.';
  END IF;
  IF NOT public.declutter_delivery_raise_open(o, t, 60) THEN
    RAISE EXCEPTION 'raise_too_late' USING ERRCODE = '55000',
      HINT = 'Less than an hour is left to find a Helpr, so the pay can''t be raised now.';
  END IF;
  IF t.raised_cents + p_raise_cents > 15000 THEN
    RAISE EXCEPTION 'raise_limit' USING ERRCODE = '22023',
      HINT = 'The pay can be raised by up to $150 in all on one delivery.';
  END IF;
  UPDATE public.declutter_delivery_raises r SET status = 'superseded', updated_at = now()
   WHERE r.task_id = t.id AND r.status = 'awaiting_payment'
  RETURNING r.stripe_checkout_session_id INTO v_old;
  v_fee := public.declutter_delivery_raise_card_fee_cents(p_raise_cents);
  INSERT INTO public.declutter_delivery_raises (order_id, task_id, raise_cents, card_fee_cents, total_cents)
  VALUES (o.id, t.id, p_raise_cents, v_fee, p_raise_cents + v_fee)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, p_raise_cents, v_fee, p_raise_cents + v_fee, v_old;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_start(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_start(uuid, integer) TO authenticated, service_role;

-- The Stripe page made for a raise (service only). First page wins; a raise
-- that is no longer waiting for its page refuses (the edge expires the page).
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_attach(p_raise_id uuid, p_session_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_session_id IS NULL OR p_session_id !~ '^cs_(live|test)_' THEN
    RAISE EXCEPTION 'invalid_session' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_delivery_raises SET stripe_checkout_session_id = p_session_id, updated_at = now()
   WHERE id = p_raise_id AND status = 'awaiting_payment' AND stripe_checkout_session_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'raise_not_waiting' USING ERRCODE = '55000';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_attach(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_attach(uuid, text) TO service_role;

-- 5. A raise page was PAID (the webhook, service only). Idempotent: a replay
-- finds the row holding this PaymentIntent and changes nothing. Answers:
--   applied    the task's pay went up (it stays open)
--   refund     paid but not applied; refund_cents goes back in full
--   already    a replay (the row's status is returned)
--   unknown / order_mismatch / session_mismatch / other_payment   not ours to apply: the
--              webhook pages ops (refund by hand) and changes nothing.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_paid(p_raise_id uuid, p_order_id uuid, p_session_id text,
  p_payment_intent_id text, p_amount_cents integer, p_livemode boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.declutter_delivery_raises;
  o public.declutter_orders;
  t public.helpr_tasks;
  v_reason text;
BEGIN
  IF p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_' OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invalid_payment' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.declutter_delivery_raises WHERE id = p_raise_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  IF r.order_id IS DISTINCT FROM p_order_id THEN
    RETURN jsonb_build_object('result', 'order_mismatch', 'raise_id', r.id);
  END IF;
  -- The order lock, then the task lock (helpr_task_lock), then the row.
  t := public.helpr_task_lock(r.task_id);
  SELECT * INTO r FROM public.declutter_delivery_raises WHERE id = p_raise_id FOR UPDATE;
  IF r.stripe_payment_intent_id IS NOT NULL THEN
    RETURN jsonb_build_object('result', CASE WHEN r.stripe_payment_intent_id = p_payment_intent_id THEN 'already' ELSE 'other_payment' END,
      'status', r.status, 'raise_id', r.id);
  END IF;
  IF r.stripe_checkout_session_id IS DISTINCT FROM p_session_id THEN
    RETURN jsonb_build_object('result', 'session_mismatch', 'raise_id', r.id);
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = r.order_id;
  v_reason := CASE
    WHEN p_amount_cents <> r.total_cents THEN 'amount_mismatch'
    WHEN r.status = 'superseded' THEN 'page_replaced'
    WHEN NOT public.declutter_delivery_raise_open(o, t, 0) THEN 'not_waiting'
    WHEN t.raised_cents + r.raise_cents > 15000 THEN 'raise_limit'
  END;
  IF v_reason IS NULL THEN
    UPDATE public.helpr_tasks
       SET pay_cents = pay_cents + r.raise_cents,
           fee_cents = public.helpr_task_fee_cents(pay_cents + r.raise_cents),
           raised_cents = raised_cents + r.raise_cents,
           updated_at = now()
     WHERE id = t.id AND status = 'open';
    IF NOT FOUND THEN
      -- Checked open under the lock just above: a miss is a bug, never a silent no-op.
      RAISE EXCEPTION 'task_not_active' USING ERRCODE = '55000';
    END IF;
    UPDATE public.declutter_delivery_raises
       SET status = 'applied', stripe_payment_intent_id = p_payment_intent_id, paid_cents = p_amount_cents, paid_at = now(),
           livemode = p_livemode, applied_at = now(), updated_at = now()
     WHERE id = r.id;
    PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Delivery pay raised',
      format('Helprs now see $%s more for your delivery. If nobody takes it by %s, the raise comes back with your delivery fee.',
             to_char(r.raise_cents / 100.0, 'FM999990.00'),
             to_char(t.open_until AT TIME ZONE 'America/Chicago', 'Dy Mon FMDD at FMHH12:MI AM')),
      '/declutter?view=cart', NULL);
    RETURN jsonb_build_object('result', 'applied', 'raise_id', r.id, 'task_id', t.id,
      'pay_cents', t.pay_cents + r.raise_cents, 'fee_cents', public.helpr_task_fee_cents(t.pay_cents + r.raise_cents));
  END IF;
  UPDATE public.declutter_delivery_raises
     SET status = 'refunding', stripe_payment_intent_id = p_payment_intent_id, paid_cents = p_amount_cents, paid_at = now(),
         livemode = p_livemode, refund_reason = v_reason, refund_cents = p_amount_cents, refund_next_attempt_at = now(),
         updated_at = now()
   WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Your raise is coming back',
    format('The delivery was no longer waiting for a Helpr, so the $%s you paid to raise the pay is coming back to your card.',
           to_char(p_amount_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart', NULL);
  RETURN jsonb_build_object('result', 'refund', 'raise_id', r.id, 'reason', v_reason, 'refund_cents', p_amount_cents);
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_paid(uuid, uuid, text, text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_paid(uuid, uuid, text, text, integer, boolean) TO service_role;

-- 6. A task that ends without its Helpr being paid refunds every applied
-- raise, once (applied -> refunding happens once per row). At the table, so
-- every closing path (the no-Helpr sweep, a cancelled sale, damage in
-- delivery, an admin decision) is covered by one rule. A sale cancelled for
-- the buyer's own reason (or no one's fault) keeps the raise's card fee, as
-- the order's own refund does: declutter_close_paid_order closes the task
-- with its refund reason as the note (helpr_task_close(task, 'cancelled',
-- p_reason)), and these are declutter_record_refund's keep_card_fee and
-- keep_buyer_fee reasons. Every other close is ours or the seller's: in full.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raises_on_task_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_back integer;
  v_buyer uuid;
  v_buyer_side boolean;
BEGIN
  IF NEW.source_kind <> 'declutter_delivery' OR NEW.status NOT IN ('unfilled', 'cancelled', 'failed')
     OR OLD.status IN ('unfilled', 'cancelled', 'failed') THEN
    RETURN NEW;
  END IF;
  v_buyer_side := NEW.status = 'cancelled' AND COALESCE(NEW.close_note IN
    ('buyer_cancelled', 'buyer_restarted_checkout', 'admin_no_fault', 'buyer_no_show', 'admin_buyer_fault'), false);
  WITH back AS (
    UPDATE public.declutter_delivery_raises r
       SET status = 'refunding',
           refund_reason = CASE WHEN NEW.status = 'unfilled' THEN 'no_helpr' WHEN NEW.status = 'failed' THEN 'delivery_failed'
                                WHEN v_buyer_side THEN 'delivery_cancelled_buyer' ELSE 'delivery_cancelled' END,
           refund_cents = CASE WHEN v_buyer_side THEN r.paid_cents - r.card_fee_cents ELSE r.paid_cents END,
           refund_next_attempt_at = now(), updated_at = now()
     WHERE r.task_id = NEW.id AND r.status = 'applied'
    RETURNING r.refund_cents)
  SELECT sum(refund_cents)::integer INTO v_back FROM back;
  IF COALESCE(v_back, 0) > 0 THEN
    SELECT o.buyer_id INTO v_buyer FROM public.declutter_orders o WHERE o.id = NEW.source_id;
    PERFORM public.declutter_notify(v_buyer, 'payment', 'Your raise is coming back',
      format(CASE WHEN v_buyer_side THEN 'The $%s you added to the delivery pay is coming back to your card (its card fee is not refunded).'
                  ELSE 'The $%s you paid to raise the delivery pay is coming back to your card.' END,
             to_char(v_back / 100.0, 'FM999990.00')),
      '/declutter?view=cart', NULL);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raises_on_task_close() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_declutter_delivery_raises_on_task_close ON public.helpr_tasks;
CREATE TRIGGER trg_declutter_delivery_raises_on_task_close AFTER UPDATE OF status ON public.helpr_tasks
  FOR EACH ROW EXECUTE FUNCTION public.declutter_delivery_raises_on_task_close();

-- 7. What the buyer's "Raise the pay" panel shows (their own order only).
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_status(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  o public.declutter_orders;
  t public.helpr_tasks;
BEGIN
  PERFORM public.require_feature('declutter');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO o FROM public.declutter_orders x WHERE x.id = p_order_id AND x.buyer_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT tk.* INTO t FROM public.declutter_order_deliveries od JOIN public.helpr_tasks tk ON tk.id = od.task_id
   WHERE od.order_id = o.id;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'task_status', t.status,
    'open_until', t.open_until,
    'delivery_cents', o.delivery_cents,
    'raised_cents', COALESCE(t.raised_cents, 0),
    'can_raise', public.declutter_delivery_raise_open(o, t, 60) AND COALESCE(t.raised_cents, 0) + 500 <= 15000,
    'room_cents', greatest(15000 - COALESCE(t.raised_cents, 0), 0),
    'rules', public.declutter_delivery_raise_rules(),
    'raises', COALESCE((SELECT jsonb_agg(jsonb_build_object('raise_cents', r.raise_cents, 'card_fee_cents', r.card_fee_cents,
                          'total_cents', r.total_cents, 'status', r.status, 'refund_reason', r.refund_reason,
                          'paid_at', r.paid_at) ORDER BY r.created_at)
                          FROM public.declutter_delivery_raises r
                         WHERE r.order_id = o.id AND r.status IN ('applied', 'refunding', 'refunded')), '[]'::jsonb));
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_status(uuid) TO authenticated, service_role;

-- 8. The raise-refund queue (declutter-money executes it with Stripe, key
-- `declutter-raise-refund-<id>`, on the raise's OWN charge) and its reports.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_refunds_due(p_limit integer)
RETURNS TABLE (raise_id uuid, reason text, order_id uuid, buyer_id uuid, seller_id uuid, payment_intent_id text,
               refund_cents integer, attempts integer, livemode boolean, checkout_session_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT r.id, r.refund_reason, r.order_id, o.buyer_id, o.seller_id, r.stripe_payment_intent_id, r.refund_cents,
         r.refund_attempts, r.livemode, r.stripe_checkout_session_id
    FROM public.declutter_delivery_raises r
    JOIN public.declutter_orders o ON o.id = r.order_id
   WHERE r.status = 'refunding' AND r.refund_next_attempt_at <= now() AND r.refund_attempts < 12
   ORDER BY r.refund_next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_refunds_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_refunds_due(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_refund_executed(p_raise_id uuid, p_stripe_refund_id text,
  p_succeeded boolean, p_error text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF p_succeeded IS NULL OR (p_succeeded AND (p_stripe_refund_id IS NULL OR p_stripe_refund_id !~ '^(re|pyr)_')) THEN
    RAISE EXCEPTION 'invalid_result' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_delivery_raises
     SET status = CASE WHEN p_succeeded THEN 'refunded' ELSE 'refunding' END,
         stripe_refund_ref = CASE WHEN p_succeeded THEN p_stripe_refund_id ELSE stripe_refund_ref END,
         refunded_at = CASE WHEN p_succeeded THEN now() ELSE refunded_at END,
         refund_last_error = CASE WHEN p_succeeded THEN NULL ELSE left(p_error, 500) END,
         refund_attempts = CASE WHEN p_succeeded THEN refund_attempts ELSE least(refund_attempts + 1, 100) END,
         refund_next_attempt_at = CASE WHEN p_succeeded THEN refund_next_attempt_at
                                       ELSE now() + least(interval '10 minutes' * power(2, least(refund_attempts, 8)), interval '1 day') END,
         updated_at = now()
   WHERE id = p_raise_id AND status = 'refunding'
  RETURNING status INTO v_status;
  IF NOT FOUND THEN
    SELECT status INTO v_status FROM public.declutter_delivery_raises WHERE id = p_raise_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'raise_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_refund_executed(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_refund_executed(uuid, text, boolean, text) TO service_role;

-- A refund row skipped this run without a try (a party under ban review): later, never at the queue's front.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_refund_defer(p_raise_id uuid, p_minutes integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  UPDATE public.declutter_delivery_raises
     SET refund_next_attempt_at = now() + make_interval(mins => least(greatest(COALESCE(p_minutes, 15), 1), 1440)), updated_at = now()
   WHERE id = p_raise_id AND status = 'refunding';
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_refund_defer(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_refund_defer(uuid, integer) TO service_role;

-- Stripe moved a raise refund it had taken to failed / canceled
-- (charge.refund.updated): only the refund the row recorded reopens it.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_refund_reversed(p_raise_id uuid, p_stripe_refund_id text, p_why text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE public.declutter_delivery_raises
     SET status = 'refunding', refunded_at = NULL, refund_attempts = least(refund_attempts + 1, 100), refund_next_attempt_at = now(),
         refund_last_error = left('Stripe moved refund ' || p_stripe_refund_id || ' to ' || COALESCE(p_why, 'failed'), 500),
         updated_at = now()
   WHERE id = p_raise_id AND stripe_refund_ref = p_stripe_refund_id AND status = 'refunded'
  RETURNING refund_attempts INTO v_attempts;
  IF NOT FOUND THEN
    RETURN 'unchanged';
  END IF;
  RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_refund_reversed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_refund_reversed(uuid, text, text) TO service_role;

-- The transfer that paid a raise to the Helpr (declutter-money, once the
-- raise part of the payout is sent or found): recorded on the raise, so the
-- restore check and a person can see every part of a split payout.
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_payout_sent(p_raise_id uuid, p_transfer_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_have text;
BEGIN
  IF p_transfer_id IS NULL OR p_transfer_id !~ '^tr_' THEN
    RAISE EXCEPTION 'invalid_transfer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.declutter_delivery_raises SET payout_transfer_id = p_transfer_id, updated_at = now()
   WHERE id = p_raise_id AND status = 'applied' AND payout_transfer_id IS NULL;
  IF FOUND THEN
    RETURN 'recorded';
  END IF;
  SELECT payout_transfer_id INTO v_have FROM public.declutter_delivery_raises WHERE id = p_raise_id;
  IF v_have = p_transfer_id THEN
    RETURN 'already';
  END IF;
  -- Another transfer already recorded, or the raise is not applied: never overwritten silently.
  RAISE EXCEPTION 'raise_transfer_mismatch' USING ERRCODE = '55000';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_payout_sent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_payout_sent(uuid, text) TO service_role;

-- A refund made BY HAND in Stripe on a raise's charge (charge.refunded with
-- no Declutter kind: "refund it by hand" after the automatic one gave up).
-- Answers: not_raise (no raise has that payment: the order path decides),
-- settled (a raise waiting to go back is now refunded by it), already, or
-- recorded_other (anything else: the webhook pages a person; an applied raise
-- refunded by hand leaves the Helpr's pay above the money behind it).
CREATE OR REPLACE FUNCTION public.declutter_delivery_raise_hand_refund(p_payment_intent_id text, p_stripe_refund_id text,
  p_amount_cents integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.declutter_delivery_raises;
BEGIN
  SELECT * INTO r FROM public.declutter_delivery_raises WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_raise';
  END IF;
  IF r.status = 'refunded' AND r.stripe_refund_ref = p_stripe_refund_id THEN
    RETURN 'already';
  END IF;
  IF r.status = 'refunding' AND p_stripe_refund_id ~ '^(re|pyr)_' AND COALESCE(p_amount_cents, 0) >= r.refund_cents THEN
    UPDATE public.declutter_delivery_raises
       SET status = 'refunded', stripe_refund_ref = p_stripe_refund_id, refunded_at = now(), refund_last_error = NULL, updated_at = now()
     WHERE id = r.id;
    RETURN 'settled';
  END IF;
  RETURN 'recorded_other';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_delivery_raise_hand_refund(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_delivery_raise_hand_refund(text, text, integer) TO service_role;

-- 9. The Helpr payout queue, restated from 20261017055505 (its newest
-- definition) with raise_parts and raised_cents appended: the applied raises
-- of the task, each with its own charge, so declutter-money funds that part of
-- the ONE payout from the raise's charge (a transfer may not exceed its source
-- charge). A new return type, so the function is dropped first.
DROP FUNCTION IF EXISTS public.helpr_task_payouts_due(integer);
CREATE OR REPLACE FUNCTION public.helpr_task_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, task_id uuid, source_kind text, source_id uuid, helpr_id uuid, customer_id uuid,
               pickup_contact_id uuid, amount_cents integer, stripe_account_id text, payment_intent_id text,
               transfer_group text, refunds_recorded_cents integer, attempts integer, raised_cents integer, raise_parts jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p.id, t.id, t.source_kind, t.source_id, p.helpr_id, t.customer_id, t.pickup_contact_id, p.amount_cents,
         pr.stripe_account_id,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN o.stripe_payment_intent_id END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN 'declutter_order_' || o.id::text END,
         CASE WHEN t.source_kind = 'declutter_delivery' THEN public.declutter_order_refunds_recorded_cents(o.id) END,
         p.attempts,
         t.raised_cents,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('raise_id', r.id, 'payment_intent_id', r.stripe_payment_intent_id,
                                                       'cents', r.raise_cents) ORDER BY r.applied_at, r.id)
                     FROM public.declutter_delivery_raises r
                    WHERE r.task_id = t.id AND r.status = 'applied'), '[]'::jsonb)
    FROM public.helpr_task_payouts p
    JOIN public.helpr_tasks t ON t.id = p.task_id
    LEFT JOIN public.declutter_orders o ON t.source_kind = 'declutter_delivery' AND o.id = t.source_id
    LEFT JOIN public.profiles pr ON pr.user_id = p.helpr_id
   WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now() AND p.attempts < 12
     AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)
   ORDER BY p.next_attempt_at
   LIMIT least(greatest(COALESCE(p_limit, 20), 1), 100);
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_payouts_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_payouts_due(integer) TO service_role;
