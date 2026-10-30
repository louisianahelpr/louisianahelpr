-- Owner decision 2026-10-30, via the lead: the winner of the "GIVE AWAY!!" job
-- (11f8b084-ccd1-47b6-92ab-26338f701468, $60 in escrow) takes home exactly $50,
-- and whatever is left stays with Louisiana Helpr. A winner who still owes the
-- one-time $2 setup fee has it covered from that leftover and is marked paid.
--
-- Before: the row is stamped 5% + 70c, so the transfer is $56 ($54 for the 86 of
-- its 89 applicants who still owed the setup fee, measured on prod 2026-10-30).
--
-- Now: the job's flat stamp is 700 (5% + $7.00 on $60 is a $10.00 fee) and
-- platform_fee_amount is the matching 10.00, so every reader of the stamp (both
-- payout paths, money-reconciliation, the export, every take-home screen) reads
-- $50 with no change of its own. helper_fee_percent stays 5. The budget stays 60,
-- so what the poster paid and any refund do not move. The stamp also tells the
-- screens to take no setup fee off this job, and the payout paths to claim it the
-- normal way but out of the $10 (isGiveawayFixedPayJob, _shared/helprFlatFee.ts):
-- the transfer stays $50, onboarding_fee_paid turns true once, and the ledger row
-- books $8 commission + $2 setup fee. The row itself keeps the $10.
--
-- ONE JOB: CHECK jobs_giveaway_flat_stamp_is_one_job refuses 700 on any other
-- row, whoever writes it. The restamp matches only this job, still at its old
-- stamp, with no payout started, so a replay or a job already paid changes
-- nothing.
--
-- Not a definer, no new grant, no new column.

DO $$
BEGIN
  IF to_regclass('public.jobs') IS NULL
     OR to_regclass('public.payout_transfers') IS NULL THEN
    RETURN;
  END IF;

  SET LOCAL app.paid_job_fee_rewrite = 'owner decision 2026-10-30: giveaway winner takes home exactly $50, leftover stays with Louisiana Helpr';

  UPDATE public.jobs j
     SET helper_fee_flat_cents = 700,
         platform_fee_amount = 10.00
   WHERE j.id = '11f8b084-ccd1-47b6-92ab-26338f701468'
     AND j.helper_fee_flat_cents = 70
     AND j.helper_fee_percent = 5
     AND j.budget = 60
     AND COALESCE(j.urgent_fee, 0) = 0
     AND NOT COALESCE(j.is_group_job, false)
     AND j.payment_status IN ('escrow', 'payout_pending')
     AND NOT EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = j.id);

  SET LOCAL app.paid_job_fee_rewrite = '';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.jobs'::regclass
       AND conname = 'jobs_giveaway_flat_stamp_is_one_job'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_giveaway_flat_stamp_is_one_job
      CHECK (helper_fee_flat_cents IS DISTINCT FROM 700
             OR id = '11f8b084-ccd1-47b6-92ab-26338f701468');
  END IF;
END
$$;
