-- expose min_supported_build through get_public_platform_settings so the
-- force-update gate can read it.
--
-- THE PROBLEM. `platform_settings.min_supported_build` has existed since
-- 20260609160000 and the admin console writes it, but no running app could
-- ever have read it back -- not because nobody wrote the client, but because
-- there was no path to the value. `platform_settings` is admin-only under RLS
-- ("Admins can read platform settings"), so an ordinary user's select returns
-- zero rows, and the failure is the quiet kind: PostgREST answers 200 with
-- `[]`, not an error. Verified against prod on 2026-08-31 -- the anon key gets
-- `200 []` from /rest/v1/platform_settings and a full row from this RPC, which
-- is the sanctioned public read path for the table.
--
-- So the gate that ships alongside this migration (src/hooks/useVersionCheck.ts
-- + src/components/ForceUpdateGate.tsx) reads the value here, and the column
-- has to travel through the RPC to reach it. Only `min_supported_build` is
-- added: `latest_build` drives a soft "update available" nudge that the owner
-- explicitly declined, so exposing it would be plumbing for a feature that
-- does not exist.
--
-- BEHAVIOURALLY INERT ON DEPLOY. Prod holds min_supported_build = 0, which is
-- the documented off value, so this turns nothing on. And the client fails
-- OPEN on every way the read can go wrong -- error, missing row, missing
-- column, unparseable value -- so the deploy-lag window, where a shipped build
-- calls the older 7-column signature and gets no such column, is a no-op for
-- it rather than an outage. That direction is deliberate and is the OPPOSITE
-- of the feature-flag read next door (lib/featureFlags.ts fails closed): a
-- gate that blocks the app when its own read fails is an outage you cannot fix
-- remotely, which is precisely the situation force-update exists to rescue.
--
-- DROP + CREATE rather than CREATE OR REPLACE: adding a column changes the
-- RETURNS TABLE shape, which Postgres will not let a replace do. EXECUTE is
-- re-granted afterwards, and every caller selects by name, so the extra column
-- cannot break the existing consumers (useDashboardData, lib/featureFlags.ts).
--
-- REPLAY-SAFETY: DROP IF EXISTS and grants re-asserted rather than assumed.
-- Both columns this body reads are defined by EARLIER migrations
-- (20260609160000 min_supported_build, 20260826070000 feature_flags), so a
-- from-scratch replay in timestamp order always reaches this file with them
-- present; there is nothing later to guard against.

DROP FUNCTION IF EXISTS public.get_public_platform_settings();

CREATE FUNCTION public.get_public_platform_settings()
RETURNS TABLE(
  id uuid,
  platform_fee_percent numeric,
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
    platform_fee_percent,
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

GRANT EXECUTE ON FUNCTION public.get_public_platform_settings() TO anon, authenticated;

-- Both column comments named a reader file as though it existed. One now does;
-- the other never will. Restate them so neither describes a plan as a fact --
-- a stale comment that contradicts the code is how min_supported_build sat
-- unenforced for three months while its own comment said a gate read it.
COMMENT ON COLUMN public.platform_settings.min_supported_build IS
  'Minimum CFBundleVersion / Android versionCode required by the app. Read by the force-update gate (src/hooks/useVersionCheck.ts, surfaced by src/components/ForceUpdateGate.tsx) via get_public_platform_settings(); 0 disables the gate. Native only -- the web app has no build number and is never blocked. The gate fails OPEN: any read error leaves the app usable.';

COMMENT ON COLUMN public.platform_settings.latest_build IS
  'Newest CFBundleVersion / Android versionCode available in the stores. NOT READ BY ANYTHING. The soft "update available" nudge this column was added for (src/hooks/useSoftUpdatePrompt.ts) was never built and was explicitly declined on 2026-08-31 in favour of the single hard gate on min_supported_build. Kept because it is the natural home for the value if a nudge tier is ever wanted; do not infer from this column that one exists.';
