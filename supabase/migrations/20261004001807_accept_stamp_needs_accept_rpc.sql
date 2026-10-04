-- docs/OPEN.md Q1187 and Q1188 (lh-authz-rls reviews of Q1180, 2026-10-03:
-- #8 and round 3 should-fix 1; round 3 should-fix 2).
--
-- Q1187. A READY Helpr could still skip accept_job_offer. The Hire makes the
-- job the Helpr's offer (helper_id set, status 'accepted', helper_confirmed_at
-- NULL). jobs_award_gate judged the Helpr's readiness when the confirmation
-- was written, but not WHO wrote it, and enforce_helper_jobs_column_whitelist
-- lets the assigned Helpr write helper_confirmed_at. So a plain PATCH of
-- helper_confirmed_at (with status 'in_progress' in the same write, or
-- mark_helper_arrival after it) confirmed and started the job with no
-- "<name> accepted your offer" notice and every other application left
-- pending. Only a stale or hostile client does that: the app has called
-- accept_job_offer since 20261003193541, and its pre-RPC fallback (that very
-- PATCH) is retired in the same change as this migration.
--
-- After, layer by layer:
--   * enforce_helper_award_gate: in an end-user session, a write that confirms
--     an accept (the awarding writes Q1180 already judged) is refused with
--     accept_required unless the accept RPC wrote it, which it says with the
--     transaction-local flag app.accept_rpc = '1'. One shape is not the accept
--     of an offer and keeps its old judgement (readiness only): the caller
--     taking an OPEN job with nobody on it and confirming it in the same
--     write. That is claim_series_dates picking up a vacated visit, and
--     respond_to_direct_offer until 20261003214350 (Q1185) routes it through
--     complete_job_accept. No client can make that write:
--     trg_hire_columns_rpc_only refuses a client's helper_id
--     (20260924042503), so only a SECURITY DEFINER RPC reaches it.
--   * complete_job_accept: the one writer of an accept. It sets app.accept_rpc
--     for its one UPDATE and clears it right after, so the flag never covers
--     another write in the same transaction (a failed UPDATE takes the flag
--     with its (sub)transaction). Every door that completes an accept goes
--     through it: accept_job_offer, trg_profiles_complete_pending_accepts, and
--     Q1185's complete_direct_offer_accept.
--   * claim_series_dates is unchanged and keeps its own app.series_claim_rpc,
--     which it sets only around its applications INSERT, after the jobs
--     UPDATE; the gate admits that UPDATE by its shape (above).
--
-- Q1188. accept_job_offer locks the Helpr's profile, then the job; the hourly
-- expire_unanswered_offers locks the job, then its strike ladder writes the
-- same profile. A cycle needs the same Helpr on the same job at the same
-- moment; Postgres then aborts one side, and when that was the sweep, every
-- offer it had already expired rolled back with it. Each offer now expires in
-- its own subtransaction: a job that fails (a deadlock or anything else) is
-- rolled back alone and logged to error_logs with its id (a seed job or seed
-- Helpr under the '-seed' source, as complete_pending_accepts_on_setup logs),
-- and the sweep goes on. The next hourly run retries that job.
--
-- The three restated functions are their live bodies (md5(prosrc) equal to
-- 20261003193541's text on prod, 2026-10-03: enforce_helper_award_gate
-- bb8c5765, complete_job_accept e3afce8d, expire_unanswered_offers 0531b57b)
-- with only the edits marked Q1187 / Q1188.
--
-- REPLAY-SAFETY: CREATE OR REPLACE only; plpgsql bodies are not resolved at
-- creation. Proof: src/test/pglite/acceptGateHardening.pglite.mjs (prod's
-- bodies, md5-checked; red on them, green with this applied 3x). Guard:
-- src/test/acceptGateHardening.test.ts.

-- Q1180's gate + the Q1187 refusal.
CREATE OR REPLACE FUNCTION public.enforce_helper_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason   text;
  v_awarding boolean;
  v_takes_open_job boolean;
