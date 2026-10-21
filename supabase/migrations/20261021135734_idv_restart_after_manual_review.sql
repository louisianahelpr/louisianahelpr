-- A member whose ID check sits "with our team" can start a FRESH Stripe
-- Identity check themselves, and an admin is told when one waits over 24 h
-- (owner report 2026-10-21: the ID sheet said "with our team… within 24
-- hours" and never offered a way to verify).
--
-- WHY. claim_idv_attempt (newest body: 20261019051407) refused every
-- 'manual_review' account outright ('in_manual_review') and capped every
-- account at ONE attempt, so a check that landed in manual review (Stripe
-- requires_input / canceled, a stale session from the old flow, or a 'pending'
-- whose session could not be resumed, which stripe-idv-start turns into
-- 'manual_review') could only ever leave it through an admin. Nobody was told
-- when it waited, so it waited.
--
-- 1. claim_idv_attempt(p_user_id, p_max_attempts, p_skip_fee_gate, p_restart).
--    20261019051407's body, with:
--      * the ban refusal moved ABOVE the manual-review one, and a new
--        'rejected' refusal for idv_status = 'failed' (an admin's idv_reject,
--        or a document matched to a removed account): a restart never escapes
--        a ban or a rejection, whatever the attempt count says. Before this, a
--        'failed' account with idv_attempt_count = 0 could start a new check.
--      * p_restart (stripe-idv-start sets it only after reading the previous
--        session at Stripe and finding it requires_input, canceled, missing or
--        unreadable, never processing or verified): from 'manual_review',
--        'pending' or 'not_started', a restart claims a NEW attempt while the
--        account has used fewer than 3 (v_restart_max). Past that, a person
--        decides (admin request_id_reupload resets the count, as before).
--        Without p_restart nothing changes: manual_review is refused, and the
--        cap stays at one.
--      * the claim writes only if idv_status and the count are still what it
--        read (one conditional UPDATE), so an admin decision that lands
--        between the read and the write wins: the claim answers
--        'attempt_race_lost' and spends nothing.
--      * a claimed attempt clears idv_session_id (the new session id is
--        stored by stripe-idv-start right after create) so the webhook can
--        tell a stale session's late event from the current one.
--    The claim NEVER writes 'verified': only the webhook (Stripe's verdict)
--    and an admin (manual_verify) do.
--    The 3-argument signature is DROPPED in the same migration (one
--    signature, no 42725 overload, as 20260924053037 did for the 2-argument
--    one); the old edge call (named p_user_id, p_skip_fee_gate) still
--    resolves to the new one through the defaults.
--
-- 2. idv_review_waiting_since(user): when the CURRENT manual review began,
--    read from helper_verifications (the AFTER UPDATE history trigger
--    profiles_verification_history writes one row per idv_status change,
--    live on prod since 20260505180000); profiles.updated_at only when no
--    history row exists (a fallback that can only make the wait look
--    SHORTER, never longer, since any profile edit moves it).
--
-- 3. sweep_idv_review_waiting(): hourly. For each real (non-seed) member in
--    'manual_review' for more than 24 h, an 'admin_alert' to every admin
--    titled "Identity verification needs review — waiting over 24 hours",
--    linked to /admin?view=idvreview&user=<member> (the Identity review
--    queue, which already lists every manual_review row). At most one per
--    member per 24 h. The title starts with the existing idv-review prefix,
--    so the admin push->Slack mirror, the ops ledger item and its self-close
--    (admin_alert_close_rule / admin_queue_still_pending 'idv-review') are the
--    ones every identity-review alert already uses: no new alert path.
--    Registered in cron_work_expectations ('exempt': no member waiting is the
--    healthy state) and scheduled as 'idv-review-waiting'.
--
-- Replay-safe: DROP FUNCTION IF EXISTS / CREATE OR REPLACE only, the
-- expectation is upserted, cron.schedule upserts by name. Grants by role name:
-- service_role only, revoked from PUBLIC, anon, authenticated.
-- PGlite proof: src/test/pglite/idvRestartAfterManualReview.pglite.mjs.

DROP FUNCTION IF EXISTS public.claim_idv_attempt(uuid, integer, boolean);

CREATE OR REPLACE FUNCTION public.claim_idv_attempt(
  p_user_id uuid,
  p_max_attempts integer DEFAULT 1,
  p_skip_fee_gate boolean DEFAULT false,
  p_restart boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_status  text;
  v_connect boolean;
  v_paid    boolean;
  v_count   integer;
  v_banned  text;
  v_claimed integer;
  -- Hard-coded on purpose: see 20260829031405. `p_max_attempts` is accepted
  -- for signature compatibility and deliberately not read.
  v_max     integer := 1;
  -- A member's own restarts stop here; an admin's request_id_reupload resets
  -- the count. Bounds what one account can bill without a person.
  v_restart_max integer := 3;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_authenticated');
  END IF;

  SELECT p.idv_status, p.stripe_identity_verified, p.onboarding_fee_paid, p.idv_attempt_count, p.ban_status
    INTO v_status, v_connect, v_paid, v_count, v_banned
  FROM public.profiles p
  WHERE p.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'profile_not_found');
  END IF;

  -- Verified once is never asked again: the one rule.
  IF public.identity_is_verified(v_status, v_connect) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'already_verified');
  END IF;

  -- A banned account must not be able to spend platform money, restart or not.
  IF v_banned IN ('temp_banned', 'permanently_banned') THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'account_restricted');
  END IF;

  -- An admin rejected it, or the document matched a removed account. Only an
  -- admin moves it from here (request_id_reupload / manual_verify).
  IF v_status = 'failed' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'rejected');
  END IF;

  -- Already with a human, and the member did not ask for a fresh check.
  IF v_status = 'manual_review' AND p_restart IS NOT TRUE THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_manual_review');
  END IF;

  IF v_paid IS NOT TRUE AND NOT p_skip_fee_gate THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'onboarding_fee_unpaid');
  END IF;

  IF p_restart IS TRUE THEN
    IF v_status IS NOT NULL AND v_status NOT IN ('manual_review', 'pending', 'not_started') THEN
      -- 'processing' (Stripe is still checking) and anything else: no restart.
      RETURN jsonb_build_object('claimed', false, 'reason', 'attempt_limit_reached',
        'attempt', COALESCE(v_count, 0), 'max_attempts', v_restart_max);
    END IF;
    IF COALESCE(v_count, 0) >= v_restart_max THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', CASE WHEN v_status = 'manual_review' THEN 'in_manual_review' ELSE 'attempt_limit_reached' END,
        'attempt', COALESCE(v_count, 0), 'max_attempts', v_restart_max
      );
    END IF;
  ELSIF COALESCE(v_count, 0) >= v_max THEN
    RETURN jsonb_build_object(
      'claimed', false, 'reason', 'attempt_limit_reached',
      'attempt', COALESCE(v_count, 0), 'max_attempts', v_max
    );
  END IF;

  -- One conditional write: the count AND the status must still be what was
  -- read, so an admin decision in between wins and nothing is spent.
  UPDATE public.profiles
     SET idv_attempt_count = COALESCE(idv_attempt_count, 0) + 1,
         idv_attempted_at  = now(),
         idv_status        = 'pending',
         idv_session_id    = NULL
   WHERE user_id = p_user_id
     AND COALESCE(idv_attempt_count, 0) = COALESCE(v_count, 0)
     AND idv_status IS NOT DISTINCT FROM v_status
  RETURNING idv_attempt_count INTO v_claimed;

  IF v_claimed IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'attempt_race_lost');
  END IF;

  RETURN jsonb_build_object(
    'claimed', true, 'reason', NULL,
    'attempt', v_claimed,
    'max_attempts', CASE WHEN p_restart IS TRUE THEN v_restart_max ELSE v_max END,
    'restarted', p_restart IS TRUE
  );
