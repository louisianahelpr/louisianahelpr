-- Cancellation becomes a server-owned exit: the reliability ladder is no
-- longer skippable.
--
-- WHAT WAS EXPLOITABLE
-- --------------------
-- `jobs` is written directly over PostgREST by the app, and two triggers were
-- the only thing standing between a client and the cancellation columns:
--
--   * enforce_helper_jobs_column_whitelist (20260703161000) listed `status`,
--     `cancelled_by`, `cancelled_at`, `cancellation_reason`,
--     `late_cancellation`, `cancellation_fee` and `cancellation_fee_status`
--     on the assigned helper's ALLOW-list, and
--   * enforce_job_status_transition permits `in_progress -> cancelled`.
--
-- So an assigned, non-admin helper on a FUNDED, in-progress job could simply
-- send one UPDATE and walk away: job cancelled, `cancellation_fee` set to any
-- number they liked, and `user_violations` untouched. Reproduced against prod
-- inside a rolled-back transaction: 0 strikes before, 0 after, fee written as
-- 100% of the budget. The sanctioned exits (`helper_cancel_booking`,
-- `helper_abort_job`) apply `apply_job_denial_consequence` — but nothing forced
-- a helper through them.
--
-- The poster side had the same shape from the other direction:
-- `CancellationDialog` performed the cancel UPDATE and then made a SEPARATE
-- client-initiated `apply_cancellation_violation_consequence` RPC call. Two
-- independent round-trips with nothing binding them — a client that simply
-- never made the second call recorded no strike, for free.
--
-- WHAT THIS DOES
-- --------------
-- 1. Adds `trg_cancellation_requires_rpc`: for any caller with a JWT who is not
--    an admin, transitioning a job INTO `cancelled`, or touching any of the six
--    cancellation columns, is rejected unless the statement is running inside a
--    sanctioned SECURITY DEFINER entry point (which announces itself with the
--    transaction-local GUC `app.sanctioned_cancel`). Service-role callers
--    (auth.uid() IS NULL — every edge function) and admins are unaffected.
--
--    Note the GUC is deliberately NOT the existing `app.trusted_ladder_write`:
--    `apply_job_denial_consequence` sets that one and never clears it, so
--    `helper_cancel_booking` would have carried an open gate for the rest of
--    its transaction.
--
-- 2. Adds `poster_cancel_job(uuid, text)` — the poster's ONLY cancellation
--    path. It derives the fee server-side from the same ladder
--    `_shared/cancellationFee.ts` uses (`cancellation_fee_percent` /
--    `job_hours_until_start`, so the persisted row can no longer disagree with
--    what void-cancelled-payments recomputes), writes the row, notifies the
--    helper, and applies the strike ladder IN THE SAME TRANSACTION. One
--    statement, one outcome: you cannot get the cancellation without the
--    ladder, and `apply_cancellation_violation_consequence` is keyed to the job
--    id so it lands exactly once.
--
-- 3. Republishes `block_user_and_settle` and `reject_pending_job` so the two
--    other legitimate non-admin cancellers open the gate around their own
--    writes. `rpc_decide_dispute` is admin-only and passes on has_role.
--
-- Money is unaffected: `void-cancelled-payments` still recomputes the fee from
-- budget/date/cancelled_at and refunds off Stripe's `amount_received`. The
-- column stays display-only for money — it is just no longer forgeable.

-- ---------------------------------------------------------------------------
-- 1. The gate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_cancellation_requires_rpc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  guarded CONSTANT text[] := ARRAY[
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status'
  ];
