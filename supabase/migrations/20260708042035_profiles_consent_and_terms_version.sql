-- Cowork audit 2026-07-08 (High): signup captures NO consent for SMS or
-- push, and the accepted Terms are not version-pinned so a material Terms
-- update leaves every existing user "silently re-consenting" without any
-- affirmative action. This migration is the storage side of the fix:
-- explicit SMS + push opt-in columns and a stored `terms_version_accepted`
-- text so we can compare against the current app-level constant to gate a
-- re-consent modal on version bumps.
--
-- Same fail-closed pattern as marketing_consent (20260708011322): default
-- false / empty so a row present pre-migration reads as "not consented".
-- Every SMS / push sender MUST filter on the respective column so a user
-- who never opted in never receives one. Transactional mail is legally
-- exempt and does not read these; only marketing / re-engagement paths do.
--
-- Consumers to wire up:
--   * `supabase/functions/send-push-notification` — filter on
--     `push_consent = true` for marketing / re-engagement pushes;
--     transactional pushes (job accepted, message received) still fire.
--   * any future SMS sender — filter on `sms_consent = true`.
--   * `useConsentGate` (client) — reads `terms_version_accepted` and
--     compares against `LATEST_TERMS_VERSION` in `src/lib/consent.ts` to
--     decide whether to open the re-consent modal on next authed load.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_version_accepted text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
