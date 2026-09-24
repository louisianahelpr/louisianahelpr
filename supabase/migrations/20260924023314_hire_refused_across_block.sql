-- Q345 (1)+(3). No hire across a block, on any of the three hire RPCs.
--
-- WHAT WAS BROKEN (read live on prod fncmgoasalhdgfwzhsqa, 2026-09-24,
-- pg_get_functiondef, read-only):
--
--   Q341 (20260924020956) refused NEW applications across a block (trigger C10)
--   and hid blocked applicants from the poster's SELECT. But an application
--   filed BEFORE the block is still a pending row, and the hire RPCs take its id
--   directly and are SECURITY DEFINER, so the SELECT policy never applies:
--     accept_application        UPDATE applications SET status='accepted' + jobs.helper_id
--     accept_group_application  same, plus INSERT group_job_helpers
--   Neither looked at user_blocks. Live: 1 pending application on an open job
--   across a block (4ce7742d…), hireable by id.
--
--   respond_to_direct_offer's accept branch INSERTs an applications row, so C10
--   already refuses it, but only from inside the trigger: the RPC had no copy
--   for applicant_blocked (generic fallback), and rpcErrorCopyCoverage cannot
--   see a code raised by a trigger. The check is now named in the RPC itself,
--   on the ACCEPT branch only — declining an offer across a block still works.
--
-- The hire-RPC inventory (live pg_proc, 2026-09-24: every public function that
-- sets applications/jobs status to 'accepted' or inserts group_job_helpers) is
-- exactly these three; src/test/hireRefusedAcrossBlock.test.ts pins that list.
--
-- COPY/PRIVACY: one code, applicant_blocked, whichever side blocked; nothing in
-- the message says who blocked whom.
--
-- Bodies are verbatim from the live definitions read 2026-09-24, plus the block
-- check. Every existing RAISE code is preserved (migrationRaiseCodesPreserved).
-- The one existing cross-block row (4ce7742d, the owner's real account) is not
-- touched: this changes what the RPCs do from now on, not any row.
--
-- REPLAY-SAFETY: CREATE OR REPLACE with unchanged signatures; are_users_blocked
-- predates this file and is resolved at call time.

CREATE OR REPLACE FUNCTION public.accept_application(p_application_id uuid, p_deadline timestamp with time zone, p_offer_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_helper_id uuid;
  v_app_status text;
  v_job_status text;
  v_job_customer uuid;
BEGIN
  -- Resolve the application and the job it belongs to. The job is
  -- derived from the application itself, so a poster can only ever
  -- accept against a job that application actually belongs to.
  SELECT a.job_id, a.helper_id, a.status
    INTO v_job_id, v_helper_id, v_app_status
  FROM public.applications a
  WHERE a.id = p_application_id;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'application_not_found';
  END IF;

  -- Lock the job row — concurrent accepts serialize here.
  SELECT j.status, j.customer_id
    INTO v_job_status, v_job_customer
  FROM public.jobs j
  WHERE j.id = v_job_id
  FOR UPDATE;

  -- Authorize: only the job's poster may accept an applicant.
  IF v_job_customer IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Q345: no hire across a block, in either direction. After not_authorized,
  -- so only the job's own poster ever learns this refusal.
  IF public.are_users_blocked(v_helper_id, v_job_customer) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;

  -- Race guard: the job must still be open. The second of two
  -- concurrent accepts hits this and is rejected.
  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_app_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;

  UPDATE public.applications
     SET status = 'accepted',
         offer_message = COALESCE(p_offer_message, offer_message)
   WHERE id = p_application_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = v_helper_id,
         response_deadline = p_deadline
   WHERE id = v_job_id;
END;
$function$;

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
  v_existing_lead uuid;
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
  SELECT j.status, j.customer_id, j.is_group_job, j.helpers_needed, j.helper_id
    INTO v_job_status, v_job_customer, v_is_group, v_needed, v_existing_lead
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
  -- 23505 rather than a silently duplicated slot.
  INSERT INTO public.group_job_helpers (job_id, helper_id)
  VALUES (v_job_id, v_helper_id);

  v_current := v_current + 1;

  UPDATE public.jobs
     SET
         -- Keep the legacy single-helper column pointing at the first accepted
         -- helper so existing payout/notification paths keep resolving.
         helper_id = COALESCE(v_existing_lead, v_helper_id),
         -- Stay 'open' while partially staffed; only the final slot closes it.
         status = CASE WHEN v_current >= v_needed THEN 'accepted' ELSE 'open' END,
         response_deadline = COALESCE(p_deadline, response_deadline)
   WHERE id = v_job_id;

  slots_filled := v_current;
  slots_total := v_needed;
  roster_complete := v_current >= v_needed;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(p_job_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_customer uuid;
  v_app_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- Q345: no hire across a block, in either direction. The applications
    -- trigger (C10) would refuse the INSERT below anyway; naming it here gives
    -- the caller a code this RPC owns, and copy for it. Accept branch only:
    -- declining an offer across a block is still allowed.
    IF public.are_users_blocked(auth.uid(), v_customer) THEN
      RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
    END IF;

    -- The real applications row the synthetic 'direct-<id>' stood in for.
    -- ON CONFLICT covers the helper who somehow also applied to the same job
    -- before the offer landed: promote their existing row instead of
    -- colliding with the (job_id, helper_id) unique index.
    INSERT INTO public.applications (job_id, helper_id, message, status)
    VALUES (p_job_id, auth.uid(), NULL, 'accepted')
    ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
    RETURNING id INTO v_app_id;

    UPDATE public.jobs
       SET status = 'accepted',
           helper_id = auth.uid(),
           direct_offer_status = 'accepted',
           -- The helper accepting IS the confirmation. There is no second
           -- "confirm you'll be there" step on this path — the poster already
           -- chose them, so requiring another tap would strand the job in
           -- accepted-but-unconfirmed forever.
           helper_confirmed_at = v_now,
           response_deadline = NULL,
           direct_offer_expires_at = NULL
     WHERE id = p_job_id;

    RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         'Your direct offer for "' || title || '" was declined. The job is open to all helpers again.',
         'job_updates',
         '/my-posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$function$;

-- Restate the live ACLs exactly (postgres, authenticated, service_role), with
-- the explicit anon revoke CLAUDE.md requires.
REVOKE ALL ON FUNCTION public.accept_application(uuid, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_group_application(uuid, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_application(uuid, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_group_application(uuid, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated, service_role;
