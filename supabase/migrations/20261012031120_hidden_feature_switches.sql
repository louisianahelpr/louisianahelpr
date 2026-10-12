-- Hidden feature switches (owner decision, 2026-10-11): a new feature ships to
-- the real app behind a switch that is on only for the owner and the test
-- accounts, then is flipped on for everyone. Not a staging copy.
--
-- public.platform_settings.feature_flags is app-wide only (one boolean per key
-- for every caller). This adds a per-AUDIENCE switch:
--
--   public.feature_switches      the registry: one row per switch, audience
--                                'off' | 'testers' | 'everyone'. No client role
--                                has any privilege on it; it is read and written
--                                only through the functions below.
--   feature_enabled_for(key)     THE decision, for the signed-in caller
--                                (auth.uid()). Fails closed: a missing key, an
--                                unknown audience, a signed-out caller -> false.
--   feature_enabled_for_user()   the same decision for a named user; service_role
--                                only (an edge function asks for its verified
--                                caller). Never granted to a client: it would
--                                tell anyone who is a tester.
--   require_feature(key)         the server-side enforcement: an RPC behind a
--                                hidden feature calls PERFORM
--                                public.require_feature('<key>') first, and a
--                                caller the switch is off for gets
--                                'feature_disabled' (42501).
--   admin_list_feature_switches()  admin-only read for the Settings card.
--   admin_set_feature_switch()   admin-only audience change; writes its own
--                                admin_audit_log row in the same transaction
--                                (Q76), only when the audience actually changed.
--
-- TESTERS = users holding the 'admin' app_role (user_roles: only an admin can
-- insert a row, nobody can update one) + public.test_accounts (no client
-- privilege at all; service-role-only allowlist, Q552). Both are read here
-- under SECURITY DEFINER; nothing the caller supplies widens the audience.
--
-- A switch is CREATED by a migration and never on: the BEFORE INSERT trigger
-- refuses audience 'everyone' (the static guard
-- src/test/featureSwitchRegistry.test.ts refuses it in the migration text too).
-- Going live is an admin flipping it in Admin -> Settings, which is audited.
--
-- One switch is created here: 'switch_canary', audience 'testers'. It gates no
-- product feature. The Settings card reads it with useFeature() to show the
-- viewer that hidden switches reach them, and the nightly
-- feature-switch-audience check uses it as the positive control (a tester sees
-- it ON) beside the real assertion (an ordinary account sees every
-- not-'everyone' switch OFF).
--
-- Replay-safe: IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING (a replay
-- never resets an audience an admin chose); grants restated by role name.

