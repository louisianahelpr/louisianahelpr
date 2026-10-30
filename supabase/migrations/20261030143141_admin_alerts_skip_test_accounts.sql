-- Test stuff never reaches an admin's bell (owner, 2026-10-30, top priority).
--
-- What the owner saw on 2026-10-30: "New member joined" for audit throwaways
-- (mailinator sign-ups that were not marked is_seed when they confirmed), and
-- "Declutter problem reported" / "Declutter refund to decide" alerts raised by
-- test-account orders. The lead deleted 14 of them on prod.
--
-- Why they got through (read from the EFFECTIVE prod definitions, 2026-10-30;
-- each function below is restated from a body whose md5 equals prod's prosrc):
--   * notification_crosses_seed_boundary (md5 8e776832...) is the one gate
--     every notification passes (the notifications_seed_boundary BEFORE INSERT
--     trigger, and send-notification-email asks it too). It called an account
--     "test" only when profiles.is_seed was true. A mailinator sign-up is not
--     is_seed until someone marks it, so "New member joined" went out.
--   * The Declutter admin alerts link to bare '/admin': the gate had no subject
--     to look at, so a test order's problem or refund reached every admin.
--
-- What changes:
--   1. public.is_test_subject(uuid): is_test_member (is_seed or test_accounts)
--      OR the account's email is a fixture inbox (public.is_fixture_email:
--      @mailinator.com, @helpr.test, eli.test.*) OR a reserved test domain
--      (example.com/.org/.net, *.test, *.invalid, *.example, *.localhost:
--      the same set _shared/reservedRecipient.ts refuses to mail).
--   2. notification_crosses_seed_boundary: the actor test uses is_test_subject
--      instead of is_seed alone. And for an ADMIN-FACING row (the recipient is
--      an admin and the link opens /admin) two more subjects count:
--        - the job's poster or Helpr (a job an unmarked test account posted);
--        - the signed-in member whose own action raised the alert
--          (auth.uid(): declutter_report_problem, declutter_problem_add_side,
--          shops_report_not_received, rentals_submit_* run as that member).
--      Member-facing rows keep today's rules.
--   3. declutter_refund_request_to_admin (md5 2f21a4d4...) can run with no
--      signed-in member (service_role only), so it skips the admin alert itself
--      when the buyer or the seller is a test subject.
--   4. notify_admins_new_member (md5 ee09a4f0...) skips a test subject, not only
--      is_seed, before it claims the announcement.
--
-- src/test/adminAlertsSkipTestAccounts.test.ts inventories every function that
-- notifies admins and fails on one with no test skip (exact list of the ones
-- still to do). PGlite proof: src/test/pglite/adminAlertsSkipTestAccounts.pglite.mjs.
--
-- Replay-safe: CREATE OR REPLACE only; grants restated as before
-- (service_role only, PUBLIC/anon/authenticated revoked).

