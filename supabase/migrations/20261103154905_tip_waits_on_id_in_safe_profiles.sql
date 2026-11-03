-- get_safe_profiles gains ONE field, tip_waits_on_id = payout_waits_on_identity(user_id) (NULL for anon), so the
-- client's tip surfaces (useHelprTakesTips / useTipWaitsOnId) ask the server's tip gate instead of recomputing it.
-- Everything else is restated verbatim from prod (pg_get_functiondef md5 2feb846b34d38fd5df7af120bb0a1140, read
-- 2026-11-03), which matches 20261021131322_member_names_first_and_initial.sql. The return type changes, so the
-- function is dropped and re-created in this one transaction; nothing in pg_depend references it (read 2026-11-03).
-- Grants are restated exactly as prod's proacl: anon, authenticated, service_role (postgres owner).
DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);
CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, bio text, location text, skills text, hourly_rate numeric, role text, subscription_tier text, portfolio_urls text[], created_at timestamp with time zone, is_id_verified boolean, is_payout_ready boolean, profile_id uuid, is_licensed boolean, license_status text, is_insured boolean, insurance_status text, business_name text, tip_waits_on_id boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, public.display_name_for_viewer(p.full_name, p.user_id) AS full_name, p.avatar_url, p.bio, p.location,
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
    -- The tier as it stands TODAY, not as the column last remembers it.
    -- This is the only route by which one member learns another's tier, and
    -- it drives Priority Placement's ranking bump plus the Pro/Elite chip and
    -- halo on the applicant card. `expire-subscriptions` nulls the column on
    -- a cron, so the raw value keeps paying out after the plan ended.
    CASE
      WHEN p.subscription_expires_at IS NOT NULL
           AND p.subscription_expires_at <= now() THEN NULL
      ELSE p.subscription_tier
    END AS subscription_tier,
    p.portfolio_urls, p.created_at,
    -- The "ID verified" BADGE (owner 2026-10-21): Stripe Identity's photo ID +
    -- selfie verdict only. Payout setup (Connect) is its own fact, is_payout_ready
    -- below, and never draws this badge. A badge, not a gate.
    (p.idv_status IS NOT DISTINCT FROM 'verified') AS is_id_verified,
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
    END AS business_name,
    -- THE TIP'S ID WAIT, the SERVER's answer (Blockers 10, lead 2026-11-03): payout_waits_on_identity is what
    -- create-payment's tip gate (checkIdentityHold), auto-tip-charge and declutter-checkout decide on, including
    -- identity_check_exempt (switch off for the payee, or an enrolled is_seed fixture). The client used to recompute it
    -- from is_id_verified and the VIEWER's switch, and hid a tip the server takes (helper-e2e, journeys J5).
    -- NULL for an anon caller: nobody signed out can tip, and it would say whom the switch exempts.
    CASE WHEN auth.uid() IS NULL THEN NULL ELSE public.payout_waits_on_identity(p.user_id) END AS tip_waits_on_id
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.email_verified
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
    AND p.anonymized_at IS NULL
    -- Q552: a test account's profile is hidden once the launch switch is on
    -- (your own row never is).
    AND (p.is_seed IS NOT TRUE OR p.user_id = auth.uid() OR NOT (SELECT public.seed_hidden_from_caller()));
$function$;
REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;
