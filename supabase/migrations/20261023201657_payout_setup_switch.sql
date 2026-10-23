-- Payout setup pause (owner ruling by pop-up, 2026-10-23).
--
-- Stripe closed Helpr's platform account on 2026-10-23. stripe-connect now
-- answers "You cannot create new accounts because your account has been
-- rejected." and "An account link cannot be created for this account because
-- the account has been rejected." (function_logs, 2026-10-23; see
-- supabase/functions/_shared/livePayoutGate.ts). The owner paused ONLY the
-- Helpr payout-account setup (Stripe Connect onboarding). Posting and paying
-- for jobs are untouched (the owner declined pausing those).
--
-- The switch is `payout_setup`, a hidden feature switch like `sms_alerts`
-- (registry 20261012031120). It is created OFF, which IS the pause:
--   off       payout setup is paused for every member. stripe-connect refuses
--             onboard, update_onboarding, reset and a non-Express dashboard
--             link with 409 { code: "payout_setup_paused" } before any Stripe
--             call, and every app entry point shows a calm notice instead.
--   testers   setup is back for admins and test accounts only (to try it once
--             Stripe reinstates the account).
--   everyone  setup is back for every member.
-- Turning it back on is an admin's audited flip in Admin -> Settings -> Hidden
-- Feature Switches, never a migration. Read errors fail CLOSED (paused): a
-- member is never sent into a Stripe setup the server cannot vouch for.
--
-- Named for what it turns ON (payout setup), not "payout_setup_paused": a
-- switch in this registry is born off or testers, never everyone (BEFORE
-- INSERT trigger feature_switches_never_created_on and
-- src/test/featureSwitchRegistry.test.ts), so the pause has to be the switch's
-- OFF state.
--
-- Replay-safe: ON CONFLICT DO NOTHING never resets an audience an admin chose.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('payout_setup', 'off',
        'Helpr payout setup (Stripe Connect onboarding: set up, finish or reset a payout account). Off = PAUSED for everyone while Stripe reviews our account (owner, 2026-10-23): the app shows a calm notice and stripe-connect refuses with payout_setup_paused. Testers = back for admins and test accounts only. Everyone = back for all members. Posting and paying for jobs do not depend on this switch.')
ON CONFLICT (key) DO NOTHING;
