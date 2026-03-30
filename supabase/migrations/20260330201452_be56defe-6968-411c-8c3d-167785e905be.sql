
-- Add dispute_deadline column to jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS dispute_deadline timestamp with time zone DEFAULT NULL;

-- Create trigger to auto-set dispute_deadline when job becomes disputed
CREATE OR REPLACE FUNCTION public.set_dispute_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'disputed' AND (OLD.status IS NULL OR OLD.status != 'disputed') THEN
    NEW.dispute_deadline := NEW.disputed_at + interval '72 hours';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_dispute_deadline
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_dispute_deadline();
