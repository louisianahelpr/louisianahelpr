-- Disputes on a crew (docs/OPEN.md Q409, with Q396(c); owner rules Q407).
--
-- A crew has no lead (20260925154606): jobs.helper_id is NULL on every group
-- job. Every dispute rule keyed on helper_id therefore changed meaning on a
-- crew, and two of them failed OPEN:
--
--   open_dispute_as       `IF NOT _system AND _uid <> _customer AND _uid <>
--                         _helper` is NULL when _helper is NULL, so the IF never
--                         fired: ANY signed-in account (through rpc_open_dispute)
--                         could open a dispute on any booked crew job and freeze
--                         its escrow. A crew member, meanwhile, was let in only
--                         by that same accident.
--   rpc_escalate_dispute  the same NULL comparison: anyone could escalate a
--                         crew's dispute, which stops the 72h sweep.
--   rpc_decide_dispute    recorded ONE fraction for "the Helpr", which
--                         execute-dispute-split moves to jobs.helper_id: on a
--                         crew it refuses (group jobs, 409) and the decision was
--                         left decided-unexecuted, the escrow frozen behind it.
--                         Its admin_is_party check compared against a NULL too.
--
-- What this installs:
--   1. open_dispute_as: the caller must be the poster, the single Helpr, or a
--      hired member of the crew (group_job_helpers), NULL-safe. On a crew the
--      poster and every OTHER member are told (the system filing tells every
--      member). Restated from its effective definition (20260924220318).
--   2. rpc_escalate_dispute: the same party check and crew notices.
--   3. rpc_decide_dispute refuses a crew before any write
--      (group_dispute_needs_crew_decision).
--   4. "disputes crew members select": a member reads the dispute holding
--      their pay.
--   5-7. rpc_decide_crew_dispute(dispute, text, refund_helper_ids): an admin
--      decides EACH member: their share FROZEN at hire (group_job_helpers.
--      share_cents) is either paid to them ('pay') or returned to the poster
--      ('refund'). One row per member in crew_dispute_member_outcomes. The job
--      goes completed / payout_pending after a 24h hold, the dispute to
--      decided with execution_status 'crew_fanout', and process-scheduled-
--      payouts' crew fan-out (already per member, from share_cents) pays the
--      'pay' members and refunds every other cent of the budget and urgent
--      fee (unfilled slots and 'refund' members alike) in ONE refund. Refunding
--      every member is a full refund, which the existing Full refund action
--      does; this RPC refuses it. A member with no frozen share refuses too.
--      PRODUCT QUESTION (owner, Q409): a member's share is all-or-nothing
--      here. Whether an admin may award a member PART of their share, and
--      whether the poster's service fee on a refunded share is returned (the
--      unfilled-slot refund today returns budget + urgent only, never fees),
--      is the owner's call; nothing here divides money between members.
--   8. mark_crew_dispute_executed (service_role): the ONLY writer that moves a
--      'crew_fanout' dispute to 'executed' (trg_crew_fanout_dispute_lock), so
--      settle-without-payment or a direct admin write cannot make the fan-out
--      pay every member in full over a refund decision. Supersede stays open
--      only while the payout is more than 15 minutes away.
--
-- Q396(c) (a withdrawn or auto-resolved dispute on a crew keeps disputed_at)
-- is fixed in process-scheduled-payouts, not here: disputed_at is the "this job
-- was disputed once" record DisputeLink and the admin queue read, and the
-- single-Helpr path keeps it too. The fan-out now admits a job whose dispute
-- CLOSED (dispute_status resolved / auto_resolved), exactly release-payout's
-- rule, behind the same decided-unexecuted and claim holds, FOR A CREW ONLY:
-- a single-Helpr job keeps `disputed_at IS NULL` there (its closed disputes are
-- release-payout's, and its stranded shape is watched by
-- sweep_disputes_closed_without_payment, restated in section 9 to leave a
-- closed CREW dispute out, since the fan-out now pays it).
--
-- REPLAY-SAFETY: CREATE OR REPLACE, DROP ... IF EXISTS, CREATE TABLE / INDEX
-- IF NOT EXISTS, a re-created named CHECK. Applied 3x in PGlite
-- (src/test/pglite/groupCrewDisputes.pglite.mjs --replay).

