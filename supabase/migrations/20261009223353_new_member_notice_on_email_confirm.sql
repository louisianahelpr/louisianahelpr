-- "New member joined" is sent when the member CONFIRMS their email, not at
-- signup (owner decision, 2026-10-09 pop-up).
--
-- WHAT WAS WRONG. complete-signup inserted the admin notice the moment the
-- signup form finished: "Kaci Lombas from Delcambre just joined. They can
-- start posting + applying as soon as they confirm their email." Measured on
-- prod 2026-10-09: Kaci's notice 02:45:58.8Z, her signup 02:45:54.9Z, her
-- confirmation 02:46:52.4Z. Every real signup that day shows the same order
-- (complete-signup's legal_acceptances row, the notice, then the confirm
-- 40-80 s later). A signup abandoned before confirming still notified.
--
-- WHAT IT DOES NOW. One notice per member, when auth.users.email_confirmed_at
-- goes from NULL to set, worded "Kaci Lombas from Delcambre just joined and
-- can post and apply now." (the full name as stored: the convention every
-- other admin notice uses, e.g. detect_stuck_payments' "by Ben Lombas" and the
-- violation trigger's "Repeat offender: <name>", both
-- COALESCE(NULLIF(full_name, ''), …)). Never for an account that never
-- confirms.
--
--   * notify_admins_new_member(user) is the ONE writer. It sends only when the
--     account is confirmed, the profile has a name (a provider takeover wipes
--     the pre-verification profile at this same confirm, see
--     zz_wipe_on_provider_takeover; the real owner then names themselves
--     through complete-signup, which calls this again), the member is not a
--     test account (is_seed AND a test_accounts row), and no notice was ever
--     sent for them (by this function, or by the signup-time code it replaces).
--   * EXACTLY ONCE: new_member_admin_notices (user_id PRIMARY KEY) is claimed
--     with INSERT … ON CONFLICT DO NOTHING in the same transaction as the
--     notification rows, so a second confirm, a re-sent link, a repeated
--     complete-signup call or two racing callers cannot send twice; a failed
--     insert rolls the claim back with it.
--   * Hook: AFTER UPDATE OF email_confirmed_at ON auth.users, NULL -> set
--     (trigger zzz_notify_admins_new_member, so it runs after
--     sync_email_verified_trigger and zz_wipe_on_provider_takeover; triggers
--     on auth.users are already used here for exactly this transition).
--     It can never break the confirmation: every error is caught, written to
--     error_logs and the Postgres log, and the UPDATE proceeds.
--   * complete-signup calls the same function (service role) instead of
--     inserting: it sends only when the account is ALREADY confirmed by then
--     (a provider sign-in confirms at creation; the takeover case above).
--
-- UNCHANGED downstream: the rows are the same shape as before (title "New
-- member joined", type admin_alert, link /admin?view=people&user=<id>, one per
-- admin), so the push fan-out trigger, adminPushSeverity('New member joined')
-- = 'info', the ops ledger's 'notice' close rule (admin_alert_close_rule) and
-- trg_notifications_zz_admin_alert_subject all see what they saw before.
--
-- DEPLOY ORDER (functions and migrations ship separately): a member who
-- signed up and confirmed while the new complete-signup ran ahead of this
-- migration is announced by section 4 below; a notice the OLD complete-signup
-- writes after this lands is honoured as already sent (no second notice).
-- BACKFILL: every existing account that already has a "New member joined"
-- notice, or is confirmed AND named, is marked as notified, so a member who
-- signed up under the old code and confirms after this deploys is not
-- announced twice.
--
-- Guard: src/test/newMemberNoticeOnConfirm.test.ts (static, registered
-- mutations) and src/test/edge/complete-signup-new-member-notice.test.ts.
-- Behaviour proven in PGlite: src/test/pglite/newMemberNoticeOnConfirm.pglite.mjs
-- (applied 3x).
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS; CREATE OR REPLACE; DROP TRIGGER IF
-- EXISTS; the backfill is ON CONFLICT DO NOTHING. Grants: FROM PUBLIC, anon,
-- authenticated; service_role only.

