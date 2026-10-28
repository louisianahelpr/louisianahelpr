-- Tips on Declutter deliveries (Q2453; lead 2026-10-27).
--
-- Before: a buyer could tip the Helpr of a JOB (create-payment action "tip"),
-- but not the Helpr who carried a Declutter item to their door.
--
-- After: once a delivery is done (helpr_tasks.status 'confirmed': the buyer's
-- "I got it", the 24-hour auto-confirm, or an admin), its buyer can add a tip
-- for the delivery Helpr. The money follows the Jobs tip rule EXACTLY
-- (supabase/functions/_shared/tipFees.ts, owner 2026-09-25: "The poster pays
-- the fee so helpr gets 100%"): a destination charge to the Helpr's own
-- Stripe account for tip + card fee, with application_fee_amount = the card
-- fee, so the Helpr receives exactly the tip and the platform keeps only what
-- covers Stripe's cost of the charge (it never absorbs it). $3 to $1,000, card
-- and Link only, the same as a job tip. The fee math lives ONLY in tipFees.ts
-- (declutter-checkout action delivery_tip quotes and charges it); this file
-- stores the tip and what was charged, and never computes a fee.
--
--   helpr_task_tips          one row per tip attempt: task, tipper, Helpr, the
--                            tip, the Stripe page, and once paid the
--                            PaymentIntent, what was charged and when. Read:
--                            the tipper and the Helpr, their own rows only.
--                            Written only by the functions below.
--   helpr_task_tip_start     AS THE BUYER: the delivery is theirs and done, the
--                            Helpr is someone else and not blocked, the tip is
--                            $3..$1,000. One row per (task, tipper, attempt,
--                            amount), so a retry of one prompt reuses its row
--                            (the Jobs rule: the attempt id salts the Stripe key).
--   helpr_task_tip_attach    service only: the Stripe page's id on its row.
--   helpr_task_tip_paid      service only (stripe-webhook): marks the row paid
--                            ONCE and tells the Helpr who tipped them and how much.
--
-- A Helpr with NO payout account yet (owner decision 2026-10-28, issue #3706,
-- option 2): the tip is still taken, and HELD with the Helpr's held delivery
-- pay, the existing "pay waits for the account" path (Q2416). The row is
-- marked held; the charge is the same tip + card fee, made on the platform
-- (no destination), so nothing is absorbed: Stripe's card cost comes out of the
-- fee as on a job tip. helpr_task_payouts_due names each held, paid, unsent tip
-- of a payout (tip_parts); declutter-money sends each as its own transfer of
-- EXACTLY the tip, from the tip's own charge, in the same run as the delivery
-- pay (one more part, as a raise is: _shared/helprPayoutParts.ts), and records
-- it with helpr_task_tip_payout_sent. The Helpr is told to set up payouts
-- ("money is owed": the only time it is asked). A held tip needs the delivery's
-- payout row still waiting; a tip whose payout already went is paged to staff.
--
-- Behind the 'declutter' switch, like the delivery itself (helpr_task_source_require_feature).
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS. Grants by
-- role name (REVOKE ... FROM PUBLIC, anon). Proof (3x replay):
-- src/test/pglite/helprTaskTips.pglite.mjs. Guard: src/test/deliveryTips.test.ts.

CREATE TABLE IF NOT EXISTS public.helpr_task_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT, as helpr_task_payouts: a paid tip is a money record (lh-money-escrow review nit 10).
  task_id uuid NOT NULL REFERENCES public.helpr_tasks(id) ON DELETE RESTRICT,
  -- A tip outlives a deleted account (money records stay; the person goes).
  tipper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  helpr_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The tip the buyer chose. The Helpr receives exactly this (tipFees.ts).
  tip_cents integer NOT NULL CHECK (tip_cents BETWEEN 300 AND 100000),
  -- The tip prompt's own id (one per opening), as in a job tip.
  attempt_id uuid NOT NULL,
  stripe_session_id text UNIQUE,
  stripe_payment_intent_id text,
  -- What the buyer's card was charged (tip + card fee), from Stripe, once paid, as Stripe says it
  -- (a short charge is kept as it is and paged by the webhook; lh-money-escrow review nit 9).
  charged_cents integer CHECK (charged_cents IS NULL OR charged_cents > 0),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  paid_at timestamptz,
  -- Owner #3706: true = charged on the platform and paid with the Helpr's held delivery pay
  -- (they had no payout account); false = a destination charge, already the Helpr's.
  held boolean NOT NULL DEFAULT false,
  -- A held tip's own transfer to the Helpr, once declutter-money sent it.
  payout_transfer_id text UNIQUE CHECK (payout_transfer_id IS NULL OR payout_transfer_id ~ '^tr_'),
  paid_out_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helpr_task_tips_one_per_attempt UNIQUE (task_id, tipper_id, attempt_id, tip_cents),
  CONSTRAINT helpr_task_tips_paid CHECK ((payment_status = 'paid') = (paid_at IS NOT NULL)
                                         AND (payment_status = 'paid') <= (charged_cents IS NOT NULL)),
  CONSTRAINT helpr_task_tips_paid_out CHECK ((payout_transfer_id IS NULL) = (paid_out_at IS NULL)
                                             AND (payout_transfer_id IS NULL OR (held AND payment_status = 'paid')))
);
CREATE INDEX IF NOT EXISTS helpr_task_tips_helpr_idx ON public.helpr_task_tips (helpr_id);
CREATE INDEX IF NOT EXISTS helpr_task_tips_tipper_idx ON public.helpr_task_tips (tipper_id);
ALTER TABLE public.helpr_task_tips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.helpr_task_tips FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.helpr_task_tips TO authenticated;
GRANT ALL ON TABLE public.helpr_task_tips TO service_role;
DROP POLICY IF EXISTS "helpr task tips: tipper and helpr read own" ON public.helpr_task_tips;
CREATE POLICY "helpr task tips: tipper and helpr read own" ON public.helpr_task_tips
  FOR SELECT TO authenticated USING (tipper_id = (SELECT auth.uid()) OR helpr_id = (SELECT auth.uid()));

