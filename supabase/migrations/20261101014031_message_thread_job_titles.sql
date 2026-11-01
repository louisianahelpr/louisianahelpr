-- NOID-20 "a job" label (lead decision 2026-10-31). The Messages inbox names each thread by its job's title, read
-- with a plain `jobs` select (src/pages/messages/messagesData/loadConversations.ts). Row security on jobs hides a job
-- from someone who no longer has a role on it (an applicant who was not picked, a Helpr after a job was reassigned,
-- a job that closed), so their thread fell back to the literal "a job" while the conversation itself was still in
-- their inbox. This read-only function returns ONLY the title, and only for jobs the CALLER has a message on (as
-- sender or receiver): a participant of that conversation. Nobody else gets anything, not even whether the job
-- exists. auth.uid() is read inside, never taken as an argument; a NULL uid (anon, a service call with no JWT)
-- matches nothing. At most 500 ids per call (the inbox asks about the jobs of its newest threads).
-- Review: lh-authz-rls (SECURITY DEFINER read). Proof: src/test/pglite/messageThreadJobTitles.pglite.mjs.
--
-- REPLAY-SAFETY: guarded on the tables it reads; CREATE OR REPLACE; grants restated every run.
DO $migration$
BEGIN
  IF to_regclass('public.jobs') IS NULL OR to_regclass('public.messages') IS NULL THEN
    RAISE NOTICE 'jobs / messages absent: get_message_thread_job_titles skipped';
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.get_message_thread_job_titles(p_job_ids uuid[])
 RETURNS TABLE(job_id uuid, title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $body$
  SELECT j.id, j.title
    FROM public.jobs j
   WHERE (SELECT auth.uid()) IS NOT NULL
     AND j.id = ANY ((p_job_ids)[1:500])
     AND EXISTS (
       SELECT 1
         FROM public.messages m
        WHERE m.job_id = j.id
          AND (m.sender_id = (SELECT auth.uid()) OR m.receiver_id = (SELECT auth.uid()))
     );
$body$;
$fn$;

  REVOKE ALL ON FUNCTION public.get_message_thread_job_titles(uuid[]) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.get_message_thread_job_titles(uuid[]) TO authenticated, service_role;
  COMMENT ON FUNCTION public.get_message_thread_job_titles(uuid[]) IS
    'The title of each given job the caller has a message on (sender or receiver), and nothing for anyone else (NOID-20, lead 2026-10-31). Read-only; at most 500 ids.';
END
$migration$;
