-- Move Welcome tour completion from device storage to the profile row
--
-- The "Welcome to Helpr" tour recorded that it was finished ONLY in device
-- storage (`helpr_onboarding_<uid>` via safeStorage → localStorage + Capacitor
-- Preferences). Device storage does not survive a reinstall, a wipe, or a
-- fresh TestFlight install, so an account that completed onboarding months ago
-- was shown the whole seven-step tour again ~1.5s after the dashboard settled,
-- every time it landed on a clean install. It is also per-device: the same
-- account on a second phone or a browser starts from zero.
--
-- Completion is a fact about the ACCOUNT, not about the handset, so it belongs
-- on the account. This adds one nullable timestamptz to `profiles` — the same
-- shape the table already uses for exactly this kind of one-shot per-account
-- fact (`accepted_terms_at`, `onboarding_fee_charged_at`, `has_applied_before`,
-- `saved_helper_seen`). A dedicated table would buy nothing: one row per
-- profile, one column, read on every dashboard mount, never queried on its own
-- and never more than one row per account — a side table would just add a join
-- and a second RLS surface to keep in sync with `profiles`.
--
-- No backfill is possible: the only record of who has already completed the
-- tour lives on their device. The client handles that instead — when it finds
-- device storage saying "completed" and the account column NULL, it writes the
-- account value (a one-time self-heal), so existing users adopt the account
-- value on their next dashboard visit rather than on their next reinstall.
--
-- AUTHZ NOTE — the non-obvious part. `authenticated` does NOT hold table-level
-- UPDATE on public.profiles; it holds COLUMN-level UPDATE on an allowlist of 91
-- of the table's 102 columns (verified in prod via
-- information_schema.column_privileges, 2026-09-09), which is what the
-- "Users can update their own safe fields" policy leans on. Column privileges
-- are per-column: ADD COLUMN grants nothing, so without the explicit GRANTs
-- below the client's UPDATE would fail with 42501 for every user, forever, and
-- the tour would keep re-showing exactly as it does today. This is the same
-- family as the `get_parish_for_zip` incident: a correct-looking fix that a
-- missing ACL silently defeats.
--
-- The GRANTs name the roles explicitly and the REVOKE names PUBLIC *and* anon
-- (revoking PUBLIC alone leaves anon's own grant intact — house rule). anon has
-- no business reading or writing a member's onboarding state.
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS + idempotent GRANT/REVOKE, all of
-- which are safe to run any number of times, and none of which reference an
-- object defined by a later migration. Proven by applying this file three
-- times consecutively against a prod-shaped `profiles` under PGlite.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_tour_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.onboarding_tour_completed_at IS
  'When this account finished or skipped the Welcome tour. NULL = never completed. '
  'Account-scoped on purpose: device storage did not survive a reinstall and re-showed '
  'the tour to long-standing accounts. The client keeps a device-storage copy as a fast '
  'local hint, but THIS column is the source of truth.';

-- Column-level privileges. `authenticated` needs to read its own value and
-- stamp it once; RLS ("Users can view/update their own ...") still restricts
-- WHICH row, exactly as it does for every other column here.
GRANT SELECT (onboarding_tour_completed_at) ON public.profiles TO authenticated;
GRANT UPDATE (onboarding_tour_completed_at) ON public.profiles TO authenticated;
GRANT SELECT (onboarding_tour_completed_at) ON public.profiles TO service_role;
GRANT UPDATE (onboarding_tour_completed_at) ON public.profiles TO service_role;

-- PUBLIC *and* anon, named separately on purpose. See the AUTHZ NOTE above.
REVOKE ALL (onboarding_tour_completed_at) ON public.profiles FROM PUBLIC;
REVOKE ALL (onboarding_tour_completed_at) ON public.profiles FROM anon;
