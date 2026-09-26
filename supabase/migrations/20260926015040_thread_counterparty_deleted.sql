-- Q333 / Q334 (docs/OPEN.md): tell a thread's participant whether the other
-- party of that thread has DELETED their account.
--
-- Why a server read: the client's only other signal is get_safe_profiles
-- returning no row, and that is also what a banned, unverified or anonymised
-- person looks like. Saying "This account has been deleted" about a banned
-- user would be false. Deletion removes the auth.users row (delete-own-account
-- -> auth.admin.deleteUser), and the profile goes with it, so "no auth user and
-- no profile under either id" is exactly deleted.
--
-- Who may ask: only someone with a thread on the job (poster, hired or offered
-- Helpr, crew member, applicant, or a sender/receiver of any message on it).
-- Anyone else gets false, never an error.
--
-- What it discloses (lh-authz-rls review, 2026-09-26, accepted): only the
-- CALLER is scoped, not _other. A deleted account leaves no row tying it to
-- the job (its applications, crew rows and messages cascade away), so _other
-- cannot be scoped after the fact. Any member on some job can therefore learn,
-- for a UUID they already hold, "no account" vs "an account exists". Combined
-- with get_safe_profiles that separates "exists but hidden (banned, unverified,
-- anonymised)" from "gone" — one bit, never which hidden state, and only for an
-- unguessable v4 UUID. Nothing about who a live account is.
--
-- Also: an id that NEVER existed reads as deleted (true). A hand-typed or
-- corrupted deep link therefore opens a read-only "Former member" thread;
-- nothing sendable to a live person is ever locked by it.
--
-- Consumers: src/lib/deletedCounterparty.ts fetchCounterpartyDeleted (deep-link
-- fallback in loadConversations.ts, refused send in sendHandlers.ts).
-- Guard: src/test/messagesReceiverNullable.test.ts.

CREATE OR REPLACE FUNCTION public.get_thread_counterparty_deleted(_job_id uuid, _other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND _job_id IS NOT NULL
    AND _other IS NOT NULL
    AND _other IS DISTINCT FROM auth.uid()
    -- The caller has a thread on this job.
    AND (
      EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.id = _job_id
          AND auth.uid() IN (j.customer_id, j.helper_id, j.offered_to_helper_id)
      )
      OR EXISTS (
        SELECT 1 FROM public.group_job_helpers g
        WHERE g.job_id = _job_id AND g.helper_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.applications a
        WHERE a.job_id = _job_id AND a.helper_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.messages m
        WHERE m.job_id = _job_id
          AND (m.sender_id = auth.uid() OR m.receiver_id = auth.uid())
      )
    )
    -- The other party is gone: no auth user, and no profile under either of
    -- the person's two ids (a deep link may carry profiles.id).
    AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _other)
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.user_id = _other OR p.id = _other
    );
$function$;

COMMENT ON FUNCTION public.get_thread_counterparty_deleted(uuid, uuid) IS
  'Q333/Q334: true only when the caller has a thread on _job_id and _other has '
  'no auth.users row and no profile (a deleted account). False otherwise, '
  'including for a caller with no business on the job.';

REVOKE ALL ON FUNCTION public.get_thread_counterparty_deleted(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_thread_counterparty_deleted(uuid, uuid) TO authenticated, service_role;
