-- A recorded dispute decision is UNSETTLED until the money actually moves.
--
-- `rpc_decide_dispute` commits the decision — disputes.status='decided',
-- jobs.status='completed'/'cancelled', jobs.dispute_status='resolved',
-- notifications to both parties — and only THEN does the client invoke
-- `execute-dispute-split`. When that call refuses (a 409 for an escrow with no
-- PaymentIntent, a 502 from Stripe, a closed tab), the decision stays committed
-- and `disputes.execution_status` stays NULL. Nothing distinguishes that row
-- from a dispute nobody has decided yet, so no query, queue or alert can find
-- it. Dispute c7a12050-1542-40f0-99b6-189c47a13bd8 sat in exactly that state on
-- prod with $180 of escrow unsettled: status='decided', job='completed',
-- jobs.payment_status='escrow', every execution_* column NULL.
--
-- This makes "decided but not settled" a state the database can be QUERIED for
-- rather than an absence: the decision itself stamps execution_status='pending'.
--
--   NULL      → no decision has ever been recorded (an open dispute)
--   'pending' → decided, settlement not yet attempted   ← the new, findable state
--   'executing' / 'failed' → attempted, unfinished      (re-claimable)
--   'executed' → terminal; the money moved
--
-- COALESCE, not an unconditional write: a re-decide must never walk back a
-- settlement that already happened.
--
-- Paired with two code changes in the same commit:
--   * execute-dispute-split treats 'pending' as "never attempted", NOT as a
--     resume — a resume widens the payment-state gate to released/refunded, and
--     a first attempt must never inherit that.
--   * every pre-claim refusal in that function now records the reason via
--     markFailed, so a refusal is a row, not just a toast.

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

  SELECT job_id, status INTO _job_id, _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _existing_status <> 'open' THEN
    RAISE EXCEPTION 'dispute already %', _existing_status;
  END IF;

  SELECT customer_id, helper_id, title
    INTO _customer_id, _helper_id, _job_title
    FROM public.jobs
   WHERE id = _job_id;

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
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'your job') || '": ' || _decision_text,
      '/my-posts?job=' || _job_id::text,
      false
    );
  END IF;

  IF _helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _helper_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'a job you worked') || '": ' || _decision_text,
      '/my-jobs?job=' || _job_id::text,
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

-- The grants this function already carries are preserved by CREATE OR REPLACE,
-- but naming the roles is the house rule (a REVOKE FROM PUBLIC alone does not
-- revoke anon — Supabase grants each role individually).
REVOKE ALL ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO authenticated;

-- Backfill: every dispute decided BEFORE this migration is in the invisible
-- state by construction. Give them the same 'pending' marker so the admin queue
-- and the Exception Queue can find them. This writes a flag only — it moves no
-- money and touches no job row. A dispute whose money genuinely settled already
-- has execution_status='executed' and is excluded.
UPDATE public.disputes
   SET execution_status = 'pending'
 WHERE status = 'decided'
   AND execution_status IS NULL;

-- The unsettled-dispute queries are `status='decided' AND execution_status <>
-- 'executed'`. Partial index so that stays a cheap read as the decided history
-- grows — the interesting rows are always a small minority of it.
CREATE INDEX IF NOT EXISTS disputes_unsettled_idx
    ON public.disputes (decided_at DESC)
 WHERE status = 'decided'
   AND execution_status IS DISTINCT FROM 'executed';
