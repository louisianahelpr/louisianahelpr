-- Q1221 (owner decision 2026-10-05): a payout hold also FREEZES the held
-- Helpr's Stripe automatic payouts.
--
-- WHAT WAS LEFT OPEN. Q764 (20261004162921) put the hold in public.payout_holds
-- and every platform-to-Connect transfer, instant payout and tip honours it.
-- Money ALREADY in the Helpr's Connect balance still left for their bank on
-- Stripe's own schedule (stripe-connect creates every account with
-- settings.payouts.schedule.interval = 'daily').
--
-- WHAT THIS ADDS. Stripe can only be called from an edge function (the secret
-- key), so the database records what Stripe must be told and the edge function
-- payout-hold-stripe-sync does it:
--   * public.payout_schedule_freezes: one row per Helpr whose schedule we
--     changed or must change. state:
--       pause_requested    a hold exists; Stripe not yet set to manual
--       paused             Stripe set to manual; prior_schedule holds what to
--                          put back (the exact Stripe schedule object)
--       restore_requested  the hold was released; prior_schedule must go back
--     The row is deleted only after the restore succeeded, so a Helpr is never
--     left on manual with nothing remembering why (a failed restore stays
--     restore_requested and pages).
--   * queue_payout_schedule_freeze(): AFTER INSERT / UPDATE / DELETE on
--     payout_holds. A hold (new, re-placed or denied) asks for a pause; a
--     release asks for a restore. Re-holding before a restore ran asks for a
--     pause again and KEEPS prior_schedule (Stripe is still manual, and the
--     schedule to restore later is the one from before the first hold).
--   * sweep_payout_schedule_freezes(), pg_cron 'payout-freeze-sync' every 10
--     minutes: re-sends every request older than 5 minutes to the edge
--     function (so a client that never called it, or a call that failed, is
--     retried) and pages ONE error_logs 'fatal' per stuck row per 6 hours once
--     a request is 30 minutes old. Never silent in either direction: a pause
--     that does not happen and a restore that does not happen both page.
--   * admins read the table (RLS); nobody writes it from a client.
--
-- The admin client calls payout-hold-stripe-sync right after each hold write
-- for an immediate answer; the sweep is the safety net, not the main path.
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS,
-- pg_cron / pg_net / vault behind existence checks, the expectation row
-- upserts. Proof: src/test/pglite/payoutHoldFreezesStripePayouts.pglite.mjs.

-- ── 1. The freeze ledger ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payout_schedule_freezes (
  helper_id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  freeze_state      text NOT NULL CHECK (freeze_state IN ('pause_requested', 'paused', 'restore_requested')),
  stripe_account_id text,
  prior_schedule    jsonb,
  requested_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  freeze_error        text,
  alerted_at        timestamptz,
  -- Last time a run read the account's schedule at Stripe and found the row
  -- true (or made it true). A 'paused' row is re-verified every 6 hours.
  verified_at       timestamptz
);

COMMENT ON TABLE public.payout_schedule_freezes IS
  'Q1221: Stripe payout-schedule changes a payout hold requires. A row means the '
  'Helpr''s Connect automatic payouts are (or must be) paused, or must be put back '
  'to prior_schedule. Written by triggers on payout_holds and by the '
  'payout-hold-stripe-sync edge function only.';

CREATE INDEX IF NOT EXISTS payout_schedule_freezes_open_idx
  ON public.payout_schedule_freezes (updated_at)
  WHERE freeze_state IN ('pause_requested', 'restore_requested');

ALTER TABLE public.payout_schedule_freezes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END;
$$;

REVOKE ALL ON TABLE public.payout_schedule_freezes FROM PUBLIC;
DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.payout_schedule_freezes FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT SELECT ON TABLE public.payout_schedule_freezes TO authenticated';
  EXECUTE 'GRANT ALL ON TABLE public.payout_schedule_freezes TO service_role';
EXCEPTION WHEN undefined_object THEN NULL;
END;
$$;

