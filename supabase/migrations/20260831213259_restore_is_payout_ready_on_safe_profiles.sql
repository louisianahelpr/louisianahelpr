-- Restore is_payout_ready to get_safe_profiles.
--
-- 20260831145430 rewrote this function to stop reporting 'admin' to anonymous
-- callers — a real and well-reasoned fix. Its own header states "the ONLY
-- behavioural change is the role expression", and that was the intent. But the
-- rewritten RETURNS TABLE omitted `is_payout_ready`, which 20260828030738 had
-- added and which a live client still reads:
--
--   src/components/activity/postedJobs/ApplicantsPanel.tsx:371
--     payoutReady={app.profiles?.is_payout_ready === true}
--
-- A dropped column does not error here — it arrives as `undefined`, the
-- `=== true` is false, and ApplicantVerificationChip silently reported EVERY
-- applicant as not-payout-ready. The comment above that chip says it exists so
-- the card does not offer a Hire the database will refuse; inverted, it does
-- the opposite of its stated job on every applicant.
--
-- This is a `CREATE OR REPLACE` of the 20260831145430 body with the column put
-- back, character-for-character otherwise: the privileged role expression, the
-- pinned search_path, the approved-and-not-banned WHERE, and the business-name
-- gate all carry over verbatim. Postgres cannot change a function's return
-- type in place, so the DROP is required and the grants are restated.
DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);

CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id uuid, full_name text, avatar_url text, bio text, location text,
  skills text, hourly_rate numeric, role text, subscription_tier text,
  portfolio_urls text[], created_at timestamptz,
  is_id_verified boolean, is_payout_ready boolean, profile_id uuid,
  is_licensed boolean, license_status text,
  is_insured boolean, insurance_status text,
  business_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE
               -- Only an admin caller may learn that someone else is an admin.
               WHEN ur.role = 'admin'::app_role
                    AND auth.uid() IS NOT NULL
                    AND has_role(auth.uid(), 'admin')
                 THEN 'admin'
               ELSE 'member'
             END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    p.subscription_tier, p.portfolio_urls, p.created_at,
    (p.idv_status = 'verified') AS is_id_verified,
    -- Restored. Same expression 20260828030738 shipped.
    (p.stripe_account_id IS NOT NULL AND p.stripe_payouts_enabled) AS is_payout_ready,
    p.id AS profile_id,
    p.is_licensed, p.license_status,
    p.is_insured, p.insurance_status,
    -- Never emit an unvetted business name. The badge is the trust signal
    -- and the name is part of it, so the two go public together or not at all.
    CASE
      WHEN (p.is_licensed AND p.license_status = 'verified')
        OR (p.is_insured AND p.insurance_status = 'verified')
      THEN p.business_name
    END AS business_name
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'));
$function$;

REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;
