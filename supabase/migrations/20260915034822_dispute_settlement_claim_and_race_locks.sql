-- Dispute settlement races: one winner, per target.
--
-- Three concurrency holes on the dispute paths, all BUILT here and none of
-- them yet proven on prod (the prod probes in scripts/probes/ are written and
-- deliberately NOT run by this lane; the coordinator runs them).
--
--   1. settle_dispute_record read `jobs` unlocked and decided from that
--      snapshot. -> it locks its own `disputes` row FOR UPDATE first and reads
--      the job after, so a concurrent re-freeze cannot land between the gate
--      and the write. Deliberately NOT a lock on `jobs`: that would take
--      jobs -> disputes while rpc_withdraw_dispute and rpc_decide_dispute take
--      disputes -> jobs, an ABBA cycle on the exact pairing this fixes.
--
--   2. Admin Quick Release and Quick Refund on the SAME job at once each ran
--      their Stripe step (a transfer and a refund, different idempotency keys,
--      so neither guard saw the other) BEFORE the guarded `jobs` flip that
--      picks a winner. Money moved BOTH ways and only one flip landed.
--      -> public.dispute_settlement_claims: a primary-key INSERT that exactly
--      one caller can win, taken BEFORE any Stripe call.
--
--   3. open_dispute_as stamped `disputed` on the new-dispute path without
--      checking the job was still disputable, and appended evidence urls with
--      a bare `||` so a double submit stored every photo twice.
--      -> an explicit gate on the transition matrix's own `-> disputed` edges,
--      the same set written into the UPDATE's own WHERE, and a set-like
--      append.
--
--   4. auto-resolve-disputes (the 72h sweep) flipped a disputed job to
--      completed/payout_pending guarded only on payment_status='escrow', with
--      no claim. Mid Quick Refund the sweep could win the flip and the Helpr
--      was paid 24h later ON TOP of the refund.
--      -> 'sweep' is a claim action: the sweep takes the same claim before its
--      flip and skips a job whose claim is held or joined.
--
--   5. Nothing watched this table. A holder that dies between its Stripe call
--      and its flip leaves a claim nobody releases, and the claim's own expiry
--      then deleted it silently on the next attempt.
--      -> check_stale_dispute_settlement_claims() (section 2b), every 15 minutes, pages
--      #ops-alerts (critical) for a claim older than its TTL on a job that is
--      still disputed; claim_dispute_settlement reports an expired claim
--      through the same function before it deletes it.
--
-- Round 4 (lh-money-escrow review round 3, closed before landing):
--   H1  rpc_withdraw_dispute (section 4) refuses while a settlement claim
--       exists: a withdrawal took the job out of `disputed` under a live or
--       dead holder and handed the escrow to every ledger-only payout path.
--   M1  rpc_supersede_dispute_decision (section 5): an admin-only exit for a
--       decided split that can never execute and has moved nothing. It
--       re-opens the dispute for a new decision instead of leaving SQL as the
--       only way out.
--   M2  a claim only STICKS once its holder stamped it at its money step
--       (`money_step_at`, stamp_dispute_settlement_claim). An unstamped dead
--       claim moved nothing: it expires into the next caller, is reported as a
--       warning, and never pages critical.
--   LOW a split retry takes over its own dead split's claim (the split
--       reconciles its own legs from the ledger and Stripe).
--
-- Round 5 (both round-4 reviews): supersede RETIRES the ruled row as
-- 'superseded' and opens a NEW dispute row (section 5); it refuses a split
-- executing inside the TTL or a stamped money step; a split may claim only a
-- job carrying a decided, unexecuted dispute; rpc_decide_dispute (section 6)
-- refuses under a live or stamped claim and when the admin is a party; the
-- TTL is 10 minutes, past the 400 s edge wall clock; an expired UNSTAMPED claim
-- of any action no longer blocks a withdrawal; the monitor's DELETE re-checks
-- the stamp.
--
-- Replay-safe: every object is CREATE OR REPLACE / IF NOT EXISTS, and the
-- function bodies are the LIVE prod definitions (pg_get_functiondef,
-- re-derived 2026-09-15 after rebasing onto main: open_dispute_as now carries
-- 20260915025607's job_already_completed guard; settle_dispute_record,
-- rpc_withdraw_dispute and rpc_decide_dispute were unchanged live) with only
-- the changes above applied — nothing else is touched.
-- scripts/check-migration-raise-codes.mjs checks every RAISE code of the
-- newest earlier definition survives.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. settle_dispute_record — lock the job row it decides from.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.settle_dispute_record(_job_id uuid, _outcome text, _decided_by uuid DEFAULT NULL::uuid, _decision_text text DEFAULT NULL::text, _helper_cents integer DEFAULT NULL::integer, _refund_cents integer DEFAULT NULL::integer, _transfer_id text DEFAULT NULL::text, _refund_id text DEFAULT NULL::text)
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

  -- ── Lock the DISPUTE ROW, and only the dispute row ──────────────────────
  -- Added 20260915034822, and deliberately not the `FOR SHARE` on `jobs` the
  -- first draft carried. The window is real: everything below decides from a
  -- snapshot, and `open_dispute_as`'s RE-FREEZE branch flips a settled job back
  -- to status='disputed' / dispute_status='open'. Landing between the gate and
  -- the write, it made this function stamp 'decided' + 'executed' onto a
  -- dispute that is LIVE again — terminal, because `rpc_decide_dispute` then
  -- raises 'dispute already decided' and `execute-dispute-split` returns 409,
  -- with no recovery short of manual SQL.
  --
  -- A lock on `jobs` was the first draft. At the time `rpc_withdraw_dispute`
  -- and `rpc_decide_dispute` took disputes -> jobs, so it made an ABBA cycle
  -- (40P01, swallowed into a Slack warning by `closeDisputeRecordForJob`).
  -- Those two now take jobs -> disputes (sections 4 and 6), but this function
  -- still needs no job lock: the single dispute-row lock below closes the
  -- window on its own, and holding nothing else keeps it out of every cycle.
  --
  -- Locking the dispute row instead closes the same window with ONE lock and
  -- no ordering at all. The re-freeze branch's first write is
  -- `UPDATE public.disputes SET evidence_urls = …` on this very row, so while
  -- this transaction holds it the re-freeze cannot proceed to its `jobs`
  -- write. A brand-new filing is blocked by `disputes_one_open_per_job_idx`
  -- for as long as this row is still 'open'. Nothing here ever waits on a
  -- second object, so this function cannot be a party to a deadlock.
  SELECT id INTO _dispute_id
    FROM public.disputes
   WHERE job_id = _job_id AND status = 'open'
   ORDER BY created_at DESC
   LIMIT 1
     FOR UPDATE;

  -- NOTE the missing early return. "No open record" is the idempotent case and
  -- ends in NULL either way, but it must fall through the gates below first,
  -- exactly as the zero-row UPDATE used to. Returning here instead would have
  -- silenced every caller-bug raise — a negative amount, an outcome that
  -- contradicts the ledger, a job that has not settled — on precisely the jobs
  -- where the caller is most likely to be confused about what it is closing.
  -- The gates are cheap and they are the loud half of this function.

  -- Read AFTER the lock. Under READ COMMITTED this sees whatever committed
  -- while we waited, so the gates below judge the state the writer left rather
  -- than the one we raced.
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
  -- legal non-admin transition. (Since 20260915033734 the dispute markers are
  -- server-owned — trg_dispute_markers_server_owned refuses a party's write to
  -- dispute_status — but `payment_status` stays the gate: it was never
  -- party-writable, and the gate should not depend on a later trigger.)
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
  -- Nothing to close (already decided, withdrawn, or never recorded). NULL is
  -- the honest answer, and the caller treats it exactly as it treated the old
  -- zero-row UPDATE. Reached only after every gate above has had its say.
  IF _dispute_id IS NULL THEN
    RETURN NULL;
  END IF;

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
   -- By id, on the row locked at the top; `status = 'open'` kept so a
   -- concurrent writer that changed it while we waited (a withdrawal, a
   -- decision) still matches zero rows and is never overwritten.
   WHERE id = _dispute_id
     AND status = 'open'
  RETURNING id INTO _dispute_id;

  RETURN _dispute_id;
