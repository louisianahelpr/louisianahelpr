-- 'New member joined' becomes ONE daily summary (owner, 2026-10-30 pop-up, audit
-- E4 M8: all 47 admin alerts in 7 days were this one notice).
--
-- notify_admins_new_member keeps every gate and the once-per-member claim, and
-- stops writing a notification: its claim row in new_member_admin_notices is now
-- the queue. send_new_member_daily_summary (cron, 13:11 UTC; 13:00 is full and 13:07 sits at the reserve floor) sends each admin
-- ONE notice naming who joined since the last run, and sends nothing on a day
-- nobody joined.
--
-- Test accounts: refused at the claim as before, and checked AGAIN at send time,
-- so an account marked as a test account after it confirmed never appears.
--
-- notify_admins_new_member is restated from 20261030143141, its newest
-- definition on origin/main (checked 10-31 by diffing the two bodies). Its only changes: the
-- notification INSERT and the no_admins branch go, and it returns 'queued'
-- instead of 'sent'.
--
-- A member marked a test account AFTER a summary named them is taken out of it:
-- retract_new_member_notice_for_test_account (restated from 20261027220459, its
-- newest definition) rebuilds every summary that named them from the members
-- still real, or deletes it when none are left, and marks a pending row done.
-- A summary's notifications carry created_at = its members' summarized_at (one
-- transaction, one now()), which is how the trigger finds them.
--
-- admin_alert_close_rule is restated from 20261030221720 (its newest
-- definition); its one change: the 'new member joined' row becomes
-- ('new member summary', 'notice').
--
-- Replay-safe: the backfill runs only when the column is first added.

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'new_member_admin_notices'
       AND column_name = 'summarized_at'
  ) THEN
    ALTER TABLE public.new_member_admin_notices ADD COLUMN summarized_at timestamptz;
    -- Everyone claimed before today was already announced one by one.
    -- DESTRUCTIVE-DDL-ACK: UPDATE public.new_member_admin_notices (no WHERE)
    -- ACK-REASON: a backfill of the column added on the line above; it runs only when that column is first added.
    -- ACK-DATA-LOSS: none; every summarized_at was NULL (just added) and becomes the row's notified_at, so no stored value is lost.
    UPDATE public.new_member_admin_notices SET summarized_at = notified_at;
  END IF;
END
$do$;

