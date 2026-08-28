-- get_safe_profiles: say WHICH key matched, and rank real user_id hits first.
--
-- The dual-key lookup added by
-- 20260817230000_get_safe_profiles_resolve_by_profile_id.sql stays. It is
-- load-bearing: public.messages.sender_id / receiver_id carry no foreign key,
-- prod really does store a profiles.id where an auth id belongs (that migration
-- cites the thread on job a5eed000-...-008 holding Marie Hebert's profile id),
-- and profiles RLS only admits auth.uid() = user_id — so this SECURITY DEFINER
-- function is the only lever the Messages inbox has. Drop the arm and those
-- threads regress to a nameless "User". Nothing here removes it.
--
-- The defect is narrower than the arm itself: the function matches on two key
-- spaces and then returns the row WITHOUT telling the caller which key hit. A
-- caller asking by user_id cannot tell a real user_id match from an unrelated
-- p.id match. Because `profiles.id` and `profiles.user_id` are separate uuid
-- spaces over the same table, one uuid can be person A's user_id and person B's
-- id simultaneously — and then the caller silently gets person B.
--
-- That is live on prod right now, not hypothetical:
--
--     get_safe_profiles(['6bdc1f67-ae1f-46a0-8edf-4035629a6147'])
--       -> { user_id: 11111111-...-104, full_name: 'Eli Thibodeaux' }
--
-- 6bdc1f67 is Audit Helper's auth id and ALSO Eli Thibodeaux's profiles.id. The
-- poster's applicant-vetting screen rendered Eli's identity and trust record for
-- the person who had actually applied — the screen where someone decides whether
-- to let a stranger into their home.
--
-- Two additive changes, no shape removed and no filter loosened:
--
--   (a) `matched_on` ('user_id' | 'profile_id') — the missing fact. A caller can
--       now assert it got the key it asked by instead of inferring it.
--   (b) ORDER BY user_id-matches-first — defence in depth for the callers that
--       do still read row [0]. When both a user_id row and a p.id row come back
--       for one input, the true user_id owner now sorts ahead of the collision.
--
-- (b) is a safety net, NOT the guarantee. The guarantee is the caller-side
-- re-match (useUserProfileData.ts), which is what actually closes the P0; a
-- caller must still verify rather than trust position.
--
-- Column list, filters and projection are otherwise IDENTICAL to
-- 20260827191647_helper_award_gate.sql. `matched_on` is APPENDED so existing
-- callers, which all read fields by name, are untouched.
DROP FUNCTION IF EXISTS public.get_safe_profiles(uuid[]);

CREATE FUNCTION public.get_safe_profiles(user_ids uuid[])
RETURNS TABLE(
  user_id uuid, full_name text, avatar_url text, bio text, location text,
  skills text, hourly_rate numeric, role text, subscription_tier text,
  portfolio_urls text[], created_at timestamptz,
  is_id_verified boolean, is_payout_ready boolean, profile_id uuid,
  is_licensed boolean, license_status text,
  is_insured boolean, insurance_status text,
  business_name text,
  matched_on text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id, p.full_name, p.avatar_url, p.bio, p.location,
    p.skills, p.hourly_rate,
    (
      SELECT CASE WHEN ur.role = 'admin'::app_role THEN 'admin' ELSE 'member' END
      FROM public.user_roles ur WHERE ur.user_id = p.user_id
      ORDER BY CASE ur.role WHEN 'admin'::app_role THEN 1 ELSE 2 END LIMIT 1
    ) AS role,
    p.subscription_tier, p.portfolio_urls, p.created_at,
    -- Stripe's verdict, not the unreviewed upload flag.
    p.stripe_identity_verified AS is_id_verified,
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
    CASE WHEN p.user_id = ANY(user_ids) THEN 'user_id' ELSE 'profile_id' END AS matched_on
  FROM public.profiles p
  WHERE (p.user_id = ANY(user_ids) OR p.id = ANY(user_ids))
    AND p.approval_status = 'approved'
    AND (p.ban_status IS NULL OR p.ban_status NOT IN ('temp_banned', 'permanently_banned'))
  ORDER BY CASE WHEN p.user_id = ANY(user_ids) THEN 0 ELSE 1 END;
$function$;

REVOKE ALL ON FUNCTION public.get_safe_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_profiles(uuid[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_safe_profiles(uuid[]) IS
  'Safe public projection of profiles, matching EITHER profiles.user_id OR '
  'profiles.id (the latter is required by Messages: messages.sender_id has no FK '
  'and prod stores profile ids there). Those are two key spaces over one table, '
  'so one uuid can be person A user_id and person B id at once. A returned row is '
  'therefore NOT guaranteed to answer the id you passed: read `matched_on` and '
  're-match on user_id / profile_id. Never take row [0] as the answer to a '
  'single-id lookup. Rows matched by user_id sort first as a safety net only.';
