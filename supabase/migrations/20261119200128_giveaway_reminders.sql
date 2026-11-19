-- 25 Days of Louisiana Giveaways: reminder pushes (owner 11-19, via the lead: "we are actually just going to use the one
-- giveaway post that people will enter on for all days, they won't enter every day, but we can do reminders like it's not
-- too late to sign up for our giveaways etc"; then "they will enter once for all giveaways", never say HOW they enter).
--
-- THE CONFIG (the owner changes dates, words and the entry link here, with no app build):
--   * public.giveaway_reminders: one row per reminder. send_at (Louisiana time written out), title, message, link.
--     Change a date or the words with an UPDATE, or add a row for another reminder. The cron sends a row once per member,
--     from send_at until 6 hours after it (a run that is late still sends; a row is never sent days late).
--   * public.sponsor_settings.entry_url: where the /25days "How to enter" button goes. NULL (until the Facebook post
--     exists) = the Louisiana Helpr Facebook Page (src/content/sponsorPage.ts links.facebookPage). Read by the public
--     RPC giveaway_entry_url(). It lives in the database because the iOS app bundles its JavaScript: a URL in the code
--     could only change with an App Store build.
--
-- WHO GETS ONE (giveaway_reminder_sweep): every member (profiles row) for whom
--   * the sponsor_25days switch is on (sponsor_25days_on_for: Everyone, or Testers and the member is one); with the
--     switch off nothing is sent to anyone;
--   * the new "Giveaway reminders" switch is on (notification_preferences.giveaway_reminders, DEFAULT true: owner rule,
--     reminders all on by default; no preferences row = the default = on);
--   * not a test or seed account (profiles.is_seed, is_test_subject), not banned (banned, temp_banned, permanently_banned);
--   * not already sent that reminder: giveaway_reminder_sends (reminder_key, user_id) is the primary key, written in the
--     same statement as the notice, so a second run, an overlapping run or a replay sends nothing twice.
-- Push rides the notice: the fan_out_push_on_notification trigger pushes each row through send-push-notification,
-- which honours push_enabled, this type's pref column (notification_type_pref_map) and the member's quiet hours. The
-- notice links to /25days, so tapping the push opens that page in the app.
--
-- The type: 'giveaway_reminders' restated into notifications_type_check from the newest CREATE,
-- 20261112070000_shops_follow_alerts.sql, plus this one. Email: email_giveaway_reminders DEFAULT false, no email sender
-- exists for this kind (the settings row says "In the app only").
-- MONEY: none. AUTHZ: two new tables, RLS on, no client privilege; the sweep is service_role only; giveaway_entry_url()
-- is public (anon, authenticated) like sponsor_public_state and returns only a URL, and only while the switch is on.
-- REPLAY-SAFE: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP/ADD of the CHECK, ON CONFLICT, CREATE OR
-- REPLACE, cron.schedule by name (replaces). Proof: src/test/pglite/giveawayReminders.pglite.mjs (applied 3x).

-- 1. The switches.
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS giveaway_reminders boolean NOT NULL DEFAULT true;
ALTER TABLE public.notification_preferences ADD COLUMN IF NOT EXISTS email_giveaway_reminders boolean NOT NULL DEFAULT false;

-- 2. The type.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment',
    'job_match', 'job_updates', 'work_status', 'transit_updates',
    'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified',
    'message',
    'admin_alert',
    'declutter_listings', 'declutter_offers', 'declutter_sales', 'declutter_pickups',
    'declutter_refunds', 'declutter_price_drops', 'declutter_wanted', 'declutter_questions',
    'shops_orders', 'shops_messages', 'shops_updates',
    -- Admin bell activity (20261112061000): bell only.
    'admin_activity',
    -- New from shops you follow (20261112070000).
    'shops_following',
    -- 25 Days of Louisiana Giveaways reminders (20261119200128).
    'giveaway_reminders'
  ));

INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('giveaway_reminders', 'giveaway_reminders', '25 Days of Louisiana Giveaways reminders.')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