DROP POLICY IF EXISTS payout_schedule_freezes_admin_read ON public.payout_schedule_freezes;
CREATE POLICY payout_schedule_freezes_admin_read ON public.payout_schedule_freezes
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- ── 2. A hold asks for a pause; a release asks for a restore ────────────────

CREATE OR REPLACE FUNCTION public.queue_payout_schedule_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO public.payout_schedule_freezes AS f
      (helper_id, freeze_state, requested_by, requested_at, updated_at, attempts, freeze_error, alerted_at)
    VALUES (NEW.helper_id, 'pause_requested', NEW.held_by, now(), now(), 0, NULL, NULL)
    ON CONFLICT (helper_id) DO UPDATE
      SET freeze_state = CASE WHEN f.freeze_state = 'paused' THEN 'paused' ELSE 'pause_requested' END,
          -- prior_schedule is NOT touched: re-holding before a restore ran
          -- must still restore the schedule from before the first hold.
          requested_by = COALESCE(EXCLUDED.requested_by, f.requested_by),
          requested_at = CASE WHEN f.freeze_state = 'paused' THEN f.requested_at ELSE now() END,
          updated_at   = now(),
          attempts     = CASE WHEN f.freeze_state = 'paused' THEN f.attempts ELSE 0 END,
          freeze_error   = CASE WHEN f.freeze_state = 'paused' THEN f.freeze_error ELSE NULL END,
          alerted_at   = CASE WHEN f.freeze_state = 'paused' THEN f.alerted_at ELSE NULL END;
    RETURN NULL;
  END IF;

  -- DELETE: the hold was released. Whatever was paused (or was being paused)
  -- must go back; the edge function decides what that means per account.
  UPDATE public.payout_schedule_freezes f
     SET freeze_state = 'restore_requested',
         requested_by = COALESCE(auth.uid(), f.requested_by),
         requested_at = now(),
         updated_at   = now(),
         attempts     = 0,
         freeze_error   = NULL,
         alerted_at   = NULL
   WHERE f.helper_id = OLD.helper_id;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.queue_payout_schedule_freeze() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_queue_payout_schedule_freeze ON public.payout_holds;
CREATE TRIGGER trg_queue_payout_schedule_freeze
  AFTER INSERT OR UPDATE OR DELETE ON public.payout_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_payout_schedule_freeze();

-- Holds placed before this migration: ask for their pause now.
INSERT INTO public.payout_schedule_freezes (helper_id, freeze_state, requested_by, requested_at, updated_at)
SELECT h.helper_id, 'pause_requested', h.held_by, now(), now()
  FROM public.payout_holds h
ON CONFLICT (helper_id) DO NOTHING;

-- ── 3. The safety net ───────────────────────────────────────────────────────

