-- Job reminders: always-on and switchable, one Settings section (owner
-- 2026-10-29 via the lead: "they need to kind of get alot to always be
-- reminded... or give em the option to choose which one they get").
--
-- Measured on prod 2026-10-30 (read-only, live definitions): Settings could only
-- turn reminders off per CATEGORY. Turning "Job updates" off silenced the push of
-- "Still on for tomorrow?" and "Confirm you'll be there" (the reminders a job
-- cannot work without) together with "Starting soon"; nothing could be turned off
-- one at a time.
--
-- Now:
--   1. public.job_reminder_types: the registry. One row per reminder: what the
--      member sees (label, description), whether it is always on, and for a
--      switchable one its notification_preferences column. A reminder is
--      recognised by its notification type and title (and, where two share a
--      title, a message pattern), the way sms_kind_for already does. Adding a
--      reminder = one row here (+ a column if switchable) and its producer.
--      Settings > Notifications > Job reminders renders from this table.
--   2. notification_preferences.remind_starting_soon / remind_finish_job /
--      remind_payout_followups, NOT NULL DEFAULT true: every reminder is ON.
--   3. job_reminder_kind(type, title, message): which reminder a notification is.
--   4. BEFORE INSERT trigger trg_notifications_reminder_choice: a switchable
--      reminder the member turned off is not written (no in-app row, so no push
--      and no text either; the seed boundary drops rows the same way).
--      job_reminder_switched_off() lets an edge sender tell that drop from a
--      fault, as seedBoundaryDropsRow does for the seed boundary.
--   5. fan_out_push_on_notification restated from its live definition
--      (md5 of prosrc b31aa842..., equal to 20260903012715): an always-on
--      reminder skips the category gate, a switchable one follows its own
--      switch. push_enabled (all push off) is still honoured.
--   6. claim_payout_setup_reminders restated from its live definition (prosrc
--      md5 c8c7fdbd..., equal to 20261027154326): day1/day3/day7 are skipped
--      for a member who turned payout follow-ups off; 'hired' and 'money' are
--      unchanged. Already-claimed rows are left alone.
--
-- Replay-safe: IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO UPDATE,
-- DROP ... IF EXISTS. Proof: src/test/pglite/jobReminderChoices.pglite.mjs.

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS remind_starting_soon boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_finish_job boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_payout_followups boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.job_reminder_types (
  kind text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  always_on boolean NOT NULL,
  pref_column text,
  match_type text NOT NULL,
  match_title text NOT NULL,
  match_message_like text,
  sort_order integer NOT NULL DEFAULT 100,
  CONSTRAINT job_reminder_types_switch_shape CHECK (always_on = (pref_column IS NULL)),
  CONSTRAINT job_reminder_types_pref_column_shape CHECK (pref_column IS NULL OR pref_column ~ '^remind_[a-z_]+$')
);
CREATE UNIQUE INDEX IF NOT EXISTS job_reminder_types_match_key
  ON public.job_reminder_types (match_type, match_title, coalesce(match_message_like, ''));

COMMENT ON TABLE public.job_reminder_types IS
  'Job reminders (owner 2026-10-29): one row per reminder, always on or switchable (pref_column on notification_preferences, default on). Recognised by notification type + title (+ message pattern). Read by Settings > Notifications > Job reminders, the push fan-out and the insert gate.';

ALTER TABLE public.job_reminder_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.job_reminder_types FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.job_reminder_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.job_reminder_types TO service_role;
DROP POLICY IF EXISTS job_reminder_types_read ON public.job_reminder_types;
CREATE POLICY job_reminder_types_read ON public.job_reminder_types FOR SELECT TO authenticated USING (true);

INSERT INTO public.job_reminder_types AS t (kind, label, description, always_on, pref_column, match_type, match_title, match_message_like, sort_order) VALUES
  ('dayof_confirm',    'Still on for tomorrow?',        'The day before, so you can confirm you''ll be there.',                     true,  NULL,                      'job_update',       'Still on for tomorrow?',                     NULL,                        10),
  ('confirm_be_there', 'Confirm you''ll be there',      'Until you confirm. An unconfirmed job is reposted 2 hours before.',        true,  NULL,                      'job_update',       'Confirm you''ll be there',                   NULL,                        20),
  ('job_reposted',     'Job reposted',                  'When a job you didn''t confirm goes to other Helprs.',                   true,  NULL,                      'warning',          'Job reposted',                               NULL,                        30),
  ('job_cancelled',    'Job cancelled, don''t go',       'When the person who posted a job you''re booked on cancels it.',          true,  NULL,                      'warning',          'Job cancelled',                              '%Don''t go.',               40),
  ('support_step_in',  'Support is stepping in',        'When your arrival was never confirmed and our team is reviewing it.',     true,  NULL,                      'job_updates',      'We''ve asked support to step in',            NULL,                        50),
  ('payout_hired',     'You''re hired: set up payouts',  'Right after you''re hired, if your payout account isn''t ready.',         true,  NULL,                      'financial_alerts', 'You''re hired. Set up payouts to get paid.', NULL,                        60),
  ('payout_money',     'Your pay is waiting',           'When pay for a job is held until your payout account is ready.',          true,  NULL,                      'financial_alerts', 'Finish payout setup to get paid',            'Your pay from %',           70),
  ('starting_soon',    'Starting soon',                 'About 30 minutes before a job starts.',                                   false, 'remind_starting_soon',    'job_update',       'Starting soon',                              NULL,                        110),
  ('finish_job',       'Did you finish this job?',      'When a job is past its end time and not marked done yet.',                false, 'remind_finish_job',       'job_updates',      'Did you finish this job?',                   NULL,                        120),
  ('payout_followups', 'Payout setup follow-ups',       'A day, 3 days and a week after you''re hired, until payouts are set up.', false, 'remind_payout_followups', 'financial_alerts', 'Finish payout setup to get paid',            'You have a job on Helpr.%', 130)
ON CONFLICT (kind) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, always_on = EXCLUDED.always_on,
  pref_column = EXCLUDED.pref_column, match_type = EXCLUDED.match_type, match_title = EXCLUDED.match_title,
  match_message_like = EXCLUDED.match_message_like, sort_order = EXCLUDED.sort_order;

-- Which reminder a notification is (no row = not a job reminder). A row with a
-- message pattern wins over one without for the same type and title.
CREATE OR REPLACE FUNCTION public.job_reminder_kind(p_type text, p_title text, p_message text)
RETURNS TABLE (kind text, always_on boolean, pref_column text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT r.kind, r.always_on, r.pref_column
    FROM public.job_reminder_types r
   WHERE r.match_type = p_type
     AND r.match_title = p_title
     AND (r.match_message_like IS NULL OR coalesce(p_message, '') LIKE r.match_message_like)
   ORDER BY (r.match_message_like IS NULL), r.kind
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION public.job_reminder_kind(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_reminder_kind(text, text, text) TO service_role;

-- True when this notification is a switchable job reminder the member turned off.
CREATE OR REPLACE FUNCTION public.job_reminder_switched_off(p_user_id uuid, p_type text, p_title text, p_message text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_col text;
  v_on boolean;
BEGIN
  SELECT k.pref_column INTO v_col FROM public.job_reminder_kind(p_type, p_title, p_message) k WHERE k.always_on IS FALSE;
  IF v_col IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;
  EXECUTE format('SELECT %I FROM public.notification_preferences WHERE user_id = $1', v_col) INTO v_on USING p_user_id;
  -- No preferences row = the defaults = on.
  RETURN v_on IS FALSE;
END;
$fn$;
REVOKE ALL ON FUNCTION public.job_reminder_switched_off(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_reminder_switched_off(uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.notifications_reminder_choice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF public.job_reminder_switched_off(NEW.user_id, NEW.type, NEW.title, NEW.message) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.notifications_reminder_choice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_reminder_choice ON public.notifications;
CREATE TRIGGER trg_notifications_reminder_choice
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_reminder_choice();

CREATE OR REPLACE FUNCTION public.fan_out_push_on_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  prefs public.notification_preferences;
  pref_col text;
  pref_value boolean;
  supabase_url text;
  service_role_key text;
  v_rem_kind text;
  v_rem_always boolean;
  v_rem_col text;
BEGIN
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;

  -- Self-heal. The old code skipped the WHOLE gate when the row was absent,
  -- so `push_enabled = false` went unhonoured for the 85% of accounts that had
  -- none. Materialising the defaults keeps the DB column defaults as the one
  -- definition of "default" instead of restating them here. After the backfill
  -- in this migration this branch should effectively never run.
  IF prefs.user_id IS NULL THEN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  END IF;

  -- Master switch, now checked unconditionally.
  IF prefs.user_id IS NOT NULL AND prefs.push_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Job reminders (owner 2026-10-29, 20261030031059): an always-on reminder
  -- pushes even with its category off ("Always on" in Settings); a switchable
  -- one follows its own Job reminders switch, not the category.
  SELECT r.kind, r.always_on, r.pref_column INTO v_rem_kind, v_rem_always, v_rem_col
    FROM public.job_reminder_kind(NEW.type, NEW.title, NEW.message) r;

  IF v_rem_kind IS NOT NULL AND v_rem_always IS TRUE THEN
    NULL;
  ELSIF v_rem_kind IS NOT NULL AND v_rem_col IS NOT NULL THEN
    EXECUTE format('SELECT ($1).%I', v_rem_col) INTO pref_value USING prefs;
    IF pref_value IS NOT TRUE THEN
      RETURN NEW;
    END IF;
  ELSE
    SELECT pref_column INTO pref_col
      FROM public.notification_type_pref_map
      WHERE type = NEW.type;

    IF pref_col IS NULL THEN
      -- Every value permitted by notifications_type_check now has a map row, so
      -- reaching this means someone widened the CHECK without widening the map.
      -- Announce it rather than silently sending past the user's preferences —
      -- that silence is exactly how 43.9% of notifications came to ignore the
      -- gate. Still sends: failing closed here would mute admin operator alerts,
      -- which are 81% of the affected volume.
      RAISE WARNING 'fan_out_push_on_notification: notification type % has no notification_type_pref_map row — push sent WITHOUT a category check (notification %)', NEW.type, NEW.id;
    ELSE
      EXECUTE format('SELECT ($1).%I', pref_col) INTO pref_value USING prefs;
      IF pref_value IS NOT TRUE THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- STABLE helpers — Postgres caches result across rows within a single
  -- statement, so a 1000-row broadcast insert decrypts vault once, not 1000x.
  supabase_url := public.get_supabase_url();
  service_role_key := public.get_service_role_key();

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'fan_out_push_on_notification: vault secrets missing — push skipped for notification %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_role_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', NEW.message,
      'link', NEW.link,
      'thread_id', NEW.type
    )
  );

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fan_out_push_on_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fan_out_push_on_notification() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_payout_setup_reminders(p_limit integer DEFAULT 100)
 RETURNS TABLE(helper_id uuid, reminder_key text, stage text, job_id uuid, job_title text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- When payout_after_hire went to everyone (feature_switches.updated_at,
  -- measured 2026-10-27). A constant on purpose: updated_at moves on every
  -- later audience change, and a hire before go-live was never told to set up
  -- at the hire, so it is not told now.
  v_since constant timestamptz := '2026-10-25 23:40:59+00';
BEGIN
  RETURN QUERY
  WITH hires AS (
    SELECT j.helper_id AS uid, j.id AS jid, j.title AS jtitle, j.payment_status::text AS pay,
           j.accepted_at AS hired_on,
           (j.status::text NOT IN ('completed', 'cancelled', 'disputed')) AS live
      FROM public.jobs j
     WHERE j.helper_id IS NOT NULL
       AND j.status::text <> 'cancelled'
       AND j.payment_status::text IN ('escrow', 'payout_pending')
    UNION ALL
    -- A crew seat: hired when it joined; the crew job may still be 'open'
    -- while other seats fill.
    SELECT g.helper_id, j.id, j.title, j.payment_status::text,
           g.joined_at,
           (j.status::text NOT IN ('completed', 'cancelled', 'disputed'))
      FROM public.group_job_helpers g
      JOIN public.jobs j ON j.id = g.job_id
     WHERE j.status::text <> 'cancelled'
       AND j.payment_status::text IN ('escrow', 'payout_pending')
  ),
  helprs AS (
    SELECT DISTINCT h.uid
      FROM hires h
      JOIN public.profiles p ON p.user_id = h.uid
     WHERE (p.stripe_account_id IS NULL OR p.stripe_payouts_enabled IS NOT TRUE)
       AND NOT (p.is_seed IS TRUE AND p.stripe_account_id IS NULL
                AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id))
       AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                        WHERE r.helper_id = h.uid AND r.claimed_at > now() - interval '20 hours')
       AND public.feature_enabled_for_user('payout_after_hire', h.uid)
       AND public.feature_enabled_for_user('payout_setup', h.uid)
  ),
  -- One 'hired' per hire: a live hire made after go-live and in the last 72 h
  -- that has not had its own. Not a COMPLETED or disputed job (owner report
  -- 2026-10-26), not a hire from before go-live, not one with no hire time.
  hired_due AS (
    SELECT DISTINCT ON (h.uid) h.uid, h.jid
      FROM hires h
     WHERE h.uid IN (SELECT x.uid FROM helprs x)
       AND h.live
       AND h.hired_on >= v_since
       AND h.hired_on > now() - interval '72 hours'
       AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                        WHERE r.helper_id = h.uid AND r.reminder_stage = 'hired' AND r.job_id = h.jid)
     ORDER BY h.uid, h.hired_on DESC, h.jid
  ),
  -- day1 / day3 / day7 per hire, counted from THAT hire's 'hired' reminder,
  -- and only while the hire is live.
  nudge_due AS (
    SELECT DISTINCT ON (n.uid) n.uid, n.jid, n.step
      FROM (
        SELECT h.uid, h.jid,
               CASE
                 WHEN hr.claimed_at <= now() - interval '7 days' AND COALESCE(ls.last_step, 0) < 3 THEN 'day7'
                 WHEN hr.claimed_at <= now() - interval '3 days' AND COALESCE(ls.last_step, 0) < 2 THEN 'day3'
                 WHEN hr.claimed_at <= now() - interval '1 day'  AND COALESCE(ls.last_step, 0) < 1 THEN 'day1'
               END AS step
          FROM hires h
          JOIN public.payout_setup_reminders hr
            ON hr.helper_id = h.uid AND hr.reminder_stage = 'hired' AND hr.job_id = h.jid
          LEFT JOIN LATERAL (
            SELECT max(CASE r.reminder_stage WHEN 'day1' THEN 1 WHEN 'day3' THEN 2 WHEN 'day7' THEN 3 ELSE 0 END) AS last_step
              FROM public.payout_setup_reminders r
             WHERE r.helper_id = h.uid AND r.job_id = h.jid AND r.reminder_stage IN ('day1', 'day3', 'day7')
          ) ls ON true
         WHERE h.live AND h.uid IN (SELECT x.uid FROM helprs x)
           -- Job reminders (owner 2026-10-29): the day1/day3/day7 follow-ups are
           -- switchable; 'hired' and 'money' stay always on.
           AND NOT EXISTS (SELECT 1 FROM public.notification_preferences np
                            WHERE np.user_id = h.uid AND np.remind_payout_followups IS FALSE)
      ) n
     WHERE n.step IS NOT NULL
     ORDER BY n.uid, n.jid
  ),
  due AS (
    SELECT x.uid,
           -- money first: one per job whose payout waits on this Helpr
           (SELECT 'money:' || h.jid::text FROM hires h
             WHERE h.uid = x.uid AND h.pay = 'payout_pending'
               AND NOT EXISTS (SELECT 1 FROM public.payout_setup_reminders r
                                WHERE r.helper_id = x.uid AND r.reminder_key = 'money:' || h.jid::text)
             ORDER BY h.jid LIMIT 1) AS money_key,
           (SELECT hd.jid FROM hired_due hd WHERE hd.uid = x.uid) AS hired_jid,
           (SELECT nd.jid FROM nudge_due nd WHERE nd.uid = x.uid) AS nudge_jid,
           (SELECT nd.step FROM nudge_due nd WHERE nd.uid = x.uid) AS nudge_step
      FROM helprs x
  ),
  chosen AS (
    SELECT d.uid,
           CASE WHEN d.money_key IS NOT NULL THEN d.money_key
                WHEN d.hired_jid IS NOT NULL THEN 'hired:' || d.hired_jid::text
                ELSE d.nudge_step || ':' || d.nudge_jid::text END AS rkey,
           CASE WHEN d.money_key IS NOT NULL THEN 'money'
                WHEN d.hired_jid IS NOT NULL THEN 'hired'
                ELSE d.nudge_step END AS rstage,
           CASE WHEN d.money_key IS NOT NULL THEN substr(d.money_key, 7)::uuid
                WHEN d.hired_jid IS NOT NULL THEN d.hired_jid
                ELSE d.nudge_jid END AS rjob
      FROM due d
     WHERE d.money_key IS NOT NULL OR d.hired_jid IS NOT NULL OR d.nudge_step IS NOT NULL
     ORDER BY d.uid
     LIMIT GREATEST(COALESCE(p_limit, 100), 0)
  ),
  ins AS (
    INSERT INTO public.payout_setup_reminders (helper_id, reminder_key, reminder_stage, job_id)
    SELECT c.uid, c.rkey, c.rstage, c.rjob FROM chosen c
    ON CONFLICT DO NOTHING
    RETURNING public.payout_setup_reminders.helper_id, public.payout_setup_reminders.reminder_key,
              public.payout_setup_reminders.reminder_stage, public.payout_setup_reminders.job_id
  )
  SELECT i.helper_id, i.reminder_key, i.reminder_stage, i.job_id, j.title
    FROM ins i
    LEFT JOIN public.jobs j ON j.id = i.job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_payout_setup_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_payout_setup_reminders(integer) TO service_role;

-- Q807: every public table carries the unconfirmed-email write gate.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;
