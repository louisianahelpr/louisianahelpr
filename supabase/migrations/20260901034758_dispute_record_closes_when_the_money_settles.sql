-- Every path that settles a dispute's MONEY leaves the dispute RECORD open.
--
-- `public.disputes` is the record of truth for a dispute (20260609140000), but
-- only two writers ever close a row: `rpc_decide_dispute` and
-- `rpc_withdraw_dispute`. The three paths that actually move the escrow do not:
--
--   • auto-resolve-disputes  — flips the job to completed / payout_pending and
--     writes jobs.dispute_status = 'auto_resolved'. It never touches this table
--     (verified by reading the function: `from("jobs")` and
--     `from("notifications")` are its only writes).
--   • create-payment action=admin_release_dispute  — transfers escrow to the
--     helper, writes jobs.status/payment_status only.
--   • create-payment action=admin_refund_dispute   — refunds the poster,
--     writes jobs.status/payment_status only.
--
-- The row is then permanently `status = 'open'` on a job whose money is gone.
-- Four consequences, all silent:
--
--   1. `disputes_one_open_per_job_idx` (20260901032007) makes that stale row
--      the ONLY dispute that job can ever have. Every future filing merges into
--      it — `rpc_open_dispute`'s existing-dispute branch appends evidence to a
--      settled dispute, under the original opener and the original reason.
--   2. That same branch RE-FREEZES the job to 'disputed'. A settled job can be
--      re-frozen forever off the back of a record that should not exist.
--   3. `rpc_decide_dispute` requires `status = 'open'`, so an admin can still
--      "decide" a dispute whose escrow already left — and AdminDisputes then
--      invokes `execute-dispute-split` against it. It refuses today only
--      incidentally, on the payment_status gate; nothing states the real reason.
--   4. money-reconciliation's `disputeNoRow` check and the admin queue's
--      record map both read a row that contradicts the job beside it.
--
-- The fix is ONE writer for "this dispute's money is settled, close the record",
-- called by all three paths, instead of three hand-rolled UPDATEs that can
-- drift. It is deliberately a function and not a trigger on `public.jobs`:
-- `dispute_resolved_at` is NOT in prevent_job_field_escalation's
-- `locked_everyone` list (20260826040000:370), so a jobs-trigger write to
-- `disputes` could run with a non-admin `auth.uid()` and be rejected by
-- `enforce_dispute_opener_column_whitelist` (20260901032007) — turning a
-- settlement into a hard failure. Every caller here is service_role, whose
-- `auth.uid()` is NULL, which that trigger returns early on.
--
-- The crash window between the caller's `jobs` UPDATE and this call is closed
-- by auto-resolve-disputes' orphan sweep, which finds any `open` dispute row
-- whose job's dispute is already terminal and calls this function on it.
--
-- Replay-safe: CREATE OR REPLACE only, no DDL on any table, no data repair.
-- `public.disputes` (20260609140000), its execution columns (20260824230000)
-- and `public.jobs.dispute_status` all exist well before this timestamp.

