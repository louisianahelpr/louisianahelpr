-- Job notices follow the job switches, not "System alerts" (list #17, owner 10-30).
--
-- BROKEN (notification_type_pref_map on prod, 2026-10-30): a Helpr cancelling, an offer declined or expired, a
-- dispute and a day-of "hasn't confirmed yet" were inserted as type 'warning', so their PUSH followed the System
-- alerts switch, while the back-out EMAIL (send_backout_email) already followed Job updates. One event, two switches.
--
-- FIX: one BEFORE INSERT trigger files those exact titles under 'job_updates', whichever of the senders wrote them
-- (helper_cancel_booking, open_dispute_as, sweep_backout_notice_reminders, the day-of sweep). 'aa_' so it runs before
-- suppress_exact_duplicate_notification and the reminder choice, which both read the type. Named titles only:
-- 'Warning — keep it on Helpr' and money warnings stay where they are, and 'Job cancelled' and 'Job reposted' stay
-- 'warning' because job_reminder_types matches them on that type as always-on reminders. A row on a Declutter screen
-- never reaches this as 'warning' with these titles (declutter_notice_type), and the link check keeps it that way.
-- Old rows are history and are not rewritten.
--
-- sms_kind_for is restated from prod (md5 2adba759..., = 20261030035326) so no text changes because of the move:
-- disputes and a cancelled Helpr still text under the new type, and the quiet titles get an explicit NULL ahead of
-- the job_update catch-all, because trg_notifications_fill_job_id gives them a job and they would start texting.
-- The hire offer moves in _shared/notification-templates.ts ('info' -> 'new_offers', no emoji in its title, the Job offers
-- switch the direct offer already follows); its new branch is here.

CREATE OR REPLACE FUNCTION public.notifications_job_notice_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  NEW.type := 'job_updates';
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notifications_job_notice_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_notifications_job_notice_type ON public.notifications;
CREATE TRIGGER aa_notifications_job_notice_type
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type = 'warning'
        AND NEW.title IN ('Your Helpr cancelled', 'Your Helpr didn''t confirm', 'Offer declined', 'Offer expired',
                          'A dispute was opened', 'Job disputed',
                          'Your Helpr hasn''t confirmed yet', 'A Helpr on your crew hasn''t confirmed yet')
        AND COALESCE(NEW.link, '') NOT LIKE '/declutter%')
  EXECUTE FUNCTION public.notifications_job_notice_type();

CREATE OR REPLACE FUNCTION public.sms_kind_for(p_type text, p_title text, p_job_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    -- Nearby / matching jobs are never texted (owner 2026-10-23). First, so nothing below can catch one.
    WHEN p_type = 'job_match' THEN NULL
    WHEN p_type = 'message' THEN 'message'
    -- A job offer has an answer deadline (direct offer, or the hire offer).
    WHEN p_type = 'new_offers' AND p_title IN ('You got a direct job offer!', 'New job offer', '📋 New job offer!') THEN 'job_offer'
    WHEN p_type = 'info' AND p_title = '📋 New job offer!' THEN 'job_offer'
    WHEN p_type = 'application' AND p_title = 'New application' THEN 'application'
    WHEN p_type = 'job_update' AND p_title = 'Starting soon' THEN 'starting_soon'
    -- Q2483: the 2-hour and head-out start reminders are as time-critical as Starting soon.
    WHEN p_type = 'job_update' AND p_title IN ('Your job starts in 2 hours', 'Time to head out') THEN 'starting_soon'
    WHEN p_type = 'job_updates' AND p_title = 'New date or time requested' THEN 'reschedule'
    WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
    WHEN p_type IN ('payment', 'warning') AND p_title IN ('Job cancelled', 'Job cancelled — you''ll be compensated') THEN 'job_cancelled'
    WHEN p_type IN ('warning', 'job_updates') AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'
    WHEN p_type = 'job_updates' AND p_title = 'Job auto-cancelled' THEN 'job_cancelled'
    WHEN p_type = 'warning' AND p_title IN ('Your payout didn''t go through', 'Payout account needs attention',
                                            'Payment failed', 'Your bank payment failed', 'Job payment failed')
      THEN 'money_problem'
    WHEN p_type = 'payment' AND p_title = 'A refund didn''t go through' THEN 'money_problem'
    WHEN p_type = 'financial_alerts' AND p_title IN ('Payout account required', 'We couldn''t send your payout') THEN 'money_problem'
    -- Back-out reminders moved from 'warning' to 'job_updates' and are still never texted: ahead of the catch-all.
    WHEN p_type = 'job_updates' AND p_title IN ('Offer declined', 'Offer expired', 'Your Helpr didn''t confirm',
                                                'Your Helpr hasn''t confirmed yet', 'A Helpr on your crew hasn''t confirmed yet')
      THEN NULL
    -- Other updates on the member's own job.
    WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL THEN 'job_update'
    WHEN p_type IN ('info', 'success') AND p_job_id IS NOT NULL THEN 'job_update'
    ELSE NULL
  END;
$fn$;
REVOKE ALL ON FUNCTION public.sms_kind_for(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_kind_for(text, text, uuid) TO service_role;
