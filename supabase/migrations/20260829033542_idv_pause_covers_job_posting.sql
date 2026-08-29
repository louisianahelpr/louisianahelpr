-- The `idv_requirement_paused` kill switch did not actually reach posting.
--
-- The switch exists so that a Stripe Identity outage cannot freeze the whole
-- marketplace. It was honoured in two of the three places it needed to be:
-- the client (src/lib/featureFlags.ts -> useJobSubmit.ts) and the award gate
-- (helper_award_block_reason). It was NOT in the jobs INSERT policy.
--
-- So flipping it during an outage produced the worst possible outcome: the
-- client stopped blocking, the poster filled the whole form, PostgREST
-- refused the INSERT with 42501, and useJobSubmit surfaced the raw message —
-- "new row violates row-level security policy for table jobs" — on the app's
-- primary money action. A switch that turns a clear block into an unreadable
-- crash is worse than no switch.
--
-- Two pieces here:
--   1. A SECURITY DEFINER reader for the flag. platform_settings is
--      admin-read-only (see its RLS), so an inline sub-SELECT inside a policy
--      evaluated as the posting user reads zero rows and always answers
--      "not paused" — the switch would look wired and do nothing.
--   2. The policy itself, gaining the escape.
--
-- Both fail CLOSED, matching featureFlags.ts and helper_award_block_reason:
-- a missing settings row, a missing key, or a non-true value all leave the
-- identity requirement in force. Only an explicit `true` lifts it.

CREATE OR REPLACE FUNCTION public.idv_requirement_paused()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT (s.feature_flags ->> 'idv_requirement_paused')::boolean
       FROM public.platform_settings s
      LIMIT 1),
    false
  );
$$;

COMMENT ON FUNCTION public.idv_requirement_paused() IS
  'True only when an admin has explicitly paused the Stripe Identity requirement (platform_settings.feature_flags.idv_requirement_paused). Fails closed. SECURITY DEFINER because platform_settings is admin-read-only and this is read from RLS evaluated as an ordinary user.';

REVOKE ALL ON FUNCTION public.idv_requirement_paused() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.idv_requirement_paused() TO authenticated, service_role;

-- Rebuild the INSERT policy with the escape. Everything else about it is
-- carried over verbatim from the live definition (verified 2026-08-29 against
-- pg_policy): own row, verified identity, no business_id.
DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;

CREATE POLICY "Customers can create jobs"
ON public.jobs
FOR INSERT
TO public
WITH CHECK (
  (SELECT auth.uid()) = customer_id
  AND (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.idv_status = 'verified'
    )
    OR public.idv_requirement_paused()
  )
  AND business_id IS NULL
);

-- Flag hygiene on the live settings row.
--
-- `stripe_idv_required` is removed: it has ZERO references anywhere in the
-- repo (client, edge functions, SQL). A switch in Admin -> Settings' data that
-- controls nothing is a live trap — an operator flips it during an incident,
-- believes the gate is lifted, and it is not.
--
-- `idv_requirement_paused` is added explicitly as false so the key that DOES
-- control the gate is present and readable in the row, rather than existing
-- only implicitly the first time someone toggles it.
UPDATE public.platform_settings
SET feature_flags =
  (COALESCE(feature_flags, '{}'::jsonb) - 'stripe_idv_required')
  || jsonb_build_object(
       'idv_requirement_paused',
       COALESCE(feature_flags -> 'idv_requirement_paused', 'false'::jsonb)
     );
