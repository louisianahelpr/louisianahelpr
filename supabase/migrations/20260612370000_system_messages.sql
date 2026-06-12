-- System messages: inline status-change notifications in chat threads.
-- These appear as centered, dimmed messages when a job's status changes.
-- sender_id is NULL for system messages (no human sender).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- Trigger: when a job's status changes, insert a system message in all
-- conversation threads for that job.
CREATE OR REPLACE FUNCTION insert_job_status_system_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_content text;
  v_convos RECORD;
BEGIN
  -- Only fire on meaningful status transitions
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  v_content := CASE NEW.status
    WHEN 'assigned'   THEN '✓ Job awarded'
    WHEN 'in_progress' THEN '▶ Work started'
    WHEN 'completed'  THEN '✓ Job completed'
    WHEN 'cancelled'  THEN '✕ Job cancelled'
    WHEN 'disputed'   THEN '⚠ Dispute opened'
    ELSE NULL
  END;

  IF v_content IS NULL THEN RETURN NEW; END IF;

  -- Insert one system message per unique sender/receiver pair in this job's messages
  -- (one per participant, using receiver_id distinct from customer_id so all parties get it)
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
