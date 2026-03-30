
-- Add revision deadline tracking columns
ALTER TABLE public.jobs 
  ADD COLUMN IF NOT EXISTS revision_deadline timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS revision_completed_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS revision_acceptance_deadline timestamp with time zone DEFAULT NULL;

-- Trigger to auto-set revision_deadline when status changes to revision_requested
CREATE OR REPLACE FUNCTION public.set_revision_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'revision_requested' AND (OLD.status IS NULL OR OLD.status != 'revision_requested') THEN
    NEW.revision_deadline := now() + interval '72 hours';
    NEW.revision_completed_at := NULL;
    NEW.revision_acceptance_deadline := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER set_revision_deadline_trigger
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_revision_deadline();
