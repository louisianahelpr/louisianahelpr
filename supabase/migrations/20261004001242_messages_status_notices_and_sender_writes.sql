-- MESSAGES: A STATUS NOTICE NO LONGER TRIPS THE POSTER'S SEND LIMIT (Q1169); A
-- SENDER CAN NO LONGER SET THEIR OWN READ RECEIPT OR EDITED STAMP (Q1166); A
-- POSTER CAN NO LONGER DELETE THE PLATFORM'S NOTICES (Q1167).
--
-- All three were found by the lh-authz-rls reviews of Q340 and Q713
-- (2026-10-03) and are pre-existing. Live state read 2026-10-03 (SELECT-only):
-- Q340 is live (authenticated holds no INSERT on is_system, created_at, read,
-- read_at, edited_at or id: has_column_privilege false for each), and every
-- function restated below matched its newest migration body exactly
-- (md5(prosrc): enforce_message_rate aa9fc92254824c20cb1a434624bbf0c5,
-- can_send_message_to_in_job adde58ba323ddb81f0cb78d59972c7d7,
-- insert_job_status_system_message d2e0b47244387473bd586cb602e20841,
-- enforce_message_non_sender_read_only f1f3ba25dc78c046ca7266bc52c124c2).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Q1169 HIGH: the send limit counted the platform's notices as the poster's
-- ═══════════════════════════════════════════════════════════════════════════
-- insert_job_status_system_message (AFTER UPDATE OF status ON jobs, SECURITY
-- DEFINER) posts "Work started", "Job completed", "Job cancelled", ... from the
-- poster to every participant of the job's threads, inside the status UPDATE.
-- enforce_message_rate (BEFORE INSERT ON messages) counted every row the poster
-- "sent" in the last hour, notices included and the same statement's earlier
-- rows included, against its cap of 30. So:
--   * a job whose threads hold 31+ participants could never change status
--     again: the 31st notice raised "You are sending messages too quickly" and
--     aborted the Helpr's start, the poster's cancel, the completion and the
--     service role's own sweeps alike;
--   * a poster with 30 messages in the last hour blocked the Helpr's completion;
--   * at 29, the notice itself wrote a message_flooding fraud flag against them;
--   * and the notices kept counting afterwards, so after a big fan-out the
--     poster could not send anyone a message for an hour. The INSERT policy's
--     own copy of the count (can_send_message_to_in_job) refused it first.
--
-- THE FIX. enforce_message_rate steps aside for a platform notice written from
-- inside another trigger (`NEW.is_system AND pg_trigger_depth() > 1`), and both
-- counts (the trigger's and the INSERT policy's wrapper, which says it uses "the
-- same source, window and cap") count only the sender's own rows
-- (`NOT is_system`). The cap, the window, the message and the fraud flag are
-- unchanged for anything a person writes.
--
-- DOES THE EXEMPTION OPEN A HOLE? Checked live 2026-10-03, not assumed:
--   * a client cannot write is_system on INSERT (Q340, 20261003182009: no
--     column grant), and the edit policy refuses is_system rows, so no client
--     row is ever a notice;
--   * the only function in any schema that INSERTs INTO messages is
--     insert_job_status_system_message (pg_proc scan of prosrc), and its only
--     trigger is jobs AFTER UPDATE OF status; no view, rule or INSTEAD OF
--     trigger writes messages; no edge function writes messages;
--   * a client's own insert, direct or through an RPC, reaches this trigger at
--     depth 1, so a notice-shaped row from an RPC would still be counted, and a
--     non-notice row written by some other trigger still is. Requiring BOTH
--     halves (is_system AND depth > 1) keeps the exemption to exactly the
--     server's notices.
--
-- THE NOTICE NEEDS ITS OWN BRAKE (lh-authz-rls review of this change,
-- 2026-10-03). The send limit was the only bound on how many notices a job's
-- status moves send, and nothing else bounds it: rpc_open_dispute and
-- rpc_withdraw_dispute (both EXECUTE-able by authenticated, read live) flip a
-- job between in_progress and disputed as often as a party likes, every move
-- notifies every participant, each notice writes a type 'message'
-- notification (suppress_exact_duplicate_notification exempts that type) and
-- fan_out_push_on_notification pushes it with no throttle. So
-- insert_job_status_system_message (1c below) skips a participant whose
-- latest notice on this job already says the same thing, or who got 6
-- notices on this job in the last 10 minutes: a dispute loop sends each
-- participant at most 6 notices per 10 minutes, a real move back
-- (in_progress -> disputed -> in_progress) is still announced, and the status
-- change itself always goes through. (A first version skipped any repeat of
-- the same text within 10 minutes; the lh-authz-rls re-review showed that
-- drops the move back, leaving the thread at "Dispute opened" on a job that
-- is in progress again.) Not braked here: what each dispute filing does
-- outside the thread (a disputes row, an ops page, notifications), filed as
-- its own item.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Q1166 MEDIUM: the sender's UPDATE path could set the receiver's receipt
-- ═══════════════════════════════════════════════════════════════════════════
-- "Users can edit their own sent messages" lets the sender UPDATE for 15
-- minutes, and authenticated held column UPDATE on content, read AND
-- edited_at. So the sender could PATCH {read: true} on their own message
-- (trg_stamp_message_read_at then stamped read_at), and the receiver's unread
-- badge (useNavUnreadCount: receiver_id = me AND read = false) stopped counting
-- it; and trg_stamp_message_edited_at was BEFORE UPDATE OF content, so a PATCH
-- of edited_at alone kept NULL (the "edited" mark erased after an edit) or any
-- date. No client in any ref ever sent either (client update payloads: {read},
-- {content}; read off the AST by the write-contract extractor).
--
-- THE FIX.
--   * enforce_message_non_sender_read_only: the sender's branch keeps OLD.read
--     and OLD.read_at. Ignored, not refused: a mark-read statement that also
--     matches a row the caller sent must not fail as a whole (every client
--     mark-read filters receiver_id = me today).
--   * authenticated may UPDATE exactly content (the sender's edit) and read (the
--     receiver's receipt): REVOKE UPDATE table-wide, which also clears every
--     column UPDATE grant, then GRANT the two back. Same shape as Q340's INSERT.
--   * trg_stamp_message_edited_at fires on EVERY UPDATE (no column list). Its
--     function already keeps OLD.edited_at unless content changed, so the stamp
--     holds even if a column grant ever comes back.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Q1167 LOW: a poster could delete the platform's notices on their job
-- ═══════════════════════════════════════════════════════════════════════════
-- The notices are written with sender_id = the poster, and "Users can delete
-- their own sent messages" was USING (auth.uid() = sender_id), so the poster
-- could remove "Dispute opened" or "Job cancelled" from both parties' threads
-- (live 2026-10-03: 0 notice rows). The policy now also requires
-- is_system = false, the same test the edit policy already makes. The account
-- purge (purge_user_data, SECURITY DEFINER as the table owner) is not subject
-- to the policy and still removes a deleted account's rows.
--
-- REPLAY-SAFE: CREATE OR REPLACE for the plpgsql trigger functions (bodies are
-- not resolved at create); the SQL wrapper, the grants, the trigger and the
-- policy run only when what they read exists. GRANT/REVOKE name roles (FROM
-- PUBLIC, anon). Proofs (PGlite, live bodies, applied 3x; NEW_MIGRATION=skip is
-- red): src/test/pglite/messageRateSparesStatusNotices.pglite.mjs (Q1169),
-- src/test/pglite/messageReadReceiptIsTheReceivers.pglite.mjs (Q1166),
-- src/test/pglite/systemNoticesOutliveTheirSender.pglite.mjs (Q1167). Guards:
-- src/test/serverMessageInsertsSkipBlocked.test.ts (every INSERT trigger on
-- messages that can RAISE is cleared for the server's notices; the two counts
-- agree), scripts/ci/client-insert-columns.sql and
-- src/test/messagesInsertColumnsClientScoped.test.ts (authenticated UPDATEs
-- exactly content and read), src/test/messagesWriteOwnership.test.ts (who owns
-- each client-writable column; sender write policies never reach a notice).

-- ───────────────────────────────────────────────────────────────────────────
-- 1a. Q1169: the trigger. Live body (20260907231710) + the exemption + NOT is_system.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_message_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  msg_count integer;
  v_cap     constant integer := 30;
BEGIN
  -- Q1169: a platform notice is not its sender's message. Its only writer is
  -- insert_job_status_system_message, an AFTER UPDATE OF status trigger on
  -- jobs, so it always reaches here from inside another trigger. A client
  -- cannot write is_system (no column grant), and a person's own insert, direct
  -- or through an RPC, arrives at depth 1: both halves are required.
  IF NEW.is_system AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO msg_count
  FROM public.messages
  WHERE sender_id = NEW.sender_id
    AND NOT is_system
    AND created_at > now() - interval '1 hour';

  IF msg_count >= v_cap THEN
    RAISE EXCEPTION 'You are sending messages too quickly. Please slow down.';
  END IF;

  IF msg_count + 1 >= v_cap THEN
    BEGIN
      INSERT INTO public.fraud_flags (user_id, flag_type, details)
      SELECT NEW.sender_id, 'message_flooding',
             format('User sent %s messages in 1 hour, reaching the flood threshold.', v_cap)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.fraud_flags f
        WHERE f.user_id = NEW.sender_id
          AND f.flag_type = 'message_flooding'
          AND f.resolved = false
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enforce_message_rate: fraud flag failed for %: %',
        NEW.sender_id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_message_rate() FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 1b. Q1169: the INSERT policy's copy of the count. Live body (20260925230845)
--     + NOT m.is_system. A SQL body is resolved at create, so it runs only when
--     everything it reads exists.
-- ───────────────────────────────────────────────────────────────────────────
DO $q1169$
BEGIN
  IF to_regclass('public.jobs') IS NULL
     OR to_regclass('public.messages') IS NULL
     OR to_regclass('public.group_job_helpers') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regprocedure('public.can_message_in_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_off_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_caller_banned()') IS NULL
     OR to_regprocedure('public.are_users_blocked(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'messages'
                       AND column_name = 'is_system') THEN
    RAISE NOTICE 'messages_status_notices_and_sender_writes: messaging gate prerequisites missing, wrapper left as is';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.can_send_message_to_in_job(_job_id uuid, _receiver uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The caller is auth.uid(), never a parameter. Only a caller who may post in
  -- this job, is not blocked with _receiver and is under the send rate cap
  -- learns anything about its parties; everyone else gets false.
  SELECT auth.uid() IS NOT NULL
     AND NOT public.is_caller_banned()
     AND public.can_message_in_job(_job_id, auth.uid())
     -- Owner decision 2026-09-25 (Q407 addendum 14): once someone is off the
     -- job (rejected applicant, removed crew member, declined or expired
     -- offeree) nobody may start a new message TO them on it either.
     AND NOT public.is_off_job(_job_id, _receiver)
     -- trg_enforce_block_on_message_insert: the same function, either direction.
     AND NOT public.are_users_blocked(auth.uid(), _receiver)
     -- enforce_message_rate: the same source, window and cap (count >= 30 in
     -- the last hour refuses the next send), counting only the caller's OWN
     -- messages: a platform notice sent in their name is not theirs (Q1169).
     AND (SELECT count(*) FROM public.messages m
           WHERE m.sender_id = auth.uid()
             AND NOT m.is_system
             AND m.created_at > now() - interval '1 hour') < 30
     AND (
       -- The poster: reachable by anyone who may post in the job, including an
       -- applicant the poster messaged or the offered Helpr (NULL-safe for an
       -- ownerless job).
       EXISTS (
         SELECT 1 FROM public.jobs j
         WHERE j.id = _job_id AND j.customer_id = _receiver
       )
       -- The HIRED Helpr or a roster member: reachable only by a caller who is
       -- itself the poster, the hired Helpr or on the roster. Never by a caller
       -- who is merely a messaged applicant or the offered Helpr.
       OR (
         (
           EXISTS (
             SELECT 1 FROM public.jobs j
             WHERE j.id = _job_id AND j.helper_id = _receiver
           )
           OR EXISTS (
             SELECT 1 FROM public.group_job_helpers g
             WHERE g.job_id = _job_id AND g.helper_id = _receiver
           )
         )
         AND (
           EXISTS (
             SELECT 1 FROM public.jobs j
             WHERE j.id = _job_id
               AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
           )
           OR EXISTS (
             SELECT 1 FROM public.group_job_helpers g
             WHERE g.job_id = _job_id AND g.helper_id = auth.uid()
           )
         )
       )
       -- The OFFERED Helpr or an applicant, and ONLY when the caller is the
       -- job's poster (owner decisions 2026-09-14). An ownerless job
       -- (customer_id NULL) matches nobody here.
       OR (
         EXISTS (
           SELECT 1 FROM public.jobs j
           WHERE j.id = _job_id AND j.customer_id = auth.uid()
         )
         AND (
           EXISTS (
             SELECT 1 FROM public.jobs j
             WHERE j.id = _job_id AND j.offered_to_helper_id = _receiver
           )
           OR EXISTS (
             SELECT 1 FROM public.applications a
             WHERE a.job_id = _job_id AND a.helper_id = _receiver
           )
         )
       )
     );
$function$
$fn$;

  REVOKE ALL ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) TO authenticated, service_role;
END
$q1169$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1c. Q1169: the notice's own brake. Live body (20261003183349, md5
--     d2e0b47244387473bd586cb602e20841) + two predicates per participant: the
--     latest notice on this job is not already this one, and fewer than 6
--     notices on this job in the last 10 minutes.
--     idx_messages_job_id_created (job_id, created_at DESC) serves both.
--     Two moves inside ONE transaction share now(), so (a) cannot order their
--     notices (not measured whether any code path makes two such moves).
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.insert_job_status_system_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
BEGIN
  -- Only fire on meaningful status transitions
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  -- Q262: an ownerless job (poster deleted, customer_id SET NULL) has nobody
  -- to attribute the row to, and messages.sender_id is NOT NULL.
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- Compare on ::text so an unknown label degrades to NULL (no message)
  -- instead of raising an enum-cast error that would abort the transition.
  v_content := CASE NEW.status::text
    WHEN 'accepted'    THEN '✓ Job awarded'
    WHEN 'in_progress' THEN '▶ Work started'
    WHEN 'completed'   THEN '✓ Job completed'
    WHEN 'cancelled'   THEN '✕ Job cancelled'
    WHEN 'disputed'    THEN '⚠ Dispute opened'
    ELSE NULL
  END;

  IF v_content IS NULL THEN RETURN NEW; END IF;

  -- Insert one system message per unique participant in this job's threads.
  -- `sender_id = NEW.customer_id` (poster) satisfies the NOT NULL
  -- constraint on the column; `is_system=true` is what marks the row as
  -- system-generated in the UI, so poster-attribution here is a semantic
  -- no-op — both parties see the same system-styled row.
  -- Q262: a participant is NULL when that account was deleted
  -- (messages_receiver_id_fkey ON DELETE SET NULL); nobody to tell.
  -- Q713: a participant blocked with the poster (either direction) is
  -- skipped, with the block trigger's own predicate: otherwise its RAISE
  -- aborts the status change itself.
  -- Q1169: the send limit no longer counts notices, and a party can flip a
  -- job in_progress <-> disputed at will, so the notice brakes itself (and the
  -- notification and push each one fires). A participant is skipped when
  -- (a) their LATEST notice on this job already says this (nothing changed for
  -- them), or (b) they got 6 notices on this job in the last 10 minutes (an
  -- alternating loop). A real move back (X -> Y -> X) is still told: (a) looks
  -- at the latest notice, not at any recent one.
  -- "Latest" orders by created_at, the inserting transaction's start time. Every
  -- status RPC locks the jobs row FOR UPDATE first, so two moves on one job
  -- commit in the order they started (round-3 review, note 3).
  INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
  SELECT DISTINCT
    NEW.id,
    NEW.customer_id,
    p.participant,
    v_content,
    false,
    true
  FROM (
    SELECT CASE WHEN m.sender_id = NEW.customer_id THEN m.receiver_id ELSE m.sender_id END AS participant
    FROM messages m
    WHERE m.job_id = NEW.id
      AND m.is_system = false
      AND m.sender_id IS NOT NULL
  ) p
  WHERE p.participant IS NOT NULL
    AND public.are_users_blocked(NEW.customer_id, p.participant) IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT d.content FROM messages d
        WHERE d.job_id = NEW.id
          AND d.is_system
          AND d.receiver_id = p.participant
        ORDER BY d.created_at DESC
        LIMIT 1
      ) last
      WHERE last.content = v_content
    )
    AND (
      -- A final state is never capped (round-3 review): cancelled has no way
      -- out and completed only leaves through an admin, so neither can loop,
      -- and a capped one would leave the thread showing a live job.
      NEW.status::text IN ('cancelled', 'completed')
      OR (
        SELECT count(*) FROM messages d
        WHERE d.job_id = NEW.id
          AND d.is_system
          AND d.receiver_id = p.participant
          AND d.created_at > now() - interval '10 minutes'
      ) < 6
    )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.insert_job_status_system_message() FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2a. Q1166: the receipt is the receiver's. Live body (20260915101102) + the