CREATE TABLE IF NOT EXISTS public.feature_switches (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  audience text NOT NULL DEFAULT 'off' CHECK (audience IN ('off', 'testers', 'everyone')),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.feature_switches ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: with RLS on and no policy, even a granted role reads
-- nothing; and no client role is granted anything.
REVOKE ALL ON TABLE public.feature_switches FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feature_switches TO service_role;

COMMENT ON TABLE public.feature_switches IS
  'Hidden feature switches: audience off | testers (admins + test_accounts) | everyone. '
  'Read only through feature_enabled_for(); changed only through admin_set_feature_switch() '
  '(audited). Created by migration, never as everyone.';

-- A switch is never BORN on for everyone, whoever inserts it.
CREATE OR REPLACE FUNCTION public.feature_switches_never_created_on()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.audience = 'everyone' THEN
    RAISE EXCEPTION 'switch_created_on'
      USING ERRCODE = '23514',
            DETAIL = format('feature switch %s must be created as off or testers; flip it to everyone in Admin -> Settings', NEW.key);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.feature_switches_never_created_on() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS feature_switches_never_created_on ON public.feature_switches;
CREATE TRIGGER feature_switches_never_created_on
  BEFORE INSERT ON public.feature_switches
  FOR EACH ROW EXECUTE FUNCTION public.feature_switches_never_created_on();

-- The decision for a named user. service_role only.
CREATE OR REPLACE FUNCTION public.feature_enabled_for_user(p_key text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT CASE s.audience
             WHEN 'everyone' THEN true
             WHEN 'testers' THEN
               COALESCE(public.has_role(p_user_id, 'admin'::app_role), false)
               OR EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p_user_id)
             ELSE false
           END
      FROM public.feature_switches s
     WHERE s.key = p_key
       AND p_user_id IS NOT NULL
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.feature_enabled_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_enabled_for_user(text, uuid) TO service_role;

COMMENT ON FUNCTION public.feature_enabled_for_user(text, uuid) IS
  'Hidden feature switch decision for a named user (service_role only: edge functions pass '
  'their verified caller). Missing key, unknown audience or null user -> false.';

-- The decision for the signed-in caller. Signed out -> false.
CREATE OR REPLACE FUNCTION public.feature_enabled_for(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.feature_enabled_for_user(p_key, (SELECT auth.uid()));
$function$;

REVOKE ALL ON FUNCTION public.feature_enabled_for(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.feature_enabled_for(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.feature_enabled_for(text) IS
  'Is hidden feature <key> on for the calling user? off -> false; testers -> admins and '
  'test_accounts; everyone -> any signed-in user. Missing key, unknown audience or no '
  'auth.uid() -> false (fail closed). Client hook: useFeature().';

-- Server-side enforcement for RPCs behind a hidden feature:
--   PERFORM public.require_feature('<key>');
CREATE OR REPLACE FUNCTION public.require_feature(p_key text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.feature_enabled_for(p_key) THEN
    RAISE EXCEPTION 'feature_disabled'
      USING ERRCODE = '42501',
            DETAIL = format('feature %s is not available to this account', p_key);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_feature(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.require_feature(text) IS
  'Raises feature_disabled (42501) unless feature_enabled_for(p_key). First statement of '
  'every RPC behind a hidden feature; the client hook alone is never enough.';

-- Admin read for the Settings card.
CREATE OR REPLACE FUNCTION public.admin_list_feature_switches()
RETURNS TABLE(key text, audience text, description text, created_at timestamptz, updated_at timestamptz, updated_by uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE(public.has_role((SELECT auth.uid()), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.key, s.audience, s.description, s.created_at, s.updated_at, s.updated_by
      FROM public.feature_switches s
     ORDER BY s.key;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_feature_switches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_feature_switches() TO authenticated, service_role;

-- Admin audience change. Writes one admin_audit_log row when the audience
-- changed; returns the audience now stored. Cannot create a switch.
CREATE OR REPLACE FUNCTION public.admin_set_feature_switch(p_key text, p_audience text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_from text;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.has_role(v_uid, 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_audience IS NULL OR p_audience NOT IN ('off', 'testers', 'everyone') THEN
    RAISE EXCEPTION 'invalid_audience' USING ERRCODE = '22023';
  END IF;

  SELECT s.audience INTO v_from
    FROM public.feature_switches s
   WHERE s.key = p_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_switch' USING ERRCODE = 'P0002';
  END IF;

  IF v_from = p_audience THEN
    RETURN v_from;
  END IF;

  UPDATE public.feature_switches
     SET audience = p_audience, updated_at = now(), updated_by = v_uid
   WHERE key = p_key;

  INSERT INTO public.admin_audit_log (admin_id, action, target_type, target_id, details)
  VALUES (v_uid, 'set_feature_switch', 'feature_switch', p_key,
          jsonb_build_object('from', v_from, 'to', p_audience));

  RETURN p_audience;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_feature_switch(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_switch(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_feature_switch(text, text) IS
  'Admin-only: set a hidden feature switch''s audience (off | testers | everyone). Writes '
  'admin_audit_log (set_feature_switch, {from,to}) in the same transaction when it changes.';

-- The canary (gates no product feature; see the header).
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('switch_canary', 'testers',
        'Gates no feature. Proves hidden switches reach testers (Admin -> Settings shows it) '
        'and is the nightly feature-switch-audience check''s positive control.')
ON CONFLICT (key) DO NOTHING;
