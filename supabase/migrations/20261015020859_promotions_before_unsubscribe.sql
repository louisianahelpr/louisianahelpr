-- Q?unsub-resubscribe-consent (owner, 2026-10-15, pop-up: "Only undo what they
-- turned off"). An email's unsubscribe link offers "Resubscribe" as an undo.
-- It used to write profiles.marketing_consent = true and
-- notification_preferences.email_promotions = true whatever they had been, so
-- the holder of a promotions link could opt in an address that never agreed to
-- marketing, or switch on promotions a member had turned off in Settings
-- (measured 2026-10-15: all 24 members with consent on have email_promotions
-- off, 21 of them the untouched default).
--
-- The fix needs to remember what the unsubscribe turned off. This column holds
-- it: {"marketing_consent": bool, "email_promotions": bool}, written by the
-- email-unsubscribe function (service role) on the FIRST unsubscribe through a
-- link, read and cleared by its resubscribe. NULL means nothing to undo, and a
-- resubscribe then writes nothing.
--
-- Who can touch it: profiles has no table-level UPDATE for authenticated or
-- anon (only column grants), and none is granted here, so only the service
-- role writes it. SELECT on profiles is limited by RLS to the member's own row
-- and admins, so it is readable only by them.
--
-- REPLAY-SAFETY: ADD COLUMN IF NOT EXISTS; COMMENT is idempotent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS promotions_before_unsubscribe jsonb;

COMMENT ON COLUMN public.profiles.promotions_before_unsubscribe IS
  'What an email unsubscribe link turned off ({marketing_consent, email_promotions}); the link''s resubscribe restores exactly this and clears it. Written only by the email-unsubscribe function (service role). Q?unsub-resubscribe-consent.';
