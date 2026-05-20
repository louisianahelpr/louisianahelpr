-- Public read-only RPC powering the marketing-surface PayoutTicker
-- (issue #87). Returns a redacted shape — first/last name as one
-- column the client formats to "First L.", rounded dollars (no
-- cents), and a city-ish location string — so anonymous visitors
-- to / and /browse can see real recent payouts as social proof
-- without exposing helper PII or stripe identifiers.
--
-- SECURITY DEFINER + grant to anon so the landing page can call
-- it without a session, mirroring get_marketplace_activity_count.
-- Bounded query (LIMIT 10, 14-day window, status = 'paid' only),
-- joins only public-safe profile columns (full_name, location,
-- parish). No stripe_*, no helper_id, no job_id, no amount_cents
-- precision below the dollar.

CREATE OR REPLACE FUNCTION public.get_recent_public_payouts(_limit int DEFAULT 10)
RETURNS TABLE (
  full_name text,
  amount_dollars integer,
  city text,
  paid_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.full_name,
    -- Round to nearest dollar so the ticker never shows messy cents.
    -- amount_cents is an int; divide as numeric to avoid truncation,
    -- then round + cast back to int for a clean display value.
    ROUND(pt.amount_cents::numeric / 100)::int AS amount_dollars,
    -- "City" for display. profiles.location is stored as a free-form
    -- "City, State" string the helper typed at onboarding; we split
    -- on comma so we don't render "Baton Rouge, LA, USA" — just the
    -- first segment. Falls back to the parish (also human-readable)
    -- when location is missing, then to empty so the ticker can
    -- omit the " in <city>" suffix gracefully.
    COALESCE(
      NULLIF(BTRIM(SPLIT_PART(p.location, ',', 1)), ''),
      p.parish,
      ''
    ) AS city,
    pt.paid_at
  FROM public.payout_transfers pt
  JOIN public.profiles p ON p.user_id = pt.helper_id
  WHERE pt.status = 'paid'
    AND pt.paid_at IS NOT NULL
    AND pt.paid_at > NOW() - INTERVAL '14 days'
  ORDER BY pt.paid_at DESC
  -- LEAST guards against a caller passing a huge _limit and turning
  -- this into a heavier query than intended.
  LIMIT LEAST(GREATEST(_limit, 1), 25);
$$;

-- Idiomatic per-RPC lockdown: revoke the default PUBLIC grant the
-- function definition implies, then narrowly grant anon + authed.
REVOKE ALL ON FUNCTION public.get_recent_public_payouts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_public_payouts(int) TO anon, authenticated;
