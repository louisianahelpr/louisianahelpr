-- 24-hour post-completion messaging lockout (owner-approved, backlog #95).
--
-- Once a job is completed, the people on it get 24 hours to keep talking
-- (wrap-up questions, thanks, tips). After that the thread closes to new
-- human messages for EVERYONE on the job: poster, hired Helpr, group roster.
-- The app is never role-based, so neither is the lockout. Left open forever,
-- a finished job's chat is an unbounded off-platform coordination channel.
--
-- History: first drafted 2026-08-30 as 20260831053124 (never merged, lives on
-- origin/wip/messaging-lockout-2026-08-30) and redrafted 2026-09-12 as
-- 20260913051933 (local worktree only). Both are superseded by this file. Both
-- drafts measured completion as COALESCE(poster_completed_at,
-- helper_completed_at, updated_at), and that clock is WRONG for this purpose:
--   * auto-release-payment completes a job 24h AFTER helper_completed_at and
--     writes only status/payment_status/payout_scheduled_at. The helper stamp
--     is already 24h old at that instant, so the thread would close the very
--     moment the job completed, with no window at all.
--   * auto-resolve-disputes and a revision round both complete a job long
--     after the original completion stamps, with the same result.
-- So this migration adds the one fact that was missing: jobs.completed_at,
-- stamped by the database whenever a row ENTERS status 'completed'.
--
-- Rebuilt against the LIVE definitions read with pg_get_functiondef /
-- pg_policies on 2026-09-14:
--   * can_message_in_job: the 4-branch body with the group-roster branch
--     (20260902035641). Kept verbatim; the lockout is ANDed in front.
--   * "Users can send messages" INSERT policy and the storage policy
--     "message-attachments: sender uploads to own path": both re-created from
--     their LATEST definition, 20260914200051 (on main, not yet applied on prod
--     at the 2026-09-14 read, where the policy was still the 20260904031655
--     form). Verbatim, TO authenticated, attachment_url path confinement kept,
--     except that every gate call is now can_send_message_in_job(<job>),
--     which reads auth.uid() itself. See section 3.
--     This file is stamped AFTER 20260914200051 on purpose: run before it, that
--     migration would re-create the old policies over these.
--
-- can_message_in_job(_job_id, _sender) took the sender as a PARAMETER and
-- authenticated held EXECUTE on it (live proacl 2026-09-14), so any signed-in
-- user could call it as an RPC with someone else's id and learn who is on a
-- job, and now whether its thread has closed. Its callers: the messages INSERT
-- policy (live) and the message-attachments upload policy (20260914200051).
-- Live scan 2026-09-14: no view, materialized view, trigger or function in any
-- schema references it, and no client or edge function calls it. A policy runs
-- its functions as the requesting role, so EXECUTE could not simply be
-- revoked. Instead both policies call a one-argument wrapper that uses
-- auth.uid() (the value they already passed), and the two-argument function
-- loses every client grant.
--
-- Scope: human INSERTs through RLS only. System pills
-- (insert_job_status_system_message, SECURITY DEFINER), service-role inserts
-- (engagement-automations, admin tooling) and admin reads never pass through
-- this WITH CHECK and are unaffected. Reads, edits and deletes of earlier
-- messages are unaffected.
--
-- Edits are DELIBERATELY exempt. The lockout gates new INSERTs only; the
-- "Users can edit their own sent messages" UPDATE policy (sender, non-system,
-- within 15 minutes of sending) is left as it is. The worst case is a message
-- sent just before the close being edited up to 15 minutes after it, still
-- content-scanned on edit (scan_message_on_edit). Closing that would mean
-- re-deriving the UPDATE policy for no real exposure.
--
-- Client: get_messaging_closes_at(uuid[]) hands the app the SAME instant the
-- gate uses, so the composer is replaced by a read-only notice exactly when
-- the server starts refusing. A client running before this migration deploys
-- gets PGRST202 and shows no notice, which matches a server with no lockout.
--
-- Backfill: every job already completed gets completed_at from its best real
-- completion signal (section 1b), so an old thread closes on that clock and a
-- later write to the row (photo proof, edit, a sweep bumping updated_at) can
-- never reopen it. 17 rows on prod at 2026-09-14, all with both party stamps (1 with revision_completed_at).
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF
-- EXISTS, a backfill that only touches rows still NULL, idempotent grants.
-- Every object referenced (jobs, messages, group_job_helpers,
-- is_party_to_job) exists before this version.

-- Fail fast rather than queue behind live traffic: every ALTER TABLE below
-- needs a lock on public.jobs (and DROP/CREATE POLICY one on public.messages and storage.objects),
-- and a lock request waiting in the queue blocks every read and write that
-- arrives after it. 5s, then the deploy fails and can simply be re-run.
SET lock_timeout = '5s';

-- ── 1. The completion clock ────────────────────────────────────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN public.jobs.completed_at IS
  'When this job last entered status completed. Stamped by '
  'zz_jobs_stamp_completed_at; not client-writable. Backfilled for jobs '
  'completed before 20260914201350. Drives the 24h messaging lockout.';

-- Named zz_ so it is the LAST BEFORE trigger on jobs (Postgres fires them in
-- name order). Two consequences, both wanted: the column-lock triggers ahead
-- of it (enforce_poster_jobs_money_lock, enforce_helper_jobs_column_whitelist,
-- prevent_job_field_escalation) never see a value this trigger changed and so
-- never mistake it for a client write; and whatever a client put in
-- completed_at is overwritten after every other trigger has run.
CREATE OR REPLACE FUNCTION public.stamp_job_completed_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  -- A trusted server write: no end-user uid AND not a client JWT role. A
  -- tokenless anon request also has a NULL uid, so the uid alone is not
  -- enough. service_role edge functions, postgres (migrations,
  -- `supabase db query`) and pg_cron all pass.
  v_server boolean := auth.uid() IS NULL
    AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated');
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A server write may insert an already-completed row with its own clock
    -- (fixtures); everyone else gets the database clock or nothing.
    IF NEW.status = 'completed' THEN
      IF NOT v_server OR NEW.completed_at IS NULL THEN
        NEW.completed_at := now();
      END IF;
    ELSIF NOT v_server THEN
      NEW.completed_at := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Server-side explicit write: honoured. This is the only way to backdate a
  -- row, e.g. a seed job for the lockout proof.
  IF v_server AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    NEW.completed_at := now();
  ELSE
    NEW.completed_at := OLD.completed_at;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_job_completed_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_jobs_stamp_completed_at ON public.jobs;
CREATE TRIGGER zz_jobs_stamp_completed_at
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.stamp_job_completed_at();

-- ── 1b. Backfill jobs completed before this migration ──────────────────────
-- One expression, shared by the backfill and by job_messaging_closes_at's
-- guard fallback, so the two can never disagree.
CREATE OR REPLACE FUNCTION public.job_legacy_completed_at(
  _poster_completed_at timestamptz,
  _helper_completed_at timestamptz,
  _revision_completed_at timestamptz,
  _updated_at timestamptz
)
 RETURNS timestamptz
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _poster_completed_at IS NOT NULL AND _helper_completed_at IS NOT NULL
      THEN GREATEST(_poster_completed_at, _helper_completed_at, _revision_completed_at)
    WHEN _poster_completed_at IS NOT NULL OR _helper_completed_at IS NOT NULL
      THEN GREATEST(_poster_completed_at, _helper_completed_at) + interval '24 hours'
    ELSE _updated_at
  END;
$function$;

-- Internal: called by the migration and by SECURITY DEFINER code only.
REVOKE ALL ON FUNCTION public.job_legacy_completed_at(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_legacy_completed_at(timestamptz, timestamptz, timestamptz, timestamptz) TO service_role;

-- Best real completion signal (public.job_legacy_completed_at below):
--   1. BOTH party stamps present: the job completed when the SECOND one
--      landed (whichever party confirmed last), or when a revision round
--      finished after that: GREATEST(poster, helper, revision_completed_at).
--      Covers the poster marking done first and the Helpr confirming later.
--   2. ONE party stamp only: nobody confirmed the other side, so
--      auto-release-payment completed it 24h after that stamp (its query is
--      poster_completed_at <= cutoff OR helper_completed_at <= cutoff):
--      GREATEST(poster, helper) + 24h. Covers poster-only and Helpr-only.
--   3. Neither stamp: updated_at, the last resort.
-- The UPDATE runs with every currently-enabled user trigger on jobs switched
-- off, so it bumps no updated_at, fires no notification trigger and trips no
-- column lock. Atomicity: the whole block is ONE statement, so an error
-- anywhere in it (including in a re-enable) rolls back every trigger change
-- with it, whether or not the CLI wraps the file in a transaction.
-- Isolation: ALTER TABLE ... DISABLE/ENABLE TRIGGER takes a SHARE ROW
-- EXCLUSIVE lock on jobs, held to the end of the transaction. That blocks
-- concurrent INSERT/UPDATE/DELETE on jobs (reads continue), and the catalog
-- change is invisible to other sessions until commit, by which point every
-- trigger is enabled again. So no other session ever writes to jobs with its
-- triggers off. Triggers that were already disabled stay disabled (only the
-- ones this block turned off are turned back on). Internal constraint
-- (FK) triggers are not in the list (NOT tgisinternal) and are never touched.
DO $backfill$
DECLARE
  v_triggers text[];
  t text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.jobs WHERE status = 'completed' AND completed_at IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT coalesce(array_agg(tgname ORDER BY tgname), '{}') INTO v_triggers
  FROM pg_trigger
  WHERE tgrelid = 'public.jobs'::regclass AND NOT tgisinternal AND tgenabled = 'O';

  FOREACH t IN ARRAY v_triggers LOOP
    EXECUTE format('ALTER TABLE public.jobs DISABLE TRIGGER %I', t);
  END LOOP;

  UPDATE public.jobs
     SET completed_at = public.job_legacy_completed_at(
                          poster_completed_at, helper_completed_at,
                          revision_completed_at, updated_at)
   WHERE status = 'completed' AND completed_at IS NULL;

  FOREACH t IN ARRAY v_triggers LOOP
    EXECUTE format('ALTER TABLE public.jobs ENABLE TRIGGER %I', t);
  END LOOP;
END
$backfill$;

-- ── 2. The one expression for "when does this thread close" ────────────────
-- NULL = the thread is not on a lockout clock (job not completed, or no job).
-- After the backfill and the trigger every completed row has completed_at;
-- the fallback is the backfill's own expression, kept only as a guard, and
-- deliberately NOT a GREATEST over updated_at, which a later row write could
-- move forward and reopen the thread with.
CREATE OR REPLACE FUNCTION public.job_messaging_closes_at(_job_id uuid)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
           j.completed_at,
           public.job_legacy_completed_at(j.poster_completed_at, j.helper_completed_at,
                                          j.revision_completed_at, j.updated_at)
         ) + interval '24 hours'
  FROM public.jobs j
  WHERE j.id = _job_id
    AND j.status = 'completed';
$function$;

-- Internal: only ever called from the SECURITY DEFINER functions below, which
-- run as the owner. No client role needs EXECUTE.
REVOKE ALL ON FUNCTION public.job_messaging_closes_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_messaging_closes_at(uuid) TO service_role;

-- ── 3. The gate (live body + lockout) ──────────────────────────────────────
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
      -- 2. The helper this job is offered to, or already assigned to.
      --    NULL-safe: `= _sender` is never true when the column is NULL, so an
      --    un-offered, un-assigned job matches nobody here.
      OR EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = _job_id
          AND (j.offered_to_helper_id = _sender OR j.helper_id = _sender)
      )
      -- 3. A member of this job's group roster. `jobs.helper_id` names only the
      --    FIRST helper accepted onto a crew, so branch 2 covers exactly one of
      --    N. This is the other N-1.
      OR EXISTS (
        SELECT 1 FROM public.group_job_helpers g
        WHERE g.job_id = _job_id AND g.helper_id = _sender
      )
      -- 4. The poster messaged THIS sender first.
      OR EXISTS (
        SELECT 1
        FROM public.messages m
        JOIN public.jobs j ON j.id = m.job_id
        WHERE m.job_id = _job_id
          AND m.sender_id = j.customer_id
          AND m.receiver_id = _sender
      )
    );
