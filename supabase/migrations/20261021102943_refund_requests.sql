-- Board 141, Jobs side (docs/OPEN.md Q2272; owner 2026-10-21: BUILD BOTH
-- SIDES, the money moves automatically when the other side agrees). Declutter
-- is a later, separate slice.
--
-- A poster asks the Helpr on a held job for part or all of the money back.
-- The Helpr answers within 2 days:
--   * Agree: a DECIDED dispute is recorded at once, decided_via 'agreement',
--     both parties named (agreed_poster_id, agreed_helper_id), with the shares
--     computed here from the stored request, never from the client. The money
--     then moves through the ONE settlement path, execute-dispute-split, run
--     by the service-only refund-request-sweep (refund_agreements_due hands
--     out each agreement once per attempt; refund_agreement_for_dispute is the
--     proof of the other side's recorded agreement the split's service door
--     requires before any Stripe call).
--   * I don't agree, or no answer in 2 days: a normal dispute is opened with
--     open_dispute_as (the poster's complaint, the 72-hour clock, admins told).
--   * Come back and finish: request_job_schedule_change, unchanged (the
--     existing date/time request the poster accepts or declines).
--
-- While a request is open (or agreed and not yet settled) no money may leave
-- toward the Helpr: refuse_payout_pending_while_refund_requested refuses
-- escrow -> payout_pending on every path (auto-release-payment, the release
-- button), the same way ban reviews do (20261006030849).
--
-- Switch: refund_requests (testers). Both client RPCs start with
-- require_feature and are REVOKEd from PUBLIC, anon. Every other function is
-- service-only. refund_requests: RLS on, the two parties (and admins) read
-- their own rows, no client grant to write.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS, the
-- switch ON CONFLICT DO NOTHING, the cron unschedule-then-schedule.
-- Proof: src/test/pglite/refundRequests.pglite.mjs (red on main with
-- NEW_MIGRATION=skip; this file applied 3x).

-- ── 1. The switch ─────────────────────────────────────────────────────────
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('refund_requests', 'testers',
        'Board 141 (Q2272): a poster asks the Helpr for part or all of a held job''s money back. The Helpr agrees (the money moves automatically), offers to come back and finish, or says no (a normal dispute).')
ON CONFLICT (key) DO NOTHING;

-- ── 2. A dispute decided by the two parties' agreement ────────────────────
-- decided_by stays the admin column (uuid, auth.users); an agreement has no
-- admin, so it is told apart by decided_via and names both parties.
ALTER TABLE public.disputes ADD COLUMN IF NOT EXISTS decided_via text;
ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS agreed_poster_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.disputes
  ADD COLUMN IF NOT EXISTS agreed_helper_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disputes_decided_via_check'
                    AND conrelid = 'public.disputes'::regclass) THEN
    ALTER TABLE public.disputes ADD CONSTRAINT disputes_decided_via_check
      CHECK (decided_via IS NULL OR decided_via = 'agreement');
  END IF;
END
$do$;

-- The three columns are the server's: no client write (a party's evidence
-- append or an admin's direct PATCH) may set or change them. NOT SECURITY
-- DEFINER on purpose, as enforce_dispute_markers_server_owned: current_user is
-- the caller's role, so a definer RPC (postgres) and the service key pass and
-- only a direct client write (authenticated / anon) is judged.
CREATE OR REPLACE FUNCTION public.enforce_dispute_agreement_columns_server_owned()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.decided_via IS NOT NULL OR NEW.agreed_poster_id IS NOT NULL OR NEW.agreed_helper_id IS NOT NULL THEN
      RAISE EXCEPTION 'dispute_agreement_server_owned' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.decided_via IS DISTINCT FROM OLD.decided_via
     OR NEW.agreed_poster_id IS DISTINCT FROM OLD.agreed_poster_id
     OR NEW.agreed_helper_id IS DISTINCT FROM OLD.agreed_helper_id THEN
    RAISE EXCEPTION 'dispute_agreement_server_owned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_dispute_agreement_columns_server_owned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dispute_agreement_columns_server_owned ON public.disputes;
CREATE TRIGGER trg_dispute_agreement_columns_server_owned
  BEFORE INSERT OR UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_dispute_agreement_columns_server_owned();

