-- Dispute filing integrity: nobody was told, a re-file didn't re-freeze the
-- escrow, two disputes could open at once, and either party could rewrite the
-- settlement state of their own dispute.
--
-- Four defects, all found walking the flow end to end on 2026-08-31. Each is
-- silent — nothing errors, nothing logs, and every screen keeps saying the
-- reassuring thing.
--
-- 1. FILING A DISPUTE NOTIFIES NOBODY.
--    `rpc_open_dispute` emits zero `notifications` rows (compare
--    `rpc_decide_dispute`, which emits two). The client compensated in
--    DisputeDialog.tsx by reading `user_roles` for every admin and bulk-
--    inserting notifications. BOTH halves are refused by RLS, and both
--    refusals are silent. Verified against production with an ordinary
--    authenticated account:
--      - `user_roles?role=eq.admin` → 200, ZERO rows (no SELECT policy), so
--        the `if (adminRoles?.length)` guard skipped the insert entirely and
--        even the error path never ran;
--      - a direct `notifications` insert for another user → 403 / 42501. The
--        two user-facing INSERT policies were dropped in 20260403180249 and
--        20260412180149 and never recreated.
--    So no admin has ever received an in-app notification for a filed
--    dispute. Worse, neither has the ACCUSED PARTY: the only signal reaching
--    them was the '⚠ Dispute opened' chat system message (20260720130000),
--    which is inserted `FROM messages WHERE job_id = … AND is_system = false`
--    — if the two never exchanged a message, that inserts zero rows and the
--    person whose money just froze is told nothing at all.
--    Notifying is the server's job and only the server can do it: this
--    function is SECURITY DEFINER and already holds both party ids. Routing
--    through `create-notification` cannot work either — it allows self, admin,
--    or a shared-job counterparty, and a filer shares no job with an admin.
--
-- 2. A RE-FILE IS A SILENT NO-OP THAT LEAVES ESCROW UNFROZEN.
--    The existing-dispute branch short-circuits on ANY row with
--    `status = 'open'`, with no reference to the job's own state, and
--    RETURNs without touching `jobs.status`. `auto-resolve-disputes` leaves
--    exactly that shape behind: it writes `jobs.dispute_status =
--    'auto_resolved'` and flips the job to `completed` / `payout_pending`
--    while the `disputes` row stays `open` forever (it never writes that
--    table). `completed -> disputed` is a legal transition, so a poster
--    re-disputing inside the 24h payout hold lands here: evidence is
--    appended, the function returns an id, the dialog reports success — and
--    the job is still `completed`, so `release-payout` pays out. The poster
--    is told the payment is held. It is not.
--
-- 3. TWO DISPUTES CAN OPEN ON ONE JOB.
--    The original `rpc_open_dispute` took `SELECT … FROM public.jobs WHERE
--    id = _job_id FOR UPDATE` (20260609140000:135). The rewrite in
--    20260825190000 dropped the lock, and there is no unique constraint
--    behind it. Poster and helper filing simultaneously each miss the
--    other's row and both insert. `rpc_withdraw_dispute` then closes only one
--    (ORDER BY created_at DESC LIMIT 1) and sets the job back to
--    'in_progress' — escrow returns to the normal release path with a second
--    live dispute still open.
--
-- 4. EITHER PARTY CAN REWRITE THEIR OWN DISPUTE'S SETTLEMENT STATE.
--    `GRANT SELECT, INSERT, UPDATE, DELETE ON public.disputes TO
--    authenticated` (20260824230000:108) with the only gate being
--    `USING (auth.uid() = opener_id AND status = 'open')`. RLS is
--    COLUMN-BLIND, there are no triggers on the table, and the
--    "column-level constraint enforced inside rpc_add_evidence" that
--    20260609140000:81-83 promises does not exist — there is no such
--    function anywhere in the repo. So an opener can
--    `UPDATE disputes SET execution_status = 'executed'` while their dispute
--    is still open. `rpc_decide_dispute` does not reset that column, so
--    `execute-dispute-split` then refuses at its terminal-state guard
--    (index.ts:191) — a permanent denial of service on the settlement path,
--    performed by the party who stands to lose the split. They can equally
--    forge `payout_split`, `decision_text`, `decided_by` and the execution
--    ledger columns the admin queue renders.
--
-- Replay-safe: every object is CREATE OR REPLACE / IF NOT EXISTS / DROP-first,
-- and the dedupe in section 3 is idempotent.

