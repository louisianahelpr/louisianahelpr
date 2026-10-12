-- Q1346 (owner decision 2026-10-12: KEEP the $2 first-post setup fee, and the
-- poster's Spent total and receipts must count it).
--
-- create-payment bills the one-time account setup fee as a line item on the
-- poster's first escrow checkout, but nothing on the job recorded it, so
-- src/lib/posterSpend.ts (Spent) and src/lib/posterJobCost.ts (the "what it
-- cost" record) under-counted that job by the fee.
--
-- jobs.onboarding_fee_amount (dollars, like customer_fee_amount): the setup
-- fee this job's checkout KEPT. It is stamped by stripe-webhook
-- (handlers/settleOnboardingFee.ts) only when this checkout WON the
-- "charged exactly once" claim on profiles.onboarding_fee_paid; a losing
-- checkout's $2 is refunded there and is never stamped. NULL = no setup fee
-- on this job (every job before this change, and every later job).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS onboarding_fee_amount numeric(10,2);

COMMENT ON COLUMN public.jobs.onboarding_fee_amount IS
  'Q1346: the one-time account setup fee (dollars) this job''s checkout charged and kept; stamped by stripe-webhook settleOnboardingFee when the checkout won the onboarding_fee_paid claim. NULL = none. Server-owned (trg_onboarding_fee_server_owned).';

-- Column-level SELECT for authenticated (20260915045110): a new jobs column is
-- unreadable until the grants are re-synced. Readable like customer_fee_amount
-- (the poster's Money tab and Home History read it).
DO $g$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END
$g$;

-- authenticated holds a TABLE-level INSERT/UPDATE grant on jobs, which covers
-- every new column (measured live 2026-10-12: relacl authenticated=awdxm), so
-- the column needs its own lock. Same shape as
-- enforce_chargeback_due_server_owned (20260924081103): a direct client write
-- is cleared on INSERT and refused on UPDATE; the service role, cron and
-- SECURITY DEFINER code pass. No admin exemption: nothing in the admin console
-- writes it.
CREATE OR REPLACE FUNCTION public.enforce_onboarding_fee_server_owned()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Not SECURITY DEFINER: current_user is the caller's role.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.onboarding_fee_amount := NULL;
    RETURN NEW;
  END IF;
  IF NEW.onboarding_fee_amount IS DISTINCT FROM OLD.onboarding_fee_amount THEN
    RAISE EXCEPTION 'jobs.onboarding_fee_amount is set by stripe-webhook, not by the client'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_onboarding_fee_server_owned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_onboarding_fee_server_owned ON public.jobs;
CREATE TRIGGER trg_onboarding_fee_server_owned
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_onboarding_fee_server_owned();

-- Backfill: the jobs whose checkout carried AND kept the fee before this
-- change. Measured 2026-10-12 against live Stripe (PaymentIntent amount and
-- metadata.onboarding_fee_charged = "true") and prod (the poster's
-- onboarding_fee_charged_at set, no duplicate_onboarding_fee refund rows):
--   4d7f3085… pi_3UNeY5Kp2H4b7tEC1zWV7bVT 1320c = 1000 job + 120 fee + 200 setup
--   1e16c281… pi_3UOciYKp2H4b7tEC0P1HGQxH 4120c = 3500 job + 420 fee + 200 setup
-- Both were later cancelled and refunded less the service fee (1200c, 3700c),
-- so the $2 came back; with the stamp, Spent reads what each poster kept.
-- Replay-safe: only rows still NULL; a missing row matches nothing.
UPDATE public.jobs
   SET onboarding_fee_amount = 2.00
 WHERE id IN ('4d7f3085-a572-48c4-8c5a-a29ddf0e38ea', '1e16c281-e9fc-4d9a-9380-1ecefdac8932')
   AND onboarding_fee_amount IS NULL;
