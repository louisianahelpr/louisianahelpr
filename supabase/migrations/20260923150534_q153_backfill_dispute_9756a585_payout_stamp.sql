-- Q153: record on SEED dispute 9756a585 the transfer that settled it.
--
-- Dispute 9756a585-f319-439f-9490-7a6e7c17d04c (job e6979a12, is_seed = true)
-- was auto-resolved to the helper on 2026-09-16 (execution_status 'executed')
-- and paid on 2026-09-23 by an admin release-payout: tr_3UCwOtKp2H4b7tEC1UMtZPxp,
-- 3520c, payout_transfers 95a1648f 'paid'. release-payout did not write the
-- dispute row then (fixed in the same commit: _shared/disputePayoutStamp.ts),
-- so execution_transfer_id / execution_helper_cents are NULL and the admin
-- DisputeCard reads "Settled: $0.00 to the Helpr".
--
-- This is the one row on prod in that state (measured 2026-09-23: 2 executed
-- disputes; the other, 28c4943d, is a refund with execution_refund_cents set).
-- It is pinned by id and only ever touches a TEST-owned record: the UPDATE
-- requires jobs.is_seed = true. The figures are read from payout_transfers, the
-- ledger the payout itself settled, never typed here.
--
-- Replay-safe and never-overwrite: guarded on the tables existing, on the row
-- still carrying NULL/NULL, and on exactly one paid ledger row for the job. On
-- a fresh replay (no such rows) it matches nothing.

DO $q153$
DECLARE
  n int;
BEGIN
  IF to_regclass('public.disputes') IS NULL
     OR to_regclass('public.payout_transfers') IS NULL
     OR to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.disputes d
     SET execution_transfer_id  = pt.stripe_transfer_id,
         execution_helper_cents = pt.amount_cents
    FROM public.payout_transfers pt
    JOIN public.jobs j ON j.id = pt.job_id
   WHERE d.id = '9756a585-f319-439f-9490-7a6e7c17d04c'::uuid
     AND pt.job_id = d.job_id
     AND j.is_seed = true
     AND d.status = 'decided'
     AND d.execution_status = 'executed'
     AND d.execution_transfer_id IS NULL
     AND d.execution_helper_cents IS NULL
     AND d.execution_refund_id IS NULL
     AND pt.status = 'paid'
     AND pt.stripe_transfer_id IS NOT NULL
     AND pt.amount_cents > 0
     AND (SELECT count(*) FROM public.payout_transfers p2
           WHERE p2.job_id = d.job_id AND p2.status = 'paid') = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'q153 backfill: % dispute row(s) stamped', n;
END
$q153$;
