-- Q193 (owner decision 2026-09-23): the approval-pending and account-denied
-- screens and states are deleted. "Every signup is auto-approved and bans are
-- automated." AccountBanned stays.
--
-- WHY THE COLUMN STAYS. profiles.approval_status is read live (measured on prod
-- 2026-09-23 with pg_get_functiondef / pg_policies) by 15 SQL functions — 10
-- readers filtering `= 'approved'` (get_helper_tiers, search_profiles_by_name,
-- get_safe_profiles, get_public_profile_stats, get_public_profile_reviews,
-- get_my_saved_helpers, get_parish_activity, notify_helpers_on_job_post,
-- notify_saved_searches_on_new_job, sweep_daily_job_digest; get_public_profile_stats
-- also RETURNS it), 5 trigger functions (prevent_self_escalation pins it,
-- log_verification_change audits it, sync_email_verified[_on_insert] flip
-- 'pending' -> 'approved' on confirmation, enforce_referral_credit_eligibility
-- reads 'denied'), and the "Users can insert their own profile" RLS policy
-- (WITH CHECK approval_status = 'pending'). cleanup-abandoned-accounts uses
-- 'pending' as its "complete-signup never ran" marker. Dropping it is a
-- separate data-model change (queued in docs/OPEN.md), not this one.
--
-- WHAT CHANGES HERE:
--   1. The two non-approved rows on prod are settled. Both are audit fixtures
--      owned by scripts/audit/prod-seed.mjs (is_seed = true, mailinator,
--      "Seed Pending Tester" / "Seed Denied Tester", 0 jobs), and the owner
--      confirmed they are test data. Matched by user_id AND is_seed, so on a
--      fresh replay (no such rows) this is a no-op, and it can never touch a
--      real account.
--   2. 'denied' becomes unrepresentable: CHECK (approval_status IN ('pending',
--      'approved')). Nothing writes it any more (the admin Deny dialog and
--      stripe-idv-webhook's retained-ban branch were its only writers), so a
--      stale writer now fails loudly instead of silently hiding an account
--      from every `= 'approved'` reader above. 'pending' remains, with no
--      screen and no gate: it only means complete-signup has not run yet.
--
-- Replay-safe: the constraint is dropped-if-exists before it is added, and the
-- UPDATE matches nothing on a database that never held the two fixtures.

UPDATE public.profiles
   SET approval_status = 'approved',
       denial_reason   = NULL
 WHERE is_seed = true
   AND user_id IN (
     '48784972-6814-4e32-8b4a-7d4089e9957b'::uuid,  -- helpr-seed-pending-0912@mailinator.com
     'c31ac8b6-9658-4b0f-b352-6e29d0ac1218'::uuid   -- helpr-seed-denied-0912@mailinator.com
   )
   AND approval_status IS DISTINCT FROM 'approved';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_approval_status_no_denied;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_approval_status_no_denied
  CHECK (approval_status IN ('pending', 'approved'));
