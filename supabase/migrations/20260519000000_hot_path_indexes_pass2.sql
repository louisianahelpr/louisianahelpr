-- Hot-path indexes — second pass.
-- Identified by a read-only DB audit of every Supabase query in src/.
-- Each query path noted in the comment above the index.

-- 1. Inbox + outbound history scans (Messages page .or(sender_id, receiver_id)).
--    The existing idx_messages_receiver_unread is partial (read=false) and
--    doesn't cover already-read inbound mail OR any outbound mail.
CREATE INDEX IF NOT EXISTS idx_messages_sender_created
  ON public.messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_created
  ON public.messages (receiver_id, created_at DESC);

-- 2. Notification feed time-order (NotificationPanel — mounts on every page).
--    Existing (user_id, read) serves unread count but forces in-memory sort
--    for the time-ordered list.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

-- 3. user_violations lookups in decline-offer / no-show / off-platform-contact
--    flows. user_id column has NO index today; every gate is a full seq scan.
CREATE INDEX IF NOT EXISTS idx_user_violations_user_type
  ON public.user_violations (user_id, violation_type);

-- 4. Profile-page tip summary (.eq("helper_id", X)).
CREATE INDEX IF NOT EXISTS idx_tips_helper_id
  ON public.tips (helper_id);

-- 5. Dashboard saved-jobs lookup on every mount (.eq("user_id", X)).
CREATE INDEX IF NOT EXISTS idx_saved_jobs_user_id
  ON public.saved_jobs (user_id);

-- 6. PostJob 5-cap preflight + Activity feed "my posted jobs" ordering.
--    Composite covers both the dual-equality preflight AND the user-ordered list.
CREATE INDEX IF NOT EXISTS idx_jobs_customer_status_created
  ON public.jobs (customer_id, status, created_at DESC);

-- 7. Dashboard last-application lookup + Activity "my applications" ordering.
CREATE INDEX IF NOT EXISTS idx_applications_helper_created
  ON public.applications (helper_id, created_at DESC);
