-- Q1390 (docs/OPEN.md; owner decision 2026-10-07, option (a)): automate the
-- crew block fee. When a poster blocks a COMMITTED crew member close to the
-- start, block_user_and_settle (20261006015121) priced that member's fee on
-- poster_cancel_job's crew ladder and only alerted admins to settle it by hand
-- (notifications that cleanup-notifications deletes after 30 days, on no
-- ledger). Owner: "pay the blocked committed member's fee from the job's
-- escrow at settlement; that spot stays closed (no refill); write the fee to
-- a ledger table reconciliation can see."
--
--   * public.crew_block_fees: one row per closed spot (job, slot), the fee in
--     cents, and its payment state. Server-only (RLS on, no client grant);
--     the member and the poster see it in export_my_data.
--   * block_user_and_settle writes the row instead of the by-hand alert (a
--     legacy slotless roster row, Q1380, still alerts by hand), tells the
--     poster the spot is closed and what it costs, and tells the member when
--     the fee is paid.
--   * crew_spots_open, open_jobs_browse's inline copy of it, and
--     accept_group_application count a closed spot as taken and never reuse
--     its slot.
--   * The fee is paid by _shared/crewBlockFees.ts from process-scheduled-
--     payouts (before the unfilled shares are refunded, out of the closed
--     spot's share) or void-cancelled-payments (withheld from a cancelled
--     job's refund); money-reconciliation reads the ledger.
--
-- Each function is restated from its NEWEST definition in the migrations
-- (src/test/helpers/effectiveFunctionDefs.ts, 2026-10-07):
-- block_user_and_settle and accept_group_application from 20261006015121,
-- crew_spots_open from 20261006023437 (all three equal to live, md5 checked),
-- export_my_data from 20261006204113 (Q1461, landed with #2523) and
-- open_jobs_browse from 20261007062739 (the newest), with only the Q1390
-- lines changed; grants restated. This file is timestamped after all of them
-- so a fresh replay and a later deploy end in the same place (it replaces
-- 20261007055335, which was older than 20261007062739).
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE.

CREATE TABLE IF NOT EXISTS public.crew_block_fees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- The member owed the fee. SET NULL on deletion (Q448 rule: a money record
  -- the purge does not touch is kept with the person anonymised); the payer
  -- then voids the row and the poster's refund includes it.
  helper_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  slot_no           integer NOT NULL CHECK (slot_no >= 0),
  share_basis_cents integer NOT NULL CHECK (share_basis_cents >= 0),
  fee_percent       integer NOT NULL CHECK (fee_percent IN (25, 50)),
  fee_cents         integer NOT NULL CHECK (fee_cents > 0 AND fee_cents <= share_basis_cents),
  status            text NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'paid', 'failed', 'void')),
  stripe_transfer_id text,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  CONSTRAINT crew_block_fees_paid_has_transfer CHECK (status <> 'paid' OR stripe_transfer_id IS NOT NULL),
  -- One closed spot per slot: the slot is never reused, so never re-priced.
  CONSTRAINT crew_block_fees_one_per_slot UNIQUE (job_id, slot_no)
);
CREATE INDEX IF NOT EXISTS crew_block_fees_helper_id_idx ON public.crew_block_fees (helper_id);
CREATE INDEX IF NOT EXISTS crew_block_fees_unpaid_idx ON public.crew_block_fees (status) WHERE status IN ('owed', 'failed');

ALTER TABLE public.crew_block_fees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_block_fees FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crew_block_fees TO service_role;

-- Q807: the unconfirmed-email gate goes on every public table through its own
-- attacher (idempotent; it skips tables that already carry it).
DO $gates$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$gates$;

