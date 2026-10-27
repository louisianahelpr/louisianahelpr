-- Owner 2026-10-25 (pop-up, through the lead): the checkout reminder, the
-- confirm-email reminders, payout setup at hire and the card hold at post
-- "are not features. they should be done always for everyone." This turns
-- card_hold_at_post ON for everyone: a posted job holds the poster's card
-- (card and Link) and charges it only when a Helpr is hired; nobody hired
-- cancels the hold. The switch is created 'off' by
-- 20261027185146_card_hold_at_post.sql, which runs first.
--
-- Going live is otherwise an admin's flip in Admin -> Settings (20261012031120).
-- This is an owner-approved exception, listed by file in
-- src/test/featureSwitchRegistry.test.ts (OWNER_APPROVED_GO_LIVE, exact).
--
-- AUDITED: the UPDATE fires feature_switches_audit_change, which writes the
-- admin_audit_log row (set_feature_switch, {from, to: everyone}) in the same
-- transaction.
--
-- REPLAY-SAFE: it changes the switch only while NO admin_audit_log row exists
-- for it. Its own first run writes one, so a replay changes nothing, and once
-- an admin has set the switch (on, testers or off) a replay never overrides
-- that choice. Where the switch row is missing the UPDATE matches nothing.

UPDATE public.feature_switches
   SET audience = 'everyone', updated_at = now()
 WHERE key = 'card_hold_at_post'
   AND audience IS DISTINCT FROM 'everyone'
   AND NOT EXISTS (
     SELECT 1 FROM public.admin_audit_log a
      WHERE a.action = 'set_feature_switch'
        AND a.target_type = 'feature_switch'
        AND a.target_id = 'card_hold_at_post');
