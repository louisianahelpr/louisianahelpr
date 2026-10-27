-- Helpr Guarantee (owner 2026-10-27, "Redo first, then refund"). Q2450 in docs/OPEN.md.
--
-- The problem: once a poster approves a job it is final (20260915025607: a person can never dispute a completed
-- job), and the Helpr's pay leaves 72 hours later on a timestamp alone. A poster who finds the work was not done
-- right the next morning had no way to ask for a fix and no way to stop the money.
--
-- What this adds, for a one-person job whose payout has not been sent:
--   1. Within 48 h of the job being done (jobs.completed_at), the poster taps "Not done right" with a note and
--      photos (their own uploads, the dispute-evidence rule). One claim per job, ever.
--   2. While a claim is open the Helpr's money stays held: refuse_payout_claim_while_held refuses the payout
--      claim row, so release-payout answers 409 payout_held and the cron simply tries again later.
--   3. The Helpr answers within 48 h: "Accept fix" with a date within 3 days (Louisiana time), or "Can't fix".
--   4. After the fix the Helpr marks it fixed; the poster confirms, or says it is still not right. A poster who
--      does not answer within 48 h is taken as satisfied.
--   5. Closed (confirmed or no answer): the hold lifts and the Helpr is paid on the normal schedule.
--   6. Can't fix, no answer from the Helpr, the fix date passing (by a day) without "fixed", or the poster saying
--      it is still not right: the claim becomes a dispute through the EXISTING open_dispute_as (a platform filing,
--      the only filing allowed on a completed job), and an admin decides it with rpc_decide_dispute. A party's
--      tap records 'escalating' (still holding) and guarantee_sweep files the dispute in server context within
--      minutes: from a party's own session the jobs column whitelists refuse open_dispute_as's writes.
--      execute-dispute-split refunds the poster's share of the JOB PRICE only for a dispute born of a claim; the
--      fees are kept (owner rule: a Helpr never absorbs a fee).
-- The job's chat stays open while a claim is open, and 24 h after it closes, so the two can arrange the fix.
--
-- No hidden switch: the owner's standing order is that this kind of change ships on for everyone.
--
-- REPLAY-SAFETY: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE; the restated
-- refuse_payout_claim_while_held (newest 20261025162003) and job_messaging_closes_at (newest 20260919220233)
-- keep every earlier rule word for word; cron and cron_work_expectations are guarded.

