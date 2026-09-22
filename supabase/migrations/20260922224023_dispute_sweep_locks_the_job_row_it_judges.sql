-- The dispute sweep judged a jobs row it had not locked.
--
-- 20260922183808 shipped `sweep_disputes_closed_without_payment()` and it made
-- race-runner red (#1643) on `scripts/check-race-class.mjs`. The guard was
-- right. Its shape — read public.jobs unlocked, decide, write somewhere other
-- than jobs — is exactly what this function did, and it is the shape behind two
-- real money bugs (applications landing on a cancelled job; a payout cron
-- charging 25% on one).
--
-- The consequence here is smaller than those but it PERSISTS: release-payout
-- can settle a dispute between the SELECT and the INSERT, and because the
-- dedupe is on dispute id, that false page is never revisited.
--
-- CREATE OR REPLACE with `FOR SHARE OF j` added. FOR SHARE rather than FOR
-- UPDATE because this function never writes to jobs and must not block a
-- settlement for longer than the read; `OF j` so it locks the jobs row only.
--
-- A NOTE ON MY OWN PROCESS, since it is the reason this shipped red: I ran the
-- migration guards for grants, raise-codes, relation-grants and timestamps, and
-- did not run check-race-class.mjs, which is a nightly rather than part of that
-- set. Running the nightly's own guard locally before a migration that touches
-- public.jobs would have caught it in seconds.

CREATE OR REPLACE FUNCTION public.sweep_disputes_closed_without_payment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reported int   := 0;
  v_seen     jsonb := '[]'::jsonb;
  r          record;
BEGIN
  -- A from-scratch replay (PGlite, a fresh branch) may not have these yet.
  -- Nothing to look at is not a defect to report.
  IF to_regclass('public.disputes') IS NULL
     OR to_regclass('public.jobs') IS NULL
     OR to_regclass('public.error_logs') IS NULL THEN
    RETURN jsonb_build_object('reported', 0, 'skipped', 'tables not present');
  END IF;

  FOR r IN
    SELECT d.id                AS dispute_id,
           d.job_id            AS job_id,
           d.payout_split      AS payout_split,
           d.decided_at        AS decided_at,
           j.payment_status    AS payment_status,
           j.status            AS job_status,
           COALESCE(j.is_seed, false) AS is_seed
      FROM public.disputes d
      JOIN public.jobs j ON j.id = d.job_id
     WHERE d.execution_status = 'executed'
       -- Moved nothing, by any route, and said nothing about why.
       AND d.execution_transfer_id IS NULL
       AND d.execution_refund_id   IS NULL
       AND COALESCE(d.execution_helper_cents, 0) = 0
       AND COALESCE(d.execution_refund_cents, 0) = 0
       AND d.execution_error IS NULL
       -- The funds are still held. A job already refunded or paid out is
       -- settled by some other path and is not owed anything here.
       AND j.payment_status IN ('escrow', 'payout_pending')
       -- Never reported before. The dedupe.
       AND NOT EXISTS (
             SELECT 1
               FROM public.error_logs e
              WHERE e.tags ->> 'area' = 'dispute-unsettled'
                AND e.context ->> 'dispute_id' = d.id::text)
     ORDER BY d.decided_at NULLS LAST
       -- THE ROW LOCK, added 2026-09-22 after this function tripped
       -- scripts/check-race-class.mjs and made race-runner red (#1643).
       --
       -- The guard's shape is exact and this matched it: read public.jobs
       -- WITHOUT a lock, make a decision (the IF below), write somewhere other
       -- than jobs (error_logs). It exists because two money bugs came from
       -- that shape — applications landing on a cancelled job, and a payout
       -- cron charging 25% on one.
       --
       -- Here the damage is smaller but real, and it STICKS: release-payout
       -- can settle a dispute between this SELECT and the INSERT, and the row
       -- would be reported as unpaid forever — the dedupe is on dispute id, so
       -- a false page is never re-evaluated.
       --
       -- `OF j` locks only the jobs rows, not disputes. FOR SHARE, not FOR
       -- UPDATE: this function never writes to jobs and must never block a
       -- settlement any longer than reading it takes.
       FOR SHARE OF j
  LOOP
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      CASE WHEN r.is_seed THEN 'error' ELSE 'fatal' END,
      format('Dispute %s on job %s is marked executed but moved no money: no transfer, no refund, no cents, no error. The job has been %s since %s UTC and neither process-scheduled-payouts (excluded by disputed_at) nor claim_dispute_settlement (excluded by execution_status) will ever pay it. Split %s. Only a manual release-payout can settle it.',
             left(r.dispute_id::text, 8),
             left(r.job_id::text, 8),
             r.payment_status,
             to_char(r.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
             COALESCE(r.payout_split::text, 'unrecorded')),
      jsonb_build_object('source', CASE WHEN r.is_seed
                                        THEN 'dispute-unsettled-seed'
                                        ELSE 'dispute-unsettled' END,
                         'area', 'dispute-unsettled'),
      jsonb_build_object('dispute_id',     r.dispute_id,
                         'job_id',         r.job_id,
                         'payout_split',   r.payout_split,
                         'payment_status', r.payment_status,
                         'job_status',     r.job_status,
                         'decided_at',     r.decided_at,
                         'is_seed',        r.is_seed));

    v_reported := v_reported + 1;
    v_seen := v_seen || jsonb_build_object('dispute_id', r.dispute_id,
                                           'job_id',     r.job_id,
                                           'is_seed',    r.is_seed,
                                           'severity',   CASE WHEN r.is_seed
                                                              THEN 'error' ELSE 'fatal' END);
  END LOOP;

  RETURN jsonb_build_object('reported', v_reported, 'disputes', v_seen);
END;
$fn$;
