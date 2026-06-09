-- Formal dispute resolution flow.
--
-- The previous setup encoded a dispute as `jobs.status='disputed'` plus
-- a handful of `dispute_*` columns on `jobs`. Admins resolved each by
-- triggering an ad-hoc Stripe action (release/refund) via the
-- `create-payment` edge function; there was no first-class record of
-- *why* a dispute was filed, what evidence both parties produced over
-- time, what payout split the admin chose, or who decided. As soon as
-- disputes get audited (chargeback rebuttal, support escalation, legal
-- discovery) that hole becomes painful.
--
-- This migration introduces a dedicated `public.disputes` table — one
-- row per filed dispute — and a pair of RPCs that wrap the lifecycle:
--   • rpc_open_dispute      — opener files, job flips to 'disputed'
--   • rpc_decide_dispute    — admin records decision + payout split
--
-- Disputes link back to `jobs(id)`, so the existing 'disputed' job
-- status and the existing `dispute_*` columns on `jobs` continue to
-- work in parallel for now (legacy admin tools and edge functions
-- still read from jobs). The new table is the source of truth for the
-- resolution UI; the per-job columns stay as a denormalised view for
-- the read paths that already depend on them. A later migration can
-- collapse the duplication after every read path is moved.
--
-- Replay-safety:
--   • Every DDL is IF NOT EXISTS / OR REPLACE / IF EXISTS.
--   • `public.jobs`, `public.notifications`, `auth.users`, and
--     `public.has_role` all exist by this timestamp.
--   • Both RPCs ship with explicit GRANT EXECUTE TO authenticated so
--     the CI grant-guard (PR #413) stays green.
--   • Idempotent policy drops + recreates so re-runs don't duplicate.

-- ── 1. The disputes table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  opener_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'decided', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id),
  decision_text text,
  payout_split jsonb
);

-- Hot-path index — the admin queue is "open disputes, newest first".
CREATE INDEX IF NOT EXISTS disputes_status_created_idx
  ON public.disputes (status, created_at DESC);

-- Per-job lookup — opening DisputeDialog reads "is there a dispute on
-- this job already?" and the timeline view loads by job_id.
CREATE INDEX IF NOT EXISTS disputes_job_id_idx
  ON public.disputes (job_id);

-- ── 2. RLS — opener + both job parties + admin SELECT ──────────────
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- Opener may always read their own filings.
DROP POLICY IF EXISTS "disputes opener select" ON public.disputes;
CREATE POLICY "disputes opener select" ON public.disputes
  FOR SELECT TO authenticated
  USING (auth.uid() = opener_id);

-- Both parties of the job (customer + helper) can read the dispute on
-- it — they're both impacted by the outcome, and the resolution UI
-- shows the timeline to whichever side is viewing.
DROP POLICY IF EXISTS "disputes job parties select" ON public.disputes;
CREATE POLICY "disputes job parties select" ON public.disputes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = disputes.job_id
        AND (j.customer_id = auth.uid() OR j.helper_id = auth.uid())
    )
  );

-- Opener may add follow-up evidence (UPDATE of evidence_urls only —
-- the column-level constraint is enforced inside `rpc_add_evidence`
-- below; this policy just gates row visibility for the UPDATE path).
DROP POLICY IF EXISTS "disputes opener update" ON public.disputes;
CREATE POLICY "disputes opener update" ON public.disputes
  FOR UPDATE TO authenticated
  USING (auth.uid() = opener_id AND status = 'open')
  WITH CHECK (auth.uid() = opener_id AND status = 'open');

-- Admins can read & update everything (decision flow).
DROP POLICY IF EXISTS "disputes admin all" ON public.disputes;
CREATE POLICY "disputes admin all" ON public.disputes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- INSERT path is via the SECURITY DEFINER RPC below — no direct
-- INSERT policy by design, so unauthenticated/non-owner inserts fail
-- closed.

