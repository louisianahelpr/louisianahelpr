CREATE OR REPLACE FUNCTION public.notify_on_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;
  
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (job_owner, 'New application', 'Someone applied to "' || job_title || '"', 'application', '/activity?tab=posted&filter=open');
  END IF;
  
  IF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Application accepted!', 'You were accepted for "' || job_title || '"', 'success', '/activity?tab=applied&filter=offered');
  END IF;
  
  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Application update', 'Your application for "' || job_title || '" was not selected', 'info', '/activity?tab=applied&filter=not_selected');
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_on_job_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Job completed!', '"' || NEW.title || '" has been marked complete. Payment is being processed.', 'payment', '/activity?tab=applied&filter=completed');
  END IF;
  
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.helper_id, 'Job cancelled', '"' || OLD.title || '" has been cancelled by the poster.', 'warning', '/activity?tab=applied&filter=not_selected');
  END IF;
  
  RETURN NEW;
END;
$function$;