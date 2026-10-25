-- Owner 2026-10-25: "the jobs that were refunded. [Detail Kia Telluride], trim
-- trees, whatever the others were, move them to my done so it shows that it
-- was still done" and, asked which and how: "those 3 but dont say they were
-- done outside the app. just have them in my done section", no name shown.
--
-- jobs.poster_marked_done_at: the moment a cancelled job was filed under the
-- poster's Done list instead of Cancelled. Display only. It changes no status,
-- no money and no notification: the job stays status 'cancelled' with its
-- refund, so every money path, trigger, ledger and count that reads status is
-- untouched. The posted-jobs list (postedActivityBucket / bucketPostedJob)
-- files it under Done and its line reads "Done" (POSTER_WAIT.done_marked).
-- NULL = not filed (every job but the three below).
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS poster_marked_done_at timestamptz;

COMMENT ON COLUMN public.jobs.poster_marked_done_at IS
  'Owner 2026-10-25: a cancelled job filed under the poster''s Done list (display only; status, money and notifications unchanged). Server-owned (trg_poster_marked_done_server_owned). NULL = not filed.';

-- Column-level SELECT for authenticated (20260915045110): a new jobs column is
-- unreadable until the grants are re-synced. The poster's own list reads it.
DO $g$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END
$g$;

-- authenticated holds a table-level INSERT/UPDATE grant on jobs that covers a
-- new column, so it needs its own lock (same shape as
-- enforce_onboarding_fee_server_owned, 20261012171259): a client write is
-- cleared on INSERT and refused on UPDATE; service role, migrations and
-- SECURITY DEFINER code pass. Nothing in the app writes it today.
CREATE OR REPLACE FUNCTION public.enforce_poster_marked_done_server_owned()
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
    NEW.poster_marked_done_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.poster_marked_done_at IS DISTINCT FROM OLD.poster_marked_done_at THEN
    RAISE EXCEPTION 'jobs.poster_marked_done_at is set by support, not by the client'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_poster_marked_done_server_owned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_poster_marked_done_server_owned ON public.jobs;
CREATE TRIGGER trg_poster_marked_done_server_owned
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poster_marked_done_server_owned();

-- The owner's three (measured 2026-10-25 on prod: posted by the owner's
-- account 7f65ef12…, status cancelled, payment_status refunded, no Helpr):
--   375000de… Trim tree branches       (refunded 2026-10-24 17:10Z)
--   1251173a… Detail Kia Telluride     (refunded 2026-10-24 18:10Z)
--   9c321fed… Clean a 2-bedroom house  (refunded 2026-10-25 19:10Z)
-- Replay-safe: only those rows, only while still cancelled and unfiled.
-- Guarded: a refusal from any jobs trigger must not fail db-deploy (and block
-- every later migration overnight); it leaves the rows unfiled with a WARNING,
-- and the lead re-checks poster_marked_done_at on prod after the deploy.
DO $f$
BEGIN
  UPDATE public.jobs
     SET poster_marked_done_at = now()
   WHERE id IN ('375000de-81ae-48fd-810c-362d33e60f3b',
                '1251173a-e30c-498c-891f-cf5c2d705bdf',
                '9c321fed-f09c-402c-b5dd-3c9e798e3244')
     AND customer_id = '7f65ef12-1d3d-439b-b0a7-f42ce8bc176d'
     AND status = 'cancelled'
     AND poster_marked_done_at IS NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'poster_marked_done backfill skipped: %', SQLERRM;
END
$f$;