-- crew_spots_open: a closed spot is taken.
CREATE OR REPLACE FUNCTION public.crew_spots_open(p_job_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  -- How many spots on a crew a Helpr can apply for right now.
  --   * a crew still staffing ('open'): every spot nobody holds;
  --   * a booked crew ('accepted') a member left (Q1378/Q1409, owner
  --     2026-10-05): its free spots, until 15 minutes before the start (the
  --     same cutoff every hire meets: accept_group_application refuses inside
  --     it, job_starts_too_soon); after that the crew goes ahead as it is and
  --     the empty share is refunded at payout;
  --   * anything else (a single job, a started or finished crew, a series
  --     visit): 0.
  -- Definer because the roster (group_job_helpers) is visible only to the
  -- job's parties; it answers a COUNT for one job, never who is on it.
  SELECT CASE
           WHEN j.is_group_job IS NOT TRUE OR j.parent_job_id IS NOT NULL THEN 0
           WHEN j.status::text = 'open'
             OR (j.status::text = 'accepted'
                 AND public.job_offer_cutoff(j.date_needed, j.start_time) > now() + interval '15 minutes')
             THEN GREATEST(0, COALESCE(j.helpers_needed, 1)
                              - (SELECT count(*)::int FROM public.group_job_helpers g WHERE g.job_id = j.id)
                              -- Q1390: a spot closed by a block with a fee is taken.
                              - (SELECT count(*)::int FROM public.crew_block_fees b WHERE b.job_id = j.id))
           ELSE 0
         END
    FROM public.jobs j
   WHERE j.id = p_job_id
$fn$;
REVOKE ALL ON FUNCTION public.crew_spots_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crew_spots_open(uuid) TO service_role;

-- open_jobs_browse, restated from 20261007062739 (the newest definition) with the
-- Q1390 closed spots subtracted in both inline copies of crew_spots_open.
CREATE OR REPLACE VIEW public.open_jobs_browse
WITH (security_invoker = false)
AS
 SELECT id,
    title,
    description,
    category,
    budget,
    date_needed,
        CASE
            WHEN offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'::text THEN location
            ELSE mask_job_location(location)
        END AS location,
    is_urgent,
    urgent_fee,
    is_flexible_schedule,
    is_recurring,
    is_group_job,
    helpers_needed,
    estimated_hours,
    start_time,
    photos,
    special_requirements,
    status,
    created_at,
    updated_at,
    boosted_at,
    boost_expires_at,
    expires_at,
    recurrence_interval,
    recurrence_end_date,
    parent_job_id,
    payment_status,
    customer_id,
        CASE
            WHEN customer_id = auth.uid() OR offered_to_helper_id = auth.uid() THEN offered_to_helper_id
            ELSE NULL::uuid
        END AS offered_to_helper_id,
    direct_offer_status,
    direct_offer_expires_at,
    ( SELECT count(*)::integer AS count
           FROM applications a
          WHERE a.job_id = jobs.id) AS applicant_count,
    pricing_mode,
    round(latitude, 2) AS latitude,
    round(longitude, 2) AS longitude,
    parish,
    credential_tier,
    require_photo_proof,
    recurrence_days,
    recurrence_weeks,
    series_split_ok,
        CASE
            WHEN is_group_job IS TRUE THEN (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END)
            ELSE NULL::integer
        END AS crew_spots_open,
    materials_note
   FROM jobs
  WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND (CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id) - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END) > 0)) AND parent_job_id IS NULL AND customer_id IS NOT NULL AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id IS NULL OR (direct_offer_status = ANY (ARRAY['declined'::text, 'expired'::text])) OR offered_to_helper_id = auth.uid()) AND (created_at <= early_access_cutoff() OR customer_id = auth.uid() OR offered_to_helper_id = auth.uid()) AND (NOT is_seed OR NOT public.seed_hidden_in_discovery()) AND (COALESCE(credential_tier, 0) = 0 OR customer_id = auth.uid() OR COALESCE(( SELECT my_credential_tier() AS my_credential_tier), 0) >= credential_tier) AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text)));

REVOKE ALL ON public.open_jobs_browse FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.open_jobs_browse TO anon, authenticated;

