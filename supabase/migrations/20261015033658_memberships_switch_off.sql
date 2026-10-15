-- Memberships OFF (roadmap F4, owner 2026-10-14/15): no new Pro/membership
-- purchases. The jobs flat fee (F3) already ignores the tier, so a membership
-- buys nothing on fees any more.
--
-- Uses the hidden-switch machinery (20261012031120) instead of a new flag: the
-- switch starts as TESTERS (see REVIEW FREEZE below), the app hides every upgrade entry point
-- with useFeature("memberships"), and create-pro-checkout refuses with
-- requireFeature(serviceClient, "memberships", user). Turning memberships back
-- on is the owner's flip in Admin -> Settings, never a migration.
--
-- Existing subscribers (measured 2026-10-15: 0 profiles hold a tier): nothing
-- here touches profiles, but the formerly paid perks read this same switch
-- (owner F4a, 2026-10-15: off for EVERYONE while memberships are off):
-- instant-payout and create-boost-payment (edge) and early access
-- (20261015050803).
--
-- REPLAY-SAFE: ON CONFLICT DO NOTHING never resets an audience an admin chose.

-- REVIEW FREEZE (2026-10-15): build 1.0.4 (7119) is in App Review and sells Pro
-- through Apple in-app purchase. The switch is created at 'testers' (the creation
-- rule allows only off/testers; going to everyone is an admin's audited flip):
-- the App Review account (apple-reviewer, in test_accounts, measured 2026-10-15)
-- and the other test accounts keep Pro and its perks exactly as before, so what
-- the reviewer sees does not change; every other member has memberships off,
-- which is the owner's decision F4/F4a. No public iOS install exists yet (1.0.4
-- is the first store build), so no member can buy Pro through Apple before the
-- owner answers Q?ios-membership-sale.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('memberships', 'testers',
        'Membership (Pro) purchases, perks and every upgrade entry point. Owner decision F4: off for members, testers (incl. the App Review account) keep it during the 1.0.4 review.')
ON CONFLICT (key) DO NOTHING;
