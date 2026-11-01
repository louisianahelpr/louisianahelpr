-- Expired is not cancelled, in a message thread (owner 10-31; B44, lead item 2).
--
-- insert_job_status_system_message writes "✕ Job cancelled" into every thread on a job that moves to 'cancelled', and
-- notify_message_recipient turns each row into the receiver's bell, push and email ("New message from <poster>").
-- auto-expire-jobs closes an unfilled listing as 'cancelled' (no cancelled_by, reason "Job listing expired — ..."),
-- so an applicant who had messaged the poster would be told "Job cancelled". Prod, read-only 2026-10-31 20:08 CT:
-- 28 expired listings, 0 with a message thread yet, 0 such bells; 0 other cancelled jobs with a null cancelled_by.
--
-- Newest definition: 20261017205845 (Q1971's early return), verbatim, plus the expired-listing branch below.
-- Trigger function only: no grants change (REVOKE restated). Proof: src/test/pglite/expiredListingThreadNotice.pglite.mjs.

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

  -- Q1971 (20261017205845): a job cancelled because its bank payment failed
  -- writes no "✕ Job cancelled" thread row. That row notifies every thread
  -- participant as if the poster sent it (notify_message_recipient), which
  -- would tell an unconfirmed Helpr the owner chose not to tell, and tell a
  -- confirmed one twice. cancel_job_after_failed_bank_payment tells the
  -- people who should hear, in the right words.
  IF COALESCE(current_setting('app.payment_failed_cancel', true), '') = 'on' THEN RETURN NEW; END IF;

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

  -- Expired is not cancelled (owner 10-31, OWNER-DECISIONS "Expired jobs are not cancellations"): a listing that
  -- auto-expire-jobs closed with no Helpr hired was never cancelled by anyone, and nobody but its poster may read it
  -- as Cancelled or Expired. This row is ONE row both parties read (and notify_message_recipient turns it into the
  -- receiver's bell), so it says what is true for both: the job is no longer open. The marker is the client's
  -- jobIsExpiredListing (src/lib/expiredListingInThread.ts): no Helpr, no cancelled_by (auto-expire-jobs never sets
  -- it; poster_cancel_job always does), and the sweep's reason. The poster's own pill says it expired.
  IF NEW.status::text = 'cancelled'
     AND NEW.helper_id IS NULL
     AND NEW.cancelled_by IS NULL
     AND COALESCE(NEW.cancellation_reason, '') LIKE 'Job listing expired%' THEN
    v_content := '✕ No longer open';
  END IF;

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

-- A trigger function: the trigger machinery runs it, no role calls it.
REVOKE ALL ON FUNCTION public.insert_job_status_system_message() FROM PUBLIC, anon, authenticated;