$function$;

-- The caller's own answer only: the sender is auth.uid(), never a parameter.
CREATE OR REPLACE FUNCTION public.can_send_message_in_job(_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND public.can_message_in_job(_job_id, auth.uid());
$function$;

-- Called from the messages INSERT and attachment upload policies, which run as
-- the requesting role.
REVOKE ALL ON FUNCTION public.can_send_message_in_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_send_message_in_job(uuid) TO authenticated, service_role;

-- 20260914200051's WITH CHECK verbatim, gate swapped for the wrapper.
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = sender_id
  AND public.can_send_message_in_job(job_id)
  AND public.is_party_to_job(job_id, receiver_id)
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

-- 20260914200051's upload policy verbatim, gate swapped for the wrapper (the
-- sender it passed was already (SELECT auth.uid())). Skipped, like there, when
-- the storage schema is absent. An upload into a closed thread is refused
-- too, consistent with the message it would be attached to.
DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects absent: upload policy skipped';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "message-attachments: sender uploads to own path" ON storage.objects;
  CREATE POLICY "message-attachments: sender uploads to own path"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'message-attachments'
    -- Nested CASE, not AND, so the ::uuid cast only runs once the regex has
    -- matched (AND gives no evaluation-order guarantee).
    AND CASE
      -- voice-notes/<job_id>/<sender_id>/<file>
      WHEN (storage.foldername(name))[1] = 'voice-notes' THEN
        CASE
          WHEN (storage.foldername(name))[3] = (SELECT auth.uid())::text
               AND (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN public.can_send_message_in_job(((storage.foldername(name))[2])::uuid)
          ELSE false
        END
      -- <job_id>/<sender_id>/<file>
      ELSE
        CASE
          WHEN (storage.foldername(name))[2] = (SELECT auth.uid())::text
               AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN public.can_send_message_in_job(((storage.foldername(name))[1])::uuid)
          ELSE false
        END
    END
  );
