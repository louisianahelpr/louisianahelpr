-- A REVISION THE HELPER NEVER DELIVERS STRANDED THE ESCROW FOREVER.
--
-- `set_revision_deadline` (20260330203504) stamps `jobs.revision_deadline` =
-- now() + 72h on every transition into `revision_requested`, and the helper's
-- card counts down against it ("6h 5m remaining"). That countdown enforced
-- NOTHING: `revision_deadline` has zero readers in `supabase/functions/` — the
-- only two hits are comments. The revision settle-out pass added 2026-09-05
-- (`auto-release-payment:175+`) deliberately requires
-- `revision_completed_at IS NOT NULL`, because it MOVES MONEY and must not pay
-- out a fix still being worked on. So it covers "helper delivered, poster went
-- quiet" and, correctly, nothing else.
--
-- The uncovered case is the other one: the helper never delivers at all. The
-- poster's card tells them they MAY file a dispute — an optional act — and if
-- both parties go quiet the escrow sits indefinitely with no exit at all.
--
-- THE DECISION (owner): when `revision_deadline` lapses with no fix delivered,
-- auto-open the dispute the UI already tells the poster they can file, and let
-- an admin decide the split. NO MONEY MOVES WITHOUT HUMAN JUDGMENT — this
-- migration opens a dispute and freezes the escrow; it never settles one.
--
-- ONE CREATION PATH, TWO DOORS. `rpc_open_dispute` is the only way a dispute
-- has ever been created, and it opens with `IF auth.uid() IS NULL THEN RAISE`
-- — so a service-role cron cannot call it. Rather than write a second INSERT
-- (which is how the `disputes` row and the `jobs` mirror columns drift apart),
-- the body moves verbatim into `public.open_dispute_as(...)`, which takes the
-- opener as a PARAMETER, and `rpc_open_dispute` becomes a thin wrapper that
-- authenticates and delegates. Every existing caller keeps its exact
-- signature, behaviour and grants.
--
-- `_opener_id IS NULL` is the system filing. What changes on that branch, and
-- why each one:
--   · the "are you a party to this job" check is skipped — there is no caller
--     to authorise, and the function is service-role-only.
--   · the dispute-velocity fraud check is skipped — flagging an account for a
--     dispute the PLATFORM opened would punish people for our own sweep.
--   · `disputes.opener_id` and `jobs.disputed_by` stay NULL. The column is
--     already nullable (account deletion anonymises it, 20260901033011) and
--     the admin queue never renders it — it renders the job's customer and
--     helper — so a system row looks normal in `/admin?view=disputes`.
--   · BOTH parties are notified, not "the counterparty".
--
-- CONSEQUENCE, STATED RATHER THAN DISCOVERED: `rpc_withdraw_dispute` refuses
-- anyone but the opener (`_opener IS DISTINCT FROM _uid`), and NULL is
-- DISTINCT FROM every uuid, so neither party can unilaterally withdraw a
-- system-opened dispute. That is the correct outcome — the platform opened it
-- because both parties went quiet — and the admin decision path remains the
-- way out. It also cannot misbehave the way that RPC did when a migration
-- pinned `decided_at`: this file adds no trigger and pins no column.
--
-- REPLAY-SAFETY: both functions are CREATE OR REPLACE, and the whole file is
-- guarded on the objects it depends on existing, so it is a no-op on a
-- from-scratch replay that has not reached them yet. Applying it three times
-- consecutively is identical to applying it once.

DO $mig$
BEGIN
  -- Everything below rewrites rpc_open_dispute. On a from-scratch rebuild that
  -- has not yet created it (or `check_dispute_velocity` /
  -- `notify_ops_dispute_filed`, which the body calls), skip entirely — the
  -- migration that defines it runs later and this one has nothing to correct.
  IF to_regprocedure('public.rpc_open_dispute(uuid, text, text[])') IS NULL
     OR to_regprocedure('public.check_dispute_velocity(uuid)') IS NULL
     OR to_regprocedure('public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean)') IS NULL
  THEN
    RAISE NOTICE 'open_dispute_as: prerequisites not present yet — skipping (replay)';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.open_dispute_as(
  _job_id uuid,
  _opener_id uuid,
  _reason text,
  _evidence_urls text[]
)
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
  SELECT customer_id, helper_id, title, status::text
    INTO _customer, _helper, _title, _status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN
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

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads.
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

  -- And page ops in Slack.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$
  $fn$;

  -- Service-role only. `REVOKE ... FROM PUBLIC` alone would leave anon and
  -- authenticated holding the EXECUTE that Supabase's ALTER DEFAULT PRIVILEGES
  -- grants each of them individually — a revoke that reads as least privilege
  -- and does nothing (CLAUDE.md). Name the roles.
  REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;

  -- The user-facing door: unchanged signature, unchanged grants, and now the
  -- ONLY thing it does itself is establish who is asking.
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.rpc_open_dispute(_job_id uuid, _reason text, _evidence_urls text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- One creation path. Everything this function used to do inline — the
  -- description guard, the FOR UPDATE, the party check, the existing-dispute
  -- re-freeze, the velocity flag, the notifications and the Slack page — now
  -- lives in open_dispute_as, so the platform's own filings cannot drift from
  -- the ones people make.
  RETURN public.open_dispute_as(_job_id, _uid, _reason, _evidence_urls);
END;
$function$
  $fn$;

  REVOKE ALL ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated, service_role;
END
$mig$;
