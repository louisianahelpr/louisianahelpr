-- Part 3 message review, F177 moved from Builder 4 (lead 11-09; wording only, no logic changes).
--
-- F176 ("Job cancelled" adds "Nothing is owed and it doesn't count against you.") is NOT here: notify_on_job_update's
-- cancel branch is also reached by an admin's dispute refund that bills a Helpr ruled at fault (create-payment
-- admin_refund_dispute), so the sentence would be false there (review 11-09). It needs its own path, not words.
-- F177: "admin" is staff jargon in member notices (and the dispute emails that copy them): "add your side so an admin
-- hears both", "An admin will decide...", "Dispute escalated to an admin", "An admin is taking another look...",
-- "An admin reviewed a warning..." all say "our team" now (F193's one phrase). The escalation title is "Our team will
-- decide this dispute", the same title the 72-hour sweep sends (auto-resolve-disputes). Staff-only alerts keep theirs.
--
-- Each body is the LIVE definition: md5(prosrc) on prod 11-09 equals the newest repo definition byte for byte
-- (open_dispute_as 24cbbec6..., rpc_escalate_dispute 817274d0...,
-- rpc_supersede_dispute_decision d20d8817..., admin_reverse_violation fde5a212...), with ONLY string literals changed.
-- Headers are the previous definitions'. Grants restated as live proacl. Replay-safe: CREATE OR REPLACE.
-- Proof: src/test/pglite/noticesOurTeamNoStrike.pglite.mjs (3x replay; wording-only shape check; --before red).

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
      USING HINT = 'Describe what happened — our team decides this from your words.';
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
      USING HINT = 'Our team has already decided this dispute and its payment is being settled.';
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
  -- This runs as a definer INSIDE the party's session, so the opener
  -- whitelist trigger sees a party's write: a transaction-local flag, set only
  -- here and cleared right after (as rpc_withdraw_dispute's
  -- app.dispute_withdraw_rpc), lets exactly this NULL -> answer write through
  -- (lh-authz-rls review, 2026-10-05: without it the re-file raised 42501).
  PERFORM set_config('app.dispute_archive_rpc', '1', true);
  UPDATE public.disputes d
     SET helper_response = j.dispute_helper_response
    FROM public.jobs j
   WHERE j.id = _job_id
     AND j.dispute_helper_response IS NOT NULL
     AND d.helper_response IS NULL
     AND d.id = (SELECT p.id FROM public.disputes p
                  WHERE p.job_id = _job_id AND p.status <> 'open'
                  ORDER BY p.created_at DESC LIMIT 1);
  PERFORM set_config('app.dispute_archive_rpc', '0', true);

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
          'The payment stays on hold and our team will decide it — add your side.',
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
          'Our team will decide the payment — add your side.',
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
          'Our team will decide the payment — add your side.',
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
          '". The payment is on hold while it is reviewed — add your side so our team hears from you both.',
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
          '". The crew''s payment is on hold while it is reviewed — add your side so our team hears it.',
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
        '". The payment is on hold while it is reviewed — add your side so our team hears from you both.',
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
  -- Not for test accounts (owner 2026-10-30): a dispute a test account opened,
  -- or on a job a test account posted or works, never reaches an admin's bell.
  IF NOT (public.is_test_subject(_uid) OR public.is_test_subject(_customer) OR public.is_test_subject(_helper)) THEN
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
  END IF;

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$
;

REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_escalate_dispute(_job_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _dispute_status text;
  _other uuid;
  _admin uuid;
  _is_group boolean;
  _on_crew boolean := false;
  _member uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- FOR UPDATE for the same reason rpc_open_dispute takes it: two parties can
  -- escalate the same dispute at the same instant, and the second one must
  -- read the first one's write rather than both fanning out to every admin.
  SELECT customer_id, helper_id, title, status::text, dispute_status, is_group_job
    INTO _customer, _helper, _title, _status, _dispute_status, _is_group
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- NULL-safe and roster-aware (Q728): on a crew jobs.helper_id is NULL, so
  -- `_uid <> _helper` was NULL and ANY signed-in account could escalate a
  -- crew's dispute (which stops the 72h sweep and holds the crew's pay).
  _on_crew := _is_group IS TRUE AND EXISTS (
    SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _uid);
  IF _uid IS DISTINCT FROM _customer
     AND (_helper IS NULL OR _uid IS DISTINCT FROM _helper)
     AND NOT _on_crew THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  IF _status <> 'disputed' THEN
    RAISE EXCEPTION 'job is not disputed';
  END IF;

  -- Already escalated is a NO-OP, not an error. Both parties can now escalate
  -- and the control stays on screen; making the second tap fail would show an
  -- error for an action whose desired end state already holds. Returning early
  -- also means the admin fan-out happens exactly once per escalation.
  IF _dispute_status = 'escalated' THEN
    RETURN _job_id;
  END IF;

  -- The two pre-decision values of the mirror column. Anything else
  -- ('auto_resolved', 'resolved') means the dispute is over and there is
  -- nothing left to hand an admin.
  IF _dispute_status IS NOT NULL AND _dispute_status NOT IN ('open', 'helper_responded') THEN
    RAISE EXCEPTION 'dispute is no longer open';
  END IF;

  UPDATE public.jobs
     SET dispute_status = 'escalated'
   WHERE id = _job_id;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- A crew: every other hired member is told as well (the poster through
  -- _other when a member escalated).
  FOR _member IN
    SELECT g.helper_id FROM public.group_job_helpers g
     WHERE _is_group IS TRUE AND g.job_id = _job_id
       AND g.helper_id IS NOT NULL AND g.helper_id IS DISTINCT FROM _uid
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _member,
      'Our team will decide this dispute',
      'The dispute on "' || COALESCE(_title, 'a job') ||
        '" was escalated. Our team will decide it — the payment stays on hold until then.',
      'warning',
      '/jobs?job=' || _job_id::text
    );
  END LOOP;

  -- The counterparty: the decision just moved to a human and the deadline they
  -- were watching will no longer fire.
  IF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'Our team will decide this dispute',
      'The dispute on "' || COALESCE(_title, 'a job') ||
        '" was escalated. Our team will decide it — the payment stays on hold until then.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/posts?job=' || _job_id::text
           ELSE '/jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- The admins, who are the ones who actually decide it. This is the half that
  -- could not be done from the client at all. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _admin,
      'Dispute escalated',
      '"' || COALESCE(_title, 'a job') || '" dispute has been escalated and needs an admin decision. Payment is on hold.',
      -- `admin_alert`, not `warning`: this is addressed to admins only, and
      -- typing it as a severity puts it in the same preference bucket as
      -- party-facing warnings (N-011).
      'admin_alert',
      '/admin?view=disputes&job=' || _job_id::text
    );
  END LOOP;

  RETURN _job_id;
