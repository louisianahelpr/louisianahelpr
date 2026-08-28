-- Remove the business-seats backend.
--
-- The feature was deleted from the app in d9cbfd895 but left fully intact in
-- Postgres and deployed as four edge functions (create-business-seat-checkout,
-- business-seat-portal, check-business-seat-subscription,
-- send-business-invite-email — all deleted out-of-band, none had source in the
-- repo). What remained was attack surface with no product behind it: a
-- SECURITY DEFINER API-key minter, a spend summary granted to `anon`, an admin
-- verification queue reachable by any authenticated user, and an
-- email-existence oracle.
--
-- Every object below was verified dead against the LIVE database, not against
-- migration files: no repo call site (excluding the generated
-- src/integrations/supabase/types.ts, which names every object in the schema
-- and produces a false hit for all of them), no reference in any other
-- pg_proc body, no pg_policies qual/with_check, no view definition, no column
-- default, no constraint, no cron.job command, and no trigger binding.
--
-- DELIBERATELY KEPT — each has a live caller, and dropping it would break
-- writes to tables that are still in use:
--   * businesses (4 rows, all test/seed) — read by the check-pro-subscription
--     edge function.
--   * business_members (6 rows) — carries the enforce_business_* triggers.
--   * get_business_seat_limit / business_seat_limit_for_tier — called from
--     inside enforce_business_seat_limit(), a trigger on business_members.
--   * is_business_admin / is_business_member / is_business_owner — referenced
--     by live RLS policies on jobs and helper_w9_records, and by
--     prevent_job_field_escalation().
--   * notify_business_approvers — trigger on jobs.
--
-- REPLAY-SAFETY: every statement is IF EXISTS, so this is safe against a
-- from-scratch rebuild, and nothing dropped here is recreated by a later
-- migration.

-- 1. Tables. All three hold zero rows and have no inbound foreign keys, no
--    view, and no function or policy reference outside the objects dropped
--    below. CASCADE takes their own RLS policies, indexes and updated_at
--    triggers with them; it cannot reach anything else.
DROP TABLE IF EXISTS public.business_api_keys CASCADE;
DROP TABLE IF EXISTS public.business_webhooks CASCADE;
DROP TABLE IF EXISTS public.business_job_templates CASCADE;

-- 2. RPCs with zero callers.
DROP FUNCTION IF EXISTS public.create_business_api_key(uuid, text);
DROP FUNCTION IF EXISTS public.admin_list_business_accounts();
DROP FUNCTION IF EXISTS public.admin_list_business_members(uuid);
DROP FUNCTION IF EXISTS public.business_budget_alert_check(uuid);
DROP FUNCTION IF EXISTS public.business_spend_summary(uuid);
DROP FUNCTION IF EXISTS public.business_activity_feed(uuid, integer, timestamptz);
DROP FUNCTION IF EXISTS public.reassign_business_jobs(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.update_business_member_role(uuid, text);
DROP FUNCTION IF EXISTS public.review_business_verification(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_pending_business_verifications();
DROP FUNCTION IF EXISTS public.is_user_verified_business_member(uuid);

-- business_seat_limit(uuid) is a duplicate of get_business_seat_limit(uuid);
-- only the latter is wired into the enforce_business_seat_limit() trigger.
DROP FUNCTION IF EXISTS public.business_seat_limit(uuid);

-- get_pending_invite_for_email(text) was an email-existence oracle. Signup.tsx
-- no longer calls it — the post-auth invite-claim path went with the feature —
-- and nothing else in the schema references it.
DROP FUNCTION IF EXISTS public.get_pending_invite_for_email(text);

-- get_my_business_verification() and its only helper. get_user_business_ids()
-- had exactly one caller, get_my_business_verification, so the line above
-- orphans it. Order matters: drop the caller first.
DROP FUNCTION IF EXISTS public.get_my_business_verification();
DROP FUNCTION IF EXISTS public.get_user_business_ids(uuid);
