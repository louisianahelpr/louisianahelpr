-- THE BEFORE PHOTO GATES "START WORKING" — ON THE SERVER, FIRST.
--
-- OWNER, 2026-09-19 (verbatim): "if a before photo is required they can't
-- press the working button until its done and same for a completed job for an
-- after photo."
--
-- THE AFTER HALF ALREADY EXISTED. `enforce_helper_completion_gates()` raises
-- `completion_requires_proof_photos` on the UPDATE that stamps
-- `helper_completed_at`, `rpc_helper_mark_done` pre-checks the same thing, and
-- JobTracking's Done step renders a disabled primary with the reason. Nothing
-- in that half moves here.
--
-- THE BEFORE HALF HAD NO SERVER RULE AT ALL. Verified read-only against prod
-- `fncmgoasalhdgfwzhsqa` on 2026-09-19 with
-- `pg_get_functiondef('public.enforce_job_tracking_arrival_gate()')`:
-- `job_tracking` carries exactly one non-internal trigger, and its `working`
-- branch was
--
--     IF NEW.status = 'working'
--        AND v_job.helper_completed_at IS NULL
--        AND v_job.poster_confirmed_arrival_at IS NULL THEN
--       RAISE EXCEPTION 'tracker_requires_arrival' …
--
-- — the poster's vouch, and nothing whatever about photos.
--
-- WHY THE SERVER RULE COMES FIRST, AND WHY THE CLIENT BLOCK WAITED ON IT. A
-- client-only block would make the app STRICTER than the database: a Helpr
-- whose upload fails (camera denied, storage error, offline) would be unable
-- to start a job the backend would happily have started, with no override
-- anywhere. That is precisely the class that produced the bad-GPS deadlock
-- removed earlier today in 20260919155016 — a Helpr told to wait for a control
-- that could not render. The standing rule is that the client never gates
-- ahead of the server, so the gate lands here and the disabled button lands in
-- the same commit behind it.
--
-- THE DEFINITION OF "REQUIRED" IS THE APP'S OWN, NOT A SECOND ONE.
-- `src/lib/photoProofPolicy.ts` `requiredProof(job).before` is:
--
--     job?.require_photo_proof === false  ->  before: false
--     otherwise                           ->  before: true
--
-- and `hasRequiredProof` satisfies it with `(beforeUrls?.length ?? 0) > 0`.
-- Mirrored here exactly:
--
--     COALESCE(v_job.require_photo_proof, true)
--       AND COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0
--
-- `jobs.require_photo_proof` is `boolean NOT NULL DEFAULT true` on prod, so the
-- COALESCE is belt-and-braces for replay against an older shape; it keeps the
-- TS `?? true` reading rather than inventing a third answer for NULL.
-- `proof_before_urls` is `text[] DEFAULT '{}'` and nullable, and
-- `array_length(x, 1)` is NULL for both NULL and '{}' — the COALESCE folds both
-- to 0, which is what `?? 0` does. The rule lives in TypeScript today; this is
-- a faithful mirror of it, said so out loud, not a fork. If the TS policy ever
-- grows a budget- or category-scoped carve-out, this predicate has to move with
-- it in the same commit.
--
-- A DISTINCT CODE, NOT `tracker_requires_arrival`. The two gates are cleared by
-- two completely different controls — the POSTER's "Confirm They Arrived" tap
-- and the HELPR's own "Before Photo" chip — and a Helpr shown the arrival
-- sentence for a missing photo would go and pester the poster for a tap that
-- changes nothing. `tracker_requires_before_photo`, with a HINT naming the
-- chip, and copy in `src/lib/lifecycleErrors.ts` keyed off the same string.
--
-- ORDER INSIDE THE WORKING BRANCH: arrival first, photo second. Two reasons.
-- (1) Chronology — the poster's confirmation is the earlier event, and it is
-- the bigger blocker; the client's reason chain resolves the same way round.
-- (2) `src/test/jobsGuardRpcParity.test.ts` reads the FIRST `IF NEW.status =
-- 'working' … END IF;` in this body as THE Working predicate and asserts it
-- names `poster_confirmed_arrival_at`. Putting the photo check first would
-- silently re-point that guard at a different rule — the same trap
-- 20260919192559 documented when the crew branch was drafted ahead of the
-- single-helper one. Do not reorder these.
--
-- ONLY THE BEFORE PHOTO, AND ONLY ON THE WORKING STEP. The after photo is NOT
-- required to start (there is no finished work to photograph); it is required
-- to finish, and that gate is already `enforce_helper_completion_gates()`.
-- The tracker's `done` step is untouched here for the same reason — it is a
-- mirror of a completion the jobs trigger already judges.
--
-- THE CREW BRANCH GETS THE SAME GATE. `proof_before_urls` is a JOB-level
-- column, and the client's `HelperPhotoAsk` reads it job-level too, so on a
-- group job the first crew member's Before photo clears the step for the whole
-- crew. That is what the data model says today, and this mirrors it rather than
-- inventing per-member photo storage the roster does not have. If per-member
-- proof is ever wanted, it is a column on `group_job_helpers` and a change
-- here and in `photoProofPolicy.ts` together.
--
-- BASED ON 20260919192559's roster-aware body, NOT on prod's. That migration is
-- merged and not yet deployed; rebuilding from prod's (pre-roster) definition
-- would silently revert the crew branch on deploy. Everything outside the two
-- new blocks below is verbatim from it.
--
-- REPLAY-SAFETY: one CREATE OR REPLACE on a function two earlier migrations
-- already define, plus a REVOKE guarded on the function existing. No DDL here
-- depends on an object a LATER migration defines, and re-running the file is a
-- no-op.

