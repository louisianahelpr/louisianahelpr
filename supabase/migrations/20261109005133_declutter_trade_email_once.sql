-- Trades email once (lead 11-08, lander train). 20261108195151_declutter_trades_fixes.sql emails the trade notices
-- through its own AFTER INSERT trigger on notifications, trg_email_declutter_trade_notice (eight titles, link
-- '/declutter%'). Every trade notice is written by declutter_notify as type declutter_offers or declutter_sales, and
-- trg_email_declutter_notice (20261108202546) emails EVERY notice of those types whose title is not in its exclusion
-- list, so each trade notice fired both triggers: two send_notice_email calls, two emails to the member.
--
-- Now trg_email_declutter_notice skips every trade title, so the trade trigger is the one path for trade emails:
--   - the eight titles trg_email_declutter_trade_notice emails go once, through it;
--   - "Trade offer withdrawn", "Trade set: choose a pickup within 48 hours" and "You cancelled the trade" stay in the
--     bell only, as 20261108195151 intends (the member who acted already knows).
-- The WHEN is restated VERBATIM from 20261108202546 apart from the added NOT IN list of trade titles; the function
-- email_declutter_notice() is unchanged. It is restated here, not in 20261108195151, because that file sorts before
-- 20261108202546 and would be undone by it on a replay.
--
-- MONEY: none. AUTHZ: no function or grant changes; trigger only. REPLAY-SAFE: DROP TRIGGER IF EXISTS + CREATE.
-- Proof: src/test/pglite/declutterTradesFixes.pglite.mjs ("one trade notice is emailed exactly once").

DROP TRIGGER IF EXISTS trg_email_declutter_notice ON public.notifications;
CREATE TRIGGER trg_email_declutter_notice
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type IN ('declutter_offers', 'declutter_sales', 'declutter_pickups', 'declutter_refunds')
        AND NEW.title NOT IN (
          -- their own email already goes (header)
          'Payment received', 'Buyer paid', 'Refund on its way',
          'Delivery pay raised', 'Your raise is coming back', 'Shipping refund on its way',
          -- the payment page said it first (M4)
          'Card saved',
          -- each chat line: the delayed "Unread message" reminder is emailed instead
          'New message about your order', 'New message about a handover', 'New message about a delivery',
          -- an edit to an item someone offered on
          'Listing updated', 'Listing changed')
        AND NEW.title NOT LIKE 'Your payout for %'
        -- trade notices: trg_email_declutter_trade_notice (20261108195151) emails the ones that go, once
        AND NEW.title NOT IN (
          'New trade offer', 'Trade offer declined', 'Trade offer expired', 'Trade offer closed',
          'Trade offer: about 12 hours left', 'Trade accepted: choose a pickup within 48 hours',
          'Trade cancelled', 'Trade ended, no strike',
          'Trade offer withdrawn', 'Trade set: choose a pickup within 48 hours', 'You cancelled the trade'))
  EXECUTE FUNCTION public.email_declutter_notice();
