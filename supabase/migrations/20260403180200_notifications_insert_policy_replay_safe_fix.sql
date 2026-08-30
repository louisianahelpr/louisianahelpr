-- Replay-safe fix: 20260311004406 created "Service role can insert notifications"
-- with an overly-permissive definition (TO authenticated WITH CHECK (true)).
-- The cleanup in 20260403180249 re-creates the policy with the correct guard
-- (auth.role() = 'service_role'), but on a clean replay the CREATE POLICY
-- fails because the policy already exists from the earlier migration.
-- Drop it here so the next migration can create it with the correct definition.
DROP POLICY IF EXISTS "Service role can insert notifications" ON public.notifications;