BEGIN
  -- Only real end-user sessions are judged. An anon request is an end-user
  -- session with no uid, not a server write.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Nothing starts, finishes or is disputed on an offer the Helpr has not
  -- accepted, ready or not: the accept goes through accept_job_offer, which
  -- tells the poster. Refused outright (lh-authz-rls re-review 2026-10-03:
  -- a READY Helpr who never tapped Accept could mark_helper_arrival into
  -- in_progress with no poster notice, and either party could open a dispute
  -- on an offer, freezing the escrow). Server sweeps and system disputes run
  -- in server context and returned above.
  IF TG_OP = 'UPDATE' AND NEW.helper_id IS NOT NULL AND NEW.helper_confirmed_at IS NULL
     AND ((OLD.status::text = 'accepted'
           AND NEW.status::text IN ('in_progress', 'revision_requested', 'completed', 'disputed'))
          OR (NEW.helper_completed_at IS NOT NULL AND OLD.helper_completed_at IS NULL)) THEN
    RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501';
  END IF;

  v_awarding :=
       -- the accept itself, with or without a Helpr on the row (F2: a stamp
       -- before the Helpr is on the job is judged against nobody and refused)
       (NEW.helper_confirmed_at IS NOT NULL
          AND (TG_OP = 'INSERT' OR OLD.helper_confirmed_at IS NULL))
       -- a confirmed row changing Helpr is a new accept (F3)
    OR (NEW.helper_id IS NOT NULL AND NEW.helper_confirmed_at IS NOT NULL
          AND TG_OP = 'UPDATE' AND OLD.helper_id IS DISTINCT FROM NEW.helper_id);

  IF NOT v_awarding THEN
    RETURN NEW;
  END IF;

  -- Q1187: the accept of an offer is written only by the accept RPC
  -- (complete_job_accept sets app.accept_rpc for its one UPDATE). A direct
  -- PATCH of helper_confirmed_at confirmed a job with no poster notice and the
  -- other applications left pending (lh-authz-rls review #8). The one write
  -- that is not an offer's accept: the caller taking an open job with nobody
  -- on it and confirming it at once (claim_series_dates' pickup of a vacated
  -- visit; respond_to_direct_offer until Q1185). Only a definer RPC can make
  -- it, because trg_hire_columns_rpc_only refuses a client's helper_id; it is
  -- judged for readiness below, as before. INSERTs are
  -- trg_jobs_insert_column_lock's (a poster's new job is born unconfirmed).
  IF TG_OP = 'UPDATE' AND current_setting('app.accept_rpc', true) IS DISTINCT FROM '1' THEN
    v_takes_open_job := OLD.helper_id IS NULL AND OLD.status::text = 'open'
                        AND NEW.helper_id IS NOT NULL AND NEW.helper_id = auth.uid()
                        AND NEW.status::text = 'accepted';
    IF v_takes_open_job IS NOT TRUE THEN
      RAISE EXCEPTION 'accept_required' USING ERRCODE = '42501',
        HINT = 'An offer is accepted with Accept (accept_job_offer), which tells the person who posted it; the confirmation is never written directly.';
    END IF;
  END IF;

  v_reason := public.helper_accept_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_helper_award_gate() FROM PUBLIC, anon, authenticated;

