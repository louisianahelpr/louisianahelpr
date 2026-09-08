-- A poster could never report a no-show. The chip is on the card, the confirm
-- dialog spells out the consequences ("a first report is a final warning, and a
-- second one from a different poster restricts their account for 7 days"), and
-- Confirm No-Show failed 100% of the time with
--
--   403 / 42501  "Posters may not modify jobs.helper_id once checkout has opened"
--
-- `report_helper_no_show` finishes by reopening the job:
--     UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = ...
-- and `enforce_poster_jobs_money_lock` lists `helper_id` in `locked_when_funded`.
-- Its one carve-out is the HIRING direction only —
--     OLD.helper_id IS NULL AND NEW.helper_id IS NOT NULL AND OLD.status = 'open'
-- so the un-assign that reopening requires hits the RAISE.
--
-- THE WIRE WAS MEANT TO BE CONNECTED AND WASN'T. The RPC's very first
-- statement is
--     PERFORM set_config('app.trusted_ladder_write', 'on', true);
-- whose own comment says "(Also releases the jobs field-lock for the
-- server-owned unassign below.)" — but this trigger never checked the flag, so
-- the release it was promising never happened. The contract is well
-- established elsewhere: eight functions SET that flag and four triggers
-- already HONOUR it, including `prevent_job_field_escalation`, which guards
-- this same table. This one was simply missed.
--
-- WHY NOT JUST WIDEN THE CARVE-OUT. Allowing helper_id -> NULL for any poster
-- on a funded job would let a poster drop a helper who has already travelled or
-- worked and hand the job to someone else, with the escrow still sitting there.
-- That is exactly what `locked_when_funded` exists to prevent, so the lock
-- stays shut for a direct PATCH. Only the RPC can open it, and only because the
-- RPC has already proved, under FOR UPDATE, that the caller is the poster, the
-- job is funded, the scheduled start has passed, and no no-show has been
-- reported on this job before.
--
-- The exception is deliberately narrow: the flag alone is not enough, the
-- column must be `helper_id` AND the new value must be NULL. Re-pointing
-- helper_id at a different person stays blocked even inside a trusted ladder
-- write, because no ladder path needs to do that.
--
-- Everything else in this function is byte-identical to the live definition,
-- including SECURITY DEFINER and search_path=public (checked against pg_proc
-- before writing this — a CREATE OR REPLACE that silently dropped either would
-- change who this guard runs as).

CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
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
