CREATE OR REPLACE FUNCTION public.validate_job_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.budget < 5 THEN
    RAISE EXCEPTION 'Minimum budget is $5';
  END IF;
  IF NEW.budget > 5000 THEN
    RAISE EXCEPTION 'Maximum budget is $5000';
  END IF;
  RETURN NEW;
END;
$function$;