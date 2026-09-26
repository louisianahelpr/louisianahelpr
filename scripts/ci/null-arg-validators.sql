-- Class check (Q140): a NULL argument never makes an allow/validity check say
-- yes. Returns one row per problem as `fn|shape|detail`; ZERO ROWS = CLEAN.
--
-- Why: helper_credential_document_ok / credential_document_path_ok were chains
-- of `IF <cond> THEN RETURN false` ending in `RETURN EXISTS(...)`. A NULL kind
-- made every condition NULL, plpgsql skipped them all, and the function said
-- TRUE for another member's real document (live, 2026-09-23). The same sweep
-- found check_dispute_velocity(NULL) = TRUE, identity_is_verified(NULL, false)
-- = NULL and job_is_funded(NULL) = NULL. 20260923123701 fixed all five.
--
-- INVENTORY = pg_proc: every function in public returning boolean. Each must be
-- classified below, exactly (an unclassified or stale entry is a row):
--   allow    TRUE grants access / says "valid". For every argument there is a
--            case: a call that returns TRUE on the fixture below, which must
--            return exactly FALSE (not NULL, not TRUE) with that argument NULL.
--            NULL is not false: `IF NOT f(x) THEN RAISE` skips on NULL.
--   absent   allow-shaped, but NULL means "no value supplied" and is valid by
--            design; say why.
--   deny     TRUE refuses / blocks / suppresses, so TRUE for NULL fails safe.
--   classify labels a row (seed? taxable? late?); no access decision.
--   noarg    no argument to NULL.
--   action   VOLATILE: an RPC that does something and reports success. Not
--            called here (it would write).
--
-- Every case runs inside ONE transaction on throwaway fixture rows and the
-- script ends in ROLLBACK. It writes to a replayed CI database only: never run
-- it against prod (the live twin is a read-only probe on real rows,
-- ~/.lh-shots/q140/probe.mjs, see docs/OPEN.md Q140).
--
-- Shared by:
--   .github/workflows/db-smoke.yml   replayed schema (deploy gate)
--   src/test/nullArgNeverAllows.test.ts  pins the classification + wiring

\set ON_ERROR_STOP 1
BEGIN;

CREATE TEMP TABLE q140_out (fn text, shape text, detail text) ON COMMIT DROP;

