-- Two defects that both come down to a NULL/default nobody meant as a rule.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. NOBODY COULD LEAVE A REVIEW. On any job. Ever.
--
-- `jobs.dispute_status` is `DEFAULT 'open'`, so every job is born "in dispute".
-- Both review gates carry the identical clause —
--
--     (dispute_status IS NULL OR dispute_status <> 'open'
--      OR dispute_resolved_at IS NOT NULL)
--
-- — which every default row fails on all three arms. The RLS policy and
-- `can_review_job()` agree with each other, so the entry point never renders
-- and nothing ever errors: it just silently does not happen. On a marketplace
-- whose trust model IS reviews, that is the most expensive kind of quiet bug.
--
-- Measured on prod before this migration: of the two completed + released jobs,
-- the one with no existing reviews returned can_review_job = false for BOTH the
-- poster and the helper, while meeting every other condition (in window, paid
-- out, no prior review). 43 of 43 jobs carried dispute_status='open'; exactly 1
-- was actually disputed.
--
-- `has_active_dispute` (NOT NULL DEFAULT false) is the column that genuinely
-- tracks disputes, so the gates move onto it. `dispute_status` keeps its
-- meaning as the WORKFLOW state of a dispute that exists, which is why its
-- default is dropped rather than re-pointed: absent a dispute the honest value
-- is NULL, not "open".
--
-- The backfill is bounded to rows that were never actually disputed, and was
-- cross-checked against the `disputes` table first: 0 dispute rows exist, so no
-- row with a real dispute can be cleared by it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AN ANONYMOUS CALLER COULD CLAIM ANY OPEN INSTANT-BOOK JOB.
--
-- `instant_book_claim` is SECURITY DEFINER and executable by `anon`. Its
-- poster guard is
--
--     IF v_customer_id = auth.uid() THEN RAISE ...
--
-- Plain `=`. For an anonymous caller `auth.uid()` is NULL, so that comparison
-- is NULL — not TRUE — and the IF does not fire. Every later guard passes for
-- an untargeted open job, and the final UPDATE runs
-- `helper_id = auth.uid()` → NULL. The job flips to 'accepted' with NO helper:
-- gone from browse, unclaimable by anyone real, and silently bricked.
--
-- Note the contrast with `accept_group_application`, which is also anon-
-- executable and is NOT vulnerable, because it wrote the same check as
-- `IS DISTINCT FROM` — NULL-safe, so it correctly rejects anon. That is the
-- whole difference, and it is why this fix uses an explicit NULL guard rather
-- than trusting a comparison to fail closed.
--
-- Belt and braces: the guard goes in AND `anon` loses EXECUTE on the two
-- mutating claim functions. Analytics writers (`record_job_view`,
-- `record_profile_view`) keep it — a logged-out visitor genuinely does view
-- jobs, and those write only view counters.

-- ── 1a. Stop minting "open" for jobs with no dispute ─────────────────────────
ALTER TABLE public.jobs ALTER COLUMN dispute_status DROP DEFAULT;

-- ── 1b. Backfill the rows that were never disputed ───────────────────────────
UPDATE public.jobs j
   SET dispute_status = NULL
 WHERE j.dispute_status = 'open'
   AND j.has_active_dispute = false
   AND j.dispute_resolved_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = j.id);

-- ── 1c. Gate reviews on the column that actually tracks disputes ─────────────
CREATE OR REPLACE FUNCTION public.can_review_job(_job_id uuid, _reviewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = _job_id
      AND (j.customer_id = _reviewer_id OR j.helper_id = _reviewer_id)
      AND j.status = 'completed'
      AND j.payment_status = 'released'
      -- An UNRESOLVED, ACTIVE dispute blocks review. A resolved one does not:
      -- the parties are exactly who should be able to speak once it is settled.
      AND (j.has_active_dispute = false OR j.dispute_resolved_at IS NOT NULL)
      AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.reviews r
        WHERE r.job_id = _job_id AND r.reviewer_id = _reviewer_id
      )
  );
$function$;

-- ── 1d. The RLS policy carries the same clause, so it moves too ──────────────
-- Both gates must agree: the function drives whether the UI offers the action,
-- the policy drives whether the insert lands. Fixing one alone would swap a
-- silent no-op for a visible error.
DROP POLICY IF EXISTS "Users can create reviews for eligible jobs" ON public.reviews;
CREATE POLICY "Users can create reviews for eligible jobs"
ON public.reviews FOR INSERT TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = reviewer_id
  AND EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.id = reviews.job_id
      AND ((j.customer_id = (SELECT auth.uid())) OR (j.helper_id = (SELECT auth.uid())))
      AND (
        ((j.customer_id = (SELECT auth.uid())) AND (j.helper_id = reviews.reviewee_id))
        OR ((j.helper_id = (SELECT auth.uid())) AND (j.customer_id = reviews.reviewee_id))
      )
      AND j.status = 'completed'::job_status
      AND j.payment_status = 'released'
      AND (j.has_active_dispute = false OR j.dispute_resolved_at IS NOT NULL)
      AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > (now() - '30 days'::interval)
  )
);

-- ── 2a. An anonymous caller can no longer claim anything ─────────────────────
CREATE OR REPLACE FUNCTION public.instant_book_claim(p_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status         text;
  v_helper_id      uuid;
  v_instant_book   boolean;
  v_customer_id    uuid;
  v_offered_to     uuid;
  v_uid            uuid := auth.uid();
BEGIN
  -- FIRST, before anything else. Every guard below compares against the
  -- caller's id, and a NULL id makes those comparisons NULL rather than false —
  -- which is how an anonymous caller used to walk past the poster check and
  -- land a job with helper_id = NULL.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  -- Lock the job row — concurrent claims serialize here.
  SELECT j.status, j.helper_id, j.instant_book, j.customer_id, j.offered_to_helper_id
    INTO v_status, v_helper_id, v_instant_book, v_customer_id, v_offered_to
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- A poster must never be able to claim their own job as the helper.
  -- IS NOT DISTINCT FROM rather than `=` so this stays correct even if the
  -- NULL guard above is ever removed.
  IF v_customer_id IS NOT DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'cannot_claim_own_job';
  END IF;

  IF v_instant_book IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not_instant_book';
  END IF;

  -- Race guard: the second of two concurrent claims lands here.
  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'job_already_claimed';
  END IF;

  -- A targeted direct offer must not leak into the instant-book pool: only the
  -- helper it was offered to may claim it.
  IF v_offered_to IS NOT NULL AND v_offered_to IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'job_is_targeted_offer';
  END IF;

  UPDATE public.jobs
     SET status              = 'accepted',
         helper_id           = v_uid,
         helper_confirmed_at = now(),
         response_deadline   = NULL
   WHERE id = p_job_id;
END;
$function$;

-- ── 2b. And anon should not be able to reach the claim paths at all ──────────
-- Guarded: these run against whatever exists at replay time, and a from-scratch
-- rebuild may not have defined them yet at this point in the timeline.
DO $$
BEGIN
  IF to_regprocedure('public.instant_book_claim(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.instant_book_claim(uuid) FROM anon;
  END IF;
  IF to_regprocedure('public.accept_group_application(uuid, timestamptz, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamptz, text) FROM anon;
  END IF;
END $$;
