-- Two write paths raced poster_cancel_job() and lost, PROVEN on prod
-- 2026-09-13 (terminal 3, seed accounts poster-e2e / helper-e2e, 20 rounds each,
-- every fixture row deleted afterwards):
--
--   1. APPLY vs CANCEL — 14 of 20 rounds. enforce_application_job_state() read
--      the job with a plain SELECT, saw 'open', and returned NEW. The INSERT then
--      blocked on the FK's KEY SHARE lock behind poster_cancel_job()'s
--      SELECT ... FOR UPDATE, and committed AFTER the cancel: a 'pending'
--      application on a 'cancelled' job, plus a "New application" notification
--      to a poster who had just cancelled it. Proof of interleaving: the job
--      row's xmin (the cancel transaction) was LOWER than the application row's
--      xmin in every bad round (e.g. 2150621 < 2150622).
--
--   2. CONFIRM vs CANCEL — 5 of 20 rounds. The helper's accept of a plain
--      (non-direct) offer is a client UPDATE jobs SET helper_confirmed_at = now()
--      WHERE id = $1 AND helper_confirmed_at IS NULL (useOfferHandlers.ts) —
--      no status predicate. When it queued behind the cancel, READ COMMITTED
--      re-evaluated its WHERE on the cancelled row (helper_confirmed_at still
--      NULL), so it stamped a CANCELLED job as confirmed. poster_cancel_job had
--      already decided v_committed = false under its lock: cancellation_fee 0,
--      no strike, and a "no cancellation fee applies" notification to the
--      helper. But void-cancelled-payments recomputes the fee from
--      helper_id + helper_confirmed_at (helperIsCommitted) — the same row now
--      says COMMITTED, so the hourly cron would capture 25–50% of the budget
--      from the poster and transfer it to the helper, for a cancel the RPC
--      recorded as free. One fact, two readers, two answers.
--
-- The direct-offer path (respond_to_direct_offer) was raced too and held,
-- 0 of 20: both it and poster_cancel_job take SELECT ... FOR UPDATE.
--
-- FIX
--   1. enforce_application_job_state(): read the job FOR SHARE. FOR SHARE
--      conflicts with FOR UPDATE and with FOR NO KEY UPDATE (any plain UPDATE
--      of the row), so the trigger now waits for an in-flight cancel/accept to
--      commit and then sees the committed status — 'cancelled' — and refuses.
--      The wait was already happening (the FK lock); it just came after the
--      status read instead of before it.
--   2. A BEFORE UPDATE trigger on jobs: helper_confirmed_at may only be stamped
--      while the row is 'open' (respond_to_direct_offer sets it together with
--      status = 'accepted') or 'accepted'. The UPDATE has the row lock by the
--      time BEFORE triggers run, so OLD is the post-cancel version and the
--      stamp is refused with 42501. Service-role writers (uid NULL) are exempt
--      like the neighbouring gates — no cron confirms on a helper's behalf.
--      The client also gains `.eq("status", "accepted")` on the same UPDATE so
--      the race resolves as "offer no longer available" (zero rows) rather than
--      an error toast; the trigger is the guarantee, the predicate is the UX.
--
-- Not fixed here because it is unreachable: "apply at the old price".
-- enforce_poster_jobs_money_lock() refuses a budget change once
-- payment_status <> 'unpaid', unfunded jobs are on no browse surface, and
-- applications carry no price column.

-- ── 1. Lock the job row while judging an application ────────────────────────
-- Same body as the live definition (2026-09-13) except for `FOR SHARE`.
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
  IF auth.uid() IS NULL THEN
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

REVOKE ALL ON FUNCTION public.enforce_application_job_state() FROM PUBLIC, anon;

-- ── 2. A confirmation may only land on a live job ───────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_confirm_on_live_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only real end-user sessions are judged, exactly as enforce_helper_award_gate
  -- and enforce_job_funded_before_award beside this one. No service-role path
  -- confirms on a helper's behalf.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only the stamping transition. Clearing it, or a re-save that leaves it as
  -- it was, is not a confirmation.
  IF NEW.helper_confirmed_at IS NULL OR OLD.helper_confirmed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- OLD is the row version this UPDATE locked — the one the concurrent cancel
  -- committed, if there was one. 'open' covers respond_to_direct_offer, which
  -- stamps the confirmation in the same UPDATE that awards the job.
  IF OLD.status::text NOT IN ('open', 'accepted') THEN
    RAISE EXCEPTION 'job_not_confirmable'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer open or awaiting your confirmation (status=' || OLD.status::text || ').';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_confirm_on_live_job() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_confirm_on_live_job ON public.jobs;
CREATE TRIGGER trg_confirm_on_live_job
  BEFORE UPDATE OF helper_confirmed_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_confirm_on_live_job();
