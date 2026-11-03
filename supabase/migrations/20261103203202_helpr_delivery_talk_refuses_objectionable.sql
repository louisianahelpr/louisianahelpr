-- NOID-20 (audit finding "Chat small fixes", the Declutter chat safety filter part; verified 11-03 PARTIAL).
-- Declutter has three chats. The handover chat and the order chat refuse objectionable language before contact
-- details (L6, 20261030144615: objectionable_reason, then contact_leak_reason). The Helpr delivery chat
-- (20261031231948, buyer/seller and the delivering Helpr) was added a day later with the contact check only, so a
-- slur or threat to a Helpr went through there while the same words were refused in the other two. This restates
-- its trigger function with the same objectionable check first, word for word as the handover chat's. The trigger
-- itself is unchanged (it already runs this function BEFORE INSERT OR UPDATE OF body).
-- Replay-safe: CREATE OR REPLACE; grants restated as 20261031231948 set them.

CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_helpr_task_talk()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_reason text := public.contact_leak_reason(NEW.body);
BEGIN
  IF public.objectionable_reason(NEW.body) IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'That message breaks our community rules. Please reword it.';
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = v_reason || ' in the message. Keep contact details and payment out of the chat.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_helpr_task_talk() FROM PUBLIC, anon, authenticated;