-- ── 1. Who has been announced (server-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.new_member_admin_notices (
  -- A deleted account takes its row with it.
  user_id     uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  notified_at timestamptz NOT NULL DEFAULT now(),
  -- 'confirm' (the auth trigger), 'complete-signup', or 'backfill'
  via         text NOT NULL
);
ALTER TABLE public.new_member_admin_notices ENABLE ROW LEVEL SECURITY;
-- Q807: every new public table carries the unconfirmed-email gate (server-only
-- here; GoTrue's confirm runs with no user session, so the trigger still writes).
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
REVOKE ALL ON TABLE public.new_member_admin_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.new_member_admin_notices TO service_role;

-- ── 2. The one writer ───────────────────────────────────────────────────────
-- Returns what it did: 'sent' | 'not_confirmed' | 'no_profile' | 'no_name' |
-- 'seed' | 'wipe_failed' | 'already_sent' | 'no_admins'.
-- seed-policy: a TEST account (is_seed AND a public.test_accounts row, the
-- definition 20261007033530 settled on) is never announced. is_seed alone is
-- not enough: trg_profiles_seed_from_fixture_email sets it for anyone who signs
-- up with a public fixture inbox (@mailinator.com), and those are exactly the
-- signups an admin wants to see.
-- lock_timeout: this runs inside GoTrue's confirmation UPDATE; a wait on a
-- racing claim must fail fast (and be caught by the trigger), never hold the
-- member's verify link until a statement timeout.
CREATE OR REPLACE FUNCTION public.notify_admins_new_member(p_user_id uuid, p_via text DEFAULT 'confirm')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET lock_timeout TO '3s'
AS $fn$
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
  IF v_seed AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id) THEN
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
$fn$;
REVOKE ALL ON FUNCTION public.notify_admins_new_member(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins_new_member(uuid, text) TO service_role;

-- ── 3. The hook: the confirmation itself ────────────────────────────────────
-- seed-policy: delegates to notify_admins_new_member, which skips seed members.
CREATE OR REPLACE FUNCTION public.notify_admins_on_email_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.notify_admins_new_member(NEW.id, 'confirm');
  EXCEPTION WHEN OTHERS OR query_canceled THEN
    -- Never break the member's confirmation (WHEN OTHERS does not include a
    -- cancel/timeout, hence query_canceled too). Nothing retries a confirm,
    -- so this pages: an operator re-sends with
    -- SELECT public.notify_admins_new_member('<user id>', 'manual');
    RAISE WARNING 'notify_admins_on_email_confirm: % (user %)', SQLERRM, NEW.id;
    BEGIN
      INSERT INTO public.error_logs (severity, message, url, tags, context)
      VALUES ('error', 'New member notice failed at email confirmation (re-send: notify_admins_new_member)',
              format('/admin?view=people&user=%s', NEW.id),
              jsonb_build_object('source', 'new-member-notice', 'user_id', NEW.id::text),
              jsonb_build_object('user_id', NEW.id, 'error', SQLERRM));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_admins_on_email_confirm: could not log the failure: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notify_admins_on_email_confirm() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzz_notify_admins_new_member ON auth.users;
CREATE TRIGGER zzz_notify_admins_new_member
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.notify_admins_on_email_confirm();

-- ── 4. Deploy gap: a member who finished the signup form (legal_acceptances,
--       written only by complete-signup) and confirmed in the last two days
--       with NO notice was missed while the new complete-signup ran ahead of
--       this migration. Announce them now (measured 2026-10-09: every real
--       signup of the day has its notice, so this normally sends nothing).
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT u.id
      FROM auth.users u
     WHERE u.email_confirmed_at IS NOT NULL
       AND u.created_at > now() - interval '2 days'
       AND EXISTS (SELECT 1 FROM public.legal_acceptances l WHERE l.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM public.new_member_admin_notices m WHERE m.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM public.notifications x
                        WHERE x.title = 'New member joined'
                          AND x.link = '/admin?view=people&user=' || u.id::text)
  LOOP
    PERFORM public.notify_admins_new_member(r.id, 'deploy-gap');
  END LOOP;
END
$do$;

-- ── 5. Backfill: nobody already announced (or already confirmed and named
--       before this) is announced again. A confirmed account with no name yet
--       (a provider takeover wiped it) is NOT marked: complete-signup
--       announces it once the real owner names themselves.
INSERT INTO public.new_member_admin_notices (user_id, notified_at, via)
SELECT u.id, coalesce(n.first_notice, u.email_confirmed_at, now()), 'backfill'
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT min(x.created_at) AS first_notice
      FROM public.notifications x
     WHERE x.title = 'New member joined'
       AND x.link = '/admin?view=people&user=' || u.id::text
  ) n ON true
 WHERE n.first_notice IS NOT NULL
    OR (u.email_confirmed_at IS NOT NULL AND NULLIF(btrim(p.full_name), '') IS NOT NULL)
ON CONFLICT (user_id) DO NOTHING;
