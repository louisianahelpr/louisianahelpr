-- SEC-001: the poster UPDATE policy on jobs (20260311000404) is all-columns
-- (`USING (auth.uid() = customer_id)`, no WITH CHECK), so after funding escrow a
-- poster could forge money-bearing columns directly via PostgREST — raising
-- `budget` to over-pay a colluding helper (release-payout reads live job.budget),
-- skewing `platform_fee_amount`/`helper_fee_percent`/`urgent_fee` to shrink the
-- platform cut, flipping `payment_status`, or reassigning `helper_id`. RLS can't
-- do column-level grants per-role-condition, so enforce a column BLACKLIST in a
-- BEFORE UPDATE trigger that only constrains poster-initiated updates.
--
-- Unlike the helper whitelist (20260703161000), a poster legitimately edits many
-- job fields (title, description, budget, date, …) WHILE the job is still unpaid.
-- So the money/fee/payment lock is gated on `OLD.payment_status <> 'unpaid'` —
-- once escrow exists these columns are immutable to the poster; before funding
-- there is nothing to exploit. `customer_id` is locked unconditionally: a poster
-- may never reassign job ownership.
--
-- Columns confirmed against information_schema; poster_completed_at is set only
-- by the create-payment edge function (service role, auth.uid() = NULL → passes
-- through), never client-side, so locking it here breaks no legit poster write.
-- Service-role writes (edge functions, crons) have auth.uid() = NULL and are
-- untouched; helper and admin sessions don't match the poster condition.

CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  changed_col text;
  -- Money / fee / payment / assignment columns a poster must never mutate on a
  -- FUNDED job. Enumerated (not derived) so a new column defaults to lockable
  -- only when added here — safer than an allow-list that fails open.
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
    -- NOTE: cancellation_fee / cancellation_fee_status are deliberately NOT
    -- locked — CancellationDialog writes them client-side for BOTH parties when
    -- a funded job is cancelled (mirrors the helper whitelist which permits
    -- them). Locking them here would break the poster's cancel flow.
  ];
BEGIN
  -- Only constrain the poster acting on their own job. Everyone else
  -- (service role: uid NULL; assigned helper; admin) passes through — their
  -- access is governed by RLS / the helper whitelist as before.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- Ownership is immutable to the poster, funded or not.
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  -- The money lock only applies once escrow exists.
  IF OLD.payment_status IS DISTINCT FROM 'unpaid' THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        RAISE EXCEPTION 'Posters may not modify jobs.% after escrow is funded', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poster_jobs_money_lock ON public.jobs;
CREATE TRIGGER trg_poster_jobs_money_lock
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_poster_jobs_money_lock();
