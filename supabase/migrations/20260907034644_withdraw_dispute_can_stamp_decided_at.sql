-- "Resolve & Pay" has never worked. Two guards, both correct on their own,
-- refuse the one sanctioned exit a dispute has.
--
-- `rpc_withdraw_dispute` (20260825190000) closes the dispute with:
--
--     UPDATE public.disputes SET status = 'withdrawn', decided_at = now() ...
--
-- `enforce_dispute_opener_column_whitelist` (20260901032007) pins every column
-- but `evidence_urls`, and `decided_at` is on that pinned list. The RPC is
-- SECURITY DEFINER but `auth.uid()` inside it is still the CALLER, so the
-- trigger sees a non-null, non-admin uid, sees decided_at move NULL -> now(),
-- and raises `only the evidence on a dispute may be changed` (42501) before it
-- ever reaches the status carve-out a few lines below.
--
-- REPRODUCED in PGlite on 2026-09-06 with all three bodies copied verbatim from
-- production (`pg_get_functiondef`):
--
--   poster withdraws their OWN dispute -> "only the evidence on a dispute may be changed"
--   helper withdraws their OWN dispute -> "only the evidence on a dispute may be changed"
--   poster withdraws HELPER's dispute  -> "only the party who opened this dispute may withdraw it"
--
-- So the function is dead for every caller. The poster's "Resolve & Pay" chip
-- — the control that closes a dispute and releases escrow to the Helpr —
-- returns early on the error and toasts "We couldn't mark that resolved". The
-- only remaining way out of a dispute is escalation or the 72-hour timeout.
--
-- THE SAME MIGRATION THAT BROKE IT ALMOST CAUGHT IT. Its own comment records:
--
--   "a blanket pin on `status` would have made this trigger block the one
--    self-service escape hatch the flow has — caught by the PGlite suite
--    before this shipped"
--
-- The suite drove `status` and stopped. `decided_at` is set by the same
-- statement and was never exercised, so the carve-out landed one column short.
-- This is the 2026-09-05 family exactly: a complete feature, a correct RPC, a
-- correct guard, and one missing entry in a list in another file — invisible to
-- a code read, a typecheck and every test, because you have to run the
-- statement through the trigger to see it.
--
-- THE FIX. Widen the carve-out to cover the whole of that one statement, and
-- nothing else. `decided_at` may move only when this update IS the opener's
-- sanctioned withdrawal:
--
--   * the dispute is going open -> withdrawn (the existing carve-out), AND
--   * the caller is the opener, AND
--   * `decided_at` was NULL (a stamp, never a rewrite).
--
-- `decided_by`, `decision_text`, `payout_split` and the whole execution ledger
-- stay pinned in every case — `rpc_withdraw_dispute` does not write them, and
-- forging them is the denial-of-service the original trigger exists to stop.
-- The carve-out is deliberately NARROWER than the status rule beside it: the
-- status rule permits open -> withdrawn without asking who is doing it (RLS's
-- "disputes opener update" policy is what constrains that today); this one asks.
--
-- Body is otherwise VERBATIM from the live production definition read
-- 2026-09-06, not rebuilt from 20260901032007.
--
-- Replay-safe: CREATE OR REPLACE + DROP-then-CREATE TRIGGER. No data change.

CREATE OR REPLACE FUNCTION public.enforce_dispute_opener_column_whitelist()
RETURNS TRIGGER
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
  -- Service role / cron / edge functions run with no JWT: not a user write.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins resolve disputes; that is the whole point of the admin policy.
  IF public.has_role(_uid, 'admin') THEN
    RETURN NEW;
  END IF;

  _self_withdrawal :=
        OLD.status = 'open'
    AND NEW.status = 'withdrawn'
    AND _uid = OLD.opener_id
    AND OLD.decided_at IS NULL;

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

COMMENT ON FUNCTION public.enforce_dispute_opener_column_whitelist() IS
  'RLS is column-blind, so the opener''s UPDATE policy allowed rewriting any '
  'column of their own dispute — including execution_status, which '
  'execute-dispute-split treats as terminal. This restricts a party to '
  'evidence_urls, plus the decided_at stamp that rpc_withdraw_dispute writes '
  'in the same statement as the open -> withdrawn flip. Pinning decided_at '
  'unconditionally made that RPC fail for every caller from 20260901032007 '
  'until 20260907034644.';

DROP TRIGGER IF EXISTS trg_enforce_dispute_opener_column_whitelist ON public.disputes;
CREATE TRIGGER trg_enforce_dispute_opener_column_whitelist
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_dispute_opener_column_whitelist();
