-- Three trust/safety gaps, all sharing the same root cause: a check that
-- validates one side of a relationship and assumes the other side is fine.
--
-- 1. UNSOLICITED MESSAGING. `messages`' INSERT policy validates only the
-- SENDER via can_message_in_job(job_id, sender) — branch 1 of that function
-- passes for ANY job's poster, with no check on who the RECEIVER is. A
-- poster who has posted at least one job could message any user_id they
-- could read off a public profile or browse card, with no relationship to
-- that person at all. Reproduced live: every gate passed for a poster and a
-- deliberately unrelated third party.
--
-- Fixed by adding `is_party_to_job(job_id, receiver_id)`, the same shape of
-- check already required of the sender, to the receiver. "Party to a job"
-- deliberately includes its applicants — that is the legitimate case this
-- migration must not break: a poster messaging someone who applied, before
-- accepting them.
--
-- 2. BLOCK ENFORCEMENT REACHED ONLY ONE TABLE. `are_users_blocked()` had
-- exactly one caller in the whole schema (`enforce_block_on_message_insert`
-- on `messages`). A block did nothing to stop the blocked party from still
-- applying to the blocker's jobs, or the blocker from still sending them a
-- direct offer. Both are now gated the same way messages already were.
--
-- 3. PRIVATE NOTE LEAK. `favorite_helpers.private_note` is a poster's note
-- about a helper THEY wrote, for THEIR own use. RLS is row-level, not
-- column-level, so the "Helpers can see who favorited them" policy handed
-- the helper the entire row, note included — proven live. Nothing in the
-- client or in any edge function reads this table from the helper's side
-- (grep confirmed: SaveHelperButton.tsx and useSavedHelpers.ts are both
-- customer-only reads; the one edge-function reader,
-- saved-helper-availability-push, runs as service_role and is unaffected).
-- So the policy defended a feature that does not exist. Dropped rather than
-- patched around — if a real "someone favorited you" feature is ever built,
-- it should read through a view that projects everything except
-- private_note, not the raw table.

-- ── 1 & partial-2: is_party_to_job(), used by the messages fix ────────────
CREATE OR REPLACE FUNCTION public.is_party_to_job(_job_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = _job_id
        AND (j.customer_id = _user_id
             OR j.helper_id = _user_id
             OR j.offered_to_helper_id = _user_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.group_job_helpers g
      WHERE g.job_id = _job_id AND g.helper_id = _user_id
    )
    -- An applicant is a legitimate message target for the poster BEFORE any
    -- hire decision — this is the exact case the exploit's own reachability
    -- depended on (a poster messaging someone who hadn't applied at all).
    OR EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.job_id = _job_id AND a.helper_id = _user_id
    );
$function$;

COMMENT ON FUNCTION public.is_party_to_job(uuid, uuid) IS
  'True when _user_id has a legitimate reason to be contacted about _job_id: '
  'poster, assigned/offered helper, group-roster member, or applicant. Added '
  '20260904031655 to close messages'' receiver-side gap — can_message_in_job '
  'validated only the sender.';

-- Called from inside the messages RLS WITH CHECK below, which runs as
-- `authenticated`. Supabase's advisor pass strips the default PUBLIC EXECUTE
-- grant from new functions (the #355/#358/#364/#366 saga this repo's own
-- grant guard exists to catch) — an unguarded function here would silently
-- break every message send the moment that advisor next runs.
GRANT EXECUTE ON FUNCTION public.is_party_to_job(uuid, uuid) TO authenticated;

-- ── 1: close the unsolicited-messaging gap ────────────────────────────────
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
CREATE POLICY "Users can send messages" ON public.messages
  FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = sender_id
    AND can_message_in_job(job_id, (SELECT auth.uid()))
    AND is_party_to_job(job_id, receiver_id)
  );

-- ── 2a: applications — a blocked user cannot apply to the blocker's job ───
DROP POLICY IF EXISTS "Helpers can create applications" ON public.applications;
CREATE POLICY "Helpers can create applications" ON public.applications
  FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = helper_id
    AND status = 'pending'::application_status
    AND NOT are_users_blocked(
      helper_id,
      (SELECT customer_id FROM public.jobs WHERE id = job_id)
    )
  );

-- ── 2b: jobs — a poster cannot direct-offer to someone they've blocked (or
-- who has blocked them). Only the INSERT-time offer needs this: the UPDATE
-- path that could otherwise re-target offered_to_helper_id is already fully
-- locked by enforce_helper_jobs_column_whitelist / the poster money lock.
DROP POLICY IF EXISTS "Customers can create jobs" ON public.jobs;
CREATE POLICY "Customers can create jobs" ON public.jobs
  FOR INSERT
  WITH CHECK (
    auth.uid() = customer_id
    AND (idv_requirement_paused() OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid() AND p.idv_status = 'verified'::text
    ))
    AND business_id IS NULL
    AND (offered_to_helper_id IS NULL OR NOT are_users_blocked(customer_id, offered_to_helper_id))
  );

-- ── 3: private note leak ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Helpers can see who favorited them" ON public.favorite_helpers;
