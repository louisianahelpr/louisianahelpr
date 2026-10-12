-- Q1498: the poster's card offered Applicants for a booked crew whose free
-- spot a block had closed.
--
-- A spot closed by a block with a fee (Q1390, public.crew_block_fees) is taken
-- on the server: crew_spots_open subtracts it, and accept_group_application
-- refuses the hire with roster_full. The client counted roster rows only
-- (src/pages/posts/postedJobCard/crewRefill.ts) because crew_block_fees is
-- server-only (RLS on, no policies, no grant to authenticated), so the poster
-- was offered a refill the server would refuse.
--
-- This answers ONE number, the closed-spot count, to the job's own poster and
-- to nobody else (0 for anyone else, and for a job that does not exist): no
-- fee, no helper, no slot. Definer because the ledger has no client grant.
-- The client treats PGRST202 (deployed before this migration) as 0, the old
-- behaviour.
--
-- Proof: src/test/pglite/crewClosedSpotCount.pglite.mjs (applied 3x).
-- Guard: the Q1498 cases in src/pages/posts/postedJobCard/crewRefill.test.ts.
CREATE OR REPLACE FUNCTION public.crew_closed_spot_count(p_job_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE((
    SELECT count(*)::int
      FROM public.crew_block_fees b
      JOIN public.jobs j ON j.id = b.job_id
     WHERE b.job_id = p_job_id
       AND auth.uid() IS NOT NULL
       AND j.customer_id = auth.uid()
  ), 0)
$fn$;

REVOKE ALL ON FUNCTION public.crew_closed_spot_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crew_closed_spot_count(uuid) TO authenticated, service_role;