-- Q1180's one completion of an accept + the Q1187 flag.
CREATE OR REPLACE FUNCTION public.complete_job_accept(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_job  record;
  v_name text;
  v_done boolean;
BEGIN
  -- Q1187: this UPDATE is the accept, so jobs_award_gate lets it confirm the
  -- job (app.accept_rpc). On for this one statement only: cleared before
  -- anything else runs, so no other write in the transaction inherits it.
  PERFORM set_config('app.accept_rpc', '1', true);
  UPDATE public.jobs
     SET helper_confirmed_at = now(),
         response_deadline = NULL
   WHERE id = p_job_id
     AND status = 'accepted'
     AND helper_id IS NOT NULL
     AND helper_confirmed_at IS NULL
     AND (response_deadline IS NULL OR response_deadline > now())
     -- the server path (the profiles trigger) skips enforce_job_funded_before_award
     AND public.job_payment_is_funded(payment_status::text)
  RETURNING id, helper_id, customer_id, title INTO v_job;
  -- FOUND before the PERFORM below, which would reset it.
  v_done := FOUND;
  PERFORM set_config('app.accept_rpc', '0', true);
  IF NOT v_done THEN
    RETURN false;
  END IF;

  -- The other applicants learn the spot is taken (reject_other_applications_on_accept's rule).
  UPDATE public.applications
     SET status = 'rejected', updated_at = now()
   WHERE job_id = p_job_id
     AND helper_id IS DISTINCT FROM v_job.helper_id
     AND status = 'pending';

  IF v_job.customer_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'Your Helpr') INTO v_name
      FROM public.profiles p WHERE p.user_id = v_job.helper_id;
    v_name := COALESCE(v_name, 'Your Helpr');
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      v_job.customer_id,
      v_name || ' accepted your offer',
      v_name || ' accepted "' || COALESCE(v_job.title, 'your job') || '". You''re all set.',
      'job_updates',
      '/posts?job=' || p_job_id::text,
      p_job_id
    );
  END IF;
  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_job_accept(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job_accept(uuid) TO service_role;

-- Q1180's sweep + the Q1188 per-offer subtransaction.
CREATE OR REPLACE FUNCTION public.expire_unanswered_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job record;
  v_locked record;
  v_app_id uuid;
  v_count int := 0;
  v_no_strike boolean;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id, j.helper_id,
           -- Q1188: a seed job, or a seed/test Helpr (detect_stuck_payments'
           -- rule), logs a failure under the '-seed' source.
           (coalesce(j.is_seed, false) OR coalesce(hp.is_seed, false)) AS seed
      FROM public.jobs j
      LEFT JOIN public.profiles hp ON hp.user_id = j.helper_id
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    -- Q1188 (lh-authz-rls round 3 of Q1180, should-fix 2): each offer in its
    -- own subtransaction. accept_job_offer takes the Helpr's profile, then the
    -- job; this sweep holds the job when the strike ladder writes that
    -- profile. If Postgres picks this side of that deadlock (or anything else
    -- in one iteration fails), only this offer rolls back, it is logged with
    -- its job, and every other offer still expires. The next run retries it.
    BEGIN
      SELECT j.id, j.title, j.customer_id, j.helper_id
        INTO v_locked
        FROM public.jobs j
       WHERE j.id = v_job.id
         AND j.status = 'accepted'
         AND j.helper_id IS NOT NULL
         AND j.response_deadline IS NOT NULL
         AND j.response_deadline < now()
         AND j.helper_confirmed_at IS NULL
       FOR UPDATE SKIP LOCKED;

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      SELECT a.id INTO v_app_id
        FROM public.applications a
       WHERE a.job_id = v_locked.id
         AND a.helper_id = v_locked.helper_id
         AND a.status = 'accepted'
       LIMIT 1;

      -- ONE ladder for the whole reliability family — see
      -- apply_job_denial_consequence (20260824243000). The literal copy this
      -- replaced is exactly the drift hazard its own comment warned about.
      -- No strike while the Helpr's Stripe setup is unfinished, or after they
      -- tapped Accept and were still finishing it (owner, 2026-10-03: "it
      -- shouldn't hold up anything"; Q1180).
      v_no_strike := public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.job_accept_pending p
                    WHERE p.job_id = v_locked.id AND p.helper_id = v_locked.helper_id);
      IF NOT v_no_strike THEN
        PERFORM public.apply_job_denial_consequence(
          v_locked.helper_id, v_locked.id,
          'Let a job offer expire without answering: "' || COALESCE(v_locked.title, 'Unknown') || '"');
      END IF;

      IF v_app_id IS NOT NULL THEN
        UPDATE public.applications SET status = 'rejected' WHERE id = v_app_id;
      END IF;

      UPDATE public.jobs
         SET status = 'open',
             helper_id = NULL,
             response_deadline = NULL
       WHERE id = v_locked.id;

      -- Both sides are told, because both sides were waiting on this.
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.customer_id,
        'Offer expired — job reopened',
        'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
          || '". It''s open to everyone again, so you can pick somebody else.',
        'job_updates',
        '/posts?job=' || v_locked.id::text,
        v_locked.id
      );

      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_locked.helper_id,
        'You lost a job offer',
        'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
          || CASE WHEN v_no_strike
               THEN '" before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
               ELSE '" and it went back to everyone. Letting an offer expire counts the same as declining it.'
             END,
        'expired',
        '/jobs?job=' || v_locked.id::text,
        v_locked.id
      );

      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E offer logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN v_job.seed THEN 'info' ELSE 'error' END,
        'unanswered offer expiry failed',
        jsonb_build_object('source', 'expire_unanswered_offers' || CASE WHEN v_job.seed THEN '-seed' ELSE '' END,
                           'seed', v_job.seed, 'job_id', v_job.id::text),
        jsonb_build_object('job_id', v_job.id, 'helper_id', v_job.helper_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_unanswered_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_offers() TO service_role;
