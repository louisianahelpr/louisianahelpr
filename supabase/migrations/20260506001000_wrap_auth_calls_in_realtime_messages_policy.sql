-- Same initPlan wrap as 20260505235000_*, but for the one policy we own
-- in the `realtime` schema (created by 20260412070714 — not Supabase-shipped).
--
-- Closes the last remaining auth_rls_initplan advisor warning.

ALTER POLICY "Users can subscribe to own channels" ON realtime.messages
USING (
  (realtime.topic() ~ ('^(notifications|messages):'::text || ((SELECT auth.uid()))::text))
  OR has_role((SELECT auth.uid()), 'admin'::app_role)
  OR (EXISTS (
    SELECT 1
    FROM jobs
    WHERE (
      (
        (realtime.topic() ~ ('^jobs:'::text || (jobs.id)::text))
        OR (realtime.topic() ~ ('^job_tracking:'::text || (jobs.id)::text))
        OR (realtime.topic() ~ ('^job_checkins:'::text || (jobs.id)::text))
      )
      AND (
        (jobs.customer_id = (SELECT auth.uid()))
        OR (jobs.helper_id = (SELECT auth.uid()))
      )
    )
  ))
);