CREATE OR REPLACE FUNCTION public.settle_dispute_record(
  _job_id        uuid,
  _outcome       text,
  _decided_by    uuid    DEFAULT NULL,
  _decision_text text    DEFAULT NULL,
  _helper_cents  integer DEFAULT NULL,
  _refund_cents  integer DEFAULT NULL,
  _transfer_id   text    DEFAULT NULL,
  _refund_id     text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  SELECT status::text, payment_status, dispute_status, dispute_resolved_at
    INTO _job_status, _payment_status, _dispute_status, _resolved_at
    FROM public.jobs
   WHERE id = _job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settle_dispute_record: job % not found', _job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── The gate is `payment_status`, and ONLY `payment_status` ──────────────
  -- This is the load-bearing line, and it is deliberately not `jobs.status` or
  -- `jobs.dispute_status`. BOTH of those are writable by a party to the job:
  -- `status` and `dispute_status` are on the assigned helper's allow-list
  -- (20260828020000:446,458), the poster reaches them because
  -- prevent_job_field_escalation returns early for the poster
  -- (20260826040000), `dispute_resolved_at` is deliberately omitted from
  -- `locked_everyone` (20260826040000:369), and `disputed -> completed` is a
  -- legal non-admin transition.
  --
  -- So a party LOSING a live dispute could otherwise send one PATCH —
  -- {"status":"completed","dispute_status":"resolved"} — and have this
  -- function close their own open dispute as decided + executed. That is
  -- terminal: `rpc_decide_dispute` then raises 'dispute already decided' and
  -- `execute-dispute-split` returns 409 'already been executed', with no
  -- recovery path short of manual SQL. It is the same denial-of-service
  -- 20260901032007 §4 closed at the `disputes` table, re-entering through
  -- `jobs` — and worse, because a trusted service_role writer performs it, so
  -- the column-whitelist trigger has nothing to reject.
  --
  -- `payment_status` is the one column here no party can write: it is in
  -- `poster_locked_always` (20260826040000:386) and absent from the helper
  -- allow-list. Only the escrow/payout edge functions set it.
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

  -- The caller states which way it went; the LEDGER decides. A disagreement is
  -- a bug in the caller, and writing the caller's version would stamp a
  -- payout_split that contradicts Stripe onto a row nothing can correct
  -- afterwards — "poster 0% · Helpr 100%" on a job the poster was refunded.
  IF _outcome <> _settled_to THEN
    RAISE EXCEPTION
      'settle_dispute_record: caller says % but jobs.payment_status=% means % (job %)',
      _outcome, _payment_status, _settled_to, _job_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Fail LOUD, not silently, if a caller tries to close the record on a job
  -- whose dispute is still live. Closing a record while the escrow is still
  -- frozen would hand the job to release-payout with nobody watching, which is
  -- the exact class of bug this function exists to end. The caller must write
  -- the job's terminal dispute state FIRST; this is the second half of that
  -- settlement, never the first.
  --
  -- `dispute_resolved_at IS NOT NULL` is NOT sufficient on its own, which is
  -- the trap the first draft of this fell into. `rpc_open_dispute`'s re-freeze
  -- branch (20260901032007) sets `status='disputed'` and
  -- `dispute_status='open'` on a job that was previously settled, and it does
  -- NOT clear `dispute_resolved_at` — so a genuinely live, re-filed dispute
  -- carries a stale resolution timestamp and would have passed. The live
  -- states are therefore excluded explicitly rather than inferred.
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
  -- match zero rows and return NULL. An already-'decided' row — including one
  -- settled by rpc_decide_dispute + execute-dispute-split with real Stripe ids
  -- on it — is never overwritten.
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
         -- 'executed' is terminal for execute-dispute-split (index.ts:191), and
         -- that is precisely what is wanted: the money for this dispute has
         -- already moved through a different path, so the split executor must
         -- refuse rather than move it a second time. Before this, the row sat
         -- 'open' with a NULL execution_status — one `rpc_decide_dispute` call
         -- away from being handed to the executor.
         execution_status       = 'executed',
         executed_at            = COALESCE(executed_at, now()),
         execution_started_at   = COALESCE(execution_started_at, now()),
         -- Amounts and Stripe ids are recorded when the caller knows them and
         -- left NULL when it does not (auto-resolve schedules a payout it does
         -- not itself execute, so it has no transfer id to give). NULL means
         -- "not recorded here", never "zero" — a $0 written into a money column
         -- is a claim, and the wrong one.
         --
         -- CASE, not COALESCE(...): `GREATEST` IGNORES nulls, so a first draft
         -- written as `COALESCE(GREATEST(_helper_cents, 0), …)` resolved a NULL
         -- to a settled 0 — the COALESCE never saw a NULL at all. Caught by the
         -- PGlite proof, not by reading. Negatives are rejected outright above
         -- rather than clamped here, for the same reason.
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
$function$;

COMMENT ON FUNCTION public.settle_dispute_record(uuid, text, uuid, text, integer, integer, text, text) IS
  'Closes the one open public.disputes row on a job whose escrow has already '
  'been settled by a path outside execute-dispute-split (auto-resolve-disputes, '
  'or create-payment admin_release_dispute / admin_refund_dispute). Marks it '
  'decided + execution_status=''executed'' so the split executor refuses to move '
  'the money a second time. Idempotent: matches only status=''open'' and returns '
  'NULL when there is nothing to close. RAISEs if the job''s own dispute state is '
  'not yet terminal — the caller writes that first. service_role only: every '
  'caller is an edge function, and a party to a dispute must never be able to '
  'close their own record.';

-- service_role only. The CI grant-guard wants an explicit statement for every
-- new function; this one is deliberately NOT granted to `authenticated`. The
-- sanctioned user-facing exits stay `rpc_decide_dispute` (admin) and
-- `rpc_withdraw_dispute` (opener) — this closes a record to match money that
-- has ALREADY moved, which no client is ever in a position to assert.
REVOKE ALL ON FUNCTION public.settle_dispute_record(uuid, text, uuid, text, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_dispute_record(uuid, text, uuid, text, integer, integer, text, text) TO service_role;
