-- A dispute may not be filed with no explanation.
--
-- External QA, 2026-09-06: File a Dispute → reason "Other" → leave "What
-- happened?" empty → Submit. `rpc_open_dispute` returned 200 and created the
-- dispute. The stored reason is the literal string 'Other:' — the label, a
-- colon, and nothing else. Verified against production the same day; the row
-- is still there:
--
--   job 8133a907-f36f-4278-96c4-41d4ce1d56c8 "QA main loop mow and edge"
--   disputes.reason = 'Other:'      jobs.dispute_reason = 'Other:'
--
-- That string is then rendered to the counterparty ("Reason: Other:"), into
-- the dispute timeline, into the admin queue, and into the Slack ops page
-- (`notify_ops_dispute_filed` interpolates it verbatim). An admin has nothing
-- to decide on, and `jobs.dispute_deadline` freezes the escrow for 72 hours on
-- the strength of it.
--
-- The asymmetry is the tell: the RESPONSE side of this same flow is already
-- gated — DisputedSection's Submit stays `disabled` until the helper types
-- something. Only the FILING side, the half that actually moves money, was
-- open. The client gate lands with this migration too, but the client gate is
-- not the control: this RPC is directly callable with any string, and the
-- reason a payout is held has to be defensible server-side.
--
-- WHAT IS ENFORCED, and why it is shaped this way. The client composes
-- `<label>: <details>` (DisputeDialog.tsx), so the empty-details case always
-- arrives as a string ending in ':' after trimming. Rather than teach the
-- database the client's label list — which would rot the moment a reason is
-- added — three format-agnostic rules cover it:
--
--   1. blank / whitespace-only         → rejected
--   2. ends in ':' after trimming      → rejected (a label with no body)
--   3. shorter than 15 characters      → rejected
--
-- Rule 3 is a floor, not the product bar: DisputeDialog additionally requires
-- 10 characters of free text BEYOND the label, which no server rule can check
-- without knowing the labels. A caller going around the client still has to
-- say something an admin can read.
--
-- The check runs BEFORE the existing-dispute branch, so an evidence-append
-- re-file cannot smuggle an empty reason in either — that branch calls
-- `notify_ops_dispute_filed(_reason)` on a re-freeze and would have paged ops
-- with 'Other:'.
--
-- ERRCODE is the terse machine code the rest of the lifecycle RPCs use
-- (`lifecycleErrorMessage`, src/lib/lifecycleErrors.ts, matches on
-- containment), so the dialog shows a sentence rather than raw Postgres prose.
--
-- Body is otherwise VERBATIM from the live production definition read on
-- 2026-09-06 (`pg_get_functiondef`), not from the migration that last defined
-- it — 20260902035447 replaced this function after 20260901032007, and
-- rebuilding from the older file would have silently reverted the pg_net ops
-- alert.
--
-- Replay-safe: CREATE OR REPLACE only. No DDL, no data change.

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
  _title text;
  _status text;
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
  _reason_trimmed text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. See the header for the three rules.
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
  SELECT customer_id, helper_id, title, status::text
    INTO _customer, _helper, _title, _status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

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

  -- ── Tell the people this affects ────────────────────────────────────────
  -- The counterparty first: their money or their payout just froze, and
  -- until now the only thing that told them was a chat system message that
  -- inserts nothing when the two have never messaged.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own,
  -- so the job sits in whichever bucket the receiving surface computes, and a
  -- hardcoded filter is wrong the moment that bucket changes.
  IF _other IS NOT NULL THEN
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

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads (it falls back to "home" for
  -- anything else, which is where the old `?tab=disputes` link landed).
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

  -- And page ops in Slack. This is the call DisputeDialog.tsx used to make
  -- from the browser, where it 401'd on every filing since launch.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$;

COMMENT ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) IS
  'Opens (or re-freezes) the one dispute on a job. Rejects a reason that is '
  'blank, ends in a colon, or is shorter than 15 characters — QA filed '
  '"Other:" through this function on 2026-09-06 and froze an escrow with it.';

-- Privileges are unchanged by CREATE OR REPLACE. Restated so a replay onto a
-- fresh database lands the SAME acl production carries today, read on
-- 2026-09-06: `{postgres=X, authenticated=X, service_role=X}` — anon already
-- revoked. `FROM PUBLIC, anon` because revoking PUBLIC alone leaves Supabase's
-- per-role default grant to anon intact (see CLAUDE.md); `TO authenticated,
-- service_role` because naming only `authenticated` would quietly DROP
-- service_role's existing EXECUTE.
REVOKE ALL ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated, service_role;