BEGIN
  -- Service role (edge functions / cron) and admins keep their existing reach;
  -- their access is governed by RLS and the admin audit trail as before.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- Inside a sanctioned SECURITY DEFINER exit. The GUC is transaction-local
  -- and each entry point clears it again immediately after its own statement.
  IF COALESCE(current_setting('app.sanctioned_cancel', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION
      'Jobs may only be cancelled through a cancellation RPC (job_id=%)', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Posters call poster_cancel_job(); Helprs call helper_cancel_booking() or helper_abort_job(). Those apply the reliability ladder in the same transaction.';
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (guarded) THEN
      RAISE EXCEPTION 'jobs.% is set by the cancellation RPC, not by the client', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cancellation_requires_rpc ON public.jobs;
CREATE TRIGGER trg_cancellation_requires_rpc
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cancellation_requires_rpc();

-- ---------------------------------------------------------------------------
-- 2. The poster's cancellation exit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.poster_cancel_job(
  p_job_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_reason text;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_late boolean;
  v_commission numeric;
  v_helper_cut numeric;
  v_verdict jsonb := jsonb_build_object('action', 'none', 'prior_count', 0);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_reason := left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 1000);

  SELECT j.id, j.title, j.budget, j.date_needed, j.customer_id, j.helper_id,
         j.status, j.helper_fee_percent
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- The server owns the decision. A helper (or any third party) hitting this
  -- gets not_authorized rather than a partial write.
  IF v_job.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Deliberately NOT 'pending_approval': enforce_job_status_transition has no
  -- pending_approval -> cancelled edge for a non-admin, so offering it here
  -- would promise an exit the very next trigger rejects. That draft is
  -- withdrawn through reject_pending_job, which is the business-approval path.
  -- 'disputed' is excluded too: escrow must not move while a human is deciding.
  IF v_job.status::text NOT IN ('open', 'accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'not_cancellable'
      USING HINT = 'This job is already finished, cancelled, or under dispute.';
  END IF;

  -- The fee is DERIVED here, never accepted from the caller — same ladder
  -- void-cancelled-payments recomputes from, so the persisted row and the money
  -- that moves can no longer disagree.
  v_hours   := public.job_hours_until_start(v_job.date_needed, now());
  v_percent := public.cancellation_fee_percent(v_job.helper_id IS NOT NULL, v_hours);
  v_fee := CASE
    WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
      THEN round(v_job.budget * v_percent) / 100.0
    ELSE 0
  END;
  v_late := (v_hours IS NOT NULL AND v_hours < 24 AND v_hours > 0);

  PERFORM set_config('app.sanctioned_cancel', 'on', true);

  UPDATE public.jobs
     SET status = 'cancelled'::job_status,
         cancelled_by = v_uid,
         cancelled_at = now(),
         cancellation_reason = v_reason,
         late_cancellation = v_late,
         cancellation_fee = v_fee,
         cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
   WHERE id = v_job.id;

  PERFORM set_config('app.sanctioned_cancel', 'off', true);

  -- Tell the Helpr what happened to their money. This used to be a separate
  -- client-side createNotification() that a cancelling client could skip.
  IF v_job.helper_id IS NOT NULL THEN
    v_commission := COALESCE(v_job.helper_fee_percent, 10);
    v_helper_cut := GREATEST(0, round((v_fee - round(v_fee * v_commission) / 100.0) * 100) / 100.0);

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      v_job.helper_id,
      CASE WHEN v_fee > 0 THEN 'Job cancelled — you''ll be compensated' ELSE 'Job cancelled' END,
      CASE
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled by the poster. You''ll receive approximately $%s as a cancellation fee (%s%% of the budget minus platform fee), processed within the hour.',
                 COALESCE(v_job.title, 'A job'),
                 to_char(v_helper_cut, 'FM999999990.00'),
                 v_percent)
        ELSE
          format('"%s" was cancelled by the poster. It was more than 24 hours out, so no cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/my-jobs'
    );

    -- THE LADDER, in the same transaction as the state change. Idempotent on
    -- (user, 'cancel_with_helper', job_id), so one cancelled job is one strike
    -- however many times this is retried.
    v_verdict := public.apply_cancellation_violation_consequence(v_job.id);
  END IF;

  RETURN v_verdict || jsonb_build_object(
    'cancellation_fee', v_fee,
    'fee_percent', v_percent,
    'late_cancellation', v_late,
    'had_helper', v_job.helper_id IS NOT NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.poster_cancel_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poster_cancel_job(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The other two legitimate non-admin cancellers open the gate
-- ---------------------------------------------------------------------------
-- Republished verbatim from 20260826200000 apart from the two set_config calls
-- around the UPDATE.

CREATE OR REPLACE FUNCTION public.block_user_and_settle(p_blocked uuid, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_job record;
  v_hours numeric;
  v_percent int;
  v_fee numeric;
  v_updated int;
  v_settled jsonb := '[]'::jsonb;
  v_ladder_present boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_blocked IS NULL OR p_blocked = v_user THEN
    RAISE EXCEPTION 'invalid_target';
  END IF;

  -- The block itself first: whatever happens to the jobs below, the person
  -- asking to be left alone is left alone.
  INSERT INTO public.user_blocks (blocker_id, blocked_id, reason)
  VALUES (v_user, p_blocked, NULLIF(btrim(COALESCE(p_reason, '')), ''))
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;

  v_ladder_present :=
    to_regprocedure('public.apply_cancellation_violation_consequence(uuid)') IS NOT NULL;

  FOR v_job IN
    SELECT j.id, j.title, j.budget, j.date_needed, j.customer_id, j.helper_id, j.status
      FROM public.jobs j
     WHERE j.status IN ('accepted', 'in_progress', 'revision_requested')
       AND (
            (j.customer_id = v_user     AND j.helper_id = p_blocked)
         OR (j.customer_id = p_blocked  AND j.helper_id = v_user)
       )
     FOR UPDATE
  LOOP
    v_hours := public.job_hours_until_start(v_job.date_needed, now());
    v_percent := public.cancellation_fee_percent(v_job.helper_id IS NOT NULL, v_hours);
    v_fee := CASE
      WHEN COALESCE(v_job.budget, 0) > 0 AND v_percent > 0
        THEN round(v_job.budget * v_percent) / 100.0
      ELSE 0
    END;

    -- The pinned columns (cancellation_*, late_cancellation) are legitimate
    -- server writes here, and the blocker may be the HELPER seat, which the
    -- helper column whitelist would otherwise reject. `app.sanctioned_cancel`
    -- additionally satisfies trg_cancellation_requires_rpc: this IS one of the
    -- sanctioned exits. Both hatches are transaction-local and switched off
    -- again immediately after the statement.
    PERFORM set_config('app.trusted_ladder_write', 'on', true);
    PERFORM set_config('app.sanctioned_cancel', 'on', true);

    UPDATE public.jobs
       SET status = 'cancelled',
           cancelled_by = v_user,
           cancelled_at = now(),
           cancellation_reason = 'Cancelled because one party blocked the other.',
           late_cancellation = (v_hours IS NOT NULL AND v_hours < 24 AND v_hours > 0),
           cancellation_fee = v_fee,
           cancellation_fee_status = CASE WHEN v_fee > 0 THEN 'pending' ELSE NULL END
     WHERE id = v_job.id
       AND status IN ('accepted', 'in_progress', 'revision_requested');

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    PERFORM set_config('app.trusted_ladder_write', 'off', true);
    PERFORM set_config('app.sanctioned_cancel', 'off', true);

    IF v_updated = 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      p_blocked,
      'Job cancelled',
      CASE
        WHEN v_fee > 0 AND v_job.helper_id = p_blocked THEN
          format('"%s" was cancelled. Because it was cancelled late, a $%s cancellation fee applies and your share is on its way — it settles within the hour.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        WHEN v_fee > 0 THEN
          format('"%s" was cancelled late, so a $%s cancellation fee applies.',
                 COALESCE(v_job.title, 'A job'), to_char(v_fee, 'FM999999990.00'))
        ELSE
          format('"%s" was cancelled. No cancellation fee applies.', COALESCE(v_job.title, 'A job'))
      END,
      CASE WHEN v_fee > 0 THEN 'payment' ELSE 'warning' END,
      '/my-jobs'
    );

    -- The reliability strike, through the SAME ladder the normal cancel path
    -- uses. It authorises off auth.uid() = customer_id internally, so it is a
    -- no-op (raises 'not_authorized') for the helper-blocks-poster direction —
    -- only call it in the seat it is written for.
    IF v_ladder_present AND v_job.customer_id = v_user AND v_job.helper_id IS NOT NULL THEN
      PERFORM public.apply_cancellation_violation_consequence(v_job.id);
    END IF;

    v_settled := v_settled || jsonb_build_object(
      'job_id', v_job.id,
      'title', v_job.title,
      'cancellation_fee', v_fee,
      'fee_percent', v_percent
    );
  END LOOP;

  RETURN jsonb_build_object('blocked', p_blocked, 'settled', v_settled);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_pending_job(p_job_id uuid, p_reason text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_business_id uuid;
BEGIN
  SELECT business_id INTO v_business_id FROM public.jobs WHERE id = p_job_id;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = '42704';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members
     WHERE business_id = v_business_id AND user_id = auth.uid()
       AND status = 'active' AND extended_role IN ('owner', 'approver', 'admin')
  ) AND NOT EXISTS (
    SELECT 1 FROM public.businesses WHERE id = v_business_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'No approval permission' USING ERRCODE = '42501';
  END IF;

  -- Sanctioned exit: an approver rejecting an unposted draft. No helper has
  -- committed and no escrow exists, so there is no ladder to climb — but the
  -- write still has to announce itself to trg_cancellation_requires_rpc.
  PERFORM set_config('app.sanctioned_cancel', 'on', true);
  UPDATE public.jobs SET status = 'cancelled'::job_status WHERE id = p_job_id AND status = 'pending_approval'::job_status;
  PERFORM set_config('app.sanctioned_cancel', 'off', true);

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT j.customer_id, 'Post rejected',
         COALESCE('Your post "' || j.title || '" was not approved.' ||
                  CASE WHEN p_reason IS NOT NULL THEN ' Reason: ' || p_reason ELSE '' END,
                  'Your post was not approved.'),
         'warning'
    FROM public.jobs j WHERE j.id = p_job_id;
  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Don't strand the Helprs this gate now forces through helper_abort_job
-- ---------------------------------------------------------------------------
-- Closing the raw-UPDATE hole is only safe if the sanctioned exit actually
-- works. It did not. `helper_abort_job` has two branches, and branch B — the
-- one for a helper who has ALREADY STARTED (arrived / uploaded proof), i.e.
-- exactly the case where walking away costs the poster something — calls
-- `rpc_open_dispute`, which sets `jobs.disputed_by`. That column was never
-- added to enforce_helper_jobs_column_whitelist's ALLOW-list, even though its
-- five siblings (dispute_reason, disputed_at, dispute_status,
-- dispute_evidence_urls, dispute_helper_response) all were. So the whole branch
-- died on `Helpers may not modify jobs.disputed_by`.
--
-- Verified against unpatched prod as the assigned non-admin helper on a funded
-- in-progress job with helper_arrived_at set: helper_abort_job raised that
-- error and nothing happened. It is pre-existing and independent of this
-- change — but it means the ONLY working exit for a started job was the raw
-- UPDATE this migration removes. Fixing it here keeps "every commitment has a
-- sanctioned exit" true rather than trading a security hole for a dead end.
--
-- `disputed_by` is added to the ALLOW-list with the same self-only guard
-- `helper_id` already carries: a helper may stamp it as THEMSELVES (which is
-- all rpc_open_dispute does) and may not forge it to anyone else.

CREATE OR REPLACE FUNCTION public.enforce_helper_jobs_column_whitelist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  allowed CONSTANT text[] := ARRAY[
    'status',
    'helper_confirmed_at',
    'helper_dayof_confirmed_at',
    'helper_on_the_way_at',
    'helper_arrived_at',
    'helper_completed_at',
    'proof_before_urls',
    'proof_after_urls',
    'dispute_reason',
    'dispute_evidence_urls',
    'disputed_at',
    'disputed_by',
    'dispute_status',
    'dispute_helper_response',
    'cancelled_by',
    'cancelled_at',
    'cancellation_reason',
    'late_cancellation',
    'cancellation_fee',
    'cancellation_fee_status',
    'helper_id',
    'response_deadline',
    'updated_at'
  ];
BEGIN
  -- Only constrain the assigned helper acting on their own job. Everyone
  -- else (service role: uid NULL; poster; admin) passes through — their
  -- access is governed by RLS as before.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.helper_id
     OR auth.uid() = OLD.customer_id THEN
    RETURN NEW;
  END IF;

  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF NOT (changed_col = ANY (allowed)) THEN
      RAISE EXCEPTION 'Helpers may not modify jobs.% ', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- A helper may un-assign themselves (decline fallback sets helper_id NULL)
  -- but never reassign the job to another account.
  IF NEW.helper_id IS DISTINCT FROM OLD.helper_id AND NEW.helper_id IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only clear jobs.helper_id, not reassign it'
      USING ERRCODE = '42501';
  END IF;

  -- Newly allowed above, so it gets its own self-only guard: a helper opening
  -- a dispute stamps THEMSELVES, never someone else.
  IF NEW.disputed_by IS DISTINCT FROM OLD.disputed_by
     AND NEW.disputed_by IS DISTINCT FROM auth.uid()
     AND NEW.disputed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Helpers may only record themselves as jobs.disputed_by'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The business-approval exit needs an edge to travel on
-- ---------------------------------------------------------------------------
-- Same class as section 4: a sanctioned exit that never worked. A business
-- approver rejecting a draft calls `reject_pending_job`, which moves the job
-- pending_approval -> cancelled — an edge `enforce_job_status_transition` has
-- never listed. Admins bypass that trigger, so it only ever failed for the
-- non-admin approvers the function is actually written for. Verified against
-- unpatched prod as the (non-admin) owner of a real business on a
-- pending_approval job: 'Invalid job status transition: pending_approval ->
-- cancelled'. Pre-existing and independent of this change.
--
-- Adding the edge is safe now in a way it was NOT before: until
-- trg_cancellation_requires_rpc existed, widening the matrix would also have
-- handed every non-admin a raw pending_approval -> cancelled UPDATE. The gate
-- in section 1 now rejects exactly that, so the edge is reachable only from
-- inside reject_pending_job, which is where it belongs.
--
-- Republished verbatim from the live definition apart from the one added row.

CREATE OR REPLACE FUNCTION public.enforce_job_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('open',                'accepted'),
      ('open',                'cancelled'),
      ('pending_approval',    'cancelled'),
      ('accepted',            'open'),
      ('accepted',            'in_progress'),
      ('accepted',            'completed'),
      ('accepted',            'cancelled'),
      ('accepted',            'disputed'),
      ('in_progress',         'completed'),
      ('in_progress',         'revision_requested'),
      ('in_progress',         'cancelled'),
      ('in_progress',         'disputed'),
      ('in_progress',         'open'),
      ('revision_requested',  'in_progress'),
      ('revision_requested',  'completed'),
      ('revision_requested',  'cancelled'),
      ('revision_requested',  'disputed'),
      ('disputed',            'completed'),
      ('disputed',            'cancelled'),
      ('disputed',            'in_progress'),
      ('completed',           'disputed')
    ) AS allowed(from_status, to_status)
    WHERE allowed.from_status = OLD.status::text
      AND allowed.to_status   = NEW.status::text
  ) THEN
    RAISE EXCEPTION
      'Invalid job status transition: % -> % (job_id=%)',
      OLD.status, NEW.status, OLD.id
      USING
        ERRCODE = 'check_violation',
        HINT = 'See enforce_job_status_transition() in the migrations for the allowed transition matrix. Admins bypass this check.';
  END IF;

  RETURN NEW;
END;
$function$;