END
$storage$;

-- Only now, with neither policy referring to it any more: can_message_in_job is
-- internal, and no client role may call it with an arbitrary sender id.
REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO service_role;

-- ── 4. Client read: when does each of my threads close ─────────────────────
-- Returns a row only for completed jobs whose THREAD the caller is on: poster,
-- assigned/offered Helpr, roster member, or anyone who sent or received a
-- message on the job. Not is_party_to_job, which also admits every applicant:
-- an applicant who was never hired and never messaged has no thread to lock
-- and no business learning when the job was completed.
-- A job id the caller has no business with returns nothing, not an error.
-- server_now is the database clock at read time: the client uses it to correct
-- a device clock that runs fast or slow, so the notice appears when the gate
-- closes, not when the phone thinks it does. At most 500 ids per call.
-- The DROP is for replay only: CREATE OR REPLACE cannot change a RETURNS TABLE
-- shape, and an unmerged draft of this RPC may exist somewhere with fewer
-- columns. Nothing depends on it at this version.
DROP FUNCTION IF EXISTS public.get_messaging_closes_at(uuid[]);
CREATE FUNCTION public.get_messaging_closes_at(_job_ids uuid[])
 RETURNS TABLE(job_id uuid, closes_at timestamptz, server_now timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT j.id, public.job_messaging_closes_at(j.id), now()
  FROM public.jobs j
  WHERE j.id = ANY (_job_ids)
    AND cardinality(_job_ids) <= 500
    AND j.status = 'completed'
    AND auth.uid() IS NOT NULL
    AND (
      auth.uid() IN (j.customer_id, j.helper_id, j.offered_to_helper_id)
      OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                 WHERE g.job_id = j.id AND g.helper_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.messages m
                 WHERE m.job_id = j.id
                   AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid()))
    );
$function$;

REVOKE ALL ON FUNCTION public.get_messaging_closes_at(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_messaging_closes_at(uuid[]) TO authenticated, service_role;

-- Don't leak the 5s lock_timeout into any later migration in the same push.
RESET lock_timeout;
