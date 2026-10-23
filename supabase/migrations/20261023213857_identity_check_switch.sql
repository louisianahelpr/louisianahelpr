-- ID verification off, behind one switch (owner rulings by pop-up, 2026-10-23).
--
-- "just remove the verify id entirely, we will move to paypal." Stripe Identity
-- died with Helpr's closed Stripe platform account: error_logs held "We
-- couldn't start identity verification right now. Please try again." 21 times
-- in 2 days (last 19:36Z), so every member who still needed the check was
-- simply blocked from posting, accepting and starting jobs.
--
-- THE SWITCH: hidden feature switch `identity_check` (registry
-- 20261012031120), created OFF. Off = no ID check is required or offered
-- anywhere. Testers = required for admins and test accounts only (to try a new
-- provider). Everyone = required for every member again. An admin changes it in
-- Admin -> Settings -> Hidden Feature Switches (audited); never a migration.
-- A missing switch row reads as OFF (feature_enabled_for_user fails to false),
-- which is the owner's ruled default.
--
-- WHAT CHANGES (reversibly, nothing deleted):
--   identity_check_exempt(user)  also TRUE while the switch is off for that
--     member. It is the carve-out every ID gate already asks first:
--     enforce_identity_before_post (jobs INSERT), enforce_identity_before_start
--     (jobs and group_job_helpers: on the way, arrived, in progress) and
--     declutter_identity_gate (first Declutter buy, offer, counter, order,
--     listing). Measured live 2026-10-23 (pg_trigger, pg_proc): no other
--     trigger or policy refuses a member for a missing ID.
--   helper_accept_missing(user)  no longer lists 'stripe_id' while the switch is
--     off for that member, so every accept path stops waiting on the ID:
--     accept_job_offer, respond_to_direct_offer, complete_direct_offer_accept,
--     claim_series_dates, rpc_group_member_confirm, helpr_task_accept,
--     quote_job_funded_hires_quoter, enforce_helper_award_gate,
--     helper_accept_block_reason and the pending-accept completions. (A pending
--     accept that waited ONLY on the ID completes when its completion trigger
--     next fires on a profile payout/ID change; turning the switch off changes
--     no profile, so it is not swept at once. Measured 2026-10-23: 0 such rows,
--     job_accept_pending empty.)
-- UNCHANGED on purpose: is_identity_verified / identity_is_verified (they say
-- who REALLY verified; every "ID verified" badge reads them, so nobody is
-- shown as verified who is not), Stripe Identity's own code (stripe-idv-start,
-- stripe-idv-webhook, the identity fingerprint and retained-ban check), and the
-- Homes landlord photo-ID review (rentals_*: owner kept it, 2026-10-23).
--
-- OWNER-ACCEPTED TRADE-OFF (pop-up 2026-10-23, option (a) "GO"): while the
-- switch is off, the ID-level ban-evasion layer is lost. stripe-idv-webhook
-- fingerprints a verified ID (identity_fingerprint) and re-applies a retained
-- ban (enforce_retained_ban); because no new member verifies an ID, a banned
-- person who returns on a new email and phone is no longer caught at the ID,
-- and flag_possible_ban_evasion_by_identity (same name + birth date, another
-- document) does not run either. Measured live 2026-10-23 (lh-trust-safety):
-- retained_bans holds 85 rows, email hash on 85, phone on 81, identity hash on
-- 0 (the ID layer never held a fingerprint, so the loss is for future bans
-- only), card/bank hashes on 0 (filled from payment_fingerprints only when a
-- member is banned later, and only through Stripe). What still holds: the email
-- check at signup (handle_new_user), the phone check (complete-signup ->
-- enforce_retained_ban), and the name/phone ban-evasion flags. Under-13 and under-18 blocks are NOT affected: they read the
-- saved birthday, never Stripe Identity (complete-signup, _shared/under13Age.ts).
--
-- Replay-safe: CREATE OR REPLACE restates both functions whole from their
-- newest definitions (20261021081258, 20261020043346) with the one switch read
-- added; ON CONFLICT DO NOTHING never resets an audience an admin chose.

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('identity_check', 'off',
        'ID verification (Stripe Identity today, a new provider after the PayPal move). Off = no ID check is required or offered anywhere (owner, 2026-10-23: Stripe closed our account). Testers = required for admins and test accounts only. Everyone = required for every member again (posting, accepting, starting a job, first Declutter buy or listing). While off, the ID-level ban-evasion check does not run (owner accepted). Homes'' landlord photo-ID review does not depend on this switch.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.identity_check_exempt(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT
    -- The ID check is off for this member (switch `identity_check`, owner 2026-10-23).
    -- (While off this is also true for an unknown or NULL id; every caller passes
    -- a real member, and there is nothing to enforce while off.)
    NOT public.feature_enabled_for_user('identity_check', p_user_id)
    OR COALESCE((
      SELECT p.is_seed IS TRUE AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id)
        FROM public.profiles p WHERE p.user_id = p_user_id
    ), false);
$fn$;
-- Grants restated as live (pg_proc.proacl 2026-10-23: postgres + service_role only).
REVOKE ALL ON FUNCTION public.identity_check_exempt(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identity_check_exempt(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.helper_accept_missing(p_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN p.user_id IS NULL THEN ARRAY['unknown']
           -- Fixture data stays usable while fixture-shaped AND an enrolled test
           -- account (seed_hidden_for's membership rule).
           WHEN p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) THEN ARRAY[]::text[]
           ELSE array_remove(ARRAY[
             CASE WHEN p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE THEN 'payout_setup' END,
             -- The ID step only while the `identity_check` switch is on for this member (owner 2026-10-23).
             CASE WHEN public.feature_enabled_for_user('identity_check', p.user_id)
                       AND NOT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) THEN 'stripe_id' END
           ], NULL)
         END
    FROM (SELECT p_user_id AS uid) x
    LEFT JOIN public.profiles p ON p.user_id = x.uid;
$fn$;
-- Grants restated as live (pg_proc.proacl 2026-10-23: postgres + service_role only).
REVOKE ALL ON FUNCTION public.helper_accept_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_accept_missing(uuid) TO service_role;
