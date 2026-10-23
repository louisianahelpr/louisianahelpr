-- PayPal Plan A, phase 2: "Get paid with PayPal" (owner 2026-10-23; design ~/.lh-wt/paypal-design.md,
-- section 6 row 2). Stripe closed the platform account, so a Helpr can no longer finish Stripe payout
-- setup, and every Helpr who taps Accept waits forever ('payout_setup' never clears). With the
-- `paypal_payments` switch on for them (created OFF by 20261023223419), a Helpr types their PayPal
-- email once (twice, to confirm), and that is their payout setup.
--
-- WHAT THIS ADDS
--   * paypal_payee_env(): which PayPal environment a payout destination is for. 'sandbox' only, like
--     PAYPAL_LIVE_ALLOWED = false in _shared/payments/paypalClient.ts: going live is its own reviewed
--     change (lead-approved contract 2026-10-23). A payout copies its destination from the
--     payee_accounts row whose env is the payment's env.
--   * paypal_payee_ready(uid): the switch is on for the member AND they have a payable PayPal email
--     for that env.
--   * helper_accept_missing: 'payout_setup' clears when Stripe is ready (unchanged) OR
--     paypal_payee_ready. Restated from its effective definition (20261023213857); only that line.
--   * complete_pending_accepts_for(uid, via) / complete_pending_crew_confirms_for(uid): the loops
--     that complete a Helpr's waiting accepts and crew Confirms, moved out of the two profiles
--     triggers so one implementation serves both ways setup can finish (Stripe's status write, and a
--     saved PayPal email). The triggers now call them. The bodies are the effective definitions
--     (20261021061341, 20261021062140), with NEW.user_id -> p_user_id and the ban and seed facts
--     read from the profiles row (the trigger is AFTER UPDATE, so it reads the row just written),
--     plus the PayPal wording of the "You're all set" notice.
--   * set_paypal_payee_email(p_email, p_email_confirm): the member's one write. Starts with
--     require_feature('paypal_payments'); the member is auth.uid(), never an id from the request;
--     takes no verified/payable from the caller. A new or changed email is made payable by this
--     function (verified stays false: that means PayPal itself confirmed the account, a later
--     phase). Saving the same email again changes nothing, so an admin who turned a destination off
--     is not overridden by a re-save. A CHANGED email holds every queued manual payout to the old
--     one (status 'held'; the destination on a payout is frozen, so an admin re-queues it to the new
--     email after checking). Then the Helpr's waiting accepts and crew Confirms complete.
--   * get_my_paypal_payee(): the member's own state, the email masked (payee_accounts stays
--     server-only: members cannot read it directly).
--
-- REPLAY-SAFETY: CREATE OR REPLACE throughout; the triggers are unchanged (they still name the same
-- trigger functions). payee_accounts and provider_payouts exist since 20261023223419; plpgsql bodies
-- are not resolved at creation. Proof: src/test/pglite/paypalPayeeEmail.pglite.mjs (3x).

