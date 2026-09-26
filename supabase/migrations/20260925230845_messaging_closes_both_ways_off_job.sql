-- Messaging closes BOTH WAYS once someone is off a job (owner decision
-- 2026-09-25, docs/OPEN.md Q407 addendum 14; settles Q420).
--
-- "Off the job" = someone who WAS involved (an application, or a direct offer)
-- and is no longer a party: a rejected applicant, a crew member removed from
-- the roster (the row is deleted and trg_sync_job_after_roster_departure,
-- 20260925140148 as restated by 20260925154606, turns their application
-- accepted -> rejected), and a declined or expired offeree. Neither side may
-- start a new message with them on that job; earlier messages stay readable
-- (SELECT policies are untouched).
--
-- Before this file, after 20260925175953 (Q705):
--   * the SENDER side still admitted a former offeree: can_message_in_job
--     branch 2 read offered_to_helper_id alone, which a declined/expired offer
--     never clears (Q420(a)).
--   * the RECEIVER side let the poster message any applicant or offeree
--     whatever their status (can_send_message_to_in_job, 20260914215014), so
--     the poster could keep writing to someone who could no longer reply
--     (Q420(b), decided by the owner: closed).
--
-- What this installs:
--   1. is_off_job(job, user): internal predicate, the one definition both gates
--      and the client read. A stranger (never applied, never offered) is NOT
--      "off": the gates refuse them on their own terms, and the client must not
--      tell them anything about the job.
--   2. can_message_in_job restated from its newest text (20260925175953);
--      only branch 2 changes: the offeree counts while the offer is pending,
--      and the hire (helper_id) as before.
--   3. can_send_message_to_in_job restated from its newest text
--      (20260914215014); adds AND NOT is_off_job(job, receiver).
--   4. get_off_job_thread_state(job, other): the client's read, so the composer
--      is replaced by a read-only notice instead of offering a send RLS
--      refuses. 'self' when the CALLER is off the job, 'other' when the other
--      person is and the caller already has a thread with them on it (so it
--      cannot be used to probe who applied), else NULL.
--
-- Grants: is_off_job internal {service_role}; can_message_in_job as before
-- {service_role}; can_send_message_to_in_job and get_off_job_thread_state to
-- authenticated + service_role. Every REVOKE names PUBLIC and anon.
--
-- Proof: src/test/pglite/messageGateCurrentParty.pglite.mjs runs the real
-- departure trigger and no-lead trigger cut from the migrations, both gates
-- both directions, 3x. Not read live from this lane.
--
-- Replay-safe: CREATE OR REPLACE and idempotent grants, skipped (NOTICE) when
-- any object the bodies read is absent.