-- ── 3. refund_requests ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  -- The poster who asked and the Helpr asked. SET NULL on an account delete,
  -- which delete-own-account refuses while a request is open or agreed and
  -- unsettled (_shared/accountPurge.ts, Q2273).
  requester_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  responder_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  refund_scope text NOT NULL CHECK (refund_scope IN ('part', 'all')),
  -- Server-computed: the job's price in cents when asked, and the part of it
  -- asked back ('all' = the whole price). The split's shares come from these.
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  budget_cents integer NOT NULL CHECK (budget_cents > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 15 AND 1000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'agreed', 'declined', 'finish_offered', 'coming_back', 'expired', 'closed')),
  answer_by timestamptz NOT NULL,
  answered_at timestamptz,
  answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The decided (agreed) or opened (declined / expired) dispute.
  dispute_id uuid REFERENCES public.disputes(id) ON DELETE SET NULL,
  -- "Come back and finish": the date/time request it sent.
  schedule_change_id uuid REFERENCES public.job_schedule_change_requests(id) ON DELETE SET NULL,
  -- 'closed': the job moved on before an answer (its code).
  closed_reason text,
  -- The sweep's settlement attempts on an agreement (at most 3, 30 min apart).
  settle_attempts integer NOT NULL DEFAULT 0 CHECK (settle_attempts >= 0),
  last_settle_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_requests_amount_within_price CHECK (amount_cents <= budget_cents),
  CONSTRAINT refund_requests_all_is_whole CHECK (refund_scope <> 'all' OR amount_cents = budget_cents),
  CONSTRAINT refund_requests_part_is_part CHECK (refund_scope <> 'part' OR amount_cents < budget_cents),
  -- An agreement always carries its decided dispute and who agreed.
  CONSTRAINT refund_requests_agreed_has_dispute CHECK (status <> 'agreed' OR (dispute_id IS NOT NULL AND answered_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_open_per_job ON public.refund_requests (job_id) WHERE status = 'open';
-- One agreement per dispute: one money move per agreement.
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_per_dispute ON public.refund_requests (dispute_id) WHERE dispute_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS refund_requests_job_idx ON public.refund_requests (job_id);
CREATE INDEX IF NOT EXISTS refund_requests_requester_idx ON public.refund_requests (requester_id);
CREATE INDEX IF NOT EXISTS refund_requests_responder_idx ON public.refund_requests (responder_id);
CREATE INDEX IF NOT EXISTS refund_requests_answered_by_idx ON public.refund_requests (answered_by);
CREATE INDEX IF NOT EXISTS refund_requests_schedule_change_idx ON public.refund_requests (schedule_change_id);
CREATE INDEX IF NOT EXISTS refund_requests_open_answer_by_idx ON public.refund_requests (answer_by) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS refund_requests_agreed_idx ON public.refund_requests (last_settle_at) WHERE status = 'agreed';

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.refund_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.refund_requests TO authenticated;
GRANT ALL ON TABLE public.refund_requests TO service_role;

DROP POLICY IF EXISTS "refund requests parties read" ON public.refund_requests;
CREATE POLICY "refund requests parties read" ON public.refund_requests
  FOR SELECT TO authenticated
  USING (requester_id = (SELECT auth.uid()) OR responder_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "refund requests admin read" ON public.refund_requests;
CREATE POLICY "refund requests admin read" ON public.refund_requests
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

COMMENT ON TABLE public.refund_requests IS
  'Board 141 (Q2272): a poster''s request to the Helpr for part or all of a held job''s money back. Written only by rpc_open_refund_request, rpc_answer_refund_request and the service sweep (20261021102943).';

DROP TRIGGER IF EXISTS update_refund_requests_updated_at ON public.refund_requests;
CREATE TRIGGER update_refund_requests_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. Shared pieces ──────────────────────────────────────────────────────
-- "$20" for whole dollars, "$20.50" otherwise.
CREATE OR REPLACE FUNCTION public.refund_request_dollars(p_cents integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $fn$
  SELECT CASE
           WHEN p_cents IS NULL THEN ''
           WHEN p_cents % 100 = 0 THEN '$' || (p_cents / 100)::text
           ELSE '$' || to_char(p_cents / 100.0, 'FM999999990.00')
         END
$fn$;
REVOKE ALL ON FUNCTION public.refund_request_dollars(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_request_dollars(integer) TO service_role;

-- Owner 2026-10-21: an agreed PART refund also returns the rush (urgent) fee in
-- the SAME share as the price (no cliff). The SQL twin of agreedRushRefundCents
-- (supabase/functions/_shared/refundRush.ts), which execute-dispute-split pays
-- by: rush x asked / price, rounded half up to the cent, in integers only.
-- Parity: src/test/pglite/refundRequests.pglite.mjs runs both on a sweep.
CREATE OR REPLACE FUNCTION public.refund_request_rush_back_cents(p_rush_cents integer, p_asked_cents integer, p_price_cents integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $fn$
  SELECT CASE
           WHEN COALESCE(p_rush_cents, 0) <= 0 OR COALESCE(p_asked_cents, 0) <= 0 OR COALESCE(p_price_cents, 0) <= 0 THEN 0
           WHEN p_asked_cents >= p_price_cents THEN p_rush_cents
           ELSE ((2::bigint * p_rush_cents * p_asked_cents + p_price_cents) / (2::bigint * p_price_cents))::integer
         END
$fn$;
REVOKE ALL ON FUNCTION public.refund_request_rush_back_cents(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_request_rush_back_cents(integer, integer, integer) TO service_role;

-- Refuses (with the code) unless the job is one a refund request can be on:
-- a one-time, single-Helpr job, booked or under way, its money held in escrow,
-- with no dispute open or decided-and-unsettled and no settlement in flight.
-- Read under the caller's FOR UPDATE on the job.
CREATE OR REPLACE FUNCTION public.refund_request_assert_job_open(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_job record;
BEGIN
  SELECT j.id, j.status::text AS status, j.payment_status, j.helper_id, j.is_group_job,
         j.parent_job_id, j.recurrence_days
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'refund_request_job_not_found';
  END IF;
  IF COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'refund_request_crew_job';
  END IF;
  IF v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL THEN
    RAISE EXCEPTION 'refund_request_not_one_time';
  END IF;
  IF v_job.helper_id IS NULL THEN
    RAISE EXCEPTION 'refund_request_no_helpr';
  END IF;
  IF v_job.status NOT IN ('accepted', 'in_progress', 'revision_requested') THEN
    RAISE EXCEPTION 'refund_request_job_not_active';
  END IF;
  IF v_job.payment_status IS DISTINCT FROM 'escrow' THEN
    RAISE EXCEPTION 'refund_request_not_held';
  END IF;
  IF EXISTS (SELECT 1 FROM public.disputes d
              WHERE d.job_id = p_job_id
                AND (d.status = 'open'
                     OR (d.status = 'decided' AND d.execution_status IS DISTINCT FROM 'executed')))
     OR EXISTS (SELECT 1 FROM public.dispute_settlement_claims c WHERE c.job_id = p_job_id) THEN
    RAISE EXCEPTION 'refund_request_dispute_open';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refund_request_assert_job_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_request_assert_job_open(uuid) TO service_role;

-- A party money must not be moved for automatically (lead, 2026-10-21): banned
-- or suspended (as is_caller_banned reads it, a lapsed suspension excepted),
-- under an open ban settlement review, or on a payout hold. TRUE refuses, so
-- an unknown person (NULL) is TRUE: it fails safe. An agreement with such a
-- party goes to an admin instead (refund_agreements_due, and the proof
-- refund_agreement_for_dispute refuses it, so the service door does too).
CREATE OR REPLACE FUNCTION public.refund_party_held(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $fn$
  SELECT p_user IS NULL
      OR EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = p_user
                    AND p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
                    AND (p.ban_status <> 'temp_banned'
                         OR p.auto_suspended_until IS NULL
                         OR p.auto_suspended_until > now()))
      OR EXISTS (SELECT 1 FROM public.ban_settlement_queue q
                  WHERE q.user_id = p_user AND q.review_state = 'open')
      OR EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = p_user)
$fn$;
REVOKE ALL ON FUNCTION public.refund_party_held(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_party_held(uuid) TO service_role;

-- ── 5. Ask (the poster) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_open_refund_request(
  p_job_id uuid,
  p_scope text,
  p_amount_cents integer,
  p_reason text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_budget integer;
  v_amount integer;
  v_reason text;
  v_asked integer;
  v_id uuid;
  v_poster text;
BEGIN
  PERFORM public.require_feature('refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_job_id IS NULL OR p_scope IS NULL OR p_scope NOT IN ('part', 'all') THEN
    RAISE EXCEPTION 'refund_request_invalid';
  END IF;

  -- Lock order jobs -> refund_requests (as every refund-request writer).
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.budget
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'refund_request_job_not_found';
  END IF;
  -- Only the person who posted (and paid for) this job asks.
  IF v_uid IS DISTINCT FROM v_job.customer_id THEN
    RAISE EXCEPTION 'refund_request_not_poster' USING ERRCODE = '42501';
  END IF;
  PERFORM public.refund_request_assert_job_open(p_job_id);
  -- The Helpr must have the switch too (lh-authz-rls review): a Helpr it is
  -- off for cannot see or answer a request, so it would only freeze their pay
  -- and file a dispute against them two days later.
  IF NOT COALESCE(public.feature_enabled_for_user('refund_requests', v_job.helper_id), false) THEN
    RAISE EXCEPTION 'refund_request_helpr_not_enabled' USING ERRCODE = '42501';
  END IF;

  -- One LIVE request per job, not just one 'open' one (both reviews,
  -- 2026-10-21): a come-back offered or accepted, a decline not yet filed and
  -- an agreement not yet settled all still hold the money for the first ask.
  IF EXISTS (SELECT 1 FROM public.refund_requests r
              WHERE r.job_id = p_job_id
                AND public.refund_request_is_live(r.status, r.dispute_id)) THEN
    RAISE EXCEPTION 'refund_request_already_open';
  END IF;
  SELECT count(*) INTO v_asked FROM public.refund_requests r WHERE r.job_id = p_job_id;
  IF v_asked >= 3 THEN
    RAISE EXCEPTION 'refund_request_limit';
  END IF;

  -- THE AMOUNT IS THE SERVER'S. The price is read from the job here; 'all' is
  -- the whole price whatever the client sent; 'part' must be at least $1 and
  -- less than the price. The shares the split moves are derived from these
  -- two stored figures when the Helpr agrees.
  v_budget := round(COALESCE(v_job.budget, 0) * 100)::integer;
  IF v_budget <= 0 THEN
    RAISE EXCEPTION 'refund_request_no_price';
  END IF;
  IF p_scope = 'all' THEN
    v_amount := v_budget;
  ELSE
    IF p_amount_cents IS NULL OR p_amount_cents < 100 OR p_amount_cents >= v_budget THEN
      RAISE EXCEPTION 'refund_request_amount_invalid';
    END IF;
    v_amount := p_amount_cents;
  END IF;

  v_reason := btrim(COALESCE(p_reason, ''));
  IF char_length(v_reason) < 15 THEN
    RAISE EXCEPTION 'refund_request_needs_reason';
  END IF;
  IF char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'refund_request_reason_too_long';
  END IF;

  INSERT INTO public.refund_requests
    (job_id, requester_id, responder_id, refund_scope, amount_cents, budget_cents, reason, answer_by)
  VALUES
    (p_job_id, v_uid, v_job.helper_id, p_scope, v_amount, v_budget, v_reason, now() + interval '2 days')
  RETURNING id INTO v_id;

  SELECT public.member_display_name(p.full_name, 'The person who posted it') INTO v_poster
    FROM public.profiles p WHERE p.user_id = v_uid;
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_job.helper_id, p_job_id,
    'Refund request',
    format('%s asked for %s back on "%s". Answer within 2 days, or it goes to Helpr to decide.',
           COALESCE(v_poster, 'The person who posted it'),
           public.refund_request_dollars(v_amount),
           COALESCE(v_job.title, 'your job')),
    'payment',
    '/jobs?job=' || p_job_id::text
  );

  RETURN v_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_open_refund_request(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_open_refund_request(uuid, text, integer, text) TO authenticated;

-- ── 6. Answer (the Helpr) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_answer_refund_request(
  p_request_id uuid,
  p_answer text,
  p_date date DEFAULT NULL,
  p_start_time time without time zone DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job_id uuid;
  v_job record;
  v_req record;
  v_poster_share numeric;
  v_helper_share numeric;
  v_dispute uuid;
  v_change jsonb;
  v_helpr text;
  v_money text;
  v_rush_back integer;
BEGIN
  PERFORM public.require_feature('refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_answer IS NULL OR p_answer NOT IN ('agree', 'finish', 'decline') THEN
    RAISE EXCEPTION 'refund_request_invalid';
  END IF;

  SELECT r.job_id INTO v_job_id FROM public.refund_requests r WHERE r.id = p_request_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'refund_request_not_found';
  END IF;
  -- Lock order jobs -> refund_requests; judged from the locked re-reads.
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.budget, j.urgent_fee
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.refund_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL OR v_job.id IS NULL THEN
    RAISE EXCEPTION 'refund_request_not_found';
  END IF;
  -- Only the Helpr asked, and still the job's Helpr, answers. IS DISTINCT
  -- FROM: a NULL on either side (an account gone) refuses.
  IF v_uid IS DISTINCT FROM v_req.responder_id OR v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'refund_request_not_yours' USING ERRCODE = '42501';
  END IF;
  IF v_req.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'refund_request_answered';
  END IF;
  -- The poster's account is gone (its delete is refused while a request is
  -- live, so this is a backstop): nobody to refund, nothing to agree to.
  IF v_req.requester_id IS NULL OR v_req.requester_id IS DISTINCT FROM v_job.customer_id THEN
    RAISE EXCEPTION 'refund_request_poster_gone';
  END IF;
  IF now() >= v_req.answer_by THEN
    RAISE EXCEPTION 'refund_request_expired';
  END IF;
  PERFORM public.refund_request_assert_job_open(v_job_id);

  SELECT public.member_display_name(p.full_name, 'Your Helpr') INTO v_helpr
    FROM public.profiles p WHERE p.user_id = v_uid;
  v_helpr := COALESCE(v_helpr, 'Your Helpr');
  v_money := public.refund_request_dollars(v_req.amount_cents);
  -- Owner 2026-10-21: an agreed part also returns the same share of the rush
  -- fee (refund_request_rush_back_cents == execute-dispute-split's rule).
  v_rush_back := CASE WHEN v_req.refund_scope = 'part'
    THEN public.refund_request_rush_back_cents(greatest(round(COALESCE(v_job.urgent_fee, 0) * 100), 0)::integer,
                                               v_req.amount_cents, v_req.budget_cents)
    ELSE 0 END;

  IF p_answer = 'agree' THEN
    -- The price the request was computed on must still be the job's price
    -- (a booked job's price is locked, so this is a backstop).
    IF round(COALESCE(v_job.budget, 0) * 100)::integer IS DISTINCT FROM v_req.budget_cents THEN
      RAISE EXCEPTION 'refund_request_stale';
    END IF;
    -- Shares of the award, as rpc_decide_dispute records them (fractions).
    -- From the STORED request only: nothing the client sends reaches them.
    v_poster_share := round(v_req.amount_cents::numeric / v_req.budget_cents, 8);
    v_helper_share := 1 - v_poster_share;

    INSERT INTO public.disputes
      (job_id, opener_id, reason, evidence_urls, status, decided_at, decided_by, decided_via,
       agreed_poster_id, agreed_helper_id, decision_text, payout_split, execution_status)
    VALUES
      (v_job_id, v_req.requester_id, v_req.reason, '{}'::text[], 'decided', now(), NULL, 'agreement',
       v_req.requester_id, v_uid,
       CASE WHEN v_rush_back > 0
         THEN format('Agreed by both: %s of the %s price and %s of the rush fee back to the person who posted it.',
                     v_money, public.refund_request_dollars(v_req.budget_cents), public.refund_request_dollars(v_rush_back))
         ELSE format('Agreed by both: %s of the %s price back to the person who posted it.',
                     v_money, public.refund_request_dollars(v_req.budget_cents)) END,
       jsonb_build_object('poster', v_poster_share, 'helper', v_helper_share),
       -- Decided, not settled: the sweep runs execute-dispute-split on it.
       'pending')
    RETURNING id INTO v_dispute;

    UPDATE public.refund_requests
       SET status = 'agreed', answered_at = now(), answered_by = v_uid, dispute_id = v_dispute
     WHERE id = p_request_id;

    -- The audit row: who agreed to what, before any money moves. Not
    -- swallowed: an agreement with no trail does not stand.
    INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
    VALUES (NULL, 'refund_agreement_recorded', v_dispute::text, 'dispute',
            jsonb_build_object('request_id', p_request_id, 'job_id', v_job_id,
                               'poster_id', v_req.requester_id, 'helper_id', v_uid,
                               'amount_cents', v_req.amount_cents, 'budget_cents', v_req.budget_cents,
                               'poster_share', v_poster_share, 'helper_share', v_helper_share));

    IF v_req.requester_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requester_id, v_job_id,
        'Refund agreed',
        -- Q2298 (owner, 2026-10-21): a PART refund returns EXACTLY the amount
        -- asked; ALL of it returns what was paid less the card processing fee,
        -- as an admin's full refund does (execute-dispute-split).
        CASE WHEN v_req.refund_scope = 'all'
          THEN format('%s agreed to refund all of "%s". What you paid is on its way back to how you paid, less the card processing fee. Your receipt shows the exact amount.',
                      v_helpr, COALESCE(v_job.title, 'your job'))
          WHEN v_rush_back > 0
          THEN format('%s agreed to your refund on "%s": %s is on its way back to how you paid (%s of the price and %s of the rush fee).',
                      v_helpr, COALESCE(v_job.title, 'your job'), public.refund_request_dollars(v_req.amount_cents + v_rush_back),
                      v_money, public.refund_request_dollars(v_rush_back))
          ELSE format('%s agreed to your refund on "%s": %s is on its way back to how you paid.',
                      v_helpr, COALESCE(v_job.title, 'your job'), v_money)
        END,
        'payment',
        '/posts?job=' || v_job_id::text
      );
    END IF;
    RETURN jsonb_build_object('status', 'agreed', 'dispute_id', v_dispute);

  ELSIF p_answer = 'decline' THEN
    -- A normal dispute, filed as the poster's complaint in their own words,
    -- is opened by the service sweep (refund_requests_sweep, within minutes),
    -- never here: open_dispute_as writes the job's dispute markers, and from
    -- the Helpr's own session enforce_helper_jobs_column_whitelist refuses a
    -- changed dispute_resolved_at (a job whose earlier dispute was
    -- withdrawn). Until it opens, refuse_payout_pending_while_refund_requested
    -- and every payout path treat this declined request as live.
    UPDATE public.refund_requests
       SET status = 'declined', answered_at = now(), answered_by = v_uid
     WHERE id = p_request_id;
    IF v_req.requester_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requester_id, v_job_id,
        'Your refund request goes to Helpr',
        format('%s didn''t agree to the refund on "%s". A real person at Helpr will decide. The payment stays on hold until then.',
               v_helpr, COALESCE(v_job.title, 'your job')),
        'payment',
        '/posts?job=' || v_job_id::text
      );
    END IF;
    RETURN jsonb_build_object('status', 'declined');

  ELSE
    -- 'finish': the existing date/time request. Its own rules (a time at
    -- least an hour out, no clash) apply. Q2326 (owner, 2026-10-21): on a job
    -- already UNDER WAY it accepts the new time only for this answer, under
    -- the transaction-local flag set just around the call (section 6b); a
    -- booked job not started yet goes through it exactly as before.
    IF p_date IS NULL THEN
      RAISE EXCEPTION 'refund_request_needs_time';
    END IF;
    -- A come-back is within 7 days (owner, 2026-10-21; first set at 14 by the
    -- reviews): the request holds the payment while it waits, so the Helpr
    -- cannot push it out without limit.
    IF p_date > (now() AT TIME ZONE 'America/Chicago')::date + 7 THEN
      RAISE EXCEPTION 'refund_request_finish_too_far';
    END IF;
    PERFORM set_config('app.refund_finish_rpc', '1', true);
    v_change := public.request_job_schedule_change(v_job_id, p_date, p_start_time);
    PERFORM set_config('app.refund_finish_rpc', '0', true);
    UPDATE public.refund_requests
       SET status = 'finish_offered', answered_at = now(), answered_by = v_uid,
           schedule_change_id = NULLIF(v_change->>'request_id', '')::uuid
     WHERE id = p_request_id;
    IF v_req.requester_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requester_id, v_job_id,
        'Offer to come back and finish',
        format('%s offered to come back and finish "%s" on %s%s instead of a refund. Accept the new time on the job, or decline it and a real person at Helpr will decide.',
               v_helpr, COALESCE(v_job.title, 'your job'),
               to_char(p_date, 'FMDy FMMon FMDD'),
               CASE WHEN p_start_time IS NULL THEN '' ELSE ' at ' || to_char(p_start_time, 'FMHH12:MI AM') END),
        'job_updates',
        '/posts?job=' || v_job_id::text
      );
    END IF;
    RETURN jsonb_build_object('status', 'finish_offered',
                              'schedule_change_id', v_change->>'request_id');
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_answer_refund_request(uuid, text, date, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_answer_refund_request(uuid, text, date, time without time zone) TO authenticated;

-- ── 6b. Come back and finish on a job under way (Q2326) ───────────────────
-- Owner, 2026-10-21: "Come back and finish" works on a STARTED job, through
-- the existing date/time request: the Helpr proposes a new time, the poster
-- accepts it, or declines and it goes on to a dispute.
--
-- Both RPCs are restated VERBATIM from their newest definition
-- (20261015015604_schedule_change_uses_booking_rule.sql; md5(prosrc) live =
-- that file, read 2026-10-21) with only these changes:
--   request_job_schedule_change: v_finish (the Helpr answering a LIVE open
--     refund request on this job, inside rpc_answer_refund_request, which
--     sets app.refund_finish_rpc just around the call) lets an IN-PROGRESS
--     job through 'schedule_change_not_booked' and past
--     'schedule_change_too_late' (its original start has passed); such a
--     request lapses at the proposed new start instead of the original one,
--     and its notice is the refund answer's own (no second one).
--   respond_job_schedule_change: a request that answers a refund request
--     ('finish_offered', linked by schedule_change_id) is judged on an
--     in-progress job too. Accepted: the job moves to the new time, the
--     Helpr's earlier "done" is cleared (so no payout clock runs until they
--     mark it done again after coming back), and the refund request closes
--     as 'coming_back'. Declined, or lapsed: the refund request goes on to a
--     normal dispute (status 'declined', filed by refund_requests_sweep), and
--     the Helpr is told so.
-- Every raise code of the newest definitions is kept.
CREATE OR REPLACE FUNCTION public.request_job_schedule_change(p_job_id uuid, p_date date, p_start_time time)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job record;
  v_other uuid;
  v_starts_at timestamptz;
  v_new_at timestamptz;
  v_id uuid;
  v_replaced int;
  v_finish boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time,
         j.parent_job_id, j.recurrence_days, j.is_group_job, j.helper_completed_at,
         j.estimated_hours
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id
   FOR UPDATE;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;
  IF v_uid IS DISTINCT FROM v_job.customer_id AND v_uid IS DISTINCT FROM v_job.helper_id THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_job.parent_job_id IS NOT NULL OR v_job.recurrence_days IS NOT NULL OR COALESCE(v_job.is_group_job, false) THEN
    RAISE EXCEPTION 'schedule_change_not_one_time';
  END IF;
  -- Q2326: the Helpr answering a live refund request on this job with "Come
  -- back and finish" (rpc_answer_refund_request sets the flag just around
  -- this call). Never a direct call: without the flag nothing changes here.
  v_finish := COALESCE(current_setting('app.refund_finish_rpc', true), '') = '1'
    AND v_job.status::text = 'in_progress'
    AND v_job.helper_id IS NOT NULL
    AND v_uid IS NOT DISTINCT FROM v_job.helper_id
    AND EXISTS (SELECT 1 FROM public.refund_requests rr
                 WHERE rr.job_id = v_job.id
                   AND rr.status = 'open'
                   AND rr.responder_id = v_uid
                   AND rr.answer_by > now());
  IF NOT v_finish AND (v_job.status::text <> 'accepted' OR v_job.helper_id IS NULL OR v_job.helper_completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'schedule_change_not_booked';
  END IF;

  v_starts_at := (v_job.date_needed + COALESCE(v_job.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF NOT v_finish AND now() >= v_starts_at THEN
    RAISE EXCEPTION 'schedule_change_too_late';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'schedule_change_invalid';
  END IF;
  v_new_at := (p_date + COALESCE(p_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago';
  IF v_new_at <= now() THEN
    RAISE EXCEPTION 'schedule_change_in_past';
  END IF;
  -- At least an hour out (owner, 2026-10-08): a request for a start minutes
  -- away was accepted 19 s after that start and expired with nobody told
  -- (request 1f6349c9). An hour leaves the other person time to answer.
  IF v_new_at < now() + interval '1 hour' THEN
    RAISE EXCEPTION 'schedule_change_too_soon';
  END IF;
  IF p_date = v_job.date_needed AND p_start_time IS NOT DISTINCT FROM v_job.start_time THEN
    RAISE EXCEPTION 'schedule_change_same';
  END IF;

  -- Q736: the new start must not overlap another booking the Helpr already
  -- holds (their own hire, or a crew seat), ending at start + estimated_hours
  -- (1 hour when unset). A time-less side ("any time that day") is flexible
  -- and never clashes.
  IF p_start_time IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.jobs o
     WHERE o.id <> v_job.id
       AND o.date_needed = p_date
       AND o.start_time IS NOT NULL
       -- Q1676: the same booking rule as helpr_booking_clashes (20261012171958):
       -- their own hire while accepted / in progress and not yet marked done,
       -- OR a crew seat they hold (accepted, not marked done on their own row)
       -- on a crew job that is open (still filling), accepted or in progress.
       AND ((o.helper_id = v_job.helper_id
             AND o.status::text IN ('accepted', 'in_progress')
             AND o.helper_completed_at IS NULL)
            OR (o.status::text IN ('open', 'accepted', 'in_progress')
                AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                             WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                               AND g.status = 'accepted'
                               AND g.helper_completed_at IS NULL)))
       AND (p_date + p_start_time, p_date + p_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
           OVERLAPS
           (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
  ) THEN
    RAISE EXCEPTION 'schedule_change_clash';
  END IF;

  v_other := CASE WHEN v_uid = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END;

  UPDATE public.job_schedule_change_requests r
     SET status = CASE WHEN r.expires_at <= now() THEN 'expired' ELSE 'replaced' END,
         decided_at = now()
   WHERE r.job_id = v_job.id AND r.status = 'pending';
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  -- Q2326: a come-back offer on a job under way lapses at the proposed new
  -- start at the latest (the original one has passed); every other request at
  -- the original. The poster has 1 day to answer it (owner, 2026-10-21; the
  -- reviews first set 2), never longer, whatever new time was proposed.
  IF v_finish THEN
    v_starts_at := LEAST(v_new_at, now() + interval '1 day');
  END IF;

  INSERT INTO public.job_schedule_change_requests
    (job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, expires_at)
  VALUES
    (v_job.id, v_uid, v_other, v_job.date_needed, v_job.start_time, p_date, p_start_time, v_starts_at)
  RETURNING id INTO v_id;

  -- A come-back offer is announced by the refund answer itself (one notice).
  IF NOT v_finish THEN
  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_other, v_job.id,
    'New date or time requested',
    format('%s asked to move "%s" to %s%s. Nothing changes unless you accept.%s',
           CASE WHEN v_uid = v_job.customer_id THEN 'The person who posted it' ELSE 'The Helpr doing it' END,
           COALESCE(v_job.title, 'your job'),
           to_char(p_date, 'FMDy FMMon FMDD'),
           CASE WHEN p_start_time IS NULL THEN '' ELSE ' at ' || to_char(p_start_time, 'FMHH12:MI AM') END,
           CASE WHEN v_replaced > 0 THEN ' This replaces their earlier request.' ELSE '' END),
    'job_updates',
    CASE WHEN v_other = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );
  END IF;

  RETURN jsonb_build_object('request_id', v_id, 'expires_at', v_starts_at, 'replaced', v_replaced);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.respond_job_schedule_change(p_request_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_req record;
  v_job record;
  v_status text;
  v_reason text;
  v_refund_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;

  -- Job first, then the request: the same order request_job_schedule_change
  -- takes (job FOR UPDATE, then the pending row).
  SELECT r.job_id INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id;
  IF v_req.job_id IS NULL THEN
    RAISE EXCEPTION 'request_not_found';
  END IF;
  SELECT j.id, j.title, j.customer_id, j.helper_id, j.status, j.date_needed, j.start_time,
         j.estimated_hours
    INTO v_job
    FROM public.jobs j
   WHERE j.id = v_req.job_id
   FOR UPDATE;
  SELECT r.* INTO v_req FROM public.job_schedule_change_requests r WHERE r.id = p_request_id FOR UPDATE;
  -- Q2326: the refund request this one answers ("Come back and finish"), if
  -- any. Locked after the job and this row (refund writers lock jobs ->
  -- refund_requests and never take a schedule-change row).
  SELECT rr.id INTO v_refund_id
    FROM public.refund_requests rr
   WHERE rr.schedule_change_id = p_request_id AND rr.status = 'finish_offered'
   FOR UPDATE;

  -- Only the party the request is addressed to, and only while they are still
  -- that party on the job.
  IF v_uid IS DISTINCT FROM v_req.responder_id
     OR v_uid IS DISTINCT FROM (CASE WHEN v_req.requested_by = v_job.customer_id THEN v_job.helper_id ELSE v_job.customer_id END) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_req.status <> 'pending' THEN
    RETURN jsonb_build_object('status', v_req.status);
  END IF;

  -- Expired (unanswered by the original start), or the job moved on since it
  -- was asked: nothing changes. Q2326: a come-back offer is judged on a job
  -- under way too; lapsed or moved on, its refund request goes on to Helpr.
  IF now() >= v_req.expires_at
     OR (v_job.status::text <> 'accepted' AND NOT (v_refund_id IS NOT NULL AND v_job.status::text = 'in_progress'))
     OR v_job.date_needed IS DISTINCT FROM v_req.old_date
     OR v_job.start_time IS DISTINCT FROM v_req.old_start_time THEN
    UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
    IF v_refund_id IS NOT NULL THEN
      -- A come-back offer that lapsed or whose job moved on: its refund
      -- request goes on to Helpr. Said as that, never as "the original start
      -- arrived" (lh-authz-rls review, 2026-10-21); the sweep files it.
      UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      VALUES (
        v_req.requested_by, v_job.id,
        'Offer to come back not answered in time',
        format('Your offer to come back and finish "%s" was not accepted in time, so a real person at Helpr will decide the refund.',
               COALESCE(v_job.title, 'the job')),
        'job_updates',
        '/jobs?job=' || v_job.id::text
      );
      RETURN jsonb_build_object('status', 'expired', 'reason', 'come_back_lapsed');
    END IF;
    v_reason := CASE WHEN now() >= v_req.expires_at THEN 'job_started' ELSE 'job_changed' END;
    PERFORM public.notify_schedule_change_expired(v_req.id, v_reason);
    RETURN jsonb_build_object('status', 'expired', 'reason', v_reason);
  END IF;

  IF p_accept THEN
    -- The new start must still be ahead.
    IF ((v_req.new_date + COALESCE(v_req.new_start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago') <= now() THEN
      UPDATE public.job_schedule_change_requests SET status = 'expired', decided_at = now() WHERE id = v_req.id;
      PERFORM public.notify_schedule_change_expired(v_req.id, 'new_time_passed');
      IF v_refund_id IS NOT NULL THEN
        UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
      END IF;
      RETURN jsonb_build_object('status', 'expired', 'reason', 'new_time_passed');
    END IF;

    -- Q925: the same clash check request_job_schedule_change runs, again at
    -- accept time. The request-time check is an unlocked read, and the Helpr
    -- can have been hired elsewhere in the days the request sat pending, so
    -- accepting could double-book them. Runs under the subject job's FOR
    -- UPDATE above and takes FOR SHARE on the overlapping bookings, so a
    -- cancel or completion of one waits for this accept instead of racing it.
    -- Q1262(2): a clash DECLINES the request (it can never be accepted while
    -- the Helpr is booked then) and tells whoever asked, instead of rolling
    -- back and leaving it pending with nobody told.
    -- A time-less new start ("any time that day") is flexible and never clashes.
    -- Two requests on two DIFFERENT jobs of the same Helpr, accepted at the same
    -- moment, each lock only their own job and would both pass the check (write
    -- skew; lh-authz-rls review 2026-10-04): one advisory lock per Helpr makes
    -- those accepts take turns, so the second sees the first's new slot.
    IF v_req.new_start_time IS NOT NULL THEN
      IF v_job.helper_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('helpr_schedule:' || v_job.helper_id::text));
      END IF;
      PERFORM 1
        FROM public.jobs o
       WHERE o.id <> v_job.id
         AND o.date_needed = v_req.new_date
         AND o.start_time IS NOT NULL
         -- Q1676: the same booking rule as helpr_booking_clashes (see above).
         AND ((o.helper_id = v_job.helper_id
               AND o.status::text IN ('accepted', 'in_progress')
               AND o.helper_completed_at IS NULL)
              OR (o.status::text IN ('open', 'accepted', 'in_progress')
                  AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                               WHERE g.job_id = o.id AND g.helper_id = v_job.helper_id
                                 AND g.status = 'accepted'
                                 AND g.helper_completed_at IS NULL)))
         AND (v_req.new_date + v_req.new_start_time, v_req.new_date + v_req.new_start_time + make_interval(mins => round(COALESCE(v_job.estimated_hours, 1) * 60)::int))
             OVERLAPS
             (o.date_needed + o.start_time, o.date_needed + o.start_time + make_interval(mins => round(COALESCE(o.estimated_hours, 1) * 60)::int))
         FOR SHARE OF o;
      IF FOUND THEN
        UPDATE public.job_schedule_change_requests SET status = 'declined', decided_at = now() WHERE id = v_req.id;
        INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
        VALUES (
          v_req.requested_by, v_job.id,
          'New date or time not possible',
          format('"%s" stays on %s%s: the Helpr is already booked at the new time.', COALESCE(v_job.title, 'Your job'),
                 to_char(v_req.old_date, 'FMDy FMMon FMDD'),
                 CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END),
          'job_updates',
          CASE WHEN v_req.requested_by = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
        );
        IF v_refund_id IS NOT NULL THEN
          UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
        END IF;
        RETURN jsonb_build_object('status', 'declined', 'reason', 'schedule_change_clash');
      END IF;
    END IF;

    PERFORM set_config('app.schedule_change_rpc', '1', true);
    UPDATE public.jobs
       SET date_needed = v_req.new_date,
           start_time = v_req.new_start_time,
           -- The day-of machinery runs fresh for the new day (as a reopened
           -- job does, helper_cancel_booking).
           dayof_confirm_reminder_sent_at = NULL,
           dayof_unanswered_poster_alert_sent_at = NULL,
           start_reminder_sent_at = NULL
     WHERE id = v_job.id;
    PERFORM set_config('app.schedule_change_rpc', '0', true);
    -- Q2326: coming back to finish. The request turns 'coming_back', which
    -- still holds every payout; refund_requests_sweep (a server context, the
    -- only one enforce_completion_on_live_job lets clear a "done" stamp) then
    -- clears the Helpr's earlier "done", so no payout clock runs until they
    -- mark it done again, and closes the request: nothing was refunded.
    IF v_refund_id IS NOT NULL THEN
      UPDATE public.refund_requests SET status = 'coming_back' WHERE id = v_refund_id;
    END IF;
    v_status := 'accepted';
  ELSE
    v_status := 'declined';
    -- Q2326: the poster declined the come-back time: the refund request goes
    -- on to Helpr (a normal dispute, filed by refund_requests_sweep).
    IF v_refund_id IS NOT NULL THEN
      UPDATE public.refund_requests SET status = 'declined' WHERE id = v_refund_id;
    END IF;
  END IF;

  UPDATE public.job_schedule_change_requests SET status = v_status, decided_at = now() WHERE id = v_req.id;

  INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
  VALUES (
    v_req.requested_by, v_job.id,
    CASE WHEN v_status = 'accepted' THEN 'New date or time accepted' ELSE 'New date or time declined' END,
    CASE WHEN v_status = 'accepted'
         THEN format('"%s" is now on %s%s.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.new_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.new_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.new_start_time, 'FMHH12:MI AM') END)
         WHEN v_refund_id IS NOT NULL
         THEN format('The new time to finish "%s" was declined, so a real person at Helpr will decide the refund.', COALESCE(v_job.title, 'your job'))
         ELSE format('"%s" stays on %s%s. The usual cancellation rules apply if either of you cancels.', COALESCE(v_job.title, 'Your job'),
                     to_char(v_req.old_date, 'FMDy FMMon FMDD'),
                     CASE WHEN v_req.old_start_time IS NULL THEN '' ELSE ' at ' || to_char(v_req.old_start_time, 'FMHH12:MI AM') END)
    END,
    'job_updates',
    CASE WHEN v_req.requested_by = v_job.customer_id THEN '/posts?job=' ELSE '/jobs?job=' END || v_job.id::text
  );

  RETURN jsonb_build_object('status', v_status,
                            'reason', CASE WHEN v_status = 'declined' AND v_refund_id IS NOT NULL THEN 'refund_escalated' END);
END;
$fn$;

REVOKE ALL ON FUNCTION public.request_job_schedule_change(uuid, date, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_job_schedule_change(uuid, date, time) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.respond_job_schedule_change(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_job_schedule_change(uuid, boolean) TO authenticated, service_role;

-- ── 7. No payout toward the Helpr while a request is live ─────────────────
-- escrow -> payout_pending is refused on EVERY path while a request on the job
-- is LIVE: open; declined with its dispute not opened yet; or agreed and not
-- yet settled (its dispute decided and not executed). The crons read the same
-- rows first (_shared/refundRequestHold.ts) so a held job is an outcome, not a
-- refused write. refund_request_is_live is the one definition of "live".
CREATE OR REPLACE FUNCTION public.refund_request_is_live(p_status text, p_dispute_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $fn$
  SELECT COALESCE(
           p_status = 'open'
           -- Q2326: the Helpr offered to come back and finish; the poster has
           -- not accepted the new time yet (accepting closes the request,
           -- declining or letting it lapse sends it to a dispute).
           OR p_status = 'finish_offered'
           -- ...and accepted, until the sweep clears the earlier "done".
           OR p_status = 'coming_back'
           OR (p_status = 'declined' AND p_dispute_id IS NULL)
           OR (p_status = 'agreed'
               AND NOT EXISTS (SELECT 1 FROM public.disputes d
                                WHERE d.id = p_dispute_id
                                  AND (d.execution_status = 'executed' OR d.status <> 'decided'))),
           false)
$fn$;
REVOKE ALL ON FUNCTION public.refund_request_is_live(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_request_is_live(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refuse_payout_pending_while_refund_requested()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.payment_status = 'escrow'
     AND NEW.payment_status = 'payout_pending'
     AND EXISTS (
       SELECT 1 FROM public.refund_requests r
        WHERE r.job_id = NEW.id
          AND public.refund_request_is_live(r.status, r.dispute_id)) THEN
    RAISE EXCEPTION 'refund_request_open'
      USING ERRCODE = '23514',
            DETAIL = 'A refund request on this job is open or agreed and not yet settled. Its money waits for the answer.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_payout_pending_while_refund_requested() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_payout_pending_while_refund_requested ON public.jobs;
CREATE TRIGGER trg_refuse_payout_pending_while_refund_requested
  BEFORE UPDATE OF payment_status ON public.jobs
  FOR EACH ROW
  WHEN (OLD.payment_status = 'escrow' AND NEW.payment_status = 'payout_pending')
  EXECUTE FUNCTION public.refuse_payout_pending_while_refund_requested();

-- No reopen, cancel or Helpr swap under a live request (lh-money-escrow
-- review, #1). helper_cancel_booking / helper_abort_job reopen the job with
-- helper_id NULL and poster_cancel_job cancels it; none reads disputes, so
-- after an Agree the split would then refuse the job forever (its Helpr is
-- gone) with the poster told the refund is on its way, and a cancel would
-- record a fee no path pays. While a request is live the parties answer it
-- first (agree, decline, or the poster withdraws it). Server context (the
-- hand-out's own close, open_dispute_as from the sweep, admins in the SQL
-- editor) passes. Into 'disputed' is always allowed: that is a normal
-- dispute, which the sweep then closes the request for.
CREATE OR REPLACE FUNCTION public.refuse_job_move_while_refund_requested()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF (NEW.helper_id IS DISTINCT FROM OLD.helper_id
      OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('open', 'cancelled')))
     AND EXISTS (
       SELECT 1 FROM public.refund_requests r
        WHERE r.job_id = OLD.id
          AND public.refund_request_is_live(r.status, r.dispute_id)) THEN
    RAISE EXCEPTION 'refund_request_live'
      USING ERRCODE = '23514',
            DETAIL = 'A refund request on this job is waiting on an answer or being settled. Answer or withdraw it first.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_job_move_while_refund_requested() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_job_move_while_refund_requested ON public.jobs;
CREATE TRIGGER trg_refuse_job_move_while_refund_requested
  BEFORE UPDATE OF status, helper_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_job_move_while_refund_requested();

-- NOT DONE BEFORE THE COME-BACK (lh-money-escrow review, 2026-10-21, must
-- fix). Accepting "Come back and finish" moves the job to the agreed time and
-- the sweep clears the earlier done stamps; the first visit's arrival, photos
-- and work start all still stand, so without this the Helpr could mark it done
-- again minutes later, days before coming back, and start the payout clock.
-- A new done stamp is refused until the agreed start (the job's date and
-- time, which the accept moved there).
--
-- ONE RULE, TWO DOORS (lh-money-escrow re-review, 2026-10-21): the member's
-- rpc_helper_mark_done is judged by the trigger below; create-payment's
-- 'release' writes the Helpr's stamp on the SERVICE ROLE (server context, which
-- the trigger lets through), so it asks refund_come_back_pending itself and
-- refuses the same way. Both read this one function.
CREATE OR REPLACE FUNCTION public.refund_come_back_pending(p_job_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
  -- A NULL job is TRUE (fails safe: refuse the stamp); no caller passes one.
  SELECT p_job_id IS NULL OR COALESCE((
    SELECT now() < ((j.date_needed + COALESCE(j.start_time, '00:00'::time)) AT TIME ZONE 'America/Chicago')
       AND EXISTS (
         SELECT 1 FROM public.refund_requests r
          WHERE r.job_id = j.id
            AND (r.status = 'coming_back'
                 OR r.closed_reason = 'coming_back'
                 OR (r.status = 'finish_offered'
                     AND EXISTS (SELECT 1 FROM public.job_schedule_change_requests sc
                                  WHERE sc.id = r.schedule_change_id AND sc.status = 'accepted'))))
      FROM public.jobs j
     WHERE j.id = p_job_id), false)
$fn$;
REVOKE ALL ON FUNCTION public.refund_come_back_pending(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_come_back_pending(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refuse_done_before_come_back()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $fn$
BEGIN
  IF public.is_server_context() THEN
    RETURN NEW;
  END IF;
  IF NEW.helper_completed_at IS NOT NULL
     AND OLD.helper_completed_at IS NULL
     AND public.refund_come_back_pending(OLD.id) THEN
    RAISE EXCEPTION 'completion_before_come_back'
      USING ERRCODE = '23514',
            HINT = 'You agreed to come back and finish. Mark it done once you have, from the agreed time.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refuse_done_before_come_back() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_refuse_done_before_come_back ON public.jobs;
CREATE TRIGGER trg_refuse_done_before_come_back
  BEFORE UPDATE OF helper_completed_at ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.refuse_done_before_come_back();

-- ── 7b. The poster withdraws their request ────────────────────────────────
-- (lh-money-escrow review, #3.) Open, or declined with its dispute not filed
-- yet: closed, nothing moves, the Helpr is told. Lock order jobs ->
-- refund_requests, as every writer.
CREATE OR REPLACE FUNCTION public.rpc_withdraw_refund_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_job_id uuid;
  v_job record;
  v_req record;
  v_poster text;
BEGIN
  PERFORM public.require_feature('refund_requests');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'refund_request_invalid';
  END IF;
  SELECT r.job_id INTO v_job_id FROM public.refund_requests r WHERE r.id = p_request_id;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'refund_request_not_found';
  END IF;
  SELECT j.id, j.title, j.helper_id INTO v_job FROM public.jobs j WHERE j.id = v_job_id FOR UPDATE;
  SELECT r.* INTO v_req FROM public.refund_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL OR v_job.id IS NULL THEN
    RAISE EXCEPTION 'refund_request_not_found';
  END IF;
  IF v_uid IS DISTINCT FROM v_req.requester_id THEN
    RAISE EXCEPTION 'refund_request_not_poster' USING ERRCODE = '42501';
  END IF;
  -- IS NOT TRUE: a NULL status refuses too (refusalsFailClosedOnNull).
  IF (v_req.status = 'open' OR (v_req.status = 'declined' AND v_req.dispute_id IS NULL)) IS NOT TRUE THEN
    RAISE EXCEPTION 'refund_request_answered';
  END IF;
  UPDATE public.refund_requests
     SET status = 'closed', closed_reason = 'withdrawn_by_poster'
   WHERE id = p_request_id;
  IF v_req.responder_id IS NOT NULL THEN
    SELECT public.member_display_name(p.full_name, 'The person who posted it') INTO v_poster
      FROM public.profiles p WHERE p.user_id = v_uid;
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_req.responder_id, v_job_id,
      'Refund request withdrawn',
      format('%s withdrew their refund request on "%s". Nothing changes on your pay.',
             COALESCE(v_poster, 'The person who posted it'), COALESCE(v_job.title, 'your job')),
      'payment',
      '/jobs?job=' || v_job_id::text
    );
  END IF;
  RETURN jsonb_build_object('status', 'closed');
END;
$fn$;
REVOKE ALL ON FUNCTION public.rpc_withdraw_refund_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_withdraw_refund_request(uuid) TO authenticated;

-- ── 8. The service sweep's SQL half ───────────────────────────────────────
-- (a) An open (or declined, dispute not opened yet) request whose job moved on
--     (completed, cancelled, disputed by another path, paid out) is closed
--     with the reason.
-- (b) A declined request, or an open one with no answer in 2 days, opens a
--     normal dispute: the poster's complaint in their words (open_dispute_as,
--     in server context, so no party's column lock applies).
-- One subtransaction per request, so one bad row never stops the rest.
CREATE OR REPLACE FUNCTION public.refund_requests_sweep()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_id uuid;
  v_req record;
  v_job record;
  v_dispute uuid;
  v_helpr text;
  v_closed integer := 0;
  v_expired integer := 0;
  v_declined integer := 0;
  v_back integer := 0;
  v_failed integer := 0;
  v_errors text[] := ARRAY[]::text[];
  v_sc record;
BEGIN
  FOR v_id IN
    SELECT r.id FROM public.refund_requests r
     WHERE r.status IN ('open', 'finish_offered', 'coming_back')
        OR (r.status = 'declined' AND r.dispute_id IS NULL)
     ORDER BY r.answer_by
     LIMIT 500
  LOOP
    BEGIN
      SELECT j.id, j.title, j.helper_id, j.customer_id, j.status::text AS status INTO v_job
        FROM public.jobs j
       WHERE j.id = (SELECT r.job_id FROM public.refund_requests r WHERE r.id = v_id)
       FOR UPDATE;
      SELECT r.* INTO v_req FROM public.refund_requests r WHERE r.id = v_id FOR UPDATE;
      CONTINUE WHEN v_req.id IS NULL
                 OR NOT (v_req.status IN ('open', 'finish_offered', 'coming_back')
                         OR (v_req.status = 'declined' AND v_req.dispute_id IS NULL));

      -- Q2326, "Come back and finish" ACCEPTED ('coming_back', or an accepted
      -- time the answer did not hand over). Handled FIRST, before any exit
      -- below (lh-money-escrow review, 2026-10-21): a dispute opened or the
      -- job moved between the accept and this pass must not leave the earlier
      -- "done" stamps standing, or a withdrawn dispute would make the payout
      -- due at once on them. Clears both done stamps (server context: the only
      -- one enforce_completion_on_live_job lets clear the Helpr's), so no
      -- payout clock runs until the work is marked done again, which
      -- refuse_done_before_come_back holds until the agreed time. Then closes.
      IF v_req.status = 'finish_offered' THEN
        SELECT sc.status, sc.expires_at INTO v_sc
          FROM public.job_schedule_change_requests sc
         WHERE sc.id = v_req.schedule_change_id
           FOR UPDATE;
        IF v_sc.status = 'accepted' THEN
          v_req.status := 'coming_back';
        END IF;
      END IF;
      IF v_req.status = 'coming_back' THEN
        UPDATE public.jobs
           SET helper_completed_at = NULL, poster_completed_at = NULL
         WHERE id = v_req.job_id
           AND status::text IN ('accepted', 'in_progress', 'revision_requested', 'disputed')
           AND (helper_completed_at IS NOT NULL OR poster_completed_at IS NOT NULL);
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = 'coming_back'
         WHERE id = v_id;
        v_back := v_back + 1;
        CONTINUE;
      END IF;

      -- Nobody left to file for: close, never a platform filing.
      IF v_req.requester_id IS NULL OR v_req.requester_id IS DISTINCT FROM v_job.customer_id THEN
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = 'refund_request_poster_gone'
         WHERE id = v_id;
        v_closed := v_closed + 1;
        CONTINUE;
      END IF;
      -- The Helpr asked is no longer the job's Helpr (lh-money-escrow review,
      -- #2): the request was theirs, never the new Helpr's to answer or pay for.
      IF v_req.responder_id IS DISTINCT FROM v_job.helper_id THEN
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = 'refund_request_helpr_changed'
         WHERE id = v_id;
        v_closed := v_closed + 1;
        CONTINUE;
      END IF;

      BEGIN
        PERFORM public.refund_request_assert_job_open(v_req.job_id);
      EXCEPTION WHEN raise_exception THEN
        UPDATE public.refund_requests
           SET status = 'closed', closed_reason = left(SQLERRM, 100)
         WHERE id = v_id;
        v_closed := v_closed + 1;
        CONTINUE;
      END;

      -- Q2326, a come-back offered and still waiting on the poster: nothing
      -- to do yet. Declined, replaced or lapsed: on to Helpr.
      IF v_req.status = 'finish_offered' THEN
        CONTINUE WHEN v_sc.status = 'pending' AND v_sc.expires_at > now();
        IF v_sc.status = 'pending' THEN
          UPDATE public.job_schedule_change_requests
             SET status = 'expired', decided_at = now()
           WHERE id = v_req.schedule_change_id;
        END IF;
        UPDATE public.refund_requests SET status = 'declined' WHERE id = v_id;
        v_req.status := 'declined';
      END IF;

      IF v_req.status = 'declined' THEN
        v_dispute := public.open_dispute_as(v_req.job_id, v_req.requester_id, v_req.reason, '{}'::text[]);
        UPDATE public.refund_requests SET dispute_id = v_dispute WHERE id = v_id;
        v_declined := v_declined + 1;
      ELSIF now() >= v_req.answer_by THEN
        v_dispute := public.open_dispute_as(v_req.job_id, v_req.requester_id, v_req.reason, '{}'::text[]);
        UPDATE public.refund_requests
           SET status = 'expired', dispute_id = v_dispute
         WHERE id = v_id;
        SELECT public.member_display_name(p.full_name, 'Your Helpr') INTO v_helpr
          FROM public.profiles p WHERE p.user_id = v_job.helper_id;
        IF v_req.requester_id IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
          VALUES (
            v_req.requester_id, v_req.job_id,
            'Your refund request goes to Helpr',
            format('%s didn''t answer within 2 days, so a real person at Helpr will decide the refund on "%s". The payment stays on hold until then.',
                   COALESCE(v_helpr, 'Your Helpr'), COALESCE(v_job.title, 'your job')),
            'payment',
            '/posts?job=' || v_req.job_id::text
          );
        END IF;
        v_expired := v_expired + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || (v_id::text || ': ' || left(SQLERRM, 200));
    END;
  END LOOP;
  RETURN jsonb_build_object('closed', v_closed, 'expired', v_expired, 'declined', v_declined, 'coming_back', v_back,
                            'failed', v_failed, 'errors', to_jsonb(v_errors));
END;
$fn$;
REVOKE ALL ON FUNCTION public.refund_requests_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_requests_sweep() TO service_role;

-- (c) Agreements whose money has not moved: each handed out at most once per
--     30 minutes and 3 times in all (a failure after that is an admin's, via
--     auto-resolve-disputes' stuck-split reminder and "Retry settlement").
--     The claim also closes the job the way an admin decision does
--     (rpc_decide_dispute): completed, or cancelled when all of it comes
--     back, with the dispute markers set. Service context, so the job's
--     party locks do not apply. Returns what the sweep hands to
--     execute-dispute-split.
CREATE OR REPLACE FUNCTION public.refund_agreements_due(p_limit integer DEFAULT 20)
 RETURNS TABLE(request_id uuid, dispute_id uuid, job_id uuid, held boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_row record;
  v_status text;
  v_title text;
BEGIN
  FOR v_row IN
    SELECT r.id, r.job_id, r.dispute_id, r.refund_scope, r.requester_id, r.answered_by
      FROM public.refund_requests r
      JOIN public.disputes d ON d.id = r.dispute_id
     WHERE r.status = 'agreed'
       AND d.status = 'decided'
       AND d.decided_via = 'agreement'
       AND d.execution_status IN ('pending', 'failed')
       AND r.settle_attempts < 3
       AND (r.last_settle_at IS NULL OR r.last_settle_at < now() - interval '30 minutes')
     ORDER BY r.answered_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
  LOOP
    -- Lock order jobs -> refund_requests; SKIP LOCKED so two sweeps never
    -- hand out the same agreement. The job's status is read under the lock.
    SELECT j.status::text, j.title INTO v_status, v_title
      FROM public.jobs j
     WHERE j.id = v_row.job_id
       FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    UPDATE public.refund_requests r
       SET settle_attempts = r.settle_attempts + 1, last_settle_at = now()
     WHERE r.id = v_row.id
       AND r.status = 'agreed'
       AND r.settle_attempts < 3
       AND (r.last_settle_at IS NULL OR r.last_settle_at < now() - interval '30 minutes');
    CONTINUE WHEN NOT FOUND;

    IF v_status IN ('accepted', 'in_progress', 'revision_requested') THEN
      UPDATE public.jobs
         SET status = (CASE WHEN v_row.refund_scope = 'all' THEN 'cancelled' ELSE 'completed' END)::public.job_status,
             dispute_resolved_at = now(),
             dispute_status = 'resolved'
       WHERE id = v_row.job_id
         AND status::text IN ('accepted', 'in_progress', 'revision_requested');
    END IF;

    request_id := v_row.id;
    dispute_id := v_row.dispute_id;
    job_id := v_row.job_id;
    held := false;
    -- No money moves automatically for a party who is banned, suspended,
    -- under a ban review or on a payout hold (lead, 2026-10-21). The decided
    -- dispute goes to an admin instead, as any unsettled decision does: it is
    -- marked failed with REFUND_AGREEMENT_HELD_ERROR (the admin queue lists it
    -- UNSETTLED; auto-resolve-disputes sets it aside rather than paging every
    -- run), it is never handed out again, and the sweep pages ops once.
    -- Only an untouched decision is marked (lh-money-escrow review,
    -- 2026-10-21): one an earlier attempt already started keeps its own error,
    -- so a half-moved split stays in the stuck set auto-resolve-disputes pages
    -- for, never hidden behind the held marker.
    IF public.refund_party_held(v_row.requester_id) OR public.refund_party_held(v_row.answered_by) THEN
      UPDATE public.disputes d
         SET execution_status = 'failed',
             execution_error = 'refund agreement held for admin review: a party is banned, suspended, under a ban review or on a payout hold'
       WHERE d.id = v_row.dispute_id
         AND d.status = 'decided'
         AND d.execution_status = 'pending'
         AND d.execution_started_at IS NULL
         AND d.execution_refund_id IS NULL
         AND d.execution_transfer_id IS NULL;
      UPDATE public.refund_requests r SET settle_attempts = 3 WHERE r.id = v_row.id;
      held := true;
      -- Both told it now waits on a person, not "on its way".
      INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
      SELECT u.user_id, v_row.job_id,
             'Your refund is waiting on Helpr',
             format('The refund you agreed on "%s" needs a real person at Helpr to finish it. The payment stays on hold until then.',
                    COALESCE(v_title, 'the job')),
             'payment',
             u.link || v_row.job_id::text
        FROM (VALUES (v_row.requester_id, '/posts?job='), (v_row.answered_by, '/jobs?job=')) AS u(user_id, link)
       WHERE u.user_id IS NOT NULL;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refund_agreements_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_agreements_due(integer) TO service_role;

-- THE PROOF OF AGREEMENT. execute-dispute-split's service door moves money
-- only when this returns a row for the dispute: a recorded 'agreed' answer by
-- the job's Helpr (never the poster themself) to the job's poster's request,
-- linked to this decided-by-agreement dispute, with the dispute's shares
-- exactly the ones the stored amounts give. NULL otherwise (a NULL id too).
CREATE OR REPLACE FUNCTION public.refund_agreement_for_dispute(p_dispute_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object(
           'request_id', r.id,
           'dispute_id', d.id,
           'job_id', j.id,
           'poster_id', r.requester_id,
           'helper_id', r.answered_by,
           'amount_cents', r.amount_cents,
           'budget_cents', r.budget_cents,
           'answered_at', r.answered_at)
    FROM public.refund_requests r
    JOIN public.disputes d ON d.id = r.dispute_id
    JOIN public.jobs j ON j.id = r.job_id AND j.id = d.job_id
   WHERE p_dispute_id IS NOT NULL
     AND r.dispute_id = p_dispute_id
     AND r.status = 'agreed'
     AND r.answered_at IS NOT NULL
     AND r.answered_by IS NOT NULL
     AND r.requester_id IS NOT NULL
     AND r.answered_by = r.responder_id
     AND r.answered_by <> r.requester_id
     AND d.status = 'decided'
     AND d.decided_via = 'agreement'
     AND d.agreed_poster_id = r.requester_id
     AND d.agreed_helper_id = r.answered_by
     AND j.customer_id = r.requester_id
     AND j.helper_id = r.answered_by
     -- Neither party banned, suspended, under a ban review or on a payout
     -- hold (lead, 2026-10-21): such an agreement is an admin's to settle,
     -- never the service door's.
     AND NOT public.refund_party_held(r.requester_id)
     AND NOT public.refund_party_held(r.answered_by)
     AND (d.payout_split->>'poster')::numeric = round(r.amount_cents::numeric / r.budget_cents, 8)
     AND (d.payout_split->>'helper')::numeric = 1 - round(r.amount_cents::numeric / r.budget_cents, 8)
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.refund_agreement_for_dispute(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_agreement_for_dispute(uuid) TO service_role;

-- ── 9. Every public table carries the unconfirmed-email gate (Q807) ───────
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- ── 10. The cron: refund-request-sweep every 10 minutes ───────────────────
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('refund-request-sweep', interval '30 minutes',
            'Board 141 (Q2272): every 10 minutes, closes refund requests whose job moved on, opens a normal dispute for one unanswered in 2 days, and settles each agreed refund through execute-dispute-split.',
            'exempt',
            'While refund requests are testers-only, a run that finds nothing to do is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('refund-request-sweep', '*/10 * * * *', $c$SELECT public.cron_http_tag(q.request_id, 'refund-request-sweep')
  FROM (
      SELECT net.http_post(timeout_milliseconds := 120000,
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
               || '/functions/v1/refund-request-sweep',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := '{}'::jsonb
      )
) AS q(request_id);$c$);
  END IF;
END
$do$;