CREATE TABLE IF NOT EXISTS public.job_guarantee_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  poster_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 15 AND 1000),
  photo_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_paths) <= 6),
  status text NOT NULL DEFAULT 'awaiting_helpr'
    CHECK (status IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating', 'closed', 'disputed')),
  helpr_answer_by timestamptz NOT NULL,
  fix_date date,
  helpr_answered_at timestamptz,
  fixed_at timestamptz,
  poster_answer_by timestamptz,
  closed_at timestamptz,
  close_reason text CHECK (close_reason IS NULL OR close_reason IN (
    'poster_confirmed', 'poster_silent', 'helpr_cant_fix', 'helpr_no_answer', 'fix_not_done', 'poster_rejected_fix',
    'job_moved_on')),
  poster_reject_note text CHECK (poster_reject_note IS NULL OR char_length(poster_reject_note) <= 1000),
  dispute_id uuid REFERENCES public.disputes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_guarantee_claims_one_per_job UNIQUE (job_id),
  CONSTRAINT job_guarantee_claims_fix_needs_date CHECK (status <> 'fix_scheduled' OR fix_date IS NOT NULL),
  CONSTRAINT job_guarantee_claims_disputed_has_dispute CHECK (status <> 'disputed' OR dispute_id IS NOT NULL OR closed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS job_guarantee_claims_open_idx ON public.job_guarantee_claims (status)
  WHERE status IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating');
CREATE INDEX IF NOT EXISTS job_guarantee_claims_dispute_idx ON public.job_guarantee_claims (dispute_id) WHERE dispute_id IS NOT NULL;
ALTER TABLE public.job_guarantee_claims ENABLE ROW LEVEL SECURITY;
-- Every public table keeps the unconfirmed-email gate (db-deploy smoke).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.job_guarantee_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_guarantee_claims TO authenticated;
GRANT ALL ON TABLE public.job_guarantee_claims TO service_role;
DROP POLICY IF EXISTS "guarantee claims: the two parties and admins read" ON public.job_guarantee_claims;
CREATE POLICY "guarantee claims: the two parties and admins read" ON public.job_guarantee_claims
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IN (poster_id, helper_id)
    OR COALESCE(public.has_role((SELECT auth.uid()), 'admin'::public.app_role), false)
  );
COMMENT ON TABLE public.job_guarantee_claims IS
  'Helpr Guarantee claims (owner 2026-10-27): one per job, opened by the poster within 48 h of the job being done; '
  'holds the payout while open; closes paid or becomes a dispute. Written only by the guarantee RPCs and sweep.';

-- The rules, one place (the screens read the same numbers through the claim's own deadlines).
CREATE OR REPLACE FUNCTION public.guarantee_rules()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT jsonb_build_object(
    'claim_window_hours', 48,     -- after the job is done
    'helpr_answer_hours', 48,     -- to Accept fix / Can't fix
    'fix_within_days', 3,         -- the fix date, from the day the Helpr answers (Louisiana time)
    'fix_grace_hours', 24,        -- after the fix date ends, before "not fixed" becomes a dispute
    'poster_answer_hours', 48,    -- after "fixed"; silence is satisfied
    'max_photos', 6);
$fn$;
REVOKE ALL ON FUNCTION public.guarantee_rules() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guarantee_rules() TO authenticated, service_role;

-- One notice + one system row in the job's chat (both parties see it there), never a raise: the caller's
-- write is the point, and the notice is written in the same transaction (no swallowed error either way).
CREATE OR REPLACE FUNCTION public.guarantee_tell(p_job_id uuid, p_to uuid, p_title text, p_message text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  -- The bell only. No system row in the job's chat: a messages insert from an RPC (not a trigger) is counted by
  -- enforce_message_rate and could refuse the request itself (serverMessageInsertsSkipBlocked, Q1169).
  IF p_to IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (p_to, p_job_id, p_title, p_message, 'job_update', '/jobs/' || p_job_id::text);
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guarantee_tell(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guarantee_tell(uuid, uuid, text, text) TO service_role;

-- The claim becomes a dispute: the platform files it (the only filing open_dispute_as allows on a completed
-- job; a platform filing carries no evidence, so the photos stay on the claim, where the admin's dispute card
-- shows them). Locks the claim; idempotent (a claim already disputed returns its dispute).
CREATE OR REPLACE FUNCTION public.guarantee_escalate(p_claim_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c public.job_guarantee_claims%ROWTYPE;
  v_dispute uuid;
  v_why text;
BEGIN
  SELECT * INTO c FROM public.job_guarantee_claims WHERE id = p_claim_id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'guarantee_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF c.status = 'disputed' THEN
    RETURN c.dispute_id;
  END IF;
  IF c.status NOT IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating') THEN
    RAISE EXCEPTION 'guarantee_closed' USING ERRCODE = '55000', HINT = 'This Helpr Guarantee request is already closed.';
  END IF;
  -- An 'escalating' claim carries the reason its party's tap recorded.
  p_reason := COALESCE(p_reason, c.close_reason);
  v_why := CASE p_reason
    WHEN 'helpr_cant_fix' THEN 'the Helpr said they can''t fix it'
    WHEN 'helpr_no_answer' THEN 'the Helpr did not answer within 48 hours'
    WHEN 'fix_not_done' THEN 'the fix was not marked done by the day after the fix date'
    WHEN 'poster_rejected_fix' THEN 'the person who posted the job says the fix did not solve it'
    ELSE NULL END;
  IF v_why IS NULL THEN
    RAISE EXCEPTION 'guarantee_bad_reason' USING ERRCODE = '22023';
  END IF;
  -- open_dispute_as's platform branch tells both people "Revision deadline passed — dispute opened", which is
  -- wrong here; guarantee_filing_skips_revision_notice drops exactly that notice while this flag is on.
  PERFORM set_config('app.guarantee_filing', 'on', true);
  v_dispute := public.open_dispute_as(
    c.job_id, NULL,
    left('Helpr Guarantee: ' || v_why || '. The person who posted the job said: ' || btrim(c.note)
         || CASE WHEN c.poster_reject_note IS NOT NULL THEN ' After the fix: ' || btrim(c.poster_reject_note) ELSE '' END
         || ' (Photos are on the Helpr Guarantee request.)', 2000),
    '{}'::text[]);
  PERFORM set_config('app.guarantee_filing', '', true);
  UPDATE public.job_guarantee_claims
     SET status = 'disputed', dispute_id = v_dispute, close_reason = p_reason, closed_at = now(), updated_at = now()
   WHERE id = c.id;
  -- open_dispute_as already wrote the job's "Dispute opened" thread row (the status trigger).
  PERFORM public.guarantee_tell(c.job_id, c.poster_id, 'Your Helpr Guarantee request is now a dispute',
    'An admin will look at your photos and note and decide. A refund, if any, is of the job price.');
  PERFORM public.guarantee_tell(c.job_id, c.helper_id, 'The Helpr Guarantee request is now a dispute',
    'An admin will decide. Your pay stays held until then. You can add your side in the dispute.');
  RETURN v_dispute;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guarantee_escalate(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guarantee_escalate(uuid, text) TO service_role;

-- A guarantee filing's notices are its own (lh-money-escrow review, should-fix 3): while guarantee_escalate's
-- transaction-local flag is on, the platform filing's "Revision deadline passed" notice is not written at all
-- (BEFORE INSERT, RETURN NULL: no push, no SMS). Any other notice, and every other filing, is untouched.
CREATE OR REPLACE FUNCTION public.guarantee_filing_skips_revision_notice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.guarantee_filing', true), '') = 'on'
     AND NEW.title = 'Revision deadline passed — dispute opened' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guarantee_filing_skips_revision_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS aa_notifications_guarantee_filing ON public.notifications;
CREATE TRIGGER aa_notifications_guarantee_filing
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.title = 'Revision deadline passed — dispute opened')
  EXECUTE FUNCTION public.guarantee_filing_skips_revision_notice();

-- 1. The poster: "Not done right".
CREATE OR REPLACE FUNCTION public.rpc_guarantee_open(_job_id uuid, _note text, _photo_paths text[] DEFAULT '{}'::text[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  j record;
  v_id uuid;
  v_rules jsonb := public.guarantee_rules();
  v_note text := btrim(COALESCE(_note, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- The job row first, locked: the payout claim, a dispute filing and a second tap all wait behind it.
  SELECT jb.id, jb.customer_id, jb.helper_id, jb.status::text AS status, jb.payment_status, jb.is_group_job,
         jb.completed_at, jb.title
    INTO j
    FROM public.jobs jb WHERE jb.id = _job_id FOR UPDATE;
  IF j.id IS NULL OR j.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'guarantee_not_your_job' USING ERRCODE = '42501', HINT = 'Only the person who posted this job can ask.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_guarantee_claims g WHERE g.job_id = _job_id) THEN
    RAISE EXCEPTION 'guarantee_already_used' USING ERRCODE = '55000',
      HINT = 'You already used the Helpr Guarantee on this job.';
  END IF;
  IF j.status <> 'completed' OR j.is_group_job IS TRUE OR j.helper_id IS NULL THEN
    RAISE EXCEPTION 'guarantee_not_available' USING ERRCODE = '55000',
      HINT = 'The Helpr Guarantee is for a finished job with one Helpr.';
  END IF;
  IF j.completed_at IS NULL OR j.completed_at + make_interval(hours => (v_rules ->> 'claim_window_hours')::integer) < now() THEN
    RAISE EXCEPTION 'guarantee_window_closed' USING ERRCODE = '55000',
      HINT = 'The Helpr Guarantee is open for 48 hours after a job is done.';
  END IF;
  -- The money must still be here to hold: never after the payout went (or is going) out.
  IF j.payment_status IS DISTINCT FROM 'payout_pending'
     OR EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = _job_id AND t.status IN ('pending', 'paid')) THEN
    RAISE EXCEPTION 'guarantee_already_paid' USING ERRCODE = '55000',
      HINT = 'The Helpr has already been paid for this job, so the Helpr Guarantee can''t hold it. Contact support.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.disputes d WHERE d.job_id = _job_id AND (d.status = 'open'
             OR (d.status = 'decided' AND d.execution_status IS DISTINCT FROM 'executed'))) THEN
    RAISE EXCEPTION 'guarantee_not_available' USING ERRCODE = '55000', HINT = 'This job already has a dispute.';
  END IF;
  IF char_length(v_note) < 15 THEN
    RAISE EXCEPTION 'guarantee_needs_note' USING ERRCODE = '22023',
      HINT = 'Say what was not done right (at least a sentence).';
  END IF;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'guarantee_note_too_long' USING ERRCODE = '22023', HINT = 'Keep it under 1,000 characters.';
  END IF;
  IF cardinality(COALESCE(_photo_paths, '{}'::text[])) > (v_rules ->> 'max_photos')::integer THEN
    RAISE EXCEPTION 'guarantee_too_many_photos' USING ERRCODE = '22023', HINT = 'Add up to 6 photos.';
  END IF;
  -- Photos: the poster's own uploads for this job, the dispute-evidence rule (path form only).
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(_photo_paths, '{}'::text[])) AS p(u)
              WHERE NOT public.dispute_evidence_url_ok(p.u, v_uid, _job_id) OR p.u ~ '^https?://') THEN
    RAISE EXCEPTION 'guarantee_bad_photo' USING ERRCODE = '22023', HINT = 'Only photos you uploaded here can be added.';
  END IF;

  INSERT INTO public.job_guarantee_claims (job_id, poster_id, helper_id, note, photo_paths, helpr_answer_by)
  VALUES (_job_id, v_uid, j.helper_id, v_note, COALESCE(_photo_paths, '{}'::text[]),
          now() + make_interval(hours => (v_rules ->> 'helpr_answer_hours')::integer))
  RETURNING id INTO v_id;
  PERFORM public.guarantee_tell(_job_id, j.helper_id, 'The person who posted the job says it wasn''t done right',
    'Open the job to see their note and photos. Pick a day to fix it (within 3 days), or say you can''t. Your pay is held until it''s settled.');
  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_guarantee_open(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_guarantee_open(uuid, text, text[]) TO authenticated, service_role;

-- 2. The Helpr: Accept fix (with a day) or Can't fix.
CREATE OR REPLACE FUNCTION public.rpc_guarantee_helpr_answer(_claim_id uuid, _accept boolean, _fix_date date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  c public.job_guarantee_claims%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  -- Lock order everywhere: the job, then the claim.
  PERFORM 1 FROM public.jobs jb WHERE jb.id = (SELECT g.job_id FROM public.job_guarantee_claims g WHERE g.id = _claim_id) FOR UPDATE;
  SELECT * INTO c FROM public.job_guarantee_claims WHERE id = _claim_id FOR UPDATE;
  IF c.id IS NULL OR c.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'guarantee_not_yours' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'awaiting_helpr' OR c.helpr_answer_by < now() THEN
    RAISE EXCEPTION 'guarantee_answer_closed' USING ERRCODE = '55000', HINT = 'This request has moved on. Refresh the job.';
  END IF;
  IF _accept IS NULL THEN
    RAISE EXCEPTION 'guarantee_bad_answer' USING ERRCODE = '22023';
  END IF;
  IF NOT _accept THEN
    -- Recorded here; the dispute itself is filed by guarantee_sweep (server context) within minutes: from a
    -- party's own session open_dispute_as is refused by the jobs column whitelists (the refund-request rule,
    -- 20261021102943). The money stays held meanwhile ('escalating' holds).
    UPDATE public.job_guarantee_claims
       SET status = 'escalating', close_reason = 'helpr_cant_fix', helpr_answered_at = now(), updated_at = now()
     WHERE id = c.id;
    PERFORM public.guarantee_tell(c.job_id, c.poster_id, 'Your Helpr says they can''t fix it',
      'An admin will look at your photos and note and decide. A refund, if any, is of the job price.');
    RETURN 'escalating';
  END IF;
  IF _fix_date IS NULL OR _fix_date < v_today
     OR _fix_date > v_today + (public.guarantee_rules() ->> 'fix_within_days')::integer THEN
    RAISE EXCEPTION 'guarantee_bad_fix_date' USING ERRCODE = '22023', HINT = 'Pick a day from today to 3 days from now.';
  END IF;
  UPDATE public.job_guarantee_claims
     SET status = 'fix_scheduled', fix_date = _fix_date, helpr_answered_at = now(), updated_at = now()
   WHERE id = c.id;
  PERFORM public.guarantee_tell(c.job_id, c.poster_id, 'Your Helpr will come back to fix it',
    'They picked ' || to_char(_fix_date, 'FMDay, Mon FMDD') || '. Message them in the job to set a time.');
  RETURN 'fix_scheduled';
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_guarantee_helpr_answer(uuid, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_guarantee_helpr_answer(uuid, boolean, date) TO authenticated, service_role;

-- 3. The Helpr: fixed.
CREATE OR REPLACE FUNCTION public.rpc_guarantee_mark_fixed(_claim_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  c public.job_guarantee_claims%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.jobs jb WHERE jb.id = (SELECT g.job_id FROM public.job_guarantee_claims g WHERE g.id = _claim_id) FOR UPDATE;
  SELECT * INTO c FROM public.job_guarantee_claims WHERE id = _claim_id FOR UPDATE;
  IF c.id IS NULL OR c.helper_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'guarantee_not_yours' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'fix_scheduled' THEN
    RAISE EXCEPTION 'guarantee_answer_closed' USING ERRCODE = '55000', HINT = 'This request has moved on. Refresh the job.';
  END IF;
  UPDATE public.job_guarantee_claims
     SET status = 'fixed', fixed_at = now(),
         poster_answer_by = now() + make_interval(hours => (public.guarantee_rules() ->> 'poster_answer_hours')::integer),
         updated_at = now()
   WHERE id = c.id;
  PERFORM public.guarantee_tell(c.job_id, c.poster_id, 'Your Helpr says it''s fixed',
    'Take a look and tell us within 48 hours. If we don''t hear from you, we''ll take it as fixed.');
  RETURN 'fixed';
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_guarantee_mark_fixed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_guarantee_mark_fixed(uuid) TO authenticated, service_role;

-- 4. The poster: it's fixed (close, the Helpr is paid) or still not right (a dispute).
CREATE OR REPLACE FUNCTION public.rpc_guarantee_poster_answer(_claim_id uuid, _fixed boolean, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  c public.job_guarantee_claims%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.jobs jb WHERE jb.id = (SELECT g.job_id FROM public.job_guarantee_claims g WHERE g.id = _claim_id) FOR UPDATE;
  SELECT * INTO c FROM public.job_guarantee_claims WHERE id = _claim_id FOR UPDATE;
  IF c.id IS NULL OR c.poster_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'guarantee_not_yours' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'fixed' OR c.poster_answer_by < now() THEN
    RAISE EXCEPTION 'guarantee_answer_closed' USING ERRCODE = '55000', HINT = 'This request has moved on. Refresh the job.';
  END IF;
  IF _fixed IS NULL THEN
    RAISE EXCEPTION 'guarantee_bad_answer' USING ERRCODE = '22023';
  END IF;
  IF _fixed THEN
    UPDATE public.job_guarantee_claims
       SET status = 'closed', close_reason = 'poster_confirmed', closed_at = now(), updated_at = now()
     WHERE id = c.id;
    PERFORM public.guarantee_tell(c.job_id, c.helper_id, 'They say it''s fixed',
      'Thanks for making it right. Your pay is on its way on the usual schedule.');
    RETURN 'closed';
  END IF;
  IF v_note IS NULL OR char_length(v_note) < 15 THEN
    RAISE EXCEPTION 'guarantee_needs_note' USING ERRCODE = '22023', HINT = 'Say what is still not right (at least a sentence).';
  END IF;
  IF char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'guarantee_note_too_long' USING ERRCODE = '22023', HINT = 'Keep it under 1,000 characters.';
  END IF;
  -- Recorded here; guarantee_sweep files the dispute (server context), as for "Can't fix".
  UPDATE public.job_guarantee_claims
     SET poster_reject_note = v_note, status = 'escalating', close_reason = 'poster_rejected_fix', updated_at = now()
   WHERE id = c.id;
  PERFORM public.guarantee_tell(c.job_id, c.helper_id, 'They say it''s still not right',
    'An admin will decide. Your pay stays held until then.');
  RETURN 'escalating';
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_guarantee_poster_answer(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_guarantee_poster_answer(uuid, boolean, text) TO authenticated, service_role;

-- 5. The clock (cron, every 5 minutes): an 'escalating' claim (a party's tap) becomes a dispute; the Helpr's silence and an undone fix become a dispute; the poster's
-- silence after "fixed" closes the claim (the Helpr is paid); a claim whose job moved on (an admin refunded or
-- cancelled it, so nothing is left to hold; never on a chargeback or a cancel in flight) closes as 'job_moved_on'. Each claim in its own sub-transaction,
-- in job-then-claim lock order; a claim another call already moved is skipped by the status re-check, and a
-- claim that fails is logged to cron_defects (never skipped silently) and retried on the next run.
CREATE OR REPLACE FUNCTION public.guarantee_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  c public.job_guarantee_claims%ROWTYPE;
  v_rules jsonb := public.guarantee_rules();
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_closed integer := 0;
  v_disputed integer := 0;
  v_failed integer := 0;
  v_job record;
BEGIN
  FOR r IN
    SELECT g.id, g.job_id FROM public.job_guarantee_claims g
      JOIN public.jobs jb ON jb.id = g.job_id
     WHERE g.status IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating')
       AND jb.payment_status NOT IN ('chargeback', 'cancelling')
       AND ((jb.status::text = 'cancelled' OR jb.payment_status IN ('refunded', 'released'))
        OR g.status = 'escalating'
        OR (g.status = 'awaiting_helpr' AND g.helpr_answer_by < now())
        OR (g.status = 'fix_scheduled'
            AND ((g.fix_date + 1)::timestamp AT TIME ZONE 'America/Chicago')
                + make_interval(hours => (v_rules ->> 'fix_grace_hours')::integer) < now())
        OR (g.status = 'fixed' AND g.poster_answer_by < now()))
     ORDER BY g.created_at
     LIMIT 200
  LOOP
   BEGIN
    SELECT jb.status::text AS status, jb.payment_status INTO v_job FROM public.jobs jb WHERE jb.id = r.job_id FOR UPDATE;
    SELECT * INTO c FROM public.job_guarantee_claims WHERE id = r.id FOR UPDATE;
    IF c.status NOT IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating') THEN
      NULL;  -- moved by a party's own tap since the scan
    ELSIF v_job.payment_status IN ('chargeback', 'cancelling') THEN
      -- In flight: a chargeback inquiry can be dismissed (back to payout_pending) and a cancel refund can fail.
      -- The claim keeps holding and is looked at again next run (lh-money-escrow review, should-fix 2).
      NULL;
    ELSIF v_job.status = 'cancelled' OR v_job.payment_status IN ('refunded', 'released') THEN
      -- An admin refunded or cancelled the job, or it was paid out by an admin's decision: nothing left to hold.
      UPDATE public.job_guarantee_claims
         SET status = 'closed', close_reason = 'job_moved_on', closed_at = now(), updated_at = now()
       WHERE id = c.id;
      v_closed := v_closed + 1;
    ELSIF c.status = 'escalating' THEN
      PERFORM public.guarantee_escalate(c.id, NULL);
      v_disputed := v_disputed + 1;
    ELSIF c.status = 'awaiting_helpr' AND c.helpr_answer_by < now() THEN
      PERFORM public.guarantee_escalate(c.id, 'helpr_no_answer');
      v_disputed := v_disputed + 1;
    ELSIF c.status = 'fix_scheduled'
          AND ((c.fix_date + 1)::timestamp AT TIME ZONE 'America/Chicago')
              + make_interval(hours => (v_rules ->> 'fix_grace_hours')::integer) < now() THEN
      PERFORM public.guarantee_escalate(c.id, 'fix_not_done');
      v_disputed := v_disputed + 1;
    ELSIF c.status = 'fixed' AND c.poster_answer_by < now() THEN
      UPDATE public.job_guarantee_claims
         SET status = 'closed', close_reason = 'poster_silent', closed_at = now(), updated_at = now()
       WHERE id = c.id;
      PERFORM public.guarantee_tell(c.job_id, c.helper_id, 'The Helpr Guarantee request is closed',
        'No answer came within 48 hours, so it counts as fixed. Your pay is on its way on the usual schedule.');
      PERFORM public.guarantee_tell(c.job_id, c.poster_id, 'Your Helpr Guarantee request is closed',
        'We didn''t hear back within 48 hours, so we took it as fixed.');
      v_closed := v_closed + 1;
    END IF;
   EXCEPTION WHEN OTHERS THEN
    -- This claim's step is rolled back (its hold stays: the claim is still open) and retried next run.
    PERFORM public.log_cron_defect('guarantee_sweep', r.id::text, SQLERRM, jsonb_build_object('job_id', r.job_id));
    v_failed := v_failed + 1;
   END;
  END LOOP;
  RETURN jsonb_build_object('closed', v_closed, 'disputed', v_disputed, 'failed', v_failed, 'today', v_today);
END;
$fn$;
REVOKE ALL ON FUNCTION public.guarantee_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guarantee_sweep() TO service_role;

-- A card chargeback the bank decided for the cardholder (stripe-webhook's lost branch): the charge is gone for good,
-- payment_status stays 'chargeback' (which the sweep leaves alone), so an open request would never end. Closed as
-- 'job_moved_on', both told. Service only; job, then claim lock order.
CREATE OR REPLACE FUNCTION public.guarantee_close_on_lost_chargeback(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  c public.job_guarantee_claims%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.jobs jb WHERE jb.id = p_job_id FOR UPDATE;
  SELECT * INTO c FROM public.job_guarantee_claims
   WHERE job_id = p_job_id AND status IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating') FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.job_guarantee_claims
     SET status = 'closed', close_reason = 'job_moved_on', closed_at = now(), updated_at = now()
   WHERE id = c.id;
  PERFORM public.guarantee_tell(c.job_id, c.poster_id, 'Your Helpr Guarantee request is closed',
    'Your bank decided the card dispute for you and returned the payment, so there is nothing left to settle here.');
  PERFORM public.guarantee_tell(c.job_id, c.helper_id, 'The Helpr Guarantee request is closed',
    'The bank returned the payment for this job, so the request is closed.');
  RETURN 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guarantee_close_on_lost_chargeback(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guarantee_close_on_lost_chargeback(uuid) TO service_role;

-- The admin's dispute card and execute-dispute-split: the claim behind a dispute (service_role; the card reads
-- the table under the admin RLS policy above).
CREATE OR REPLACE FUNCTION public.guarantee_claim_for_dispute(p_dispute_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  -- By the dispute's JOB, not the claim's dispute_id: rpc_supersede_dispute_decision retires a dispute and opens a
  -- new one on the same job, and that one must keep the price-only rule too (lh-money-escrow review, must-fix 1).
  SELECT jsonb_build_object('claim_id', g.id, 'job_id', g.job_id, 'refund_basis', 'job_price_only')
    FROM public.disputes d
    JOIN public.job_guarantee_claims g ON g.job_id = d.job_id
   WHERE d.id = p_dispute_id AND g.status = 'disputed' AND d.created_at >= g.created_at;
$fn$;
REVOKE ALL ON FUNCTION public.guarantee_claim_for_dispute(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guarantee_claim_for_dispute(uuid) TO service_role;

-- 6. The hold: restated from 20261025162003 with one rule added at the end (an open claim holds the job).
CREATE OR REPLACE FUNCTION public.refuse_payout_claim_while_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_customer uuid;
  v_helper   uuid;
BEGIN
  IF NEW.helper_id IS NOT NULL
     AND NEW.status = 'pending'
     AND NEW.stripe_transfer_id IS NULL
     AND EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = NEW.helper_id) THEN
    RAISE EXCEPTION 'payout_held'
      USING ERRCODE = '23514',
            DETAIL = 'This Helpr''s payouts are on hold (public.payout_holds). No transfer may be claimed until an admin releases the hold.';
  END IF;
  -- Owner 2026-10-25 (payout_after_hire): the ID check comes after the hire,
  -- so while identity_check is on for this Helpr their pay waits for it here
  -- (the accept no longer does). FALSE while identity_check is off.
  IF NEW.helper_id IS NOT NULL
     AND NEW.status = 'pending'
     AND NEW.stripe_transfer_id IS NULL
     AND public.payout_waits_on_identity(NEW.helper_id) THEN
    RAISE EXCEPTION 'payout_held'
      USING ERRCODE = '23514',
            DETAIL = 'This Helpr has not finished the ID check (payout_waits_on_identity). No transfer may be claimed until it is done.';
  END IF;
  -- Q1324: a job whose POSTER or Helpr is under an open ban settlement review
  -- moves no money until an admin decides (the Helpr also has a payout hold;
  -- the poster's counterparty does not, so the job is checked here). The
  -- claim's own recipient too: on a crew job jobs.helper_id is NULL and the
  -- member paid is NEW.helper_id (lh-money-escrow F4, 2026-10-06).
  IF NEW.status = 'pending' AND NEW.stripe_transfer_id IS NULL THEN
    -- FOR KEY SHARE: the parties read are the ones the claim is for, and a
    -- concurrent settlement cannot swap them out from under it.
    SELECT j.customer_id, j.helper_id INTO v_customer, v_helper
      FROM public.jobs j
     WHERE j.id = NEW.job_id
       FOR KEY SHARE;
    IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                WHERE q.review_state = 'open' AND q.user_id IN (v_customer, v_helper, NEW.helper_id)) THEN
      RAISE EXCEPTION 'payout_held'
        USING ERRCODE = '23514',
              DETAIL = 'An account on this job is under a ban settlement review (public.ban_settlement_queue). No transfer may be claimed until an admin confirms or lifts it.';
    END IF;
    -- Q1491: a job held on its own (a gift-card difference payment whose gift
    -- was not there any more) pays nobody until an admin reconciles it.
    IF EXISTS (SELECT 1 FROM public.job_payout_holds jh WHERE jh.job_id = NEW.job_id) THEN
      RAISE EXCEPTION 'payout_held'
        USING ERRCODE = '23514',
              DETAIL = 'This job''s payout is on hold (public.job_payout_holds). No transfer may be claimed until an admin releases it.';
    END IF;
    -- Helpr Guarantee (owner 2026-10-27): while the poster's "Not done right" request is open, the Helpr's pay
    -- for this job waits. rpc_guarantee_open locks the job row FOR UPDATE and this read is under the KEY SHARE
    -- lock above, so a claim and a payout on one job are ordered: one sees the other.
    IF EXISTS (SELECT 1 FROM public.job_guarantee_claims g
                WHERE g.job_id = NEW.job_id AND g.status IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating')) THEN
      RAISE EXCEPTION 'payout_held'
        USING ERRCODE = '23514',
              DETAIL = 'The poster asked for a fix under the Helpr Guarantee (public.job_guarantee_claims). No transfer may be claimed until it is settled.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.refuse_payout_claim_while_held() FROM PUBLIC, anon, authenticated, service_role;

-- 7. The chat stays open while a claim is open, and 24 h after it closes. Restated from 20260919220233;
-- the 'completed' arm keeps its rule and takes the later of the two.
CREATE OR REPLACE FUNCTION public.job_messaging_closes_at(_job_id uuid)
RETURNS timestamp with time zone
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE j.status
    WHEN 'completed' THEN
      CASE
        -- Helpr Guarantee (owner 2026-10-27): the two arrange the fix in the chat.
        WHEN EXISTS (SELECT 1 FROM public.job_guarantee_claims g
                      WHERE g.job_id = j.id AND g.status IN ('awaiting_helpr', 'fix_scheduled', 'fixed', 'escalating')) THEN NULL
        ELSE GREATEST(
          -- UNCHANGED from the shipped behaviour: 24h after completion.
          COALESCE(
            j.completed_at,
            public.job_legacy_completed_at(j.poster_completed_at, j.helper_completed_at,
                                           j.revision_completed_at, j.updated_at)
          ) + interval '24 hours',
          (SELECT max(g.closed_at) + interval '24 hours' FROM public.job_guarantee_claims g WHERE g.job_id = j.id))
      END
    WHEN 'cancelled' THEN
      -- Already in the past by construction. See the NULL trap note above:
      -- updated_at and created_at are both NOT NULL, so this arm can never
      -- evaluate to NULL and can never fall through to "still open".
      COALESCE(j.cancelled_at, j.updated_at, j.created_at)
    ELSE NULL
  END
  FROM public.jobs j
  WHERE j.id = _job_id;
$function$;
REVOKE ALL ON FUNCTION public.job_messaging_closes_at(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_messaging_closes_at(uuid) TO service_role;

-- 8. The clock: every 5 minutes, pure SQL (a party's "Can't fix" / "Still not right" becomes a dispute within minutes).
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('helpr-guarantee-sweep', interval '30 minutes',
            'Helpr Guarantee (owner 2026-10-27): turns a Helpr''s silence (48 h) or an undone fix into a dispute, and closes a claim the poster did not answer within 48 h of "fixed" so the Helpr is paid.',
            'exempt', 'Almost every run finds nothing due: claims are rare and each deadline is days apart.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('helpr-guarantee-sweep', '4-59/5 * * * *',
      $c$SELECT public.cron_record_work('helpr-guarantee-sweep', to_jsonb(public.guarantee_sweep()));$c$);
  END IF;
END
$do$;
