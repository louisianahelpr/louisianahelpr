-- The "Louisiana Helpr Team" thread: an admin messages one user directly, from
-- the admin User Profile dialog, and the user can reply (owner, 2026-10-09:
-- "add a option for admin to message directly from here"; chose TWO-WAY).
--
-- Messages were strictly job-scoped (messages.job_id NOT NULL, FK jobs). A
-- team-thread row has NO job: job_id IS NULL and team_thread_user_id names the
-- user whose thread it is. A row is exactly one of the two (CHECK below).
--
-- WHO MAY WRITE ONE. Nobody by direct INSERT: the INSERT policy's
-- can_send_message_in_job(NULL) is false, and the client has no INSERT grant
-- on team_thread_user_id. Only these two SECURITY DEFINER functions write them:
--   admin_send_team_message(p_user_id, p_content, p_client_id)
--     caller must hold the admin role; sender = caller, receiver = p_user_id.
--   send_team_reply(p_content, p_client_id)
--     the thread is ALWAYS the caller's own (team_thread_user_id = auth.uid());
--     there is no thread parameter to forge. Allowed only once an admin has
--     written in it; receiver = the admin who wrote last (still an admin).
-- WHO MAY READ ONE. Unchanged policies: "Users can view their own messages"
-- (sender or receiver), which on a team row is always the thread's user or the
-- admin on that row, and "Admins can view all messages". User B is never the
-- sender or receiver of a row in user A's thread.
--
-- Every BEFORE/AFTER trigger on messages still runs on these rows (rate cap,
-- ban gate, block gate, unconfirmed-email gate, reply validator, notify). Four
-- are redefined below from their live bodies (pg_get_functiondef, 2026-10-09):
--   scan_message_content       skips team rows: a phone number or email in a
--                              support conversation is not off-platform
--                              dealing, and a hit here would strike the admin.
--   notify_message_recipient   team rows link to /messages?teamThread=<user>
--                              and, from an admin, are titled "Louisiana Helpr
--                              Team" rather than the admin's own name.
--   mark_message_notifications_read  clears that link too.
--   enforce_message_non_sender_read_only  also freezes team_thread_user_id.
-- Replay-safe: IF NOT EXISTS / constraint guards / CREATE OR REPLACE.

-- 1. Shape ------------------------------------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS team_thread_user_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND conname = 'messages_team_thread_user_id_fkey'
  ) THEN
    -- The thread goes with its user: account deletion removes it whole.
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_team_thread_user_id_fkey
      FOREIGN KEY (team_thread_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.messages'::regclass
      AND conname = 'messages_job_xor_team_thread'
  ) THEN
    -- Added BEFORE job_id loses NOT NULL, so no job-less row can ever exist
    -- without a team thread.
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_job_xor_team_thread
      CHECK ((job_id IS NULL) <> (team_thread_user_id IS NULL));
  END IF;
END
$do$;

ALTER TABLE public.messages ALTER COLUMN job_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS messages_team_thread_idx
  ON public.messages (team_thread_user_id, created_at DESC)
  WHERE team_thread_user_id IS NOT NULL;

-- Readable like every other column (the client selects `*`), never writable:
-- no INSERT or UPDATE grant on it.
GRANT SELECT (team_thread_user_id) ON public.messages TO authenticated;

-- 2. Triggers ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_message_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
BEGIN
  -- Team thread (support conversation with Louisiana Helpr staff): never
  -- scanned. Sharing a phone number with the team is not off-platform dealing.
  IF NEW.team_thread_user_id IS NOT NULL THEN
    NEW.flagged_hidden := false;
    NEW.flag_reason := NULL;
    RETURN NEW;
  END IF;
  v_reason := public.contact_leak_reason(NEW.content);
  IF v_reason IS NOT NULL THEN
    NEW.flagged_hidden := true;
    NEW.flag_reason := v_reason;
  ELSE
    NEW.flagged_hidden := false;
    NEW.flag_reason := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_message_recipient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  sender_name text;
  sender_short text;
  preview text;
  preview_full text;
