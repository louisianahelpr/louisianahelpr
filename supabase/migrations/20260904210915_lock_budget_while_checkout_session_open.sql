-- Close the money-in-flight window: a poster could raise `budget` after the
-- Stripe Checkout Session had already frozen the amount they would pay.
--
-- enforce_poster_jobs_money_lock gates the locked_when_funded list (which
-- includes `budget`) on `OLD.payment_status IS DISTINCT FROM 'unpaid'`. But
-- 'unpaid' is not the moneyless state — it is the MONEY-IN-FLIGHT state.
-- create-payment stamps stripe_session_id and deliberately leaves the row
-- 'unpaid'; only the webhook flips it to 'escrow' ("Mark as escrow only after
-- confirmed checkout", checkoutSessionCompleted.ts). So the lock stood open
-- across exactly the window in which a session exists with a frozen amount.
--
-- Nothing downstream re-checked: the webhook never compares
-- session.amount_total to budget, and payouts compute straight from budget.
-- release-payout and execute-dispute-split each carry a HARD CAP naming this
-- precise cause, but process-scheduled-payouts — the cron that pays the
-- ordinary job — has none, and on a gift/PIF-funded job both remaining guards
-- (escrowAmountReceivedCents, source_transaction) are skipped because there is
-- no Stripe charge to draw from. That path transfers uncapped from the
-- PLATFORM balance.
--
-- REPRODUCED against live prod in a rolled-back transaction, as a genuine
-- non-admin poster (set role authenticated, request.jwt.claims.sub = the
-- poster's user_id), on a job forced to payment_status='unpaid' with a
-- stripe_session_id set:
--     UPDATE jobs SET budget = 5000  ->  SUCCEEDED (40.00 -> 5000.00)
-- Negative control, same statement against an escrow-funded job:
--     ERROR 42501 "Posters may not modify jobs.budget after escrow is funded"
-- so the trigger was working exactly as written; the predicate was the bug.
--
-- THE FIX is one predicate: treat "a checkout session exists" as money in
-- flight, alongside "payment_status is no longer unpaid". Once Stripe has
-- frozen an amount, the fields that amount was computed from must freeze too.
--
-- NO NEW LOCKOUT. The only state in which a poster could edit budget was
-- 'unpaid'; 'abandoned' (what the void-cancelled-payments sweep writes an hour
-- later) is already DISTINCT FROM 'unpaid' and therefore already locked today.
-- So this narrows the editable window to "unpaid AND no session has been
-- opened yet", which is the state a job is in before its first checkout — and
-- leaves every other path exactly as it was.
--
-- This is fix (1) of the three in docs/PAYOUT_BUDGET_RAISE_GAP.md — it closes
-- the window itself rather than catching the consequences. The two payout-side
-- caps in that document remain worth porting as defence in depth.
--
-- Preserves the app.trusted_ladder_write bypass added earlier today
-- (20260904184848) — report_helper_no_show's server-owned reopen still needs it.
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  -- "Money is in flight" — either Stripe already holds it, or Stripe has
  -- quoted a frozen amount for it and is waiting to be paid.
  money_in_flight boolean;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
BEGIN
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  money_in_flight := OLD.payment_status IS DISTINCT FROM 'unpaid'
                     OR OLD.stripe_session_id IS NOT NULL;

  IF money_in_flight THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- Message names the actual reason. "after escrow is funded" was wrong
        -- for the session-open case and would have sent someone looking for a
        -- payment that had not happened yet.
        RAISE EXCEPTION 'Posters may not modify jobs.% once payment is in progress', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;