-- paypal_entry_requires_switch: restated from 20261023223419 (phase 1), one fix. An UPDATE that kept
-- the same destination and turned verified/payable ON fell through to the "new destination" reset,
-- so payable could never become true (measured in PGlite 2026-10-23: set_paypal_payee_email left
-- payable false). Now the reset runs only when who or where changed; turning either ON with the same
-- destination still needs the switch (checked below), turning them OFF still needs nothing.
CREATE OR REPLACE FUNCTION public.paypal_entry_requires_switch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_member uuid;
BEGIN
  IF TG_TABLE_NAME = 'provider_payments' THEN
    IF TG_OP = 'UPDATE' THEN
      -- The payer is fixed once money is in; only account deletion may clear it (SET NULL).
      IF NEW.payer_id IS DISTINCT FROM OLD.payer_id AND NEW.payer_id IS NOT NULL THEN
        RAISE EXCEPTION 'payer_immutable' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    v_member := NEW.payer_id;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      IF NEW.user_id IS NOT DISTINCT FROM OLD.user_id
         AND NEW.paypal_email IS NOT DISTINCT FROM OLD.paypal_email
         AND NEW.paypal_payer_id IS NOT DISTINCT FROM OLD.paypal_payer_id
         AND NEW.venmo_handle IS NOT DISTINCT FROM OLD.venmo_handle THEN
        -- Who and where unchanged. Turning verified/payable OFF needs no switch (an admin stopping a
        -- hijacked destination); turning either ON is a new payout path and does (below).
        IF NOT ((NEW.verified AND NOT OLD.verified) OR (NEW.payable AND NOT OLD.payable)) THEN
          RETURN NEW;
        END IF;
      ELSE
        -- A new destination is unproven: it must be verified and made payable again.
        NEW.verified := false;
        NEW.payable := false;
      END IF;
    END IF;
    v_member := NEW.user_id;
  END IF;
  IF NOT public.feature_enabled_for_user('paypal_payments', v_member) THEN
    RAISE EXCEPTION 'feature_disabled' USING ERRCODE = '42501',
      DETAIL = format('paypal_payments is off for this member (%s)', TG_TABLE_NAME);
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_entry_requires_switch() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.paypal_payee_env()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  -- Sandbox only until the live-keys change (PAYPAL_LIVE_ALLOWED = false).
  SELECT 'sandbox'::text;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_payee_env() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_payee_env() TO service_role;

