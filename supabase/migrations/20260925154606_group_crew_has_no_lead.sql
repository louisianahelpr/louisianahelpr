-- A crew has NO lead (owner decision, docs/OPEN.md Q407, 2026-09-25).
--
-- Every hired member of a group job is equal in access (address, messaging the
-- poster), pay share, cancellation-fee share and review. A late poster
-- cancellation's fee is split EVENLY across the hired crew. There is one review
-- PER Helpr, and each counts toward that Helpr's own score and tier.
--
-- ── WHAT jobs.helper_id MEANS FOR A GROUP JOB FROM HERE ON: NULL, ALWAYS ─────
--
-- Two options were weighed. (a) keep helper_id as an internal anchor (the first
-- hire) that no rule treats as special, or (b) NULL on every group job, with a
-- trigger that refuses any write naming one. (b) is the smaller SAFE blast
-- radius because it FAILS CLOSED: every place that grants something to
-- `auth.uid() = jobs.helper_id` stops granting it to anyone on a crew, whereas
-- (a) keeps every one of those grants alive for one member until each is found
-- and patched. Checked against each layer that reads helper_id:
--
--   RLS            "Helpers can update their assigned jobs" (USING auth.uid() =
--                  helper_id) let the anchor write the jobs row directly:
--                  whitelisted columns, job-level proof photos, status. Under
--                  (b) no crew member can; every crew write goes through the
--                  per-member roster RPCs (20260919192559). SELECT, the address
--                  and messaging were already roster-aware
--                  (user_may_see_job_address, can_message_in_job,
--                  can_send_message_to_in_job, is_party_to_job all read
--                  group_job_helpers), so nothing a member needs is lost.
--   poster_cancel_job  restated below with a crew branch that reads the roster,
--                  never helper_id: the fee is priced per hired member and
--                  split into one ledger row per member.
--   payouts        process-scheduled-payouts already fans out over the roster
--                  (budget / helpers_needed each, one transfer + ledger row per
--                  member) and holds the job when the roster is empty and
--                  helper_id is NULL; release-payout answers 409 "no helper_id"
--                  (no money moves); auto-release-payment excludes group jobs
--                  from its release-payout call. None of them needs a lead.
--   create-payment `release` authorises the Helpr side on helper_id, so under
--                  (a) the anchor could stamp the WHOLE job's
--                  helper_completed_at past the crew roll-up; under (b) no crew
--                  member can, and the roll-up in rpc_group_member_mark_done is
--                  the only way a crew job completes. `cancel_escrow`'s atomic
--                  claim is pinned to `helper_id IS NULL`, which no longer
--                  implies "no crew": the edge function re-reads the roster
--                  AFTER its claim (a claimed job reads 'cancelling', which the
--                  funding gate below refuses to hire onto, so that read is
--                  final) and puts the claim back if anyone is hired.
--   funding gate   enforce_job_funded_before_award judged a crew only through
--                  the first hire's helper_id write. It no longer sees crews at
--                  all, so enforce_group_roster_award_gate (BEFORE INSERT on the
--                  roster) now refuses every hire onto an unfunded job itself:
--                  every member, not just the first (closes Q396(b) for hires).
--   single paths   accept_application, respond_to_direct_offer and any other
--                  writer that would name a lead on a group job now fail at
--                  trg_group_job_has_no_lead (closes Q396(a)).
--
-- What this installs:
--   1. Backfill: every group job that names a helper keeps that Helpr on the
--      roster (a row is added if missing) and loses the lead.
--   2. trg_group_job_has_no_lead: BEFORE INSERT OR UPDATE on jobs, a group job
--      with a non-NULL helper_id is refused in every context, server included.
--   3. accept_group_application no longer writes helper_id or the job-level
--      response_deadline (a per-lead stamp), and casts its status CASE to
--      job_status: without the cast every call raised (a CASE of two bare
--      literals is text, which Postgres will not assign to the enum), so no
--      crew hire has ever succeeded.
--   4. enforce_group_roster_award_gate also requires a funded job.
--   5. sync_job_after_roster_departure only rejects the departed Helpr's
--      application: there is no lead to move, so it never writes jobs, never
--      sets app.roster_departure, and enforce_poster_jobs_money_lock is put
--      back to its 20260915101102 text without the carve-out for that flag.
--   6. crew_cancellation_fee_shares: one server-owned row per hired member of a
--      cancelled crew, written only by poster_cancel_job, paid (one Stripe
--      transfer each) and marked paid only by void-cancelled-payments.
--   7. poster_cancel_job crew branch: each hired member's share is the same
--      slice of the budget (budget / helpers_needed) priced on the SAME ladder
--      as a single booking, on that member's own commitment
--      (group_job_helpers.helper_confirmed_at): a member who confirmed is
--      committed exactly as a single Helpr who confirmed is. When every hired
--      member confirmed, as a crew booked for tomorrow has, every share is
--      equal. jobs.cancellation_fee is the sum. A crew with any member's part
--      marked done cannot be cancelled (as a single job cannot once the Helpr
--      marked it done). Each member is told their own share.
--   8. apply_cancellation_violation_consequence: a crew with a committed
--      member is a committed booking (it read helper_id alone).
--   9. notify_on_job_update / notify_on_payment_escrowed: the completed,
--      cancelled and payout-released notices go to every crew member (they
--      went to helper_id only). Restated from their EFFECTIVE definitions
--      (20260925143327 rewrote notify_on_job_update's copy in place).
--  10. Reviews, one per Helpr: UNIQUE (job_id, reviewer_id) becomes
--      UNIQUE (job_id, reviewer_id, reviewee_id); enforce_review_validity and
--      the INSERT policy accept poster -> each crew member and each crew
--      member -> poster; set_review_visibility pairs a review only with the
--      reciprocal review of the SAME pair (it matched any review naming the
--      reviewer, so a crew member's review of the poster would have revealed
--      the poster's hidden review of a different member).
--  11. get_helper_tiers counts a crew member's jobs, so a Helpr who has only
--      worked crews is ranked on their own reviews.
--  12. proof-photos: every crew member may upload to and read the job's proof
--      folder (INSERT and SELECT policies); UPDATE and DELETE are unchanged.
--
-- REPLAY-SAFETY: every object touched is created by an earlier migration
-- (group_job_helpers 20260311041556; roster lifecycle 20260919192559; the
-- departure trigger 20260925140148). CREATE OR REPLACE, DROP ... IF EXISTS,
-- CREATE TABLE IF NOT EXISTS and guarded DO blocks make it idempotent; applied
-- 3x in PGlite (src/test/pglite/groupCrewNoLead.pglite.mjs --replay).

-- ── 1. BACKFILL: nobody leads a crew ─────────────────────────────────────────
-- A group job that names a helper keeps that Helpr on the crew (a roster row
-- is added when the hire predates the roster) and loses the lead. Runs as the
-- migration role, a server context: the roster's hire and lifecycle triggers
-- and the jobs guards all let it through, as they do the payout crons.
INSERT INTO public.group_job_helpers (job_id, helper_id, helper_confirmed_at, helper_dayof_confirmed_at)
SELECT j.id, j.helper_id, j.helper_confirmed_at, j.helper_dayof_confirmed_at
  FROM public.jobs j
 WHERE j.is_group_job IS TRUE
   AND j.helper_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.group_job_helpers g
      WHERE g.job_id = j.id AND g.helper_id = j.helper_id)
ON CONFLICT (job_id, helper_id) DO NOTHING;

UPDATE public.jobs
   SET helper_id = NULL
 WHERE is_group_job IS TRUE
   AND helper_id IS NOT NULL;

-- ── 2. THE INVARIANT: a group job never names a helper ───────────────────────
CREATE OR REPLACE FUNCTION public.enforce_group_job_has_no_lead()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Every context, the server's included: a crew is its roster, and a lead
  -- named by any writer (a hire RPC, a webhook, an admin tool) would hand one
  -- member what the others do not get.
  IF NEW.is_group_job IS TRUE AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'group_job_has_no_lead: a group job''s crew is its roster and jobs.helper_id stays NULL (job_id=%)', NEW.id
      USING ERRCODE = 'check_violation',
            HINT = 'Hire each crew member with accept_group_application.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_group_job_has_no_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_group_job_has_no_lead ON public.jobs;
CREATE TRIGGER trg_group_job_has_no_lead
  BEFORE INSERT OR UPDATE OF helper_id, is_group_job ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_group_job_has_no_lead();

-- ── 3. accept_group_application: a hire adds a member, never a lead ─────────
CREATE OR REPLACE FUNCTION public.accept_group_application(p_application_id uuid, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS TABLE(slots_filled integer, slots_total integer, roster_complete boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id        uuid;
  v_helper_id     uuid;
  v_app_status    text;
  v_job_status    text;
  v_job_customer  uuid;
  v_is_group      boolean;
  v_needed        int;
  v_current       int;
BEGIN
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here, which is what makes
  -- the slot count below trustworthy.
  SELECT j.status, j.customer_id, j.is_group_job, j.helpers_needed
    INTO v_job_status, v_job_customer, v_is_group, v_needed
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Q345: no hire across a block, in either direction (see accept_application;
  -- are_users_blocked is symmetric, so the argument order does not matter).
  IF public.are_users_blocked(v_job_customer, v_helper_id) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  IF v_is_group IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'not_a_group_job';
  END IF;

  -- Defensive: a group job with missing or invalid capacity would let the
  -- roster grow without bound.
  IF v_needed IS NULL OR v_needed < 1 THEN
    RAISE EXCEPTION 'invalid_helpers_needed';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.group_job_helpers g
  WHERE g.job_id = v_job_id;

  -- Capacity guard. Under contention the loser lands here rather than
  -- overfilling the roster.
  IF v_current >= v_needed THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  -- UNIQUE (job_id, helper_id) turns a double-accept of the SAME helper into a
  -- 23505 rather than a silently duplicated slot. group_job_helpers_award_gate
  -- judges THIS member: award gate and, since 20260925154606, a funded job.
  INSERT INTO public.group_job_helpers (job_id, helper_id)
  VALUES (v_job_id, v_helper_id);

  v_current := v_current + 1;

  -- A crew has no lead (Q407): jobs.helper_id stays NULL (trg_group_job_has_no_lead),
  -- and the job-level response_deadline, which timed ONE Helpr's reply, is not
  -- written. p_deadline stays in the signature for existing callers.
  UPDATE public.jobs
     SET
         -- Stay 'open' while partially staffed; only the final slot closes it.
         -- The cast is the fix for the one statement that never ran: a CASE of
         -- two bare literals resolves to text, and Postgres will not assign
         -- text to the job_status enum ("column "status" is of type job_status
         -- but expression is of type text"), so every call since 20260804122000
         -- raised here and rolled back (reproduced in PGlite, R0 in
         -- src/test/pglite/groupCrewNoLead.pglite.mjs).
         status = (CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END)::job_status
   WHERE id = v_job_id;

  slots_filled := v_current;
  slots_total := v_needed;
  roster_complete := v_current >= v_needed;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_group_application(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamptz, text) TO authenticated, service_role;

-- ── 4. EVERY HIRE ONTO A CREW NEEDS A FUNDED JOB ─────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_group_roster_award_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text;
  v_payment text;
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  -- The funding gate (enforce_job_funded_before_award) used to judge a crew
  -- through the first hire's jobs.helper_id write. A crew has no lead now, so
  -- it is judged here, on every member: same predicate, same message.
  -- FOR SHARE: a refund or cancel_escrow claim cannot move the job out of
  -- funding between this read and the roster row landing. accept_group_application
  -- already holds the row FOR UPDATE, so this adds no wait on the hire path.
  SELECT j.payment_status INTO v_payment FROM public.jobs j WHERE j.id = NEW.job_id FOR SHARE;
  IF NOT public.job_payment_is_funded(v_payment) THEN
    RAISE EXCEPTION
      'This job is not funded yet, so it cannot be assigned to a helper. The poster needs to complete checkout first.'
      USING
        ERRCODE = 'check_violation',
        HINT = 'jobs.payment_status must be escrow, payout_pending or released before a crew member is added. See enforce_group_roster_award_gate().';
  END IF;
  v_reason := public.helper_award_block_reason(NEW.helper_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_group_roster_award_gate() FROM PUBLIC, anon, authenticated;

-- ── 5. A DEPARTURE MOVES NO LEAD ─────────────────────────────────────────────
-- Whoever deletes a roster row (the poster while staffing, the member through
-- helper_cancel_booking) ends that member's hire. There is no lead to move,
-- so the trigger writes only the application. Account deletion does not come
-- through here at all: purge_user_data anonymises the row (helper_id -> NULL,
-- an UPDATE), it does not delete it.
CREATE OR REPLACE FUNCTION public.sync_job_after_roster_departure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.helper_id IS NULL THEN
    RETURN OLD;
  END IF;

  -- The departed Helpr's hire is over. accepted -> rejected is silent
  -- (notify_on_application speaks only on pending -> rejected).
  UPDATE public.applications
     SET status = 'rejected'
   WHERE job_id = OLD.job_id
     AND helper_id = OLD.helper_id
     AND status = 'accepted';

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_job_after_roster_departure() FROM PUBLIC, anon, authenticated;

-- ── 5b. THE POSTER MONEY LOCK, WITHOUT THE ROSTER-DEPARTURE CARVE-OUT ────────
-- 20260925140148 let helper_id -> NULL through under app.roster_departure for
-- the trigger above. Nothing sets that flag now, so the lock is restated from
-- its 20260915101102 text, carve-out removed.
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'boost_auto_extended',
    'is_urgent',
    'is_seed',
    -- Added 20260915044137 (VN-33). The Helpr arrival stamps are written
    -- only by mark_helper_arrival (helper) and reset by
    -- zz_jobs_arrival_integrity (which sorts after this trigger). A poster
    -- writing the GPS half would satisfy half of the arrival rule for them.
    'helper_arrived_at',
    'helper_arrival_verified_at',
    -- VN-33(b): server-owned near-miss record. A poster writing it would make
    -- their own confirmation count without the Helpr ever being near.
    'helper_arrival_near_miss_at',
    'helper_arrival_near_miss_ft'
  ];
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
  ];
BEGIN
  IF public.is_server_context()
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF OLD.payment_status IS DISTINCT FROM 'unpaid'
     OR OLD.stripe_session_id IS NOT NULL THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        IF changed_col = 'helper_id'
           AND OLD.helper_id IS NULL
           AND NEW.helper_id IS NOT NULL
           AND OLD.status = 'open' THEN
          CONTINUE;
        END IF;
        -- ADDED 2026-09-05 — the server-owned UNASSIGN.
        -- `report_helper_no_show` reopens the job by clearing helper_id, and
        -- announces itself with the same transaction-local flag four other
        -- triggers already honour. Narrow on purpose: trusted ladder write,
        -- this column, and NULL specifically. Re-pointing helper_id at another
        -- person stays blocked even here.
        IF changed_col = 'helper_id'
           AND NEW.helper_id IS NULL
           AND current_setting('app.trusted_ladder_write', true) = 'on' THEN
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'Posters may not modify jobs.% once checkout has opened', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;


REVOKE ALL ON FUNCTION public.enforce_poster_jobs_money_lock() FROM PUBLIC, anon, authenticated;

-- ── 6. THE CREW'S CANCELLATION-FEE LEDGER ────────────────────────────────────
-- One row per hired member of a cancelled crew. Written only by
-- poster_cancel_job (SECURITY DEFINER); read by the member it names and the
-- job's poster; paid and marked paid only by void-cancelled-payments (service
-- role), one Stripe transfer per row with its own idempotency key. No client
-- role holds INSERT, UPDATE or DELETE, so unlike jobs.cancellation_fee the
-- money path may trust it (it still re-prices every row: F-MONEY-32).
CREATE TABLE IF NOT EXISTS public.crew_cancellation_fee_shares (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL: account deletion anonymises the row, and the money
  -- path refuses (and pages) a share it can no longer route.
  helper_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  committed          boolean NOT NULL,
  fee_percent        integer NOT NULL CHECK (fee_percent IN (0, 25, 50)),
  share_amount       numeric(10,2) NOT NULL CHECK (share_amount >= 0),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'paid', 'failed')),
  stripe_transfer_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz,
  CONSTRAINT crew_cancellation_fee_shares_one_per_member UNIQUE (job_id, helper_id),
  CONSTRAINT crew_cancellation_fee_shares_paid_has_transfer
    CHECK (status <> 'paid' OR stripe_transfer_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS crew_cancellation_fee_shares_helper_idx
  ON public.crew_cancellation_fee_shares (helper_id);

ALTER TABLE public.crew_cancellation_fee_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Crew member or poster reads a fee share" ON public.crew_cancellation_fee_shares;
CREATE POLICY "Crew member or poster reads a fee share"
  ON public.crew_cancellation_fee_shares
  FOR SELECT
  TO authenticated
  USING (
    helper_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = crew_cancellation_fee_shares.job_id
         AND j.customer_id = (SELECT auth.uid())
    )
  );

REVOKE ALL ON TABLE public.crew_cancellation_fee_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.crew_cancellation_fee_shares TO authenticated;
GRANT ALL ON TABLE public.crew_cancellation_fee_shares TO service_role;

-- ── 7. poster_cancel_job: THE CREW BRANCH ────────────────────────────────────
-- Restated from its effective definition (20260924220318, with
-- 20260925143327's in-place copy rewrite #20). The single-helper path is
-- unchanged apart from reading is_group_job / helpers_needed.
CREATE OR REPLACE FUNCTION public.poster_cancel_job(p_job_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_reason text;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_late boolean;
  v_committed boolean;
  v_commission numeric;
  v_helper_cut numeric;
  v_crew boolean;
  v_needed int;
  v_share record;
  v_verdict jsonb := jsonb_build_object('action', 'none', 'prior_count', 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);

  SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
         j.status, j.helper_fee_percent, j.helper_confirmed_at,
         j.helper_completed_at, j.is_group_job, j.helpers_needed
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- The server owns the decision. A helper (or any third party) hitting this
  -- gets not_authorized rather than a partial write.
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Deliberately NOT 'pending_approval': enforce_job_status_transition has no
  -- pending_approval -> cancelled edge for a non-admin, so offering it here
  -- would promise an exit the very next trigger rejects. That draft is
  -- withdrawn through reject_pending_job, which is the business-approval path.
  -- 'disputed' is excluded too: escrow must not move while a human is deciding.
  IF v_job.status::text NOT IN ('open', 'accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'This job is already finished, cancelled, or under dispute.';
  END IF;

  -- ADDED 2026-09-14: a job the Helpr has marked DONE is not cancellable.
  -- From here the poster's moves are approve, ask for a change, or dispute —
  -- never a cancel that refunds the escrow and pays a cancellation fee for
  -- finished work. No poster screen offers Cancel once work is underway
  -- (derivePosterStep renders no Cancel for in_progress/revision_requested),
  -- so the only way here was a stale screen racing the Helpr's Done. Read under
  -- the FOR UPDATE above: a Done that committed first is seen here, and a Done
  -- queued behind this lock is refused by trg_completion_on_live_job.
  IF v_job.helper_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'Your Helpr already marked this job done. Approve it, ask for a change, or open a dispute.';
  END IF;

  -- ADDED 2026-09-25 (Q407): a crew has no lead. Its hired members are the
  -- roster rows that still name a Helpr, every one of them equal.
  v_crew := v_job.is_group_job IS TRUE;
  IF v_crew THEN
    -- Lock the crew so a member's Done or departure cannot land between the
    -- reads below and the ledger rows they price.
    PERFORM 1 FROM public.group_job_helpers g WHERE g.job_id = v_job.id FOR UPDATE;
    -- The same rule as the single job's Done, per member: once anyone on the
    -- crew has finished their part, the poster's moves are approve or dispute.
    IF EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = v_job.id AND g.helper_completed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'not_cancellable'
        USING HINT = 'A Helpr on this crew already marked their part done. Approve it, ask for a change, or open a dispute.';
    END IF;
    v_committed := EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = v_job.id
         AND g.helper_id IS NOT NULL
         AND g.helper_confirmed_at IS NOT NULL
    );
  ELSE
    -- ADDED 2026-09-08: the one question both the fee and the strike turn on.
    -- Chosen is not committed; see this migration's header.
    v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;
  END IF;

  -- The fee is DERIVED here, never accepted from the caller — same ladder
  -- void-cancelled-payments recomputes from, so the persisted row and the money
  -- that moves can no longer disagree.
  -- CHANGED 2026-09-05: now anchored on the job's START TIME, not midnight of
  -- its day. See that migration's header for the 41-hours-reads-as-23 case.
  v_hours   := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
  v_percent := public.cancellation_fee_percent(v_committed, v_hours);

  IF v_crew THEN
    -- One share per hired member: the same slice of the budget
    -- (budget / helpers_needed) on the same ladder as a single booking, priced
    -- on THAT member's own commitment. _shared/cancellationFee.ts
    -- crewMemberCancellationShare() is the same formula, cent for cent.
    v_needed := GREATEST(COALESCE(v_job.helpers_needed, 1), 1);
    INSERT INTO public.crew_cancellation_fee_shares (job_id, helper_id, committed, fee_percent, share_amount)
    SELECT v_job.id,
           g.helper_id,
           (g.helper_confirmed_at IS NOT NULL),
           public.cancellation_fee_percent(g.helper_confirmed_at IS NOT NULL, v_hours),
           CASE
             WHEN COALESCE(v_job.budget, 0) > 0
                  AND public.cancellation_fee_percent(g.helper_confirmed_at IS NOT NULL, v_hours) > 0
               THEN round(v_job.budget * public.cancellation_fee_percent(g.helper_confirmed_at IS NOT NULL, v_hours) / v_needed) / 100.0
             ELSE 0
           END
      FROM public.group_job_helpers g
     WHERE g.job_id = v_job.id
       AND g.helper_id IS NOT NULL
    ON CONFLICT (job_id, helper_id) DO NOTHING;

    SELECT COALESCE(sum(s.share_amount), 0) INTO v_fee
      FROM public.crew_cancellation_fee_shares s
     WHERE s.job_id = v_job.id;
  ELSE
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;
  END IF;
  -- CHANGED 2026-08-26: was `v_hours < 24 AND v_hours > 0`, which called a
  -- post-start cancellation "not late" while charging it the top 50% tier.
  v_late := public.is_late_cancellation(v_committed, v_hours);

  PERFORM set_config('app.sanctioned_cancel', 'on', true);

  UPDATE public.jobs
     SET status = 'cancelled'::job_status,
         cancelled_by = v_uid,
         cancelled_at = now(),
         cancellation_reason = v_reason,
         late_cancellation = v_late,
         cancellation_fee = v_fee,
         cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
   WHERE id = v_job.id;

  PERFORM set_config('app.sanctioned_cancel', 'off', true);

  v_commission := COALESCE(v_job.helper_fee_percent, 10);

  IF v_crew THEN
    -- Every hired member hears about THEIR share, and nobody else's.
    FOR v_share IN
      SELECT s.helper_id, s.share_amount, s.fee_percent, s.committed
        FROM public.crew_cancellation_fee_shares s
       WHERE s.job_id = v_job.id AND s.helper_id IS NOT NULL
    LOOP
      v_helper_cut := GREATEST(0, round((v_share.share_amount - round(v_share.share_amount * v_commission) / 100.0) * 100) / 100.0);
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        v_share.helper_id,
        CASE WHEN v_share.share_amount > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
        CASE
          WHEN v_share.share_amount > 0 THEN
            format('"%s" was cancelled by the person who posted it. Your share of the cancellation fee is about $%s (%s%% of your part of the budget, minus the platform fee), processed within the hour.',
                   COALESCE(v_job.title, 'A job'),
                   to_char(v_helper_cut, 'FM999999990.00'),
                   v_share.fee_percent)
          WHEN NOT v_share.committed THEN
            format('"%s" was cancelled by the person who posted it before you confirmed your spot, so no cancellation fee applies.',
                   COALESCE(v_job.title, 'A job'))
          ELSE
            format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so no cancellation fee applies.',
                   COALESCE(v_job.title, 'A job'))
        END,
        CASE WHEN v_share.share_amount > 0 THEN 'payment' ELSE 'warning' END,
        '/jobs?job=' || v_job.id::text,
        v_job.id
      );
    END LOOP;
  ELSIF v_job.helper_id IS NOT NULL THEN
    -- Tell the Helpr what happened to their money. This used to be a separate
    -- client-side createNotification() that a cancelling client could skip.
    -- Still sent to a merely-offered Helpr: they were waiting on this job and
    -- deserve to know it is gone — but with copy that does not promise a fee.
    v_helper_cut := GREATEST(0, round((v_fee - round(v_fee * v_commission) / 100.0) * 100) / 100.0);

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.helper_id,
      CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
      CASE
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled by the person who posted it. You''ll receive approximately $%s as a cancellation fee (%s%% of the budget minus platform fee), processed within the hour.',
                 COALESCE(v_job.title, 'A job'),
                 to_char(v_helper_cut, 'FM999999990.00'),
                 v_percent)
        WHEN NOT v_committed THEN
          -- The old copy claimed "it was more than 24 hours out", which is
          -- simply false when the reason for the $0 is that this offer was
          -- never accepted.
          format('"%s" was cancelled by the person who posted it before you accepted it, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
        ELSE
          format('"%s" was cancelled by the person who posted it. It was more than 24 hours out, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/jobs?job=' || v_job.id::text
    );
  END IF;

  -- THE LADDER, in the same transaction as the state change. Idempotent on
  -- (user, 'cancel_with_helper', job_id), so one cancelled job is one strike
  -- however many times this is retried. A crew is ONE booking: one strike.
  -- CHANGED 2026-09-08: gated on v_committed, not on helper_id alone.
  IF v_committed THEN
    v_verdict := public.apply_cancellation_violation_consequence(v_job.id);
  END IF;

  RETURN v_verdict || jsonb_build_object(
    'cancellation_fee', v_fee,
    'fee_percent', v_percent,
    'late_cancellation', v_late,
    -- Kept under its original key so existing callers keep parsing, but it now
    -- answers the question the callers were always really asking.
    'had_helper', v_committed,
    'helper_committed', v_committed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text) TO authenticated, service_role;

-- ── 8. A CREW WITH A COMMITTED MEMBER IS A COMMITTED BOOKING ─────────────────
-- Restated from 20260829030000; only the no-helper early return changes.
CREATE OR REPLACE FUNCTION public.apply_cancellation_violation_consequence(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_desc text;
  v_prior_count int;
  v_dupe uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.cancelled_by
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the poster of the job, and only for a job that has actually been
  -- cancelled. The client cancels the job row first and reports afterwards;
  -- checking the row means a caller cannot invent strikes against themselves
  -- (harmless) or, more importantly, spend someone else's.
  IF v_job.customer_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'job_not_cancelled';
  END IF;

  -- No helper was committed -> no strike. Cancelling a job nobody accepted
  -- costs nobody anything, which is why the ladder only counts these.
  -- CHANGED 2026-09-25 (Q407): a crew has no lead, so jobs.helper_id is NULL
  -- on every group job; a crew with a member who confirmed is a committed
  -- booking. One cancelled crew job is still ONE strike (keyed on the job).
  IF v_job.helper_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.group_job_helpers g
        WHERE g.job_id = p_job_id
          AND g.helper_id IS NOT NULL
          AND g.helper_confirmed_at IS NOT NULL
     ) THEN
    RETURN jsonb_build_object('action', 'none', 'prior_count', 0);
  END IF;

  v_desc := 'Cancelled job with Helpr assigned: "' || COALESCE(v_job.title, 'Unknown') || '"';

  -- IDEMPOTENCE. One cancelled job is ONE offence however many times the
  -- dialog retries or the tab reloads -- the strike is keyed to the job.
  SELECT id INTO v_dupe
    FROM public.user_violations
   WHERE user_id = v_user
     AND violation_type = 'cancel_with_helper'
     AND job_id = p_job_id
   LIMIT 1;

  IF v_dupe IS NOT NULL THEN
    RETURN jsonb_build_object('action', 'duplicate', 'violation_id', v_dupe);
  END IF;

  SELECT count(*) INTO v_prior_count
    FROM public.user_violations
   WHERE user_id = v_user AND violation_type = 'cancel_with_helper';

  RETURN public.apply_consequence_ladder(
    p_user                      => v_user,
    p_violation_type            => 'cancel_with_helper',
    p_description               => v_desc,
    p_job_id                    => p_job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'final_warning', 'pending_ban_review'],
    p_effects                   => ARRAY['notify', 'final_warning', 'permanent'],
    p_copy                      => jsonb_build_array(
      jsonb_build_object(
        'title', 'Cancellation warning (1 of 2)',
        'message', 'You cancelled a job after a Helpr had already committed to it. This is a warning; a second one is a final warning.'),
      jsonb_build_object(
        'title', 'Final warning',
        'message', 'That is your second cancellation after a Helpr committed. One more and your account is restricted for 7 days while an admin reviews it.'),
      jsonb_build_object(
        'title', 'Account restricted for 7 days',
        'message', 'Third cancellation after a Helpr committed — your account is restricted for 7 days and an admin is reviewing it. If you think this is wrong, email admin@louisianahelpr.com.')
    ),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has cancelled %s jobs with a Helpr committed and is restricted for 7 days pending your decision.',
    p_ban_reason                => null
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_cancellation_violation_consequence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_cancellation_violation_consequence(uuid) TO authenticated, service_role;

-- ── 9. CREW NOTICES GO TO EVERY MEMBER ───────────────────────────────────────
-- Restated from the effective definitions (notify_on_job_update carries
-- 20260925143327's in-place rewrite #10). The single-helper branches are
-- unchanged; a group job (helper_id always NULL now) tells every member.
CREATE OR REPLACE FUNCTION public.notify_on_job_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Job completed!', '"' || NEW.title || '" has been marked complete. Payment is being processed.', 'payment', '/jobs?job=' || NEW.id::text);
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.helper_id IS NOT NULL
     AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.helper_id, 'Job cancelled', '"' || OLD.title || '" was cancelled by the person who posted it.', 'warning', '/jobs?job=' || OLD.id::text);
  END IF;

  -- A crew (Q407): every member, never one. A crew job completes from any
  -- live status (the roster roll-up), so the edge is "became completed".
  -- poster_cancel_job tells each member their own share itself, so a
  -- sanctioned cancel is skipped here exactly as for a single Helpr.
  IF NEW.is_group_job IS TRUE THEN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT g.helper_id, 'Job completed!',
             '"' || NEW.title || '" has been marked complete. Payment is being processed.',
             'payment', '/jobs?job=' || NEW.id::text, NEW.id
        FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL;
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status != 'cancelled'
       AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT g.helper_id, 'Job cancelled',
             '"' || OLD.title || '" was cancelled by the person who posted it.',
             'warning', '/jobs?job=' || OLD.id::text, OLD.id
        FROM public.group_job_helpers g
       WHERE g.job_id = OLD.id AND g.helper_id IS NOT NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_on_job_update() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_on_job_update() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_member uuid;
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow') THEN
    v_title := 'Payment secured in escrow';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held in escrow and will release after the job is completed.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.customer_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = NEW.helper_id;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, 'Job funded', 'Payment for "' || NEW.title || '" is now in escrow. Get to work!', 'financial_alerts', '/jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  -- A crew (Q407): the payout fan-out releases the job once EVERY member is
  -- paid, so every member hears it, each on their own preference.
  IF NEW.is_group_job IS TRUE
     AND NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' THEN
    FOR v_member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = NEW.id AND g.helper_id IS NOT NULL
    LOOP
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = v_member;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (v_member, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/profile?tab=earnings', NEW.id);
        PERFORM public.log_notification(v_member, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_on_payment_escrowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_payment_escrowed() TO service_role;

-- ── 10. REVIEWS: ONE PER HELPR ───────────────────────────────────────────────
-- (a) The uniqueness moves from (job, reviewer) to (job, reviewer, reviewee):
--     a poster reviews each crew member once, each member reviews the poster
--     once. On a single-helper job the two are the same rule (one reviewee per
--     reviewer). Found by column set, not by name, and dropped only if present.
DO $$
DECLARE
  v_con text;
BEGIN
  FOR v_con IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.reviews'::regclass
       AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM unnest(c.conkey) k
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k)
           = ARRAY['job_id', 'reviewer_id']
  LOOP
    EXECUTE format('ALTER TABLE public.reviews DROP CONSTRAINT %I', v_con);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.reviews'::regclass
       AND conname = 'reviews_one_per_reviewee_per_job'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_one_per_reviewee_per_job UNIQUE (job_id, reviewer_id, reviewee_id);
  END IF;
END $$;

-- (b) Who may review whom.
CREATE OR REPLACE FUNCTION public.enforce_review_validity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job RECORD;
  v_reviewer_on_crew boolean;
  v_reviewee_on_crew boolean;
BEGIN
  IF NEW.reviewer_id = NEW.reviewee_id THEN
    RAISE EXCEPTION 'You cannot review yourself.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT customer_id, helper_id, status, is_group_job INTO v_job FROM public.jobs WHERE id = NEW.job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % not found.', NEW.job_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_job.status <> 'completed' THEN
    RAISE EXCEPTION 'Reviews can only be left after the job is marked completed.'
      USING ERRCODE = 'check_violation', HINT = 'Current status: ' || v_job.status::text;
  END IF;

  -- ADDED 2026-09-25 (Q407): on a group job the crew is the roster, every
  -- member equal. The poster reviews each member; each member reviews the
  -- poster. Nobody reviews a fellow member through this job.
  IF v_job.is_group_job IS TRUE THEN
    v_reviewer_on_crew := EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = NEW.job_id AND g.helper_id = NEW.reviewer_id);
    v_reviewee_on_crew := EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = NEW.job_id AND g.helper_id = NEW.reviewee_id);
    IF NEW.reviewer_id IS NOT DISTINCT FROM v_job.customer_id THEN
      IF NOT v_reviewee_on_crew THEN
        RAISE EXCEPTION 'You can review each Helpr who worked this job.' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF v_reviewer_on_crew THEN
      IF NEW.reviewee_id IS DISTINCT FROM v_job.customer_id THEN
        RAISE EXCEPTION 'You can review the person who posted this job.' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'Only the person who posted this job or a Helpr who worked it can review it.'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.reviewer_id NOT IN (v_job.customer_id, v_job.helper_id) THEN
      RAISE EXCEPTION 'Only the job poster or assigned helper can submit a review.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reviewer_id = v_job.customer_id AND NEW.reviewee_id <> v_job.helper_id THEN
      RAISE EXCEPTION 'Customer must review the assigned helper.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reviewer_id = v_job.helper_id AND NEW.reviewee_id <> v_job.customer_id THEN
      RAISE EXCEPTION 'Helper must review the customer who hired them.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- ADDED 2026-09-04 — server owns these four columns on a client insert.
  -- A server context is the service_role/trigger path (backfills, seeds);
  -- an admin keeps the deliberate override. Everyone else, anon included,
  -- gets them reset, whatever they sent:
  --   feedback_visible_at -> NULL so set_review_visibility() actually runs
  --     (it early-returns when the column arrives pre-set, which is precisely
  --     how a reviewer could publish instantly and read the reply first).
  --   response_text/at    -> NULL; the reviewee's reply belongs to
  --     respond_to_review(), not to the person being reviewed BY.
  --   status              -> the 'published' default.
  IF NOT public.is_server_context() AND NOT has_role(auth.uid(), 'admin') THEN
    NEW.feedback_visible_at := NULL;
    NEW.response_text       := NULL;
    NEW.response_at         := NULL;
    NEW.status              := 'published';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_review_validity() FROM PUBLIC, anon;

