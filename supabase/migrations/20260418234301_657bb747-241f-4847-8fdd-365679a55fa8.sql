-- 1. Backfill: any customer who is "approved" but hasn't verified email reverts to pending.
--    Helpers are not affected (they have their own approval flow via IDV / manual review).
UPDATE public.profiles
   SET approval_status = 'pending'
 WHERE role = 'customer'
   AND approval_status = 'approved'
   AND email_verified = false;

-- 2. Update the email-verification sync trigger so that when a customer's email
--    becomes verified, they are automatically promoted to 'approved'.
--    Helpers are intentionally NOT auto-approved here — they still go through the
--    existing IDV / admin review flow.
CREATE OR REPLACE FUNCTION public.sync_email_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only act when the verification state actually changes
  IF (OLD.email_confirmed_at IS NULL) IS DISTINCT FROM (NEW.email_confirmed_at IS NULL) THEN
    UPDATE public.profiles
       SET email_verified = (NEW.email_confirmed_at IS NOT NULL),
           -- Auto-approve customers the moment they verify their email.
           -- Helpers keep whatever approval_status they currently have.
           approval_status = CASE
             WHEN NEW.email_confirmed_at IS NOT NULL
              AND role = 'customer'
              AND approval_status = 'pending'
             THEN 'approved'
             ELSE approval_status
           END
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Same logic for the INSERT-time sync (handles the rare case where a user
--    is created already-confirmed, e.g. admin-created accounts).
CREATE OR REPLACE FUNCTION public.sync_email_verified_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.profiles
       SET email_verified = true,
           approval_status = CASE
             WHEN role = 'customer' AND approval_status = 'pending'
             THEN 'approved'
             ELSE approval_status
           END
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;