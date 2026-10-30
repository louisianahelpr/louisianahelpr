-- Messages audit E3 (10-30) M1 + M2 + L6 (owner: fix all 13; "admin only on report"), via the lead 09:12.
--
-- Before (prod, read 2026-10-30 with pg_policies / pg_get_functiondef):
--   * policy "Admins can view all messages" (SELECT, authenticated): has_role(auth.uid(), 'admin') — every admin read
--     every member's private chat. storage policy "message-attachments: participants and admins read" let an admin
--     read every attachment the same way (20260914200051).
--   * policy "Users can delete their own sent messages": the sender could delete a message at any time, also after
--     the thread closed, after it was reported and while the job was in dispute; a report kept only the message id,
--     so a deleted message left the admin nothing to read. The attachment could be deleted the same way.
--   * reports: any signed-in member could report any message id, a message they were never part of.
--   * the Declutter handover and order chats refused contact details (reject_contact_leak_in_declutter_talk,
--     reject_contact_leak_in_declutter_order_talk) but not slurs, sexual language or threats (objectionable_reason,
--     which job chat applies through scan_message_content).
--   * an edit (UPDATE OF content) skipped the block check that a new message gets (the ban gate already runs on
--     every UPDATE: trg_ban_gate_messages_update).
--
-- After:
--   1. M1: admins read a message only when it is reported, was hidden by the scanner (flagged_hidden), or is in a
--      "Louisiana Helpr Team" thread (the support conversation staff answer). Same rule for its attachment.
--      Members' own read policy is unchanged.
--   2. M2: a member cannot delete a message (or its attachment) once the job's chat has closed
--      (job_messaging_closes_at in the past), once the message is reported, or once the job has a dispute. Deletes
--      cascading from a job or account deletion and server deletes are unaffected. A message report now keeps a
--      copy of the words (reports.reported_content), taken by the database at the moment of the report.
--   3. L6: a message report is accepted only from the sender or receiver of that message. Declutter chats refuse
--      objectionable language as job chat does. An edit is refused between blocked members, like a new message.
--
-- Restated from prod, each changing only what is said above:
--   reject_contact_leak_in_declutter_talk (md5(prosrc) 403420c1), reject_contact_leak_in_declutter_order_talk
--   (4c174d90), the two storage.objects policies (verbatim from pg_policies). enforce_block_on_message_insert
--   (9d38a237) is NOT changed: it reads only NEW, so it is attached to UPDATE OF content as well.
-- New SECURITY DEFINER functions (no member can execute them; trigger use only): refuse_locked_message_delete,
-- report_message_party_and_copy, message_attachment_locked (also called from the storage policy, so authenticated
-- may execute it; it answers only true/false about a path and reads nothing back).
--
-- REPLAY-SAFE: DROP POLICY IF EXISTS / CREATE POLICY, CREATE OR REPLACE, DROP TRIGGER IF EXISTS / CREATE TRIGGER,
-- ADD COLUMN IF NOT EXISTS. Applied 3x in PGlite (src/test/pglite/messageTrustAdminDeleteReport.pglite.mjs).

-- 1. M1 -------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Admins can view reported or hidden messages" ON public.messages;
CREATE POLICY "Admins can view reported or hidden messages" ON public.messages
  FOR SELECT TO authenticated
  USING (
    public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
    AND (
      COALESCE(flagged_hidden, false)
      OR team_thread_user_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.reports r WHERE r.reported_type = 'message' AND r.reported_id = messages.id)
    )
  );

DROP POLICY IF EXISTS "message-attachments: participants and admins read" ON storage.objects;
CREATE POLICY "message-attachments: participants and admins read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    (bucket_id = 'message-attachments'::text)
    AND (EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.attachment_url = objects.name
         AND (
           (
             ((SELECT auth.uid()) = m.sender_id OR (SELECT auth.uid()) = m.receiver_id)
             AND (
               ((split_part(objects.name, '/'::text, 1) = (m.job_id)::text) AND (split_part(objects.name, '/'::text, 2) = (m.sender_id)::text))
               OR ((split_part(objects.name, '/'::text, 1) = 'voice-notes'::text) AND (split_part(objects.name, '/'::text, 2) = (m.job_id)::text) AND (split_part(objects.name, '/'::text, 3) = (m.sender_id)::text))
             )
           )
           OR (
             public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
             AND (
               COALESCE(m.flagged_hidden, false)
               OR m.team_thread_user_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.reports r WHERE r.reported_type = 'message' AND r.reported_id = m.id)
             )
           )
         )
    ))
  );

