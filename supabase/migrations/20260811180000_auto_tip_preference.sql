-- Auto-tip: a poster's standing preference to tip after a job completes.
--
-- Modelled on Lyft's default-tip setting rather than Uber Eats': Helpr already
-- charges the job in full at checkout (immediate capture, then transfer on
-- release), so there is no authorization left to top up. Bundling a tip into
-- the original charge would mean REFUNDING it whenever the poster adjusted it
-- down — and Stripe does not return the 2.9% + 30¢ on a refund, so the
-- "one charge" saving is illusory and costs more the moment anyone changes
-- their mind. A separate post-completion charge it is.
--
-- Three modes, chosen per poster (owner decision):
--   off        — no automatic tip. The default; nobody is opted in silently.
--   percent    — auto_tip_value is a whole percent of the job budget.
--   fixed      — auto_tip_value is a dollar amount.
--
-- The cap applies to `percent` only, and exists because a percentage of a
-- large job is a genuinely different number than the poster pictured when they
-- set it. Null means uncapped.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auto_tip_mode') THEN
    CREATE TYPE public.auto_tip_mode AS ENUM ('off', 'percent', 'fixed');
  END IF;
END
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_tip_mode  public.auto_tip_mode NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS auto_tip_value numeric,
  ADD COLUMN IF NOT EXISTS auto_tip_cap   numeric;

-- Bounds. A tip is money leaving the poster's card without a further tap, so
-- the ceiling is enforced in the database rather than only in the form:
--   • percent 1-50   — above 50% is far likelier to be a typo than an intent.
--   • fixed   1-500  — matches the manual tip's own ceiling.
--   • cap     1-500, and only meaningful for percent.
-- `value` must be present whenever the mode is not 'off', so a half-configured
-- preference can never charge an undefined amount.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_auto_tip_valid' AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_auto_tip_valid CHECK (
        (auto_tip_mode = 'off'  AND auto_tip_value IS NULL)
        OR (auto_tip_mode = 'percent' AND auto_tip_value BETWEEN 1 AND 50
              AND (auto_tip_cap IS NULL OR auto_tip_cap BETWEEN 1 AND 500))
        OR (auto_tip_mode = 'fixed'   AND auto_tip_value BETWEEN 1 AND 500
              AND auto_tip_cap IS NULL)
      ) NOT VALID;
  END IF;
END
$$;

-- Existing rows all default to 'off' with NULL value, which already satisfies
-- the constraint, so validate it now rather than leaving it NOT VALID forever.
-- Guarded so a replay against an already-validated constraint is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_auto_tip_valid'
      AND conrelid = 'public.profiles'::regclass
      AND NOT convalidated
  ) THEN
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_auto_tip_valid;
  END IF;
END
$$;

-- Resolve a poster's preference into an amount for one job.
--
-- Kept in SQL, not the client: the charge is issued server-side after
-- completion, so this is the definition the money path actually uses. A client
-- copy would be a second source of truth for a number that leaves someone's
-- bank account.
--
-- Returns 0 when there is nothing to tip, so callers can treat 0 as "skip"
-- without null handling.
CREATE OR REPLACE FUNCTION public.resolve_auto_tip(_user uuid, _budget numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    CASE p.auto_tip_mode
      WHEN 'fixed'   THEN p.auto_tip_value
      -- Rounded to whole dollars: "$8.10" reads as a billing error on a
      -- gratuity. LEAST applies the cap, when one is set.
      WHEN 'percent' THEN LEAST(
                            round(_budget * p.auto_tip_value / 100.0),
                            COALESCE(p.auto_tip_cap, 1e9)
                          )
      ELSE 0
    END, 0)
  FROM public.profiles p
  WHERE p.user_id = _user;
$$;

-- Only the money path (service role / SECURITY DEFINER callers) needs this.
REVOKE ALL ON FUNCTION public.resolve_auto_tip(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_auto_tip(uuid, numeric) FROM anon;
-- Authenticated CAN read it: the checkout screen shows the poster what their
-- own auto-tip will be, and RLS on profiles already limits which row they can
-- resolve. Showing someone their own configured number is not a leak.
GRANT EXECUTE ON FUNCTION public.resolve_auto_tip(uuid, numeric) TO authenticated;