DO $offjob$
BEGIN
  IF to_regclass('public.jobs') IS NULL
     OR to_regclass('public.messages') IS NULL
     OR to_regclass('public.group_job_helpers') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regprocedure('public.job_messaging_closes_at(uuid)') IS NULL
     OR to_regprocedure('public.is_caller_banned()') IS NULL
     OR to_regprocedure('public.are_users_blocked(uuid,uuid)') IS NULL THEN
    RAISE NOTICE 'jobs / messages / group_job_helpers / applications / job_messaging_closes_at / is_caller_banned / are_users_blocked absent: skipped';
    RETURN;
  END IF;

  -- ── 1. Who is off the job ──────────────────────────────────────────────
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.is_off_job(_job_id uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user IS NOT NULL
     -- was involved: applied, or was offered the job
     AND (
       EXISTS (SELECT 1 FROM public.applications a
               WHERE a.job_id = _job_id AND a.helper_id = _user)
       OR EXISTS (SELECT 1 FROM public.jobs j
                  WHERE j.id = _job_id AND j.offered_to_helper_id = _user)
     )
     -- and is no longer a party: not the poster, not hired, no pending offer,
     -- not on the crew, no live application
     AND NOT EXISTS (
       SELECT 1 FROM public.jobs j
       WHERE j.id = _job_id
         AND (j.customer_id = _user
              OR j.helper_id = _user
              OR (j.offered_to_helper_id = _user AND j.direct_offer_status = 'pending'))
     )
     AND NOT EXISTS (SELECT 1 FROM public.group_job_helpers g
                     WHERE g.job_id = _job_id AND g.helper_id = _user)
     AND NOT EXISTS (SELECT 1 FROM public.applications a
                     WHERE a.job_id = _job_id AND a.helper_id = _user
                       AND a.status IN ('pending', 'accepted'));
$function$
$fn$;

  REVOKE ALL ON FUNCTION public.is_off_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.is_off_job(uuid, uuid) TO service_role;

  -- ── 2. The sender gate (20260925175953's text, branch 2 tightened) ─────
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    -- 0. Lockout: 24h after completion nobody on the job may post a new
    --    message. COALESCE(..., true): a job that is not completed has no
    --    closing time and stays open.
    COALESCE(public.job_messaging_closes_at(_job_id) > now(), true)
    AND (
      -- 1. The poster of the job.
      EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = _job_id AND j.customer_id = _sender
      )
      -- 2. The helper this job is assigned to, or offered to while the offer
      --    is still PENDING. A declined or expired offer does not clear
      --    offered_to_helper_id, and an accepted one whose Helpr later
      --    cancelled keeps it with status 'accepted' but helper_id NULL, so
      --    the column alone admitted former offerees for good (Q420(a)).
      --    NULL-safe: `= _sender` is never true when the column is NULL.
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = _job_id
          AND (j.helper_id = _sender
               OR (j.offered_to_helper_id = _sender AND j.direct_offer_status = 'pending'))
      )
      -- 3. A member of this job's group roster (the whole crew: a group job's
      --    helper_id is NULL). Removal deletes the row.
      OR EXISTS (
        SELECT 1 FROM public.group_job_helpers g
        WHERE g.job_id = _job_id AND g.helper_id = _sender
      )
      -- 4. The poster messaged THIS sender first, AND the sender still holds a
      --    live application on the job (Q705). A rejected applicant, or a crew
      --    member removed from the roster (application -> rejected), no longer
      --    passes.
      OR (
        EXISTS (
          SELECT 1
          FROM public.messages m
          JOIN public.jobs j ON j.id = m.job_id
          WHERE m.job_id = _job_id
            AND m.sender_id = j.customer_id
            AND m.receiver_id = _sender
        )
        AND EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = _job_id
            AND a.helper_id = _sender
            AND a.status IN ('pending', 'accepted')
        )
      )
    );
$function$
$fn$;

  REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO service_role;

  -- ── 3. The receiver gate (20260914215014's text + the off-job refusal) ──
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
     -- the last hour refuses the next send).
     AND (SELECT count(*) FROM public.messages m
           WHERE m.sender_id = auth.uid()
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

  -- ── 4. The client's read ───────────────────────────────────────────────
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_off_job_thread_state(_job_id uuid, _other uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    -- The caller is off the job: their own status, nothing about anyone else.
    WHEN public.is_off_job(_job_id, auth.uid()) THEN 'self'
    -- The other person is off the job, and the caller already has a thread
    -- with them on it (so this cannot be used to probe who applied).
    WHEN _other IS NOT NULL
         AND public.is_off_job(_job_id, _other)
         AND EXISTS (
           SELECT 1 FROM public.messages m
           WHERE m.job_id = _job_id
             AND ((m.sender_id = auth.uid() AND m.receiver_id = _other)
                  OR (m.sender_id = _other AND m.receiver_id = auth.uid()))
         ) THEN 'other'
    ELSE NULL
  END;
$function$
$fn$;

  REVOKE ALL ON FUNCTION public.get_off_job_thread_state(uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_off_job_thread_state(uuid, uuid) TO authenticated, service_role;
END
$offjob$;
