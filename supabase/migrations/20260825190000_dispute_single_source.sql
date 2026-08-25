-- Disputes had two sources of truth and the UI was reading the dead one.
--
-- `rpc_open_dispute` writes a row into public.disputes and flips
-- jobs.status = 'disputed' — but nothing else. The poster's dispute panel
-- (PostedJobCard) reads the LEGACY jobs.dispute_* mirror columns:
--   * dispute_reason        → the quoted reason, never rendered
--   * disputed_by           → gates the disputer's "Mark Resolved"/"Escalate"
--                             controls, so they NEVER rendered for anyone
--   * dispute_status        → "Under Review"/"Escalated"/"Resolved" label
--   * dispute_deadline      → the 72-hour countdown
-- and the `set_dispute_deadline` BEFORE UPDATE trigger derives the deadline
-- from `disputed_at + 72h` — which rpc_open_dispute also never set, so the
-- deadline resolved to NULL even when the trigger fired. Verified live
-- 2026-08-25: a real filed dispute left every one of those columns NULL.
-- (DisputeDialog's own comment already claimed the RPC "mirrors onto the
-- legacy jobs.dispute_* columns" — this makes that true.)
--
-- Fix: keep public.disputes as the record of truth and have the two RPCs
-- that own dispute lifecycle mirror their state onto jobs in the SAME
-- statement that flips the status, so the trigger sees a populated
-- disputed_at and every existing UI surface lights up. No UI reads are
-- re-pointed and no columns are dropped — one writer, both readers correct.

CREATE OR REPLACE FUNCTION public.rpc_open_dispute(_job_id uuid, _reason text, _evidence_urls text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _customer uuid;
  _helper uuid;
  _existing_id uuid;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT customer_id, helper_id INTO _customer, _helper
  FROM public.jobs WHERE id = _job_id;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    UPDATE public.disputes
    SET evidence_urls = evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls =
             COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
     WHERE id = _job_id;

    RETURN _existing_id;
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger (BEFORE UPDATE, keyed on the flip to
  -- 'disputed') sees a non-null disputed_at and can derive the 72h deadline.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         dispute_status = 'open',
         dispute_evidence_urls =
           COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
   WHERE id = _job_id;

  RETURN _new_id;
END;
$function$;

-- Admin decision mirrors back too, so a decided dispute stops rendering as
-- "Under Review" on the poster's card.
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
         )
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
      '/activity',
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
      '/activity',
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

-- Closing a dispute from the poster's side. The card used to do this with a
-- client-side `jobs.update({status:'completed', dispute_status:'resolved'})`,
-- which told the helper "Payment will be released" while no release path
-- selects that row: auto-release-payment matches only in_progress /
-- revision_requested / accepted, and auto-resolve-disputes matches only
-- status='disputed' — so a poster-resolved dispute left escrow held forever.
-- This closes the dispute record and returns the job to 'in_progress', the
-- state the normal release path (create-payment action=release) accepts, so
-- the caller finishes with the SAME settlement code as an ordinary completion
-- instead of a bespoke one that moves no money.
CREATE OR REPLACE FUNCTION public.rpc_withdraw_dispute(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _opener uuid;
  _dispute_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT id, opener_id INTO _dispute_id, _opener
    FROM public.disputes
   WHERE job_id = _job_id AND status = 'open'
   ORDER BY created_at DESC
   LIMIT 1
     FOR UPDATE;

  IF _dispute_id IS NULL THEN
    RAISE EXCEPTION 'no open dispute for this job';
  END IF;

  -- Only whoever raised it may withdraw it. The other party's route out is
  -- the admin decision path, not a unilateral close.
  IF _opener IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'only the party who opened this dispute may withdraw it';
  END IF;

  UPDATE public.disputes
     SET status = 'withdrawn',
         decided_at = now()
   WHERE id = _dispute_id;

  UPDATE public.jobs
     SET status = 'in_progress',
         dispute_status = 'resolved',
         dispute_resolved_at = now()
   WHERE id = _job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_withdraw_dispute(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_dispute(uuid) TO authenticated;

-- The transition matrix allowed disputed -> completed|cancelled only, so the
-- withdraw above (disputed -> in_progress, handing the job back to the normal
-- release path) would be rejected for a non-admin caller. Withdrawing a
-- dispute genuinely returns the job to "work happened, settle it normally",
-- so the pair is added rather than worked around. Everything else in the
-- matrix is reproduced verbatim.
CREATE OR REPLACE FUNCTION public.enforce_job_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('open',                'accepted'),
      ('open',                'cancelled'),
      ('accepted',            'open'),
      ('accepted',            'in_progress'),
      ('accepted',            'completed'),
      ('accepted',            'cancelled'),
      ('accepted',            'disputed'),
      ('in_progress',         'completed'),
      ('in_progress',         'revision_requested'),
      ('in_progress',         'cancelled'),
      ('in_progress',         'disputed'),
      ('in_progress',         'open'),
      ('revision_requested',  'in_progress'),
      ('revision_requested',  'completed'),
      ('revision_requested',  'cancelled'),
      ('revision_requested',  'disputed'),
      ('disputed',            'completed'),
      ('disputed',            'cancelled'),
      ('disputed',            'in_progress'),
      ('completed',           'disputed')
    ) AS allowed(from_status, to_status)
    WHERE allowed.from_status = OLD.status::text
      AND allowed.to_status   = NEW.status::text
  ) THEN
    RAISE EXCEPTION
      'Invalid job status transition: % -> % (job_id=%)',
      OLD.status, NEW.status, OLD.id
      USING
        ERRCODE = 'check_violation',
        HINT = 'See enforce_job_status_transition() in the migrations for the allowed transition matrix. Admins bypass this check.';
  END IF;

  RETURN NEW;
END;
$function$;