CREATE OR REPLACE FUNCTION public.is_test_subject(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_user_id IS NOT NULL AND (
    public.is_test_member(p_user_id)
    OR EXISTS (
      SELECT 1 FROM auth.users u
       WHERE u.id = p_user_id
         AND (public.is_fixture_email(u.email)
              OR lower(btrim(coalesce(u.email, ''))) ~ '@(example\.(com|org|net)|[^@]*\.(test|invalid|example|localhost))$')
    )
  );
$fn$;

REVOKE ALL ON FUNCTION public.is_test_subject(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_test_subject(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.notification_crosses_seed_boundary(
  p_recipient uuid,
  p_job_id uuid,
  p_link text,
  p_actor uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_job uuid;
  v_actor_text text;
  v_actor uuid;
  v_admin_row boolean;
BEGIN
  -- Seed-to-seed is allowed. A recipient with no profiles row is NOT seed:
  -- when in doubt the recipient is treated as a real person.
  IF p_recipient IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles rp
    WHERE rp.user_id = p_recipient AND rp.is_seed IS TRUE
  ) THEN
    RETURN false;
  END IF;

  -- An admin-facing row: an admin recipient and a link into the admin screens.
  -- Test stuff never shows there (owner 2026-10-30), so more subjects count.
  v_admin_row := COALESCE(p_link, '') LIKE '/admin%'
    AND EXISTS (SELECT 1 FROM public.user_roles ar WHERE ar.user_id = p_recipient AND ar.role = 'admin');

  -- The subject job: the row's own job_id, else the one its link names.
  v_job := COALESCE(p_job_id, public.notification_job_id_from_link(p_link));
  IF v_job IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = v_job AND j.is_seed IS TRUE
  ) THEN
    RETURN true;
  END IF;
  -- Admin-facing: a job a test account posted or works, even if the job row
  -- itself was never marked.
  IF v_admin_row AND v_job IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = v_job
       AND (public.is_test_subject(j.customer_id) OR public.is_test_subject(j.helper_id))
  ) THEN
    RETURN true;
  END IF;

  -- The actor: one the caller names (create-notification passes the signed-in
  -- sender), else the one the link names: '/messages?...&userId=<sender>',
  -- '/post-job?offerTo=<helper>', '/admin?view=people&user=<member>'.
  -- Anchored on a full canonical uuid so a malformed id is ignored, never cast.
  -- A test subject is is_seed, test_accounts, or a fixture / reserved email
  -- (a mailinator sign-up nobody marked yet).
  v_actor_text := (regexp_match(
    COALESCE(p_link, ''),
    '[?&](?:userId|offerTo|user)=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:[&#]|$)'
  ))[1];
  v_actor := COALESCE(p_actor, v_actor_text::uuid);
  IF v_actor IS NOT NULL AND v_actor <> p_recipient AND public.is_test_subject(v_actor) THEN
    RETURN true;
  END IF;

  -- Admin-facing: the signed-in member whose own action raised the alert
  -- (a Declutter problem report, a shop order not received). A cron or the
  -- service role has no auth.uid(), so this never fires for them.
  IF v_admin_row AND (SELECT auth.uid()) IS NOT NULL AND (SELECT auth.uid()) <> p_recipient
     AND public.is_test_subject((SELECT auth.uid())) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notification_crosses_seed_boundary(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_crosses_seed_boundary(uuid, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.declutter_refund_request_to_admin(p_request_id uuid, p_why text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r public.declutter_refund_requests;
  o public.declutter_orders;
  v_problem uuid;
  a record;
BEGIN
  SELECT * INTO r FROM public.declutter_refund_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO o FROM public.declutter_orders WHERE id = r.order_id;
  SELECT x.id INTO v_problem FROM public.declutter_problems x WHERE x.order_id = r.order_id AND x.status = 'open';
  IF v_problem IS NULL THEN
    INSERT INTO public.declutter_problems (order_id, reporter_id, reporter_side, reason, note, photo_paths)
    VALUES (r.order_id, o.buyer_id, 'buyer', r.reason,
            left(btrim(r.note) || E'\n\n[Refund request: ' || p_why || ']', 1000), COALESCE(r.photo_paths, '{}'))
    RETURNING id INTO v_problem;
    -- Test stuff never reaches an admin (owner 2026-10-30): no alert when either
    -- side is a test account. This can run with no signed-in member, so the
    -- notification gate's auth.uid() rule cannot stand in for it.
    IF NOT (public.is_test_subject(o.buyer_id) OR public.is_test_subject(o.seller_id)) THEN
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.declutter_notify(a.user_id, 'warning', 'Declutter refund to decide',
          'A buyer asked for a refund after the handover and the two sides did not agree. The seller''s payout is held until you decide.', '/admin');
      END LOOP;
    END IF;
  ELSE
    -- D2-3: joining a problem already open: the request's photos are added to it (the problem holds up to 6).
    UPDATE public.declutter_problems x
       SET photo_paths = (SELECT COALESCE(array_agg(u.p ORDER BY u.n), '{}') FROM (
             SELECT q.p, min(q.n) AS n FROM unnest(x.photo_paths || COALESCE(r.photo_paths, '{}')) WITH ORDINALITY AS q(p, n)
              GROUP BY q.p ORDER BY min(q.n) LIMIT 6) u)
     WHERE x.id = v_problem AND cardinality(COALESCE(r.photo_paths, '{}')) > 0;
  END IF;
  UPDATE public.declutter_refund_requests SET status = 'to_admin', problem_id = v_problem WHERE id = r.id;
  PERFORM public.declutter_notify(o.buyer_id, 'warning', 'Louisiana Helpr will decide',
    'Your refund request goes to Louisiana Helpr. We look at both sides and decide. The seller isn''t paid until then.',
    '/declutter?view=cart', o.seller_id);
  PERFORM public.declutter_notify(o.seller_id, 'warning', 'Louisiana Helpr will decide',
    'The buyer''s refund request goes to Louisiana Helpr. We look at both sides and decide. Your payout waits until then.',
    '/declutter?view=selling', o.buyer_id);
  RETURN v_problem;
END;
$fn$;
REVOKE ALL ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.declutter_refund_request_to_admin(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_admins_new_member(p_user_id uuid, p_via text DEFAULT 'confirm'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_confirmed timestamptz;
  v_name      text;
  v_location  text;
  v_seed      boolean;
  v_found     boolean := false;
  v_claimed   uuid;
  v_sent      integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'not_confirmed';
  END IF;

  SELECT u.email_confirmed_at INTO v_confirmed FROM auth.users u WHERE u.id = p_user_id;
  -- An abandoned signup never confirms, so it is never announced.
  IF v_confirmed IS NULL THEN
    RETURN 'not_confirmed';
  END IF;

  SELECT NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.location), ''), coalesce(p.is_seed, false), true
    INTO v_name, v_location, v_seed, v_found
    FROM public.profiles p WHERE p.user_id = p_user_id;
  IF NOT coalesce(v_found, false) THEN
    RETURN 'no_profile';
  END IF;
  -- Owner 2026-10-27 ("test stuff should never be shown"): EVERY test account
  -- (is_seed) is skipped, not only the ones listed in test_accounts. The
  -- nightly journeys' throwaway "SEED Journey ..." accounts are is_seed but
  -- not in test_accounts, and each one reached every admin's bell.
  -- 2026-10-30 (owner, again): an unmarked throwaway too, such as a
  -- mailinator audit sign-up nobody flagged is_seed (public.is_test_subject).
  IF v_seed OR public.is_test_subject(p_user_id) THEN
    RETURN 'seed';
  END IF;
  -- A provider takeover whose wipe FAILED (zz_wipe_on_provider_takeover
  -- catches its own error) still holds the pre-verification squatter's name
  -- and city. Announce nothing and make no claim; the wipe sweep surfaces the
  -- failure, and the real owner's complete-signup announces once it is fixed.
  IF EXISTS (
       SELECT 1 FROM public.pre_verification_wipes w
        WHERE w.user_id = p_user_id AND w.error LIKE 'wipe failed:%'
          AND NOT EXISTS (SELECT 1 FROM public.pre_verification_wipes ok
                           WHERE ok.user_id = p_user_id AND ok.error IS NULL
                             AND ok.wiped_at > w.wiped_at)) THEN
    RETURN 'wipe_failed';
  END IF;
  -- Wait for a name: complete-signup calls again once the profile has one.
  IF v_name IS NULL THEN
    RETURN 'no_name';
  END IF;

  -- Announced already by the signup-time code this replaces (a complete-signup
  -- still running the old build while this migration lands): claim it, send
  -- nothing.
  -- Scoped to admin recipients so it rides the user_id indexes instead of
  -- scanning notifications inside GoTrue's confirm UPDATE.
  IF EXISTS (SELECT 1 FROM public.notifications x
              WHERE x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
                AND x.title = 'New member joined'
                AND x.link = '/admin?view=people&user=' || p_user_id::text) THEN
    INSERT INTO public.new_member_admin_notices (user_id, via)
    VALUES (p_user_id, 'earlier-notice')
    ON CONFLICT (user_id) DO NOTHING;
    RETURN 'already_sent';
  END IF;

  -- The exactly-once claim. Rolled back with the notification rows if they fail.
  INSERT INTO public.new_member_admin_notices (user_id, via)
  VALUES (p_user_id, coalesce(p_via, 'confirm'))
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_claimed;
  IF v_claimed IS NULL THEN
    RETURN 'already_sent';
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT ur.user_id,
         'New member joined',
         v_name || coalesce(' from ' || v_location, '') || ' just joined and can post and apply now.',
         'admin_alert',
         '/admin?view=people&user=' || p_user_id::text
    FROM (SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role = 'admin') ur;
  GET DIAGNOSTICS v_sent = ROW_COUNT;
  IF v_sent = 0 THEN
    -- Nobody to tell: leave the claim unmade so a later call can still send.
    DELETE FROM public.new_member_admin_notices WHERE user_id = p_user_id;
    RETURN 'no_admins';
  END IF;
  RETURN 'sent';
END;
$function$;


REVOKE ALL ON FUNCTION public.notify_admins_new_member(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins_new_member(uuid, text) TO service_role;
