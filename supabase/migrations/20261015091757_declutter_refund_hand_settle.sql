-- Declutter refunds that give up, and refunds made by hand, reach the books
-- (docs/specs/declutter-auctions.md, "Open after slice 4": lh-money-escrow
-- should-fixes (a) and (b), before the switch goes past testers).
--
-- ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────
-- (a) A refund row that reached its 12th failed try (declutter_refunds_due
--     offers attempts < 12) was never offered again, and the only trace was a
--     Slack page or a cron defect line. Nothing stayed OPEN until a person
--     dealt with it, and the buyer, who may already have been told "on its way
--     back", was told nothing more.
-- (b) "Refund it by hand" had no way back into our books: a refund made in the
--     Stripe Dashboard carries no metadata kind=declutter_refund, so
--     charge.refunded sent it down the JOBS path and the Declutter row stayed
--     'failed' (and the gave-up alert of (a) could never clear).
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
-- 1. declutter_refunds.gave_up_notified_at: set once, when the buyer is told.
-- 2. declutter_refund_gave_up_check(p_refund_id uuid DEFAULT NULL): for every
--    refund row that is 'failed' with attempts >= 12 (one row, or all):
--      * one error_logs row per refund row per UTC day (tags.source
--        'declutter-refund-gave-up'), which trg_error_logs_zz_ledger turns into
--        an ops_alert_ledger item (verify_kind 'manual': open until a person
--        closes it, re-opened by the next day's row while the refund is still
--        not settled). Seed rows carry tags.seed so they go to the digest.
--      * once per refund row, an in-app notice to the buyer in plain words:
--        the refund is being sent by hand by our team.
--    Called when a row gives up (declutter_refund_executed and
--    declutter_refund_reversed, both restated below) and by every
--    declutter-money run (the daily re-raise). Returns how many rows gave up.
-- 3. declutter_hand_refunds + declutter_record_hand_refund(...): the webhook
--    records a refund on a Declutter payment that Declutter did not create
--    (no metadata kind), idempotently per Stripe refund id. When the payment
--    has a refund row not yet 'succeeded' and the hand refund is for AT LEAST
--    that row's amount (the buyer got what the row owed), the row is settled ('succeeded', stripe_refund_ref =
--    the hand refund) and the buyer is told; anything else is recorded and the
--    caller pages for a person to check. It NEVER moves money and never
--    creates a refund: the payout queue already refuses a charge with any
--    refund on it (declutter-money: "the order's charge is not whole").
--    Returns 'settled', 'recorded_short' (live hand refunds on the payment do
--    not yet cover the row), 'recorded_no_row', 'recorded_row_already_settled'
--    (the buyer may have been refunded twice), 'already' or 'not_declutter'.
-- 4. declutter_hand_refund_failed(stripe refund id, why): Stripe moved a hand
--    refund to failed / canceled (charge.refund.updated; the money never
--    left). When that refund had settled a row, the row goes back to 'failed'
--    (attempts unchanged: a gave-up row raises the gave-up alert again and the
--    buyer is told again; a row under the cap is retried by declutter-money)
--    and the buyer is told plainly. Returns 'reopened', 'recorded_failed',
--    'already' or 'not_declutter'.
--
-- Restated from their NEWEST bodies (20261015042253, no later copy):
-- declutter_refund_executed and declutter_refund_reversed, each verbatim plus
-- the gave-up call.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE; error_logs is guarded by
-- to_regclass. Grants: service_role only (REVOKE FROM PUBLIC, anon,
-- authenticated).

