-- SEC-001: server-side identity-verification gate on jobs.INSERT.
--
-- The client requires a verified Stripe Identity result before posting a job
-- (useJobSubmit.ts ~226: `if (idv_status !== 'verified') { open IDV dialog;
-- abort }`), to stop strangers onboarding helpers under a fake identity. But
-- the client posts jobs via a direct `supabase.from("jobs").insert(...)` with
-- no edge-function intermediary, so that check is bypassable: an unverified
-- user can POST a job straight through PostgREST and the existing INSERT
-- policy (20260708003657) only enforces `auth.uid() = customer_id` + business
-- verification — never the poster's own `idv_status`.
--
-- This mirrors the codebase's established pattern (the business gate in the
-- same policy is likewise "client toast = UX, RLS = the real gate", per the
-- comment at useJobSubmit.ts:258-262). We re-declare the whole policy rather
-- than layer a second one because Postgres ORs multiple permissive INSERT
-- policies — a separate policy would WEAKEN, not strengthen, the check.
--
-- The IDV predicate is unconditional (applies to personal AND business posts)
-- because the client runs the IDV gate before the business gate, for every
-- post. Service-role inserts (spawn-recurring-jobs cron, admin tooling) bypass
-- RLS entirely and are unaffected. `idx_profiles_user_id` (20260312230239)
-- keeps the EXISTS lookup indexed on this hot path.
--
-- Dependencies (all earlier in timestamp order — safe for a from-scratch
-- replay): profiles.idv_status ships in 20260311xxxxx; jobs.business_id in
-- 20260425233224; businesses.verification_status in 20260425235407;
-- business_members in 20260425233224.

DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;

CREATE POLICY "Customers can create jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (
    auth.uid() = customer_id
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.idv_status = 'verified'
    )
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
