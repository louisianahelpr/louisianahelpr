-- Memberships OFF (roadmap F4, owner 2026-10-14/15): no new Pro/membership
-- purchases. The jobs flat fee (F3) already ignores the tier, so a membership
-- buys nothing on fees any more.
--
-- Uses the hidden-switch machinery (20261012031120) instead of a new flag: the
-- switch is created OFF for everyone, the app hides every upgrade entry point
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

INSERT INTO public.feature_switches (key, audience, description)
VALUES ('memberships', 'off',
        'Membership (Pro) purchases and every upgrade entry point. Off since the jobs flat fee (roadmap F4).')
ON CONFLICT (key) DO NOTHING;