CREATE OR REPLACE FUNCTION public.paypal_payee_ready(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT p_user_id IS NOT NULL
     AND public.feature_enabled_for_user('paypal_payments', p_user_id)
     AND EXISTS (SELECT 1 FROM public.payee_accounts a
                  WHERE a.user_id = p_user_id
                    AND a.provider = 'paypal'
                    AND a.env = public.paypal_payee_env()
                    AND a.payable
                    AND a.paypal_email IS NOT NULL);
$fn$;
REVOKE ALL ON FUNCTION public.paypal_payee_ready(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_payee_ready(uuid) TO service_role;

-- helper_accept_missing: restated from its effective definition (20261023213857_identity_check_switch);
-- only the payout_setup line changes (Stripe ready OR a payable PayPal email, phase 2).
CREATE OR REPLACE FUNCTION public.helper_accept_missing(p_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
           WHEN p.user_id IS NULL THEN ARRAY['unknown']
           -- Fixture data stays usable while fixture-shaped AND an enrolled test
           -- account (seed_hidden_for's membership rule).
           WHEN p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) THEN ARRAY[]::text[]
           ELSE array_remove(ARRAY[
             -- Payout setup: Stripe Connect ready, or (PayPal phase 2) a payable PayPal email while
             -- the `paypal_payments` switch is on for this member.
             CASE WHEN (p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE)
                       AND NOT public.paypal_payee_ready(p.user_id) THEN 'payout_setup' END,
             -- The ID step only while the `identity_check` switch is on for this member (owner 2026-10-23).
             CASE WHEN public.feature_enabled_for_user('identity_check', p.user_id)
                       AND NOT public.identity_is_verified(p.idv_status, p.stripe_identity_verified) THEN 'stripe_id' END
           ], NULL)
         END
    FROM (SELECT p_user_id AS uid) x
    LEFT JOIN public.profiles p ON p.user_id = x.uid;
$fn$;
REVOKE ALL ON FUNCTION public.helper_accept_missing(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helper_accept_missing(uuid) TO service_role;

-- The one completion of a Helpr's waiting accepts (Q1180/Q1185). Moved out of the profiles trigger
-- complete_pending_accepts_on_setup (effective definition 20261021061341) so a saved PayPal email
-- completes them the same way. p_via only picks the notice's words. Returns how many completed.
CREATE OR REPLACE FUNCTION public.complete_pending_accepts_for(p_user_id uuid, p_via text DEFAULT 'stripe')
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  r        record;
  v_p      record;
  v_poster text;
  v_done   integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.job_accept_pending p WHERE p.helper_id = p_user_id) THEN
    RETURN 0;
  END IF;
  IF public.helper_accept_block_reason(p_user_id) IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT pr.ban_status, pr.auto_suspended_until, pr.is_seed INTO v_p
    FROM public.profiles pr WHERE pr.user_id = p_user_id;
  -- A ban in force (is_caller_banned's predicate) completes nothing; the
  -- pending row waits and goes when the offer moves on (review #6: in server
  -- context enforce_ban_gate is skipped, so the poster would hear "accepted").
  IF v_p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (v_p.ban_status <> 'temp_banned'
          OR v_p.auto_suspended_until IS NULL
          OR v_p.auto_suspended_until > now()) THEN
    RETURN 0;
  END IF;
  FOR r IN
    -- seed: a seed job, or a seed/test Helpr (detect_stuck_payments' rule)
    SELECT p.job_id, j.title, j.customer_id,
           coalesce(j.is_seed OR v_p.is_seed, false) AS seed,
           (j.status = 'open') AS direct
      FROM public.job_accept_pending p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = p_user_id
       AND (  -- a Hire's offer (Q1180)
              (j.status = 'accepted' AND j.helper_id = p.helper_id)
              -- a direct offer still live and still this Helpr's (Q1185)
           OR (j.status = 'open' AND j.helper_id IS NULL
               AND j.offered_to_helper_id = p.helper_id
               AND j.direct_offer_status = 'pending'
               AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at >= now())
               -- anything that would refuse it now (a block, the date passing, a
               -- tier, a ban): completes nothing, logs nothing
               AND public.direct_accept_block_reason(p.job_id, p.helper_id) IS NULL))
     ORDER BY p.requested_at
       FOR UPDATE OF j
  LOOP
    -- One job that cannot complete never rolls back the status write this runs
    -- inside (Stripe's status write or the PayPal email save; review #3;
    -- settle_one_off_jobs_for_banned_account's pattern): it is logged, and the rest still complete.
    BEGIN
      -- (parenthesised: plpgsql's IF reads its condition up to the first THEN)
      IF (CASE WHEN r.direct THEN public.complete_direct_offer_accept(r.job_id, p_user_id) IS NOT NULL
               ELSE public.complete_job_accept(r.job_id) END) THEN
        v_done := v_done + 1;
        SELECT public.member_display_name(pp.full_name, 'the person who posted it') INTO v_poster
          FROM public.profiles pp WHERE pp.user_id = r.customer_id;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          p_user_id,
          'You''re all set',
          CASE WHEN p_via = 'paypal' THEN 'Your PayPal email is saved' ELSE 'Your payout setup and Stripe ID are done' END
            || ', so you''ve accepted "' || COALESCE(r.title, 'the job')
            || '", and ' || COALESCE(v_poster, 'the person who posted it') || ' has been told.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E job logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN r.seed THEN 'info' ELSE 'error' END,
        'pending accept completion failed',
        jsonb_build_object('source', 'complete_pending_accepts_on_setup' || CASE WHEN r.seed THEN '-seed' ELSE '' END,
                           'seed', r.seed, 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'helper_id', p_user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  RETURN v_done;
END;
$fn$;
REVOKE ALL ON FUNCTION public.complete_pending_accepts_for(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pending_accepts_for(uuid, text) TO service_role;

-- The profiles trigger (trg_profiles_complete_pending_accepts, unchanged) calls the one completion.
CREATE OR REPLACE FUNCTION public.complete_pending_accepts_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM public.complete_pending_accepts_for(NEW.user_id, 'stripe');
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.complete_pending_accepts_on_setup() FROM PUBLIC, anon, authenticated;

-- The one completion of a Helpr's waiting crew Confirms (Q1265 crew hire before payout setup). Moved
-- out of complete_pending_crew_confirms_on_setup (effective definition 20261021062140). Returns how
-- many slots were confirmed.
CREATE OR REPLACE FUNCTION public.complete_pending_crew_confirms_for(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  v_p    record;
  v_name text;
  v_done integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crew_confirm_pending p WHERE p.helper_id = p_user_id) THEN
    RETURN 0;
  END IF;
  -- Payout setup AND the identity rule, the one helper every accept reads.
  IF public.helper_accept_block_reason(p_user_id) IS NOT NULL THEN
    RETURN 0;
  END IF;
  SELECT pr.ban_status, pr.auto_suspended_until INTO v_p
    FROM public.profiles pr WHERE pr.user_id = p_user_id;
  -- A ban in force completes nothing (complete_pending_accepts_for's
  -- predicate); the recorded Confirm waits.
  IF v_p.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (v_p.ban_status <> 'temp_banned'
          OR v_p.auto_suspended_until IS NULL
          OR v_p.auto_suspended_until > now()) THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT p.slot_id, p.job_id, j.title, j.customer_id, g.helper_id = p_user_id AS still_theirs,
           j.status::text IN ('open', 'accepted', 'in_progress') AS live,
           g.helper_confirmed_at
      FROM public.crew_confirm_pending p
      JOIN public.group_job_helpers g ON g.id = p.slot_id
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = p_user_id
     ORDER BY p.requested_at
       FOR UPDATE OF g
  LOOP
    BEGIN
      IF r.still_theirs AND r.live AND r.helper_confirmed_at IS NULL THEN
        UPDATE public.group_job_helpers SET helper_confirmed_at = now() WHERE id = r.slot_id;
        v_done := v_done + 1;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          p_user_id,
          'You''re all set',
          'Your setup is done, so your spot on "' || COALESCE(r.title, 'the job') || '" is confirmed.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
        -- The poster hears it as from any member's Confirm-after-setup, as a
        -- single job's completed accept tells them (complete_job_accept).
        IF r.customer_id IS NOT NULL THEN
          SELECT public.member_display_name(pp.full_name, 'Someone') INTO v_name
            FROM public.profiles pp WHERE pp.user_id = p_user_id;
          INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
          VALUES (
            r.customer_id,
            COALESCE(v_name, 'Someone') || ' confirmed their spot',
            COALESCE(v_name, 'Someone') || ' confirmed their spot on "' || COALESCE(r.title, 'your job') || '".',
            'job_updates',
            '/posts?job=' || r.job_id::text,
            r.job_id
          );
        END IF;
      END IF;
      DELETE FROM public.crew_confirm_pending WHERE slot_id = r.slot_id;
    EXCEPTION WHEN OTHERS THEN
      -- seed-policy: no seed branch needed: a seed Helpr is never setup-blocked
      -- (helper_accept_missing's fixture carve-out), so a seed account never
      -- has a pending crew Confirm and never reaches this log.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        'error',
        'pending crew confirm completion failed',
        jsonb_build_object('source', 'complete_pending_crew_confirms_on_setup', 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'slot_id', r.slot_id, 'helper_id', p_user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  RETURN v_done;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_pending_crew_confirms_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pending_crew_confirms_for(uuid) TO service_role;

-- The profiles trigger (trg_profiles_complete_pending_crew_confirms, unchanged) calls the one completion.
CREATE OR REPLACE FUNCTION public.complete_pending_crew_confirms_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.complete_pending_crew_confirms_for(NEW.user_id);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_pending_crew_confirms_on_setup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pending_crew_confirms_on_setup() TO service_role;

-- "j•••@gmail.com": what the member sees of their own payout email.
CREATE OR REPLACE FUNCTION public.paypal_email_masked(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN p_email IS NULL OR position('@' IN p_email) < 2 THEN NULL
              ELSE left(p_email, 1) || '•••' || substr(p_email, position('@' IN p_email)) END;
$fn$;
REVOKE ALL ON FUNCTION public.paypal_email_masked(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paypal_email_masked(text) TO service_role;

-- The member's one write: their PayPal email, typed twice.
CREATE OR REPLACE FUNCTION public.set_paypal_payee_email(p_email text, p_email_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_env     text := public.paypal_payee_env();
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_old     text;
  v_found   boolean;
  v_changed boolean := false;
  v_held    integer := 0;
  v_accepts integer := 0;
  v_crew    integer := 0;
BEGIN
  PERFORM public.require_feature('paypal_payments');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_email = '' THEN
    RAISE EXCEPTION 'paypal_email_required' USING ERRCODE = '22023';
  END IF;
  -- One @, something before it, a dot in the domain, no spaces; PayPal's own limit is 127.
  IF length(v_email) > 127 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'paypal_email_invalid' USING ERRCODE = '22023';
  END IF;
  IF lower(btrim(coalesce(p_email_confirm, ''))) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'paypal_email_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Profile before job, the lock order of accept_job_offer (FOR SHARE) and the profiles triggers:
  -- an Accept tapped while this runs waits, then sees the saved email and completes at once.
  PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR NO KEY UPDATE;

  SELECT a.paypal_email INTO v_old
    FROM public.payee_accounts a
   WHERE a.user_id = v_uid AND a.provider = 'paypal' AND a.env = v_env
     FOR UPDATE;
  v_found := FOUND;

  IF NOT v_found THEN
    INSERT INTO public.payee_accounts (user_id, provider, env, paypal_email)
    VALUES (v_uid, 'paypal', v_env, v_email);
    v_changed := true;
  ELSIF v_old IS DISTINCT FROM v_email THEN
    -- paypal_entry_requires_switch resets verified and payable on a new destination.
    UPDATE public.payee_accounts
       SET paypal_email = v_email, updated_at = now()
     WHERE user_id = v_uid AND provider = 'paypal' AND env = v_env;
    v_changed := true;
    -- Money already queued to the OLD email is held, never sent to either until an admin checks
    -- (a payout's destination is frozen: the admin cancels it and queues one to the new email).
    UPDATE public.provider_payouts
       SET status = 'held', updated_at = now()
     WHERE payee_user_id = v_uid
       AND provider = 'manual_paypal'
       AND env = v_env
       AND status = 'pending';
    GET DIAGNOSTICS v_held = ROW_COUNT;
  END IF;

  -- A new or changed email is payable; the same email again changes nothing (an admin who turned
  -- this destination off is not overridden by a re-save).
  IF v_changed THEN
    UPDATE public.payee_accounts
       SET payable = true, updated_at = now()
     WHERE user_id = v_uid AND provider = 'paypal' AND env = v_env;
  END IF;

  -- Setup is done: the Helpr's waiting accepts and crew Confirms complete (each checks the gate).
  v_accepts := public.complete_pending_accepts_for(v_uid, 'paypal');
  v_crew := public.complete_pending_crew_confirms_for(v_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'email_masked', public.paypal_email_masked(v_email),
    'payable', (SELECT a.payable FROM public.payee_accounts a
                 WHERE a.user_id = v_uid AND a.provider = 'paypal' AND a.env = v_env),
    'held_payouts', v_held,
    'accepts_completed', v_accepts,
    'crew_confirms_completed', v_crew
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.set_paypal_payee_email(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_paypal_payee_email(text, text) TO authenticated, service_role;

-- The member's own state (payee_accounts is server-only, so this is the only read).
CREATE OR REPLACE FUNCTION public.get_my_paypal_payee()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
BEGIN
  PERFORM public.require_feature('paypal_payments');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT a.paypal_email, a.verified, a.payable, a.updated_at INTO v_row
    FROM public.payee_accounts a
   WHERE a.user_id = v_uid AND a.provider = 'paypal' AND a.env = public.paypal_payee_env();
  IF NOT FOUND OR v_row.paypal_email IS NULL THEN
    RETURN jsonb_build_object('has_email', false);
  END IF;
  RETURN jsonb_build_object(
    'has_email', true,
    'email_masked', public.paypal_email_masked(v_row.paypal_email),
    'verified', v_row.verified,
    'payable', v_row.payable,
    'updated_at', v_row.updated_at
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_my_paypal_payee() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_paypal_payee() TO authenticated, service_role;
