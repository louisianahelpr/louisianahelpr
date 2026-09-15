-- Priority Support moves down to Plus (owner, 2026-09-14, VN-44) — and the
-- queue that implements it had never heard of Plus.
--
-- WHAT WAS WRONG (verified live with pg_get_functiondef on 2026-09-15)
-- `admin_support_queue` resolves each reporter's effective tier with
--
--   WHEN lower(coalesce(p.subscription_tier, '')) IN ('basic', 'pro', 'elite')
--     THEN lower(p.subscription_tier)
--   ELSE 'free'
--
-- That list was written on 2026-09-01, four days before Plus was restored. So a
-- Plus reporter's `support_tier` came back 'free', and no value of
-- `p_priority_tiers` could ever match it. AdminSupport derives the entitled
-- list from TIER_PERKS.dedicatedSupport and now passes ['plus', 'elite'] — but
-- with this CASE unchanged, flipping the perk on in TypeScript would have sold
-- Plus "Priority Support" while the server sorted every Plus ticket as free.
-- The storefront advertising a perk the server does not grant is exactly the
-- defect VN-44 must not ship.
--
-- It also mislabelled Plus in the admin inbox as a non-paying reporter, since
-- the client re-maps `support_tier` through toSubscriptionTier.
--
-- WHAT CHANGES
--   1. 'plus' joins the tier normalisation, so the CASE admits every PAID rung
--      on the ladder (TIER_ORDER minus free). Still a literal — SQL cannot
--      import TypeScript — so src/test/perkEnforcementParity.test.ts reads THIS
--      function out of the newest migration that defines it and fails if the
--      list is not exactly the paid ladder.
--   2. The DEFAULT for p_priority_tiers becomes ARRAY['plus','elite'], the set
--      TIER_PERKS.dedicatedSupport now names. The client always passes the
--      list explicitly; the default only matters to a caller that omits it,
--      and it should not quietly mean the pre-VN-44 set. Pinned by the same
--      test.
--
-- Nothing else moves: the ordering rule, the 48h anti-starvation head start,
-- the expiry convention (a NULL expiry is ACTIVE; only a stamped past date
-- lapses), the admin predicate and the return shape are the live body,
-- verbatim.
--
-- REPLAY-SAFE: CREATE OR REPLACE on the identical signature and return type,
-- so it applies cleanly over the 20260901022258 definition and over itself.
-- Changing a parameter's DEFAULT expression is permitted by CREATE OR REPLACE
-- (only removing a default is not).
--
-- GRANTS: CREATE OR REPLACE keeps the existing ACL, but they are restated so
-- this file is correct on its own. Live proacl before this migration:
-- {postgres, authenticated, service_role} — no PUBLIC, no anon. Revoked by
-- role name (FROM PUBLIC, anon) per CLAUDE.md: FROM PUBLIC alone leaves an
-- explicit anon grant standing.

CREATE OR REPLACE FUNCTION public.admin_support_queue(
  p_status text DEFAULT 'pending'::text,
  p_priority_tiers text[] DEFAULT ARRAY['plus'::text, 'elite'::text],
  p_head_start_minutes integer DEFAULT 2880
)
RETURNS TABLE(
  id uuid,
  reporter_id uuid,
  reason text,
  description text,
  status text,
  created_at timestamp with time zone,
  reporter_name text,
  reporter_email text,
  support_tier text,
  priority_support boolean,
  priority_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH graded AS (
    SELECT
      r.id,
      r.reporter_id,
      r.reason,
      r.description,
      r.status,
      r.created_at,
      p.full_name AS reporter_name,
      p.email     AS reporter_email,
      -- Effective tier NOW, expiry folded in. Mirrors tierFeePercent().
      -- Every paid rung of the ladder; anything else (incl. a retired
      -- 'business') resolves to 'free'. Pinned to TIER_ORDER by
      -- src/test/perkEnforcementParity.test.ts.
      CASE
        WHEN p.subscription_expires_at IS NOT NULL
             AND p.subscription_expires_at < now() THEN 'free'
        WHEN lower(coalesce(p.subscription_tier, '')) IN ('basic', 'pro', 'plus', 'elite')
          THEN lower(p.subscription_tier)
        ELSE 'free'
      END AS support_tier
    FROM public.reports r
    LEFT JOIN public.profiles p ON p.user_id = r.reporter_id
    WHERE r.reported_type = 'support'
      -- Server-side authorization: non-admins get no rows, not an error.
      AND public.has_role(auth.uid(), 'admin')
      AND (
        p_status = 'all'
        OR (p_status = 'pending'  AND r.status =  'pending')
        OR (p_status = 'resolved' AND r.status <> 'pending')
      )
  )
  SELECT
    g.id,
    g.reporter_id,
    g.reason,
    g.description,
    g.status,
    g.created_at,
    g.reporter_name,
    g.reporter_email,
    g.support_tier,
    (g.support_tier = ANY (coalesce(p_priority_tiers, ARRAY[]::text[]))) AS priority_support,
    g.created_at
      - CASE
          WHEN g.support_tier = ANY (coalesce(p_priority_tiers, ARRAY[]::text[]))
            THEN make_interval(mins => greatest(coalesce(p_head_start_minutes, 0), 0))
          ELSE interval '0'
        END AS priority_at
  FROM graded g
  ORDER BY
    -- 1. Open work above closed history. Only bites on the 'all' filter.
    (g.status = 'pending') DESC,
    -- 2. The queue proper: oldest EFFECTIVE arrival first.
    CASE WHEN g.status = 'pending' THEN
      g.created_at
        - CASE
            WHEN g.support_tier = ANY (coalesce(p_priority_tiers, ARRAY[]::text[]))
              THEN make_interval(mins => greatest(coalesce(p_head_start_minutes, 0), 0))
            ELSE interval '0'
          END
    END ASC,
    -- 3. Closed history reads newest-first. NULL for every open row, so it is
    --    a no-op inside the open group.
    CASE WHEN g.status <> 'pending' THEN g.created_at END DESC,
    -- 4. Deterministic tiebreak so identical timestamps cannot shuffle between
    --    refetches (and cannot shuffle across a page boundary if this ever
    --    grows a .range()).
    g.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.admin_support_queue(text, text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_support_queue(text, text[], integer) TO authenticated;

COMMENT ON FUNCTION public.admin_support_queue(text, text[], integer) IS
  'Admin support inbox, ordered server-side so the "Priority Support" perk (Plus '
  'and Elite since VN-44) survives PostgREST''s 1000-row cap and any future '
  'pagination. Priority tickets sort as if they arrived p_head_start_minutes '
  'earlier, which bounds how long a free ticket can be overtaken. Entitled tiers '
  'are passed in from TIER_PERKS.dedicatedSupport; the tier normalisation admits '
  'every paid rung. Non-admins get zero rows.';