-- accept_group_application: never hires into a closed spot.
CREATE OR REPLACE FUNCTION public.accept_group_application(p_application_id uuid, p_deadline timestamp with time zone DEFAULT NULL::timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS TABLE(slots_filled integer, slots_total integer, roster_complete boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cutoff        timestamptz;
  v_crew_deadline      timestamptz;
  v_date_needed   date;
  v_start_time    time without time zone;
  v_job_id        uuid;
  v_helper_id     uuid;
  v_app_status    text;
  v_job_status    text;
  v_job_customer  uuid;
  v_is_group      boolean;
  v_needed        int;
  v_current       int;
  v_budget        numeric;
  v_slot          int;
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
  SELECT j.status, j.customer_id, j.is_group_job, j.helpers_needed, j.budget, j.date_needed, j.start_time
    INTO v_job_status, v_job_customer, v_is_group, v_needed, v_budget, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- 20261005184940: the answer-by never runs past the job's start, so a hire
  -- too close to it would hand the member a window already gone (and a strike
  -- at the next sweep). Refused like accept_application, before any write.
  v_cutoff := public.job_offer_cutoff(v_date_needed, v_start_time);
  IF v_cutoff IS NOT NULL AND v_cutoff <= now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'job_starts_too_soon';
  END IF;

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

  -- Q1378 (owner 2026-10-05): a booked crew a member left carries on with a
  -- free spot, and the poster may refill it before the start
  -- (job_starts_too_soon above refuses a hire inside 15 minutes of it). The
  -- capacity guard below refuses a booked crew that is full.
  IF v_job_status IS NULL OR v_job_status NOT IN ('open', 'accepted') THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  SELECT COUNT(*) INTO v_current
  FROM public.group_job_helpers g
  WHERE g.job_id = v_job_id;
  -- Q1390: a spot closed by a block with a fee is taken (never refilled).
  v_current := v_current + (SELECT count(*)::int FROM public.crew_block_fees b WHERE b.job_id = v_job_id);

  -- Capacity guard. Under contention the loser lands here rather than
  -- overfilling the roster.
  IF v_current >= v_needed THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  -- The lowest free slot, and its frozen share of the budget in cents
  -- (largest remainder; see crew_slot_share_cents). A slot a departed member
  -- left is reused, so the N shares always add up to the budget.
  SELECT min(s) INTO v_slot
    FROM generate_series(0, v_needed - 1) AS s
   WHERE NOT EXISTS (SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = v_job_id AND g.slot_no = s)
     -- Q1390: never the slot of a spot a block closed.
     AND NOT EXISTS (SELECT 1 FROM public.crew_block_fees b WHERE b.job_id = v_job_id AND b.slot_no = s);
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'roster_full';
  END IF;

  -- UNIQUE (job_id, helper_id) turns a double-accept of the SAME helper into a
  -- 23505 rather than a silently duplicated slot. group_job_helpers_award_gate
  -- judges THIS member: award gate and, since 20260925154606, a funded job.
  INSERT INTO public.group_job_helpers (job_id, helper_id, slot_no, share_cents)
  VALUES (v_job_id, v_helper_id, v_slot,
          public.crew_slot_share_cents(round(COALESCE(v_budget, 0) * 100)::bigint, v_needed, v_slot));

  -- Q729 (owner 2026-10-05): the poster's reply deadline is kept for THIS
  -- member; expire_unanswered_offers reopens the spot once it passes unanswered.
  -- Clamped to the shortest deadline the app offers (1 hour, less 5 minutes
  -- of clock skew): a deadline in the past would get the member struck by the
  -- next sweep before they could answer (lh-authz-rls review #1, 2026-10-05).
  -- The answer-by never runs past the job's start (20261005184940), and a NULL
  -- (never expires) is bounded the same way, as accept_application now is.
  v_crew_deadline := LEAST(GREATEST(LEAST(COALESCE(p_deadline, now() + interval '48 hours'), now() + interval '48 hours'), now() + interval '55 minutes'), v_cutoff);
  UPDATE public.group_job_helpers
     SET response_deadline = v_crew_deadline
   WHERE job_id = v_job_id AND slot_no = v_slot;

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
   WHERE id = v_job_id
     -- A refill of a booked crew (Q1378) leaves it booked, full or not.
     AND v_job_status = 'open';

  slots_filled := v_current;
  slots_total := v_needed;
  roster_complete := v_current >= v_needed;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamp with time zone, text) TO authenticated, service_role;

-- block_user_and_settle: the fee goes on the ledger; the spot stays closed.
CREATE OR REPLACE FUNCTION public.block_user_and_settle(p_blocked uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_committed boolean;
  v_updated int;
  v_settled jsonb := '[]'::jsonb;
  v_ladder_present boolean;
  v_closed_apps int;
  v_closed_offers int;
  v_crew record;
  v_starts timestamptz;
  v_basis bigint;
  v_member_fee numeric;
  v_remaining int;
  v_prior int;
  v_new_block boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_blocked IS NULL OR p_blocked = v_user THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  -- The block itself first: whatever happens to the jobs below, the person
  -- asking to be left alone is left alone.
  INSERT INTO public.user_blocks (blocker_id, blocked_id, reason)
  VALUES (v_user, p_blocked, NULLIF(btrim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
  -- A repeat call (the block already existed) must not re-alert admins below.
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  v_new_block := v_updated > 0;

  -- ADDED 2026-09-23 (Q301): a banned caller keeps the block and settles
  -- nothing. The settle step's jobs UPDATE is refused by enforce_ban_gate,
  -- and because this is one transaction that refusal used to roll the block
  -- back too, so a banned user could not block someone they shared a live
  -- job with. Blocking while banned is allowed (Q281); cancelling a job and
  -- pricing its fee is not.
  IF public.is_caller_banned() THEN
    RETURN jsonb_build_object('blocked', p_blocked, 'settled', '[]'::jsonb, 'settle_skipped', 'account_restricted');
  END IF;

  v_ladder_present :=
    to_regprocedure('public.apply_cancellation_violation_consequence(uuid)') IS NOT NULL;

  FOR v_job IN
    SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id, j.helper_id,
           j.helper_confirmed_at, j.status
      FROM public.jobs j
     WHERE j.status IN ('accepted', 'in_progress', 'revision_requested')
       -- ADDED 2026-09-14: finished work is not cancelled by a block.
       AND j.helper_completed_at IS NULL
       AND (
            (j.customer_id = v_user     AND j.helper_id = p_blocked)
         OR (j.customer_id = p_blocked  AND j.helper_id = v_user)
       )
     FOR UPDATE
  LOOP
    -- CHANGED 2026-09-23: committed, not merely assigned — the same predicate
    -- poster_cancel_job and _shared/cancellationFee.ts helperIsCommitted use.
    -- A Helpr who was chosen but never accepted lost no committed time.
    v_committed := v_job.helper_id IS NOT NULL AND v_job.helper_confirmed_at IS NOT NULL;

    -- CHANGED 2026-09-05: anchored on start_time, matching poster_cancel_job.
    -- Both settle paths must price a cancellation identically or the fee a
    -- poster is quoted depends on which exit they happened to take.
    v_hours := public.job_hours_until_start(v_job.date_needed, v_job.start_time, now());
    v_percent := public.cancellation_fee_percent(v_committed, v_hours);
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;

    -- The pinned columns (cancellation_*, late_cancellation) are legitimate
    -- server writes here, and the blocker may be the HELPER seat, which the
    -- helper column whitelist would otherwise reject. `app.sanctioned_cancel`
    -- additionally satisfies trg_cancellation_requires_rpc: this IS one of the
    -- sanctioned exits. Both hatches are transaction-local and switched off
    -- again immediately after the statement.
    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    PERFORM set_config('app.sanctioned_cancel', 'on', true);

    UPDATE public.jobs
       SET status = 'cancelled',
           cancelled_by = v_user,
           cancelled_at = now(),
           cancellation_reason = 'Cancelled because one party blocked the other.',
           late_cancellation = public.is_late_cancellation(v_committed, v_hours),
           cancellation_fee = v_fee,
           cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
     WHERE id = v_job.id
       AND status IN ('accepted', 'in_progress', 'revision_requested')
       AND helper_completed_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    PERFORM set_config('app.trusted_ladder_write', 'off', true);
    PERFORM set_config('app.sanctioned_cancel', 'off', true);

    IF v_updated = 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      p_blocked,
      'Job cancelled',
      CASE
        WHEN v_fee > 0 AND v_job.helper_id = p_blocked THEN
          format('"%s" was cancelled. Because it was cancelled late, a $%s cancellation fee applies and your share is on its way — it settles within the hour.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled late, so a $%s cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        ELSE
          format('"%s" was cancelled. No cancellation fee applies.', COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      CASE WHEN v_job.helper_id = p_blocked THEN '/jobs?job=' ELSE '/posts?job=' END || v_job.id::text
    );

    -- The reliability strike, through the SAME ladder the normal cancel path
    -- uses. It authorises off auth.uid() = customer_id internally, so it is a
    -- no-op (raises 'not_authorized') for the helper-blocks-poster direction —
    -- only call it in the seat it is written for.
    -- CHANGED 2026-09-23: gated on v_committed, as poster_cancel_job is.
    IF v_ladder_present AND v_job.customer_id = v_user AND v_committed THEN
      PERFORM public.apply_cancellation_violation_consequence(v_job.id);
    END IF;

    v_settled := v_settled || jsonb_build_object(
      'job_id', v_job.id,
      'title', v_job.title,
      'cancellation_fee', v_fee,
      'fee_percent', v_percent
    );
  END LOOP;

  -- ADDED 2026-10-05 (Q729/Q1282, owner): a crew has no lead (Q407), so the
  -- loop above never sees one. A block between the poster and ONE crew member
  -- takes only that member off the crew; their spot reopens.
  FOR v_crew IN
    SELECT j.id, j.title, j.budget, j.date_needed, j.start_time, j.customer_id,
           j.status::text AS status, j.helpers_needed,
           g.id AS slot_id, g.helper_id AS member, g.helper_confirmed_at AS member_confirmed_at,
           g.share_cents, g.slot_no
      FROM public.jobs j
      JOIN public.group_job_helpers g ON g.job_id = j.id
     WHERE j.is_group_job IS TRUE
       AND j.status IN ('open', 'accepted', 'in_progress', 'revision_requested')
       AND g.helper_completed_at IS NULL
       AND (
            (j.customer_id = v_user    AND g.helper_id = p_blocked)
         OR (j.customer_id = p_blocked AND g.helper_id = v_user)
       )
     ORDER BY j.id
       FOR UPDATE OF j, g
  LOOP
    v_starts := ((v_crew.date_needed + COALESCE(v_crew.start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago');

    IF v_crew.status NOT IN ('open', 'accepted')
       OR (v_starts IS NOT NULL AND now() >= v_starts) THEN
      -- Work may be under way: nothing moves automatically (a crew member
      -- cannot leave a started job either); a person decides. Only on a NEW
      -- block, so calling again cannot flood every admin (review #2).
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT r.user_id,
             'Block on a started crew job',
             format('"%s": the person who posted it and one crew member blocked each other after the job started. Nothing on the job was changed; decide what happens to that member''s part.',
                    COALESCE(v_crew.title, 'A job')),
             'admin_alert',
             '/admin?view=jobs&job=' || v_crew.id::text,
             v_crew.id
        FROM public.user_roles r
       WHERE r.role = 'admin'
         AND v_new_block;
      v_settled := v_settled || jsonb_build_object('job_id', v_crew.id, 'title', v_crew.title,
                                                   'crew', true, 'action', 'admin_review');
      CONTINUE;
    END IF;

    v_hours := public.job_hours_until_start(v_crew.date_needed, v_crew.start_time, now());
    v_member_fee := 0;
    v_percent := 0;

    IF v_crew.customer_id = v_user THEN
      -- The POSTER blocked the member: priced as poster_cancel_job's crew
      -- branch prices this member's share.
      v_committed := public.crew_fee_pays_unconfirmed() OR v_crew.member_confirmed_at IS NOT NULL;
      v_percent := public.cancellation_fee_percent(v_committed, v_hours);
      v_basis := COALESCE(v_crew.share_cents,
                          public.crew_slot_share_cents(round(COALESCE(v_crew.budget, 0) * 100)::bigint,
                                                       COALESCE(v_crew.helpers_needed, 1), v_crew.slot_no));
      v_member_fee := round(COALESCE(v_basis, 0) * v_percent / 100.0) / 100.0;

      -- The cancel-with-Helpr strike, on the same ladder and violation type
      -- apply_cancellation_violation_consequence uses (it needs a cancelled
      -- job, and this one carries on), once per job.
      IF v_committed AND to_regprocedure('public.apply_consequence_ladder(uuid,text,text,uuid,integer,text[],text[],jsonb,boolean,integer,boolean,text,text)') IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.user_violations uv
                          WHERE uv.user_id = v_user AND uv.violation_type = 'cancel_with_helper' AND uv.job_id = v_crew.id) THEN
        SELECT count(*) INTO v_prior
          FROM public.user_violations
         WHERE user_id = v_user AND violation_type = 'cancel_with_helper';
        PERFORM public.apply_consequence_ladder(
          p_user                      => v_user,
          p_violation_type            => 'cancel_with_helper',
          p_description               => 'Removed a committed Helpr from a crew by blocking them: "' || COALESCE(v_crew.title, 'Unknown') || '"',
          p_job_id                    => v_crew.id,
          p_prior_count               => v_prior,
          p_rungs                     => ARRAY['warning', 'final_warning', 'pending_ban_review'],
          p_effects                   => ARRAY['notify', 'final_warning', 'permanent'],
          p_copy                      => jsonb_build_array(
            jsonb_build_object(
              'title', 'Cancellation warning (1 of 2)',
              'message', 'A Helpr who had committed to your job was taken off it. This is a warning; a second one is a final warning.'),
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
      END IF;

      IF v_member_fee > 0 AND v_crew.slot_no IS NOT NULL THEN
        -- Q1390 (owner 2026-10-07, (a)): the fee is paid from THIS job's
        -- escrow when it settles, out of this spot's share, and the spot stays
        -- closed (crew_spots_open, open_jobs_browse and accept_group_application
        -- count it as taken). _shared/crewBlockFees.ts pays the row;
        -- money-reconciliation reads it. A repeat block cannot price it twice.
        INSERT INTO public.crew_block_fees (job_id, helper_id, slot_no, share_basis_cents, fee_percent, fee_cents)
        VALUES (v_crew.id, v_crew.member, v_crew.slot_no, COALESCE(v_basis, 0)::int, v_percent,
                round(COALESCE(v_basis, 0) * v_percent / 100.0)::int)
        ON CONFLICT (job_id, slot_no) DO NOTHING;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (v_user, 'Crew spot closed',
                format('You blocked a crew member close to the start of "%s". Their $%s cancellation fee comes out of that spot''s $%s share, and the spot stays closed. The rest of that share comes back to you when the job is done.',
                       COALESCE(v_crew.title, 'your job'), to_char(v_member_fee, 'FM999999990.00'),
                       to_char(COALESCE(v_basis, 0) / 100.0, 'FM999999990.00')),
                'payment', '/posts?job=' || v_crew.id::text, v_crew.id);
      ELSIF v_member_fee > 0 THEN
        -- A roster row from before the slots existed (Q1380) has no slot to
        -- close and no frozen share: still settled by hand.
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        SELECT r.user_id,
               'Crew block: fee owed by hand',
               format('"%s": the person who posted it blocked a committed crew member %s hours before the start. That member is owed a $%s cancellation fee (%s%% of their $%s share). Nothing was charged or paid automatically; settle it by hand.',
                      COALESCE(v_crew.title, 'A job'), round(COALESCE(v_hours, 0), 1),
                      to_char(v_member_fee, 'FM999999990.00'), v_percent,
                      to_char(COALESCE(v_basis, 0) / 100.0, 'FM999999990.00')),
               'admin_alert',
               '/admin?view=jobs&job=' || v_crew.id::text,
               v_crew.id
          FROM public.user_roles r
         WHERE r.role = 'admin';
      END IF;
    ELSE
      -- The MEMBER blocked the poster: helper_cancel_booking's crew branch
      -- (owner: keep its strike).
      IF v_crew.member_confirmed_at IS NOT NULL
         AND public.is_late_cancellation(true, EXTRACT(EPOCH FROM (v_starts - now())) / 3600.0) THEN
        PERFORM public.apply_job_denial_consequence(
          v_user, v_crew.id,
          'Cancelled after committing to: "' || COALESCE(v_crew.title, 'Unknown') || '"');
      END IF;
    END IF;

    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    UPDATE public.applications
       SET status = 'rejected', closed_reason = 'party_blocked'
     WHERE job_id = v_crew.id AND helper_id = v_crew.member AND status = 'accepted';
    DELETE FROM public.group_job_helpers WHERE id = v_crew.slot_id;
    SELECT count(*) INTO v_remaining FROM public.group_job_helpers g WHERE g.job_id = v_crew.id;
    -- Q1378 (owner 2026-10-05): the rest of the crew carries on; only a
    -- crew with nobody left reopens (see helper_cancel_booking).
    IF v_remaining = 0
       AND COALESCE(v_crew.helpers_needed, 1)
           <= (SELECT count(*) FROM public.crew_block_fees b WHERE b.job_id = v_crew.id) THEN
      -- Q1390: every spot is closed by a block, so nobody can ever do the
      -- job and nothing reopens it. A person cancels it (the poster is then
      -- refunded less the block fees, which void-cancelled-payments pays).
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      SELECT r.user_id,
             'Crew job has no spots left',
             format('"%s": every spot on this crew was closed by a block with a fee, so nobody is left to do it. Cancel the job: whoever posted it is refunded less the block fees, which are paid to the members they blocked.',
                    COALESCE(v_crew.title, 'A job')),
             'admin_alert',
             '/admin?view=jobs&job=' || v_crew.id::text,
             v_crew.id
        FROM public.user_roles r
       WHERE r.role = 'admin';
    ELSIF v_crew.status = 'accepted' AND v_remaining = 0 THEN
      UPDATE public.jobs SET status = 'open' WHERE id = v_crew.id;
    END IF;
    PERFORM set_config('app.trusted_ladder_write', 'off', true);

    -- The other side is told; neither notice says who blocked whom.
    IF v_crew.customer_id = v_user THEN
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      -- lh-money-escrow review #2: a member owed a late fee is told so.
      VALUES (v_crew.member, 'You''re off this crew',
              CASE WHEN v_member_fee > 0 AND v_crew.slot_no IS NOT NULL THEN
                format('You''re no longer on the crew for "%s". Because this was close to the start, you''re owed a $%s cancellation fee, paid to you from the job''s payment when the job settles.',
                       COALESCE(v_crew.title, 'a job'), to_char(v_member_fee, 'FM999999990.00'))
              WHEN v_member_fee > 0 THEN
                format('You''re no longer on the crew for "%s". Because this was close to the start, you''re owed a $%s cancellation fee; our team will send it to you.',
                       COALESCE(v_crew.title, 'a job'), to_char(v_member_fee, 'FM999999990.00'))
              ELSE format('You''re no longer on the crew for "%s".', COALESCE(v_crew.title, 'a job')) END,
              CASE WHEN v_member_fee > 0 THEN 'payment' ELSE 'warning' END,
              '/jobs?job=' || v_crew.id::text, v_crew.id);
    ELSE
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (v_crew.customer_id, 'A Helpr left your crew',
              'One of your Helprs can''t make "' || COALESCE(v_crew.title, 'your job')
                || CASE WHEN v_crew.status = 'accepted' AND v_remaining > 0
                     THEN '". The rest of your crew is still on. You can hire someone from your applicants for the open spot before it starts; if it stays empty, that spot''s share is refunded to you once the job is done.'
                     ELSE '" — their spot is open to everyone again.'
                   END,
              'warning', '/posts?job=' || v_crew.id::text, v_crew.id);
    END IF;

    v_settled := v_settled || jsonb_build_object(
      'job_id', v_crew.id, 'title', v_crew.title, 'crew', true, 'action', 'member_left',
      'block_fee', CASE WHEN v_crew.slot_no IS NOT NULL THEN v_member_fee ELSE 0 END,
      'fee_owed_by_hand', CASE WHEN v_crew.slot_no IS NULL THEN v_member_fee ELSE 0 END,
      'fee_percent', v_percent);
  END LOOP;

  -- ADDED 2026-09-24 (Q345): what is still PENDING between the two closes too.
  -- Pending applications, either seat: closed silently (notify_on_application
  -- skips closed_reason = 'party_blocked'). Neither the row nor its absence of
  -- a notice says who blocked whom.
  UPDATE public.applications a
     SET status = 'rejected',
         closed_reason = 'party_blocked'
    FROM public.jobs j
   WHERE j.id = a.job_id
     AND a.status = 'pending'
     AND (
          (a.helper_id = v_user    AND j.customer_id = p_blocked)
       OR (a.helper_id = p_blocked AND j.customer_id = v_user)
     );
  GET DIAGNOSTICS v_closed_apps = ROW_COUNT;

  -- A pending direct offer between the two: declined, as if the offered person
  -- had declined it — the job reopens to everyone (C4 no longer reserves it).
  -- Silent: no "Offer declined" notice.
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE direct_offer_status = 'pending'
     -- Only an answerable offer (the "Targeted helper can respond" policy's
     -- shape). A row with helper_id set is not one, and from the helper seat
     -- enforce_helper_jobs_column_whitelist would refuse the write and roll the
     -- block back with it (measured on prod, rolled back, 2026-09-24).
     AND helper_id IS NULL
     AND (
          (customer_id = v_user    AND offered_to_helper_id = p_blocked)
       OR (customer_id = p_blocked AND offered_to_helper_id = v_user)
     );
  GET DIAGNOSTICS v_closed_offers = ROW_COUNT;

  RETURN jsonb_build_object(
    'blocked', p_blocked,
    'settled', v_settled,
    'closed_applications', v_closed_apps,
    'closed_offers', v_closed_offers
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.block_user_and_settle(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_user_and_settle(uuid, text) TO authenticated, service_role;

-- export_my_data: the ledger row is the member's data.
-- Q408: the no-argument door stays dropped (restated with every export).
DROP FUNCTION IF EXISTS public.export_my_data();
CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := p_user_id;
  v_email   text;
  v_created timestamptz;
  v_out   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT lower(u.email), u.created_at INTO v_email, v_created FROM auth.users u WHERE u.id = v_uid;

  v_out := jsonb_build_object('exported_at', now(), 'user_id', v_uid, 'email', v_email);

  v_out := v_out || jsonb_build_object('profile', (SELECT to_jsonb(t) - 'insurance_reviewed_by' - 'license_reviewed_by' FROM public.profiles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('jobs', (SELECT coalesce(jsonb_agg(
        CASE WHEN t.customer_id = v_uid OR public.user_may_see_job_address(t.id, v_uid)
          THEN CASE WHEN t.customer_id = v_uid OR t.offered_to_helper_id = v_uid THEN to_jsonb(t)
                 ELSE to_jsonb(t) - 'offered_to_helper_id' END - 'removed_by'
          ELSE jsonb_build_object(
                 'id', t.id, 'title', t.title, 'category', t.category, 'parish', t.parish,
                 'status', t.status, 'created_at', t.created_at, 'row_limited', true,
                 'offered_to_you', t.offered_to_helper_id IS NOT DISTINCT FROM v_uid,
                 'cancelled_by_you', t.cancelled_by IS NOT DISTINCT FROM v_uid,
                 'disputed_by_you', t.disputed_by IS NOT DISTINCT FROM v_uid,
                 'recurring_helper_is_you', t.recurring_helper_id IS NOT DISTINCT FROM v_uid)
        END), '[]'::jsonb) FROM public.jobs t
      WHERE t.customer_id = v_uid OR t.helper_id = v_uid OR t.recurring_helper_id = v_uid
        OR t.offered_to_helper_id = v_uid OR t.cancelled_by = v_uid OR t.disputed_by = v_uid
        OR t.id IN (SELECT g.job_id FROM public.group_job_helpers g WHERE g.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('applications', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) - 'flag_reason' - 'offer_message_withheld'
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'status', t.status,
          'offer_message', t.offer_message, 'offer_message_withheld', t.offer_message_withheld,
          'offer_message_flagged_hidden', t.offer_message_flagged_hidden, 'decline_reason', t.decline_reason, 'poster_viewed_at', t.poster_viewed_at,
          'closed_reason', t.closed_reason, 'created_at', t.created_at, 'updated_at', t.updated_at) END), '[]'::jsonb) FROM public.applications t
      WHERE t.helper_id = v_uid
        OR (t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid) AND NOT public.are_users_blocked(t.helper_id, v_uid))));
  v_out := v_out || jsonb_build_object('reviews', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.reviews t
      WHERE t.reviewer_id = v_uid
        OR (t.reviewee_id = v_uid AND t.status = 'published'
            AND t.feedback_visible_at IS NOT NULL AND t.feedback_visible_at <= now())));
  v_out := v_out || jsonb_build_object('messages', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'flag_reason'), '[]'::jsonb) FROM public.messages t
      WHERE t.sender_id = v_uid
        OR (t.receiver_id = v_uid AND NOT coalesce(t.flagged_hidden, false))));
  v_out := v_out || jsonb_build_object('message_reactions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.message_reactions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notifications', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_preferences', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_preferences t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('notification_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_logs t
      WHERE t.user_id = v_uid OR (lower(t.recipient_email) = v_email AND t.user_id IS NULL AND t.created_at >= v_created)));
  v_out := v_out || jsonb_build_object('notification_dedupe_suppressions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.notification_dedupe_suppressions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('push_tokens', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'token'), '[]'::jsonb) FROM public.push_tokens t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_jobs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_jobs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_searches', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_searches t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('saved_search_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.saved_search_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('match_digest_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.match_digest_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('parish_match_alert_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.parish_match_alert_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_match_queue', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_match_queue t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('ops_alert_admin_subjects', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.ops_alert_admin_subjects t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('favorite_helpers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.favorite_helpers t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_availability', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_availability t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_credentials', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_credentials t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_verifications', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'changed_by'), '[]'::jsonb) FROM public.helper_verifications t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_checks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.verification_checks t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('verification_exceptions', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.verification_exceptions t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_w9_records', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.helper_w9_records t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('instant_payouts', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.instant_payouts t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by' - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payout_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_cancellation_fee_shares', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'stripe_transfer_id' - 'status' - 'paid_at' END), '[]'::jsonb) FROM public.crew_cancellation_fee_shares t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  -- Q1390: a crew block fee is the member's money record. The member only:
  -- the ledger has no client read policy, and an export never gives a poster
  -- a row the app's own SELECT rules would not (Q739); the poster's side of
  -- it is the notification block_user_and_settle sends.
  v_out := v_out || jsonb_build_object('crew_block_fees', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.crew_block_fees t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('cancellation_fee_transfers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.cancellation_fee_transfers t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payment_refunds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'initiated_by_user_id'), '[]'::jsonb) FROM public.payment_refunds t
      WHERE t.customer_id = v_uid));
  v_out := v_out || jsonb_build_object('chargeback_clawbacks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.chargeback_clawbacks t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tips', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tips t
      WHERE t.tipper_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('tip_hold_redrives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.tip_hold_redrives t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('gift_cards', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'claim_token'), '[]'::jsonb) FROM public.gift_cards t
      WHERE t.donor_id = v_uid OR t.recipient_id = v_uid OR (lower(t.recipient_email) = v_email AND t.recipient_id IS NULL)));
  v_out := v_out || jsonb_build_object('referral_codes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_codes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referral_credits', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referral_credits t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('referrals', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.referrals t
      WHERE t.referrer_id = v_uid OR t.referred_id = v_uid));
  v_out := v_out || jsonb_build_object('reports', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'assigned_to'), '[]'::jsonb) FROM public.reports t
      WHERE t.reporter_id = v_uid));
  v_out := v_out || jsonb_build_object('user_blocks', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_blocks t
      WHERE t.blocker_id = v_uid));
  v_out := v_out || jsonb_build_object('user_bans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'banned_by'), '[]'::jsonb) FROM public.user_bans t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_strikes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'issued_by'), '[]'::jsonb) FROM public.user_strikes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_violations', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'reported_by'), '[]'::jsonb) FROM public.user_violations t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('user_roles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.user_roles t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('legal_acceptances', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.legal_acceptances t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('login_history', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.login_history t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_tracking t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('email_send_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.email_send_log t
      WHERE lower(t.recipient_email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('suppressed_emails', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.suppressed_emails t
      WHERE lower(t.email) = v_email AND t.created_at >= v_created));
  v_out := v_out || jsonb_build_object('job_checkins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_checkins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('job_tracking', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_tracking t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('group_job_helpers', (SELECT coalesce(jsonb_agg(CASE WHEN t.helper_id = v_uid THEN to_jsonb(t)
        ELSE jsonb_build_object('id', t.id, 'job_id', t.job_id, 'helper_id', t.helper_id, 'slot_no', t.slot_no, 'status', t.status,
          'share_cents', t.share_cents, 'poster_confirmed_arrival_at', t.poster_confirmed_arrival_at,
          'poster_confirmed_working_at', t.poster_confirmed_working_at,
          'poster_confirmed_completion_at', t.poster_confirmed_completion_at) END), '[]'::jsonb) FROM public.group_job_helpers t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_releases', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_releases t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('recurring_visit_payments', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.recurring_visit_payments t
      WHERE t.payer_id = v_uid OR t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('job_revisions', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_revisions t
      WHERE t.requested_by = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_completion_nudges', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_completion_nudges t
      WHERE t.resolved_by = v_uid));
  v_out := v_out || jsonb_build_object('disputes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.disputes t
      WHERE t.opener_id = v_uid
        OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid OR j.helper_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_views t
      WHERE t.viewer_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_views', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_views t
      WHERE t.viewer_user_id = v_uid));
  v_out := v_out || jsonb_build_object('pet_profiles', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.pet_profiles t
      WHERE t.owner_id = v_uid));
  v_out := v_out || jsonb_build_object('job_pets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_pets t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_access_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_access_notes t
      WHERE t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('str_calendar_connections', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.str_calendar_connections t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_archives', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_archives t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_mutes', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_mutes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('thread_pins', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.thread_pins t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('nps_responses', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.nps_responses t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('analytics_events', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.analytics_events t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('error_logs', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.error_logs t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('admin_user_notes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'admin_id'), '[]'::jsonb) FROM public.admin_user_notes t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('fraud_flags', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.fraud_flags t
      WHERE t.user_id = v_uid));
  v_out := v_out || jsonb_build_object('helper_shadowbans', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_by'), '[]'::jsonb) FROM public.helper_shadowbans t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('payout_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'held_by' - 'denied_by'), '[]'::jsonb) FROM public.payout_holds t
      WHERE t.helper_id = v_uid));
  v_out := v_out || jsonb_build_object('application_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.application_rate_log t
      WHERE t.applicant_id = v_uid));
  v_out := v_out || jsonb_build_object('profile_search_rate_log', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.profile_search_rate_log t
      WHERE t.searcher_id = v_uid));
  v_out := v_out || jsonb_build_object('crew_dispute_member_outcomes', (SELECT coalesce(jsonb_agg(to_jsonb(t) - 'decided_by'), '[]'::jsonb) FROM public.crew_dispute_member_outcomes t
      WHERE t.helper_id = v_uid OR t.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('job_schedule_change_requests', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.job_schedule_change_requests t
      WHERE t.requested_by = v_uid OR t.responder_id = v_uid));
  v_out := v_out || jsonb_build_object('series_date_offers', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_date_offers t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));
  v_out := v_out || jsonb_build_object('series_visit_holds', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.series_visit_holds t
      WHERE t.helper_id = v_uid OR t.parent_job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = v_uid)));

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.export_my_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_my_data(uuid) TO service_role;