-- (c) The INSERT policy: same pairs as the trigger. group_member_slot is the
--     roster lookup the crew RPCs use (SECURITY DEFINER, EXECUTE granted to
--     authenticated), so the roster's own RLS cannot hide a member here.
DROP POLICY IF EXISTS "Users can create reviews for eligible jobs" ON public.reviews;
CREATE POLICY "Users can create reviews for eligible jobs" ON public.reviews
FOR INSERT WITH CHECK (
  (SELECT auth.uid()) = reviewer_id
  AND EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = reviews.job_id
      AND (
        -- A single-helper job: the poster and the hired Helpr, each way.
        ((j.customer_id = (SELECT auth.uid()) AND j.helper_id = reviews.reviewee_id)
          OR (j.helper_id = (SELECT auth.uid()) AND j.customer_id = reviews.reviewee_id))
        -- A crew (Q407): the poster and each member, each way.
        OR (j.is_group_job IS TRUE
            AND ((j.customer_id = (SELECT auth.uid())
                  AND public.group_member_slot(j.id, reviews.reviewee_id) IS NOT NULL)
              OR (public.group_member_slot(j.id, (SELECT auth.uid())) IS NOT NULL
                  AND j.customer_id = reviews.reviewee_id)))
      )
      AND j.status = 'completed'::job_status
      AND j.payment_status IN ('released', 'payout_pending')
      AND (j.has_active_dispute = false OR j.dispute_resolved_at IS NOT NULL)
      AND COALESCE(j.poster_completed_at, j.helper_completed_at, j.updated_at) > now() - interval '30 days'
  )
);

