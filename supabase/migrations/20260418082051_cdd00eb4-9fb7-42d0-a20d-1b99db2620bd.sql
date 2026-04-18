-- Add revision counter to jobs
ALTER TABLE public.jobs
ADD COLUMN IF NOT EXISTS revision_count integer NOT NULL DEFAULT 0;

-- Trigger: increment revision_count + auto-flag scope creep when threshold crossed
CREATE OR REPLACE FUNCTION public.track_revision_scope_creep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Detect a NEW revision request (transition into revision_requested)
  IF NEW.status = 'revision_requested'
     AND (OLD.status IS DISTINCT FROM 'revision_requested') THEN
    NEW.revision_count := COALESCE(OLD.revision_count, 0) + 1;

    -- Flag scope creep at 3+ revisions
    IF NEW.revision_count >= 3 THEN
      INSERT INTO public.fraud_flags (user_id, flag_type, details, job_id)
      VALUES (
        NEW.customer_id,
        'scope_creep',
        'Job "' || NEW.title || '" has been revised ' || NEW.revision_count || ' times. Possible scope creep or dispute brewing.',
        NEW.id
      );

      -- Notify both parties + admins via in-app notification
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (
        NEW.customer_id,
        '⚠️ Scope creep detected',
        'You''ve requested ' || NEW.revision_count || ' revisions on "' || NEW.title || '". Repeated revisions may signal unclear scope — consider a dispute or accepting the work.',
        'warning',
        '/my-posts'
      );

      IF NEW.helper_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (
          NEW.helper_id,
          '⚠️ Multiple revisions on this job',
          'The poster has requested ' || NEW.revision_count || ' revisions on "' || NEW.title || '". Admins have been notified.',
          'warning',
          '/my-jobs'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_track_revision_scope_creep ON public.jobs;
CREATE TRIGGER jobs_track_revision_scope_creep
BEFORE UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.track_revision_scope_creep();