END;
$fn$;

COMMENT ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean, boolean) IS
  'Atomically claims a billable Stripe Identity attempt, or refuses with a reason (already_verified / account_restricted / rejected / in_manual_review / onboarding_fee_unpaid / attempt_limit_reached / attempt_race_lost). One attempt normally; with p_restart (stripe-idv-start, only when the previous session is requires_input, canceled, missing or unreadable at Stripe) a member in manual_review, pending or not_started may start a fresh check while under 3 attempts. Never writes verified; a ban or a failed (rejected) status always refuses. 20261021135734.';

REVOKE ALL ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_idv_attempt(uuid, integer, boolean, boolean) TO service_role;

-- 2. When the current manual review began.
CREATE OR REPLACE FUNCTION public.idv_review_waiting_since(p_user_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(
    (SELECT max(h.changed_at) FROM public.helper_verifications h
      WHERE h.user_id = p_user_id AND h.field = 'idv_status' AND h.new_value = 'manual_review'),
    (SELECT p.updated_at FROM public.profiles p WHERE p.user_id = p_user_id)
  );
$fn$;
REVOKE ALL ON FUNCTION public.idv_review_waiting_since(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.idv_review_waiting_since(uuid) TO service_role;

-- 3. The 24-hour alert.
CREATE OR REPLACE FUNCTION public.sweep_idv_review_waiting()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r       record;
  v_link  text;
  v_sent  integer := 0;
  v_rows  integer;
BEGIN
  FOR r IN
    SELECT p.user_id, public.idv_review_waiting_since(p.user_id) AS since
      FROM public.profiles p
     WHERE p.idv_status = 'manual_review'
       AND p.is_seed IS NOT TRUE
  LOOP
    CONTINUE WHEN r.since IS NULL OR r.since > now() - interval '24 hours';
    v_link := '/admin?view=idvreview&user=' || r.user_id::text;
    -- At most once per member per 24 h while it waits.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.type = 'admin_alert' AND n.link = v_link
         AND n.title = 'Identity verification needs review — waiting over 24 hours'
         AND n.created_at > now() - interval '24 hours');
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id, 'Identity verification needs review — waiting over 24 hours',
             'A member''s ID check has waited over 24 hours with no decision. They can also start a fresh check themselves. Review it in Admin -> Identity review.',
             'admin_alert', v_link
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         AND NOT public.notification_crosses_seed_boundary(ur.user_id, NULL, v_link, r.user_id);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_sent := v_sent + v_rows;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect('sweep_idv_review_waiting', r.user_id::text, SQLERRM,
        jsonb_build_object('user_id', r.user_id));
    END;
  END LOOP;
  RETURN jsonb_build_object('alerts', v_sent);
END;
$fn$;
REVOKE ALL ON FUNCTION public.sweep_idv_review_waiting() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_idv_review_waiting() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('idv-review-waiting', interval '3 hours',
            'Identity review: every hour, tells every admin when a real member''s ID check has sat in manual review over 24 hours with no decision (at most once a day per member).',
            'exempt',
            'Nobody waiting on an ID review is the healthy state, so a run that sends nothing is normal.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('idv-review-waiting', '23 * * * *',
      $c$SELECT public.cron_record_work('idv-review-waiting', to_jsonb(public.sweep_idv_review_waiting()));$c$);
  END IF;
END
$do$;
