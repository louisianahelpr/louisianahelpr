-- Admin → Jobs could not see a job's continue day, so it called a continuing job overdue (owner report 11-03).
--
-- Job 7b1da54b (Mow and Weed Eat, in_progress) was dated Sun 11/1 and has an agreed continue day, Thu 11/5 9 AM
-- (job_continue_days status 'set', Helpr confirmed 11/2, not closed). Admin → Jobs showed "Sun, Nov 1", "Date
-- needed has passed" and counted it "stale-dated", because the card and the stale check read only
-- jobs.date_needed. The fix on the client reads the job's open continue day and uses it as the next date; but
-- job_continue_days was readable only by the job's two parties ("Job parties read continue days",
-- 20261101231015), so an admin's read came back empty.
--
-- This restates that ONE policy with one more reader: an admin (public.has_role, the same check as "Admins read
-- access notes" on job_access_notes). Still SELECT only, still authenticated only (anon has no grant), still no
-- client writes (every write is an RPC). ONE policy rather than a second permissive one, so the parties' read
-- plan is unchanged. Replay-safe: DROP POLICY IF EXISTS, then CREATE.

DROP POLICY IF EXISTS "Job parties read continue days" ON public.job_continue_days;
CREATE POLICY "Job parties read continue days" ON public.job_continue_days FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id
                  AND ((SELECT auth.uid()) = j.customer_id OR (SELECT auth.uid()) = j.helper_id))
         OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
