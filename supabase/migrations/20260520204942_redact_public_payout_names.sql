-- P0 PRIVACY FIX (security review of PR #290).
--
-- The previous version of `get_recent_public_payouts` returned a raw
-- `full_name` column alongside city + payout amount. The React client
-- redacted it to "First L." in `PayoutTicker.tsx` via `formatName()`,
-- but the redaction happened AFTER the bytes were on the wire. Any
-- anonymous caller hitting the REST endpoint directly (curl, fetch
-- from devtools, scraper) received up to 25 raw helper full names,
-- their cities, and their payout amounts per call — well outside the
-- "marketing social proof" envelope the RPC was designed for.
--
-- Fix: redact IN SQL. The function now returns `display_name text`
-- pre-formatted as "<first> <last_initial>." (e.g. "Maria S."), built
-- via SQL string ops over `profiles.full_name`. The client just
-- renders the value as-is. No code path of any caller — anon REST,
-- authed REST, edge function, dashboard query — can pull the raw
-- name through this RPC any more.
--
-- The shape of every OTHER column (amount_dollars, city, paid_at),
-- the join (`pt.helper_id = p.user_id`), the filter (status='paid',
-- 14-day window), the LIMIT bounds, the SECURITY DEFINER posture,
-- and the anon+authenticated grants are unchanged from the prior
-- migration — this is purely a name-redaction swap. CREATE OR REPLACE
-- preserves the existing function identity (same signature) so the
-- grants from 20260520175350_get_recent_public_payouts.sql carry
-- through and the RPC remains callable across the deploy.

CREATE OR REPLACE FUNCTION public.get_recent_public_payouts(_limit int DEFAULT 10)
RETURNS TABLE (
  display_name text,
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
    -- "First L." redaction performed in SQL so the raw full_name never
    -- leaves Postgres. Behaviour:
    --   - NULL or whitespace-only → 'Helpr' (neutral generic; matches
    --     the client's pre-fix `formatName(..., "Someone")` intent but
    --     avoids leaking that we have a row with no name).
    --   - Single word ("Madonna") → just that word.
    --   - Two-plus words → first word + space + uppercased first
    --     letter of the second word + period ("Maria Sanchez" → "Maria S.").
    -- We deliberately ignore words 3+ (middle name / suffix); the
    -- prior client formatter did the same so this preserves display
    -- parity for existing users.
    CASE
      WHEN btrim(coalesce(p.full_name, '')) = '' THEN 'Helpr'
      WHEN position(' ' IN btrim(p.full_name)) = 0 THEN btrim(p.full_name)
      ELSE
        split_part(btrim(p.full_name), ' ', 1)
        || ' '
        || upper(left(split_part(btrim(p.full_name), ' ', 2), 1))
        || '.'
    END AS display_name,

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

-- Re-assert the lockdown after CREATE OR REPLACE. Postgres preserves
-- existing grants across REPLACE, but we restate them so a from-scratch
-- migration replay arrives at the same grant state regardless of the
-- prior migration's exact wording.
REVOKE ALL ON FUNCTION public.get_recent_public_payouts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_public_payouts(int) TO anon, authenticated;