-- ── 1-3. The dispute RPCs, crew-aware ──────────────────────────────────────
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
  -- NULL-safe (Q409): this read `_uid <> _customer AND _uid <> _helper`, and
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

  -- NULL-safe and roster-aware (Q409): on a crew jobs.helper_id is NULL, so
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
      'Dispute escalated to an admin',
      'The dispute on "' || COALESCE(_title, 'a job') ||
        '" was escalated. An admin will decide it — the payment stays on hold until they do.',
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
      'Dispute escalated to an admin',
      'The dispute on "' || COALESCE(_title, 'a job') ||
        '" was escalated. An admin will decide it — the payment stays on hold until they do.',
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
$function$;

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
  _is_group boolean;
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
  SELECT customer_id, helper_id, title, is_group_job
    INTO _customer_id, _helper_id, _job_title, _is_group
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- A crew (Q409). This function records ONE fraction for "the Helpr" and
  -- execute-dispute-split moves it to jobs.helper_id, which is NULL on every
  -- crew: a crew decision recorded here could never execute, and it froze the
  -- escrow behind a decided-unexecuted dispute that every payout path then
  -- refuses. A crew is decided member by member (rpc_decide_crew_dispute), or
  -- refunded in full with the existing Full refund action. Refused BEFORE any
  -- write.
  IF _is_group IS TRUE THEN
    RAISE EXCEPTION 'group_dispute_needs_crew_decision'
      USING HINT = 'This is a crew job: decide each member (rpc_decide_crew_dispute) or use Full refund.';
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
      '/posts?job=' || _job_id::text,
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


REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_escalate_dispute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_escalate_dispute(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO authenticated, service_role;

-- ── 4. Every crew member reads the dispute on their job ─────────────────────
-- "disputes job parties select" keys on jobs.helper_id, which is NULL on a
-- crew, so a member who did not file could not see the dispute holding their
-- pay. Read-only; writes stay with the RPCs.
DROP POLICY IF EXISTS "disputes crew members select" ON public.disputes;
CREATE POLICY "disputes crew members select" ON public.disputes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_job_helpers g
       WHERE g.job_id = disputes.job_id
         AND g.helper_id = (SELECT auth.uid())
    )
  );

-- ── 5. A crew decision is executed by the payout fan-out ────────────────────
ALTER TABLE public.disputes
  DROP CONSTRAINT IF EXISTS disputes_execution_status_check;
ALTER TABLE public.disputes
  ADD CONSTRAINT disputes_execution_status_check
  CHECK (
    execution_status IS NULL
    OR execution_status IN ('pending', 'executing', 'executed', 'failed', 'crew_fanout')
  );

-- ── 6. One outcome per hired member, priced on their FROZEN share ───────────
CREATE TABLE IF NOT EXISTS public.crew_dispute_member_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.disputes(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  helper_id uuid,
  slot_no integer NOT NULL,
  share_cents integer NOT NULL CHECK (share_cents >= 0),
  member_outcome text NOT NULL CHECK (member_outcome IN ('pay', 'refund')),
  decided_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispute_id, helper_id),
  UNIQUE (dispute_id, slot_no)
);
CREATE INDEX IF NOT EXISTS crew_dispute_member_outcomes_job_idx
  ON public.crew_dispute_member_outcomes (job_id);

ALTER TABLE public.crew_dispute_member_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_dispute_member_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crew_dispute_member_outcomes TO authenticated;
GRANT ALL ON public.crew_dispute_member_outcomes TO service_role;

DROP POLICY IF EXISTS "crew dispute outcomes: poster, own member, admin" ON public.crew_dispute_member_outcomes;
CREATE POLICY "crew dispute outcomes: poster, own member, admin" ON public.crew_dispute_member_outcomes
  FOR SELECT TO authenticated
  USING (
    helper_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.jobs j
                WHERE j.id = crew_dispute_member_outcomes.job_id
                  AND j.customer_id = (SELECT auth.uid()))
    OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
  );

