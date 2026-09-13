-- Wave two of the job-row race class, proven on PROD 2026-09-13 with
-- scripts/probes/race2-prod.probe.mjs (20 rounds each, seed accounts, every
-- fixture row deleted). Wave one is 20260913014328.
--
-- ── 1. settle_dispute_record — 3/20 (timing-dependent; the window is the
--      gap between the unlocked read and the terminal dispute write) ──────
-- It read public.jobs with NO row lock, decided "this job's money has settled",
-- and then wrote the dispute row TERMINAL (status='decided',
-- execution_status='executed'). A re-file landing inside that window takes the
-- job row FOR UPDATE and flips it back to status='disputed' /
-- dispute_status='open' — and the settle, still holding the pre-re-file
-- snapshot, closed the record belonging to that live dispute. The result is a
-- job the database says is live-disputed with NO open dispute record: invisible
-- to the admin queue, refused by rpc_decide_dispute ('dispute already decided')
-- and by execute-dispute-split (409 'already been executed'), with the escrow
-- frozen and no recovery short of manual SQL.
-- FIX: the read takes FOR SHARE, so the settle waits for the re-file's
-- FOR UPDATE, sees the re-frozen state and takes its own existing
-- "job is not settled" RAISE. Same one-word fix as enforce_application_job_state
-- in 20260913014328.
--
-- ── 2. DisputeDialog double submit — 20/20 ───────────────────────────────
-- The dialog's only guard is React state (`setSubmitting(true)`), which does
-- not land until the next render, so two clicks in one JS task send two
-- rpc_open_dispute calls. The second takes open_dispute_as's existing-dispute
-- branch and APPENDED the same evidence array again: every round stored each
-- url twice, on the job and on the dispute record, so the admin deciding it
-- sees the same photo listed twice and cannot tell a duplicate from two shots
-- of the same damage.
-- FIX at the database: the append is now set-like (array_append_missing), so
-- re-filing with evidence already on record adds nothing. The synchronous
-- in-flight ref in DisputeDialog.tsx is the client half — the same guard
-- useApplyFlow got for Apply Now.
--
-- ── 3. helper_completed_at — 20/20 ───────────────────────────────────────
-- JobTracking's Done step writes `.update({ helper_completed_at })` with an id
-- predicate and nothing else, and enforce_helper_completion_gates judges
-- arrival, photos and the 30-minute floor but never the job's STATUS. Queued
-- behind poster_cancel_job()'s FOR UPDATE it stamped a CANCELLED job in 20 of
-- 20 rounds — the helper is told their payout clock started on a job that is
-- cancelled, priced at $0, and will never pay; the stamp is also what the
-- earnings and work-record surfaces read as "work completed".
-- FIX: trg_completion_on_live_job, modelled exactly on trg_confirm_on_live_job
-- from wave one. OLD is the row version this UPDATE locked — the one the
-- concurrent cancel committed — so judging OLD.status is judging the truth at
-- lock time. Client half: .in("status", …) on the same write.
--
-- REPLAY-SAFETY: every object here is CREATE OR REPLACE or DROP-then-CREATE,
-- and nothing reads an object a later migration defines at DDL time (plpgsql
-- bodies resolve at call time).

