-- Freeze the money columns while a checkout session is open, not just after it settles.
--
-- `enforce_poster_jobs_money_lock` gated the funded-column set on
-- `OLD.payment_status IS DISTINCT FROM 'unpaid'`. But 'unpaid' is not the
-- moneyless state — it is the money-IN-FLIGHT state. `create-payment` stamps
-- `stripe_session_id` and deliberately leaves the row 'unpaid' while the Stripe
-- Checkout Session is open; only the webhook flips it to 'escrow'
-- (`checkoutSessionCompleted.ts:695` — "Mark as escrow only after confirmed
-- checkout").
--
-- So the lock stood open across exactly the window in which a session exists
-- with a FROZEN amount. A poster could open a $100 checkout, raise `budget` to
-- $5,000, pay the $100, and the job would then be worth $5,000 to every payout
-- path — none of which re-checks against what was actually collected. Proven
-- with a rolled-back non-admin impersonation against prod: the write succeeded
-- at 'unpaid' with a session set, and was refused at 'escrow'.
--
-- ── Why this is safe to tighten only now ────────────────────────────────────
--
-- The obvious version of this fix was NOT safe, and that is worth recording so
-- nobody re-derives it. Nothing cleared `stripe_session_id`: an abandoned
-- checkout left it stamped forever, so locking on it would have permanently
-- barred that poster from editing their own job's price, leaving it unpayable
-- at the old amount with no way out. `checkout.session.expired` only touched a
-- gift-card row and returned early for every ordinary job.
--
-- That handler now clears the job's `stripe_session_id` when a session expires
-- — scoped to that exact session id and only while the row is still 'unpaid',
-- so it can neither un-stamp a funded job nor let a stale re-delivery clear a
-- newer checkout. With the hold released on expiry, locking on it is safe.
--
-- ── Defence in depth, not instead of it ─────────────────────────────────────
--
-- This closes the window. It is deliberately not the only guard: the same pass
-- added the HARD CAP to `process-scheduled-payouts` (which had none) and made
-- `release-payout`'s cap cover gift-funded jobs (where it was a no-op, because
-- `escrowAmountReceivedCents` is null exactly when `source_transaction` is also
-- omitted, so both guards went missing together). A payout can no longer exceed
-- captured dollars plus applied gift credit on any path.
--
-- The whole `locked_when_funded` set is frozen, not just `budget`. Every column
-- in it is quoted or implied by an open session, and the `helper_id` exemption
-- inside the loop is unchanged — a job may still be awarded while open.

CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
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

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
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
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;
