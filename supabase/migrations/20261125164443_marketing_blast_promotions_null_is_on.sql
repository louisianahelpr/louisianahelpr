-- Owner decision by pop-up, 2026-11-25 (~2 AM): a member who ticked "email
-- me" at sign-up (profiles.marketing_consent) and never turned Promotions off
-- gets marketing email. send-marketing-blast now skips only an explicit
-- email_promotions = false (plus the Email master off, the suppression list
-- and seed/test recipients), the same rule the welcome drip, win-back and
-- come-back emails have used since 20261021135832 (Q2299). Measured on prod
-- 2026-11-25 1:55 AM: 136 members with a verified email and the box ticked,
-- blast reach 0, because every one of them had email_promotions NULL.
--
-- This migration only restates the column comment, which still said the
-- blast needs true. No data, schema or grant changes. Replay-safe: COMMENT ON
-- is idempotent. Guard: src/test/edge/marketingBlastConsentReach.test.ts and
-- src/test/promotionsNotChosen.test.ts.

COMMENT ON COLUMN public.notification_preferences.email_promotions IS
  'Promotions email switch. NULL = never chosen (commercial email follows the sign-up box, profiles.marketing_consent: the welcome, come-back and marketing blast emails all go out); true = turned on; false = turned off by the member or an unsubscribe link (no commercial email). Only the promotion notification email still needs true. Q2299 (owner 2026-10-21); blast owner decision 2026-11-25.';
