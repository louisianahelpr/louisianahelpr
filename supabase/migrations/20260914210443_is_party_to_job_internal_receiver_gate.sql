-- is_party_to_job(_job_id, _user_id) becomes internal: no client role may call
-- it with an arbitrary user id.
--
-- The gap (docs/OPEN.md, queued behind the 24h lockout): live proacl on
-- 2026-09-14 was {postgres=X, authenticated=X, service_role=X}, so any
-- signed-in user could POST /rpc/is_party_to_job with any job id and any user
-- id and learn whether that user is the poster, the assigned or offered Helpr,
-- a roster member or an APPLICANT on that job. Nothing about the caller was
-- checked.
--
-- Live inventory (read-only, prod fncmgoasalhdgfwzhsqa, 2026-09-14):
--   * pg_depend on is_party_to_job(uuid,uuid): exactly ONE dependent, the
--     public.messages INSERT policy "Users can send messages", which calls it
--     for the RECEIVER: is_party_to_job(job_id, receiver_id).
--   * pg_proc.prosrc in every schema: no function calls it.
--   * pg_views / pg_matviews / constraints / defaults / indexes: none.
--   * src/, supabase/functions/: no .rpc call (only the generated types.ts).
--   * The four storage.objects proof-photos policies (read/upload/update/
--     delete) call a DIFFERENT function, is_party_to_job_folder(text), which
--     already binds to auth.uid() (it answers only "am I the poster or Helpr
--     of the job this folder names"). Not a probe; untouched here.
--
-- Why EXECUTE cannot simply be revoked: a policy's expressions run as the
-- requesting role, so the INSERT policy would fail with "permission denied for
-- function is_party_to_job" and every message send would be refused. Same
-- situation 20260914201350 solved for can_message_in_job, same pattern: the
-- policy calls a SECURITY DEFINER wrapper, the two-argument function loses
-- every client grant.
--
-- The wrapper cannot bind the receiver to auth.uid() the way
-- can_send_message_in_job binds the sender: the receiver is someone else by
-- definition. So it binds the CALLER instead, and models every BEFORE INSERT
-- refusal that depends only on (caller, receiver), so it answers false in
-- exactly the cases an INSERT would be refused:
--   can_send_message_to_in_job(job, receiver) =
--     auth.uid() IS NOT NULL
--     AND NOT is_caller_banned()                   -- as trg_ban_gate_messages
--     AND can_message_in_job(job, auth.uid())      -- caller may post here
--     AND NOT are_users_blocked(auth.uid(), receiver)
--                                                  -- the same function
--                                                  -- trg_enforce_block_on_message_insert calls
--     AND fewer than 30 messages sent by auth.uid() in the last hour
--                                                  -- the same count and cap
--                                                  -- enforce_message_rate uses
--     AND ( receiver is the POSTER
--           OR (receiver is the assigned or offered Helpr, or on the roster,
--               AND auth.uid() is itself the poster, Helpr, offered Helpr or
--               on the roster)
--           OR (receiver is an APPLICANT AND auth.uid() is the job's POSTER) )
--
-- OWNER DECISION 2026-09-14: only the poster may message applicants. Before
-- this migration the receiver check was is_party_to_job, which admits every
-- applicant as a target for ANY sender who may post in the job, so the hired
-- Helpr, a roster member or an applicant the poster had messaged could message
-- (and, through the refusal or the RPC, learn the identity of) the job's other
-- applicants. The applicant branch is now poster-only. The converse is closed
-- too (lh-authz-rls review): an applicant the poster messaged may post in the
-- job (can_message_in_job branch 4) but may reach ONLY the poster, never the
-- Helpr or roster, who could not reply and would learn the applicant's
-- identity from the message. Existing poster <-> applicant threads keep working: the poster reaches the applicant through the
-- applicant branch, and a messaged applicant reaches the poster through the
-- poster branch (can_message_in_job branch 4 already lets them post).
--
-- What a client can still learn by calling it: for a job it may ALREADY post
-- in, while that thread is open, not blocked with that user, and under the
-- rate cap, whether a given user is the poster (anyone who may post), the
-- Helpr, offered Helpr or a roster member (callers who are themselves one of
-- those), or an applicant (the poster only). That is exactly what the INSERT policy
-- reveals to the same caller by accepting or refusing a message to that
-- receiver, so the wrapper adds no oracle the table does not already have. A
-- signed-in stranger, or anyone on a job they cannot post in, gets false for
-- every user id. Remaining residual: an RPC call inserts no row, so calls
-- themselves are not counted toward the 30/hour cap; a caller under the cap
-- can ask repeatedly about the same bounded set (the job's non-applicant
-- parties) that one INSERT per receiver would reveal anyway.
-- The INSERT outcome changes in exactly one way, the owner decision above: a
-- non-poster's message to an applicant (who is not also the poster, Helpr or
-- roster) is refused, and so is a merely-messaged applicant's message to the
-- Helpr, offered Helpr or a roster member. Everything else is unchanged: the policy already
-- required (SELECT auth.uid()) = sender_id AND can_send_message_in_job(job_id),
-- which implies the wrapper's uid and can_message_in_job conjuncts, and a
-- banned, blocked or rate-limited caller's INSERT never reaches the policy
-- (trg_ban_gate_messages, trg_enforce_block_on_message_insert and
-- enforce_message_rate raise first). The WITH CHECK below is the live
-- 20260914201350 definition verbatim with only that one call swapped.
--
-- Scope: human INSERTs through RLS only. Service-role and SECURITY DEFINER
-- inserts (system pills, engagement automations) never evaluate this policy.
--
-- Replay-safe: CREATE OR REPLACE, DROP POLICY IF EXISTS, idempotent grants,
-- and the whole body is skipped (NOTICE) if any object it builds on is absent.
-- Every object referenced exists before this version (is_caller_banned
-- 20260824245000, is_party_to_job 20260904031655, are_users_blocked
-- 20260703161200, can_message_in_job,
-- can_send_message_in_job and the current policy 20260914201350).

-- Fail fast rather than queue behind live traffic (DROP/CREATE POLICY needs a
-- lock on public.messages).
SET lock_timeout = '5s';

DO $migration$
BEGIN
  IF to_regprocedure('public.is_party_to_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_message_in_job(uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_send_message_in_job(uuid)') IS NULL
     OR to_regprocedure('public.is_caller_banned()') IS NULL
     OR to_regprocedure('public.are_users_blocked(uuid,uuid)') IS NULL
     OR to_regclass('public.group_job_helpers') IS NULL
     OR to_regclass('public.applications') IS NULL
     OR to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'is_party_to_job / can_message_in_job / can_send_message_in_job / is_caller_banned / are_users_blocked / messages / group_job_helpers / applications absent: skipped';
    RETURN;
  END IF;

  -- ── 1. The caller-bound receiver gate ─────────────────────────────────────
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
       -- applicant the poster messaged (NULL-safe for an ownerless job).
       EXISTS (
         SELECT 1 FROM public.jobs j
         WHERE j.id = _job_id AND j.customer_id = _receiver
       )
       -- The assigned or offered Helpr, or a roster member: reachable only by a
       -- caller who is itself the poster, Helpr, offered Helpr or on the
       -- roster, never by a caller who is merely a messaged applicant.
       OR (
         (
           EXISTS (
             SELECT 1 FROM public.jobs j
             WHERE j.id = _job_id
               AND (j.helper_id = _receiver OR j.offered_to_helper_id = _receiver)
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
               AND (j.customer_id = auth.uid()
                    OR j.helper_id = auth.uid()
                    OR j.offered_to_helper_id = auth.uid())
           )
           OR EXISTS (
             SELECT 1 FROM public.group_job_helpers g
             WHERE g.job_id = _job_id AND g.helper_id = auth.uid()
           )
         )
       )
       -- An applicant, and ONLY when the caller is the job's poster (owner
       -- decision 2026-09-14). An ownerless job (customer_id NULL) matches
       -- nobody here.
       OR (
         EXISTS (
           SELECT 1 FROM public.jobs j
           WHERE j.id = _job_id AND j.customer_id = auth.uid()
         )
         AND EXISTS (
           SELECT 1 FROM public.applications a
           WHERE a.job_id = _job_id AND a.helper_id = _receiver
         )
       )
     );
