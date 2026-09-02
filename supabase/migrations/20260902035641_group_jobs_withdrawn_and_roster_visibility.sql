-- Group jobs: withdraw the entry point, and close the two roster gaps that are
-- safe to close.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `accept_group_application` (20260804122000) fills `group_job_helpers` and
-- sets `jobs.helper_id` to the FIRST accepted helper, explicitly "so existing
-- payout/notification paths keep resolving". Only eleven places in the whole
-- repository know the roster table exists (`docs/audit/COVERAGE_2026-08-31.md`
-- §4.1); every other lifecycle surface reads the scalar `jobs.helper_id` as
-- "the helper". So helper #2 on a crew hits all five of these:
--
--   (a) cannot message the poster        — can_message_in_job
--   (b) cannot confirm / mark on-the-way / arrive / complete
--                                        — jobs UPDATE policy 20260312010219,
--                                          mark_helper_arrival,
--                                          helper_mark_on_the_way,
--                                          create-payment action:"release"
--   (c) job vanishes from their Activity — get_jobs_for_my_applications
--   (d) neither party can review         — reviews UNIQUE (job_id, reviewer_id)
--   (e) admin_release_dispute paid them nothing while marking the job settled
--
-- (e) is fixed in `create-payment` in the same commit (it now refuses a
-- multi-member roster instead of paying 1/N, mirroring release-payout:160).
-- (a) and (c) are fixed HERE. (b) and (d) are NOT, and this migration
-- deliberately does not attempt them — see the two notes at the bottom.
--
-- Because (b) and (d) remain, the poster-facing "Group" control is withdrawn in
-- the same commit (`src/lib/groupJobs.ts`), and §3 below makes that withdrawal
-- real rather than cosmetic.
--
-- BLAST RADIUS. Verified read-only against production 2026-09-01: `jobs` holds
-- exactly 2 rows with `is_group_job = true`, BOTH `is_seed = true` (one
-- cancelled, one open with a null payment intent), and `group_job_helpers` has
-- held ZERO rows for its entire history. Nothing here migrates data, and
-- nothing here can change the behaviour of a single-helper job.
--
-- REPLAY-SAFETY: every function is CREATE OR REPLACE, the trigger is dropped
-- before creation, and the grants are idempotent. Applies cleanly N times.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. (a) can_message_in_job — give the roster the channel their address
--        grant already assumes they have.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This is not a symmetry nicety. `user_may_see_job_address`
-- (20260831232513:122-125) ALREADY has a `group_job_helpers` branch, so a
-- roster member is handed the customer's street address. `can_message_in_job`
-- did not, and `messages` INSERT is gated on it ("Users can send messages"
-- WITH CHECK). The state that produced is: a helper standing outside a
-- stranger's house, holding its address, with no way to say "I'm here" or ask
-- which gate to use — and no way for the poster to reach them either, because
-- the poster's own branch is `j.customer_id = _sender` for a thread that
-- helper can never answer in.
--
-- The widening is strictly additive and reaches only people the job already
-- names: `accept_group_application` is the sole writer of
-- `group_job_helpers`, it requires `auth.uid() = jobs.customer_id`, and the
-- INSERT policy on that table requires the same. There is no path by which a
-- stranger appears on a roster.
--
-- `g.helper_id = _sender` is NULL-safe: 20260902014651 made that column
-- nullable (a roster slot whose helper deleted their account keeps the row and
-- loses the identity), and `NULL = _sender` is never true, so a departed
-- member matches nothing here.
--
-- Everything else about the function is carried over verbatim from
-- 20260820063000, including the deliberate omission of `applications`: merely
-- APPLYING still does not earn messaging rights.
CREATE OR REPLACE FUNCTION public.can_message_in_job(_job_id uuid, _sender uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
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
    );
$function$;