-- A tip row is seed when its task is (helpr_task_rows_seed, 20261017055505: reads NEW.task_id).
DROP TRIGGER IF EXISTS trg_helpr_task_tips_seed ON public.helpr_task_tips;
CREATE TRIGGER trg_helpr_task_tips_seed BEFORE INSERT ON public.helpr_task_tips
  FOR EACH ROW EXECUTE FUNCTION public.helpr_task_rows_seed();

-- The buyer starts a tip. Returns the row the Stripe page is made for.
CREATE OR REPLACE FUNCTION public.helpr_task_tip_start(p_task_id uuid, p_tip_cents integer, p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  t public.helpr_tasks;
  r public.helpr_task_tips;
  v_held boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_tip_cents IS NULL OR p_tip_cents < 300 OR p_tip_cents > 100000 OR p_attempt_id IS NULL THEN
    RAISE EXCEPTION 'invalid_tip' USING ERRCODE = '22023', HINT = 'Tips are $3 to $1,000.';
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task_id;
  -- Only the delivery's own buyer: anyone else is told it does not exist.
  IF NOT FOUND OR t.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.helpr_task_source_require_feature(t.source_kind);
  IF t.status <> 'confirmed' THEN
    RAISE EXCEPTION 'tip_not_yet' USING ERRCODE = '55000', HINT = 'You can add a tip once the delivery is done.';
  END IF;
  IF t.helpr_id IS NULL OR t.helpr_id = v_uid OR public.are_users_blocked(v_uid, t.helpr_id) THEN
    RAISE EXCEPTION 'tip_unavailable' USING ERRCODE = '55000', HINT = 'This delivery can''t take a tip.';
  END IF;
  -- Owner #3706: no payout account yet -> the tip is held with the delivery pay, which must still be waiting.
  v_held := NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = t.helpr_id AND pr.stripe_account_id IS NOT NULL);
  IF v_held AND NOT EXISTS (SELECT 1 FROM public.helpr_task_payouts p
                             WHERE p.task_id = t.id AND p.status IN ('pending', 'failed', 'held_for_review')) THEN
    RAISE EXCEPTION 'tip_unavailable' USING ERRCODE = '55000', HINT = 'This delivery can''t take a tip.';
  END IF;
  INSERT INTO public.helpr_task_tips (task_id, tipper_id, helpr_id, tip_cents, attempt_id, held)
  VALUES (t.id, v_uid, t.helpr_id, p_tip_cents, p_attempt_id, v_held)
  ON CONFLICT (task_id, tipper_id, attempt_id, tip_cents) DO NOTHING;
  SELECT * INTO r FROM public.helpr_task_tips
   WHERE task_id = t.id AND tipper_id = v_uid AND attempt_id = p_attempt_id AND tip_cents = p_tip_cents;
  RETURN jsonb_build_object('tip_id', r.id, 'helpr_id', r.helpr_id, 'tip_cents', r.tip_cents, 'title', t.title,
    'payment_status', r.payment_status, 'stripe_session_id', r.stripe_session_id, 'held', r.held);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_tip_start(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helpr_task_tip_start(uuid, integer, uuid) TO authenticated, service_role;

-- The Stripe page's id, on its still-pending row (a row keeps the first page it was given).
CREATE OR REPLACE FUNCTION public.helpr_task_tip_attach(p_tip_id uuid, p_session_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_tip_id IS NULL OR NULLIF(btrim(p_session_id), '') IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.helpr_task_tips SET stripe_session_id = p_session_id
   WHERE id = p_tip_id AND payment_status = 'pending' AND stripe_session_id IS NULL;
  RETURN EXISTS (SELECT 1 FROM public.helpr_task_tips WHERE id = p_tip_id AND stripe_session_id = p_session_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_tip_attach(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_tip_attach(uuid, text) TO service_role;

-- stripe-webhook: the page was paid. Marks the row paid once and tells the Helpr once.
-- Answers 'paid' (just now), 'already' (a replay), 'unknown' (no such row) or
-- 'session_mismatch' (the row belongs to another page). A held tip also answers
-- 'attached': false when its delivery payout no longer waits (staff pay it by hand).
CREATE OR REPLACE FUNCTION public.helpr_task_tip_paid(p_tip_id uuid, p_session_id text, p_payment_intent_id text, p_charged_cents integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.helpr_task_tips;
  v_name text;
  v_attached boolean;
  v_has_account boolean;
BEGIN
  SELECT * INTO r FROM public.helpr_task_tips WHERE id = p_tip_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'unknown');
  END IF;
  IF r.stripe_session_id IS NOT NULL AND r.stripe_session_id IS DISTINCT FROM p_session_id THEN
    RETURN jsonb_build_object('result', 'session_mismatch', 'tip_id', r.id);
  END IF;
  v_attached := NOT r.held OR EXISTS (SELECT 1 FROM public.helpr_task_payouts p
                                        WHERE p.task_id = r.task_id AND p.status IN ('pending', 'failed', 'held_for_review'));
  IF r.payment_status = 'paid' THEN
    RETURN jsonb_build_object('result', 'already', 'tip_id', r.id, 'helpr_id', r.helpr_id, 'tip_cents', r.tip_cents,
      'held', r.held, 'attached', v_attached OR r.payout_transfer_id IS NOT NULL);
  END IF;
  UPDATE public.helpr_task_tips
     SET payment_status = 'paid', paid_at = now(), stripe_session_id = p_session_id,
         stripe_payment_intent_id = p_payment_intent_id, charged_cents = p_charged_cents
   WHERE id = r.id;
  -- Owner 2026-10-21: say who, as "First L."; the Helpr receives the whole tip.
  SELECT public.member_display_name(p.full_name, 'Someone') INTO v_name FROM public.profiles p WHERE p.user_id = r.tipper_id;
  v_has_account := EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.user_id = r.helpr_id AND pr.stripe_account_id IS NOT NULL);
  PERFORM public.declutter_notify(r.helpr_id, 'payment', 'You received a tip!',
    CASE WHEN NOT r.held
         THEN format('%s tipped you $%s for a delivery. Thanks for the great work!', COALESCE(v_name, 'Someone'), to_char(r.tip_cents / 100.0, 'FM999990.00'))
         WHEN NOT v_attached
         THEN format('%s tipped you $%s for a delivery. We will send it to you.', COALESCE(v_name, 'Someone'), to_char(r.tip_cents / 100.0, 'FM999990.00'))
         WHEN NOT v_has_account
         THEN format('%s tipped you $%s for a delivery. Set up payouts in Settings to get it with your delivery pay.', COALESCE(v_name, 'Someone'), to_char(r.tip_cents / 100.0, 'FM999990.00'))
         ELSE format('%s tipped you $%s for a delivery. It comes with your delivery pay.', COALESCE(v_name, 'Someone'), to_char(r.tip_cents / 100.0, 'FM999990.00')) END,
    '/declutter?view=deliver', r.tipper_id);
  RETURN jsonb_build_object('result', 'paid', 'tip_id', r.id, 'helpr_id', r.helpr_id, 'tip_cents', r.tip_cents,
    'held', r.held, 'attached', v_attached);
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_tip_paid(uuid, text, text, integer) TO service_role;

-- declutter-money's queue of delivery pay: 20261021185418's body with ONE added column, tip_parts:
-- each held, paid tip of the payout not yet sent (owner #3706). The return type changes, so the
-- function is dropped first (as 20261021185418 did); only declutter-money calls it (service role).
DROP FUNCTION IF EXISTS public.helpr_task_payouts_due(integer);
CREATE OR REPLACE FUNCTION public.helpr_task_payouts_due(p_limit integer)
RETURNS TABLE (payout_id uuid, task_id uuid, source_kind text, source_id uuid, helpr_id uuid, customer_id uuid,
               pickup_contact_id uuid, amount_cents integer, stripe_account_id text, payment_intent_id text,
               transfer_group text, refunds_recorded_cents integer, attempts integer, raised_cents integer, raise_parts jsonb,
               tip_parts jsonb)
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
                    WHERE r.task_id = t.id AND r.status = 'applied'), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('tip_id', x.id, 'payment_intent_id', x.stripe_payment_intent_id,
                                                       'cents', x.tip_cents) ORDER BY x.paid_at, x.id)
                     FROM public.helpr_task_tips x
                    WHERE x.task_id = t.id AND x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL), '[]'::jsonb)
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

