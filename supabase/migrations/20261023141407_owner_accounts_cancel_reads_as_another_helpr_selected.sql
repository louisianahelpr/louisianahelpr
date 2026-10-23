-- When the owner's own two accounts cancel a job, its applicants read "Another Helpr was selected", never
-- that the job was cancelled (owner, 2026-10-23: "no user should see when I cancel a job. So fix this for
-- [my two accounts]" ... "It should just show as like another helpr was selected. But thank you for applying.
-- This is only for my 2 accounts.").
--
-- WHAT IT WAS. poster_cancel_job closes every pending application as status 'rejected' with
-- closed_reason 'job_cancelled'; since 2026-10-21 an applicant who was not hired gets no notice and their
-- card reads "This job is no longer available" (closedCardLabel) / the job's own "Cancelled" line.
--
-- THE CHANGE.
--  1. public.quiet_cancel_posters: the accounts this applies to, by user id (the owner's two; no email is
--     written into this public repo). Readable by no member; admins manage it in SQL.
--  2. closed_reason gains 'other_helpr_selected' (the CHECK is restated with every existing value).
--  3. trg_applications_owner_cancel_quiet, AFTER UPDATE: when an application of a job posted by one of
--     those accounts is closed 'job_cancelled', and its applicant is not the job's hired Helpr, the reason
--     becomes 'other_helpr_selected'. AFTER, not BEFORE, on purpose: notify_on_application (also AFTER) has
--     already seen 'job_cancelled' and sent nothing to an unhired applicant; a BEFORE rewrite would have
--     made it send "was not selected". The second UPDATE leaves status 'rejected' -> 'rejected', which
--     notify_on_application ignores (it acts only on pending -> rejected), and does not re-fire this trigger
--     (the reason is no longer 'job_cancelled'). The hired Helpr is still told the job was cancelled: they
--     may be planning to show up.
--  4. Backfill: the same rewrite for those accounts' jobs already cancelled (3 rows on prod, 2026-10-23).
--
-- The client reads the new reason as "Another Helpr was selected. Thank you for applying!" (closedCardLabel,
-- HELPER_WAIT.other_selected), filed with the other not-picked applications.
--
-- REPLAY-SAFETY: IF NOT EXISTS, ON CONFLICT DO NOTHING, CREATE OR REPLACE, DROP ... IF EXISTS; the backfill
-- matches nothing on a second run.

CREATE TABLE IF NOT EXISTS public.quiet_cancel_posters (
  user_id uuid PRIMARY KEY,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quiet_cancel_posters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quiet_cancel_posters FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.quiet_cancel_posters TO service_role;
COMMENT ON TABLE public.quiet_cancel_posters IS
  'Owner 2026-10-23: accounts whose cancelled jobs read "Another Helpr was selected" to their applicants (trg_applications_owner_cancel_quiet). The owner''s two accounts only. No member reads or writes it.';
INSERT INTO public.quiet_cancel_posters (user_id) VALUES
  ('7f65ef12-1d3d-439b-b0a7-f42ce8bc176d'),
  ('76b07824-9b41-4741-a4c4-4f8de362f682')
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_closed_reason_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_closed_reason_check
  CHECK (closed_reason IS NULL OR closed_reason = ANY (ARRAY['job_cancelled'::text, 'party_blocked'::text, 'offer_expired'::text, 'not_confirmed'::text, 'other_helpr_selected'::text]));

CREATE OR REPLACE FUNCTION public.applications_owner_cancel_quiet()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.closed_reason = 'job_cancelled'
     AND OLD.closed_reason IS DISTINCT FROM 'job_cancelled'
     AND EXISTS (
       SELECT 1 FROM public.jobs j
        JOIN public.quiet_cancel_posters q ON q.user_id = j.customer_id
       WHERE j.id = NEW.job_id
         AND NEW.helper_id IS DISTINCT FROM j.helper_id
     ) THEN
    UPDATE public.applications SET closed_reason = 'other_helpr_selected' WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.applications_owner_cancel_quiet() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_applications_owner_cancel_quiet ON public.applications;
CREATE TRIGGER trg_applications_owner_cancel_quiet
  AFTER UPDATE OF closed_reason ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.applications_owner_cancel_quiet();

-- Backfill: those accounts' jobs already cancelled.
UPDATE public.applications a
   SET closed_reason = 'other_helpr_selected'
  FROM public.jobs j
  JOIN public.quiet_cancel_posters q ON q.user_id = j.customer_id
 WHERE a.job_id = j.id
   AND a.closed_reason = 'job_cancelled'
   AND a.helper_id IS DISTINCT FROM j.helper_id;
