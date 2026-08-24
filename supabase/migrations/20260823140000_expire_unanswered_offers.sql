-- expire_unanswered_offers — the consequence half of `response_deadline`.
--
-- WHAT WAS BROKEN. `accept_application` stamps `jobs.response_deadline` when a
-- poster picks a candidate, and the helper's Activity card counts down against
-- it ("17h 12m remaining · Accept or decline before the deadline"). Nothing on
-- the server ever read that column again. When the clock hit zero:
--
--   * the job stayed `accepted`, still holding a helper who had never
--     confirmed, invisible to every other helper browsing;
--   * the poster got nothing — no reopen, no notification, no way to pick
--     somebody else short of cancelling the job by hand;
--   * the helper who ghosted walked away clean, while a helper who pressed
--     Decline took a `job_denial` strike toward a permanent ban.
--
-- That last one is the serious half. It made ghosting strictly better than
-- answering: same outcome for the job, no strike for the helper, and the
-- poster left waiting for a deadline the system did not enforce. The whole
-- 5-strike decline ladder is unenforceable while the cheapest way out is
-- silence.
--
-- (`auto-expire-jobs` step 1 does reopen stale acceptances, but it keys on
-- `updated_at` older than 24h — not on the deadline the poster actually set —
-- and it files no violation. It stays, for jobs where no deadline was set at
-- all. This runs first, so a deadline-expired job is already `open` by the
-- time that loop looks.)
--
-- WHAT THIS DOES. Owner's call: an unanswered offer reopens the job AND counts
-- as a decline. So this applies the exact consequences of
-- `decline_job_offer` — same 5-strike ladder, same `job_denial` violation
-- type, same warning at prior-count 2-3 and permanent ban at >= 4 — because it
-- IS the same event. The helper was selected from their own application and
-- did not honour it; whether they said no or said nothing changes the manners,
-- not the outcome.
--
-- DIRECT OFFERS ARE NOT TOUCHED. `expire_pending_direct_offers` already handles
-- those, and deliberately files no violation: a direct offer is unsolicited, so
-- turning it down — or letting it lapse — is not misconduct. This function only
-- ever sees jobs that reached `status = 'accepted'`, which on the direct path
-- only happens after the helper has actively accepted.
--
-- SERVICE ROLE ONLY. It acts on other people's rows and issues bans; there is
-- no caller-authorization story that makes sense for `authenticated`.

CREATE OR REPLACE FUNCTION public.expire_unanswered_offers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job record;
  v_locked record;
  v_app_id uuid;
  v_prior_count int;
  v_action text;
  v_count int := 0;
BEGIN
  -- Scan first WITHOUT a lock, then lock each candidate individually inside the
  -- loop. A cursor that carried its own FOR UPDATE would hold every row for the
  -- whole sweep, so one slow iteration blocks a helper trying to confirm an
  -- unrelated job; and the re-check below has to happen after the lock is
  -- granted either way.
  FOR v_job IN
    SELECT j.id
      FROM public.jobs j
     WHERE j.status = 'accepted'
       AND j.helper_id IS NOT NULL
       AND j.response_deadline IS NOT NULL
       AND j.response_deadline < now()
       AND j.helper_confirmed_at IS NULL
  LOOP
    -- Lock and re-read. This serializes against a helper confirming in the same
    -- instant and against decline_job_offer / respond_to_direct_offer, all of
    -- which lock the job row first. SKIP LOCKED so one contended row cannot
    -- stall the sweep — it will be picked up on the next hourly tick.
    --
    -- The predicate is re-applied here, not just in the scan above: the row can
    -- be confirmed or reopened between the two, and a losing race must be a
    -- no-op rather than a helper losing a job they had just confirmed.
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

    -- The accepted application this offer was made from. A direct offer that
    -- was accepted also has one (respond_to_direct_offer inserts it), but such
    -- a job always has helper_confirmed_at set, so it never reaches here.
    SELECT a.id INTO v_app_id
      FROM public.applications a
     WHERE a.job_id = v_locked.id
       AND a.helper_id = v_locked.helper_id
       AND a.status = 'accepted'
     LIMIT 1;

    -- Same ladder as decline_job_offer. Kept as a literal copy rather than a
    -- shared helper so the two escalation policies are visibly identical at
    -- the point of change; if one moves, this comment is the reminder to move
    -- the other.
    SELECT count(*) INTO v_prior_count
      FROM public.user_violations
     WHERE user_id = v_locked.helper_id
       AND violation_type = 'job_denial';

    v_action := CASE
      WHEN v_prior_count >= 4 THEN 'permanent_ban'
      WHEN v_prior_count >= 2 THEN 'warning'
      ELSE 'none'
    END;

    INSERT INTO public.user_violations (user_id, violation_type, description, job_id, action_taken)
    VALUES (v_locked.helper_id, 'job_denial',
            'Let a job offer expire without answering: "' || COALESCE(v_locked.title, 'Unknown') || '"',
            v_locked.id, v_action);

    IF v_action = 'warning' THEN
      UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = v_locked.helper_id;
    ELSIF v_action = 'permanent_ban' THEN
      INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
      VALUES (v_locked.helper_id, 'permanent',
              'Declined or ignored 5 job offers after being selected', v_locked.helper_id);
      UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = v_locked.helper_id;
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
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_locked.customer_id,
      'Offer expired — job reopened',
      'Your Helpr didn''t answer in time for "' || COALESCE(v_locked.title, 'your job')
        || '". It''s open to everyone again, so you can pick somebody else.',
      'job_updates',
      '/my-posts'
    );

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_locked.helper_id,
      'You lost a job offer',
      'The deadline passed on "' || COALESCE(v_locked.title, 'a job')
        || '" and it went back to everyone. Letting an offer expire counts the same as declining it.',
      'expired',
      '/my-jobs'
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_unanswered_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_offers() TO service_role;

-- Index the exact predicate the sweep scans on. Without it this is a full scan
-- of `jobs` on every cron tick; partial so it only carries rows that can
-- actually expire.
CREATE INDEX IF NOT EXISTS idx_jobs_unanswered_offer_deadline
  ON public.jobs (response_deadline)
  WHERE status = 'accepted' AND helper_confirmed_at IS NULL AND response_deadline IS NOT NULL;
