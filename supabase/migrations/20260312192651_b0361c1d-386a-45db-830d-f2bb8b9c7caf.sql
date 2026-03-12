-- Update notify_on_application to also enqueue notification emails
CREATE OR REPLACE FUNCTION public.notify_on_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_pref_col TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;
  
  -- New application: notify job owner
  IF TG_OP = 'INSERT' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    v_message := 'Someone applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/dashboard';
    
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);
    
    -- Check if user wants email for this type
    SELECT email_job_applications INTO v_email_enabled 
    FROM public.notification_preferences WHERE user_id = v_user_id;
    
    IF v_email_enabled IS TRUE THEN
      SELECT email, full_name INTO v_profile FROM public.profiles WHERE user_id = v_user_id;
      IF v_profile.email IS NOT NULL THEN
        PERFORM net.http_post(
          url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-notification-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
          ),
          body := jsonb_build_object(
            'user_id', v_user_id,
            'title', v_title,
            'message', v_message,
            'type', v_type,
            'link', v_link
          )
        );
      END IF;
    END IF;
  END IF;
  
  -- Application accepted: notify helper
  IF TG_OP = 'UPDATE' AND NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    v_user_id := NEW.helper_id;
    v_title := 'Application accepted!';
    v_message := 'You were accepted for "' || job_title || '"';
    v_type := 'success';
    v_link := '/dashboard';
    
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);
    
    SELECT email_job_applications INTO v_email_enabled 
    FROM public.notification_preferences WHERE user_id = v_user_id;
    
    IF v_email_enabled IS TRUE THEN
      PERFORM net.http_post(
        url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id,
          'title', v_title,
          'message', v_message,
          'type', v_type,
          'link', v_link
        )
      );
    END IF;
  END IF;
  
  -- Application rejected: notify helper
  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    v_message := 'Your application for "' || job_title || '" was not selected';
    v_type := 'info';
    v_link := '/dashboard';
    
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);
    
    SELECT email_job_applications INTO v_email_enabled 
    FROM public.notification_preferences WHERE user_id = v_user_id;
    
    IF v_email_enabled IS TRUE THEN
      PERFORM net.http_post(
        url := current_setting('app.settings.supabase_url', true) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id,
          'title', v_title,
          'message', v_message,
          'type', v_type,
          'link', v_link
        )
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;