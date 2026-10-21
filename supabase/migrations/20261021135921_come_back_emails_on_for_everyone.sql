-- Q2299 (owner, 2026-10-21, issue #3498): turn the come-back emails ON for
-- everyone, as written, signed "Lexi, Founder, Louisiana Helpr"
-- (supabase/functions/_shared/comeBackEmail.ts FOUNDER_NAME and the
-- template's sign-off). The owner's answer came through the lead, who asked
-- for the flip as a migration so it is reviewed and on record in git, not a
-- hand write to the database.
--
-- Going live is otherwise an admin's flip in Admin -> Settings (20261012031120).
-- This is the one owner-approved exception, listed by file in
-- src/test/featureSwitchRegistry.test.ts (OWNER_APPROVED_GO_LIVE, exact).
--
-- AUDITED: the UPDATE fires feature_switches_audit_change, which writes the
-- admin_audit_log row (set_feature_switch, {from, to: everyone}, admin_id
-- NULL for a server context) in the same transaction.
--
-- WHO IS MAILED once it is on is decided per member inside
-- claim_come_back_emails (20261021113827, consent rule restated by
-- 20261021135832): the sign-up box, no explicit Promotions-off, Email master
-- on, not unsubscribed or suppressed, never came back, day 3-10 / day 10-17.
--
-- REPLAY-SAFE: it changes the switch only while NO admin_audit_log row exists
-- for it. Its own first run writes one, so a replay changes nothing, and once
-- an admin has set the switch (on, testers or off) a replay never overrides
-- that choice. The switch row is created by 20261021113827, which runs first;
-- where it is missing the UPDATE matches nothing.

UPDATE public.feature_switches
   SET audience = 'everyone', updated_at = now()
 WHERE key = 'come_back_emails'
   AND audience IS DISTINCT FROM 'everyone'
   AND NOT EXISTS (
     SELECT 1 FROM public.admin_audit_log a
      WHERE a.action = 'set_feature_switch'
        AND a.target_type = 'feature_switch'
        AND a.target_id = 'come_back_emails');
