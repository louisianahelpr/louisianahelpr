-- Q1262 (1) and (3) (docs/OPEN.md; lh-authz-rls review of Q1165/Q925, 2026-10-04).
--
-- (1) A re-filed dispute cleared the Helpr's earlier answer for good
--     (20261004004705 clears jobs.dispute_helper_response on the new-dispute
--     path, and disputes had no column for it), so a poster could withdraw and
--     re-file to wipe the Helpr's statement from the admin's view. Now
--     disputes.helper_response keeps it: open_dispute_as copies the job's
--     answer onto the PREVIOUS (closed) dispute's row before clearing the
--     job's copy. A party cannot write the column: it joins the pinned list of
--     enforce_dispute_opener_column_whitelist.
-- (3) The new-dispute path cleared the answer but still appended the
--     withdrawn dispute's evidence onto jobs.dispute_evidence_urls and left
--     the withdrawal's dispute_resolved_at stamped (can_review_job reads it).
--     Both now start fresh with the new dispute (the old photos stay on the
--     old dispute's own row).
--
-- Restated from the newest definitions: open_dispute_as from 20261004004705
-- (md5(prosrc) live 2026-10-05 706630f6610ed371696495945b5d46e1 = that file)
-- and enforce_dispute_opener_column_whitelist from 20260915101102 (md5 live
-- d37547ecb7c482a5f6dacac315d6b18d = that file), each plus the lines above.
-- Replay-safe: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE; grants restated.
-- The admin dispute card does not show the archived answer yet (Q1325).
-- Guard: src/test/disputeRefileKeepsHelprAnswer.test.ts +
-- src/test/pglite/disputeRefileKeepsHelprAnswer.pglite.mjs.

ALTER TABLE public.disputes ADD COLUMN IF NOT EXISTS helper_response text;
COMMENT ON COLUMN public.disputes.helper_response IS
  'Q1262: the Helpr''s answer to THIS dispute, archived by open_dispute_as when a later dispute on the job starts (jobs.dispute_helper_response holds the current one).';

CREATE OR REPLACE FUNCTION public.enforce_dispute_opener_column_whitelist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  -- Is THIS update the opener closing their own open dispute? The one
  -- user-driven settlement move the flow sanctions, and the only context in
  -- which a party may stamp `decided_at`.
  _self_withdrawal boolean;
BEGIN
  -- Service role / cron / edge functions: not a user write. A NULL uid alone
  -- is NOT that — an anon request has one too (20260915051905).
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;

  -- Admins resolve disputes; that is the whole point of the admin policy.
  IF public.has_role(_uid, 'admin') THEN
    RETURN NEW;
  END IF;

  -- COALESCE: with a NULL _uid (anon) the comparison is NULL, and a NULL here
  -- would make `AND NOT _self_withdrawal` NULL and let decided_at through.
  _self_withdrawal := COALESCE(
        OLD.status = 'open'
    AND NEW.status = 'withdrawn'
    AND _uid = OLD.opener_id
    AND OLD.decided_at IS NULL, false);

  -- A party may append evidence and nothing else. Every other column is
  -- pinned to its old value, so a forged `execution_status`, `payout_split`,
  -- `decided_by` or ledger figure is rejected rather than silently kept.
  --
  -- `decided_at` is the ONE exception, and only inside `_self_withdrawal`:
  -- `rpc_withdraw_dispute` stamps it in the same statement that flips the
  -- status, so pinning it unconditionally killed the withdrawal outright (see
  -- the header). Outside that transition it is pinned exactly as before —
  -- including a second stamp on an already-decided row, which is why
  -- `_self_withdrawal` requires the old value to be NULL.
  IF NEW.id             IS DISTINCT FROM OLD.id
  OR NEW.job_id         IS DISTINCT FROM OLD.job_id
  OR NEW.opener_id      IS DISTINCT FROM OLD.opener_id
  OR NEW.reason         IS DISTINCT FROM OLD.reason
  OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  OR (NEW.decided_at    IS DISTINCT FROM OLD.decided_at AND NOT _self_withdrawal)
  OR NEW.decided_by     IS DISTINCT FROM OLD.decided_by
  OR NEW.decision_text  IS DISTINCT FROM OLD.decision_text
  OR NEW.payout_split   IS DISTINCT FROM OLD.payout_split
  -- Q1262(1): the archived Helpr answer is open_dispute_as's to write.
  OR NEW.helper_response IS DISTINCT FROM OLD.helper_response
  THEN
    RAISE EXCEPTION 'only the evidence on a dispute may be changed'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `status` is handled separately because ONE user-driven move is
  -- legitimate: withdrawing your own open dispute, which is the opener's only
  -- sanctioned exit (`rpc_withdraw_dispute`, 20260825190000). That RPC is
  -- SECURITY DEFINER but `auth.uid()` inside it is still the CALLER, so a
  -- blanket pin on `status` would have made this trigger block the one
  -- self-service escape hatch the flow has — caught by the PGlite suite
  -- before this shipped. Every other status move (notably `decided`, which
  -- is what unlocks execute-dispute-split) stays admin-only.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'open' AND NEW.status = 'withdrawn')
  THEN
    RAISE EXCEPTION 'a dispute''s status is decided by an admin, not by a party to it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The execution/settlement columns are guarded separately only so the
  -- error names them — forging these is the denial-of-service case, not a
  -- typo. Guarded by column existence so this migration stays replayable
  -- against a database that predates 20260824230000.
  IF to_regclass('public.disputes') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'disputes'
          AND column_name = 'execution_status'
     )
  THEN
    IF NEW.execution_status       IS DISTINCT FROM OLD.execution_status
    OR NEW.execution_started_at   IS DISTINCT FROM OLD.execution_started_at
    OR NEW.executed_at            IS DISTINCT FROM OLD.executed_at
    OR NEW.execution_transfer_id  IS DISTINCT FROM OLD.execution_transfer_id
    OR NEW.execution_refund_id    IS DISTINCT FROM OLD.execution_refund_id
    OR NEW.execution_helper_cents IS DISTINCT FROM OLD.execution_helper_cents
    OR NEW.execution_refund_cents IS DISTINCT FROM OLD.execution_refund_cents
    OR NEW.execution_error        IS DISTINCT FROM OLD.execution_error
    THEN
      RAISE EXCEPTION 'the settlement state of a dispute is not yours to set'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_dispute_as(_job_id uuid, _opener_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _payment_status text;
  _is_group boolean;
  _crew boolean := false;
  _on_crew boolean := false;
  _member uuid;
BEGIN
  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. Applies to the platform too: a
  -- system filing has to say what happened in the same words a person would.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — an admin decides this from your words.';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added in 20260901032007 is the backstop; this is what makes the loser WAIT
  -- and then take the existing-dispute branch instead of erroring.
  SELECT customer_id, helper_id, title, status::text, payment_status, is_group_job
    INTO _customer, _helper, _title, _status, _payment_status, _is_group
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- A crew has no lead (Q407): jobs.helper_id is NULL on every group job, so
  -- the Helpr side of a crew is its roster. Read under the jobs lock above.
  _crew := _is_group IS TRUE;
  _on_crew := _crew AND _uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _uid);

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  -- NULL-safe (Q728): this read `_uid <> _customer AND _uid <> _helper`, and
  -- on a crew `_uid <> NULL` is NULL, so the IF never fired and ANY signed-in
  -- account could open a dispute on any booked crew job, freezing its escrow.
  IF NOT _system
     AND _uid IS DISTINCT FROM _customer
     AND (_helper IS NULL OR _uid IS DISTINCT FROM _helper)
     AND NOT _on_crew THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  -- DONE IS FINAL (owner, 2026-09-14). A completed job cannot be disputed by
  -- either party, and an open dispute row on one cannot be appended to or used
  -- to re-freeze it. Human callers only: the one system caller
  -- (auto-release-payment's undelivered-revision sweep) files on
  -- revision_requested jobs, never completed ones, and its path is unchanged.
  -- Ahead of the existing-dispute branch on purpose, so its re-freeze from
  -- 'completed' is unreachable for a person.
  -- (Live guard from 20260915025607, kept verbatim when this migration was
  -- re-derived from the live definition on 2026-09-15.)
  IF NOT _system AND _status = 'completed' THEN
    RAISE EXCEPTION 'job_already_completed'
      USING HINT = 'Once a job is marked done it is final.';
  END IF;

  -- ── Evidence is the filer's own uploads, nothing else (authz review of the
  -- dispute-races rebase, MEDIUM). Both the new-dispute path and the re-file
  -- branch below store `_evidence_urls` verbatim, and they render as <a>/<img>
  -- in the admin console and the other party's dialog. A person may attach only
  -- signed proof-photos URLs for their own uploads on this job
  -- (dispute_evidence_url_ok, section 8); the platform files with none.
  IF _system THEN
    IF COALESCE(cardinality(_evidence_urls), 0) > 0 THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url'
        USING HINT = 'A platform filing carries no evidence.';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(COALESCE(_evidence_urls, '{}'::text[])) AS e(u)
     WHERE NOT public.dispute_evidence_url_ok(e.u, _uid, _job_id)
  ) THEN
    RAISE EXCEPTION 'dispute_evidence_invalid_url'
      USING HINT = 'Only photos you uploaded to this dispute can be attached.';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- ── Not over a decided dispute whose money has not moved ────────────────
  -- rpc_decide_dispute leaves the job completed/cancelled with the escrow held
  -- until execute-dispute-split settles it. A party re-filing then flipped the
  -- job back to `disputed` (and a withdrawal to in_progress), which handed the
  -- escrow to Quick Release / Quick Refund / the sweep and, via
  -- poster_cancel_job, to void-cancelled-payments — each settling over the
  -- admin's decision, and "Retry settlement" moving the split on top (both
  -- reviews, round 2, HIGH; live shape on prod: job bb2c3732 / dispute
  -- c7a12050). The decision stands until it executes.
  IF EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id
       AND d.status = 'decided'
       AND d.execution_status IS DISTINCT FROM 'executed'
  ) THEN
    RAISE EXCEPTION 'dispute_already_decided'
      USING HINT = 'An admin has already decided this dispute and its payment is being settled.';
  END IF;

  -- ── Not while the escrow is being cancelled ─────────────────────────────
  -- `cancelling` is cancel_escrow's claim: its Stripe refund is in flight.
  -- A dispute stamped onto that job made it `disputed` with the refund still
  -- going out, and an admin Quick Release then paid the Helpr beside it.
  -- claim_dispute_settlement now refuses that shape too; this stops it being
  -- created. Read under the FOR UPDATE above, so cancel_escrow's claim either
  -- committed first (visible here) or waits behind this filing (and its own
  -- status-pinned claim then matches zero rows).
  IF _payment_status = 'cancelling' THEN
    RAISE EXCEPTION 'dispute_payment_being_cancelled'
      USING HINT = 'This job''s payment is being cancelled and refunded, so it can no longer be disputed.';
  END IF;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    -- Set-like append, 20260915034822. A DOUBLE SUBMIT from the dispute
    -- dialog — two clicks inside one JS task, both past the React-state
    -- `submitting` flag because state does not land until the next render —
    -- sends two calls. The second blocks on the FOR UPDATE above, then lands
    -- HERE, and with a bare `||` it appended the SAME evidence urls a second
    -- time: the admin queue showed each photo twice and `evidence_urls` grew
    -- without bound on every retry. The client now holds a synchronous ref
    -- guard as well (DisputeDialog.tsx), but a guard in the browser is not a
    -- guarantee; this is.
    UPDATE public.disputes
    SET evidence_urls = (
          SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
            FROM (
              SELECT u, min(ord) AS ord
                FROM unnest(
                       evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
                     ) WITH ORDINALITY AS t(u, ord)
               GROUP BY u
            ) d
        )
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls = (
             SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
               FROM (
                 SELECT u, min(ord) AS ord
                   FROM unnest(
                          COALESCE(dispute_evidence_urls, '{}'::text[])
                            || COALESCE(_evidence_urls, '{}'::text[])
                        ) WITH ORDINALITY AS t(u, ord)
                  GROUP BY u
               ) d
           )
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind (it writes `jobs`, never this
    -- table), and this branch used to RETURN without touching the job — so a
    -- re-file inside the payout hold appended evidence, reported success, and
    -- left the escrow free to pay out. Only re-freeze from a state the
    -- transition matrix allows, so this can never raise on a job that has
    -- legitimately moved on.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    -- Page ops on a re-freeze but not on a bare evidence append. A re-freeze
    -- means money was one payout-hold away from leaving on a job somebody is
    -- still contesting; an extra photo on an already-frozen dispute is not
    -- news at 3am.
    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    -- NO velocity check on this branch, deliberately. This is a re-file on a
    -- dispute that already exists, and both mirror columns are COALESCEd above
    -- precisely so it does not restamp. The job was already counted the first
    -- time; counting it again here would flag people for uploading a second
    -- photo.
    --
    -- This is ALSO the sweep's idempotency guard: a second pass over a job
    -- whose dispute the platform already opened lands here, appends nothing
    -- and returns the SAME id. No duplicate row, no second notification.
    RETURN _existing_id;
  END IF;

  -- ── The job must still be disputable, 20260915034822 ────────────────────
  -- The re-freeze branch above has always checked `_status` against the
  -- transition matrix's own `-> disputed` edges. The NEW-dispute path below
  -- never did: it inserted the row and stamped status='disputed'
  -- unconditionally. `_status` was read under the FOR UPDATE above, so a
  -- concurrent `poster_cancel_job` / completion / payout either commits BEFORE
  -- this call takes the lock (and is therefore visible in `_status`) or waits
  -- behind it — which is exactly why checking it here closes the window
  -- instead of merely narrowing it.
  --
  -- Without it, filing a dispute that raced a cancellation either stamped
  -- `disputed` onto a cancelled job (freezing an escrow that had already been
  -- refunded) or raised `enforce_job_status_transition`'s raw Postgres prose at
  -- the filer. A terse code instead, so `lifecycleErrorMessage` can say what
  -- happened; the allowed set is the same list the re-freeze branch uses.
  IF _status NOT IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- Q1262(1): the Helpr's answer to the PREVIOUS dispute on this job is kept
  -- on that dispute's own row before the UPDATE below clears the job's copy
  -- (Q1165). Without this a poster could withdraw and re-file to wipe the
  -- Helpr's statement for good. Only into a closed row that has none yet.
  UPDATE public.disputes d
     SET helper_response = j.dispute_helper_response
    FROM public.jobs j
   WHERE j.id = _job_id
     AND j.dispute_helper_response IS NOT NULL
     AND d.helper_response IS NULL
     AND d.id = (SELECT p.id FROM public.disputes p
                  WHERE p.job_id = _job_id AND p.status <> 'open'
                  ORDER BY p.created_at DESC LIMIT 1);

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
         -- Q1165: a NEW dispute starts with no Helpr answer. A withdrawn
         -- dispute's answer survived the re-file, rendered under the new
         -- complaint, and (write-once since 20261003180355) stopped the Helpr
         -- answering it. SECURITY DEFINER, so the table-door trigger does not
         -- apply to this write.
         dispute_helper_response = NULL,
         dispute_status = 'open',
         -- Q1262(3): a NEW dispute starts from its own evidence and is not
         -- resolved: the job's legacy mirror no longer carries the withdrawn
         -- dispute's photos under the new complaint (they stay on that
         -- dispute's own row), and the withdrawal's dispute_resolved_at stamp
         -- (can_review_job reads it) is cleared with the answer.
         dispute_resolved_at = NULL,
         dispute_evidence_urls = COALESCE(_evidence_urls, '{}'::text[])
   -- Belt and braces on the predicate above: the same allowed set, written
   -- into the statement itself so the freeze can never land on a job that
   -- moved on, even if a future edit drops the IF.
   WHERE id = _job_id
     AND status::text IN ('completed', 'in_progress', 'revision_requested', 'accepted');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute_job_not_disputable'
      USING HINT = 'This job has already been resolved or closed, so it can no longer be disputed.';
  END IF;

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Delivers "3+ disputes in 30 days flags your account for review."
  --
  -- Skipped entirely for a system filing: `disputed_by` is NULL, nobody chose
  -- to file, and flagging an account for the platform's own sweep would turn a
  -- stalled revision into a fraud signal against whichever party the count
  -- happened to land on.
  --
  -- Runs AFTER the UPDATE above on purpose: that statement is what stamps
  -- disputed_by/disputed_at, so the dispute being filed right now is inside
  -- the window the check counts. check_dispute_velocity returns TRUE while
  -- UNDER the limit, so `NOT ...` is "this filing put them at or past it".
  --
  -- Wrapped, and this is the one place in this function where swallowing is
  -- correct: the purpose of this RPC is to FREEZE THE MONEY on a contested
  -- job. Failing to file a risk signal must never be the reason a real
  -- dispute does not freeze.
  IF NOT _system THEN
    BEGIN
      IF NOT public.check_dispute_velocity(_uid) THEN
        -- One open flag per account at a time. Every further dispute past the
        -- threshold is more of the same signal, and an admin resolving the flag
        -- is what re-arms it.
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
  -- A human filing tells the counterparty (the filer knows already). A system
  -- filing tells BOTH, because neither of them did this and neither is
  -- expecting it.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own.
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
        '/posts?job=' || _job_id::text
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
        '/jobs?job=' || _job_id::text
      );
    END IF;
    -- A crew has no helper_id: every hired member is told instead.
    FOR _member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE _crew AND g.job_id = _job_id AND g.helper_id IS NOT NULL
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _member,
        'Revision deadline passed — dispute opened',
        'The revision requested on "' || COALESCE(_title, 'a job') ||
          '" was not delivered before the deadline, so a dispute was opened automatically. ' ||
          'An admin will decide the payment — add your side.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END LOOP;
  ELSIF _crew THEN
    -- A crew: every hired member's pay is now on hold, so every member other
    -- than the filer is told; so is the poster when a member filed.
    IF _uid IS DISTINCT FROM _customer AND _customer IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _customer,
        'A dispute was opened',
        'A dispute was opened on "' || COALESCE(_title, 'a job') ||
          '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
        'warning',
        '/posts?job=' || _job_id::text
      );
    END IF;
    FOR _member IN
      SELECT g.helper_id FROM public.group_job_helpers g
       WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL AND g.helper_id IS DISTINCT FROM _uid
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        _member,
        'A dispute was opened',
        'A dispute was opened on "' || COALESCE(_title, 'a job') ||
          '". The crew''s payment is on hold while it is reviewed — add your side so an admin hears it.',
        'warning',
        '/jobs?job=' || _job_id::text
      );
    END LOOP;
  ELSIF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/posts?job=' || _job_id::text
           ELSE '/jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (
      _admin,
      'Job disputed',
      '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
      'warning',
      '/admin?view=disputes',
      _job_id
    );
  END LOOP;

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_dispute_opener_column_whitelist() FROM PUBLIC, anon, authenticated;