BEGIN
  -- Skip self-sends (RLS blocks them but defense-in-depth)
  IF NEW.sender_id IS NULL OR NEW.receiver_id IS NULL OR NEW.sender_id = NEW.receiver_id THEN
    RETURN NEW;
  END IF;

  -- Skip messages flagged as hidden by scan_message_content (the off-
  -- platform-content scanner already created a fraud_flag for the
  -- sender; the recipient never sees these in their UI).
  IF NEW.flagged_hidden = true THEN
    RETURN NEW;
  END IF;

  -- Look up sender's name (NULL-safe fallback to "Someone")
  SELECT COALESCE(NULLIF(TRIM(full_name), ''), 'Someone')
    INTO sender_name
    FROM public.profiles
    WHERE user_id = NEW.sender_id;
  sender_name := COALESCE(sender_name, 'Someone');

  -- "First L." privacy convention (matches src/lib/utils.ts formatName)
  IF position(' ' IN sender_name) > 0 THEN
    sender_short := split_part(sender_name, ' ', 1)
      || ' ' || left(split_part(sender_name, ' ', array_length(string_to_array(sender_name, ' '), 1)), 1)
      || '.';
  ELSE
    sender_short := sender_name;
  END IF;

  -- Team thread: the staff side speaks as the team, never as one admin.
  IF NEW.team_thread_user_id IS NOT NULL AND NEW.sender_id <> NEW.team_thread_user_id THEN
    sender_short := 'Louisiana Helpr Team';
  END IF;

  -- Build preview. Attachment-only → "📎 Attachment"; text → first 80
  -- chars + ellipsis if longer.
  preview_full := COALESCE(NEW.content, '');
  IF length(trim(preview_full)) = 0 AND NEW.attachment_url IS NOT NULL THEN
    preview := '📎 Attachment';
  ELSE
    IF length(preview_full) > 80 THEN
      preview := left(preview_full, 80) || '…';
    ELSE
      preview := preview_full;
    END IF;
  END IF;

  -- Skip empty messages with no attachment (defensive)
  IF length(trim(preview)) = 0 THEN
    RETURN NEW;
  END IF;

  -- IMPORTANT: link param is `jobId` (camelCase), matching
  -- searchParams.get("jobId") in src/pages/Messages.tsx. Earlier
  -- version used `job=` and broke deep-link auto-open.
  INSERT INTO public.notifications (user_id, title, message, type, link, read)
  VALUES (
    NEW.receiver_id,
    sender_short,
    preview,
    'message',
    -- BOTH params. `jobId` stays camelCase to match searchParams.get("jobId");
    -- `userId` is the SENDER, who is the "other user" from the recipient's
    -- point of view. The client required both before it would auto-open a
    -- thread, so a jobId-only link always landed on the inbox instead.
    -- A team-thread row has no job: `teamThread=<the thread's user>` instead,
    -- still carrying `userId=<sender>` so the seed boundary can see the actor.
    CASE
      WHEN NEW.team_thread_user_id IS NOT NULL THEN
        '/messages?teamThread=' || NEW.team_thread_user_id::text
          || '&userId=' || COALESCE(NEW.sender_id::text, '')
      ELSE
        '/messages?jobId=' || COALESCE(NEW.job_id::text, '')
          || '&userId=' || COALESCE(NEW.sender_id::text, '')
    END,
    false
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_message_notifications_read()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_server_context() AND auth.uid() IS DISTINCT FROM NEW.receiver_id THEN
    RETURN NULL;
  END IF;
  UPDATE public.notifications n
     SET read = true
   WHERE n.user_id = NEW.receiver_id
     AND n.type = 'message'
     AND n.read = false
     AND (
       n.link = '/messages?jobId=' || COALESCE(NEW.job_id::text, '') || '&userId=' || COALESCE(NEW.sender_id::text, '')
       OR (NEW.job_id IS NOT NULL AND n.link = '/messages?jobId=' || NEW.job_id::text)
       OR (NEW.team_thread_user_id IS NOT NULL
           AND n.link = '/messages?teamThread=' || NEW.team_thread_user_id::text
                        || '&userId=' || COALESCE(NEW.sender_id::text, ''))
     );
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_message_non_sender_read_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Service role / cron / edge functions: not a user write. anon is.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Q1242: the reply_to_id self-FK is ON DELETE SET NULL, and that cascade
  -- UPDATEs the reply while the DELETER's request is still in place, so it
  -- arrived here as a non-sender's write and failed the whole DELETE ("a
  -- message may only be edited by the person who sent it"): nobody could
  -- delete a message the other party had replied to. Let exactly the FK's own
  -- action through: inside another trigger (the RI action, pg_trigger_depth()
  -- > 1), reply_to_id going to NULL, the message it named already gone, and
  -- not one other column changed. A client's own PATCH of reply_to_id is
  -- depth 1 and still refused below.
  IF pg_trigger_depth() > 1
     AND OLD.reply_to_id IS NOT NULL
     AND NEW.reply_to_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.messages p WHERE p.id = OLD.reply_to_id)
     AND (to_jsonb(NEW) - 'reply_to_id') = (to_jsonb(OLD) - 'reply_to_id')
  THEN
    RETURN NEW;
  END IF;

  -- The sender's own edit is governed by the 15-minute window in the edit
  -- policy, which is where that rule belongs. The read receipt is not the
  -- sender's (Q1166): read / read_at belong to the receiver, so a sender's
  -- change to them is IGNORED, not refused (a mark-read statement that also
  -- matches a row the caller sent must not fail as a whole).
  IF auth.uid() = OLD.sender_id THEN
    NEW.read    := OLD.read;
    NEW.read_at := OLD.read_at;
    RETURN NEW;
  END IF;

  IF NEW.content              IS DISTINCT FROM OLD.content
  OR NEW.edited_at            IS DISTINCT FROM OLD.edited_at
  OR NEW.id                   IS DISTINCT FROM OLD.id
  OR NEW.job_id               IS DISTINCT FROM OLD.job_id
  OR NEW.team_thread_user_id  IS DISTINCT FROM OLD.team_thread_user_id
  OR NEW.sender_id            IS DISTINCT FROM OLD.sender_id
  OR NEW.receiver_id          IS DISTINCT FROM OLD.receiver_id
  OR NEW.created_at           IS DISTINCT FROM OLD.created_at
  OR NEW.is_system            IS DISTINCT FROM OLD.is_system
  OR NEW.reply_to_id          IS DISTINCT FROM OLD.reply_to_id
  OR NEW.attachment_url       IS DISTINCT FROM OLD.attachment_url
  OR NEW.attachment_mime      IS DISTINCT FROM OLD.attachment_mime
  OR NEW.attachment_size      IS DISTINCT FROM OLD.attachment_size
  OR NEW.attachment_duration  IS DISTINCT FROM OLD.attachment_duration
  THEN
    RAISE EXCEPTION 'a message may only be edited by the person who sent it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

