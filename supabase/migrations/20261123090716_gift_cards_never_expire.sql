-- MON-1123-01 (backend money audit 2026-11-23, High): paid gift cards expired 90 days after purchase.
--
-- gift_cards.expires_at defaulted to now() + 90 days (migration 20260612310000), and the restore paths
-- (restore_gift_card_for_job, restore_gift_card_for_declutter_order, return_bounced_gift_card) re-stamped
-- at least now() + 90 days. Once past it, redeem/claim refused the card and nothing refunded it.
-- The law: La. R.S. 51:1423(B)(1) forbids selling a gift card that expires in under 5 years, and (C) says a
-- card with no date is valid until it is used; 12 CFR 1005.20(e) sets a 5-year federal minimum.
-- Sources: https://legis.la.gov/Legis/Law.aspx?d=285608 ,
-- https://www.ecfr.gov/current/title-12/chapter-X/part-1005/subpart-A/section-1005.20
--
-- The fix: gift cards never expire. NULL expires_at = no expiry; every refusal path already reads it that way
-- (redeem_gift_card, redeem_gift_card_for_declutter_order, redeem_gift_card_for_shop_order: "expires_at IS NOT
-- NULL AND expires_at < now()"; claim-gift-card: `credit.expires_at && ...`; the client spend gates the same).
--   1. No default: a new card is minted with NULL.
--   2. Backfill: every card with a date gets NULL, spent or not, so no paid money lapses and no row says otherwise.
--      Prod at the audit: 71 rows, all exactly 90 days, none past it yet.
--   3. A BEFORE INSERT OR UPDATE trigger keeps expires_at NULL, whoever writes it. The three restore functions
--      still compute "greatest(..., now() + 90 days)" for the column; the trigger discards it, so they mint and
--      put back cards with no expiry without restating three long money bodies here. Any future writer is
--      covered the same way.
-- Replay-safe: DROP DEFAULT and the UPDATE are idempotent; the trigger is dropped and recreated.
--
-- Guard: src/test/giftCardsNeverExpire.test.tsx; PGlite proof src/test/pglite/giftCardsNeverExpire.pglite.mjs.

ALTER TABLE public.gift_cards ALTER COLUMN expires_at DROP DEFAULT;

COMMENT ON COLUMN public.gift_cards.expires_at IS
  'Always NULL: gift cards never expire (MON-1123-01, La. R.S. 51:1423, 12 CFR 1005.20). Kept NULL by trg_gift_cards_never_expire.';

CREATE OR REPLACE FUNCTION public.gift_cards_never_expire()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.expires_at := NULL;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.gift_cards_never_expire() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gift_cards_never_expire ON public.gift_cards;
CREATE TRIGGER trg_gift_cards_never_expire
  BEFORE INSERT OR UPDATE OF expires_at ON public.gift_cards
  FOR EACH ROW
  WHEN (NEW.expires_at IS NOT NULL)
  EXECUTE FUNCTION public.gift_cards_never_expire();

UPDATE public.gift_cards SET expires_at = NULL WHERE expires_at IS NOT NULL;
