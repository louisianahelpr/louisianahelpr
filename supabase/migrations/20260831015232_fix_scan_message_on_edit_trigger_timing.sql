-- Fix: the edit-time moderation re-scan trigger from 20260831003117 was
-- created AFTER UPDATE, so its `NEW.flagged_hidden := true` mutation was
-- silently discarded — an edited message that trips the content scan never
-- actually got hidden. This is the exact class of bug
-- 20260819060000_security_authz_hardening.sql's §5 already fixed once for
-- the INSERT-time trigger ("The BEFORE trigger is the one to keep: it can
-- block the insert"); the same fix was missed when the edit trigger was
-- added. scan_message_content() still writes a fraud_flags row and sends
-- the warning/suspension notification correctly either way (those are
-- explicit INSERT/UPDATE statements inside the function, unaffected by
-- trigger timing) — only the in-place NEW.flagged_hidden/flag_reason writes
-- on the edited row were lost.

DROP TRIGGER IF EXISTS scan_message_on_edit ON public.messages;
CREATE TRIGGER scan_message_on_edit
  BEFORE UPDATE OF content ON public.messages
  FOR EACH ROW
  WHEN (OLD.content IS DISTINCT FROM NEW.content)
  EXECUTE FUNCTION public.scan_message_content();