-- Sends one helper's request to payout-hold-stripe-sync. FALSE when it could
-- not be sent (no pg_net / vault in this database, or the send threw); the
-- request stays open and the sweep pages on it.
CREATE OR REPLACE FUNCTION public.kick_payout_schedule_sync(p_helper_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_url text;
  v_key text;
  v_req bigint;
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regnamespace('vault') IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v_url USING 'supabase_url';
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1' INTO v_key USING 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 90000)'
    INTO v_req
    USING v_url || '/functions/v1/payout-hold-stripe-sync',
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
          jsonb_build_object('helper_id', p_helper_id);
  -- Tagged under the cron that sends it (Q174), so sweep_cron_http_failures
  -- files a failed or timed-out answer from the edge function under
  -- 'payout-freeze-sync' instead of dropping it as an untagged response.
  IF to_regprocedure('public.cron_http_tag(bigint,text)') IS NOT NULL THEN
    PERFORM public.cron_http_tag(v_req, 'payout-freeze-sync');
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'kick_payout_schedule_sync(%): %', p_helper_id, SQLERRM;
  RETURN false;
END;
$fn$;

REVOKE ALL ON FUNCTION public.kick_payout_schedule_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kick_payout_schedule_sync(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_payout_schedule_freezes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r        record;
  v_stale  integer := 0;
  v_kicked integer := 0;
  v_paged  integer := 0;
  v_verify integer := 0;
BEGIN
  -- A 'paused' row is re-verified at Stripe every 6 hours (lh-money-escrow
  -- re-review, 2026-10-05): a restore that Stripe applied but whose run then
  -- failed (timeout, DB error while a re-hold flipped the row to paused) would
  -- otherwise leave the row saying paused while Stripe pays out daily. The
  -- edge function's paused branch reads the schedule, puts manual back and
  -- pages if it drifted, and stamps verified_at.
  FOR r IN
    SELECT f.helper_id
      FROM public.payout_schedule_freezes f
     WHERE f.freeze_state = 'paused'
       AND f.stripe_account_id IS NOT NULL
       AND COALESCE(f.verified_at, f.updated_at) < now() - interval '6 hours'
     ORDER BY COALESCE(f.verified_at, f.updated_at)
     LIMIT 50
  LOOP
    IF public.kick_payout_schedule_sync(r.helper_id) THEN
      v_verify := v_verify + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT f.helper_id, f.freeze_state, f.requested_at, f.attempts, f.freeze_error, f.alerted_at
      FROM public.payout_schedule_freezes f
     WHERE f.freeze_state IN ('pause_requested', 'restore_requested')
       AND f.updated_at < now() - interval '5 minutes'
     ORDER BY f.updated_at
     LIMIT 50
  LOOP
    v_stale := v_stale + 1;
    IF public.kick_payout_schedule_sync(r.helper_id) THEN
      v_kicked := v_kicked + 1;
    END IF;

    IF r.requested_at < now() - interval '30 minutes'
       AND (r.alerted_at IS NULL OR r.alerted_at < now() - interval '6 hours') THEN
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'fatal',
        format(
          CASE WHEN r.freeze_state = 'pause_requested'
               THEN 'Payout hold on Helpr %s: Stripe automatic payouts are NOT paused after %s minutes (%s attempts; last error: %s). Money already in their Connect balance can still leave for their bank. Fix the cause, then the next sweep retries (docs/OPEN.md Q1221).'
               ELSE 'Payout hold released for Helpr %s, but their Stripe payout schedule is NOT restored after %s minutes (%s attempts; last error: %s). They are still on manual payouts and will not be paid out automatically. Fix the cause, then the next sweep retries (docs/OPEN.md Q1221).'
          END,
          r.helper_id,
          floor(extract(epoch FROM now() - r.requested_at) / 60)::int,
          r.attempts,
          COALESCE(r.freeze_error, 'none recorded: the sync may never have run')),
        jsonb_build_object('source', 'payout-freeze-stuck', 'area', 'money'),
        jsonb_build_object('helper_id', r.helper_id, 'state', r.freeze_state, 'requested_at', r.requested_at));
      UPDATE public.payout_schedule_freezes SET alerted_at = now() WHERE helper_id = r.helper_id;
      v_paged := v_paged + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('stale', v_stale, 'kicked', v_kicked, 'paged', v_paged, 'verify_kicked', v_verify);
END;
$fn$;

REVOKE ALL ON FUNCTION public.sweep_payout_schedule_freezes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_payout_schedule_freezes() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('payout-freeze-sync', interval '40 minutes',
            'Q1221: every 10 minutes, re-sends payout-hold Stripe schedule changes older than 5 minutes to payout-hold-stripe-sync, and pages any older than 30 minutes.',
            'exempt',
            'Nothing waiting is the healthy state, so a run that changes nothing is not a silent failure. A stuck freeze raises its own error_logs page.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('payout-freeze-sync', '7-59/10 * * * *',
                          $c$SELECT public.cron_record_work('payout-freeze-sync', to_jsonb(public.sweep_payout_schedule_freezes()));$c$);
  END IF;
END
$do$;