CREATE TEMP TABLE q140_class (fn text PRIMARY KEY, kind text NOT NULL, why text NOT NULL) ON COMMIT DROP;
INSERT INTO q140_class (fn, kind, why) VALUES
  ('can_message_in_job',            'allow',    'may this sender post in this job'),
  ('can_review_job',                'allow',    'may this party review this job'),
  ('can_send_message_in_job',       'allow',    'may the caller post in this job'),
  ('can_send_message_to_in_job',    'allow',    'may the caller message this receiver'),
  ('check_dispute_velocity',        'allow',    'TRUE = under the dispute limit (no fraud flag)'),
  ('credential_document_path_ok',   'allow',    'profile credential URL is the member''s own object'),
  ('dispute_evidence_url_ok',       'allow',    'evidence URL is the uploader''s own object for this job'),
  ('has_role',                      'allow',    'user holds role (admin gates)'),
  ('helper_credential_document_ok', 'allow',    'helper_credentials document is the member''s own object'),
  ('helper_has_advanced_analytics', 'allow',    'caller''s own paid-tier entitlement'),
  ('identity_is_verified',          'allow',    'identity badge / hire gate verdict'),
  ('is_party_to_job',               'allow',    'user is a party to the job'),
  ('is_party_to_job_folder',        'allow',    'caller is a party to the job owning this storage folder'),
  ('job_is_funded',                 'allow',    'job escrow is funded (applications WITH CHECK)'),
  ('job_payment_is_funded',         'allow',    'payment_status counts as funded (award + apply gates)'),
  ('user_has_pending_application',  'allow',    'user applied to the job'),
  ('user_may_see_job_address',      'allow',    'user may see the exact job address'),
  ('is_safe_media_url',             'absent',   'NULL = no URL stored; nothing to render (nullable avatar_url CHECK)'),
  ('are_safe_media_urls',           'absent',   'NULL = no photo list stored (nullable jobs.photos / portfolio_urls CHECK)'),
  ('are_users_blocked',             'deny',     'TRUE refuses the interaction'),
  ('is_helper_shadowbanned',        'deny',     'TRUE hides the helper'),
  ('is_submitted_credential_object','deny',     'TRUE freezes the object (storage UPDATE/DELETE policies use NOT)'),
  ('is_thread_muted',               'deny',     'TRUE suppresses the notification'),
  ('admin_notification_crosses_seed_boundary','deny', 'TRUE: the admin client skips the notification (Q157)'),
  ('notification_crosses_seed_boundary','deny', 'TRUE suppresses the notification'),
  ('error_log_is_seed',             'classify', 'labels an error_logs row as seed traffic'),
  ('is_category_taxable',           'classify', 'labels an earnings export row Taxable/Exempt'),
  ('is_late_cancellation',          'classify', 'labels a cancellation late (fee ladder)'),
  ('is_seed_email',                 'classify', 'labels an address as a seed account'),
  ('is_user_error_screen_row',      'classify', 'labels an error_logs row as a user-facing error screen'),
  ('get_thread_counterparty_deleted', 'classify', 'labels a thread''s other party as a deleted account (read-only notice); grants no access (it discloses one bit, account gone vs exists, see its migration), and a NULL argument returns false (threadCounterpartyDeleted.pglite.mjs)'),
  ('user_error_screen_is_real',     'classify', 'labels an error screen as real-user (ops alert counting)'),
  ('user_report_is_open',           'classify', 'labels a reports row still to-do in its admin queue (ledger close rule, Q64); NULL status = pending'),
  ('user_report_is_real',           'classify', 'labels a reporter as real (ledger routing, Q64); NULL reporter = a deleted account = real'),
  ('admin_queue_still_pending',     'classify', 'labels an admin-queue ledger item still pending (close rule, Q355); NULL rule = cannot tell'),
  ('is_caller_banned',              'noarg',    'reads auth.uid() only'),
  ('is_server_context',             'noarg',    'reads the session only'),
  ('seed_jobs_hidden_publicly',     'noarg',    'reads the launch switch only'),
  ('clear_thread_mute',             'action',   'RPC'),
  ('delete_email',                  'action',   'pgmq wrapper'),
  ('deliver_saved_search_alert',    'action',   'saved-search send (writes; true = sent)'),
  ('ops_alert_close',               'action',   'RPC'),
  ('ops_alert_condition',           'action',   'ops ledger probe (writes)'),
  ('ops_alert_mark_fixed',          'action',   'RPC'),
  ('process_referral',              'action',   'RPC'),
  ('record_profile_view',           'action',   'RPC'),
  ('record_referral_signup',        'action',   'RPC'),
  ('refund_monthly_free_boost',     'action',   'RPC'),
  ('release_dispute_settlement_claim','action', 'RPC'),
  ('report_stale_dispute_settlement_claim','action','RPC'),
  ('resolve_stalled_job_flag',      'action',   'RPC'),
  ('stamp_dispute_settlement_claim','action',   'RPC'),
  ('toggle_thread_mute',            'action',   'RPC');

