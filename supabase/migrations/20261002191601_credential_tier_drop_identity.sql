-- Owner, 2026-10-01 (Q906): "Drop id from tiers bc stripe id collects and
-- verified". Stripe Connect onboarding already collects and verifies identity
-- before a Helpr can be paid, so a separate identity rung is redundant.
-- get_user_credential_tier now returns 3 (licensed + insured), 2 (licensed)
-- or 0. It never returns 1. No job has ever required tier 1 (all 146 jobs were
-- tier 0 on 2026-10-01), and Post a Job offers only 0, 2 and 3, so no
-- gated job changes who can see or apply to it.
-- Signature, volatility, SECURITY DEFINER and settings are unchanged.
CREATE OR REPLACE FUNCTION public.get_user_credential_tier(p_user_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
  WITH src AS (
    SELECT
      -- Admin-reviewed via review_credential(); pinned by prevent_self_escalation().
      -- A NULL expiry earns nothing here.
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND p.license_status = 'verified'
          AND p.license_expires_at IS NOT NULL
          AND p.license_expires_at > current_date
      ) AS prof_licensed,
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.user_id = p_user_id
          AND p.insurance_status = 'verified'
          AND p.insurance_expires_at IS NOT NULL
          AND p.insurance_expires_at > current_date
      ) AS prof_insured,
      -- Vendor-verified via sync_credential_from_check().
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type = 'trade_license'
          AND hc.status = 'verified'
          AND (hc.expiration_date IS NULL OR hc.expiration_date > now())
      ) AS cred_licensed,
      EXISTS (
        SELECT 1 FROM helper_credentials hc
        WHERE hc.user_id = p_user_id
          AND hc.credential_type = 'insurance'
          AND hc.status = 'verified'
          AND (hc.expiration_date IS NULL OR hc.expiration_date > now())
      ) AS cred_insured
  )
  SELECT CASE
    WHEN (prof_licensed OR cred_licensed) AND (prof_insured OR cred_insured) THEN 3
    WHEN (prof_licensed OR cred_licensed)                                    THEN 2
    ELSE 0
  END
  FROM src;
$function$;

REVOKE ALL ON FUNCTION public.get_user_credential_tier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_credential_tier(uuid) TO authenticated, service_role;

-- With no identity rung, a job requiring tier 1 would quietly mean "licensed"
-- while its UI said "Get Verified". Only 0, 2 and 3 remain valid. Zero jobs
-- carried 1 on 2026-10-01; any that somehow do are opened to everyone (0), the
-- level the poster's form would have shown them, before the check is added.
UPDATE public.jobs SET credential_tier = 0 WHERE credential_tier = 1;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_credential_tier_check;
ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_credential_tier_check CHECK (credential_tier IN (0, 2, 3));
