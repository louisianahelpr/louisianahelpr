-- A JOB'S STATUS CHANGE NO LONGER FAILS BECAUSE SOMEONE IN ITS THREAD IS BLOCKED (Q713).
--
-- insert_job_status_system_message (AFTER UPDATE OF status ON jobs, SECURITY
-- DEFINER) posts one system message per participant of the job's threads,
-- with sender_id = the poster. trg_enforce_block_on_message_insert (BEFORE
-- INSERT ON messages) raises "You can't message this user." when sender and
-- receiver are blocked, and it does not step aside here: inside a client's
-- request auth.uid() is set, so is_server_context() is false even though the
-- insert runs as the definer. One blocked participant therefore aborted the
-- WHOLE status change (accept, start, complete, cancel, dispute) for whoever
-- made it, with an error about messaging that the caller never asked to do.
-- Found by the lh-authz-rls review of PR #1820 (2026-09-26); live 2026-10-03:
-- 3 blocks, 0 of them between a poster and a participant of that poster's job
-- threads, so no stuck job today.
--
-- THE FIX: skip the blocked participant. The filter is the block trigger's own
-- predicate, public.are_users_blocked(sender, receiver), tested IS NOT TRUE,
-- so every row this INSERT still writes is one the block trigger lets through
-- (inside a trigger are_users_blocked always computes: pg_trigger_depth() > 0),
-- and a blocked participant gets no message, which is what the block means.
-- The block trigger itself is unchanged (it still refuses a person messaging
-- someone they blocked or are blocked by).
--
-- The body is the live one (pg_get_functiondef 2026-10-03, last defined by
-- 20260924013306) plus that one predicate.
-- REPLAY-SAFE: CREATE OR REPLACE; are_users_blocked predates this file
-- (20260926034721), and the function body resolves it at call time.
-- Proof: src/test/pglite/statusMessageSkipsBlocked.pglite.mjs (applied 3x;
-- NEW_MIGRATION=skip is red). Class guard:
-- src/test/serverMessageInsertsSkipBlocked.test.ts.

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
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- A trigger function: the trigger machinery runs it, no role calls it. The
-- live ACL is postgres + service_role only; restated so a replay matches.
REVOKE ALL ON FUNCTION public.insert_job_status_system_message() FROM PUBLIC, anon, authenticated;
