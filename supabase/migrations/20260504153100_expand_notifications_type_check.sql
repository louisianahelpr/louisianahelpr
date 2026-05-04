-- Expand notifications.type CHECK to cover every value actually written by
-- trigger functions and edge functions.
--
-- Discovered while smoke-testing the new jobs.status state-machine trigger.
-- An UPDATE jobs SET status='in_progress' fired notify_poster_on_status_change()
-- which inserts notifications.type='work_status' — but the live constraint
-- only allowed 7 types and rejected it with 23514. That meant ANY
-- accepted→in_progress transition was failing in production with no
-- visible Sentry alert (the trigger error rolled back the whole UPDATE).
--
-- Triggers / edge functions emit at least these types (grepped from
-- supabase/migrations/**/.sql and supabase/functions/**/index.ts):
--   - job_match           (notify_helpers_on_job_post, notify_saved_searches_on_new_job)
--   - work_status         (notify_poster_on_status_change)
--   - transit_updates     (helper-on-the-way notifications)
--   - system_alert        (admin broadcast paths)
--   - new_offers          (direct offers)
--   - expired             (job listing expired)
--   - financial_alerts    (payout / balance alerts)
--   - verified            (account verification confirmations)
--   - job_updates (plural — code inconsistency vs. the original 'job_update')
--
-- Keep this list in sync with INSERT INTO public.notifications calls
-- across the codebase.

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- Original 7
    'info', 'success', 'warning', 'job_update', 'application', 'review', 'payment',
    -- Discovered in trigger / edge function code
    'job_match', 'job_updates', 'work_status', 'transit_updates',
    'system_alert', 'new_offers', 'expired', 'financial_alerts', 'verified'
  ));

COMMENT ON CONSTRAINT notifications_type_check ON public.notifications IS
'Allowed notification.type values. Keep in sync with INSERT INTO public.notifications calls in supabase/migrations/**/.sql and supabase/functions/**/index.ts.';
