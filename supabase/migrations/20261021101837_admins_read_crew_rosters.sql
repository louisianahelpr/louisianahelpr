-- Admin › Users "held" chip counts crew members' shares from group_job_helpers
-- (money review 2026-10-21: held ignored crew members). Its only SELECT policy
-- admitted the job's poster and the crew member themself, so an admin read
-- came back empty and silently undercounted. Admins may READ rosters; no write.
DROP POLICY IF EXISTS "Admins can view group helpers" ON public.group_job_helpers;
CREATE POLICY "Admins can view group helpers" ON public.group_job_helpers
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));