END;
$function$
;

REVOKE ALL ON FUNCTION public.rpc_escalate_dispute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_escalate_dispute(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_supersede_dispute_decision(_dispute_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d record;
  _job_status text;
  _payment_status text;
  _customer uuid;
  _helper uuid;
  _title text;
  _moved boolean;
  _new_id uuid;
  _job_id_lookup uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'supersede_needs_reason'
      USING HINT = 'Say why this decision can never execute — it goes in the audit log.';
  END IF;

  -- Lock order jobs -> disputes (lh-authz-rls review of the rebase): job id
  -- looked up unlocked (it never changes), job locked, then the dispute row.
  SELECT job_id INTO _job_id_lookup FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT status::text, payment_status, customer_id, helper_id, title
    INTO _job_status, _payment_status, _customer, _helper, _title
    FROM public.jobs
   WHERE id = _job_id_lookup
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT id, job_id, opener_id, reason, evidence_urls, status, decided_at, decided_by,
         decision_text, payout_split, execution_status, execution_started_at,
         execution_error, execution_transfer_id, execution_refund_id
    INTO _d
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;
  -- NOT FOUND on the LOCKED re-read is load-bearing (lh-money-escrow review,
  -- MEDIUM-2): a dispute deleted between the unlocked lookup above and this
  -- lock leaves _d all-NULL, and `NULL <> 'decided' OR NULL = 'executed'` is
  -- NULL — the gate below would fall through and the job UPDATE would strand the
  -- escrow. IS DISTINCT FROM so a NULL still refuses.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;
  IF _d.status IS DISTINCT FROM 'decided' OR _d.execution_status = 'executed' THEN
    RAISE EXCEPTION 'supersede_not_supersedable'
      USING HINT = 'Only a decided dispute whose split has not executed can be superseded.';
  END IF;

  IF _uid = _customer OR _uid = _helper THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to supersede its decision.';
  END IF;

  -- A split run inside the TTL may be between its execution claim (step 6) and
  -- its settlement claim (6b), where no claim row exists yet; one that started
  -- longer ago than any edge invocation can live is dead, and the ledger and
  -- leg checks below decide whether it moved anything.
  IF _d.execution_status = 'executing'
     AND COALESCE(_d.execution_started_at, now()) >= now() - public.dispute_settlement_claim_ttl() THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'This decision''s split is executing right now; wait for it to finish or fail.';
  END IF;

  -- A live claim means a settlement is running; a STAMPED one (live or dead)
  -- means its holder reached a Stripe money call. An expired unstamped claim
  -- moved nothing and does not block. Read under the jobs lock
  -- claim_dispute_settlement also takes.
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _d.job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'A settlement of this job is running or stopped part-way; reconcile it before superseding.';
  END IF;

  IF COALESCE(_payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
    RAISE EXCEPTION 'supersede_escrow_not_held'
      USING HINT = 'This job''s escrow is no longer held, so there is no decision left to supersede.';
  END IF;

  _moved := _d.execution_transfer_id IS NOT NULL
         OR _d.execution_refund_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.payout_transfers t
                     WHERE t.job_id = _d.job_id AND t.status IN ('pending', 'paid', 'reversed'))
         OR EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _d.job_id);
  IF NOT _moved AND to_regclass('public.gift_cards') IS NOT NULL THEN
    _moved := EXISTS (SELECT 1 FROM public.gift_cards g WHERE g.restored_from_job_id = _d.job_id);
  END IF;
  IF _moved THEN
    RAISE EXCEPTION 'supersede_money_moved'
      USING HINT = 'Money has already moved for this job, so the decision cannot be superseded — reconcile against Stripe by hand.';
  END IF;

  -- disputes_one_open_per_job_idx: the new row needs the job to have no other
  -- open dispute. Checked, not left to the unique violation.
  IF EXISTS (SELECT 1 FROM public.disputes o WHERE o.job_id = _d.job_id AND o.status = 'open') THEN
    RAISE EXCEPTION 'dispute_already_open';
  END IF;

  -- The trail FIRST, and not wrapped: voiding an admin's money decision with
  -- no record would be worse than refusing.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    _uid,
    'supersede_dispute_decision',
    'dispute',
    _d.id,
    jsonb_build_object(
      'job_id', _d.job_id,
      'reason', btrim(_reason),
      'decided_at', _d.decided_at,
      'decided_by', _d.decided_by,
      'decision_text', _d.decision_text,
      'payout_split', _d.payout_split,
      'execution_status', _d.execution_status,
      'execution_error', _d.execution_error,
      'job_status', _job_status,
      'payment_status', _payment_status
    )
  );

  -- Retired, not rewritten: its decision and execution record stay as they were.
  UPDATE public.disputes
     SET status = 'superseded'
   WHERE id = _d.id;

  -- The new dispute. opener_id NULL: the platform re-opened it, so no party can
  -- withdraw it (rpc_withdraw_dispute is opener-only); the evidence carries over.
  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (
    _d.job_id,
    NULL,
    'Re-opened by an admin after the earlier decision could not be carried out: ' || btrim(_reason)
      || E'\n\nOriginal dispute: ' || COALESCE(_d.reason, ''),
    COALESCE(_d.evidence_urls, '{}'::text[])
  )
  RETURNING id INTO _new_id;

  -- Back under dispute, escalated. dispute_resolved_at cleared so nothing
  -- reads the superseded decision as a resolution; disputed_at kept (or set,
  -- for a job that never carried one) so set_dispute_deadline derives a
  -- deadline and the overdue-escalation reminder reaches an admin.
  UPDATE public.jobs
     SET status = 'disputed',
         dispute_status = 'escalated',
         dispute_resolved_at = NULL,
         disputed_at = COALESCE(disputed_at, now())
   WHERE id = _d.job_id;

  IF _customer IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (_customer, 'Dispute re-opened',
      'Our team is taking another look at the dispute on "' || COALESCE(_title, 'a job') ||
        '". The payment stays on hold until a new decision is made.',
      'info', '/posts?job=' || _d.job_id::text);
  END IF;
  IF _helper IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (_helper, 'Dispute re-opened',
      'Our team is taking another look at the dispute on "' || COALESCE(_title, 'a job') ||
        '". The payment stays on hold until a new decision is made.',
      'info', '/jobs?job=' || _d.job_id::text);
  END IF;

  RETURN _new_id;