END;
$function$;

-- Restated for the same rebuild-safety reason as open_dispute_as (the original
-- grants are 20260901034758's). Service role only.
REVOKE ALL ON FUNCTION public.settle_dispute_record(uuid, text, uuid, text, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_dispute_record(uuid, text, uuid, text, integer, integer, text, text) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. The settlement claim — Quick Release vs Quick Refund on the same job.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Both admin actions in `create-payment` already end in a conditional
-- `UPDATE jobs … WHERE id = $1 AND status = 'disputed'`, and that is what made
-- release-vs-release and refund-vs-refund safe (0/20 on prod, 93237acdf). It
-- does NOT make release-vs-REFUND safe, and cannot: the Stripe step runs
-- first in both handlers, the two steps are a `transfers.create` and a
-- `refunds.create` under different idempotency keys, and neither one's
-- idempotency guard can see the other. So both moved real money, then exactly
-- one won the flip and the other returned `alreadyResolved` — reporting
-- success over a job that had paid the Helpr AND refunded the poster.
--
-- The claim has to be taken BEFORE the first Stripe call, which means it
-- cannot be the `jobs` flip itself (that is the LAST step, and deliberately:
-- flipping first would mark a job released before the transfer that failed).
-- A separate row keyed by job_id is the smallest thing that can be won
-- atomically and released when a handler aborts without moving money.
--
-- Not a column on `jobs`, on purpose: every column there is reachable by the
-- party-writable allow-lists (see settle_dispute_record's header on exactly
-- this), and a party able to clear a settlement claim could re-open the
-- double-spend by hand. This table has no policies at all and EXECUTE on both
-- RPCs is service_role only, so only the edge functions can reach it.
CREATE TABLE IF NOT EXISTS public.dispute_settlement_claims (
  job_id      uuid PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
  action      text NOT NULL,
  claimed_by  uuid,
  -- Who specifically holds it. A claim is released by TOKEN, never by job_id:
  -- releasing by job_id alone let a caller that does not own the claim delete
  -- the one a live Stripe call is standing on. See release_dispute_settlement_claim.
  token       uuid NOT NULL DEFAULT gen_random_uuid(),
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  -- 'split' is execute-dispute-split's own settlement. It is neither of the
  -- admin actions on purpose: any pair of DIFFERENT actions refuses, so the
  -- split and the two Quick buttons are mutually exclusive without any of them
  -- needing to know about the others. 'sweep' is auto-resolve-disputes'
  -- 72h flip to payout_pending, on the same terms.
  CONSTRAINT dispute_settlement_claims_action_check
    CHECK (action = ANY (ARRAY['release'::text, 'refund'::text, 'split'::text, 'sweep'::text]))
);

-- RLS on with zero policies = readable and writable by nobody but the
-- service_role (which bypasses RLS). Stated explicitly rather than relied on:
-- a table created without it is world-readable through PostgREST the moment
-- anon or authenticated is granted SELECT by a future blanket grant.
ALTER TABLE public.dispute_settlement_claims
  ADD COLUMN IF NOT EXISTS token uuid NOT NULL DEFAULT gen_random_uuid();

-- When the holder reached its first money-moving step (a Stripe transfer,
-- refund or gift restore), stamped by stamp_dispute_settlement_claim
-- immediately BEFORE that call. NULL means the holder never got there, so a
-- dead holder with a NULL stamp moved nothing and its claim may expire like a
-- sweep's (lh-money-escrow round 3, M2: a failed release RPC on a no-money
-- exit used to become a permanent stuck_* and a false critical page).
ALTER TABLE public.dispute_settlement_claims
  ADD COLUMN IF NOT EXISTS money_step_at timestamptz;

-- Replay-safe widening: a table left by an earlier run of this migration
-- carries the two-value check, and CREATE TABLE IF NOT EXISTS will not revisit
-- it. Dropped and re-added rather than edited, which Postgres has no syntax for.
ALTER TABLE public.dispute_settlement_claims
  DROP CONSTRAINT IF EXISTS dispute_settlement_claims_action_check;
ALTER TABLE public.dispute_settlement_claims
  ADD CONSTRAINT dispute_settlement_claims_action_check
  CHECK (action = ANY (ARRAY['release'::text, 'refund'::text, 'split'::text, 'sweep'::text]));

ALTER TABLE public.dispute_settlement_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dispute_settlement_claims FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.dispute_settlement_claims IS
  'One row per job whose escrow is being settled (Quick Release, Quick Refund, execute-dispute-split, the 72h sweep). Taken before the money step, released by token; money_step_at marks a holder that reached a Stripe money call. Service-role only.';

-- How long a claim survives its holder dying mid-flight. A `create-payment`
-- invocation that is killed between the claim and its release (an edge-runtime
-- timeout, a redeploy) would otherwise lock the dispute out of BOTH actions
-- forever, and an admin's only recovery would be manual SQL. Longer than any
-- realistic Stripe round-trip, short enough that a wedged dispute clears
-- within one admin's sitting.
--
-- 10 minutes, not the first draft's 5 (round-4 review): it must outlive the
-- edge runtime's own wall clock — 400 s on a paid plan — or a slow but LIVE
-- holder's unstamped claim could be expired and taken while it still runs. The
-- stamp is by token, so such a holder would refuse its money step anyway; the
-- margin makes that a backstop rather than the design.
--
-- ONE definition, read by the claim's expiry and by the stale-claim monitor
-- (section 2b), so the monitor can never page on a different clock than the one
-- the claim expires on.
CREATE OR REPLACE FUNCTION public.dispute_settlement_claim_ttl()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$ SELECT interval '10 minutes' $function$;

REVOKE ALL ON FUNCTION public.dispute_settlement_claim_ttl() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispute_settlement_claim_ttl() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_dispute_settlement(
  _job_id uuid,
  _action text,
  _admin_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _held_action    text;
  _held_at        timestamptz;
  _held_until     timestamptz;
  _token          uuid;
  _status         text;
  _payment_status text;
  _expired        record;
  _split_pending  boolean;
BEGIN
  IF _action IS NULL OR _action NOT IN ('release', 'refund', 'split', 'sweep') THEN
    RAISE EXCEPTION 'claim_dispute_settlement: _action must be ''release'', ''refund'', ''split'' or ''sweep'', got %', _action
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The job must still be being settled. Checked HERE and not only in the edge
  -- function so the claim can never be held on a job that is not being settled.
  SELECT status::text, payment_status INTO _status, _payment_status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_dispute_settlement: job % not found', _job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Is a DECIDED dispute on this job still waiting for its money? Asked for
  -- every action, not only 'split': a party can re-file on a decided job
  -- (completed/escrow) and put it back to `disputed`, and a Quick Release,
  -- Quick Refund or the sweep claiming THAT job settled it over the admin's
  -- decision — then "Retry settlement" moved the split's legs on top
  -- (lh-money-escrow review round 2, HIGH). open_dispute_as now refuses that
  -- re-file; this refuses the claim for any job already in that shape.
  SELECT EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id
       AND d.status = 'decided'
       AND d.execution_status IS DISTINCT FROM 'executed'
  ) INTO _split_pending;

  -- 'split' is judged differently, because its job is NOT `disputed`.
  -- rpc_decide_dispute (20260907194838) flips jobs.status to completed or
  -- cancelled when it records the decision and leaves payment_status 'escrow'
  -- for execute-dispute-split to settle. The first draft of this function gated
  -- every action on status = 'disputed', so every decided split would have been
  -- refused `not_disputed` the moment this migration landed. A split is claimable
  -- while its job is disputed OR carries a decided dispute whose money has not
  -- executed yet.
  IF _action = 'split' THEN
    -- A split settles a DECIDED dispute and nothing else. The first draft also
    -- admitted any `disputed` job, which let a split claim over an escrow with
    -- no decision behind it (round-4 review) — execute-dispute-split refuses
    -- that shape itself, but the lock must not be winnable by it.
    IF NOT _split_pending THEN
      RETURN jsonb_build_object('verdict', 'not_disputed');
    END IF;
    -- execute-dispute-split's own gate narrows this further (resume states
    -- only on a resume); this is the outer bound.
    IF COALESCE(_payment_status, '') NOT IN ('escrow', 'payout_pending', 'released', 'refunded') THEN
      RETURN jsonb_build_object('verdict', 'not_settleable', 'payment_status', _payment_status);
    END IF;
  ELSE
    IF _status <> 'disputed' THEN
      -- NOT a success. The caller re-checks what the job actually settled to
      -- before it tells anyone this dispute is resolved: a job that a withdrawal
      -- restored to `in_progress` with the escrow still held is also "not
      -- disputed", and reporting THAT as resolved would retire a dispute from
      -- the admin queue with nobody paid and no alert.
      RETURN jsonb_build_object('verdict', 'not_disputed');
    END IF;
    -- A disputed job whose escrow is not held is not the admin's or the
    -- sweep's to move. `cancelling` is the live case: cancel_escrow's refund is
    -- in flight and open_dispute_as never looked at payment_status, so a Quick
    -- Release claimed it and paid the Helpr beside that refund under a
    -- disjoint idempotency key. cancelled / refunded / partially_refunded /
    -- chargeback / released are the settled cases. `payout_pending` stays
    -- claimable: a dispute re-frozen inside the 24h payout hold is a real
    -- dispute over money that has not left.
    IF COALESCE(_payment_status, '') NOT IN ('escrow', 'payout_pending') THEN
      RETURN jsonb_build_object('verdict', 'not_settleable', 'payment_status', _payment_status);
    END IF;
    IF _split_pending THEN
      RETURN jsonb_build_object('verdict', 'split_pending');
    END IF;
  END IF;

  -- A claim whose holder never came back. The edge runtime's own wall clock
  -- (400 s) is the bound that makes 10 minutes safe rather than arbitrary: a holder
  -- cannot still be running by then, so an expired claim always means a DEAD
  -- holder, never a slow one.
  --
  -- What happens next depends on whether that holder could have moved money.
  --   'sweep'   has no Stripe step — its only write is the guarded flip, and
  --             the flip either committed or it did not. Safe to expire: the
  --             row is reported, deleted, and the INSERT below picks a new
  --             winner, flagged `over_expired`.
  --   release / refund / split  run a Stripe call BEFORE their ledger write
  --             and flip. A holder killed between them leaves money moved with
  --             no ledger row and no flip — invisible to every cross-check,
  --             including Stripe's own `amount_refunded` for a transfer. The
  --             first draft expired these too, and whoever took the claim next
  --             (the sweep, or an admin's other button) moved the escrow a
  --             second time (lh-money-escrow review round 2). So these STICK
  --             once STAMPED: reported (it pages), NOT deleted, and every
  --             caller is refused `stuck_<action>` until a person has
  --             reconciled Stripe and cleared the row. The page carries the
  --             exact statement.
  --   unstamped (money_step_at NULL): the holder died, or failed to release,
  --             BEFORE its first money-moving call — every holder stamps by
  --             token immediately before that call and refuses to make it if
  --             the stamp did not land. Nothing moved, so it expires exactly
  --             like a sweep (round 3, M2).
  --   a dead SPLIT under a new 'split' claim: the split reconciles its own
  --             legs (ledger, Stripe transfers/refunds by dispute id, the gift
  --             restore's unique index), so a retry of the split takes over
  --             its own dead claim. Every other action still sees stuck_split.
  -- Reporting is wrapped: failing to REPORT a stale claim must never be the
  -- reason a live settlement cannot proceed or refuse.
  SELECT job_id, action, claimed_by, claimed_at, token, money_step_at
    INTO _expired
    FROM public.dispute_settlement_claims
   WHERE job_id = _job_id
     AND claimed_at < now() - public.dispute_settlement_claim_ttl()
     FOR UPDATE;

  IF _expired.job_id IS NOT NULL THEN
    BEGIN
      PERFORM public.report_stale_dispute_settlement_claim(
        _expired.job_id, _expired.action, _expired.claimed_by,
        _expired.claimed_at, _expired.token, 'claim_expiry', _expired.money_step_at);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'claim_dispute_settlement: could not report expired claim on job %: %', _job_id, SQLERRM;
    END;
    IF _expired.action <> 'sweep'
       AND _expired.money_step_at IS NOT NULL
       AND NOT (_expired.action = 'split' AND _action = 'split') THEN
      RETURN jsonb_build_object('verdict', 'stuck_' || _expired.action,
                                'claimed_at', _expired.claimed_at);
    END IF;
    DELETE FROM public.dispute_settlement_claims
     WHERE job_id = _job_id AND token = _expired.token;
  END IF;

  -- THE atomic step. Exactly one concurrent caller inserts the row; every
  -- other one conflicts, returns zero rows, and is told who holds it. There is
  -- no read-then-write window to lose, which is the entire reason this is an
  -- INSERT on a primary key rather than a SELECT followed by an UPDATE.
  INSERT INTO public.dispute_settlement_claims (job_id, action, claimed_by)
  VALUES (_job_id, _action, _admin_id)
  ON CONFLICT (job_id) DO NOTHING
  RETURNING token INTO _token;

  IF _token IS NOT NULL THEN
    -- `over_expired`: this claim was won by deleting a dead holder's claim
    -- that could not have moved money (a sweep, an unstamped holder, or this
    -- split's own dead run — see above). Harmless for a person; the sweep
    -- still skips it and reports, because a sweep that died mid-run is worth
    -- a look before another one settles the same job.
    RETURN jsonb_build_object('verdict', 'claimed', 'token', _token,
                              'over_expired', _expired.job_id IS NOT NULL);
  END IF;

  SELECT action INTO _held_action
    FROM public.dispute_settlement_claims WHERE job_id = _job_id;

  -- A re-entrant call from the SAME action is allowed through — two Quick
  -- Releases collapse onto one Stripe idempotency key and one conditional
  -- `jobs` flip, so refusing the second would change behaviour that is already
  -- proven safe on prod (0/20, 93237acdf). But it is emphatically NOT the
  -- holder: it gets NO token, so it cannot release a claim somebody else's
  -- live Stripe call is standing on. That was the hole — the loser's `finally`
  -- deleted the winner's claim, and a Quick Refund walked straight in while
  -- the transfer was still in flight.
  -- claimed_at / expires_at (round 5): tells the refused caller when the
  -- holder's claim runs out, so "retry later" can name a time.
  SELECT claimed_at, claimed_at + public.dispute_settlement_claim_ttl()
    INTO _held_at, _held_until
    FROM public.dispute_settlement_claims WHERE job_id = _job_id;

  IF _held_action = _action THEN
    RETURN jsonb_build_object('verdict', 'joined', 'claimed_at', _held_at, 'expires_at', _held_until);
  END IF;

  RETURN jsonb_build_object('verdict', 'held_by_' || COALESCE(_held_action, 'unknown'),
                            'claimed_at', _held_at, 'expires_at', _held_until);
END;
$function$;

-- Release by TOKEN. A caller with no token (the re-entrant same-action case)
-- releases nothing, which is the whole point: it never owned the claim.
CREATE OR REPLACE FUNCTION public.release_dispute_settlement_claim(
  _job_id uuid,
  _token uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _deleted int;
BEGIN
  IF _token IS NULL THEN
    RETURN false;
  END IF;
  DELETE FROM public.dispute_settlement_claims
   WHERE job_id = _job_id AND token = _token;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END;
$function$;

-- Stamp the claim at the holder's money step (round 3, M2). Called by the
-- holder immediately BEFORE its first money-moving call, by TOKEN, and the
-- holder must not make that call unless this returned true: a false means the
-- claim is gone (expired and taken, or cleared) and the holder no longer owns
-- the escrow. COALESCE so a second leg (a split's refund after its transfer)
-- keeps the first stamp. Only a stamped claim sticks on expiry.
CREATE OR REPLACE FUNCTION public.stamp_dispute_settlement_claim(
  _job_id uuid,
  _token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _stamped int;
BEGIN
  IF _token IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.dispute_settlement_claims
     SET money_step_at = COALESCE(money_step_at, now())
   WHERE job_id = _job_id AND token = _token;
  GET DIAGNOSTICS _stamped = ROW_COUNT;
  RETURN _stamped > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.stamp_dispute_settlement_claim(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_dispute_settlement_claim(uuid, uuid) TO service_role;

-- The single-argument first draft, dropped rather than left beside its
-- replacement: it deleted by job_id alone, so anything still calling it would
-- reintroduce exactly the defect the token exists to close.
DROP FUNCTION IF EXISTS public.release_dispute_settlement_claim(uuid);

-- FROM PUBLIC, anon: `FROM PUBLIC` alone leaves anon's own explicit grant in
-- pg_proc.proacl (CLAUDE.md). `authenticated` named too — these decide who
-- keeps an escrow, and no browser session may reach them.
REVOKE ALL ON FUNCTION public.claim_dispute_settlement(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_dispute_settlement_claim(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dispute_settlement(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_dispute_settlement_claim(uuid, uuid) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2b. Stale claims page. A claim is a lock, and a lock nobody watches is a
--    mystery the first time it wedges.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Every holder releases its claim by token on every exit it controls
-- (create-payment, execute-dispute-split, auto-resolve-disputes). A row older
-- than the TTL therefore means a holder that did NOT get to exit: an
-- edge-runtime kill, a redeploy mid-request, a release RPC that failed. When
-- the job is still `disputed` that is the dangerous shape — the Stripe step may
-- have run and the flip may not have — and the ledger columns in the page say
-- which way, if any, the escrow already went.
--
-- Same shape as the cron watchers (20260914183932 sweep_dead_crons,
-- check_ops_digest_delivery): an error_logs row that the digest can see, plus
-- ONE critical post to slack-ops-alert. The error_logs source is not in
-- notify_slack_on_error_log's critical list on purpose, exactly like the
-- cron-* sources — this function posts its own page, and a row that also
-- posted through the trigger would page twice.
--
-- Severity by what is at stake, not by what is noisy:
--   * job still `disputed`, real job           -> critical page
--   * job no longer disputed (settled, released claim just failed to delete),
--     or an is_seed fixture                    -> error_logs warning only,
--                                                 summarised by the digest.
-- Deduped per claim TOKEN, so one wedged claim pages once, not every tick, and
-- a claim reported by the monitor is not reported again when its expiry
-- deletes it.
-- The six-argument first draft (no stamp) never reached prod; dropped so a
-- database that applied an earlier draft of this file does not keep it beside
-- its replacement.
DROP FUNCTION IF EXISTS public.report_stale_dispute_settlement_claim(uuid, text, uuid, timestamptz, uuid, text);

CREATE OR REPLACE FUNCTION public.report_stale_dispute_settlement_claim(
  _job_id        uuid,
  _action        text,
  _claimed_by    uuid,
  _claimed_at    timestamptz,
  _token         uuid,
  _found_by      text,
  _money_step_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _job_status     text;
  _payment_status text;
  _is_seed        boolean;
  _transfers      int;
  _refunds        int;
  _pages          boolean;
  _live           boolean;
  _message        text;
BEGIN
  -- FOR SHARE on the job FIRST, then the per-token advisory lock: the same
  -- order claim_dispute_settlement takes them in (its job FOR UPDATE, then this
  -- function), so the monitor and a claim's expiry cannot deadlock on one
  -- token (lh-authz-rls round 2, LOW). The advisory lock serialises the two
  -- reporters so the dedupe below is not a read-then-write race that pages
  -- twice.
  SELECT status::text, payment_status, COALESCE(is_seed, false)
    INTO _job_status, _payment_status, _is_seed
    FROM public.jobs WHERE id = _job_id
     FOR SHARE;

  PERFORM pg_advisory_xact_lock(hashtext('dispute-claim-stale:' || _token::text));

  -- Deduped on SERVER rows only. error_logs accepts client inserts
  -- (anyone_can_insert_errors), and stamp_error_log_origin marks those
  -- origin=client; without this predicate a client that knew a token could
  -- pre-write a row and suppress the page.
  IF EXISTS (
    SELECT 1 FROM public.error_logs e
     WHERE jsonb_typeof(e.tags) = 'object'
       AND e.tags ->> 'source' = 'dispute-claim-stale'
       AND e.tags ->> 'token' = _token::text
       AND e.tags ->> 'origin' = 'server'
  ) THEN
    RETURN false;
  END IF;


  -- What the ledgers say already moved. The page is useless without it: the
  -- one question the person woken up has to answer is "did this escrow leave,
  -- and which way".
  SELECT count(*) INTO _transfers FROM public.payout_transfers
   WHERE job_id = _job_id AND status IN ('pending', 'paid');
  -- payment_refunds has no status column: a row is written only after Stripe
  -- returned the refund, so every row counts.
  SELECT count(*) INTO _refunds FROM public.payment_refunds
   WHERE job_id = _job_id;

  -- "Still being settled": disputed, or a decided split whose money has not
  -- executed (rpc_decide_dispute moves jobs.status off 'disputed').
  _live := _job_status = 'disputed' OR EXISTS (
    SELECT 1 FROM public.disputes d
     WHERE d.job_id = _job_id AND d.status = 'decided'
       AND d.execution_status IS DISTINCT FROM 'executed');
  -- Page whenever money COULD be half-moved: the holder STAMPED its money step
  -- (round 3, M2) and the job is still being settled, or its escrow still
  -- reads held. A holder that died and was followed by a withdrawal (job back
  -- to in_progress/escrow) is the second case — the first draft called that
  -- "a leftover lock" and deleted the evidence (both reviews, round 2). Only a
  -- job whose payment already reads terminal is a leftover, and only a seed
  -- fixture is never paged.
  --
  -- An UNSTAMPED holder never reached a money-moving call (every holder stamps
  -- by token immediately before one, and makes no call if the stamp failed),
  -- so nothing can be half-moved: a warning row for the digest, never a
  -- critical page. That covers every sweep (it has no Stripe step and never
  -- stamps) and a failed release RPC on an exit that moved nothing.
  _pages := NOT COALESCE(_is_seed, false)
            AND _money_step_at IS NOT NULL
            AND (_live OR COALESCE(_payment_status, '') IN ('escrow', 'payout_pending', 'cancelling'));

  _message := format(
    'Dispute settlement claim on job %s (action %s, claimed %s by %s) is older than its %s TTL and was never released. Job is %s/%s; ledger: %s payout transfer(s), %s refund(s). %s',
    _job_id, _action, _claimed_at, COALESCE(_claimed_by::text, 'the platform'),
    public.dispute_settlement_claim_ttl(),
    COALESCE(_job_status, 'MISSING'), COALESCE(_payment_status, 'NULL'),
    _transfers, _refunds,
    CASE
      WHEN _money_step_at IS NULL
        THEN 'Its holder never reached a money step (no Stripe call was made under this claim), so nothing moved; the lock is released by the next settlement attempt or the next monitor tick.'
      WHEN _live AND (_transfers > 0 OR _refunds > 0)
        THEN 'Its holder died after its money step, and money has ALREADY moved on a job still under dispute: reconcile against Stripe before anyone retries.'
      WHEN _live OR COALESCE(_payment_status, '') IN ('escrow', 'payout_pending', 'cancelling')
        THEN 'Its holder died after its money step with no ledger row: a Stripe call may have left without its ledger write, so check Stripe for this job before retrying.'
      ELSE 'The job''s payment has settled, so this is a leftover lock rather than money at risk.'
    END)
    || CASE
         WHEN _action = 'split' AND _money_step_at IS NOT NULL THEN format(
           ' Quick Release, Quick Refund and the sweep are refused until the lock is cleared. A Retry settlement of this split takes the lock over and resumes its own legs, but do not Retry settlement until the ledger matches Stripe. To release the lock instead: DELETE FROM public.dispute_settlement_claims WHERE job_id = %L AND token = %L;',
           _job_id, _token)
         WHEN _action <> 'sweep' AND _money_step_at IS NOT NULL THEN format(
           ' Every settlement of this job is refused until the lock is cleared. Do not Retry settlement until the ledger matches Stripe. After reconciling Stripe, clear it with: DELETE FROM public.dispute_settlement_claims WHERE job_id = %L AND token = %L;',
           _job_id, _token)
         ELSE '' END;

  INSERT INTO public.error_logs (severity, message, tags, context)
  VALUES (
    CASE WHEN _pages THEN 'error' ELSE 'warning' END,
    _message,
    jsonb_build_object('source', 'dispute-claim-stale', 'area', 'money', 'origin', 'server',
                       'job', _job_id, 'token', _token, 'action', _action),
    jsonb_build_object('claimed_at', _claimed_at, 'claimed_by', _claimed_by,
                       'job_status', _job_status, 'payment_status', _payment_status,
                       'is_seed', _is_seed, 'payout_transfers', _transfers,
                       'payment_refunds', _refunds, 'found_by', _found_by,
                       'money_step_at', _money_step_at, 'pages', _pages));

  IF _pages THEN
    BEGIN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/slack-ops-alert',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
          'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'title', 'Dispute settlement lock wedged — money may be half-moved',
          'message', _message,
          'kind', 'money_at_risk',
          'severity', 'critical'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.report_stale_dispute_settlement_claim(uuid, text, uuid, timestamptz, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_stale_dispute_settlement_claim(uuid, text, uuid, timestamptz, uuid, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.check_stale_dispute_settlement_claims()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r          record;
  _stale     int := 0;
  _reported  int := 0;
  _cleared   int := 0;
  _deleted   int;
  _job_status text;
  _job_payment text;
BEGIN
  FOR r IN
    SELECT c.job_id, c.action, c.claimed_by, c.claimed_at, c.token, c.money_step_at
      FROM public.dispute_settlement_claims c
     WHERE c.claimed_at < now() - public.dispute_settlement_claim_ttl()
     ORDER BY c.claimed_at
  LOOP
    _stale := _stale + 1;
    IF public.report_stale_dispute_settlement_claim(
         r.job_id, r.action, r.claimed_by, r.claimed_at, r.token, 'monitor', r.money_step_at) THEN
      _reported := _reported + 1;
    END IF;
    -- A leftover on a job that is no longer being settled is a finished lock:
    -- nothing can claim that job (claim_dispute_settlement answers
    -- not_disputed before it reaches its own expiry), so without this the row
    -- is rescanned every tick forever, and the day a re-freeze makes the job
    -- claimable again its already-reported token would be expired silently.
    -- Reported above first; only then removed, by token.
    -- FOR SHARE: a re-freeze flipping the job back to disputed must land
    -- before this decision or after the DELETE, never between.
    _job_status := NULL;
    SELECT j.status::text, j.payment_status INTO _job_status, _job_payment
      FROM public.jobs j WHERE j.id = r.job_id FOR SHARE;
    -- Cleared when nothing says money could still be half-moved: the holder
    -- never STAMPED its money step (round 3, M2 — it made no money-moving
    -- call, and a live-but-slow holder that later tries to stamp finds its
    -- row gone and refuses), or the job is not being settled AND its payment
    -- already reads terminal (or the job is gone). A stamped claim on a held
    -- escrow keeps the row, and the page, until a person clears it.
    --
    -- The unstamped DELETE carries `money_step_at IS NULL` itself: the loop
    -- read the row unlocked, and a holder stamping between that read and this
    -- statement must keep its claim (round-4 review).
    IF COALESCE(_job_status, '') <> 'disputed'
       AND COALESCE(_job_payment, '') NOT IN ('escrow', 'payout_pending', 'cancelling')
       AND NOT EXISTS (SELECT 1 FROM public.disputes d
                        WHERE d.job_id = r.job_id AND d.status = 'decided'
                          AND d.execution_status IS DISTINCT FROM 'executed') THEN
      DELETE FROM public.dispute_settlement_claims WHERE job_id = r.job_id AND token = r.token;
      GET DIAGNOSTICS _deleted = ROW_COUNT;
      _cleared := _cleared + _deleted;
    ELSIF r.money_step_at IS NULL THEN
      DELETE FROM public.dispute_settlement_claims
       WHERE job_id = r.job_id AND token = r.token AND money_step_at IS NULL;
      GET DIAGNOSTICS _deleted = ROW_COUNT;
      _cleared := _cleared + _deleted;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('stale', _stale, 'reported', _reported, 'cleared', _cleared);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_stale_dispute_settlement_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_stale_dispute_settlement_claims() TO service_role;

-- The dedupe lookup, indexed: error_logs is the busiest table the monitor
-- touches, and an unindexed jsonb EXISTS every 15 minutes is IO the free tier
-- does not have (20260914174329). Partial, so it holds only these rows.
CREATE INDEX IF NOT EXISTS error_logs_dispute_claim_stale_token_idx
  ON public.error_logs ((tags ->> 'token'))
  WHERE tags ->> 'source' = 'dispute-claim-stale';

-- Every 15 minutes, on minutes no other 15-minute sweep uses
-- (20260914174329 took :01 :02 :04 :08 :12 and their +15s). The TTL is ten
-- minutes, so a wedged claim pages within 25. Replay-safe: unschedule, then
-- schedule.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping check-stale-dispute-claims';
    RETURN;
  END IF;
  PERFORM cron.unschedule('check-stale-dispute-claims')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-stale-dispute-claims');
  PERFORM cron.schedule('check-stale-dispute-claims', '14,29,44,59 * * * *',
    $cron$SELECT public.check_stale_dispute_settlement_claims();$cron$);
END;
$$;

-- The watcher is itself watched (sweep_dead_crons), or a stopped monitor is
-- exactly as silent as no monitor.
DO $$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.cron_work_expectations (jobname, expected_max_gap)
  VALUES ('check-stale-dispute-claims', interval '1 hour')
  ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. open_dispute_as — a filing may not race a job state change, and a double
--    submit may not store its evidence twice.
-- ═══════════════════════════════════════════════════════════════════════════
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
  SELECT customer_id, helper_id, title, status::text, payment_status
    INTO _customer, _helper, _title, _status, _payment_status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- The platform is not a party to the job, so there is no membership to
  -- check on that branch. Every human caller still is.
  IF NOT _system AND _uid <> _customer AND _uid <> _helper THEN
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
$function$;

-- Restated, not relied on: the only REVOKE for this SECURITY DEFINER function
-- lives in 20260912023326's guarded DO block, which skips itself on a rebuild
-- missing its prerequisites. This function trusts `_opener_id` (NULL = a
-- system filing with no membership check), so a default EXECUTE for anon /
-- authenticated would let any client freeze any job's escrow (lh-authz-rls
-- round 2, LOW). CREATE OR REPLACE keeps prod's existing ACL either way.
REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. rpc_withdraw_dispute — not while a settlement claim exists (round 3, H1).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A withdrawal restores the job to in_progress/completed with the escrow still
-- held. Under a live or dead Quick Release / Quick Refund / split claim that
-- handed the escrow straight to every path that reads only its ledger
-- (release-payout, void-cancelled-payments after a poster_cancel_job,
-- cancel_escrow, admin_refund_general) while the holder's Stripe call was in
-- flight or had already gone out with no ledger row. Those paths now also ask
-- `_shared/unsettledDispute.ts`, which refuses on a claim row; this closes the
-- door at the withdrawal itself, so the job never leaves `disputed` under a
-- holder in the first place.
--
-- Body: the LIVE prod definition (pg_get_functiondef 2026-09-14, identical to
-- 20260908024937) with only the claim check added. Lock order unchanged —
-- disputes FOR UPDATE, then jobs FOR UPDATE — and the claim is read AFTER the
-- jobs lock: claim_dispute_settlement takes that same jobs lock before it
-- inserts, so a claim either committed first (visible here, refused) or waits
-- behind this withdrawal and then finds the job no longer disputed.
--
-- An EXPIRED claim that never stamped its money step does not block (round
-- 4): a sweep has no money step (its only write is the flip, which either
-- committed — and then the job would not be disputed — or did not), and any
-- other unstamped holder died before its Stripe call. Blocking on one would
-- lock a party out of their own dispute until a later claim or monitor tick
-- cleared it.
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
  _restored text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- The status this job held before the dispute froze it. See the header for
  -- why it is derived rather than read, and why only two values are reachable.
  -- Lock order jobs -> disputes (lh-authz-rls review of the rebase): the same
  -- order as open_dispute_as and claim_dispute_settlement, so no pairing of
  -- dispute RPCs can deadlock. The live body took disputes first.
  SELECT CASE
           WHEN j.poster_completed_at IS NOT NULL
             OR j.payout_scheduled_at IS NOT NULL
             OR COALESCE(j.payment_status, '') IN ('payout_pending', 'released')
           THEN 'completed'
           ELSE 'in_progress'
         END
    INTO _restored
    FROM public.jobs j
   WHERE j.id = _job_id
     FOR UPDATE;

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

  -- 20260915034822 (round 3, H1): not while this escrow is being settled.
  -- An EXPIRED claim that never stamped a money step (any sweep, or a holder
  -- that died before its Stripe call) moved nothing and does not block.
  IF EXISTS (
    SELECT 1 FROM public.dispute_settlement_claims c
     WHERE c.job_id = _job_id
       AND NOT (c.claimed_at < now() - public.dispute_settlement_claim_ttl()
                AND (c.action = 'sweep' OR c.money_step_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'dispute_settlement_in_progress'
      USING HINT = 'An admin is settling this dispute''s payment right now, so it can''t be withdrawn. Refresh in a few minutes.';
  END IF;

  UPDATE public.disputes
     SET status = 'withdrawn',
         decided_at = now()
   WHERE id = _dispute_id;

  -- Transaction-local, and set only here — after the opener check above.
  -- enforce_helper_jobs_column_whitelist reads it to let THIS statement stamp
  -- jobs.dispute_resolved_at when the opener is the assigned helper.
  PERFORM set_config('app.dispute_withdraw_rpc', '1', true);

  UPDATE public.jobs
     SET status = _restored::job_status,
         dispute_status = 'resolved',
         dispute_resolved_at = now()
   WHERE id = _job_id;

  -- Closed immediately rather than left to the end of the transaction: the
  -- flag must not still be open for whatever the caller does next in the same
  -- statement batch.
  PERFORM set_config('app.dispute_withdraw_rpc', '0', true);
END;
$function$;

-- Restated with the roles named, matching 20260908024937 and the live proacl.
REVOKE ALL ON FUNCTION public.rpc_withdraw_dispute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_dispute(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. rpc_supersede_dispute_decision — the exit for a decision that can never
--    execute (round 3, M1; restructured round 5).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- With this migration a decided, unexecuted dispute blocks every other money
-- path (claim `split_pending`, `_shared/unsettledDispute.ts`, the re-file
-- guard in open_dispute_as). That is right while the split CAN run. When it
-- cannot — the Helpr deleted their account, never onboarded to Stripe Connect,
-- or is restricted — the escrow had no exit but hand-written SQL.
--
-- Superseding RETIRES the ruled row as 'superseded' (decision and execution
-- record kept, so the row is its own history) and opens a NEW dispute row for
-- a new decision. A new row, not the old one re-opened in place (round-4
-- reviews): the new dispute has its own id, so any Stripe leg the old decision
-- stamped with `metadata.dispute_id` counts as FOREIGN to a later split
-- (execute-dispute-split 6c), its `dispute-split-*` idempotency keys cannot
-- collide with the old ones, and — opened by the platform (opener_id NULL) —
-- the original opener cannot withdraw a dispute an admin has already ruled on.
-- The job goes back to `disputed` with dispute_status 'escalated', which keeps
-- the 72h sweep from paying it out (auto-resolve-disputes skips and reminds)
-- and leaves the admin every normal tool: decide again (a 0/100 split needs no
-- Connect account), Quick Refund, or Quick Release.
--
-- REFUSED whenever money may already have moved, or may be moving: an
-- executed decision, a stamped leg id, a live or reversed payout_transfers
-- row, any payment_refunds row, a restored gift, a split `executing` inside
-- the claim TTL, a claim that is live or STAMPED at its money step (an expired
-- unstamped claim moved nothing), or an admin who is a party to the job.
--
-- Admin-only inside the function (auth.uid() + has_role), EXECUTE for
-- authenticated only — REVOKE'd FROM PUBLIC, anon. A service-role call has no
-- auth.uid() and is refused.
--
-- Lock order: disputes FOR UPDATE, then jobs FOR UPDATE — the same order as
-- rpc_decide_dispute and rpc_withdraw_dispute.

-- 'superseded' joins the dispute status vocabulary. Dropped and re-added
-- (Postgres cannot edit a CHECK in place), with every prior value kept.
ALTER TABLE public.disputes DROP CONSTRAINT IF EXISTS disputes_status_check;
ALTER TABLE public.disputes
  ADD CONSTRAINT disputes_status_check
  CHECK (status = ANY (ARRAY['open'::text, 'decided'::text, 'withdrawn'::text, 'superseded'::text]));

-- The first draft re-opened the row in place and returned void; it never
-- reached prod. Dropped so a database that applied it can take the new return
-- type (CREATE OR REPLACE cannot change one).
DROP FUNCTION IF EXISTS public.rpc_supersede_dispute_decision(uuid, text);

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
  IF _d.status <> 'decided' OR _d.execution_status = 'executed' THEN
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
      'An admin is taking another look at the dispute on "' || COALESCE(_title, 'a job') ||
        '". The payment stays on hold until a new decision is made.',
      'info', '/my-posts?job=' || _d.job_id::text);
  END IF;
  IF _helper IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (_helper, 'Dispute re-opened',
      'An admin is taking another look at the dispute on "' || COALESCE(_title, 'a job') ||
        '". The payment stays on hold until a new decision is made.',
      'info', '/my-jobs?job=' || _d.job_id::text);
  END IF;

  RETURN _new_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_supersede_dispute_decision(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_supersede_dispute_decision(uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. rpc_decide_dispute — not under a settlement claim, not by a party
--    (round-4 review, LOW).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Body: the LIVE prod definition (pg_get_functiondef 2026-09-14, identical to
-- 20260907194838) with two additions after the job read, which now takes the
-- job FOR UPDATE: the admin must not be a party to the job, and no settlement
-- claim may be live or stamped. Grants restated to match the live proacl
-- ({postgres, authenticated, service_role}).
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
  -- no longer disputed). Lock order disputes -> jobs, as before.
  SELECT customer_id, helper_id, title
    INTO _customer_id, _helper_id, _job_title
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;

  SELECT status INTO _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF _existing_status <> 'open' THEN
    RAISE EXCEPTION 'dispute already %', _existing_status;
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

REVOKE ALL ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. rpc_add_dispute_evidence — evidence on a dispute an admin re-opened
--    (round-5 review, LOW-1).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The only evidence write on `disputes` is the opener's own UPDATE (RLS:
-- auth.uid() = opener_id AND status = 'open'). A dispute re-opened by
-- rpc_supersede_dispute_decision has opener_id NULL, so NEITHER party could
-- add evidence to the new decision the admin is about to make.
--
-- This function is that channel and nothing wider: only a dispute with NO
-- opener (platform/admin re-opened), only while it is open, only a party to
-- the job, and only URLs that point at the caller's OWN uploads for THIS job
-- in the proof-photos bucket (`<uid>/disputes/<job>/…`, the path the dialog
-- and the storage INSERT policy already use) — never someone else's file or an
-- external link in the admin's queue. A party-filed dispute keeps its
-- opener-only rule. Appends set-like (a double submit stores nothing twice)
-- and mirrors onto jobs.dispute_evidence_urls, as open_dispute_as does.
--
-- Lock order: disputes FOR UPDATE, then jobs FOR UPDATE, like every other
-- dispute RPC. Returns the dispute's evidence after the append.
CREATE OR REPLACE FUNCTION public.rpc_add_dispute_evidence(_dispute_id uuid, _evidence_urls text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d record;
  _customer uuid;
  _helper uuid;
  _url text;
  _merged text[];
  _job_id_lookup uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _evidence_urls IS NULL OR cardinality(_evidence_urls) = 0 OR cardinality(_evidence_urls) > 10 THEN
    RAISE EXCEPTION 'dispute_evidence_empty'
      USING HINT = 'Attach between one and ten photos.';
  END IF;

  -- Lock order jobs -> disputes, like every other dispute RPC.
  SELECT job_id INTO _job_id_lookup FROM public.disputes WHERE id = _dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  SELECT customer_id, helper_id INTO _customer, _helper
    FROM public.jobs WHERE id = _job_id_lookup FOR UPDATE;

  SELECT id, job_id, opener_id, status, reason, evidence_urls INTO _d
    FROM public.disputes WHERE id = _dispute_id FOR UPDATE;
  IF _uid IS DISTINCT FROM _customer AND _uid IS DISTINCT FROM _helper THEN
    RAISE EXCEPTION 'not authorized for this job' USING ERRCODE = '42501';
  END IF;

  -- An admin re-open, specifically: no opener AND the reason
  -- rpc_supersede_dispute_decision writes. A NULL opener alone also describes a
  -- party-filed dispute whose opener deleted their account (deletion
  -- anonymises opener_id), and that one keeps its opener-only rule
  -- (round-5 review, LOW-2). The client keys its label on the same prefix
  -- (src/components/disputeEvidenceChannel.ts, REOPENED_REASON_PREFIX).
  IF _d.status <> 'open'
     OR _d.opener_id IS NOT NULL
     OR position('Re-opened by an admin after the earlier decision could not be carried out:' IN COALESCE(_d.reason, '')) <> 1 THEN
    RAISE EXCEPTION 'dispute_evidence_not_allowed'
      USING HINT = 'Evidence here is only for a dispute an admin re-opened, while it is open.';
  END IF;

  -- One validator for every evidence writer (dispute_evidence_url_ok, section
  -- 8): this project's host, a SIGNED proof-photos object URL whose path is the
  -- caller's own upload for this job, no `..`.
  FOREACH _url IN ARRAY _evidence_urls LOOP
    IF NOT public.dispute_evidence_url_ok(_url, _uid, _d.job_id) THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url'
        USING HINT = 'Only photos you uploaded to this dispute can be attached.';
    END IF;
  END LOOP;

  -- A cap on the dispute's evidence as a whole, not only per call: ten at a
  -- time, fifty in all.
  IF (SELECT count(DISTINCT u) FROM unnest(COALESCE(_d.evidence_urls, '{}'::text[]) || _evidence_urls) AS t(u)) > 50 THEN
    RAISE EXCEPTION 'dispute_evidence_limit'
      USING HINT = 'This dispute already holds as much evidence as it can take.';
  END IF;

  UPDATE public.disputes
     SET evidence_urls = (
           SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
             FROM (SELECT u, min(ord) AS ord
                     FROM unnest(evidence_urls || _evidence_urls) WITH ORDINALITY AS t(u, ord)
                    GROUP BY u) x)
   WHERE id = _d.id
  RETURNING evidence_urls INTO _merged;

  UPDATE public.jobs
     SET dispute_evidence_urls = (
           SELECT COALESCE(array_agg(u ORDER BY ord), '{}'::text[])
             FROM (SELECT u, min(ord) AS ord
                     FROM unnest(COALESCE(dispute_evidence_urls, '{}'::text[]) || _evidence_urls) WITH ORDINALITY AS t(u, ord)
                    GROUP BY u) x)
   WHERE id = _d.job_id;

  RETURN _merged;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_add_dispute_evidence(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_add_dispute_evidence(uuid, text[]) TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Dispute evidence: one validator, and append-only for parties
--    (lh-authz-rls review of the dispute-races rebase, MEDIUM + LOW-1).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Evidence reached `disputes.evidence_urls` through three writers, and only
-- rpc_add_dispute_evidence checked what it was given: open_dispute_as (new
-- filing and re-file branch, reached through rpc_open_dispute by either party)
-- stored any string, and the opener's own UPDATE (RLS "disputes opener update
-- while open") could replace or empty the whole array. Probed on prod as both
-- parties: `javascript:` and attacker-host URLs were stored and then rendered as
-- <a href>/<img src> in the admin console and the other party's dialog.
--
-- dispute_evidence_url_ok is the one definition: THIS project's host, a SIGNED
-- proof-photos object URL (the bucket is private; `public` URLs never load),
-- whose path is the uploader's own `<uid>/disputes/<job>/<file>` (the path the
-- storage INSERT policy already forces), no `..`. open_dispute_as and
-- rpc_add_dispute_evidence call it, and a BEFORE UPDATE trigger holds every
-- party write to it and to append-only. Admins (curation) and service-role
-- writers (no JWT) are not constrained. Existing rows are untouched: only
-- elements a write ADDS are checked.
CREATE OR REPLACE FUNCTION public.dispute_evidence_url_ok(_url text, _uploader uuid, _job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _url IS NOT NULL
     AND _uploader IS NOT NULL
     AND _job_id IS NOT NULL
     AND length(_url) <= 2048
     AND position('..' IN _url) = 0
     AND _url ~ ('^https://fncmgoasalhdgfwzhsqa\.supabase\.co/storage/v1/object/sign/proof-photos/'
                 || _uploader::text || '/disputes/' || _job_id::text || '/[^/?#]+([?][^#]*)?$')
$function$;

REVOKE ALL ON FUNCTION public.dispute_evidence_url_ok(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispute_evidence_url_ok(text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_dispute_evidence_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _added text;
BEGIN
  -- Service role / cron / edge functions (no JWT) and admins are not parties.
  IF _uid IS NULL OR public.has_role(_uid, 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.evidence_urls IS NOT DISTINCT FROM OLD.evidence_urls THEN
    RETURN NEW;
  END IF;
  -- Nothing already submitted may be removed or replaced by a party.
  IF NOT (COALESCE(NEW.evidence_urls, '{}'::text[]) @> COALESCE(OLD.evidence_urls, '{}'::text[])) THEN
    RAISE EXCEPTION 'dispute_evidence_append_only' USING ERRCODE = '42501';
  END IF;
  -- And anything added is the caller's own signed upload for this job.
  FOR _added IN
    SELECT u FROM unnest(COALESCE(NEW.evidence_urls, '{}'::text[])) AS n(u)
    EXCEPT
    SELECT u FROM unnest(COALESCE(OLD.evidence_urls, '{}'::text[])) AS o(u)
  LOOP
    IF NOT public.dispute_evidence_url_ok(_added, _uid, NEW.job_id) THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_dispute_evidence_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dispute_evidence_append_only ON public.disputes;
CREATE TRIGGER trg_dispute_evidence_append_only
  BEFORE UPDATE OF evidence_urls ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dispute_evidence_append_only();
