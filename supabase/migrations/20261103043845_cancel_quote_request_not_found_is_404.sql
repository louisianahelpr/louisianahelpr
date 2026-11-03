-- Q2390 packet 5 (cancel_quote_request): "not found" answers HTTP 404, not 500.
--
-- PostgREST maps SQLSTATE P0001 to 400 but every other P0 code, P0002 included,
-- to 500. RAISE ... USING ERRCODE = 'PT404' makes PostgREST answer 404.
--
-- Restated VERBATIM from prod (pg_proc.prosrc md5 a1eaebb55e25d5a25a964888c1df3173,
-- 4862 chars, read 2026-11-02; equal to 20261018155222's body). The ONE change is
-- the unknown_request raise's ERRCODE 'P0002' -> 'PT404'. It fires before any
-- row is touched; the job delete / money checks below it are byte-for-byte
-- unchanged. Message unchanged. Grants restated as on prod (proacl: postgres,
-- authenticated, service_role).

CREATE OR REPLACE FUNCTION public.cancel_quote_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_req public.job_quote_requests%ROWTYPE;
  v_job_status text;
  v_pay text;
  v_session text;
  v_pi text;
  v_helper uuid;
BEGIN
  PERFORM public.require_feature('quotes');
  v_uid := (SELECT auth.uid());
  PERFORM public.quote_require_member();
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_req FROM public.job_quote_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.poster_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'unknown_request' USING ERRCODE = 'PT404';
  END IF;
  -- An 'agreed' request may be cancelled too while its job was never funded
  -- (not booked yet, booking refused for a passed start, or checkout never
  -- finished), so neither side is stuck (lh-money-escrow review of 96ba87037,
  -- should-fix 4). A funded job is cancelled through the job's own cancel flow.
  IF v_req.status = 'agreed' THEN
    -- FOR UPDATE: a payment landing on the job in the same instant waits (and
    -- this may delete the row). Lock order: request, then job, as every quote RPC.
    IF v_req.job_id IS NOT NULL THEN
      -- customer_id = the caller: the DELETE below matches the poster's own
      -- delete policy (lh-authz-rls review of 28a5ed3d7, S2).
      SELECT j.status::text, j.payment_status, j.stripe_session_id, j.stripe_payment_intent_id, j.helper_id
        INTO v_job_status, v_pay, v_session, v_pi, v_helper
        FROM public.jobs j WHERE j.id = v_req.job_id AND j.customer_id = v_uid FOR UPDATE;
      -- 'unpaid' with a Checkout Session is a live checkout the poster may still
      -- finish (lh-money-escrow re-review of ebe408060, S2): refused too.
      IF FOUND AND v_job_status <> 'cancelled'
         AND COALESCE(v_pay, 'unpaid') NOT IN ('unpaid', 'abandoned', 'failed') THEN
        RAISE EXCEPTION 'request_booked' USING ERRCODE = '55000',
          HINT = 'This job is paid for; cancel it from the job instead.';
      END IF;
      IF FOUND AND v_job_status <> 'cancelled' AND v_session IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_open' USING ERRCODE = '55000',
          HINT = 'A checkout is open for this job. Finish it, or try again once it expires.';
      END IF;
      -- Owner answer 11 (2026-10-17): the unpaid job goes with the agreement.
      -- Deleted only when it provably never held money: open, nobody hired,
      -- unpaid / abandoned (the poster's own delete policy), no Checkout Session
      -- and no PaymentIntent attached. A 'failed' payment (it carries a
      -- PaymentIntent) keeps its job, as before (Q2117); once a new checkout has
      -- cleared that dead PaymentIntent (create-payment, only one Stripe reports
      -- requires_payment_method / canceled) and expired, the job never held
      -- money and goes too. A cancelled job is left as it is.
      IF FOUND AND v_job_status = 'open' AND v_helper IS NULL
         AND COALESCE(v_pay, 'unpaid') IN ('unpaid', 'abandoned')
         AND NOT public.job_payment_is_funded(v_pay)
         AND v_session IS NULL AND v_pi IS NULL THEN
        BEGIN
        -- Already held FOR UPDATE above; re-taking it is free, and keeps the
        -- DELETE its own statement for scripts/check-race-class.mjs.
        PERFORM 1 FROM public.jobs j WHERE j.id = v_req.job_id FOR UPDATE;
        DELETE FROM public.jobs j
         WHERE j.id = v_req.job_id AND j.customer_id = v_uid
           AND j.status = 'open' AND j.helper_id IS NULL
           AND COALESCE(j.payment_status, 'unpaid') IN ('unpaid', 'abandoned')
           AND j.stripe_session_id IS NULL AND j.stripe_payment_intent_id IS NULL;
        IF NOT FOUND THEN
          -- Unreachable under the row lock above; refuse rather than leave an
          -- agreed job behind a cancelled request.
          RAISE EXCEPTION 'request_booked' USING ERRCODE = '55000',
            HINT = 'This job could not be removed; cancel it from the job instead.';
        END IF;
        EXCEPTION WHEN foreign_key_violation THEN
          -- A record that must outlive the job points at it (a gift card, a
          -- strike, a payout row: NO ACTION foreign keys). Nothing is deleted
          -- and the request stays agreed; the words, not a constraint name
          -- (lh-authz-rls review of 28a5ed3d7, N2).
          RAISE EXCEPTION 'request_booked' USING ERRCODE = '55000',
            HINT = 'This job has records attached; cancel it from the job instead.';
        END;
      END IF;
    END IF;
  ELSIF v_req.status <> 'open' THEN
    RAISE EXCEPTION 'request_closed' USING ERRCODE = '55000';
  END IF;
  UPDATE public.job_quotes SET status = 'closed', updated_at = now()
   WHERE request_id = p_request_id AND status IN ('pending', 'accepted');
  UPDATE public.job_quote_requests SET status = 'cancelled', updated_at = now() WHERE id = p_request_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cancel_quote_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_quote_request(uuid) TO authenticated, service_role;

