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
-- definition. So it binds the CALLER instead:
--   can_send_message_to_in_job(job, receiver) =
--     auth.uid() IS NOT NULL
--     AND NOT is_caller_banned()                   -- as trg_ban_gate_messages
--     AND can_message_in_job(job, auth.uid())      -- caller may post here
--     AND is_party_to_job(job, receiver)           -- receiver is on the job
-- What a client can still learn by calling it: for a job it may ALREADY post
-- in (poster, assigned/offered Helpr, roster, or messaged by the poster), and
-- while that thread is open, whether a given user is a party. That is exactly
-- what the INSERT policy itself already reveals to the same caller by
-- accepting or refusing a message to that receiver, so the wrapper adds no
-- oracle the table does not already have. A signed-in stranger, or anyone on
-- a job they cannot post in, gets false for every user id.
-- The ban check mirrors trg_ban_gate_messages (enforce_ban_gate raises
-- account_restricted for every uid-bearing INSERT by a banned caller, before
-- the policy runs), so a banned account cannot keep asking through the RPC.
-- Accepted residuals, both limited to a job the caller may already post in:
-- the block trigger (enforce_block_on_message_insert) and the 30/hour
-- enforce_message_rate also fire before the policy, and the wrapper models
-- neither, so a caller can learn whether someone who blocked them is a party,
-- and can ask more than 30 times an hour.
--
-- The INSERT outcome is unchanged: the policy already required
-- (SELECT auth.uid()) = sender_id AND can_send_message_in_job(job_id), which
-- implies the wrapper's uid and can_message_in_job conjuncts, and a banned
-- caller's INSERT never reaches the policy (trg_ban_gate_messages raises
-- first). The WITH CHECK below is the live 20260914201350 definition
-- verbatim with only that one call swapped.
--
-- Scope: human INSERTs through RLS only. Service-role and SECURITY DEFINER
-- inserts (system pills, engagement automations) never evaluate this policy.
--
-- Replay-safe: CREATE OR REPLACE, DROP POLICY IF EXISTS, idempotent grants,
-- and the whole body is skipped (NOTICE) if any object it builds on is absent.
-- Every object referenced exists before this version (is_caller_banned
-- 20260824245000, is_party_to_job 20260904031655, can_message_in_job,
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
     OR to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'is_party_to_job / can_message_in_job / can_send_message_in_job / is_caller_banned / messages absent: skipped';
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
  -- this job learns anything about its parties; everyone else gets false.
  SELECT auth.uid() IS NOT NULL
     AND NOT public.is_caller_banned()
     AND public.can_message_in_job(_job_id, auth.uid())
     AND public.is_party_to_job(_job_id, _receiver);
$function$
$fn$;

  COMMENT ON FUNCTION public.can_send_message_to_in_job(uuid, uuid) IS
    'Messages INSERT policy receiver gate: true only when the CALLER (auth.uid()) '
    'may post in the job and _receiver is a party to it. Wraps the internal '
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