-- Keep the hardening from 20260819060000: anon must never hold EXECUTE.
REVOKE ALL ON FUNCTION public.can_message_in_job(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_message_in_job(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. (c) get_jobs_for_my_applications — stop the job disappearing the instant
--        the crew is complete.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The tail predicate was `customer_id = me OR helper_id = me OR status =
-- 'open'`. `accept_group_application` holds a group job at `status = 'open'`
-- while it is partially staffed and flips it to 'accepted' on the accept that
-- fills the LAST slot — so every roster member except the lead watched the job
-- drop out of their Activity tab at the exact moment the crew was finalised
-- and the work became real. Their `applications` row still said 'accepted';
-- there was simply no card left to look at, no address, no tracking, no
-- countdown, and nothing anywhere explaining where it went.
--
-- Adding the roster branch is additive and cannot widen a single-helper job:
-- the `EXISTS (applications …)` gate above is untouched, and a job with no
-- roster rows matches the new branch never. Address masking is unaffected —
-- it is already delegated to `user_may_see_job_address`, which has had its own
-- roster branch since 20260831232513, so this only stops hiding a row whose
-- address the caller was already entitled to see.
--
-- Body is otherwise byte-identical to 20260901033219, including the
-- `(r.rec).*` LATERAL shape (see that migration for why a bare
-- `RETURN QUERY SELECT jsonb_populate_record(...)` does not compile).
CREATE OR REPLACE FUNCTION public.get_jobs_for_my_applications()
RETURNS SETOF public.jobs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT (r.rec).*
  FROM public.jobs j
  CROSS JOIN LATERAL (
    SELECT public.user_may_see_job_address(j.id, v_uid) AS ok
  ) e
  CROSS JOIN LATERAL (
    SELECT jsonb_populate_record(
             NULL::public.jobs,
             to_jsonb(j) || jsonb_build_object(
               'location',
               CASE WHEN e.ok THEN j.location ELSE public.mask_job_location(j.location) END,
               'latitude',
               CASE WHEN e.ok THEN j.latitude ELSE ROUND(j.latitude, 2) END,
               'longitude',
               CASE WHEN e.ok THEN j.longitude ELSE ROUND(j.longitude, 2) END
             )
           ) AS rec
  ) r
  WHERE EXISTS (
          SELECT 1 FROM public.applications a
          WHERE a.job_id = j.id AND a.helper_id = v_uid
        )
    AND (
          j.customer_id = v_uid
          OR j.helper_id = v_uid
          OR j.status = 'open'
          -- A group roster member who is not the lead. NULL-safe as above.
          OR EXISTS (
               SELECT 1 FROM public.group_job_helpers g
               WHERE g.job_id = j.id AND g.helper_id = v_uid
             )
        );
END;
$$;

REVOKE ALL ON FUNCTION public.get_jobs_for_my_applications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_jobs_for_my_applications() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Make the withdrawal real: no NEW user-created group jobs.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Removing the segmented-control option (`src/lib/groupJobs.ts`) is not
-- sufficient, and the reason is Capacitor. This app ships its entire UI
-- BUNDLED INSIDE THE .ipa/.apk (capacitor.config.ts bundles `dist/`), so every
-- App Store build already on a phone keeps rendering the "Group" segment until
-- that user takes an update — weeks, for the ones who never do. A client-only
-- withdrawal therefore withdraws the feature from nobody who already has it.
--
-- The gate is deliberately scoped to `auth.uid() IS NOT NULL`, i.e. a request
-- carrying a real user's JWT. Service-role writes (auth.uid() IS NULL) pass
-- through untouched, which keeps working:
--   * the two `is_seed` fixtures and the seed/replay harnesses that maintain
--     them,
--   * every edge function that writes `jobs` (create-payment,
--     charge-recurring-visits, admin paths),
--   * any future backfill.
-- It fires only when the row is BECOMING a group job — an UPDATE that leaves
-- an existing group job group-shaped still passes, so the fixtures remain
-- editable and nothing that already exists is frozen.
--
-- The message is written to be read by a poster in a toast, because on an old
-- bundle that is exactly where it lands.
CREATE OR REPLACE FUNCTION public.reject_new_group_jobs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Only a real end-user request. Service role / cron / edge functions have a
  -- NULL auth.uid() and are unaffected.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.is_group_job IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.is_group_job IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Group jobs are temporarily unavailable. Post this as a one-time job and we''ll get it staffed.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_new_group_jobs ON public.jobs;
CREATE TRIGGER trg_reject_new_group_jobs
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.reject_new_group_jobs();

COMMENT ON FUNCTION public.reject_new_group_jobs() IS
  'Group jobs are withdrawn (2026-09-01). Blocks a user-authenticated INSERT or '
  'UPDATE that makes a job a group job, because the lifecycle behind it is '
  'single-helper only — see src/lib/groupJobs.ts for the five breakages. '
  'Service-role writes pass through, so seed fixtures and edge functions are '
  'unaffected. DROP this trigger in the migration that ships per-member '
  'lifecycle state on group_job_helpers.';

-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- (b) THE `jobs` UPDATE POLICY IS LEFT AT `USING (auth.uid() = helper_id)`.
--     Widening it to the roster is the change that looks smallest and is the
--     most dangerous one here. Both `enforce_helper_completion_gates` and
--     `enforce_helper_jobs_column_whitelist` (20260828011057) begin with
--     `IF auth.uid() IS DISTINCT FROM OLD.helper_id THEN RETURN NEW`. Those
--     early-returns are correct today ONLY because the policy already
--     guarantees the writer IS `OLD.helper_id`. Widen the policy and helpers
--     2..N fall straight through both triggers: they could set
--     `helper_completed_at` with no verified arrival, no proof photos and no
--     30-minute work floor, and write arbitrary `jobs` columns while doing it.
--     That converts a lockout into an escrow hole.
--
--     The prerequisite is a data-model change, not a policy edit. `jobs`
--     carries SCALAR `helper_confirmed_at`, `helper_on_the_way_at`,
--     `helper_arrived_at`, `helper_arrival_verified_at` and
--     `helper_completed_at`. There is nowhere to record that helper #2 arrived
--     but helper #3 has not, so the question "does a group job complete when
--     ALL helpers mark complete, or the first?" has no representable answer
--     yet. Those columns have to move onto `group_job_helpers` (per member),
--     `jobs.helper_completed_at` has to become derived (the MAX over the
--     roster, stamped only when every member is done), and both triggers have
--     to key off the roster row rather than `OLD.helper_id` — in one change,
--     with the policy, so the three cannot disagree.
--
-- (d) THE REVIEW GATES ARE LEFT ALONE. `reviews` carries
--     UNIQUE (job_id, reviewer_id), so a poster can leave exactly ONE review
--     per job however many people worked it. Making group reviews possible
--     means UNIQUE (job_id, reviewer_id, reviewee_id), which changes what
--     feeds the trust ladder, the tier calculation, the double-blind reveal
--     (20260506192638) and the review-nag cron. It is a deliberate decision
--     about the review model, not a predicate widening.
--
--     Correcting the record while we are here: `can_review_job` is NOT what
--     gates the review UI. No client surface calls it (the review chips read
--     `job.payment_status` directly — AppliedJobCard.tsx:494,
--     PostedJobActions.tsx:725). The real blockers are the
--     "Users can create reviews for eligible jobs" INSERT policy and the
--     `enforce_review_validity` trigger (20260504154800), both of which read
--     the scalar `jobs.helper_id`. Any future fix has to move all three
--     together.