-- 3. The config: the schedule and the words.
CREATE TABLE IF NOT EXISTS public.giveaway_reminders (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  send_at timestamptz NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 300),
  link text NOT NULL DEFAULT '/25days' CHECK (link ~ '^/[^/]'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.giveaway_reminders IS
  '25 Days of Louisiana Giveaways reminder pushes (owner 11-19): THE config. One row per reminder; send_at in Louisiana time; sent once per member by giveaway_reminder_sweep from send_at to send_at + 6 hours.';
ALTER TABLE public.giveaway_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.giveaway_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.giveaway_reminders TO service_role;

-- The owner's dates and words (owner 11-19). Louisiana time: Nov 30 is CST (UTC-6), as is all of December.
INSERT INTO public.giveaway_reminders AS g (key, send_at, title, message, link) VALUES
  ('starts_tomorrow', '2026-11-30 18:00:00 America/Chicago', 'Louisiana Helpr',
   '🎄 25 Days of Louisiana Giveaways starts tomorrow! Enter once for a chance at all 25 days. Tap to see how.', '/25days'),
  ('its_here',        '2026-12-01 09:00:00 America/Chicago', 'Louisiana Helpr',
   'It''s here! Enter once and you''re in for all 25 days of Louisiana giveaways 🎁', '/25days'),
  ('not_too_late_dec5',  '2026-12-05 18:00:00 America/Chicago', 'Louisiana Helpr',
   'It''s not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.', '/25days'),
  ('not_too_late_dec10', '2026-12-10 18:00:00 America/Chicago', 'Louisiana Helpr',
   'It''s not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.', '/25days'),
  ('not_too_late_dec15', '2026-12-15 18:00:00 America/Chicago', 'Louisiana Helpr',
   'It''s not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.', '/25days'),
  ('not_too_late_dec19', '2026-12-19 18:00:00 America/Chicago', 'Louisiana Helpr',
   'It''s not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.', '/25days'),
  ('last_chance',     '2026-12-23 18:00:00 America/Chicago', 'Louisiana Helpr',
   'Last chance! Only a few days of giveaways left 🎄', '/25days')
-- A replay never overwrites a row the owner has since edited.
ON CONFLICT (key) DO NOTHING;

-- 4. Once per member per reminder.
CREATE TABLE IF NOT EXISTS public.giveaway_reminder_sends (
  reminder_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reminder_key, user_id)
);
ALTER TABLE public.giveaway_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.giveaway_reminder_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.giveaway_reminder_sends TO service_role;

-- 5. The entry link the /25days button opens (NULL = the Facebook Page).
ALTER TABLE public.sponsor_settings ADD COLUMN IF NOT EXISTS entry_url text;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sponsor_settings_entry_url_https') THEN
    ALTER TABLE public.sponsor_settings ADD CONSTRAINT sponsor_settings_entry_url_https
      CHECK (entry_url IS NULL OR entry_url ~ '^https://[^\s]+$');
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.giveaway_entry_url()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE WHEN public.sponsor_25days_on_for((SELECT auth.uid()))
              THEN (SELECT s.entry_url FROM public.sponsor_settings s WHERE s.id)
         END
$fn$;
REVOKE ALL ON FUNCTION public.giveaway_entry_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_entry_url() TO anon, authenticated, service_role;

-- 6. The sender.
CREATE OR REPLACE FUNCTION public.giveaway_reminder_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  r record;
  v_n integer;
  v_sent jsonb := '{}'::jsonb;
  v_total integer := 0;
  v_everyone boolean;
BEGIN
  -- The switch, all audiences: Off sends nothing to anyone (the per-member check below handles Testers).
  IF NOT EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'sponsor_25days' AND s.audience IS DISTINCT FROM 'off') THEN
    RETURN jsonb_build_object('sent', 0, 'skipped', 'switch_off');
  END IF;
  -- Read once: with Everyone no member needs the per-member check (Testers asks sponsor_25days_on_for per member).
  v_everyone := EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'sponsor_25days' AND s.audience = 'everyone');
  FOR r IN
    SELECT g.key, g.title, g.message, g.link
      FROM public.giveaway_reminders g
     WHERE g.send_at <= now() AND g.send_at > now() - interval '6 hours'
     ORDER BY g.send_at
  LOOP
    WITH claimed AS (
      INSERT INTO public.giveaway_reminder_sends (reminder_key, user_id)
      SELECT r.key, p.user_id
        FROM public.profiles p
        JOIN auth.users u ON u.id = p.user_id
        LEFT JOIN public.notification_preferences np ON np.user_id = p.user_id
       WHERE np.giveaway_reminders IS NOT FALSE
         AND p.is_seed IS NOT TRUE
         AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))
         AND NOT public.is_test_subject(p.user_id)
         AND (v_everyone OR public.sponsor_25days_on_for(p.user_id))
      ON CONFLICT (reminder_key, user_id) DO NOTHING
      RETURNING user_id
    )
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT c.user_id, r.title, r.message, 'giveaway_reminders', r.link FROM claimed c;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_sent := v_sent || jsonb_build_object(r.key, v_n);
    v_total := v_total + v_n;
  END LOOP;
  RETURN jsonb_build_object('sent', v_total, 'by_reminder', v_sent);
END;
$fn$;
REVOKE ALL ON FUNCTION public.giveaway_reminder_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_reminder_sweep() TO service_role;

-- 7. Every 15 minutes, off the top of the hour (a reminder goes out within 15 minutes of its time). Year-round so the
--    liveness watcher never sees a gap; outside a reminder's 6-hour window a run reads one small table and stops.
DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('giveaway-reminders', interval '1 hour',
            '25 Days of Louisiana Giveaways: every 15 minutes, sends each due reminder in public.giveaway_reminders once per member.',
            'exempt',
            'Outside the seven reminder windows (Nov 30 to Dec 23) and with the sponsor_25days switch off, a run that sends nothing is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('giveaway-reminders', '1,16,31,46 * * * *',
      $c$SELECT public.cron_record_work('giveaway-reminders', to_jsonb(public.giveaway_reminder_sweep()));$c$);
  END IF;
END
$do$;
