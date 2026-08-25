-- P0: trg_poster_jobs_money_lock (20260710130000, extended by the R3 hardening)
-- locks jobs.helper_id for the poster on any funded job — but the product funds
-- escrow at POSTING time, before applicants exist, so the sanctioned accept path
-- (accept_application / accept_group_application, SECURITY DEFINER but still
-- auth.uid() = poster) raised 42501 "Posters may not modify jobs.helper_id after
-- escrow is funded" on every hire. Verified live 2026-08-25: a funded open job
-- could not accept ANY applicant; hiring was broken platform-wide.
--
-- Fix: exempt exactly the INITIAL assignment — helper_id NULL → NOT NULL while
-- the job is still 'open'. Reassignment of an already-assigned funded job stays
-- blocked (both directions proven in a rolled-back transaction against prod:
-- initial accept succeeds, poster reassign still raises 42501).

CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  changed_col text;
  -- Never writable by the poster, funded or not (R3). Escrow state and the
  -- paid-placement columns are set by edge functions running as service_role
  -- (auth.uid() IS NULL), which returns early below.
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'is_urgent'
  ];
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

  -- ALWAYS-LOCKED set (R3) — checked before the funded gate.
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

  -- The money lock only applies once escrow exists.
  IF OLD.payment_status IS DISTINCT FROM 'unpaid' THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        -- The one sanctioned poster write to helper_id: hiring the FIRST
        -- helper on a still-open funded job (accept_application runs with the
        -- poster's uid). Escrow-at-post means every legitimate hire happens
        -- exactly here. NULL → NOT NULL only; a funded job that already has a
        -- helper can never be reassigned by the poster.
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% after escrow is funded', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;
