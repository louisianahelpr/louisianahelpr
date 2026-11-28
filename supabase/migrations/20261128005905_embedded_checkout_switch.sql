-- Stripe Embedded Checkout on the website (owner 2026-11-27: "checkout should never leave the app/site, like
-- Vinted/Depop"; "Start now: website + Declutter first"). Plan phase W.
--
-- The switch is `embedded_checkout`, a hidden feature switch (registry 20261012031120), created for TESTERS:
--   off       every payment opens Stripe's hosted page, exactly as before.
--   testers   admins and test accounts paying on the WEBSITE get Stripe's form inside our own sheet
--             (ui_mode embedded + return_url, same Checkout Session, same webhook).
--   everyone  every website payment does.
-- The native app and old builds always keep the hosted page ({url}); the server
-- (supabase/functions/_shared/embeddedCheckout.ts) answers embedded only when the web client asks, the switch is on
-- for the verified caller (featureEnabledForUser, fails closed = hosted) and the session's mode has a publishable
-- key. Going to everyone is an admin's audited flip in Admin -> Settings -> Hidden Feature Switches.
--
-- Replay-safe: ON CONFLICT DO NOTHING never resets an audience an admin chose.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('embedded_checkout', 'testers',
        'Website payments open Stripe''s card form inside our own page (Stripe Embedded Checkout) instead of sending the buyer to Stripe''s page. Same payment, same receipts. Off = Stripe''s page for everyone. The app always uses Stripe''s page until the in-app payment sheet ships.')
ON CONFLICT (key) DO NOTHING;
