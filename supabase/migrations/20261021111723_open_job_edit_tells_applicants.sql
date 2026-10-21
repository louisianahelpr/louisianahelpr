-- Board 66/172 slice 4 (PLAN-66-172, owner defaults 2 and 3, 2026-10-21):
--   (3) When a poster edits an OPEN job that people have applied to, each waiting applicant is told what changed
--       (date, time, place, title or description), at most once an hour per job, so a few quick fixes are one
--       notice, not five.
--   (2) Once anyone has applied, the job's category is locked (an applicant applied to a kind of work; the
--       address stays editable, with the notice above).
-- Before this an applicant was never told the job they applied to had moved or changed (PLAN-66-172: "There's no
-- applicant notice on edit").
--
-- jobs.last_edit_notice_at: when the last such notice went out. Server-owned: on INSERT a client value is cleared
-- and on UPDATE the old value is kept, so nobody can set, forge or reset the hour (lh-authz-rls F1: a client
-- insert of a far-future stamp would otherwise silence every notice). A stamp in the future never suppresses.
-- jobs_open_edit_tells_applicants: BEFORE INSERT OR UPDATE on jobs.
--   - Category: a client change of category on a job with any application raises category_locked_after_applications.
--   - Notice: on an open job with no Helpr, when date_needed, start_time, location, title or description changed,
--     and no notice went out in the last hour, every PENDING applicant gets one notification naming what changed
--     ("the date and time", "the place", "the details"), in role-neutral words, linking to the job.
-- Server writes (is_server_context) neither notify nor lock: sweeps and migrations are not edits.
-- Proof: node src/test/pglite/openJobEditTellsApplicants.pglite.mjs (red without the file, 3x apply).

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS last_edit_notice_at timestamptz;
-- Column grants follow the table's rule (every column but the offeree is readable); the stamp says nothing private.
DO $$
BEGIN
  IF to_regprocedure('public.sync_jobs_select_grants()') IS NOT NULL THEN
    PERFORM public.sync_jobs_select_grants();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.jobs_open_edit_tells_applicants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_server boolean := public.is_server_context();
  v_when boolean;
  v_place boolean;
  v_details boolean;
  v_what text;
  v_parts text[];
  v_app record;
  v_sent integer := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_server THEN
      NEW.last_edit_notice_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  -- Server-owned: a client value is never kept.
  IF NOT v_server THEN
    NEW.last_edit_notice_at := OLD.last_edit_notice_at;
  END IF;
  IF v_server THEN
    RETURN NEW;
  END IF;

  IF NEW.category IS DISTINCT FROM OLD.category
     AND EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = OLD.id) THEN
    RAISE EXCEPTION 'category_locked_after_applications' USING ERRCODE = '42501',
      HINT = 'People have applied to this kind of work, so the category stays. Post a new job for different work.';
  END IF;

  IF NEW.status::text <> 'open' OR NEW.helper_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_when := NEW.date_needed IS DISTINCT FROM OLD.date_needed OR NEW.start_time IS DISTINCT FROM OLD.start_time;
  v_place := NEW.location IS DISTINCT FROM OLD.location;
  v_details := NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description;
  IF NOT (v_when OR v_place OR v_details) THEN
    RETURN NEW;
  END IF;
  IF OLD.last_edit_notice_at > now() - interval '1 hour' AND OLD.last_edit_notice_at <= now() THEN
    RETURN NEW;
  END IF;

  v_parts := ARRAY_REMOVE(ARRAY[
    CASE WHEN v_when THEN 'the date and time' END,
    CASE WHEN v_place THEN 'the place' END,
    CASE WHEN v_details THEN 'the details' END
  ], NULL);
  -- "the place", "the date and time and the place", "the date and time, the place and the details".
  v_what := CASE cardinality(v_parts)
    WHEN 1 THEN v_parts[1]
    WHEN 2 THEN v_parts[1] || ' and ' || v_parts[2]
    ELSE v_parts[1] || ', ' || v_parts[2] || ' and ' || v_parts[3]
  END;

  FOR v_app IN
    SELECT a.helper_id FROM public.applications a
     WHERE a.job_id = OLD.id AND a.status = 'pending' AND a.helper_id IS NOT NULL
       AND NOT public.are_users_blocked(a.helper_id, OLD.customer_id)
  LOOP
    INSERT INTO public.notifications (user_id, job_id, title, message, type, link)
    VALUES (
      v_app.helper_id, OLD.id,
      'A job you applied to changed',
      format('The person who posted "%s" changed %s. Check it still works for you.', COALESCE(NEW.title, 'the job'), v_what),
      'job_updates',
      '/jobs/' || OLD.id::text
    );
    v_sent := v_sent + 1;
  END LOOP;
  -- The hour is used only when someone was told (F4): an applicant who arrives later still hears the next edit.
  IF v_sent > 0 THEN
    NEW.last_edit_notice_at := now();
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_open_edit_tells_applicants() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jobs_open_edit_tells_applicants ON public.jobs;
CREATE TRIGGER trg_jobs_open_edit_tells_applicants
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_open_edit_tells_applicants();