ALTER TABLE public.declutter_refunds ADD COLUMN IF NOT EXISTS gave_up_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.declutter_refund_gave_up_check(p_refund_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer := 0;
BEGIN
  FOR r IN
    SELECT d.id, d.order_id, d.refund_cents, d.attempts, d.is_seed, d.last_error, d.gave_up_notified_at, o.buyer_id
      FROM public.declutter_refunds d
      LEFT JOIN public.declutter_orders o ON o.id = d.order_id
     WHERE d.status = 'failed' AND d.attempts >= 12
       AND (p_refund_id IS NULL OR d.id = p_refund_id)
     ORDER BY d.created_at
     LIMIT 200
  LOOP
    v_n := v_n + 1;
    IF to_regclass('public.error_logs') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.error_logs e
       WHERE jsonb_typeof(e.tags) = 'object'
         AND e.tags ->> 'source' = 'declutter-refund-gave-up'
         AND e.tags ->> 'refund_id' = r.id::text
         AND e.created_at > date_trunc('day', now())
    ) THEN
      -- One ledger item for every gave-up refund (the title before ' — ' is
      -- the fingerprint); the detail names this row.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error',
              format('Declutter refund gave up after 12 tries: refund it by hand in Stripe — refund row %s ($%s, order %s). Last error: %s',
                     r.id, to_char(r.refund_cents / 100.0, 'FM999990.00'), coalesce(r.order_id::text, 'none'),
                     coalesce(left(r.last_error, 200), 'none recorded')),
              jsonb_strip_nulls(jsonb_build_object('source', 'declutter-refund-gave-up', 'area', 'declutter',
                                                   'refund_id', r.id::text,
                                                   'seed', CASE WHEN r.is_seed THEN 'true' END)),
              jsonb_build_object('refund_id', r.id, 'order_id', r.order_id, 'refund_cents', r.refund_cents,
                                 'attempts', r.attempts));
    END IF;
    IF r.gave_up_notified_at IS NULL THEN
      UPDATE public.declutter_refunds SET gave_up_notified_at = now()
       WHERE id = r.id AND gave_up_notified_at IS NULL;
      IF FOUND THEN
        PERFORM public.declutter_notify(r.buyer_id, 'payment', 'Your refund is being sent by hand',
          format('We could not send your $%s refund to your card automatically, so our team is sending it by hand. You do not need to do anything. We will tell you when it is on its way.',
                 to_char(r.refund_cents / 100.0, 'FM999990.00')),
          '/declutter?view=cart');
      END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_gave_up_check(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_gave_up_check(uuid) TO service_role;

-- What Stripe did with a refund row (restated from 20261015042253): a
-- succeeded row is final; a failure counts an attempt and backs off (B57).
-- New: the failure that uses the 12th try raises the gave-up alert and tells
-- the buyer (declutter_refund_gave_up_check).
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
  ELSIF v_status = 'failed' THEN
    PERFORM public.declutter_refund_gave_up_check(p_refund_id);
  END IF;
  RETURN v_status;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_executed(uuid, text, boolean) TO service_role;

-- Stripe moved a refund it had taken to failed / canceled (restated from
-- 20261015042253, verbatim plus the gave-up call): only the refund the row
-- RECORDED reopens it, the reversal counts as a try, and at the 12-try cap the
-- answer is 'gave_up' (the row is not offered again). New: 'gave_up' raises
-- the gave-up alert and tells the buyer (declutter_refund_gave_up_check).
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
  IF v_attempts >= 12 THEN
    PERFORM public.declutter_refund_gave_up_check(p_refund_id);
  END IF;
  RETURN CASE WHEN v_attempts >= 12 THEN 'gave_up' ELSE 'reopened' END;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_reversed(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_reversed(uuid, text, text) TO service_role;

-- Refunds made by hand (Stripe Dashboard) on a Declutter payment. Service
-- role only: no member reads or writes it (the refund row the two sides read
-- carries the outcome).
CREATE TABLE IF NOT EXISTS public.declutter_hand_refunds (
  stripe_refund_id text PRIMARY KEY CHECK (stripe_refund_id ~ '^(re|pyr)_'),
  stripe_payment_intent_id text NOT NULL CHECK (stripe_payment_intent_id ~ '^pi_'),
  order_id uuid REFERENCES public.declutter_orders(id) ON DELETE SET NULL,
  refund_row_id uuid REFERENCES public.declutter_refunds(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  livemode boolean NOT NULL,
  -- 'settled': it settled refund_row_id; 'recorded': recorded only (a person checks it).
  outcome text NOT NULL CHECK (outcome IN ('settled', 'recorded')),
  -- Stripe moved this refund to failed / canceled after we recorded it (charge.refund.updated).
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS declutter_hand_refunds_pi_idx ON public.declutter_hand_refunds (stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS declutter_hand_refunds_order_idx ON public.declutter_hand_refunds (order_id);
CREATE INDEX IF NOT EXISTS declutter_hand_refunds_row_idx ON public.declutter_hand_refunds (refund_row_id);
ALTER TABLE public.declutter_hand_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.declutter_hand_refunds FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.declutter_hand_refunds TO service_role;

-- Q807: the unconfirmed-email gate on the new table, like every Declutter slice
-- (it skips a table that already has the trigger, so a replay is a no-op).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.declutter_record_hand_refund(p_payment_intent_id text, p_stripe_refund_id text,
  p_amount_cents integer, p_livemode boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_row public.declutter_refunds%ROWTYPE;
  v_order uuid;
  v_buyer uuid;
  v_settle boolean := false;
  v_covered bigint;
BEGIN
  IF p_payment_intent_id IS NULL OR p_stripe_refund_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0
     OR p_livemode IS NULL THEN
    RAISE EXCEPTION 'invalid_hand_refund' USING ERRCODE = '22023';
  END IF;
  -- The refund row of this payment, locked: the cron and the webhook write it too.
  SELECT * INTO v_row FROM public.declutter_refunds r WHERE r.stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF FOUND THEN
    v_order := v_row.order_id;
  ELSE
    SELECT o.id INTO v_order FROM public.declutter_orders o WHERE o.stripe_payment_intent_id = p_payment_intent_id;
    IF NOT FOUND THEN
      RETURN 'not_declutter';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.declutter_hand_refunds h WHERE h.stripe_refund_id = p_stripe_refund_id)
     OR (v_row.id IS NOT NULL AND v_row.stripe_refund_ref = p_stripe_refund_id) THEN
    RETURN 'already';
  END IF;
  -- Every live hand refund on this payment counts (two partial ones can cover the row together).
  v_covered := p_amount_cents + COALESCE((SELECT sum(h.amount_cents) FROM public.declutter_hand_refunds h
                                          WHERE h.stripe_payment_intent_id = p_payment_intent_id AND h.failed_at IS NULL), 0);
  v_settle := v_row.id IS NOT NULL AND v_row.status <> 'succeeded' AND v_covered >= v_row.refund_cents;
  INSERT INTO public.declutter_hand_refunds (stripe_refund_id, stripe_payment_intent_id, order_id, refund_row_id,
                                             amount_cents, livemode, outcome)
  VALUES (p_stripe_refund_id, p_payment_intent_id, v_order, v_row.id, p_amount_cents, p_livemode,
          CASE WHEN v_settle THEN 'settled' ELSE 'recorded' END)
  ON CONFLICT (stripe_refund_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'already';
  END IF;
  IF NOT v_settle THEN
    -- Which kind of 'recorded', so the page says what a person must check.
    RETURN CASE WHEN v_row.id IS NULL THEN 'recorded_no_row'
                WHEN v_row.status = 'succeeded' THEN 'recorded_row_already_settled'
                ELSE 'recorded_short' END;
  END IF;
  UPDATE public.declutter_refunds
     SET status = 'succeeded', stripe_refund_ref = p_stripe_refund_id, executed_at = now(),
         last_error = left('settled by hand in Stripe: ' || p_stripe_refund_id, 500)
   WHERE id = v_row.id;
  SELECT o.buyer_id INTO v_buyer FROM public.declutter_orders o WHERE o.id = v_order;
  PERFORM public.declutter_notify(v_buyer, 'payment', 'Refund on its way',
    format('Your $%s refund is on its way back to your card. Card refunds usually show up in 5 to 10 business days.',
           to_char(v_row.refund_cents / 100.0, 'FM999990.00')),
    '/declutter?view=cart');
  RETURN 'settled';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_record_hand_refund(text, text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_record_hand_refund(text, text, integer, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_hand_refund_failed(p_stripe_refund_id text, p_why text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_hand public.declutter_hand_refunds%ROWTYPE;
  v_row public.declutter_refunds%ROWTYPE;
  v_buyer uuid;
BEGIN
  SELECT * INTO v_hand FROM public.declutter_hand_refunds h WHERE h.stripe_refund_id = p_stripe_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_declutter';
  END IF;
  IF v_hand.failed_at IS NOT NULL THEN
    RETURN 'already';
  END IF;
  UPDATE public.declutter_hand_refunds SET failed_at = now() WHERE stripe_refund_id = p_stripe_refund_id;
  IF v_hand.refund_row_id IS NULL THEN
    RETURN 'recorded_failed';
  END IF;
  SELECT * INTO v_row FROM public.declutter_refunds r WHERE r.id = v_hand.refund_row_id FOR UPDATE;
  -- Reopen only a row settled BY HAND (this refund, or hand refunds summed with it) that the live
  -- hand refunds left no longer cover (money re-review of lane J: an EARLIER partial that fails).
  IF NOT FOUND OR v_row.status <> 'succeeded'
     OR NOT (v_row.stripe_refund_ref = p_stripe_refund_id
             OR EXISTS (SELECT 1 FROM public.declutter_hand_refunds h
                         WHERE h.refund_row_id = v_row.id AND h.outcome = 'settled'
                           AND h.stripe_refund_id = v_row.stripe_refund_ref))
     OR COALESCE((SELECT sum(h.amount_cents) FROM public.declutter_hand_refunds h
                   WHERE h.stripe_payment_intent_id = v_hand.stripe_payment_intent_id AND h.failed_at IS NULL), 0)
        >= v_row.refund_cents THEN
    RETURN 'recorded_failed';
  END IF;
  UPDATE public.declutter_refunds
     SET status = 'failed', next_attempt_at = now(), gave_up_notified_at = NULL,
         last_error = left('Stripe moved hand refund ' || p_stripe_refund_id || ' to ' || COALESCE(p_why, 'failed'), 500)
   WHERE id = v_row.id;
  IF v_row.attempts >= 12 THEN
    -- The gave-up alert again, and the buyer told again that it is being sent by hand.
    PERFORM public.declutter_refund_gave_up_check(v_row.id);
  ELSE
    SELECT o.buyer_id INTO v_buyer FROM public.declutter_orders o WHERE o.id = v_row.order_id;
    PERFORM public.declutter_notify(v_buyer, 'payment', 'Your refund did not go through',
      format('Your $%s refund did not reach your card. We are sending it again. You do not need to do anything.',
             to_char(v_row.refund_cents / 100.0, 'FM999990.00')),
      '/declutter?view=cart');
  END IF;
  RETURN 'reopened';
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_hand_refund_failed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_hand_refund_failed(text, text) TO service_role;
