-- Q1736: Spent missed the crew block fees taken from an uncaptured hold.
--
-- void-cancelled-payments' fee-capture branch (an uncaptured authorization on
-- a cancelled job) captures the cancellation fee PLUS every crew block fee
-- that is not void (Q1390, public.crew_block_fees), stamps only the
-- cancellation fee on jobs.cancellation_fee (Q1345), and writes no
-- payment_refunds row. posterSpend (src/lib/posterSpend.ts) counted that job
-- as jobs.cancellation_fee, so a crew poster's Spent left out the block fees
-- that left their card. The client cannot read crew_block_fees (RLS on, no
-- policies, no grant to authenticated), so this answers, to the poster only,
-- the cents of the block fees owed on each of THEIR OWN jobs: one row per job
-- that has any, the same sum the capture used (crewBlockFeeCents: every row
-- but a void one). No helper, no slot, no status. Nothing for anyone else, and
-- nothing with no JWT. Definer because the ledger has no client grant, the
-- same shape as crew_closed_spot_count (20261012070009).
--
-- The client treats PGRST202 (deployed before this migration) as no rows: the
-- old Spent figure, never an error.
--
-- Proof: src/test/pglite/posterCrewBlockFeeCents.pglite.mjs (applied 3x).
-- Guard: the Q1736 cases in src/lib/posterSpend.test.ts and
-- src/test/edge/void-cancelled-payments-crew.test.ts.
CREATE OR REPLACE FUNCTION public.poster_crew_block_fee_cents()
RETURNS TABLE (job_id uuid, fee_cents bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT b.job_id, sum(b.fee_cents)::bigint
    FROM public.crew_block_fees b
    JOIN public.jobs j ON j.id = b.job_id
   WHERE auth.uid() IS NOT NULL
     AND j.customer_id = auth.uid()
     AND b.status <> 'void'
   GROUP BY b.job_id
$fn$;

REVOKE ALL ON FUNCTION public.poster_crew_block_fee_cents() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_crew_block_fee_cents() TO authenticated, service_role;
