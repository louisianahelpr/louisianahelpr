-- Two findings from the 2026-09-01 security lane. Both are about a thing that
-- exists, is reachable, and binds to nothing.
--
-- ─────────────────────────────────────────────────────────────────────────
-- F-2  time_credits let any signed-in user mint their own currency.
-- ─────────────────────────────────────────────────────────────────────────
-- The INSERT policy from 20260612340000 was:
--
--     CREATE POLICY "Users can insert own credits"
--       ON public.time_credits FOR INSERT
--       WITH CHECK (auth.uid() = user_id);
--
-- which says "you may write your own ledger rows" — for a LEDGER, whose whole
-- purpose is that the holder cannot write it. Proven against production on
-- 2026-09-01 from a freshly-created, clearly-marked test account holding only
-- role='customer':
--
--   POST /rest/v1/time_credits {user_id: <self>, amount_minutes: 999999}
--     → HTTP 201, row returned
--   POST /rest/v1/rpc/get_time_credit_balance {p_user_id: <self>}
--     → 999999
--
-- (Both rows deleted immediately afterwards; verified 0 residual.)
--
-- The resolution is DELETION, not a tighter policy — the owner's call, and the
-- right one. Nothing mints time credits and nothing spends them: a repo-wide
-- search found no INSERT anywhere in src/ or supabase/functions/, no RPC that
-- writes the table, and no redemption path. `balance_after` is documented in
-- the original migration as "maintained by the app layer", and that app layer
-- was never built. Production held ZERO rows at every reading. A currency with
-- no mint and no sink cannot be made both safe and meaningful by adjusting who
-- may write it; the only honest fix is to remove it.
--
-- The row-count assertion below is deliberately part of the migration rather
-- than a thing this session checked beforehand. "It has always been empty" is
-- a claim about the past; a DROP needs the claim to hold at the instant it
-- runs. If a row ever appears, this aborts and a human looks at it.
--
-- ─────────────────────────────────────────────────────────────────────────
-- F-4  get_public_platform_settings served a fee percent nobody charges.
-- ─────────────────────────────────────────────────────────────────────────
-- The RPC is SECURITY DEFINER and granted to `anon`, and it returned
-- `platform_fee_percent = 15`. Verified live, unauthenticated:
--
--   POST /rest/v1/rpc/get_public_platform_settings  (anon key)
--     → 200 [{"platform_fee_percent": 15.0, "customer_fee_percent": 12,
--             "helper_fee_percent": 12, ...}]
--
-- 15 is not a rate this platform charges anyone. The tier ladder in
-- `_shared/helperFees.ts` (and its pinned twin `src/lib/subscriptionTiers.ts`)
-- is free 12 / basic 11 / pro 10 / elite 8; the same row's own
-- customer_fee_percent and helper_fee_percent both read 12. `create-payment`
-- explicitly refuses to read the column ("platform_fee_percent is deliberately
-- NOT selected"), and no consumer of this RPC binds the field: useDashboardData
-- reads helper_fee_percent, useJobFormEffects reads customer_fee_percent and
-- onboarding_fee_cents, featureFlags reads feature_flags. The `platform_fee_percent`
-- that DOES get used everywhere else is `jobs.platform_fee_percent` — a
-- different column on a different table, stamped per job at escrow time.
--
-- So the projection published a number that looks authoritative, is reachable
-- without logging in, and is wrong. It comes out of the projection rather than
-- being retuned to 12: retuning would preserve a field nothing reads, and the
-- next person to find it would have the same "is this the real fee?" question
-- with a more plausible-looking answer.
--
-- The COLUMN on platform_settings is left in place. This migration changes what
-- is published, not what is stored, and the admin surfaces that write the row
-- (AdminSettings) already only bind customer_fee_percent / helper_fee_percent.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Replay-safety
-- ─────────────────────────────────────────────────────────────────────────
-- Every statement is guarded: the assertion only runs while the table still
-- exists, the drops are IF EXISTS, and the RPC is DROP + CREATE (adding or
-- removing a column changes the RETURNS TABLE shape, which CREATE OR REPLACE
-- cannot do). Applying this file three times in a row is a no-op after the
-- first. Verified under PGlite, 3x.

-- ─────────────────────────────────────────────────────────────────────────
-- F-2: retire time_credits
-- ─────────────────────────────────────────────────────────────────────────

-- Prove the ledger is empty AT DROP TIME, not merely when this was written.
DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.time_credits') IS NULL THEN
    RAISE NOTICE 'time_credits already dropped — nothing to assert';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.time_credits' INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION
      'time_credits holds % row(s); refusing to drop. Someone began using this table after it was declared dead — reconcile before retrying.', n;
  END IF;
  RAISE NOTICE 'time_credits confirmed empty (% rows) — proceeding with drop', n;
END $$;

-- The balance RPC goes first: it reads the table, and it carried a defect of
-- its own that would have been a finding in its own right had the table
-- survived. It is SECURITY DEFINER taking an arbitrary `p_user_id`, and it is
-- still granted to `authenticated` — so ANY signed-in user could read ANY other
-- user's balance, straight past the row-level SELECT policy that scoped the
-- table itself to `auth.uid() = user_id`. Confirmed live on 2026-09-01:
--
--   POST /rpc/get_time_credit_balance {p_user_id: <a different user's id>}
--     → HTTP 200, body `0`      (as `authenticated`)
--     → HTTP 401                (as `anon`)
--
-- The anon side is already closed — 20260823210000 revoked anon EXECUTE on
-- exactly this signature — but the authenticated cross-user read was not, and
-- a definer that takes a caller-supplied user id needs its own caller check,
-- which this never had.
--
-- Its search_path IS pinned (20260618140000 set `search_path = public` on it),
-- so that half was fine; the missing piece was authorization, not resolution.
--
-- Replay-safe against those earlier migrations: 20260618140000,
-- 20260823210000 and 20260823220000 each guard their ALTER/REVOKE with
-- `to_regprocedure(...) IS NOT NULL`, so a from-scratch rebuild that runs them
-- after this drop skips the function rather than aborting.
DROP FUNCTION IF EXISTS public.get_time_credit_balance(uuid);

-- Policies go with the table, but they are named here so a reader grepping for
-- either policy name lands on the migration that removed it:
--   "Users can view own credits"   (SELECT)
--   "Users can insert own credits" (INSERT)  <- the self-mint
DROP TABLE IF EXISTS public.time_credits;

-- `jobs.scope_video_url` / `scope_video_thumbnail_url` were added by the same
-- 20260612340000 migration but are unrelated to time banking and are NOT
-- dropped here.

-- ─────────────────────────────────────────────────────────────────────────
-- F-4: drop platform_fee_percent from the public projection
-- ─────────────────────────────────────────────────────────────────────────
-- Body is otherwise identical to 20260826070000, minus the one column.
-- SECURITY DEFINER is retained deliberately: platform_settings is admin-only
-- under RLS ("Admins can read platform settings"), and this RPC is the
-- sanctioned public read path for the handful of genuinely public values on it.
-- `SET search_path TO 'public'` is retained for the same reason it was there
-- before — a definer without a fixed search_path resolves objects against the
-- caller's path.
--
-- No recursion risk: this function reads platform_settings, whose policy is a
-- plain admin-role check that does not read back into platform_settings. (The
-- definer-reads-a-table-whose-policy-reads-back-into-it recursion that
-- 20260529111503 fixed is a real hazard in this codebase; it does not apply
-- here, and the shape was checked rather than assumed.)

-- ⚠️ THE BASELINE HERE IS 20260901035235, NOT 20260826070000.
--
-- This projection is redefined by whole-function DROP + CREATE, so it is a
-- LAST-WRITER-WINS surface: whatever this file omits is deleted, silently and
-- permanently, from every migration that ran before it.
--
-- 20260901035235 (landed the same day, three minutes before this file's
-- timestamp) added `min_supported_build` so the force-update gate
-- (src/hooks/useVersionCheck.ts → src/components/ForceUpdateGate.tsx) could
-- read it — that column is admin-only under RLS, and this RPC is its only
-- public read path. Rebuilding from the older 8-column body would have dropped
-- it again and disabled the force-update gate with nothing failing: the gate
-- fails OPEN by design, so the app would keep working and the ONE remote
-- kill-switch for a broken build would just quietly stop existing.
--
-- So `min_supported_build` is carried forward here deliberately, and anyone
-- redefining this function again must diff against the CURRENT definition
-- rather than against whichever migration they happen to be reading.
DROP FUNCTION IF EXISTS public.get_public_platform_settings();

CREATE FUNCTION public.get_public_platform_settings()
RETURNS TABLE(
  id uuid,
  customer_fee_percent numeric,
  helper_fee_percent numeric,
  hybrid_idv_enabled boolean,
  idv_auto_approve_threshold numeric,
  onboarding_fee_cents integer,
  feature_flags jsonb,
  min_supported_build integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    id,
    customer_fee_percent,
    helper_fee_percent,
    hybrid_idv_enabled,
    idv_auto_approve_threshold,
    onboarding_fee_cents,
    COALESCE(feature_flags, '{}'::jsonb),
    COALESCE(min_supported_build, 0)
  FROM public.platform_settings
  LIMIT 1;
$function$;

-- Grants are re-asserted, never assumed to have survived the DROP. Stated
-- deliberately and unchanged from 20260826070000: `anon` because the post-job
-- and marketing surfaces read the fee/feature flags before sign-in, and
-- `authenticated` for every in-app consumer. No grant to `public`.
GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon, authenticated;