-- ── 7. rpc_decide_crew_dispute ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_decide_crew_dispute(
  _dispute_id uuid, _decision_text text, _refund_helper_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := (SELECT auth.uid());
  _job_id uuid;
  _job record;
  _existing_status text;
  _refund uuid[] := COALESCE(_refund_helper_ids, '{}'::uuid[]);
  _members integer;
  _pay_cents bigint;
  _refund_cents bigint;
  _budget_cents bigint;
  _m record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF _decision_text IS NULL OR length(btrim(_decision_text)) = 0 THEN
    RAISE EXCEPTION 'decision_text required';
  END IF;

  SELECT job_id INTO _job_id FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  -- Lock order jobs -> disputes, as every dispute RPC.
  SELECT id, customer_id, title, is_group_job, status::text AS status, payment_status, budget
    INTO _job
    FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  SELECT status INTO _existing_status FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;
  IF _existing_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'dispute already %', COALESCE(_existing_status, 'gone');
  END IF;

  IF _job.is_group_job IS NOT TRUE THEN
    RAISE EXCEPTION 'not_a_crew_job'
      USING HINT = 'Decide a single-Helpr dispute with rpc_decide_dispute.';
  END IF;

  -- An admin who is the poster or on the crew does not rule on it.
  IF _uid IS NOT DISTINCT FROM _job.customer_id OR EXISTS (
       SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = _uid) THEN
    RAISE EXCEPTION 'admin_is_party'
      USING HINT = 'You are a party to this job, so another admin has to decide its dispute.';
  END IF;

  -- Not while a settlement holds (or a dead holder stamped) the escrow.
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _job_id
       AND (c.claimed_at >= now() - public.dispute_settlement_claim_ttl()
            OR c.money_step_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'This dispute''s payment is being settled right now, so it can''t be decided. Refresh in a few minutes.';
  END IF;

  IF _job.status IS DISTINCT FROM 'disputed' THEN
    RAISE EXCEPTION 'dispute_job_not_disputed';
  END IF;
  -- The escrow must still be held: nothing has been paid or refunded.
  IF COALESCE(_job.payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
    RAISE EXCEPTION 'crew_dispute_escrow_not_held'
      USING HINT = 'This job''s escrow is no longer held, so there is nothing to decide.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payout_transfers t
              WHERE t.job_id = _job_id AND t.status IN ('pending', 'paid', 'reversed'))
     OR EXISTS (SELECT 1 FROM public.payment_refunds r WHERE r.job_id = _job_id) THEN
    RAISE EXCEPTION 'crew_dispute_money_moved'
      USING HINT = 'Money has already moved on this job; reconcile it by hand.';
  END IF;

  SELECT count(*) INTO _members
    FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL;
  IF _members = 0 THEN
    RAISE EXCEPTION 'crew_dispute_no_members'
      USING HINT = 'Nobody is on this crew: use Full refund.';
  END IF;
  -- Every outcome is priced on the member's share FROZEN at hire (Q407). A
  -- member hired before the shares existed has none, and nothing here may
  -- re-derive one.
  IF EXISTS (SELECT 1 FROM public.group_job_helpers g
              WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL
                AND (g.share_cents IS NULL OR g.slot_no IS NULL)) THEN
    RAISE EXCEPTION 'crew_share_not_frozen'
      USING HINT = 'A member of this crew has no frozen share: use Full refund, or settle it by hand.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_refund) AS r(id)
              WHERE r.id IS NULL OR NOT EXISTS (
                SELECT 1 FROM public.group_job_helpers g WHERE g.job_id = _job_id AND g.helper_id = r.id)) THEN
    RAISE EXCEPTION 'crew_dispute_unknown_member'
      USING HINT = 'Every member named for a refund must be on this crew.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.group_job_helpers g
                  WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL
                    AND NOT (g.helper_id = ANY (_refund))) THEN
    RAISE EXCEPTION 'crew_dispute_all_refunded'
      USING HINT = 'Refunding every member is a full refund: use the Full refund action.';
  END IF;

  INSERT INTO public.crew_dispute_member_outcomes
    (dispute_id, job_id, helper_id, slot_no, share_cents, member_outcome, decided_by)
  SELECT _dispute_id, _job_id, g.helper_id, g.slot_no, g.share_cents,
         CASE WHEN g.helper_id = ANY (_refund) THEN 'refund' ELSE 'pay' END, _uid
    FROM public.group_job_helpers g
   WHERE g.job_id = _job_id AND g.helper_id IS NOT NULL;

  SELECT COALESCE(sum(share_cents) FILTER (WHERE member_outcome = 'pay'), 0),
         COALESCE(sum(share_cents) FILTER (WHERE member_outcome = 'refund'), 0)
    INTO _pay_cents, _refund_cents
    FROM public.crew_dispute_member_outcomes WHERE dispute_id = _dispute_id;
  _budget_cents := GREATEST(round(COALESCE(_job.budget, 0) * 100)::bigint, 1);

  UPDATE public.disputes
     SET status = 'decided',
         decided_at = now(),
         decided_by = _uid,
         decision_text = _decision_text,
         -- Fractions of the budget, for every reader of payout_split; the
         -- per-member truth is crew_dispute_member_outcomes.
         payout_split = jsonb_build_object(
           'poster', round((_budget_cents - _pay_cents)::numeric / _budget_cents, 6),
           'helper', round(_pay_cents::numeric / _budget_cents, 6),
           'crew', true,
           'pay_cents', _pay_cents,
           'refund_share_cents', _refund_cents),
         -- Settled by process-scheduled-payouts' crew fan-out, which pays each
         -- 'pay' member their frozen share, refunds the rest to the poster and
         -- only then stamps 'executed' (mark_crew_dispute_executed).
         execution_status = 'crew_fanout'
   WHERE id = _dispute_id;

  -- Completed and queued for the fan-out after the same 24h hold the dispute
  -- sweep uses (a chargeback buffer, and the window in which an admin may
  -- still supersede this decision).
  UPDATE public.jobs
     SET status = 'completed'::public.job_status,
         payment_status = 'payout_pending',
         payout_scheduled_at = now() + interval '24 hours',
         dispute_status = 'resolved',
         dispute_resolved_at = now()
   WHERE id = _job_id;

  IF _job.customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, job_id)
    VALUES (
      _job.customer_id, 'info', 'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job.title, 'your job') || '": ' || _decision_text ||
        CASE WHEN _refund_cents > 0
             THEN ' The share of ' || cardinality(_refund)::text ||
                  CASE WHEN cardinality(_refund) = 1 THEN ' Helpr' ELSE ' Helprs' END ||
                  ' is being returned to you.'
             ELSE '' END,
      '/posts?job=' || _job_id::text, _job_id);
  END IF;
  FOR _m IN SELECT helper_id, member_outcome FROM public.crew_dispute_member_outcomes WHERE dispute_id = _dispute_id LOOP
    INSERT INTO public.notifications (user_id, type, title, message, link, job_id)
    VALUES (
      _m.helper_id, 'info', 'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job.title, 'a job you worked') || '": ' || _decision_text ||
        CASE WHEN _m.member_outcome = 'pay'
             THEN ' Your share will be paid out.'
             ELSE ' Your share goes back to the person who posted the job.' END,
      '/jobs?job=' || _job_id::text, _job_id);
  END LOOP;

  -- The decision is not wrapped: a crew money decision with no audit row is
  -- worse than a refused one.
  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (_uid, 'decide_crew_dispute', _dispute_id, 'dispute',
    jsonb_build_object('job_id', _job_id, 'pay_cents', _pay_cents, 'refund_share_cents', _refund_cents,
                       'refund_helper_ids', to_jsonb(_refund), 'decision_preview', left(_decision_text, 200)));

  RETURN jsonb_build_object('pay_cents', _pay_cents, 'refund_share_cents', _refund_cents);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_decide_crew_dispute(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_decide_crew_dispute(uuid, text, uuid[]) TO authenticated, service_role;

-- ── 8. Only the fan-out closes a crew decision ──────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_crew_dispute_executed(
  _dispute_id uuid, _helper_cents integer, _refund_cents integer, _refund_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n integer;
BEGIN
  PERFORM set_config('app.crew_fanout_settle', '1', true);
  UPDATE public.disputes
     SET execution_status = 'executed',
         executed_at = now(),
         execution_helper_cents = GREATEST(COALESCE(_helper_cents, 0), 0),
         execution_refund_cents = GREATEST(COALESCE(_refund_cents, 0), 0),
         execution_refund_id = COALESCE(execution_refund_id, _refund_id),
         execution_error = NULL
   WHERE id = _dispute_id
     AND execution_status = 'crew_fanout';
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.crew_fanout_settle', '0', true);
  RETURN _n = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_crew_dispute_executed(uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_crew_dispute_executed(uuid, integer, integer, text) TO service_role;

-- A crew decision's record is the fan-out's instructions. Nobody but
-- mark_crew_dispute_executed moves its execution_status (settle-without-
-- payment or an admin's direct write would read "settled" and the fan-out
-- would then pay every member in full), nobody rewrites its split, and it is
-- superseded only while its payout is still more than 15 minutes away (a
-- fan-out run may otherwise be paying it at that moment).
CREATE OR REPLACE FUNCTION public.enforce_crew_fanout_dispute_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_due timestamptz;
BEGIN
  IF OLD.execution_status IS DISTINCT FROM 'crew_fanout' THEN
    RETURN NEW;
  END IF;
  IF NEW.execution_status IS DISTINCT FROM OLD.execution_status
     AND COALESCE(current_setting('app.crew_fanout_settle', true), '') <> '1' THEN
    RAISE EXCEPTION 'crew_fanout_settled_by_payout_run: a crew decision is settled only by the payout fan-out (dispute_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.payout_split IS DISTINCT FROM OLD.payout_split
     OR NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
    RAISE EXCEPTION 'crew_fanout_decision_fixed: a crew decision is not rewritten; supersede it (dispute_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- FOR SHARE: the payout time is judged on a row nobody can move under
    -- this decision (rpc_supersede_dispute_decision already holds it FOR
    -- UPDATE; a direct admin write does not).
    SELECT j.payout_scheduled_at INTO v_due FROM public.jobs j WHERE j.id = OLD.job_id FOR SHARE;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (v_due IS NULL OR v_due <= now() + interval '15 minutes') THEN
    RAISE EXCEPTION 'crew_fanout_due: this crew decision is being paid out and can no longer be superseded (dispute_id=%)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_crew_fanout_dispute_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crew_fanout_dispute_lock ON public.disputes;
CREATE TRIGGER trg_crew_fanout_dispute_lock
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_crew_fanout_dispute_lock();

-- ── 9. The unpaid-dispute sweep stops calling a closed crew dispute a strand ─
-- sweep_disputes_closed_without_payment pages a dispute closed with no money
-- moved on a job whose funds are held, on the premise that no automatic path
-- will pay it. process-scheduled-payouts now pays a CREW whose dispute closed
-- (Q396(c)), so that premise holds for single-Helpr jobs only. Restated from
-- its effective definition (20260922224023) with that one predicate added.
CREATE OR REPLACE FUNCTION public.sweep_disputes_closed_without_payment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reported int   := 0;
  v_seen     jsonb := '[]'::jsonb;
  r          record;
BEGIN
  -- A from-scratch replay (PGlite, a fresh branch) may not have these yet.
  -- Nothing to look at is not a defect to report.
  IF to_regclass('public.disputes') IS NULL
     OR to_regclass('public.jobs') IS NULL
     OR to_regclass('public.error_logs') IS NULL THEN
    RETURN jsonb_build_object('reported', 0, 'skipped', 'tables not present');
  END IF;

  FOR r IN
    SELECT d.id                AS dispute_id,
           d.job_id            AS job_id,
           d.payout_split      AS payout_split,
           d.decided_at        AS decided_at,
           j.payment_status    AS payment_status,
           j.status            AS job_status,
           COALESCE(j.is_seed, false) AS is_seed
      FROM public.disputes d
      JOIN public.jobs j ON j.id = d.job_id
     WHERE d.execution_status = 'executed'
       -- Moved nothing, by any route, and said nothing about why.
       AND d.execution_transfer_id IS NULL
       AND d.execution_refund_id   IS NULL
       AND COALESCE(d.execution_helper_cents, 0) = 0
       AND COALESCE(d.execution_refund_cents, 0) = 0
       AND d.execution_error IS NULL
       -- The funds are still held. A job already refunded or paid out is
       -- settled by some other path and is not owed anything here.
       AND j.payment_status IN ('escrow', 'payout_pending')
       -- Q396(c), 20260925234055: a CREW whose dispute closed (resolved /
       -- auto_resolved) is paid by process-scheduled-payouts' fan-out, so it
       -- is not a strand; a single-Helpr job still is (that cron still
       -- excludes it), and stays watched.
       AND NOT (j.is_group_job IS TRUE AND j.dispute_status IN ('resolved', 'auto_resolved'))
       -- Never reported before. The dedupe.
       AND NOT EXISTS (
             SELECT 1
               FROM public.error_logs e
              WHERE e.tags ->> 'area' = 'dispute-unsettled'
                AND e.context ->> 'dispute_id' = d.id::text)
     ORDER BY d.decided_at NULLS LAST
       -- THE ROW LOCK, added 2026-09-22 after this function tripped
       -- scripts/check-race-class.mjs and made race-runner red (#1643).
       --
       -- The guard's shape is exact and this matched it: read public.jobs
       -- WITHOUT a lock, make a decision (the IF below), write somewhere other
       -- than jobs (error_logs). It exists because two money bugs came from
       -- that shape — applications landing on a cancelled job, and a payout
       -- cron charging 25% on one.
       --
       -- Here the damage is smaller but real, and it STICKS: release-payout
       -- can settle a dispute between this SELECT and the INSERT, and the row
       -- would be reported as unpaid forever — the dedupe is on dispute id, so
       -- a false page is never re-evaluated.
       --
       -- `OF j` locks only the jobs rows, not disputes. FOR SHARE, not FOR
       -- UPDATE: this function never writes to jobs and must never block a
       -- settlement any longer than reading it takes.
       FOR SHARE OF j
  LOOP
    INSERT INTO public.error_logs (severity, message, tags, context)
    VALUES (
      CASE WHEN r.is_seed THEN 'error' ELSE 'fatal' END,
      format('Dispute %s on job %s is marked executed but moved no money: no transfer, no refund, no cents, no error. The job has been %s since %s UTC and neither process-scheduled-payouts (excluded by disputed_at) nor claim_dispute_settlement (excluded by execution_status) will ever pay it. Split %s. Only a manual release-payout can settle it.',
             left(r.dispute_id::text, 8),
             left(r.job_id::text, 8),
             r.payment_status,
             to_char(r.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
             COALESCE(r.payout_split::text, 'unrecorded')),
      jsonb_build_object('source', CASE WHEN r.is_seed
                                        THEN 'dispute-unsettled-seed'
                                        ELSE 'dispute-unsettled' END,
                         'area', 'dispute-unsettled'),
      jsonb_build_object('dispute_id',     r.dispute_id,
                         'job_id',         r.job_id,
                         'payout_split',   r.payout_split,
                         'payment_status', r.payment_status,
                         'job_status',     r.job_status,
                         'decided_at',     r.decided_at,
                         'is_seed',        r.is_seed));

    v_reported := v_reported + 1;
    v_seen := v_seen || jsonb_build_object('dispute_id', r.dispute_id,
                                           'job_id',     r.job_id,
                                           'is_seed',    r.is_seed,
                                           'severity',   CASE WHEN r.is_seed
                                                              THEN 'error' ELSE 'fatal' END);
  END LOOP;

  RETURN jsonb_build_object('reported', v_reported, 'disputes', v_seen);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_disputes_closed_without_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_disputes_closed_without_payment() TO service_role;
