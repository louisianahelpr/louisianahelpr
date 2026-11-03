-- Q2330: a deleted member's name leaves other members' stored notifications.
--
-- purge_user_data deletes only the departing member's OWN notifications (live body, md5
-- 9bdc2333246e6743528369812723952f, 2026-11-02). Text that names them in someone else's bell
-- ("Bea T. applied to ...", "Bea T. has arrived ...") stayed, though every other surface shows
-- "Former member" (src/lib/deletedPerson.ts).
--
-- purge_user_data is NOT restated here. Its step 4e redacts the profile in one UPDATE that sets
-- full_name = NULL and anonymized_at = now(), guarded on anonymized_at IS NULL: "this row has been
-- through the purge". This AFTER UPDATE OF anonymized_at trigger fires exactly there, while OLD still
-- holds the name, and inside the purge's transaction (a failed purge rolls the rewrite back too).
--
-- The rule is Q2292's (b), by id, never by text alone: a row is rewritten only when it belongs to
-- another member AND its job names the departing member as a party (poster, hired Helpr, applicant
-- or crew member). A notice with no job, or whose job does not name them, is left alone: a different
-- member with the same name may be the one it means. The full name and its display form ("Bea T.",
-- member_display_name) are replaced as whole words by "A former member" at the start of the text,
-- "a former member" elsewhere. A one-word name is left alone (as a bare first name it is not
-- identifiable, and it could be an ordinary word). Staff rows (an admin recipient with an /admin
-- link) keep full names, as in 20261023130742 and Q2292.
--
-- No backfill: members deleted before this have no profile row left, so their names are unknown.
-- Proof: node src/test/pglite/departedMemberNameLeavesNotifications.pglite.mjs (3x, red without this).
CREATE OR REPLACE FUNCTION public.scrub_departed_member_name_from_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_full text := btrim(coalesce(OLD.full_name, ''));
  v_name text;
  v_rx text;
BEGIN
  IF OLD.anonymized_at IS NOT NULL OR NEW.anonymized_at IS NULL OR v_full !~ '\s' THEN
    RETURN NEW;
  END IF;
  -- Longest first: the full name, then its "First L." form.
  FOREACH v_name IN ARRAY ARRAY[v_full, public.member_display_name(OLD.full_name, NULL)] LOOP
    CONTINUE WHEN v_name IS NULL OR v_name = '';
    v_rx := '\m' || regexp_replace(v_name, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(?!\w)';
    UPDATE public.notifications n
       SET title   = regexp_replace(regexp_replace(n.title, '^' || v_rx, 'A former member'), v_rx, 'a former member', 'g'),
           message = regexp_replace(regexp_replace(n.message, '^' || v_rx, 'A former member'), v_rx, 'a former member', 'g')
     WHERE n.user_id IS DISTINCT FROM OLD.user_id
       AND (coalesce(n.title, '') ~ v_rx OR coalesce(n.message, '') ~ v_rx)
       AND n.job_id IS NOT NULL
       AND (EXISTS (SELECT 1 FROM public.jobs j
                     WHERE j.id = n.job_id AND OLD.user_id IN (j.customer_id, j.helper_id))
         OR EXISTS (SELECT 1 FROM public.applications a
                     WHERE a.job_id = n.job_id AND a.helper_id = OLD.user_id)
         OR EXISTS (SELECT 1 FROM public.group_job_helpers g
                     WHERE g.job_id = n.job_id AND g.helper_id = OLD.user_id))
       AND NOT (coalesce(n.link, '') LIKE '/admin%'
                AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = n.user_id AND ur.role = 'admin'));
  END LOOP;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.scrub_departed_member_name_from_notifications() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_scrub_departed_member_name ON public.profiles;
CREATE TRIGGER trg_scrub_departed_member_name
  AFTER UPDATE OF anonymized_at ON public.profiles
  FOR EACH ROW
  WHEN (OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL)
  EXECUTE FUNCTION public.scrub_departed_member_name_from_notifications();
