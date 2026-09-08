-- Identity verification is unconditionally required. There is no pause.
--
-- The `idv_requirement_paused` operator kill switch existed so a Stripe
-- Identity outage could not freeze the marketplace inside App Review. Owner
-- decision 2026-09-07: delete it entirely — identity verification will always
-- be required, and a switch that can turn a safety gate off is a bigger
-- liability than an outage that turns the marketplace off.
--
-- Three consumers existed server-side and all three are removed here:
--   1. the jobs INSERT policy "Customers can create jobs" — the
--      `idv_requirement_paused() OR …` disjunct (20260829033542).
--   2. idv_requirement_paused() itself, dropped once nothing references it.
--   3. helper_award_block_reason(uuid) — the `COALESCE(v_paused,false) IS NOT
--      TRUE` carve-out on the identity branch (20260907013734).
-- The function is rewritten LAST on purpose: identityVerdictParity.test.ts
-- reads a definition as "from CREATE FUNCTION to the end of the file", so a
-- trailing DROP naming the old flag would read as part of the new body.
-- The stored flag key is deleted from platform_settings.feature_flags so a
-- stale `true` cannot outlive the readers.
--
-- Replay-safe: every statement is CREATE OR REPLACE / DROP IF EXISTS /
-- idempotent UPDATE, and the policy is dropped before it is created.

-- ── 1. Job posting. Same policy, minus the pause disjunct. ───────────────────
DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;

-- Carried over verbatim from the live definition (pg_policies, 2026-09-07)
-- minus the `idv_requirement_paused() OR` disjunct: same roles (public), same
-- ownership, blocked-user and business_id clauses unchanged.
CREATE POLICY "Customers can create jobs" ON public.jobs
  FOR INSERT
  WITH CHECK (
    auth.uid() = customer_id
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.idv_status = 'verified'::text
    )
    AND business_id IS NULL
    AND (offered_to_helper_id IS NULL OR NOT are_users_blocked(customer_id, offered_to_helper_id))
  );

-- ── 2. The switch itself, now unreferenced. ──────────────────────────────────
DROP FUNCTION IF EXISTS public.idv_requirement_paused();

-- ── 3. The stored value, so a stale `true` cannot outlive its readers. ───────
UPDATE public.platform_settings
   SET feature_flags = (feature_flags::jsonb - 'idv_requirement_paused')
 WHERE feature_flags IS NOT NULL
   AND feature_flags::jsonb ? 'idv_requirement_paused';

-- ── 4. The hiring gate. Same function, minus the carve-out. ──────────────────
CREATE OR REPLACE FUNCTION public.helper_award_block_reason(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_acct     text;
  v_payouts  boolean;
  v_identity boolean;
  v_idv      text;
  v_seed     boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'helper_unknown';
  END IF;

  SELECT p.stripe_account_id, p.stripe_payouts_enabled, p.stripe_identity_verified,
         p.idv_status, p.is_seed
    INTO v_acct, v_payouts, v_identity, v_idv, v_seed
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'helper_unknown';
  END IF;

  -- Fixture data stays usable — but ONLY while it is actually fixture-shaped.
  -- A profile holding a real Connect account is judged on Stripe's answer no
  -- matter what its seed flag says.
  IF v_seed IS TRUE AND v_acct IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_acct IS NULL OR v_payouts IS NOT TRUE THEN
    RETURN 'helper_payout_setup_incomplete';
  END IF;

  -- EITHER verdict clears this. idv_status is the check a user can actually
  -- complete, and it is the stronger of the two; stripe_identity_verified is
  -- kept because one real profile carries it WITHOUT idv_status='verified'.
  -- There is no third way through: identity verification is always required.
  IF v_identity IS NOT TRUE AND v_idv IS DISTINCT FROM 'verified' THEN
    RETURN 'helper_identity_unverified';
  END IF;

  RETURN NULL;
END;
$function$;

-- Grants restated so this file is self-describing; byte-identical to the
-- privileges the function already held ({authenticated, service_role}).
-- FROM PUBLIC alone does NOT revoke anon — name the role (see CLAUDE.md).
REVOKE ALL ON FUNCTION public.helper_award_block_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.helper_award_block_reason(uuid) TO authenticated, service_role;