$function$
$fn$;

  COMMENT ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) IS
    'Messages INSERT policy receiver gate: true only when the CALLER (auth.uid()) '
    'may post in the job, is not blocked with _receiver, is under the 30/hour '
    'send cap, and _receiver is the poster, or the Helpr/offered Helpr/roster '
    'member when the caller is one of the poster/Helpr/offered/roster, or an '
    'applicant when the caller is the poster. Replaces the policy call to '
    'is_party_to_job, which has no client EXECUTE (20260914210443).';

  -- Called from the messages INSERT policy, which runs as the requesting role.
  REVOKE ALL ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) TO authenticated, service_role;

  -- ── 2. The send policy: live 20260914201350 WITH CHECK, one call swapped ──
  DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
  CREATE POLICY "Users can send messages"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = sender_id
    AND public.can_send_message_in_job(job_id)
    AND public.can_send_message_to_in_job(job_id, receiver_id)
    AND (
      attachment_url IS NULL
      OR (
        split_part(attachment_url, '/', 1) = job_id::text
        AND split_part(attachment_url, '/', 2) = sender_id::text
        AND split_part(attachment_url, '/', 3) <> ''
        AND split_part(attachment_url, '/', 4) = ''
      )
      OR (
        split_part(attachment_url, '/', 1) = 'voice-notes'
        AND split_part(attachment_url, '/', 2) = job_id::text
        AND split_part(attachment_url, '/', 3) = sender_id::text
        AND split_part(attachment_url, '/', 4) <> ''
        AND split_part(attachment_url, '/', 5) = ''
      )
    )
  );

  -- ── 3. Only now, with no policy calling it: is_party_to_job is internal ──
  -- Roles named explicitly: FROM PUBLIC alone leaves anon's and authenticated's
  -- own grants in place.
  REVOKE ALL ON FUNCTION public.is_party_to_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.is_party_to_job(uuid, uuid) TO service_role;
END
$migration$;

-- Don't leak the 5s lock_timeout into any later migration in the same push.
RESET lock_timeout;
