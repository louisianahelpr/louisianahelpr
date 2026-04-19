-- 1. Restrict raw platform_settings reads to admins only (hides social_webhook_url + other internal config)
DROP POLICY IF EXISTS "Authenticated users can read platform settings" ON public.platform_settings;

CREATE POLICY "Admins can read platform settings"
ON public.platform_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Expose ONLY the public, non-sensitive fee/config fields via a SECURITY DEFINER function
--    (no webhook URLs, no updated_by, etc.)
CREATE OR REPLACE FUNCTION public.get_public_platform_settings()
RETURNS TABLE (
  id uuid,
  platform_fee_percent numeric,
  customer_fee_percent numeric,
  helper_fee_percent numeric,
  hybrid_idv_enabled boolean,
  idv_auto_approve_threshold numeric,
  onboarding_fee_cents integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    platform_fee_percent,
    customer_fee_percent,
    helper_fee_percent,
    hybrid_idv_enabled,
    idv_auto_approve_threshold,
    onboarding_fee_cents
  FROM public.platform_settings
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO authenticated, anon;