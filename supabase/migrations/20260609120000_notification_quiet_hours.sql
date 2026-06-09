-- Notification quiet hours (handoff item #24).
--
-- Two columns on notification_preferences for a per-user quiet window.
-- When both are non-NULL, the push fan-out trigger should suppress
-- non-critical pushes (security alerts always fire) within the
-- window — wired into the fan-out RPC in a future migration once
-- this lands and the UI ships.
--
-- For now the UI shows the toggle + start/end pickers and stores the
-- values; honoring them in the fan-out is intentionally a separate,
-- isolated change so we can land the column + UI without a code-path
-- shift.
--
-- Replay-safe: ADD COLUMN IF NOT EXISTS so a from-scratch rebuild on
-- a database that may not yet have notification_preferences is still
-- safe (the table itself is created in an earlier migration and
-- guaranteed present by timestamp order).

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS quiet_start time,
  ADD COLUMN IF NOT EXISTS quiet_end time;

COMMENT ON COLUMN public.notification_preferences.quiet_start IS
  'Local-time start of the user''s quiet window (e.g. 22:00). Non-critical pushes are suppressed between quiet_start and quiet_end. NULL = quiet hours disabled.';

COMMENT ON COLUMN public.notification_preferences.quiet_end IS
  'Local-time end of the user''s quiet window (e.g. 07:00). Non-critical pushes are suppressed between quiet_start and quiet_end. NULL = quiet hours disabled.';
