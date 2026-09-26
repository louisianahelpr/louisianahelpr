-- Q344: a decided dispute told both parties "Dispute resolved" before any money
-- moved.
--
-- rpc_decide_dispute records the decision and the split; execute-dispute-split
-- moves the money later (an admin action, and it can fail and be retried). The
-- decision transaction notified both parties 'Dispute resolved', which reads as
-- settled: the poster looks for a refund and the Helpr for a payout that has not
-- happened. execute-dispute-split already sends the settlement notice ("Dispute
-- settled — ...") to each party with a share when the money moves, so this
-- notice now says what is true at decision time: decided, payment processing.
--
-- Also (lh-money-escrow review of Q342, M1): the decision now refuses a job
-- whose payment_status is 'chargeback' ('dispute_job_charged_back'). A decision
-- recorded there can never execute, so it would recreate Q342's stuck dispute
-- by the back door (dispute open -> chargeback lost -> decided afterwards).
--
-- Recreated from the LIVE pg_get_functiondef (md5 667388243a14ba3262ac484ec41c98fc,
-- 2026-09-26, identical to 20260924220318's body) with ONLY the two notification
-- titles and messages changed, plus the refusal above. jobs.status / dispute_status semantics are NOT
-- changed: release-payout, _chargebackHold and money-reconciliation read them.
-- The job cards' "Done · paid" line is fixed client-side (jobStatusLine.ts,
-- useUnsettledDisputeJobIds), from the dispute row's execution_status.
--
-- Replay-safe: CREATE OR REPLACE of a function 20260915034822 defines; the ACL
-- is restated.

CREATE OR REPLACE FUNCTION public.rpc_decide_dispute(_dispute_id uuid, _decision_text text, _payout_split jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _job_id uuid;
  _customer_id uuid;
  _helper_id uuid;
  _job_title text;
  _existing_status text;
  _poster_share numeric;
  _helper_share numeric;
  _new_job_status text;
  _payment_status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF _decision_text IS NULL OR length(trim(_decision_text)) = 0 THEN
    RAISE EXCEPTION 'decision_text required';
  END IF;

  -- Lock order jobs -> disputes (lh-authz-rls review of the rebase). The job
  -- id is looked up unlocked (disputes.job_id never changes), the job is
  -- locked, then the dispute row, and its status is judged under that lock.
  SELECT job_id INTO _job_id
    FROM public.disputes
   WHERE id = _dispute_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  -- FOR UPDATE, 20260915034822 (round 4): the claim check below must read under
  -- the same jobs lock claim_dispute_settlement takes before it inserts, so a
  -- Quick Release / Quick Refund / sweep either committed its claim first
  -- (visible, refused) or waits behind this decision (and then finds the job
  -- no longer disputed). Lock order jobs -> disputes.
  SELECT customer_id, helper_id, title, payment_status
    INTO _customer_id, _helper_id, _job_title, _payment_status
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- The dispute is judged from THIS locked re-read, not the unlocked lookup
  -- above (lh-money-escrow review, MEDIUM-2). Its own NOT FOUND is load-
  -- bearing: a dispute deleted between the lookup and this lock leaves
  -- `_existing_status` NULL, and `NULL <> 'open'` is NULL — falling through the
  -- gate and letting the UPDATE below strand the job's escrow. `IS DISTINCT
  -- FROM` so a NULL that slips past NOT FOUND still refuses.
  SELECT status INTO _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _existing_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'dispute already %', COALESCE(_existing_status, 'gone');
  END IF;

  -- An admin who is a party to the job does not rule on it (round-4 review).
  IF _uid = _customer_id OR _uid = _helper_id THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to decide its dispute.';
  END IF;

  -- Not while a settlement holds (or a dead holder stamped) the escrow: a
  -- decision recorded under a live Quick Release became a decided, unexecuted
  -- split over an escrow that had just been paid out (round-4 review). An
  -- expired claim that never stamped a money step moved nothing.
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'This dispute''s payment is being settled right now, so it can''t be decided. Refresh in a few minutes.';
  END IF;

  -- Q342 follow-on (lh-money-escrow review M1): a decision on a job the card
  -- holder's bank has charged back can never be executed (the split, supersede
  -- and the no-payment close all refuse 'chargeback'), so recording it only
  -- manufactures a decided dispute that is stuck forever. The bank's ruling
  -- comes first: a LOST one is paged by the stripe-webhook
  -- (settle_dispute_by_chargeback answers needs_human for an open dispute on a
  -- charged-back job), a WON one is Q427. Read by the FOR UPDATE above.
  IF _payment_status = 'chargeback' THEN
    RAISE EXCEPTION 'dispute_job_charged_back'
      USING HINT = 'The card holder''s bank is holding this payment in a card dispute, so no split could move it. Settle it by hand once the bank rules.';
  END IF;

  _poster_share := COALESCE((_payout_split->>'poster')::numeric, 0.5);
  _helper_share := COALESCE((_payout_split->>'helper')::numeric, 0.5);
  IF _poster_share > 1 OR _helper_share > 1 THEN
    _poster_share := _poster_share / 100.0;
    _helper_share := _helper_share / 100.0;
  END IF;

  IF _poster_share >= 1 AND _helper_share <= 0 THEN
    _new_job_status := 'cancelled';
  ELSE
    _new_job_status := 'completed';
  END IF;

  UPDATE public.disputes
     SET status = 'decided',
         decided_at = now(),
         decided_by = _uid,
         decision_text = _decision_text,
         payout_split = jsonb_build_object(
           'poster', _poster_share,
           'helper', _helper_share
         ),
         -- The decision is on record; the money is not. Until
         -- execute-dispute-split flips this to 'executed', this dispute is
         -- UNSETTLED and stays in the admin's open work.
         execution_status = COALESCE(disputes.execution_status, 'pending')
   WHERE id = _dispute_id;

  UPDATE public.jobs
     SET status = _new_job_status::public.job_status,
         dispute_resolved_at = now(),
         dispute_status = 'resolved'
   WHERE id = _job_id;

  IF _customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _customer_id,
      'info',
      'Dispute decided',
      'A decision has been made on "' || COALESCE(_job_title, 'your job') || '": ' || _decision_text || ' The payment is still being processed; the job shows as settled once it has moved.',
      '/posts?job=' || _job_id::text,
      false
    );
  END IF;

  IF _helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _helper_id,
      'info',
      'Dispute decided',
      'A decision has been made on "' || COALESCE(_job_title, 'a job you worked') || '": ' || _decision_text || ' The payment is still being processed; the job shows as settled once it has moved.',
      '/jobs?job=' || _job_id::text,
      false
    );
  END IF;

  -- Audit-log entry so this admin action shows up alongside every other
  -- admin mutation in AdminAuditLog. Non-fatal — the decision itself has
  -- already committed; a failed audit write shouldn't roll it back.
  BEGIN
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (
      _uid,
      'decide_dispute',
      _dispute_id,
      'dispute',
      jsonb_build_object(
        'job_id', _job_id,
        'poster_share', _poster_share,
        'helper_share', _helper_share,
        'new_job_status', _new_job_status,
        'decision_preview', left(_decision_text, 200)
      )
    );
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO authenticated, service_role;
