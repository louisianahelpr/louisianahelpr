-- Design audit area 04 #15 (11-18): the poster's notice when the Helpr declines a refund request still said
-- "Your refund request goes to Helpr" / "A real person at Helpr will decide", and the come-back offer said "decline it
-- and a real person at Helpr will decide". "goes to Helpr" reads like the member's Helpr (the person on the job), the
-- same misreading F193 fixed everywhere else on 11-09 (20261109224952_notices_card_fee_and_our_team.sql), which left
-- this function out because the repo definition differed from LIVE. One phrase: "our team".
--
-- The body is the LIVE definition: prod's prosrc read 11-18 (md5 1729f17ad408176d6bbd734ff54de630, 196 lines) equals
-- the repo definition (20261021102943_refund_requests.sql) on every line but one, the 'all' refund line a later
-- migration reworded ("Most of what you paid is on its way back ..."), which is copied here as LIVE has it. Only three
-- string literals change; no logic, no money. Header, grants and owner as LIVE (proacl: authenticated, service_role).
-- Replay-safe: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.rpc_answer_refund_request(
  p_request_id uuid,
  p_answer text,
  p_date date DEFAULT NULL,
  p_start_time time without time zone DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job_id uuid;
  v_job record;
  v_req record;
  v_poster_share numeric;
  v_helper_share numeric;
  v_dispute uuid;
  v_change jsonb;
  v_helpr text;
  v_money text;
  v_rush_back integer;
BEGIN
  PERFORM public.require_feature('refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_answer IS NULL OR p_answer NOT IN ('agree', 'finish', 'decline') THEN
    RAISE EXCEPTION 'refund_request_invalid';
  END IF;

  SELECT r.job_id INTO v_job_id FROM public.refund_requests r WHERE r.id = p_request_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'refund_request_not_found';
  END IF;
  -- Lock order jobs -> refund_requests; judged from the locked re-reads.
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.budget, j.urgent_fee
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.refund_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL OR v_job.id IS NULL THEN
    RAISE EXCEPTION 'refund_request_not_found';
  END IF;
  -- Only the Helpr asked, and still the job's Helpr, answers. IS DISTINCT
  -- FROM: a NULL on either side (an account gone) refuses.
  IF v_uid IS DISTINCT FROM v_req.responder_id OR v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'refund_request_not_yours' USING ERRCODE = '42501';
  END IF;
  IF v_req.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'refund_request_answered';
  END IF;
  -- The poster's account is gone (its delete is refused while a request is
  -- live, so this is a backstop): nobody to refund, nothing to agree to.
  IF v_req.requester_id IS NULL OR v_req.requester_id IS DISTINCT FROM v_job.customer_id THEN
    RAISE EXCEPTION 'refund_request_poster_gone';
  END IF;
  IF now() >= v_req.answer_by THEN
    RAISE EXCEPTION 'refund_request_expired';
  END IF;
  PERFORM public.refund_request_assert_job_open(v_job_id);

  SELECT public.member_display_name(p.full_name, 'Your Helpr') INTO v_helpr
    FROM public.profiles p WHERE p.user_id = v_uid;
  v_helpr := COALESCE(v_helpr, 'Your Helpr');
  v_money := public.refund_request_dollars(v_req.amount_cents);
  -- Owner 2026-10-21: an agreed part also returns the same share of the rush
  -- fee (refund_request_rush_back_cents == execute-dispute-split's rule).
  v_rush_back := CASE WHEN v_req.refund_scope = 'part'
    THEN public.refund_request_rush_back_cents(greatest(round(COALESCE(v_job.urgent_fee, 0) * 100), 0)::integer,
                                               v_req.amount_cents, v_req.budget_cents)
    ELSE 0 END;

  IF p_answer = 'agree' THEN
    -- The price the request was computed on must still be the job's price
    -- (a booked job's price is locked, so this is a backstop).
    IF round(COALESCE(v_job.budget, 0) * 100)::integer IS DISTINCT FROM v_req.budget_cents THEN
      RAISE EXCEPTION 'refund_request_stale';
    END IF;
    -- Shares of the award, as rpc_decide_dispute records them (fractions).
    -- From the STORED request only: nothing the client sends reaches them.
    v_poster_share := round(v_req.amount_cents::numeric / v_req.budget_cents, 8);
    v_helper_share := 1 - v_poster_share;

    INSERT INTO public.disputes
      (job_id, opener_id, reason, evidence_urls, status, decided_at, decided_by, decided_via,
       agreed_poster_id, agreed_helper_id, decision_text, payout_split, execution_status)
    VALUES
      (v_job_id, v_req.requester_id, v_req.reason, '{}'::text[], 'decided', now(), NULL, 'agreement',
       v_req.requester_id, v_uid,
       CASE WHEN v_rush_back > 0
         THEN format('Agreed by both: %s of the %s price and %s of the rush fee back to the person who posted it.',
                     v_money, public.refund_request_dollars(v_req.budget_cents), public.refund_request_dollars(v_rush_back))
         ELSE format('Agreed by both: %s of the %s price back to the person who posted it.',
                     v_money, public.refund_request_dollars(v_req.budget_cents)) END,
       jsonb_build_object('poster', v_poster_share, 'helper', v_helper_share),
       -- Decided, not settled: the sweep runs execute-dispute-split on it.
       'pending')
    RETURNING id INTO v_dispute;

    UPDATE public.refund_requests
       SET status = 'agreed', answered_at = now(), answered_by = v_uid, dispute_id = v_dispute
     WHERE id = p_request_id;

    -- The audit row: who agreed to what, before any money moves. Not
    -- swallowed: an agreement with no trail does not stand.
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (NULL, 'refund_agreement_recorded', v_dispute::text, 'dispute',
            jsonb_build_object('request_id', p_request_id, 'job_id', v_job_id,
                               'poster_id', v_req.requester_id, 'helper_id', v_uid,
                               'amount_cents', v_req.amount_cents, 'budget_cents', v_req.budget_cents,
                               'poster_share', v_poster_share, 'helper_share', v_helper_share));

    IF v_req.requester_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requester_id, v_job_id,
        'Refund agreed',
        -- Q2298 (owner, 2026-10-21): a PART refund returns EXACTLY the amount
        -- asked; ALL of it returns what was paid less the card processing fee,
        -- as an admin's full refund does (execute-dispute-split).
        CASE WHEN v_req.refund_scope = 'all'
          THEN format('%s agreed to refund all of "%s". Most of what you paid is on its way back to how you paid. Your receipt shows the exact amount.',
                      v_helpr, COALESCE(v_job.title, 'your job'))
          WHEN v_rush_back > 0
          THEN format('%s agreed to your refund on "%s": %s is on its way back to how you paid (%s of the price and %s of the rush fee).',
                      v_helpr, COALESCE(v_job.title, 'your job'), public.refund_request_dollars(v_req.amount_cents + v_rush_back),
                      v_money, public.refund_request_dollars(v_rush_back))
          ELSE format('%s agreed to your refund on "%s": %s is on its way back to how you paid.',
                      v_helpr, COALESCE(v_job.title, 'your job'), v_money)
        END,
        'payment',
        '/posts?job=' || v_job_id::text
      );
    END IF;
    RETURN jsonb_build_object('status', 'agreed', 'dispute_id', v_dispute);

  ELSIF p_answer = 'decline' THEN
    -- A normal dispute, filed as the poster's complaint in their own words,
    -- is opened by the service sweep (refund_requests_sweep, within minutes),
    -- never here: open_dispute_as writes the job's dispute markers, and from
    -- the Helpr's own session enforce_helper_jobs_column_whitelist refuses a
    -- changed dispute_resolved_at (a job whose earlier dispute was
    -- withdrawn). Until it opens, refuse_payout_pending_while_refund_requested
    -- and every payout path treat this declined request as live.
    UPDATE public.refund_requests
       SET status = 'declined', answered_at = now(), answered_by = v_uid
     WHERE id = p_request_id;
    IF v_req.requester_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requester_id, v_job_id,
        'Your refund request goes to our team',
        format('%s didn''t agree to the refund on "%s". Our team will decide. The payment stays on hold until then.',
               v_helpr, COALESCE(v_job.title, 'your job')),
        'payment',
        '/posts?job=' || v_job_id::text
      );
    END IF;
    RETURN jsonb_build_object('status', 'declined');

  ELSE
    -- 'finish': the existing date/time request. Its own rules (a time at
    -- least an hour out, no clash) apply. Q2326 (owner, 2026-10-21): on a job
    -- already UNDER WAY it accepts the new time only for this answer, under
    -- the transaction-local flag set just around the call (section 6b); a
    -- booked job not started yet goes through it exactly as before.
    IF p_date IS NULL THEN
      RAISE EXCEPTION 'refund_request_needs_time';
    END IF;
    -- A come-back is within 7 days (owner, 2026-10-21; first set at 14 by the
    -- reviews): the request holds the payment while it waits, so the Helpr
    -- cannot push it out without limit.
    IF p_date > (now() AT TIME ZONE 'America/Chicago')::date + 7 THEN
      RAISE EXCEPTION 'refund_request_finish_too_far';
    END IF;
    PERFORM set_config('app.refund_finish_rpc', '1', true);
    v_change := public.request_job_schedule_change(v_job_id, p_date, p_start_time);
    PERFORM set_config('app.refund_finish_rpc', '0', true);
    UPDATE public.refund_requests
       SET status = 'finish_offered', answered_at = now(), answered_by = v_uid,
           schedule_change_id = NULLIF(v_change->>'request_id', '')::uuid
     WHERE id = p_request_id;
    IF v_req.requester_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requester_id, v_job_id,
        'Offer to come back and finish',
        format('%s offered to come back and finish "%s" on %s%s instead of a refund. Accept the new time on the job, or decline it and our team will decide.',
               v_helpr, COALESCE(v_job.title, 'your job'),
               to_char(p_date, 'FMDy FMMon FMDD'),
               CASE WHEN p_start_time IS NULL THEN '' ELSE ' at ' || to_char(p_start_time, 'FMHH12:MI AM') END),
        'job_updates',
        '/posts?job=' || v_job_id::text
      );
    END IF;
    RETURN jsonb_build_object('status', 'finish_offered',
                              'schedule_change_id', v_change->>'request_id');
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rpc_answer_refund_request(uuid, text, date, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_answer_refund_request(uuid, text, date, time without time zone) TO authenticated, service_role;
