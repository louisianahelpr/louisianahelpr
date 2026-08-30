-- The identity-verification pause switch did not reach the one gate that
-- actually stops a job post.
--
-- WHAT WAS BROKEN. `feature_flags.idv_requirement_paused` is the operator kill
-- switch for a Stripe Identity outage — the one case where every Helpr on the
-- platform is blocked at the same moment and a native app cannot be hot-fixed
-- inside App Review. Two of the three enforcement points honour it: the client
-- (`src/lib/featureFlags.ts` → `useJobSubmit.ts`) and the helper award gate
-- (`helper_award_block_reason`, 20260827191647). The jobs INSERT policy
-- (20260710140000) does not.
--
-- So flipping the switch during an outage made things WORSE, not better: the
-- client stopped showing the IDV dialog and let the insert through, PostgREST
-- refused it with 42501, and `useJobSubmit.ts` toasts `error.message` raw — so
-- the poster read "new row violates row-level security policy for table jobs".
-- The escape hatch turned a clear, honest block into a database error message.
--
-- WHY A SECURITY DEFINER HELPER AND NOT A SUBQUERY. An RLS WITH CHECK runs as
-- the inserting user, and `platform_settings` is admin-read-only (policy
-- "Admins can read platform settings"). A `SELECT ... FROM platform_settings`
-- inlined in the policy therefore returns ZERO ROWS for every non-admin
-- poster — which COALESCEs to false and leaves the switch just as dead as it
-- is today, only less obviously. The read has to be done by a definer
-- function, exactly as the award gate already does it.
--
-- FAIL-CLOSED IS PRESERVED. A missing row, a missing key, a non-boolean value
-- and a NULL all resolve to false, which means identity verification stays
-- REQUIRED. The flag is phrased as "paused" rather than "required" precisely so
-- that absent/unreadable is the enforcing answer.
--
-- REPLAY-SAFETY: the helper is created before the policy that calls it, in the
-- same migration; `platform_settings` and `profiles.idv_status` both ship far
-- earlier; nothing here references an object defined by a later migration.
--
-- CORRECTED 2026-08-30: this migration originally re-added a
-- `business_id IS NULL OR EXISTS (... FROM public.businesses ...)` arm, carried
-- over from the pre-business-removal version of this same policy. But
-- 20260828011811 (timestamped BEFORE this migration, already live) dropped
-- `businesses`/`business_members` entirely and rewrote this exact policy to
-- `business_id IS NULL` with no EXISTS arm. This migration was authored
-- against a stale copy of the policy and would have reintroduced a dangling
-- reference to a dropped table — caught when `db-deploy` failed on
-- `relation "public.businesses" does not exist` before this file ever reached
-- prod. Fixed to carry forward the post-removal `business_id IS NULL` arm
-- instead of reverting it.

-- ── 1. The definer read ────────────────────────────────────────────────────
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
  'True only while an admin has explicitly paused the identity-verification requirement (platform_settings.feature_flags.idv_requirement_paused). SECURITY DEFINER because platform_settings is admin-read-only and this is read from an RLS policy that runs as an ordinary poster. Fails CLOSED: missing row, missing key, non-boolean and NULL all return false, i.e. verification stays required.';

REVOKE ALL ON FUNCTION public.idv_requirement_paused() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.idv_requirement_paused() TO authenticated, service_role;

-- ── 2. The gate that needed it ─────────────────────────────────────────────
-- Re-declared whole rather than layered, for the same reason 20260710140000
-- gave: Postgres ORs multiple permissive INSERT policies, so a second policy
-- would WEAKEN this check instead of amending it. The business-verification
-- and `auth.uid() = customer_id` arms are carried over unchanged.
DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;

CREATE POLICY "Customers can create jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (
    auth.uid() = customer_id
    AND (
      public.idv_requirement_paused()
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND p.idv_status = 'verified'
      )
    )
    AND business_id IS NULL
  );

-- ── 3. Flag hygiene ────────────────────────────────────────────────────────
-- The live blob carried `stripe_idv_required`, which has ZERO code references
-- repo-wide — a switch that reads like the identity gate, sits next to the one
-- that is, and does nothing. It is exactly the sort of thing someone flips
-- during an incident before discovering it was never wired. Dropped.
--
-- `idv_requirement_paused` is seeded to false so the key an operator reaches
-- for exists in the row rather than being conjured by the first toggle. It is
-- seeded FALSE, i.e. verification required, which is the current behaviour —
-- this migration changes no gate's answer today, only whether the switch works
-- when someone throws it.
UPDATE public.platform_settings
   SET feature_flags =
       (COALESCE(feature_flags, '{}'::jsonb) - 'stripe_idv_required')
       || jsonb_build_object(
            'idv_requirement_paused',
            COALESCE(feature_flags -> 'idv_requirement_paused', 'false'::jsonb)
          );
