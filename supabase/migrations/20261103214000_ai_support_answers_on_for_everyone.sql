-- Turns ai_support_answers ON for everyone. Owner 2026-11-03 ~3:30 PM: "we should integrate ai into there support
-- or help request bc some you can easly answer or claude can", with the owner's standing rule that fixes and
-- features ship on for everyone (relayed by the lead 11-03). The switch is created 'testers' by 20261103212413_ai_support_answers_switch.sql, which runs
-- first (a switch is never born 'everyone'), and stays as the off button in Admin -> Settings.
--
-- Safe for everyone: on /support the ticket is still sent unless the member says the suggested answer helped,
-- and in Admin Support the draft is never sent without the admin pressing Send.
--
-- Going live is otherwise an admin's flip in Admin -> Settings (20261012031120). This is an owner-approved
-- exception, listed by file in src/test/featureSwitchRegistry.test.ts (OWNER_APPROVED_GO_LIVE, exact).
--
-- AUDITED: the UPDATE fires feature_switches_audit_change, which writes the admin_audit_log row
-- (set_feature_switch, {from, to: everyone}) in the same transaction.
--
-- REPLAY-SAFE: it changes the switch only while NO admin_audit_log row exists for it. Its own first run writes
-- one, so a replay changes nothing, and once an admin has set the switch a replay never overrides that choice.
-- Where the switch row is missing the UPDATE matches nothing.

UPDATE public.feature_switches
   SET audience = 'everyone', updated_at = now()
 WHERE key = 'ai_support_answers'
   AND audience IS DISTINCT FROM 'everyone'
   AND NOT EXISTS (
     SELECT 1 FROM public.admin_audit_log a
      WHERE a.action = 'set_feature_switch'
        AND a.target_type = 'feature_switch'
        AND a.target_id = 'ai_support_answers');
