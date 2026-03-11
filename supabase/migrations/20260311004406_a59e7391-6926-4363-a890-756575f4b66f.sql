
-- Notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'job_update', 'application', 'review', 'payment')),
  read BOOLEAN NOT NULL DEFAULT false,
  link TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Trigger function to create notifications on application status change
CREATE OR REPLACE FUNCTION public.notify_on_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job_title TEXT;
  job_owner UUID;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;
  
  -- New application: notify job owner
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (job_owner, 'New application', 'Someone applied to "' || job_title || '"', 'application', '/dashboard');
  END IF;
  
  -- Application accepted: notify helper
  IF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Application accepted!', 'You were accepted for "' || job_title || '"', 'success', '/dashboard');
  END IF;
  
  -- Application rejected: notify helper
  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Application update', 'Your application for "' || job_title || '" was not selected', 'info', '/dashboard');
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_application_change
  AFTER INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_application();

-- Trigger function to notify on job status change
CREATE OR REPLACE FUNCTION public.notify_on_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Job completed: notify helper
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Job completed!', '"' || NEW.title || '" has been marked complete. Payment is being processed.', 'payment', '/earnings');
  END IF;
  
  -- Job cancelled: notify helper if assigned
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.helper_id, 'Job cancelled', '"' || OLD.title || '" has been cancelled by the poster.', 'warning', '/dashboard');
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_job_status_change
  AFTER UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_update();