-- ── array_append_missing ─────────────────────────────────────────────────
-- Set-like append for the evidence arrays. NULL-safe on both sides, order
-- preserving, and IMMUTABLE so it can sit inside an UPDATE ... SET.
CREATE OR REPLACE FUNCTION public.array_append_missing(_base text[], _add text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(_base, '{}'::text[]) || COALESCE(
    (SELECT array_agg(u ORDER BY ord)
       FROM unnest(COALESCE(_add, '{}'::text[])) WITH ORDINALITY AS t(u, ord)
      WHERE NOT (u = ANY (COALESCE(_base, '{}'::text[])))),
    '{}'::text[]
  );
$$;

REVOKE ALL ON FUNCTION public.array_append_missing(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.array_append_missing(text[], text[]) TO authenticated, service_role;

-- ── 3. helper_completed_at must land on a LIVE job ───────────────────────
CREATE OR REPLACE FUNCTION public.enforce_completion_on_live_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only real end-user sessions are judged, exactly as enforce_confirm_on_live_job
  -- beside it. create-payment's release path writes this column on the
  -- service-role client and checks the status itself (index.ts:604-610).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only the stamping transition. Clearing it, or a re-save that leaves it as
  -- it was, is not a completion.
  IF NEW.helper_completed_at IS NULL OR OLD.helper_completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- OLD is the row version this UPDATE locked — the one the concurrent cancel
  -- (or the dispute, or the admin removal) committed, if there was one.
  IF OLD.status::text NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'job_not_completable'
      USING ERRCODE = '42501',
            HINT = 'This job is no longer active (status=' || OLD.status::text || '), so it cannot be marked done.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_completion_on_live_job() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_completion_on_live_job ON public.jobs;
CREATE TRIGGER trg_completion_on_live_job
  BEFORE UPDATE OF helper_completed_at ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_completion_on_live_job();

-- ── 1. settle_dispute_record: the jobs read takes FOR SHARE ──────────────
-- Body is 20260908024646's verbatim, with FOR SHARE added to the SELECT and
-- nothing else changed.
CREATE OR REPLACE FUNCTION public.settle_dispute_record(
  _job_id uuid,
  _outcome text,
  _decided_by uuid DEFAULT NULL::uuid,
  _decision_text text DEFAULT NULL::text,
  _helper_cents integer DEFAULT NULL::integer,
  _refund_cents integer DEFAULT NULL::integer,
  _transfer_id text DEFAULT NULL::text,
  _refund_id text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _job_status      text;
  _payment_status  text;
  _dispute_status  text;
  _resolved_at     timestamptz;
  _settled_to      text;
  _poster_share    numeric;
  _helper_share    numeric;
  _dispute_id      uuid;
BEGIN
  IF _outcome IS NULL OR _outcome NOT IN ('helper', 'poster') THEN
    RAISE EXCEPTION 'settle_dispute_record: _outcome must be ''helper'' or ''poster'', got %', _outcome
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- A negative amount is always a caller bug, and clamping it to 0 would turn
  -- a sign error into a money CLAIM ("$0.00 settled") that reads as deliberate
  -- and can never be corrected — the row is terminal after this. Refuse it.
  IF _helper_cents < 0 OR _refund_cents < 0 THEN
    RAISE EXCEPTION 'settle_dispute_record: negative amount (helper=%, refund=%) for job %', _helper_cents, _refund_cents, _job_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- FOR SHARE, added 2026-09-13. Everything below decides, from this snapshot,
  -- whether to write a TERMINAL row — and a re-file (open_dispute_as, which
  -- holds this row FOR UPDATE) committing inside that window made the snapshot
  -- a lie in 3 of 20 prod rounds. FOR SHARE makes this read wait for such a
  -- writer and then see what it wrote, so the "job is not settled" RAISE below
  -- fires instead of the close. FOR SHARE, not FOR UPDATE: this function never
  -- writes `jobs`, and a shared lock still blocks the exclusive one.
  SELECT status::text, payment_status, dispute_status, dispute_resolved_at
    INTO _job_status, _payment_status, _dispute_status, _resolved_at
    FROM public.jobs
   WHERE id = _job_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settle_dispute_record: job % not found', _job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── The gate is `payment_status`, and ONLY `payment_status` ──────────────
  -- This is the load-bearing line, and it is deliberately not `jobs.status` or
  -- `jobs.dispute_status`. BOTH of those are writable by a party to the job, so
  -- a party LOSING a live dispute could otherwise send one PATCH and have this
  -- function close their own open dispute as decided + executed. `payment_status`
  -- is the one column here no party can write. See 20260908024646 for the full
  -- argument.
  _settled_to := CASE
    WHEN _payment_status IN ('released', 'payout_pending') THEN 'helper'
    WHEN _payment_status IN ('refunded', 'partially_refunded', 'chargeback') THEN 'poster'
    ELSE NULL
  END;

  IF _settled_to IS NULL THEN
    RAISE EXCEPTION
      'settle_dispute_record: job % has not settled its money (payment_status=%) — nothing to close',
      _job_id, COALESCE(_payment_status, 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;

  -- The caller states which way it went; the LEDGER decides.
  IF _outcome <> _settled_to THEN
    RAISE EXCEPTION
      'settle_dispute_record: caller says % but jobs.payment_status=% means % (job %)',
      _outcome, _payment_status, _settled_to, _job_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Fail LOUD if a caller tries to close the record on a job whose dispute is
  -- still live. `dispute_resolved_at IS NOT NULL` is NOT sufficient on its own:
  -- open_dispute_as's re-freeze branch does not clear it, so a genuinely live,
  -- re-filed dispute carries a stale resolution timestamp. The live states are
  -- therefore excluded explicitly rather than inferred — and, since 2026-09-13,
  -- read under FOR SHARE so a re-file cannot land after this check.
  IF _job_status = 'disputed'
     OR COALESCE(_dispute_status, '') IN ('open', 'escalated', 'stripe_chargeback', 'reversal_hold')
     OR NOT (
       _dispute_status IN ('resolved', 'auto_resolved')
       OR _resolved_at IS NOT NULL
     )
  THEN
    RAISE EXCEPTION
      'settle_dispute_record: job % is not settled (status=%, dispute_status=%, dispute_resolved_at=%) — write the job''s terminal dispute state before closing its record',
      _job_id, _job_status, COALESCE(_dispute_status, 'NULL'), COALESCE(_resolved_at::text, 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;

  IF _outcome = 'helper' THEN
    _poster_share := 0; _helper_share := 1;
  ELSE
    _poster_share := 1; _helper_share := 0;
  END IF;

  -- `WHERE status = 'open'` is the whole idempotency story: a second call, a
  -- retried cron tick, or the orphan sweep arriving after the direct call all
  -- match zero rows and return NULL.
  UPDATE public.disputes
     SET status         = 'decided',
         decided_at     = COALESCE(decided_at, now()),
         decided_by     = _decided_by,
         decision_text  = COALESCE(
                            _decision_text,
                            CASE WHEN _outcome = 'helper'
                                 THEN 'Escrow was released to the helpr outside the split executor; record closed to match.'
                                 ELSE 'Escrow was refunded to the poster outside the split executor; record closed to match.'
                            END),
         payout_split   = jsonb_build_object('poster', _poster_share, 'helper', _helper_share),
         execution_status       = 'executed',
         executed_at            = COALESCE(executed_at, now()),
         execution_started_at   = COALESCE(execution_started_at, now()),
         execution_helper_cents = COALESCE(_helper_cents, execution_helper_cents),
         execution_refund_cents = COALESCE(_refund_cents, execution_refund_cents),
         execution_transfer_id  = COALESCE(_transfer_id, execution_transfer_id),
         execution_refund_id    = COALESCE(_refund_id, execution_refund_id),
         execution_error        = NULL
   WHERE job_id = _job_id
     AND status = 'open'
  RETURNING id INTO _dispute_id;

  RETURN _dispute_id;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_dispute_record(uuid, text, uuid, text, integer, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_dispute_record(uuid, text, uuid, text, integer, integer, text, text) TO service_role;

-- ── 2. open_dispute_as: evidence appends are set-like ────────────────────
-- Body is 20260902035447's verbatim; the two evidence appends in the
-- existing-dispute branch and the one in the new-dispute branch now go through
-- array_append_missing. Nothing else changed.
CREATE OR REPLACE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := _opener_id;
  _system boolean := _opener_id IS NULL;
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
  _reason_trimmed text;
  _velocity_count integer;
BEGIN
  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — an admin decides this from your words.';
  END IF;

  -- FOR UPDATE. Without the lock two parties filing at the same instant each
  -- read "no open dispute" and both insert.
  SELECT customer_id, helper_id, title, status::text
    INTO _customer, _helper, _title, _status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    -- SET-LIKE, since 2026-09-13. DisputeDialog's only double-submit guard was
    -- React state, so a same-frame double click sent two identical filings and
    -- this branch stored every evidence url TWICE — on the record and, below,
    -- on the job — in 20 of 20 prod rounds. An admin deciding the dispute then
    -- cannot tell a duplicate from two photos of the same damage.
    UPDATE public.disputes
    SET evidence_urls = public.array_append_missing(evidence_urls, _evidence_urls)
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls = public.array_append_missing(dispute_evidence_urls, _evidence_urls)
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind, and this branch used to RETURN
    -- without touching the job — so a re-file inside the payout hold appended
    -- evidence, reported success, and left the escrow free to pay out.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    -- NO velocity check on this branch, deliberately: this is a re-file on a
    -- dispute that already exists. It is ALSO the sweep's idempotency guard.
    RETURN _existing_id;
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger sees a non-null disputed_at.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         dispute_status = 'open',
         dispute_evidence_urls = public.array_append_missing(dispute_evidence_urls, _evidence_urls)
   WHERE id = _job_id;

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Skipped entirely for a system filing. Runs AFTER the UPDATE above so the
  -- filing being made right now is inside the window the check counts.
  IF NOT _system THEN
    BEGIN
      IF NOT public.check_dispute_velocity(_uid) THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.fraud_flags
          WHERE user_id = _uid AND flag_type = 'high_dispute_rate' AND resolved = false
        ) THEN
          SELECT count(*) INTO _velocity_count
            FROM public.jobs
           WHERE disputed_by = _uid
             AND disputed_at > now() - interval '30 days';

          INSERT INTO public.fraud_flags (user_id, job_id, flag_type, details)
          VALUES (
            _uid,
            _job_id,
            'high_dispute_rate',
            'Opened ' || _velocity_count || ' disputes in the last 30 days, at or over the '
              || 'review threshold. Most recent: "' || COALESCE(_title, 'a job') || '".'
          );
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'open_dispute_as: dispute-velocity flag failed for % on job %: %',
        _uid, _job_id, SQLERRM;
    END;
  END IF;

  -- ── Tell the people this affects ────────────────────────────────────────
  IF _system THEN
    IF _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'Revision deadline passed — dispute opened',
        'The revision you requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so we opened a dispute for you. ' ||
          'The payment stays on hold and an admin will decide it — add your side.',
        'warning',
        '/my-posts?job=' || _job_id::text
      );
    END IF;
    IF _helper IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _helper,
        'Revision deadline passed — dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'An admin will decide the payment — add your side.',
        'warning',
        '/my-jobs?job=' || _job_id::text
      );
    END IF;
  ELSIF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/my-posts?job=' || _job_id::text
           ELSE '/my-jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _admin,
      'Job disputed',
      '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
      'warning',
      '/admin?view=disputes'
    );
  END LOOP;

  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;