-- declutter-money: a held tip's own transfer went (with the delivery pay). Records it once and tells
-- the Helpr. Answers 'recorded', 'already' (this transfer was recorded) or 'mismatch' (not a held,
-- paid tip, or another transfer is recorded for it: nothing is changed).
CREATE OR REPLACE FUNCTION public.helpr_task_tip_payout_sent(p_tip_id uuid, p_transfer_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.helpr_task_tips;
BEGIN
  IF p_tip_id IS NULL OR p_transfer_id IS NULL OR p_transfer_id !~ '^tr_' THEN
    RETURN 'mismatch';
  END IF;
  SELECT * INTO r FROM public.helpr_task_tips WHERE id = p_tip_id FOR UPDATE;
  IF NOT FOUND OR NOT r.held OR r.payment_status <> 'paid' THEN
    RETURN 'mismatch';
  END IF;
  IF r.payout_transfer_id IS NOT NULL THEN
    RETURN CASE WHEN r.payout_transfer_id = p_transfer_id THEN 'already' ELSE 'mismatch' END;
  END IF;
  UPDATE public.helpr_task_tips SET payout_transfer_id = p_transfer_id, paid_out_at = now() WHERE id = r.id;
  PERFORM public.declutter_notify(r.helpr_id, 'payment', 'Your tip is on its way',
    format('Your $%s delivery tip is on its way to your payout account.', to_char(r.tip_cents / 100.0, 'FM999990.00')),
    '/declutter?view=deliver', NULL);
  RETURN 'recorded';
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_tip_payout_sent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_tip_payout_sent(uuid, text) TO service_role;

-- declutter-money, every run (lh-money-escrow review of the held tips, must-fix 1): each held, paid tip
-- not yet sent whose delivery payout no longer waits (it went without the tip, gave up, or was settled by
-- hand). Nothing would send these; declutter-money pages staff (critical, once a day per tip).
CREATE OR REPLACE FUNCTION public.helpr_task_tips_stranded()
RETURNS TABLE (tip_id uuid, task_id uuid, helpr_id uuid, tip_cents integer, payment_intent_id text, payout_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT x.id, x.task_id, x.helpr_id, x.tip_cents, x.stripe_payment_intent_id, p.status
    FROM public.helpr_task_tips x
    LEFT JOIN public.helpr_task_payouts p ON p.task_id = x.task_id
   WHERE x.held AND x.payment_status = 'paid' AND x.payout_transfer_id IS NULL
     AND (p.id IS NULL OR p.status NOT IN ('pending', 'failed', 'held_for_review')
          OR (p.status IN ('pending', 'failed') AND p.attempts >= 12))
   ORDER BY x.paid_at, x.id
   LIMIT 200;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_tips_stranded() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_tips_stranded() TO service_role;

-- Every public table keeps the unconfirmed-email gate (db-deploy smoke).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