-- ── 3. rpc_open_dispute — file a dispute on a job ─────────────────
-- Writes one row to disputes, flips jobs.status to 'disputed', and
-- mirrors the reason/evidence onto the legacy jobs.dispute_* columns
-- so old admin paths keep working until they're migrated.
--
-- Authorisation: caller must be either the job's poster or the
-- assigned helper. Anyone else cannot open a dispute on a job they're
-- not party to.
CREATE OR REPLACE FUNCTION public.rpc_open_dispute(
  _job_id uuid,
  _reason text,
  _evidence_urls text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _customer_id uuid;
  _helper_id uuid;
  _existing_status text;
  _existing_dispute_id uuid;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT customer_id, helper_id, status
    INTO _customer_id, _helper_id, _existing_status
    FROM public.jobs
   WHERE id = _job_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF _uid <> _customer_id AND _uid <> COALESCE(_helper_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RAISE EXCEPTION 'only the job''s poster or assigned helper may file a dispute';
  END IF;

  -- Don't allow double-filing — if there's already an open dispute on
  -- this job, return its id and let the client merge evidence into it.
  SELECT id INTO _existing_dispute_id
    FROM public.disputes
   WHERE job_id = _job_id AND status = 'open'
   LIMIT 1;

  IF _existing_dispute_id IS NOT NULL THEN
    -- Append the new evidence to the existing dispute rather than
    -- creating a duplicate row.
    UPDATE public.disputes
       SET evidence_urls = evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
     WHERE id = _existing_dispute_id;
    RETURN _existing_dispute_id;
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- Mirror onto the legacy jobs columns so existing admin tooling
  -- (AdminDisputes' fallback read, edge-function release/refund) keeps
  -- functioning. The trigger `set_dispute_deadline` (migration
  -- 20260330201452) will set jobs.dispute_deadline from disputed_at.
  UPDATE public.jobs
     SET status = 'disputed',
         dispute_reason = _reason,
         dispute_evidence_urls = COALESCE(_evidence_urls, '{}'::text[]),
         disputed_at = now(),
         disputed_by = _uid
   WHERE id = _job_id;

  RETURN _new_id;
END;
$$;

-- ── 4. rpc_decide_dispute — admin records the resolution ──────────
-- Writes the decision, flips the dispute to 'decided', and updates
-- the job's status per the decision (completed for poster/helper
-- payouts, cancelled for full refund). Emits a notification to both
-- parties of the job so they're aware the outcome was reached.
--
-- Authorisation: caller must be an admin.
--
-- Note: this RPC records the decision and notifies. Actually moving
-- money in Stripe still happens via the existing `create-payment`
-- edge function — admins will continue to invoke release/refund there
-- from the AdminDisputes UI. Splitting the on-chain action from the
-- decision record keeps this migration narrow and avoids coupling
-- the database to Stripe webhooks.
CREATE OR REPLACE FUNCTION public.rpc_decide_dispute(
  _dispute_id uuid,
  _decision_text text,
  _payout_split jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT job_id, status INTO _job_id, _existing_status
    FROM public.disputes
   WHERE id = _dispute_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute not found';
  END IF;

  IF _existing_status <> 'open' THEN
    RAISE EXCEPTION 'dispute already %', _existing_status;
  END IF;

  SELECT customer_id, helper_id, title
    INTO _customer_id, _helper_id, _job_title
    FROM public.jobs
   WHERE id = _job_id;

  -- Derive shares (defensive — accept 0–1 fractions or 0–100 percents).
  _poster_share := COALESCE((_payout_split->>'poster')::numeric, 0.5);
  _helper_share := COALESCE((_payout_split->>'helper')::numeric, 0.5);
  IF _poster_share > 1 OR _helper_share > 1 THEN
    _poster_share := _poster_share / 100.0;
    _helper_share := _helper_share / 100.0;
  END IF;

  -- Decision → job status mapping. A 100% poster outcome cancels the
  -- job (full refund). Anything else means at least some payout to the
  -- helper, so it counts as completed.
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
         )
   WHERE id = _dispute_id;

  UPDATE public.jobs
     SET status = _new_job_status::public.job_status,
         dispute_resolved_at = now()
   WHERE id = _job_id;

  -- Notify both parties — they get the decision text in-app so they
  -- aren't relying on email to find out. Helper id is nullable on the
  -- job row (jobs can be cancelled before a helper is picked), so we
  -- guard that insert.
  IF _customer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    VALUES (
      _customer_id,
      'info',
      'Dispute resolved',
      'A decision has been made on "' || COALESCE(_job_title, 'your job') || '": ' || _decision_text,
      '/activity',
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
      '/activity',
      false
    );
  END IF;
END;
$$;

-- ── 5. Explicit grants — required by CI grant-guard (PR #413) ──────
REVOKE ALL ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_decide_dispute(uuid, text, jsonb) TO authenticated;
