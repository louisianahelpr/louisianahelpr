-- An offered (not yet accepted) Helpr becomes reachable by the POSTER ONLY,
-- exactly like an applicant.
--
-- The gap (lh-authz-rls review of 20260914210443, docs/OPEN.md owner
-- question): can_send_message_to_in_job, the receiver gate the messages INSERT
-- policy calls, put jobs.offered_to_helper_id in the same branch as the hired
-- Helpr and the roster. So the hired Helpr or any roster member of a job could
-- message the offered Helpr, and learn who that is by the send (or the RPC)
-- being accepted. An offer is the poster's private approach to one Helpr;
-- nobody else on the job has any business contacting or identifying them.
--
-- OWNER DECISION 2026-09-14: the offered Helpr is poster-only, like applicants.
-- The converse is closed the same way 20260914210443 closed it for messaged
-- applicants: an offered Helpr may post in the job (can_message_in_job lets
-- them) but may reach ONLY the poster, never the hired Helpr or the roster,
-- who could not reply and would learn the offered Helpr's identity from the
-- message itself.
--
-- New receiver rule (everything before it is the LIVE definition verbatim:
-- caller bound to auth.uid(), not banned, may post in the job, not blocked
-- with the receiver, under the 30/hour cap):
--     receiver is the POSTER                           -- anyone who may post
--  OR (receiver is the HIRED Helpr or on the ROSTER
--      AND caller is the poster, the hired Helpr or on the roster)
--  OR (receiver is the OFFERED Helpr or an APPLICANT
--      AND caller is the poster)
-- Someone who is BOTH offered and hired (helper_id = offered_to_helper_id) or
-- both offered and on the roster keeps the hired/roster reachability, because
-- the middle branch matches them on helper_id / group_job_helpers.
--
-- "Offered" is jobs.offered_to_helper_id, whatever direct_offer_status says,
-- the same column can_message_in_job admits the offeree by. A declined or
-- expired offer does not clear that column (20260904031002), so a former
-- offeree stays poster-only on that job for good: tighter than "pending", on
-- purpose, since a hired Helpr chosen after a declined offer has no more
-- business contacting the earlier offeree than one hired beside a live offer.
--
-- INSERT outcome changes in exactly these ways: a message from the hired
-- Helpr or a roster member to an offered-only Helpr is refused, and so is a
-- message from an offered-only Helpr to the hired Helpr or a roster member.
-- Poster <-> offered Helpr keeps working both ways. The policy itself is
-- unchanged (it already calls this function), so only the function body is
-- replaced; grants are re-asserted by role name.
--
-- Live source: pg_get_functiondef('public.can_send_message_to_in_job(uuid,uuid)')
-- on prod fncmgoasalhdgfwzhsqa, 2026-09-14, proacl
-- {postgres=X, authenticated=X, service_role=X}.
--
-- Replay-safe: CREATE OR REPLACE and idempotent grants, and the whole body is
-- skipped (NOTICE) if any object it builds on is absent.

DO $migration$
BEGIN
  IF to_regprocedure('public.can_send_message_to_in_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_message_in_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_caller_banned()') IS NULL
     OR to_regprocedure('public.are_users_blocked(uuid,uuid)') IS NULL
     OR to_regclass('public.group_job_helpers') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'can_send_message_to_in_job / can_message_in_job / is_caller_banned / are_users_blocked / messages / group_job_helpers / applications absent: skipped';
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

  COMMENT ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) IS
    'Messages INSERT policy receiver gate: true only when the CALLER (auth.uid()) '
    'may post in the job, is not blocked with _receiver, is under the 30/hour '
    'send cap, and _receiver is the poster, or the hired Helpr/roster member '
    'when the caller is the poster/hired Helpr/roster, or the offered Helpr or '
    'an applicant when the caller is the poster (20260914215014).';

  -- Called from the messages INSERT policy, which runs as the requesting role.
  -- Roles named: FROM PUBLIC alone leaves anon's own grant in place.
  REVOKE ALL ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) TO authenticated, service_role;
END
$migration$;
