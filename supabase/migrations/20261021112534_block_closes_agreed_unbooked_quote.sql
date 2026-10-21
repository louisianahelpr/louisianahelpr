-- Q2122 (lh-authz-rls review of 1982a1459, should-fix 1; owner decided 2026-10-21 via the lead): a block between a
-- poster and a quoter closed only PENDING quotes (trg_quote_close_pending_across_block, 20261018155222). An accepted
-- quote that was never booked kept its request 'agreed' forever: booking it is refused across the block, the
-- quoter cannot withdraw a non-pending quote, and only the poster's cancel ended it, so the quoter's list showed an
-- accepted quote with no end. Now the block also closes that quote and cancels its request.
--
-- quote_close_pending_across_block restated from its newest body (20261018155222; md5 of prosrc = live, measured
-- 2026-10-21) with only the agreed-and-unbooked section added; the error-logging fallback is unchanged (a failure
-- never undoes the block). The trigger is re-created as it was.
-- Proof: node src/test/pglite/blockClosesAgreedUnbookedQuote.pglite.mjs (red without the file, 3x apply).

CREATE OR REPLACE FUNCTION public.quote_close_pending_across_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_request record;
BEGIN
  BEGIN
    UPDATE public.job_quotes q
       SET status = 'closed', updated_at = now()
      FROM public.job_quote_requests r
     WHERE r.id = q.request_id
       AND q.status = 'pending'
       AND ((r.poster_id = NEW.blocker_id AND q.quoter_id = NEW.blocked_id)
         OR (r.poster_id = NEW.blocked_id AND q.quoter_id = NEW.blocker_id));

    -- Q2122 (owner, 2026-10-21): an ACCEPTED quote that was never booked (its request 'agreed' with no job yet)
    -- closes too, and its request is cancelled, as the poster's own cancel_quote_request would do. Booking it
    -- was already refused across the block (book_accepted_quote: applicant_blocked), so it sat 'agreed' forever.
    -- A booked request (job_id set) keeps going through the job's own block handling.
    FOR v_request IN
      SELECT r.id
        FROM public.job_quote_requests r
        JOIN public.job_quotes q ON q.request_id = r.id
       WHERE r.status = 'agreed'
         AND r.job_id IS NULL
         AND q.status = 'accepted'
         AND ((r.poster_id = NEW.blocker_id AND q.quoter_id = NEW.blocked_id)
           OR (r.poster_id = NEW.blocked_id AND q.quoter_id = NEW.blocker_id))
         FOR UPDATE OF r
    LOOP
      UPDATE public.job_quotes SET status = 'closed', updated_at = now()
       WHERE request_id = v_request.id AND status IN ('pending', 'accepted');
      UPDATE public.job_quote_requests SET status = 'cancelled', updated_at = now()
       WHERE id = v_request.id AND status = 'agreed' AND job_id IS NULL;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES ('error', 'Pending quotes not closed across a block',
              jsonb_build_object('source', 'quote_close_pending_across_block'),
              jsonb_build_object('blocker_id', NEW.blocker_id, 'blocked_id', NEW.blocked_id,
                                 'sqlstate', SQLSTATE, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'quote_close_pending_across_block: % blocked %, quotes not closed and the error_logs row failed: %',
        NEW.blocker_id, NEW.blocked_id, SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.quote_close_pending_across_block() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_quote_close_pending_across_block ON public.user_blocks;
CREATE TRIGGER trg_quote_close_pending_across_block
  AFTER INSERT ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.quote_close_pending_across_block();