-- Trigger functions: never callable by a client (live proacl restated).
REVOKE ALL ON FUNCTION public.scan_message_content() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_message_recipient() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_message_notifications_read() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_message_non_sender_read_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_message_content() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_message_recipient() TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_message_notifications_read() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_message_non_sender_read_only() TO service_role;

-- get_my_reply_latency is NOT restated: its turn join is
-- `theirs.job_id = mine.job_id`, and NULL = NULL is never true, so team rows
-- (job_id NULL) already yield no reply-time observation (proved in PGlite
-- against the live body, 2026-10-09).

-- 3. The two writers --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_send_team_message(
  p_user_id uuid,
  p_content text,
  p_client_id uuid DEFAULT NULL
)
 RETURNS public.messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_admin   uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_row     public.messages;
BEGIN
  -- has_role(NULL, ...) is false, so an anonymous caller lands here too.
  IF NOT COALESCE(public.has_role(v_admin, 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_user_id = v_admin THEN
    RAISE EXCEPTION 'cannot_message_self' USING ERRCODE = '22023';
  END IF;
  IF v_content = '' THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = '22001';
  END IF;

  INSERT INTO public.messages (job_id, team_thread_user_id, sender_id, receiver_id, content, client_id)
  VALUES (NULL, p_user_id, v_admin, p_user_id, v_content, p_client_id)
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (v_admin, 'team_message_sent', p_user_id::text, 'user',
          jsonb_build_object('message_id', v_row.id));

  RETURN v_row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.send_team_reply(
  p_content text,
  p_client_id uuid DEFAULT NULL
)
 RETURNS public.messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_me      uuid := auth.uid();
  v_content text := btrim(COALESCE(p_content, ''));
  v_admin   uuid;
  v_row     public.messages;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_content = '' THEN
    RAISE EXCEPTION 'empty_message' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_content) > 4000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = '22001';
  END IF;

  -- The caller's OWN thread only, and only once staff opened it: the reply
  -- goes to the admin who wrote last there and still holds the role.
  SELECT m.sender_id INTO v_admin
    FROM public.messages m
   WHERE m.team_thread_user_id = v_me
     AND m.sender_id <> v_me
     AND COALESCE(public.has_role(m.sender_id, 'admin'::public.app_role), false)
   ORDER BY m.created_at DESC
   LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'no_team_thread' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.messages (job_id, team_thread_user_id, sender_id, receiver_id, content, client_id)
  VALUES (NULL, v_me, v_me, v_admin, v_content, p_client_id)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_send_team_message(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_team_reply(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_team_message(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_team_reply(text, uuid) TO authenticated, service_role;

COMMENT ON COLUMN public.messages.team_thread_user_id IS
  'Set (with job_id NULL) on a "Louisiana Helpr Team" thread row: the user whose support thread it is. Written only by admin_send_team_message / send_team_reply.';
