-- FIX: the job-status system-message trigger aborted every status transition
-- (including accepting an applicant → "Couldn't send the offer — please try again").
--
-- Root cause: insert_job_status_system_message() ran
--   CASE NEW.status WHEN 'assigned' THEN … END
-- 'assigned' was removed from the job_status enum (valid values are now
-- open, accepted, in_progress, completed, cancelled, revision_requested,
-- disputed, pending_approval). Comparing the enum column against the literal
-- 'assigned' forces Postgres to cast 'assigned'::job_status, which raises
--   invalid input value for enum job_status: "assigned"
-- and rolls back the whole UPDATE — so accept_application() failed at the
-- moment it set status = 'accepted'.
--
-- Fix: compare on NEW.status::text (never casts a literal INTO the enum, so a
-- stale/unknown label can never abort the transaction again) and map the real
-- 'accepted' value to the awarded message.
CREATE OR REPLACE FUNCTION insert_job_status_system_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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
  INSERT INTO messages (job_id, sender_id, receiver_id, content, read, is_system)
  SELECT DISTINCT
    NEW.id,
    NULL,           -- system messages have no human sender
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

DROP TRIGGER IF EXISTS job_status_system_message ON jobs;
CREATE TRIGGER job_status_system_message
  AFTER UPDATE OF status ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION insert_job_status_system_message();