--     sender's branch keeps OLD.read / OLD.read_at.
-- ───────────────────────────────────────────────────────────────────────────
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

REVOKE ALL ON FUNCTION public.enforce_message_non_sender_read_only() FROM PUBLIC, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 2b. Q1166: authenticated UPDATEs exactly content and read; the edited stamp
--     fires on every UPDATE.
-- ───────────────────────────────────────────────────────────────────────────
DO $q1166$
DECLARE
  v_cols int;
BEGIN
  IF to_regclass('public.messages') IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'messages'
     AND column_name IN ('content', 'read');
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'messages_status_notices_and_sender_writes: expected content and read on public.messages, found % of 2', v_cols;
  END IF;

  -- A table-level REVOKE also clears every column UPDATE grant (edited_at with
  -- them); the two client columns are granted back.
  REVOKE UPDATE ON public.messages FROM PUBLIC, anon, authenticated;
  GRANT UPDATE (content, read) ON public.messages TO authenticated;

  IF to_regprocedure('public.stamp_message_edited_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_stamp_message_edited_at ON public.messages;
    CREATE TRIGGER trg_stamp_message_edited_at
      BEFORE UPDATE ON public.messages
      FOR EACH ROW EXECUTE FUNCTION public.stamp_message_edited_at();
  END IF;
END
$q1166$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Q1167: the sender's DELETE never reaches a platform notice.
-- ───────────────────────────────────────────────────────────────────────────
DO $q1167$
BEGIN
  IF to_regclass('public.messages') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'messages'
                       AND column_name = 'is_system') THEN
    RETURN;
  END IF;
  DROP POLICY IF EXISTS "Users can delete their own sent messages" ON public.messages;
  CREATE POLICY "Users can delete their own sent messages" ON public.messages
    FOR DELETE TO authenticated
    USING (((SELECT auth.uid()) = sender_id) AND (is_system = false));
END
$q1167$;
