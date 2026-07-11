-- SEC-002: the "Users can update their own notifications" policy has a USING
-- clause (auth.uid() = user_id) but no WITH CHECK, so a user can UPDATE a row
-- they own and reassign user_id to a stranger — injecting a notification into
-- another account. Low impact (no money/PII read) but a trivially-closable
-- authorization gap. Recreate the policy with a matching WITH CHECK so the
-- post-update row must still belong to the acting user.

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
  ON public.notifications
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
