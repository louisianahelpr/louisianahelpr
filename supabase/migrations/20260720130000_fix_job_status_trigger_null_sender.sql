-- HIGH: job status transitions ABORT once a job's chat has any messages.
--
-- Root cause: insert_job_status_system_message() (migration
-- 20260706130000) inserts a "system message" row on every job status
-- transition with `sender_id = NULL`, but `messages.sender_id` is a
-- `uuid NOT NULL` column. Postgres raises 42804 (untyped NULL) and, once
-- cast to uuid, 23502 (NOT NULL violation) — either way the INSERT
-- rolls the whole UPDATE back. Because the SELECT is guarded by
-- `EXISTS messages WHERE job_id = NEW.id AND is_system = false`, the
-- bug never fires while a job has zero human messages — so the initial
-- accept path (status='accepted' before any chat) worked during earlier
-- audit passes. The break appears on the SECOND status transition
-- (in_progress / completed / cancelled) after either party has sent at
-- least one chat message — the normal lifecycle path.
--
-- Discovered during the 2026-07-20 audit driving a full 2-account
-- lifecycle in prod: helper applied → poster accepted → 1 chat message
-- exchanged → next status transition threw:
--   ERROR: 23502: null value in column "sender_id" of relation
--   "messages" violates not-null constraint
-- which would have blocked every helper marking a job "in_progress"
-- and every poster confirming completion after a real chat.
--
-- Fix: use NEW.customer_id (the poster) as the sender_id for system
-- messages. The `is_system=true` flag already distinguishes system-
-- generated rows from human messages in the UI, so attribution to the
-- poster is a semantic no-op (system messages render identically to
-- both parties). This keeps the NOT NULL invariant on sender_id intact
-- and avoids the schema change altering that column would require.
CREATE OR REPLACE FUNCTION insert_job_status_system_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_content text;
BEGIN
  -- Only fire on meaningful status transitions
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

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
  INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
  SELECT DISTINCT
    NEW.id,
    NEW.customer_id,
    CASE WHEN m.sender_id = NEW.customer_id THEN m.receiver_id ELSE m.sender_id END,
    v_content,
    false,
    true
  FROM messages m
  WHERE m.job_id = NEW.id
    AND m.is_system = false
    AND m.sender_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
