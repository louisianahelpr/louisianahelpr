-- AR-013 / AR-014 / AR-015 — the apply path re-checks what the feed filters.
--
-- The four job-discovery surfaces (open_jobs_browse, get_ranked_open_jobs,
-- get_public_open_jobs, get_open_jobs_for_map) share a carefully kept WHERE
-- clause, and each of its conjuncts is a condition somebody decided mattered.
-- Only ONE of them was ever mirrored at the write path: credential_tier, by
-- enforce_application_credential_tier. Every other condition was enforced in
-- the feed and nowhere else, which means it was never enforced at all — a
-- discovery filter answers "should this be advertised", and the attacker
-- skips it by keeping a job id.
--
-- Probed against prod 2026-09-06, one job per condition, as a signed-in
-- helper who is not the poster:
--
--   C1 status='completed'                  => APPLY SUCCEEDED
--   C2 customer_id IS NULL (ownerless)     => died on a NOT NULL inside the
--                                             notify_on_application trigger —
--                                             closed by accident, not guarded
--   C4 pending direct offer to someone else=> APPLY SUCCEEDED
--   C5 inside the early-access window      => APPLY SUCCEEDED
--   C6 is_seed fixture row                 => APPLY SUCCEEDED
--   C7 credential_tier 2, viewer tier 0    => refused(credential_tier_required)
--   C8 date_needed yesterday               => APPLY SUCCEEDED
--   C9 expires_at yesterday                => APPLY SUCCEEDED
--
-- C4 and C5 are the sharp ones. C4 makes direct-offer privacy cosmetic: a job
-- withheld from every feed because it is under a live offer still accepts an
-- application from a helper it was never offered to. C5 is a PAID perk —
-- early_access_cutoff() is what Pro and Elite buy — and a free-tier helper
-- who reaches the job by shared link inside the window applies ahead of the
-- people who paid for the head start.
--
-- This trigger is modelled line-for-line on enforce_application_credential_tier:
-- same SECURITY DEFINER + pinned search_path, same auth.uid() IS NULL early
-- return so every service-role writer (recurring-visit spawns, admin tooling,
-- backfills) is untouched, same 42501 + human HINT. It loads the job once.
--
-- Each rule calls the SAME shared function the discovery surfaces call —
-- early_access_cutoff(), seed_jobs_hidden_publicly() — rather than restating
-- the threshold, so the perk and the launch switch keep one authority and a
-- change to either moves the feed and the write path together.
--
-- DELIBERATELY NOT HERE: payment_status. The funded gate is the third
-- conjunct of that shared WHERE clause and it is missing from the hiring chain
-- too, but it is owned by the unpaid-job-gate lane and is being fixed there.
-- It is absent by agreement, not by oversight — do not read this list as
-- complete without it.

CREATE OR REPLACE FUNCTION public.enforce_application_job_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
-- Matches get_ranked_open_jobs / get_public_open_jobs / get_open_jobs_for_map,
-- which all set this. Without it CURRENT_DATE below is UTC while the feeds'
-- is Central, so from ~18:00 CT every evening a same-day job would still be
-- listed in Browse and refused on Apply — the fix manufacturing the exact
-- offered-then-refused pattern it exists to remove.
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
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

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
   WHERE j.id = NEW.job_id;

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

-- Replay-safety: the table may not exist in a replay that predates it, and the
-- trigger may already be installed by an earlier apply of this same file.
DO $$
BEGIN
  IF to_regclass('public.applications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_application_job_state ON public.applications;
    CREATE TRIGGER trg_application_job_state
      BEFORE INSERT ON public.applications
      FOR EACH ROW EXECUTE FUNCTION public.enforce_application_job_state();
  END IF;
END $$;

-- House norm: name the roles explicitly. REVOKE ... FROM PUBLIC does NOT
-- revoke anon — Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every
-- new public function to anon, authenticated and service_role individually.
-- A trigger function is never invoked directly by a client, so nobody needs
-- EXECUTE on it.
REVOKE ALL ON FUNCTION public.enforce_application_job_state() FROM PUBLIC, anon, authenticated;