-- (d) The double-blind reveal pairs a review with the reciprocal review of the
--     SAME pair. It matched any review on the job naming the new reviewer, so
--     on a crew one member's review of the poster would have revealed the
--     poster's still-hidden review of a different member (and vice versa).
CREATE OR REPLACE FUNCTION public.set_review_visibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  reciprocal_id uuid;
BEGIN
  -- Skip if visibility was set explicitly (e.g. admin override or backfill).
  IF NEW.feedback_visible_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- The reciprocal review: same job, the new reviewee reviewing the new
  -- reviewer.
  SELECT id INTO reciprocal_id
  FROM public.reviews
  WHERE job_id = NEW.job_id
    AND reviewee_id = NEW.reviewer_id
    AND reviewer_id = NEW.reviewee_id
    AND id != NEW.id
  LIMIT 1;

  IF reciprocal_id IS NOT NULL THEN
    -- Reciprocal exists → reveal both immediately.
    UPDATE public.reviews
    SET feedback_visible_at = NOW()
    WHERE id IN (NEW.id, reciprocal_id);
  ELSE
    -- First side to review → hold for 14 days.
    UPDATE public.reviews
    SET feedback_visible_at = NOW() + INTERVAL '14 days'
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_review_visibility() FROM PUBLIC, anon, authenticated;

