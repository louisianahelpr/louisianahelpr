-- Business verification gate on jobs.INSERT — server-side enforcement of
-- the same rule the client checks in useJobSubmit.runPreSubmitChecks and
-- BusinessContracts.submit. The client posts jobs via a direct
-- `supabase.from("jobs").insert(...)` call with no edge-function
-- intermediary, so a client-only check is bypassable — this policy IS the
-- real gate.
--
-- Rule: a job row may only be inserted when
--   1) the caller is the customer (unchanged from the prior policy), AND
--   2) EITHER business_id IS NULL (personal post — unchanged behaviour),
--      OR the caller is an active member of that business AND the
--      business has verification_status = 'verified'.
--
-- The business_members join pins the caller to the business they claim to
-- be posting under, so a hostile client can't attach an arbitrary verified
-- business_id to a personal post to piggyback on someone else's trust.
--
-- Dependencies (all earlier in timestamp order — safe for a from-scratch
-- replay):
--   * public.jobs.business_id ships in 20260425233224
--   * public.businesses.verification_status ships in 20260425235407
--     (CHECK IN ('none','pending','verified','rejected'), NOT NULL default 'none')
--   * public.business_members and its .status column ship in 20260425233224

DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;

CREATE POLICY "Customers can create jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (
    auth.uid() = customer_id
    AND (
      business_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.businesses b
        JOIN public.business_members bm ON bm.business_id = b.id
        WHERE b.id = jobs.business_id
          AND bm.user_id = auth.uid()
          AND bm.status = 'active'
          AND b.verification_status = 'verified'
      )
    )
  );
