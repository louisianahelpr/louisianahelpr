-- "Priority Support" was printed on the $20 Elite card and had no
-- implementation anywhere: a repo grep of `contact-support` and `AdminSupport`
-- found zero tier / priority references (the only "sla" hits were the
-- substring inside "Slack"). People were being charged for a perk that did not
-- exist. The owner picked QUEUE ORDERING in the admin inbox as the
-- implementation — explicitly NOT a stated response-time SLA, because a missed
-- SLA is worse than no SLA. Nothing here, and nothing in the app, promises a
-- response time.
--
-- WHY AN RPC AND NOT A CLIENT-SIDE SORT
-- AdminSupport read `reports` with no `.limit()`, so a client sort looks safe.
-- It is not: this project's PostgREST enforces db-max-rows = 1000 (measured on
-- prod 2026-09-01 — `notifications` holds 1619 rows and a bare select returns
-- `content-range: 0-999/1619`). An unbounded select is therefore a SILENT
-- `LIMIT 1000` applied AFTER `ORDER BY created_at DESC`, i.e. the newest 1000.
-- A client sort would have ordered only that window, and the rows it discarded
-- are the OLDEST tickets — exactly the ones the anti-starvation rule below
-- exists to rescue. Ordering server-side means the cap truncates the BOTTOM of
-- the priority queue, which is the only correct place to lose rows, and it
-- keeps working if this list ever grows a `.range()`.
--
-- The tier also cannot be sorted on from the client without the join: it lives
-- on `profiles`, `reports.reporter_id` has no FK to it (so no PostgREST
-- embed), and AdminSupport hydrated names in a SECOND round trip. This
-- function collapses both into one read.
--
-- THE ORDERING RULE — an effective-arrival timestamp, not tier buckets.
-- A priority ticket is sorted as if it had arrived `p_head_start_minutes`
-- earlier than it did:
--
--   priority_at = created_at - (head start if the reporter is entitled)
--   ORDER BY open-first, then priority_at ASC (oldest effective arrival first)
--
-- Sorting purely by tier starves free users forever, which is a support
-- failure and eventually a trust problem. A head start bounds that exactly:
-- a free ticket older than the head start automatically outranks a fresh Elite
-- one, so no ticket can ever be delayed by more than the head-start window no
-- matter how many Elite tickets arrive. One key, no buckets, no cliff.
-- Within a tier the key degenerates to plain FIFO (oldest first), which is
-- also a deliberate change: the queue used to be newest-first, under which the
-- longest-waiting person was hardest to find.
--
-- Closed tickets stay newest-first — that list is history, not work.
--
-- WHY THE ENTITLED TIERS ARE A PARAMETER
-- `TIER_PERKS.dedicatedSupport` (src/lib/subscriptionTiers.ts) is the single
-- source of truth for who gets this perk, and SQL cannot import it. Rather
-- than hardcode 'elite' here and let the two drift the next time the perk
-- moves, the caller passes the tiers it derived from `dedicatedSupport`. This
-- function knows the ORDERING; it deliberately knows nothing about tiers.
--
-- EXPIRY
-- An expired paid tier must not keep priority. The CASE below mirrors
-- `tierFeePercent` / `resolveEarlyAccessTier` exactly, including the
-- convention that a NULL `subscription_expires_at` means ACTIVE (the
-- expire-subscriptions cron nulls the TIER on lapse, so only a stamped PAST
-- date means expired). Anything off the live ladder — including a legacy
-- 'business', retired 2026-09-01 — resolves to 'free', the safe direction: an
-- unrecognised tier LOSES a perk rather than being handed one.
--
-- AUTHORIZATION
-- SECURITY DEFINER with an inline `has_role(auth.uid(),'admin')` predicate, so
-- a non-admin gets ZERO ROWS rather than a permission error — identical to
-- get_payout_batch_job_ids / get_payout_batches. The definer rights are what
-- let the reports↔profiles join run without depending on the exact shape of
-- the profiles SELECT policies.

-- Replay-safe: a later signature change needs the drop, and CREATE OR REPLACE
-- cannot change a function's return type on its own.
DROP FUNCTION IF EXISTS public.admin_support_queue(text, text[], integer);

CREATE OR REPLACE FUNCTION public.admin_support_queue(
  p_status text DEFAULT 'pending',
  p_priority_tiers text[] DEFAULT ARRAY['elite']::text[],
  p_head_start_minutes integer DEFAULT 2880  -- 48h; see the anti-starvation note above
)
RETURNS TABLE(
  id uuid,
  reporter_id uuid,
  reason text,
  description text,
  status text,
  created_at timestamptz,
  reporter_name text,
  reporter_email text,
  support_tier text,
  priority_support boolean,
  priority_at timestamptz
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
      CASE
        WHEN p.subscription_expires_at IS NOT NULL
             AND p.subscription_expires_at < now() THEN 'free'
        WHEN lower(coalesce(p.subscription_tier, '')) IN ('basic', 'pro', 'elite')
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

REVOKE ALL ON FUNCTION public.admin_support_queue(text, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_support_queue(text, text[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_support_queue(text, text[], integer) TO authenticated;

COMMENT ON FUNCTION public.admin_support_queue(text, text[], integer) IS
  'Admin support inbox, ordered server-side so the Elite "Priority Support" perk '
  'survives PostgREST''s 1000-row cap and any future pagination. Priority tickets '
  'sort as if they arrived p_head_start_minutes earlier, which bounds how long a '
  'free ticket can be overtaken. Entitled tiers are passed in from '
  'TIER_PERKS.dedicatedSupport so SQL holds no tier knowledge. Non-admins get zero rows.';