-- ── 11. A CREW MEMBER'S JOBS COUNT TOWARD THEIR OWN TIER ─────────────────────
CREATE OR REPLACE FUNCTION public.get_helper_tiers(p_limit integer DEFAULT 25)
 RETURNS TABLE(user_id uuid, full_name text, parish text, avatar_url text, total_reviews integer, recent_reviews integer, avg_rating numeric, recent_avg_rating numeric, completed_jobs integer, growth_score numeric, tier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH worked AS (
    -- Every job a Helpr worked: the single-helper jobs they were hired on and
    -- (Q407) every crew they were on. A crew names no lead.
    SELECT j.id AS job_id, j.status, j.helper_id AS user_id FROM public.jobs j WHERE j.helper_id IS NOT NULL
    UNION
    SELECT j.id, j.status, g.helper_id
      FROM public.group_job_helpers g JOIN public.jobs j ON j.id = g.job_id
     WHERE g.helper_id IS NOT NULL
  ),
  stats AS (
    SELECT p.user_id, p.full_name, p.parish, p.avatar_url,
      COUNT(DISTINCT r.id)::int AS total_reviews,
      COUNT(DISTINCT r.id) FILTER (WHERE r.created_at > now() - interval '30 days')::int AS recent_reviews,
      COALESCE(AVG(r.rating)::numeric(10,2), 0) AS avg_rating,
      COALESCE(AVG(r.rating) FILTER (WHERE r.created_at > now() - interval '30 days')::numeric(10,2), 0) AS recent_avg_rating,
      COUNT(DISTINCT w.job_id) FILTER (WHERE w.status = 'completed')::int AS completed_jobs
    FROM public.profiles p
    LEFT JOIN public.reviews r ON r.reviewee_id = p.user_id
    LEFT JOIN worked w ON w.user_id = p.user_id
    WHERE EXISTS (SELECT 1 FROM worked ww WHERE ww.user_id = p.user_id)
      AND p.email_verified
      AND COALESCE(p.ban_status, 'active') = 'active'
      -- server-side admin authorization: non-admins get zero rows, not the data
      AND public.has_role(auth.uid(), 'admin')
    GROUP BY p.user_id, p.full_name, p.parish, p.avatar_url
  )
  SELECT user_id, full_name, parish, avatar_url, total_reviews, recent_reviews, avg_rating, recent_avg_rating, completed_jobs,
    (recent_reviews * COALESCE(recent_avg_rating, 0))::numeric(10,2) AS growth_score,
    CASE
      WHEN total_reviews >= 25 AND avg_rating >= 4.7 THEN 'Elite'
      WHEN total_reviews >= 10 AND avg_rating >= 4.5 THEN 'Verified'
      WHEN recent_reviews >= 3 AND recent_avg_rating >= 4.5 THEN 'Rising Star'
      WHEN total_reviews >= 1 THEN 'Active'
      ELSE 'New'
    END AS tier
  FROM stats ORDER BY growth_score DESC, total_reviews DESC LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.get_helper_tiers(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_helper_tiers(integer) TO authenticated;

-- ── 12. EVERY CREW MEMBER MAY FILE AND READ THE JOB'S PROOF PHOTOS ───────────
-- PhotoProof uploads to proof-photos under `<job_id>/…`, which the INSERT and
-- SELECT policies admit for the uploader's own folder or a party to the job
-- (is_party_to_job_folder: the poster or jobs.helper_id). With no lead, no
-- crew member was a party, so no member could upload the roster before photo
-- their Working step needs, and the poster could not read a member's photos.
-- is_crew_member_of_job_folder admits every member of the job's roster, and
-- only INSERT and SELECT take it: UPDATE and DELETE (20260925141905) stay the
-- uploader's own folder or the job's parties, so one member cannot overwrite
-- or delete another member's evidence.
CREATE OR REPLACE FUNCTION public.is_crew_member_of_job_folder(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.group_job_helpers g
    WHERE g.job_id::text = (storage.foldername(object_name))[1]
      AND g.helper_id IS NOT NULL
      AND g.helper_id = auth.uid()
  );
$function$;

REVOKE ALL ON FUNCTION public.is_crew_member_of_job_folder(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_crew_member_of_job_folder(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can upload proof photos to own folder" ON storage.objects;
CREATE POLICY "Users can upload proof photos to own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'proof-photos'
    AND (
      ((select auth.uid()))::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
      OR public.is_crew_member_of_job_folder(name)
    )
  );

DROP POLICY IF EXISTS "Users can read proof photos for their jobs" ON storage.objects;
CREATE POLICY "Users can read proof photos for their jobs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND (
      ((select auth.uid()))::text = (storage.foldername(name))[1]
      OR public.is_party_to_job_folder(name)
      OR public.is_crew_member_of_job_folder(name)
    )
  );
