-- WEB PUSH (push lane root cause 2026-10-21, ~/.lh-wt/handoff-push.md): nobody on the website can get a
-- push notification. push_tokens holds only native (APNs) device tokens; 36 of 37 real active members
-- use the website, and web push was never built (no PushManager.subscribe, no VAPID key, no store, no
-- sender). This adds the store; the client subscribes after a tap (src/lib/webPush.ts), /sw-push.js shows
-- the push, and send-push-notification sends to these rows beside the native tokens.
--
-- Hidden switch 'web_push' (testers first, AGENT-BRIEF "How to ship a hidden feature"): the register RPC
-- starts with require_feature('web_push'), and the sender sends to a member's web subscriptions only while
-- feature_enabled_for_user('web_push', member) is true.
--
-- One row per browser subscription (its endpoint is the push service URL the browser handed us, unique).
-- A browser re-subscribing, or another member signing in on the same browser, takes the row over: the
-- endpoint names the DEVICE, and the newest signed-in member on it is the one who should be told. Sign-out
-- deletes this browser's row (src/lib/nativePush.ts unregisterPushOnSignOut). The sender deletes a row the
-- push service answers 404/410 for (gone), and logs it (notification_logs token_deleted).
--
-- Members never write the table directly: web_push_register() (SECURITY DEFINER) is the only insert path,
-- so the takeover rule and the switch live in one place; a member may read and delete only their own rows.
-- Replay-safe (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS / ON CONFLICT). REVOKE by role name.

CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://[^[:space:]]+$' AND char_length(endpoint) <= 2048),
  -- The browser's public key and auth secret (PushSubscription.toJSON().keys), base64url.
  p256dh text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]+=*$' AND char_length(p256dh) BETWEEN 40 AND 200),
  auth text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]+=*$' AND char_length(auth) BETWEEN 8 AND 64),
  user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx ON public.web_push_subscriptions (user_id);
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.web_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.web_push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.web_push_subscriptions TO service_role;
DROP POLICY IF EXISTS "web push: member reads own" ON public.web_push_subscriptions;
CREATE POLICY "web push: member reads own" ON public.web_push_subscriptions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS "web push: member deletes own" ON public.web_push_subscriptions;
CREATE POLICY "web push: member deletes own" ON public.web_push_subscriptions
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
-- Q807: an account whose email is unconfirmed cannot write the table.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The only insert path. Returns the row id.
CREATE OR REPLACE FUNCTION public.web_push_register(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_id uuid;
BEGIN
  PERFORM public.require_feature('web_push');
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501';
  END IF;
  IF p_endpoint IS NULL OR p_p256dh IS NULL OR p_auth IS NULL THEN
    RAISE EXCEPTION 'invalid_subscription' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  ON CONFLICT (endpoint) DO UPDATE
     SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent, last_seen_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'invalid_subscription' USING ERRCODE = '22023';
END;
$fn$;
REVOKE ALL ON FUNCTION public.web_push_register(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.web_push_register(text, text, text, text) TO authenticated, service_role;

-- The switch, never on for everyone from a migration.
INSERT INTO public.feature_switches (key, audience, description)
VALUES ('web_push', 'testers', 'Web push notifications on the website (browser alerts when the tab is closed). Testers first.')
ON CONFLICT (key) DO NOTHING;
