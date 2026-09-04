-- report_helper_no_show() reopens a funded job (status='open', helper_id=NULL)
-- as its final step, and sets app.trusted_ladder_write='on' before doing so —
-- the same escape hatch prevent_job_field_escalation() and
-- prevent_self_escalation() already honor. But enforce_poster_jobs_money_lock()
-- (trg_poster_jobs_money_lock, also BEFORE UPDATE on jobs) never learned
-- about that GUC: it only exempts a write when auth.uid() IS NULL or differs
-- from OLD.customer_id. A no-show report is called BY the poster (auth.uid()
-- = OLD.customer_id), so it falls straight past that check, hits
-- locked_when_funded's 'helper_id' entry (the only existing carve-out is
-- null -> non-null, not the reopen's non-null -> null), and raises
-- "Posters may not modify jobs.helper_id after escrow is funded" — aborting
-- the whole RPC. Since GUARD 1 in report_helper_no_show requires the job to
-- be FUNDED before a no-show can even be reported, this made the feature
-- fail unconditionally, on every call, for every job it could ever legally
-- apply to. Confirmed live: RAISE EXCEPTION 42501 reproduced by invoking the
-- RPC as the authenticated poster against a real escrowed job.
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

  IF OLD.payment_status IS DISTINCT FROM 'unpaid' THEN
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
        RAISE EXCEPTION 'Posters may not modify jobs.% after escrow is funded', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;
