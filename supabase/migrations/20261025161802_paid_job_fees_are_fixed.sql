-- Once a job has been paid for, its fee fields are not rewritten by SQL
-- unless a migration says so on purpose.
--
-- What happened: migration 20261021142508_legacy_jobs_take_the_flat_helpr_fee
-- restamped funded, not-yet-paid-out legacy jobs from the 12% Helpr fee to
-- 5% + $0.70 (owner decision 2026-10-21, kept: lead 2026-10-25). Jobs 11f8b084
-- and 9c6ff2de share updated_at 2026-10-21 18:27:42 and now read
-- helper_fee_percent 5 / helper_fee_flat_cents 70 while their Stripe metadata
-- says 12% / 12%. Nothing stopped a bulk UPDATE from changing what a paid job's
-- fees are, and nothing recorded that it was on purpose.
--
-- The rule (trigger zzzzzzz_jobs_paid_fee_fields_fixed, BEFORE UPDATE of any
-- column; named to sort after every other BEFORE trigger on jobs, which
-- Postgres fires in name order, so a fee another BEFORE trigger changed is
-- seen too):
--   * a job is PAID when OLD.payment_status is one of escrow, payout_pending,
--     released, refunded, chargeback, cancelling, cancelled (anything but
--     NULL / unpaid / abandoned / failed, the states a new checkout may
--     re-price);
--   * on a paid job, a change to helper_fee_percent, helper_fee_flat_cents,
--     platform_fee_amount, platform_fee_percent, customer_fee_amount or
--     poster_fee_flat_cents is REFUSED (42501, paid_job_fee_fixed);
--   * except from the edge functions (auth.role() = 'service_role'): those
--     are the money paths that record the fee actually taken at release and
--     at a dispute settlement (release-payout, create-payment dispute release,
--     execute-dispute-split), each of which reads the same stamp;
--   * and except a statement run with
--       SET LOCAL app.paid_job_fee_rewrite = '<the owner decision, dated>';
--     a migration that is MEANT to restamp paid jobs (like 20261021142508)
--     sets it, so the intent sits in the migration next to the UPDATE.
-- Signed-in members (anon / authenticated) never change fee fields on a paid
-- job, even through a SECURITY DEFINER function they call.
--
-- 20261021142508 is already applied on prod; a fresh database replays it
-- before this trigger exists, so it needs no opt-in.
--
-- REPLAY-SAFETY: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS, guarded
-- on public.jobs. Revoked from PUBLIC, anon, authenticated (a trigger function
-- is never called directly).

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.enforce_paid_job_fee_fields_fixed()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $fn$
  BEGIN
    IF coalesce(OLD.payment_status, 'unpaid') IN ('unpaid', 'abandoned', 'failed') THEN
      RETURN NEW;
    END IF;
    IF NEW.helper_fee_percent IS NOT DISTINCT FROM OLD.helper_fee_percent
       AND NEW.helper_fee_flat_cents IS NOT DISTINCT FROM OLD.helper_fee_flat_cents
       AND NEW.platform_fee_amount IS NOT DISTINCT FROM OLD.platform_fee_amount
       AND NEW.platform_fee_percent IS NOT DISTINCT FROM OLD.platform_fee_percent
       AND NEW.customer_fee_amount IS NOT DISTINCT FROM OLD.customer_fee_amount
       AND NEW.poster_fee_flat_cents IS NOT DISTINCT FROM OLD.poster_fee_flat_cents THEN
      RETURN NEW;
    END IF;
    -- The JWT claim AND the session role (lh-authz-rls review 2026-10-25 #1):
    -- a claim alone is not proof the caller is the service role.
    IF coalesce(auth.role(), '') = 'service_role'
       AND coalesce(current_setting('role', true), 'none') = 'service_role' THEN
      RETURN NEW;
    END IF;
    IF coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
       AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
       AND length(btrim(coalesce(current_setting('app.paid_job_fee_rewrite', true), ''))) > 0 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'paid_job_fee_fixed: job % is paid (payment_status %), so its fee fields cannot be changed here', OLD.id, OLD.payment_status
      USING ERRCODE = '42501',
            HINT = 'A migration that is meant to restamp paid jobs runs SET LOCAL app.paid_job_fee_rewrite = ''<owner decision, dated>'' first.';
  END;
  $fn$;

  REVOKE ALL ON FUNCTION public.enforce_paid_job_fee_fields_fixed() FROM PUBLIC, anon, authenticated;

  -- An earlier draft's name, so a database that applied it never runs two copies.
  DROP TRIGGER IF EXISTS jobs_paid_fee_fields_fixed ON public.jobs;
  DROP TRIGGER IF EXISTS zzzzzzz_jobs_paid_fee_fields_fixed ON public.jobs;
  CREATE TRIGGER zzzzzzz_jobs_paid_fee_fields_fixed
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_paid_job_fee_fields_fixed();
END
$$;