CREATE OR REPLACE FUNCTION public.enforce_job_tracking_arrival_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.jobs;
  -- Scalars, not a record: a %ROWTYPE of group_job_helpers would bind at CREATE
  -- time, and an unassigned `record` raises on field access when the SELECT
  -- finds nothing — which is exactly the case this has to test for.
  v_slot_id                  uuid;
  v_slot_arrived_at          timestamptz;
  v_slot_poster_arrival_at   timestamptz;
  v_slot_completed_at        timestamptz;
  -- The app's own rule (src/lib/photoProofPolicy.ts requiredProof().before),
  -- computed once so the two branches cannot drift from each other.
  v_needs_before_photo       boolean;
BEGIN
  -- Server-side writers (service role) are not constrained. The helper's
  -- on-the-way RPC writes 'on_the_way', which is not gated here. A NULL uid
  -- alone is not the service role — anon has one too (20260915101102).
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  -- FOR SHARE: the stamps this decides from must not change under it (the race
  -- class fixed in 20260913014328). helper_mark_on_the_way holds this jobs row
  -- FOR UPDATE when it writes 'on_the_way' here; a share lock taken by the same
  -- transaction does not wait on its own row lock.
  SELECT * INTO v_job FROM public.jobs WHERE id = NEW.job_id FOR SHARE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- MIRROR OF requiredProof(job).before && (beforeUrls?.length ?? 0) === 0.
  -- Read off the row this function already holds FOR SHARE, so the photo it
  -- judges cannot be deleted out from under the decision.
  v_needs_before_photo :=
    COALESCE(v_job.require_photo_proof, true)
    AND COALESCE(array_length(v_job.proof_before_urls, 1), 0) = 0;

  -- ── THE SINGLE-HELPER PATH, UNCHANGED ────────────────────────────────────
  -- Verbatim from prod, and FIRST in the function on purpose: the standing
  -- parity guard (src/test/jobsGuardRpcParity.test.ts) reads the FIRST Working
  -- branch in this body as THE Working predicate, so it must keep landing on
  -- the rule every real job runs, not on the crew rule below.
  IF v_job.is_group_job IS NOT TRUE THEN
    -- The row must belong to the job's assigned helper — on EVERY client write,
    -- position pings included.
    IF v_job.helper_id IS DISTINCT FROM NEW.helper_id THEN
      RAISE EXCEPTION 'tracker_not_assigned_helper' USING ERRCODE = '42501',
        HINT = 'Only the Helpr assigned to this job can update its tracker.';
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      -- Position pings (latitude/longitude/updated_at) never move a step.
      RETURN NEW;
    END IF;
    IF NEW.status NOT IN ('arrived', 'working', 'done') THEN
      RETURN NEW;
    END IF;

    IF NEW.status = 'arrived' AND v_job.helper_arrived_at IS NULL THEN
      RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
        HINT = 'Mark arrival at the job site first.';
    END IF;

    -- THE WORKING UNLOCK. Owner, 2026-09-19: "they can not start working until
    -- the poster confirms they are there … even if gps does confirm they are
    -- there the poster still needs ro cfnrm wither way". So this reads ONE
    -- stamp. The GPS half (helper_arrival_verified_at / the near-miss columns)
    -- is evidence shown to both parties, and no longer part of this predicate.
    IF NEW.status = 'working'
       AND v_job.helper_completed_at IS NULL
       AND v_job.poster_confirmed_arrival_at IS NULL THEN
      RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
        HINT = 'The person who posted this job has to tap Confirm They Arrived before you can start working.';
    END IF;

    -- THE BEFORE PHOTO (owner, 2026-09-19). Second, deliberately — see the
    -- header. `helper_completed_at IS NULL` carried over from the arrival gate
    -- for the same reason it is there: a job already marked complete is not
    -- re-gated by its tracker, so a late tracker write cannot strand a finished
    -- job behind a photo nobody can add any more.
    IF NEW.status = 'working'
       AND v_job.helper_completed_at IS NULL
       AND v_needs_before_photo THEN
      RAISE EXCEPTION 'tracker_requires_before_photo' USING ERRCODE = '23514',
        HINT = 'Tap Before Photo on this job and add one before you start working.';
    END IF;

    IF NEW.status = 'done'
       AND v_job.helper_completed_at IS NULL
       AND v_job.poster_completed_at IS NULL
       AND v_job.status IS DISTINCT FROM 'completed' THEN
      RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514',
        HINT = 'Mark the job complete first.';
    END IF;

    RETURN NEW;
  END IF;

  -- ── THE CREW BRANCH ──────────────────────────────────────────────────────
  SELECT g.id, g.helper_arrived_at, g.poster_confirmed_arrival_at, g.helper_completed_at
    INTO v_slot_id, v_slot_arrived_at, v_slot_poster_arrival_at, v_slot_completed_at
  FROM public.group_job_helpers g
  WHERE g.job_id = NEW.job_id AND g.helper_id = NEW.helper_id
  FOR SHARE;

  IF v_slot_id IS NULL THEN
    RAISE EXCEPTION 'tracker_not_assigned_helper' USING ERRCODE = '42501',
      HINT = 'Only a Helpr on this job''s crew can update its tracker.';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('arrived', 'working', 'done') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'arrived' AND v_slot_arrived_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'Mark arrival at the job site first.';
  END IF;

  IF NEW.status = 'working'
     AND v_slot_completed_at IS NULL
     AND v_slot_poster_arrival_at IS NULL THEN
    RAISE EXCEPTION 'tracker_requires_arrival' USING ERRCODE = '23514',
      HINT = 'The person who posted this job has to tap Confirm They Arrived before you can start working.';
  END IF;

  -- Same photo rule, same job-level column. Per-member ARRIVAL is a roster
  -- stamp (v_slot_*); per-member PROOF does not exist — `proof_before_urls`
  -- is on `jobs`, and the app reads it job-level too. So the crew's first
  -- Before photo clears this step for the crew, which is the honest reading of
  -- the shape we have. Gated on this member's own completion stamp so it
  -- matches the branch's other predicates.
  IF NEW.status = 'working'
     AND v_slot_completed_at IS NULL
     AND v_needs_before_photo THEN
    RAISE EXCEPTION 'tracker_requires_before_photo' USING ERRCODE = '23514',
      HINT = 'Tap Before Photo on this job and add one before you start working.';
  END IF;

  IF NEW.status = 'done'
     AND v_slot_completed_at IS NULL
     AND v_job.poster_completed_at IS NULL
     AND v_job.status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'tracker_requires_completion' USING ERRCODE = '23514',
      HINT = 'Mark your part complete first.';
  END IF;

  RETURN NEW;
END;
$function$;

-- EXECUTE STAYS REVOKED. Restated because prod's DEFAULT PRIVILEGES have
-- silently re-granted PUBLIC before (20260916030921), and a CREATE OR REPLACE
-- is exactly the moment that happens. A trigger function needs no client
-- EXECUTE at all — the trigger fires as the table's owner.
DO $$
BEGIN
  IF to_regprocedure('public.enforce_job_tracking_arrival_gate()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.enforce_job_tracking_arrival_gate() FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;