END;
$function$
;

REVOKE ALL ON FUNCTION public.rpc_supersede_dispute_decision(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_supersede_dispute_decision(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_reverse_violation(
  p_violation_id uuid,
  p_reason text,
  p_restore_access boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin uuid := auth.uid();
  v_row public.user_violations%ROWTYPE;
  v_remaining int;
  v_status text;
  v_restored boolean := false;
BEGIN
  IF v_admin IS NULL OR NOT public.has_role(v_admin, 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- A reason is mandatory. Reversing a strike is itself a moderation decision
  -- and the next admin reading the log needs to know why, not just that.
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  -- Lock it. Two admins reversing the same row must not both snapshot-and-log.
  SELECT * INTO v_row FROM public.user_violations
   WHERE id = p_violation_id FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'violation_not_found';
  END IF;

  -- Snapshot BEFORE the delete — this row is the audit trail from here on.
  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (
    v_admin, 'reverse_violation', 'user', v_row.user_id,
    jsonb_build_object(
      'reason',         p_reason,
      'violation_id',   v_row.id,
      'violation_type', v_row.violation_type,
      'description',    v_row.description,
      'action_taken',   v_row.action_taken,
      'job_id',         v_row.job_id,
      'reported_by',    v_row.reported_by,
      'issued_at',      v_row.created_at
    ));

  DELETE FROM public.user_violations WHERE id = p_violation_id;

  -- Restoring account access is a SEPARATE, opt-in decision, and deliberately
  -- narrow. The ladder sets ban_status from several places and an admin ban is
  -- indistinguishable here from an automatic one, so this only ever DOWNGRADES,
  -- only when the user has no strikes left at all, and never out of a permanent
  -- ban — that stays with the ban-review flow, which owns the appeal record.
  -- Anything more nuanced is what the ban dialog is for.
  IF p_restore_access THEN
    SELECT count(*) INTO v_remaining
      FROM public.user_violations WHERE user_id = v_row.user_id;

    SELECT ban_status INTO v_status
      FROM public.profiles WHERE user_id = v_row.user_id;

    IF v_remaining = 0 AND v_status IN ('final_warning', 'temp_banned') THEN
      UPDATE public.profiles
         SET ban_status = 'active', auto_suspended_until = NULL
       WHERE user_id = v_row.user_id;
      v_restored := true;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (v_row.user_id, 'Your account is back in good standing',
              'Our team reviewed a warning on your account and removed it. Your account is fully active again.',
              'system_alert', '/profile?tab=warnings');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'reversed', true,
    'user_id', v_row.user_id,
    'violation_type', v_row.violation_type,
    'access_restored', v_restored,
    'remaining_violations', COALESCE(v_remaining, -1));
END;
$function$
;

REVOKE ALL ON FUNCTION public.admin_reverse_violation(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reverse_violation(uuid, text, boolean) TO authenticated, service_role;
