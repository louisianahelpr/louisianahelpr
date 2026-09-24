-- Q341. An application across a block is refused on write, and hidden on read.
--
-- WHAT WAS BROKEN (measured on prod fncmgoasalhdgfwzhsqa, 2026-09-24, read-only):
--
--   job 3c2028d5-7479-4c96-80b7-35e4f34254e9 (poster 96c9899e…) holds ONE
--   pending application, 4ce7742d…, from 76b07824…, who BLOCKED that poster on
--   2026-09-11 (user_blocks 4890f0ee…) and applied on 2026-09-22 anyway.
--   It is the only application across a block on all of prod
--   (applications JOIN jobs WHERE are_users_blocked(helper_id, customer_id) = 1,
--   status pending, job open).
--
--   WRITE. The INSERT policy "Helpers can create applications" does test
--   NOT are_users_blocked(helper_id, get_job_customer_id(job_id)) — but the app
--   applies through apply_to_job, which is SECURITY DEFINER and so bypasses RLS
--   entirely. apply_to_job itself never looks at user_blocks, and neither does
--   any BEFORE INSERT trigger on applications. The block check lived only in
--   the one path the app does not use.
--
--   READ. The poster's SELECT policy "Job owners can view applications for
--   their jobs" returns every application on their job, blocked or not. The
--   applicant panel (useApplicantsState) filtered blocked helpers out on the
--   client, but the three counters (useActivityData applicantCounts and
--   pendingApplicantCounts, useActivityBadgeCounts' posts badge) did not — so
--   /my-posts said "Applicants are waiting", "Applicants (1)", nav badge 1,
--   and the panel said "Still no applications".
--
-- THE FIX, one rule per layer, each in ONE place:
--
--   1. enforce_application_job_state (the BEFORE INSERT trigger every write
--      path goes through: apply_to_job, the client's direct-INSERT fallback,
--      respond_to_direct_offer, any raw PostgREST call) gains C10: no
--      application where helper and poster are blocked in either direction.
--      Same reasoning as C3 (20260921190002): the trigger already holds the
--      job row FOR SHARE with customer_id in hand, and it can name its reason.
--      The server-context early return is unchanged — a cron (charge-recurring-
--      visits) or an admin tool is not a helper tapping Apply.
--
--   2. The poster's SELECT policy excludes blocked applicants. That makes the
--      list and EVERY counter agree by construction, with no extra client
--      round trip: all poster-side reads of applications are PostgREST reads
--      under this policy (the only authenticated-callable function that counts
--      applications is apply_to_job, which counts the caller's own). Admins
--      keep their own policy; a helper still sees their own row.
--
-- THE EXISTING ROW is left in place: the applicant is not a test-owned account,
-- so it is not ours to delete or decline. The policy hides it from the poster,
-- so no counter shows it; it stays visible to the applicant as their own.
--
-- The function body below is verbatim from the live definition read with
-- pg_get_functiondef on 2026-09-24 (last redefined by 20260921190002), plus C10.
-- All existing RAISE codes are preserved (migrationRaiseCodesPreserved).
--
-- REPLAY-SAFETY: CREATE OR REPLACE for the function; DROP POLICY IF EXISTS +
-- CREATE POLICY for the policy; both idempotent. are_users_blocked predates
-- this file and is resolved at call time.

CREATE OR REPLACE FUNCTION public.enforce_application_job_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $function$
DECLARE
  v_job RECORD;
BEGIN
  -- Service-role writers run with no JWT. Same gate as the credential tier
  -- trigger beside this one: a cron spawning the next recurring visit, or an
  -- admin tool, is not a helper tapping Apply.
  --
  -- This early return is safe only because RLS excludes NULL-uid callers
  -- before the trigger fires: the sole INSERT policy on `applications` is
  -- TO authenticated with WITH CHECK (auth.uid() = helper_id), which is
  -- NULL -> false for an anon or sub-less token. If that policy is ever
  -- loosened, this line becomes a bypass.
  -- 20260915051905: no longer rests on that. An anon caller (NULL uid, role
  -- anon) is judged like any other client; only a server context passes.
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- FOR SHARE (added 2026-09-13): block behind any in-flight UPDATE of this
  -- job — poster_cancel_job's FOR UPDATE, accept_application, a status PATCH —
  -- and read the status THAT transaction committed, not the one before it.
  -- Without the lock, 14 of 20 applications fired alongside a cancel landed on
  -- the cancelled job (the FK's KEY SHARE made the INSERT wait, but only after
  -- this SELECT had already said 'open').
  SELECT j.status,
         j.customer_id,
         j.offered_to_helper_id,
         j.direct_offer_status,
         j.created_at,
         j.is_seed,
         j.date_needed,
         j.expires_at
    INTO v_job
    FROM public.jobs j
   WHERE j.id = NEW.job_id
   FOR SHARE;

  -- No row is the FK's problem, not ours; let it raise its own error.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- C2. A job outlives the person who posted it: account deletion anonymises
  -- rather than deletes and deliberately preserves `status`, so an ownerless
  -- job stays 'open' forever. Until now this was refused only because the
  -- notification trigger downstream could not address a NULL poster — a
  -- protection that would evaporate the moment that path was made
  -- null-tolerant, and which meanwhile showed the helper a raw NOT NULL
  -- constraint violation.
  IF v_job.customer_id IS NULL THEN
    RAISE EXCEPTION 'job_has_no_owner'
      USING ERRCODE = '42501',
            HINT = 'The person who posted this job has closed their account.';
  END IF;

  -- C3 (2026-09-21). You cannot apply to your own post. See the header: the
  -- INSERT policy never named customer_id, no constraint covered it, and the
  -- only enforcement lived inside the apply_to_job RPC — which the client's
  -- own PGRST202 fallback, and any direct PostgREST call, goes around.
  --
  -- Deliberately BEFORE the status/early-access/date checks: whatever else is
  -- wrong with the job, this is the reason the person can act on.
  --
  -- Compared against NEW.helper_id rather than auth.uid() so it holds for the
  -- SECURITY DEFINER paths too (apply_to_job, respond_to_direct_offer), where
  -- a row could be written for a helper_id other than the caller. A poster who
  -- direct-offers a job to themselves is refused here as well, which is
  -- correct: the row that offer would create is still a self-application.
  IF v_job.customer_id = NEW.helper_id THEN
    RAISE EXCEPTION 'cannot_apply_to_own_job'
      USING ERRCODE = '42501',
            HINT = 'You posted this job, so you cannot also apply to it.';
  END IF;

  -- C10 (2026-09-24, Q341). No application across a block, in either
  -- direction. The INSERT policy already said so, but apply_to_job is SECURITY
  -- DEFINER and never reaches the policy; this trigger is on every path. The
  -- code does not say who blocked whom — the helper gets the same sentence
  -- either way.
  IF public.are_users_blocked(NEW.helper_id, v_job.customer_id) THEN
    RAISE EXCEPTION 'applicant_blocked'
      USING ERRCODE = '42501',
            HINT = 'This job is not available to you.';
  END IF;

  -- C1. Every discovery surface requires status = 'open'.
  IF v_job.status <> 'open' THEN
    RAISE EXCEPTION 'job_not_open'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer accepting applications.';
  END IF;

  -- C4. A job under a live direct offer is private to the helper it was
  -- offered to. The feed withholds it; so must the write path.
  IF v_job.offered_to_helper_id IS NOT NULL
     AND v_job.direct_offer_status = 'pending'
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_reserved_for_another_helper'
      USING ERRCODE = '42501',
            HINT = 'This job has been offered directly to someone else.';
  END IF;

  -- C5. The Early Access perk. The targeted helper of a direct offer keeps the
  -- same escape hatch the four surfaces give them, so a person who was invited
  -- to a job can always answer it immediately.
  IF v_job.created_at > public.early_access_cutoff()
     AND v_job.offered_to_helper_id IS DISTINCT FROM NEW.helper_id THEN
    RAISE EXCEPTION 'job_in_early_access_window'
      USING ERRCODE = '42501',
            HINT = 'This job is in its Early Access window. Pro and Elite members can apply first.';
  END IF;

  -- C6. Fixture rows, on the shared switch — so when the flag is flipped at
  -- launch the seed jobs go quiet in the feed AND stop accruing real
  -- applications, instead of only the former.
  IF COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RAISE EXCEPTION 'job_not_available'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer available.';
  END IF;

  -- C8. A job whose day has passed is not workable. This IS a feed filter —
  -- `date_needed >= CURRENT_DATE` appears in get_ranked_open_jobs,
  -- get_public_open_jobs and get_open_jobs_for_map (not in open_jobs_browse) —
  -- which is why the TimeZone above has to match theirs exactly.
  IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN
    RAISE EXCEPTION 'job_date_has_passed'
      USING ERRCODE = '42501',
            HINT = 'The date this job was needed has already passed.';
  END IF;

  -- C9. Likewise an expired one. This is filtered on only ONE surface today
  -- (get_open_jobs_for_map), so enforcing it here is deliberately stricter
  -- than any feed currently implies — confirmed with the owner before shipping.
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RAISE EXCEPTION 'job_expired'
      USING ERRCODE = '42501',
            HINT = 'This job posting has expired.';
  END IF;

  RETURN NEW;
END;
$function$;

-- A trigger function is never called directly; restate the live ACL exactly
-- (postgres, service_role), with the explicit anon revoke CLAUDE.md requires.
REVOKE ALL ON FUNCTION public.enforce_application_job_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_application_job_state() TO service_role;

-- The poster's read. Live before this file (pg_policies, 2026-09-24):
--   TO authenticated USING ((SELECT auth.uid()) IN (SELECT jobs.customer_id
--   FROM jobs WHERE jobs.id = applications.job_id))
-- Same predicate, plus: not an applicant the poster is blocked with. One
-- definition for the applicant panel, "Applicants (N)", the "Needs you" bucket,
-- the nav badge and the job-dialog prefetch count.
DROP POLICY IF EXISTS "Job owners can view applications for their jobs" ON public.applications;
CREATE POLICY "Job owners can view applications for their jobs"
  ON public.applications FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IN (SELECT jobs.customer_id FROM public.jobs WHERE jobs.id = applications.job_id)
    AND NOT public.are_users_blocked(applications.helper_id, (SELECT auth.uid()))
  );