CREATE INDEX IF NOT EXISTS new_member_admin_notices_unsummarized_idx
  ON public.new_member_admin_notices (notified_at)
  WHERE summarized_at IS NULL;

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

  -- Announced already by the one-by-one notice this replaces: claim it as
  -- summarized, send nothing.
  -- Scoped to admin recipients so it rides the user_id indexes instead of
  -- scanning notifications inside GoTrue's confirm UPDATE.
  IF EXISTS (SELECT 1 FROM public.notifications x
              WHERE x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
                AND x.title = 'New member joined'
                AND x.link = '/admin?view=people&user=' || p_user_id::text) THEN
    INSERT INTO public.new_member_admin_notices (user_id, via, summarized_at)
    VALUES (p_user_id, 'earlier-notice', now())
    ON CONFLICT (user_id) DO NOTHING;
    RETURN 'already_sent';
  END IF;

  -- The exactly-once claim, and the daily summary's queue.
  INSERT INTO public.new_member_admin_notices (user_id, via)
  VALUES (p_user_id, coalesce(p_via, 'confirm'))
  ON CONFLICT (user_id) DO NOTHING
  RETURNING user_id INTO v_claimed;
  IF v_claimed IS NULL THEN
    RETURN 'already_sent';
  END IF;
  RETURN 'queued';
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_admins_new_member(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_admins_new_member(uuid, text) TO service_role;

-- The summary's one sentence for these members, in this order (first five named).
CREATE OR REPLACE FUNCTION public.new_member_summary_message(p_ids uuid[])
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT cardinality(p_ids)
           || CASE WHEN cardinality(p_ids) = 1 THEN ' new member joined: ' ELSE ' new members joined: ' END
           || (SELECT string_agg(
                        coalesce(NULLIF(btrim(p.full_name), ''), 'A new member')
                          || coalesce(' from ' || NULLIF(btrim(p.location), ''), ''),
                        ', ' ORDER BY t.ord)
                 FROM unnest(p_ids[1:5]) WITH ORDINALITY AS t(user_id, ord)
                 JOIN public.profiles p ON p.user_id = t.user_id)
           || CASE WHEN cardinality(p_ids) > 5 THEN ' and ' || (cardinality(p_ids) - 5) || ' more.' ELSE '.' END
$function$;

REVOKE ALL ON FUNCTION public.new_member_summary_message(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.new_member_summary_message(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.send_new_member_daily_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids     uuid[];
  v_skipped integer;
  v_count   integer;
  v_message text;
  v_sent    integer;
BEGIN
  -- Marked a test account after confirming, or deleted since: never named, and
  -- never read again. The lock keeps two overlapping runs from sending twice.
  WITH pending AS (
    SELECT n.user_id FROM public.new_member_admin_notices n
     WHERE n.summarized_at IS NULL
     FOR UPDATE OF n
  ), skipped AS (
    UPDATE public.new_member_admin_notices n
       SET summarized_at = now()
      FROM pending
     WHERE n.user_id = pending.user_id
       AND (public.is_test_subject(n.user_id)
            OR NOT EXISTS (SELECT 1 FROM public.profiles p
                            WHERE p.user_id = n.user_id
                              AND NOT coalesce(p.is_seed, false)
                              AND p.anonymized_at IS NULL))
    RETURNING 1
  )
  SELECT count(*) INTO v_skipped FROM skipped;

  SELECT array_agg(x.user_id) INTO v_ids
    FROM (SELECT n.user_id FROM public.new_member_admin_notices n
           WHERE n.summarized_at IS NULL
           ORDER BY n.notified_at, n.user_id
           FOR UPDATE OF n) x;
  v_count := coalesce(array_length(v_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN jsonb_build_object('members', 0, 'skipped', v_skipped, 'sent', 0);
  END IF;

  v_message := public.new_member_summary_message(v_ids);

  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT ur.user_id,
         'New member summary',
         v_message,
         'admin_alert',
         '/admin?view=people'
    FROM (SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role = 'admin') ur;
  GET DIAGNOSTICS v_sent = ROW_COUNT;
  -- Nobody to tell: keep them queued for the next run.
  IF v_sent = 0 THEN
    RETURN jsonb_build_object('members', v_count, 'skipped', v_skipped, 'sent', 0);
  END IF;

  UPDATE public.new_member_admin_notices
     SET summarized_at = now()
   WHERE user_id = ANY (v_ids);
  RETURN jsonb_build_object('members', v_count, 'skipped', v_skipped, 'sent', v_sent);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_new_member_daily_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_new_member_daily_summary() TO service_role;

DO $do$
BEGIN
  IF to_regclass('public.cron_work_expectations') IS NOT NULL THEN
    INSERT INTO public.cron_work_expectations (jobname, expected_max_gap, note, work_visibility, work_exempt_reason)
    VALUES ('new-member-daily-summary', interval '26 hours',
            'One daily admin notice naming who joined since the last run (owner 2026-10-30), at 13:11 UTC.',
            'exempt',
            'A day nobody joined changes nothing, which is the healthy state.')
    ON CONFLICT (jobname) DO UPDATE SET expected_max_gap = EXCLUDED.expected_max_gap, note = EXCLUDED.note,
      work_visibility = EXCLUDED.work_visibility, work_exempt_reason = EXCLUDED.work_exempt_reason;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('new-member-daily-summary', '11 13 * * *',
      $c$SELECT public.cron_record_work('new-member-daily-summary', to_jsonb(public.send_new_member_daily_summary()));$c$);
  END IF;
END
$do$;

-- Q30 catch-up policy: the newest migration that seeds cron_catchup_policy restates the whole set.
-- 20261030232231's rows verbatim, plus new-member-daily-summary (not re-run late).
DO $do$
BEGIN
  IF to_regclass('public.cron_catchup_policy') IS NOT NULL THEN
    -- Restates the whole policy set (the guard reads the newest seeding migration).
INSERT INTO public.cron_catchup_policy (jobname, catch_up, max_late, reason) VALUES
  ('ops-daily-digest',                true,  interval '20 hours', 'Slack digest of the last 24h of ops alerts; writes only its own delivery receipt. A late digest is the Q30 case itself: 09-22 went 38h with none.'),
  ('sweep-daily-job-digest',          true,  interval '6 hours',  'In-app "New jobs in <parish>" digest; its own NOT EXISTS skips anyone digested in the last 23h, so it cannot double-send. Capped at 6h because a late run shifts the next day''s by that 23h dedupe.'),
  ('push-token-health',               true,  interval '20 hours', 'Monitor (Q82): counts push tokens and writes at most one error_logs row per UTC day. Read-only otherwise.'),
  ('marketing-token-health',          true,  interval '20 hours', 'Monitor: checks the Meta token and that the publish queue drains; reads and alerts only.'),
  ('money-reconciliation',            true,  interval '20 hours', 'STRICTLY READ-ONLY by design (header of supabase/functions/money-reconciliation/index.ts): selects and Stripe paymentIntents.retrieve only. Reports money drift, never moves money.'),
  ('detect-suspicious-user-patterns', true,  interval '20 hours', 'Inserts a fraud_flags row only when no unresolved flag of that type exists for the user; its windows are relative to now(). Re-running is idempotent.'),
  ('sweep-old-email-send-log',        true,  interval '20 hours', 'Age-based TTL delete: a late run deletes exactly what the next run would. Idempotent.'),
  ('sweep-old-notifications',         true,  interval '20 hours', 'Age-based TTL delete of old notifications. Idempotent.'),
  ('sweep-old-error-logs',            true,  interval '20 hours', 'Age-based TTL delete of old error_logs. Idempotent.'),
  ('prune-cron-run-details',          true,  interval '20 hours', 'Deletes cron.job_run_details older than 7 days; the catch-up reads only the latest slot. Idempotent.'),
  ('prune-cron-run-log',              true,  interval '20 hours', 'Age-based prune of cron_run_log. Idempotent.'),
  ('prune-edge-rate-limit-log',       true,  interval '20 hours', 'Age-based prune of the edge rate-limit log. Idempotent.'),
  ('cleanup-notifications',           true,  interval '20 hours', 'Deletes READ notifications older than 30 days (age-based). Idempotent.'),
  ('stalled-completion-reminder',     true,  interval '6 hours',  'User nudge with its own per-job ledger (first_sent_at / second_sent_at / escalated_at, upsert ignoreDuplicates): a stage is never sent twice. 6h cap keeps it inside daytime.'),
  ('review-nag-cron',                 true,  interval '6 hours',  'User nudge with its own dedupe count per user and job inside WINDOW_HOURS, failing closed (unreadable count = already nagged). 6h cap keeps it inside daytime.'),
  ('engagement-automations',          true,  interval '6 hours',  'Lifecycle emails spaced by last_drip_at / last_approval_email_at, which it stamps on send: a late run cannot send a step twice. 6h cap keeps it inside daytime.'),
  ('charge-recurring-visits',         false, interval '1 hour',   'CHARGES CARDS for recurring visits. Money is never auto-rerun: a person checks what the missed day should have charged.'),
  ('expire-subscriptions',            false, interval '1 hour',   'Ends paid entitlements (one-time passes, lapsed tiers). Changes what a paying user has; a person decides.'),
  ('subscription-reconciliation',     false, interval '1 hour',   'REPAIRS tier state from Stripe (its header: "why this one repairs"). An automated entitlement writer is not re-run blind; a person decides.'),
  ('cleanup-abandoned-accounts',      false, interval '1 hour',   'DELETES accounts. Destructive; never re-run automatically.'),
  ('weekly-helper-report',            true,  interval '6 hours',  'Q188: weekly in-app report now skips any helper who already has one from the last 6 days (supabase/functions/weekly-helper-report, tested in src/test/edge/weekly-helper-report.test.ts), so a late run cannot send twice. 6h cap keeps it inside daytime.'),
  ('cleanup-stripe-webhook-events',   true,  interval '20 hours', 'Q167: deletes stripe_webhook_events processed over 30 days ago; the window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('cleanup-observability-tables',    true,  interval '20 hours', 'Q167: deletes analytics_events over 90 days and error_logs over 30; relative windows, idempotent, so a late run is the same prune.'),
  ('prune-retention-tables',          true,  interval '20 hours', 'CJ-003/CS-003: age-based deletes (login_history, notification_logs, profile_views, job_views, rate logs, W-9s over 4 years); every window is relative to now(), so a late run deletes exactly what an on-time one would have.'),
  ('purge-old-seed-data',             true,  interval '20 hours', 'Q65: age-based purge of is_seed test jobs (never money, never a fixture id, never profiles) and seed notifications; the window is relative to now() and every run is bounded and recorded, so a late run is the same purge.'),
  ('unfilled-series-visit-reminders', false, interval '1 hour',   'Tells a poster an empty series visit is TOMORROW (20261012195747). The text is relative to the run''s own day, so a late run past midnight would name the wrong day; its own once-per-visit ledger already stops a double send. Not re-run late.'),
  ('declutter-price-drops',           false, interval '1 hour',   'Declutter evening price drop (20261014210518): once per Louisiana day; a missed evening is simply skipped and the next evening drops 5% as usual. Not re-run late: a late run past midnight would spend the NEXT day''s drop.'),
  ('listing-photo-purge', false, interval '1 hour', 'Homes listing photo purge (20261019071203): deletes taken-down listings'' photos through the Storage API. Deletion is never re-run late; the next daily run deletes whatever is due.'),
  ('rentals-rent-sweep', false, interval '1 hour', 'Homes rent tracker (20261019073106): writes due rent rows, late fees and reminders. Not re-run late: the next daily run writes every missed rent row and fee itself (idempotent, from the first due date); only a missed reminder is skipped.'),
  ('rentals-deposit-sweep', false, interval '1 hour', 'Homes deposit tracker (20261019082216): deposit-return reminders by stage. Not re-run late: the next daily run sends the stage that is due (once each).'),
  ('job-match-roundups',              true,  interval '6 hours',  'Sends one "more jobs near you" email per member whose matches waited; it claims the batch (waiting -> 0) before sending, so a late run sends only what is still waiting and never twice. Capped at 6h so a very late run does not land in the evening.'),
  ('declutter-haul-away',             false, interval '1 hour',   'Declutter haul-away sweep (20261027165903): the "Haul-away is open" notice (once per listing, by its mark), a declined card''s haul-away job to abandoned, and the put-back-on-sale of a haul-away that never went ahead after 7 days. Not re-run late: the next daily run does everything that was due.'),
  ('declutter-price-nudge',           false, interval '1 hour',   'Declutter "drop the price?" nudge (20261030141656): one notice per unsold listing per 14 days, by its own mark. Not re-run late: the next daily run sends whatever is due.'),
  ('declutter-move-reminders',        false, interval '1 hour',   'Moving-sale reminders (20261030221156): the day-before notice says "tomorrow", so a late run past midnight would name the wrong day; the day-after notice looks back 3 days, so the next daily run sends it. Once each, by its own mark. Not re-run late.'),
  ('declutter-free-still-available', false, interval '1 hour',  'Declutter free listing "still available?" notice (20261030232231): at most one per listing per 14 days, by its own told-at mark. A missed morning is simply picked up by the next daily run.'),
  ('new-member-daily-summary',       false, interval '1 hour',   'One admin notice naming who joined since the last run (20261031152136). Not re-run late: the queue keeps everyone not yet summarized, so the next day''s run names them.')
    ON CONFLICT (jobname) DO UPDATE
      SET catch_up = EXCLUDED.catch_up, max_late = EXCLUDED.max_late,
          reason = EXCLUDED.reason, updated_at = now();
  END IF;
END
$do$;

-- Marked a test account: no admin notice keeps their name (owner 2026-10-27,
-- "Stop showing test stuff in my notification"). Restated from 20261027220459;
-- the one-by-one retraction is unchanged, the summary half is new.
CREATE OR REPLACE FUNCTION public.retract_new_member_notice_for_test_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_at  timestamptz;
  v_ids uuid[];
BEGIN
  IF NEW.is_seed IS TRUE AND OLD.is_seed IS DISTINCT FROM TRUE THEN
    DELETE FROM public.notifications n
     WHERE n.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
       AND n.title = 'New member joined'
       AND n.link = '/admin?view=people&user=' || NEW.user_id::text;

    -- A summary already sent that named them: rebuilt from the members still
    -- real, or deleted when nobody is left.
    SELECT n.summarized_at INTO v_at
      FROM public.new_member_admin_notices n WHERE n.user_id = NEW.user_id;
    IF v_at IS NOT NULL THEN
      SELECT array_agg(n.user_id ORDER BY n.notified_at, n.user_id) INTO v_ids
        FROM public.new_member_admin_notices n
        JOIN public.profiles p ON p.user_id = n.user_id
       WHERE n.summarized_at = v_at
         AND n.user_id <> NEW.user_id
         AND NOT coalesce(p.is_seed, false)
         AND p.anonymized_at IS NULL
         AND NOT public.is_test_subject(n.user_id);
      IF v_ids IS NULL THEN
        DELETE FROM public.notifications x
         WHERE x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
           AND x.title = 'New member summary'
           AND x.created_at = v_at;
      ELSE
        UPDATE public.notifications x
           SET message = public.new_member_summary_message(v_ids)
         WHERE x.user_id IN (SELECT r.user_id FROM public.user_roles r WHERE r.role = 'admin')
           AND x.title = 'New member summary'
           AND x.created_at = v_at;
      END IF;
    END IF;

    -- Still waiting for the next summary: never named.
    UPDATE public.new_member_admin_notices
       SET summarized_at = now()
     WHERE user_id = NEW.user_id AND summarized_at IS NULL;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.retract_new_member_notice_for_test_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS retract_new_member_notice_for_test_account ON public.profiles;
CREATE TRIGGER retract_new_member_notice_for_test_account
  AFTER UPDATE OF is_seed ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.retract_new_member_notice_for_test_account();

-- Restated from 20261030221720 (newest); one row changed (see the header).
CREATE OR REPLACE FUNCTION public.admin_alert_close_rule(p_title text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT r.rule
    FROM (VALUES
      ('ban review needed',                         'ban-review'),
      ('identity verification needs review',        'idv-review'),
      ('user flagged',                              'reported-user'),
      ('dispute escalated',                         'dispute-open'),
      ('escalated dispute overdue',                 'dispute-open'),
      ('dispute stuck — escrow cannot auto-settle', 'dispute-open'),
      ('dispute split did not settle',              'dispute-unsettled'),
      ('job stalled — nobody marked it done',       'stalled-job'),
      ('stuck payment — webhook may be failing',    'stuck-payment'),
      ('payout blocked — ',                          'money-held'),
      ('scheduled payout failed',                   'money-held'),
      ('transfer failed',                           'money-held'),
      ('arrival not confirmed in ',                 'arrival-unconfirmed'),
      ('arrival near a wrong pin not confirmed',    'arrival-unconfirmed'),
      ('auto-restricted (',                         'restriction-review'),
      ('repeat offender: ',                         'repeat-offender'),
      ('low rating alert',                          'low-rating'),
      -- 20261031152136: one daily summary replaces the one-by-one notice.
      ('new member summary',                        'notice'),
      ('dispute auto-resolved',                     'notice'),
      -- Q1324: an account banned on a card / bank match waits for an admin.
      ('ban settlement review',                     'ban-settlement-review'),
      -- Rentals slice 3: a landlord's ownership proof waits for an admin.
      ('ownership proof waits for review',          'rentals-ownership-review'),
      -- Landlord ID (20261019051407): a landlord's photo ID waits for an admin.
      ('landlord id waits for review',              'rentals-landlord-id-review'),
      -- 20261023143240: a job whose poster did not approve in time waits for Helpr support.
      ('job waiting on approval',                   'approval-escalation'),
      -- 20261030221720: a support ticket waits for an answer.
      ('new support message',                       'support-ticket')
    ) AS r(prefix, rule)
   WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%'
   LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.admin_alert_close_rule(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO service_role;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO supabase_read_only_user;
  END IF;
END
$grant$;
