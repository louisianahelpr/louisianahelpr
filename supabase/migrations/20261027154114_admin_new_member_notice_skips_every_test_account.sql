-- Admin "New member joined" notices skip every test account (owner 2026-10-27).
-- Restated from prod's live body (pg_get_functiondef, 2026-10-27; newest file
-- 20261009223353_new_member_notice_on_email_confirm.sql) with one change: the
-- seed skip no longer also requires a test_accounts row. Grants are unchanged
-- (CREATE OR REPLACE keeps them).
-- seed-policy: ANY is_seed account is never announced. The 2026-10-09 reason
-- for also requiring test_accounts (a fixture-email trigger made strangers
-- is_seed) is gone: 20261025161836 removed that trigger and is_seed is not
-- self-grantable. The owner rules admin never shows test stuff, and every
-- admin list already hides is_seed accounts.
--
-- Cleanup: the notices already sent about test accounts (or about accounts
-- since deleted whose notice named a "SEED ..." fixture) are removed from the
-- admins' bells.

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
  IF v_seed THEN
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


DELETE FROM public.notifications n
 WHERE n.type = 'admin_alert'
   AND n.title = 'New member joined'
   AND n.link LIKE '/admin?view=people&user=%'
   AND (
     EXISTS (SELECT 1 FROM public.profiles p
              WHERE n.link = '/admin?view=people&user=' || p.user_id::text
                AND p.is_seed)
     OR (n.message LIKE 'SEED %'
         AND NOT EXISTS (SELECT 1 FROM public.profiles p
                          WHERE n.link = '/admin?view=people&user=' || p.user_id::text))
   );
