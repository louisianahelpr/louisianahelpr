-- Q1313 (owner, 2026-10-05): "Notify Me When Work Lands" must SAVE the
-- person's contact so a launch-day message can reach them. Before this the
-- guest button on /browse only opened /signup and kept nothing.
--
-- What is stored: one row per email address (case- and space-insensitive),
-- the consent wording version the person agreed to, where they tapped, and,
-- for a signed-in tap, their account (ON DELETE CASCADE: deleting the account
-- deletes the row). Nothing is SENT from here: no trigger, no cron, no queue.
-- The first message is drafted in docs/OPEN.md Q1313 and goes out only with
-- the owner's OK.
--
-- Who can do what:
--   * anon + authenticated: join_launch_notify() and leave_launch_notify()
--     only. No table privileges at all: a visitor can add their email but can
--     never read the list, see whether an address is on it, or change a row.
--   * admins (has_role admin): SELECT and DELETE through RLS, to read the list
--     for the launch message and to remove test or junk rows.
--   * service_role: everything (the eventual sender).
--
-- Abuse: one row per email (a repeat is a silent no-op that answers exactly
-- like a first join, so the RPC is not a membership oracle); a global cap of
-- 30 new rows a minute (a flood is bounded, at the cost of a real visitor
-- seeing "try again in a minute" during one); addresses are length- and
-- shape-checked. A bot check is Q1314 (Turnstile).
--
-- Replay-safe: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.launch_notify_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'browse_empty',
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
  unsubscribed_at timestamptz,
  notified_at timestamptz,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT launch_notify_signups_email_len CHECK (char_length(btrim(email)) BETWEEN 3 AND 254),
  CONSTRAINT launch_notify_signups_source_check CHECK (source IN ('browse_empty', 'home_empty'))
);

CREATE UNIQUE INDEX IF NOT EXISTS launch_notify_signups_email_key
  ON public.launch_notify_signups (email_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS launch_notify_signups_unsubscribe_token_key
  ON public.launch_notify_signups (unsubscribe_token);
CREATE INDEX IF NOT EXISTS idx_launch_notify_signups_created_at
  ON public.launch_notify_signups (created_at);
CREATE INDEX IF NOT EXISTS idx_launch_notify_signups_user_id
  ON public.launch_notify_signups (user_id);

ALTER TABLE public.launch_notify_signups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.launch_notify_signups FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.launch_notify_signups TO authenticated;
GRANT ALL ON TABLE public.launch_notify_signups TO service_role;

DROP POLICY IF EXISTS "Admins read launch notify signups" ON public.launch_notify_signups;
CREATE POLICY "Admins read launch notify signups"
  ON public.launch_notify_signups FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins delete launch notify signups" ON public.launch_notify_signups;
CREATE POLICY "Admins delete launch notify signups"
  ON public.launch_notify_signups FOR DELETE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- Join. A signed-in caller with no email given is signed up with their
-- account's own address. Answers {ok: true} whether the address was new or
-- already listed. Raises P0001 with a sentence the screen can show.
CREATE OR REPLACE FUNCTION public.join_launch_notify(p_email text, p_source text DEFAULT 'browse_empty')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_email text := NULLIF(btrim(coalesce(p_email, '')), '');
  v_source text := CASE WHEN p_source IN ('browse_empty', 'home_empty') THEN p_source ELSE 'browse_empty' END;
  v_recent int;
  v_seed boolean := false;
  v_account_email text;
  v_owner uuid;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT u.email INTO v_account_email FROM auth.users u WHERE u.id = v_uid;
  END IF;
  v_email := coalesce(v_email, v_account_email);
  -- The row is tied to the caller's account only when it is the account's own
  -- address: a signed-in visitor typing someone else's email adds a guest row.
  IF v_account_email IS NOT NULL AND lower(btrim(v_account_email)) = lower(v_email) THEN
    v_owner := v_uid;
  END IF;
  IF v_email IS NULL
     OR char_length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address.' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_recent FROM (
    SELECT 1 FROM public.launch_notify_signups s
     WHERE s.created_at > now() - interval '1 minute'
     LIMIT 30) x;
  IF v_recent >= 30 THEN
    RAISE EXCEPTION 'Lots of people are signing up right now. Please try again in a minute.' USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.is_seed_email(text)') IS NOT NULL THEN
    v_seed := coalesce(public.is_seed_email(v_email), false);
  END IF;

  INSERT INTO public.launch_notify_signups (email, user_id, source, consent_version, is_seed)
  VALUES (v_email, v_owner, v_source, 'launch-notify-v1', v_seed)
  ON CONFLICT (email_normalized) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- Leave, by the token a future message carries in its unsubscribe link. An
-- unknown or already-used token answers the same {ok: true}.
CREATE OR REPLACE FUNCTION public.leave_launch_notify(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  UPDATE public.launch_notify_signups
     SET unsubscribed_at = now()
   WHERE unsubscribe_token = p_token
     AND unsubscribed_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.join_launch_notify(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_launch_notify(text, text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.leave_launch_notify(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_launch_notify(uuid) TO anon, authenticated, service_role;