-- ---------------------------------------------------------------------------
-- 1. One open dispute per job, enforced by the database.
-- ---------------------------------------------------------------------------
-- Close any pre-existing duplicates first, newest kept, so the index below can
-- be created on a live table. A no-op on a clean database (production had 2
-- disputes on 2 distinct jobs at the time of writing).
UPDATE public.disputes d
   SET status = 'withdrawn'
 WHERE d.status = 'open'
   AND EXISTS (
     SELECT 1 FROM public.disputes d2
      WHERE d2.job_id = d.job_id
        AND d2.status = 'open'
        AND (d2.created_at, d2.id) > (d.created_at, d.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_open_per_job_idx
  ON public.disputes (job_id)
  WHERE status = 'open';

COMMENT ON INDEX public.disputes_one_open_per_job_idx IS
  'At most one open dispute per job. The advisory SELECT-then-INSERT in '
  'rpc_open_dispute cannot see a concurrent transaction''s row, so this is '
  'the only thing that actually makes "one dispute" true.';

-- ---------------------------------------------------------------------------
-- 2. Lock the opener''s UPDATE to the one column they are meant to touch.
-- ---------------------------------------------------------------------------
-- RLS cannot express "these columns only", so a trigger does it. Runs for
-- every non-superuser write; the SECURITY DEFINER RPCs are unaffected because
-- they run as the definer, whose auth.uid() is still the caller — hence the
-- explicit admin and definer-context escapes below.
CREATE OR REPLACE FUNCTION public.enforce_dispute_opener_column_whitelist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Service role / cron / edge functions run with no JWT: not a user write.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins resolve disputes; that is the whole point of the admin policy.
  IF public.has_role(_uid, 'admin') THEN
    RETURN NEW;
  END IF;

  -- A party may append evidence and nothing else. Every other column is
  -- pinned to its old value, so a forged `execution_status`, `payout_split`,
  -- `decided_by` or ledger figure is rejected rather than silently kept.
  IF NEW.id             IS DISTINCT FROM OLD.id
  OR NEW.job_id         IS DISTINCT FROM OLD.job_id
  OR NEW.opener_id      IS DISTINCT FROM OLD.opener_id
  OR NEW.reason         IS DISTINCT FROM OLD.reason
  OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  OR NEW.decided_at     IS DISTINCT FROM OLD.decided_at
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
  'evidence_urls.';

DROP TRIGGER IF EXISTS trg_enforce_dispute_opener_column_whitelist ON public.disputes;
CREATE TRIGGER trg_enforce_dispute_opener_column_whitelist
  BEFORE UPDATE ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_dispute_opener_column_whitelist();

-- ---------------------------------------------------------------------------
-- 3. rpc_open_dispute: lock the job, re-freeze on a re-file, notify everyone.
-- ---------------------------------------------------------------------------
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
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added above is the backstop; this is what makes the loser WAIT and then
  -- take the existing-dispute branch instead of erroring.
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

  RETURN _new_id;
END;
$function$;

COMMENT ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) IS
  'Opens (or appends evidence to) the one open dispute on a job, freezes the '
  'job in ''disputed'', and notifies the counterparty plus every admin. The '
  'notification fan-out lives here because RLS makes it impossible from the '
  'client: user_roles is unreadable to a normal user and the notifications '
  'INSERT policy is admin/service-role only.';

-- ---------------------------------------------------------------------------
-- 4. respond_to_review: the one review function with a mutable search_path.
-- ---------------------------------------------------------------------------
-- Every other review function pins it; this one (20260612380000) did not, and
-- is also the only one that never revoked EXECUTE from PUBLIC. Body is
-- otherwise verbatim.
DO $do$
BEGIN
  IF to_regprocedure('public.respond_to_review(uuid, text)') IS NOT NULL THEN
    EXECUTE $sql$
      -- Parameter NAMES are preserved exactly (`_response_text`, not
      -- `_response`): CREATE OR REPLACE refuses to rename an input parameter,
      -- so a "tidier" name here would fail the deploy. Body is verbatim apart
      -- from schema-qualifying `reviews`, which is what pinning search_path
      -- makes safe.
      CREATE OR REPLACE FUNCTION public.respond_to_review(
        _review_id uuid,
        _response_text text
      )
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'public'
      AS $fn$
      BEGIN
        UPDATE public.reviews
        SET
          response_text = TRIM(_response_text),
          response_at   = now()
        WHERE id = _review_id
          AND reviewee_id = auth.uid()
          AND status = 'published';

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Review not found or you are not the reviewee';
        END IF;
      END;
      $fn$;
    $sql$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.respond_to_review(uuid, text) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.respond_to_review(uuid, text) TO authenticated';
  END IF;
END
$do$;