-- 2. M2 -------------------------------------------------------------------------------------------------------------
-- Whether a message may no longer be deleted by a member: the job's chat closed, the message reported, or the job
-- disputed. A team-thread row (no job) locks only once reported.
CREATE OR REPLACE FUNCTION public.message_delete_locked(p_message_id uuid, p_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.reports r WHERE r.reported_type = 'message' AND r.reported_id = p_message_id)
      OR (p_job_id IS NOT NULL AND (
            COALESCE(public.job_messaging_closes_at(p_job_id) <= now(), false)
            OR EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = p_job_id)
         ));
$fn$;
REVOKE ALL ON FUNCTION public.message_delete_locked(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.message_delete_locked(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refuse_locked_message_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- A delete cascading from a job or account deletion runs inside the foreign key's own trigger (depth > 1);
  -- an edge function or cron has no member session. Neither is a member taking a message back.
  IF pg_trigger_depth() > 1 OR public.is_server_context() THEN
    RETURN OLD;
  END IF;
  IF public.message_delete_locked(OLD.id, OLD.job_id) THEN
    RAISE EXCEPTION 'message_locked'
      USING ERRCODE = '42501',
            HINT = 'This message can''t be deleted: the conversation has ended or is being reviewed.';
  END IF;
  RETURN OLD;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_locked_message_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_locked_message_delete() TO service_role;

DROP TRIGGER IF EXISTS trg_refuse_locked_message_delete ON public.messages;
CREATE TRIGGER trg_refuse_locked_message_delete
  BEFORE DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.refuse_locked_message_delete();

-- The attachment of a locked message stays too. Called from the storage DELETE policy, so authenticated executes it;
-- it answers true/false about one path and returns nothing else.
CREATE OR REPLACE FUNCTION public.message_attachment_locked(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
     WHERE m.attachment_url = p_name
       AND public.message_delete_locked(m.id, m.job_id)
  );
$fn$;
REVOKE ALL ON FUNCTION public.message_attachment_locked(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_locked(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "message-attachments: sender deletes own" ON storage.objects;
CREATE POLICY "message-attachments: sender deletes own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    (bucket_id = 'message-attachments'::text)
    AND
    CASE
      WHEN ((storage.foldername(name))[1] = 'voice-notes'::text) THEN ((storage.foldername(name))[3] = ((SELECT auth.uid()))::text)
      ELSE ((storage.foldername(name))[2] = ((SELECT auth.uid()))::text)
    END
    AND NOT public.message_attachment_locked(name)
  );

-- The report keeps the words. reported_content is written only by this trigger.
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS reported_content text;
COMMENT ON COLUMN public.reports.reported_content IS
  'Messages audit M2: for a message report, a copy of the message (words and attachment path) taken by the database when the report was filed, so a later delete leaves the admin something to read. NULL for other report types.';

CREATE OR REPLACE FUNCTION public.report_message_party_and_copy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  m public.messages%ROWTYPE;
BEGIN
  IF NEW.reported_type IS DISTINCT FROM 'message' THEN
    NEW.reported_content := NULL;
    RETURN NEW;
  END IF;
  SELECT * INTO m FROM public.messages WHERE id = NEW.reported_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_target_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- L6: only someone in the conversation reports its message.
  IF NOT public.is_server_context()
     AND NEW.reporter_id IS DISTINCT FROM m.sender_id
     AND NEW.reporter_id IS DISTINCT FROM m.receiver_id THEN
    RAISE EXCEPTION 'report_not_allowed' USING ERRCODE = '42501';
  END IF;
  NEW.reported_content := left(concat_ws(E'\n',
    NULLIF(m.content, ''),
    CASE WHEN m.attachment_url IS NOT NULL THEN 'Attachment: ' || m.attachment_url END), 4000);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.report_message_party_and_copy() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_message_party_and_copy() TO service_role;

DROP TRIGGER IF EXISTS trg_report_message_party_and_copy ON public.reports;
CREATE TRIGGER trg_report_message_party_and_copy
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.report_message_party_and_copy();

-- 3. L6 -------------------------------------------------------------------------------------------------------------
-- An edit between blocked members is refused like a new message (the function reads only NEW).
DROP TRIGGER IF EXISTS trg_enforce_block_on_message_edit ON public.messages;
CREATE TRIGGER trg_enforce_block_on_message_edit
  BEFORE UPDATE OF content ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_block_on_message_insert();

-- Declutter chats: objectionable language first, then contact details (as scan_message_content orders them).
CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_declutter_talk()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      MESSAGE = v_reason || ' in the message. Keep contact details and payment out of the chat; agree the handover here.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_contact_leak_in_declutter_order_talk()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_declutter_talk() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_contact_leak_in_declutter_order_talk() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_contact_leak_in_declutter_talk() TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_contact_leak_in_declutter_order_talk() TO service_role;