-- Fixture ids (all 00000000-0000-4000-8140-*): A poster, B hired helper on a
-- pro plan, D admin; J an open funded job (A posts, B hired, B applied);
-- R a completed, released job A may review.
CREATE TEMP TABLE q140_case (fn text NOT NULL, sub uuid, args text[] NOT NULL, null_at int[] NOT NULL) ON COMMIT DROP;
INSERT INTO q140_case (fn, sub, args, null_at) VALUES
  ('can_message_in_job',            NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  ('can_review_job',                NULL, ARRAY['''00000000-0000-4000-8140-000000000102''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  ('can_send_message_in_job',       '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  ('can_send_message_to_in_job',    '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  ('check_dispute_velocity',        NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1]),
  ('credential_document_path_ok',   NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''insurance''', '''00000000-0000-4000-8140-00000000000a/credentials/insurance-1787168146999.png'''], ARRAY[1,2,3]),
  ('dispute_evidence_url_ok',       NULL, ARRAY['''00000000-0000-4000-8140-00000000000a/disputes/00000000-0000-4000-8140-000000000101/a.png''', '''00000000-0000-4000-8140-00000000000a''::uuid', '''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1,2,3]),
  ('has_role',                      NULL, ARRAY['''00000000-0000-4000-8140-00000000000d''::uuid', '''admin''::public.app_role'], ARRAY[1,2]),
  ('helper_credential_document_ok', NULL, ARRAY['''00000000-0000-4000-8140-00000000000a''::uuid', '''trade_license''', '''00000000-0000-4000-8140-00000000000a/credentials/trade_license-1757721600000.png'''], ARRAY[1,2,3]),
  ('helper_has_advanced_analytics', '00000000-0000-4000-8140-00000000000b', ARRAY['''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1]),
  -- identity: each argument alone can say yes, so each gets the tuple where it is the one deciding.
  ('identity_is_verified',          NULL, ARRAY['''verified''', 'false'], ARRAY[1]),
  ('identity_is_verified',          NULL, ARRAY['''unverified''', 'true'], ARRAY[2]),
  ('is_party_to_job',               NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000a''::uuid'], ARRAY[1,2]),
  ('is_party_to_job_folder',        '00000000-0000-4000-8140-00000000000a', ARRAY['''00000000-0000-4000-8140-000000000101/x.png'''], ARRAY[1]),
  ('job_is_funded',                 NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid'], ARRAY[1]),
  ('job_payment_is_funded',         NULL, ARRAY['''escrow'''], ARRAY[1]),
  ('user_has_pending_application',  NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]),
  ('user_may_see_job_address',      NULL, ARRAY['''00000000-0000-4000-8140-000000000101''::uuid', '''00000000-0000-4000-8140-00000000000b''::uuid'], ARRAY[1,2]);

DO $q140$
DECLARE
  A constant uuid := '00000000-0000-4000-8140-00000000000a';
  B constant uuid := '00000000-0000-4000-8140-00000000000b';
  D constant uuid := '00000000-0000-4000-8140-00000000000d';
  J constant uuid := '00000000-0000-4000-8140-000000000101';
  R constant uuid := '00000000-0000-4000-8140-000000000102';
  step text;
BEGIN
  -- Fixture rows are data for the checks, not a test of the triggers: skip
  -- them where the role may (superuser), else write through them.
  BEGIN
    PERFORM set_config('session_replication_role', 'replica', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'q140: triggers stay on for the fixture (%)', SQLERRM;
  END;
  -- Not superuser (CI's postgres role): replica mode is refused, so switch off
  -- the user triggers of the public fixture tables instead (postgres owns them;
  -- the ROLLBACK at the end restores them). Measured in db-smoke 35862895416:
  -- with triggers on, the admin-role guard refuses a non-service_role grant and
  -- the application notifier's pg_net call dies on a NULL url.
  FOREACH step IN ARRAY ARRAY['public.profiles', 'public.user_roles', 'public.jobs', 'public.applications'] LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s DISABLE TRIGGER USER', step);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'q140: triggers stay on for % (%)', step, SQLERRM;
    END;
  END LOOP;
  FOR step IN SELECT unnest(ARRAY['users', 'profiles', 'role', 'jobs', 'application', 'bucket', 'objects']) LOOP
    BEGIN
      CASE step
      WHEN 'users' THEN
        INSERT INTO auth.users (id, email) VALUES
          (A, 'q140-a@helpr.test'), (B, 'q140-b@helpr.test'), (D, 'q140-d@helpr.test')
        ON CONFLICT (id) DO NOTHING;
      WHEN 'profiles' THEN
        INSERT INTO public.profiles (user_id) VALUES (A), (B), (D) ON CONFLICT (user_id) DO NOTHING;
        UPDATE public.profiles SET subscription_tier = 'pro', subscription_expires_at = NULL WHERE user_id = B;
      WHEN 'role' THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (D, 'admin');
      WHEN 'jobs' THEN
        INSERT INTO public.jobs (id, title, description, category, budget, location, parish, date_needed,
                                 customer_id, helper_id, status, payment_status, start_time)
        VALUES (J, '[q140] open', 'q140 fixture', 'cleaning', 50, 'Test', 'Orleans', CURRENT_DATE + 7,
                A, B, 'open', 'escrow', '00:00');
        INSERT INTO public.jobs (id, title, description, category, budget, location, parish, date_needed,
                                 customer_id, helper_id, status, payment_status, poster_completed_at, helper_completed_at, start_time)
        VALUES (R, '[q140] done', 'q140 fixture', 'cleaning', 50, 'Test', 'Orleans', CURRENT_DATE,
                A, B, 'completed', 'released', now(), now(), '00:00');
      WHEN 'application' THEN
        INSERT INTO public.applications (job_id, helper_id) VALUES (J, B);
      WHEN 'bucket' THEN
        INSERT INTO storage.buckets (id, name) VALUES ('user-documents', 'user-documents') ON CONFLICT (id) DO NOTHING;
      WHEN 'objects' THEN
        INSERT INTO storage.objects (bucket_id, name) VALUES
          ('user-documents', A::text || '/credentials/insurance-1787168146999.png'),
          ('user-documents', A::text || '/credentials/trade_license-1757721600000.png');
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO q140_out VALUES ('(fixture)', 'FIXTURE_FAILED', step || ': ' || SQLERRM);
    END;
  END LOOP;
  BEGIN
    PERFORM set_config('session_replication_role', 'origin', true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END
$q140$;

DO $q140$
DECLARE
  r record;
  c record;
  i int;
  a text[];
  res boolean;
  nargs int;
BEGIN
  -- 1. The inventory is exact both ways.
  FOR r IN
    SELECT p.proname::text AS fn, p.pronargs, p.provolatile
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prorettype = 'boolean'::regtype
  LOOP
    IF NOT EXISTS (SELECT 1 FROM q140_class k WHERE k.fn = r.fn) THEN
      INSERT INTO q140_out VALUES (r.fn, 'UNCLASSIFIED', 'new boolean function: classify it in scripts/ci/null-arg-validators.sql (allow needs a case per argument)');
    END IF;
  END LOOP;
  FOR r IN SELECT k.fn, k.kind FROM q140_class k LOOP
    SELECT count(*) INTO nargs
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prorettype = 'boolean'::regtype AND p.proname = r.fn;
    IF nargs = 0 THEN
      INSERT INTO q140_out VALUES (r.fn, 'STALE', 'classified but no such boolean function in public');
    END IF;
  END LOOP;
  FOR r IN
    SELECT k.fn, k.kind, p.pronargs, p.provolatile
      FROM q140_class k JOIN pg_proc p ON p.proname = k.fn AND p.pronamespace = 'public'::regnamespace AND p.prorettype = 'boolean'::regtype
  LOOP
    IF (r.kind = 'noarg') <> (r.pronargs = 0) THEN
      INSERT INTO q140_out VALUES (r.fn, 'WRONG_KIND', 'noarg iff it takes no arguments');
    ELSIF (r.kind = 'action') <> (r.provolatile = 'v') THEN
      INSERT INTO q140_out VALUES (r.fn, 'WRONG_KIND', 'action iff VOLATILE (a volatile check is not probed: say why, or make it STABLE)');
    END IF;
    IF r.kind = 'allow' THEN
      FOR i IN 1 .. r.pronargs LOOP
        IF NOT EXISTS (SELECT 1 FROM q140_case x WHERE x.fn = r.fn AND i = ANY (x.null_at)) THEN
          INSERT INTO q140_out VALUES (r.fn, 'NO_CASE', 'argument ' || i || ' is never NULLed');
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM q140_class WHERE kind = 'allow') < 17 OR (SELECT count(*) FROM q140_class) < 47 THEN
    INSERT INTO q140_out VALUES ('(inventory)', 'FLOOR', 'fewer classified functions than on 2026-09-23 (47, 17 allow)');
  END IF;

  -- 2. Every allow case: TRUE on the fixture, exactly FALSE with each argument NULL.
  FOR c IN SELECT * FROM q140_case LOOP
    IF NOT EXISTS (SELECT 1 FROM q140_class k WHERE k.fn = c.fn AND k.kind = 'allow') THEN
      INSERT INTO q140_out VALUES (c.fn, 'CASE_NOT_ALLOW', 'a case for a function not classified allow');
      CONTINUE;
    END IF;
    PERFORM set_config('request.jwt.claim.sub', coalesce(c.sub::text, ''), true);
    PERFORM set_config('request.jwt.claims', CASE WHEN c.sub IS NULL THEN '' ELSE json_build_object('sub', c.sub, 'role', 'authenticated')::text END, true);
    BEGIN
      EXECUTE format('SELECT public.%I(%s)', c.fn, array_to_string(c.args, ', ')) INTO res;
      IF res IS NOT TRUE THEN
        INSERT INTO q140_out VALUES (c.fn, 'BASELINE_NOT_TRUE', 'the fixture call returned ' || coalesce(res::text, 'NULL') || ', so its NULL cases prove nothing');
      END IF;
      FOREACH i IN ARRAY c.null_at LOOP
        a := c.args;
        a[i] := 'NULL';
        EXECUTE format('SELECT public.%I(%s)', c.fn, array_to_string(a, ', ')) INTO res;
        IF res IS DISTINCT FROM false THEN
          INSERT INTO q140_out VALUES (c.fn, 'NULL_ARG_ALLOWS', 'argument ' || i || ' NULL returned ' || coalesce(res::text, 'NULL') || ' (must be false)');
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO q140_out VALUES (c.fn, 'CASE_ERROR', SQLERRM);
    END;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;
END
$q140$;

SELECT fn || '|' || shape || '|' || detail FROM q140_out ORDER BY 1;
ROLLBACK;
