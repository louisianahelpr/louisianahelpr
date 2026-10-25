-- Owner 2026-10-25 (pop-up, through the lead): the checkout reminder, the
-- confirm-email reminders, payout setup at hire and the card hold at post
-- "are not features. they should be done always for everyone." This turns
-- scanner_safe_confirm_links ON for everyone (sign-up confirm links a mail scanner cannot spend before the person taps), created 'testers' by
-- 20261025190000_confirm_reminders.sql, which runs first.
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
 WHERE key = 'scanner_safe_confirm_links'
   AND audience IS DISTINCT FROM 'everyone'
   AND NOT EXISTS (
     SELECT 1 FROM public.admin_audit_log a
      WHERE a.action = 'set_feature_switch'
        AND a.target_type = 'feature_switch'
        AND a.target_id = 'scanner_safe_confirm_links');
