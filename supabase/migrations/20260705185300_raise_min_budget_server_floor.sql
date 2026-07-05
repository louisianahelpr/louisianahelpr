-- Server-side enforcement of the $10 minimum job budget.
--
-- The client (usePostJobForm/useJobSubmit) already rejects a fixed-price job
-- under $10, but the DB trigger still only rejected < $5 — so a crafted API
-- call could post a $5–$9 job past the UI. This raises the server floor to $10
-- to match the displayed rule (task #103 shipped the client side; this closes
-- the API gap the Stripe-path audit flagged).
--
-- accept_bids jobs insert a NULL budget (helpers set their own price), so the
-- explicit IS NOT NULL guard preserves today's behavior for those rows —
-- NULL < 10 was already skipped by SQL three-valued logic; the guard just makes
-- the intent legible.
CREATE OR REPLACE FUNCTION public.validate_job_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.budget IS NOT NULL AND NEW.budget < 10 THEN
    RAISE EXCEPTION 'Minimum budget is $10';
  END IF;
  IF NEW.budget IS NOT NULL AND NEW.budget > 5000 THEN
    RAISE EXCEPTION 'Maximum budget is $5000';
  END IF;
  RETURN NEW;
END;
$function$;
