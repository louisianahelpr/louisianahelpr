-- A Helpr whose job was cancelled by the poster received TWO "Job cancelled"
-- notifications at the same timestamp (verified in prod, 2026-09-08 12:22:57):
--
--   1. from poster_cancel_job — specific: names the fee outcome ("more than
--      24 hours out, so no cancellation fee applies" / "you'll receive
--      approximately $X");
--   2. from the notify_on_job_update trigger — generic: "has been cancelled
--      by the poster", fired by the same UPDATE, unaware that (1) exists.
--
-- Owner decision 2026-09-08: keep (1). Every sanctioned cancel path — the
-- poster RPC and the block-cancels-the-job path — already sets the
-- transaction-local GUC `app.sanctioned_cancel` to 'on' around its UPDATE
-- (that is how trg_cancellation_requires_rpc lets the write through), and
-- both write their own, better, notification. The trigger therefore skips
-- its cancel branch while that GUC is on, and keeps it for any other route
-- to 'cancelled' (admin/service-role writes, which send nothing of their own).
-- The completed branch is unchanged.

CREATE OR REPLACE FUNCTION public.notify_on_job_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status = 'in_progress' AND NEW.helper_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.helper_id, 'Job completed!', '"' || NEW.title || '" has been marked complete. Payment is being processed.', 'payment', '/my-jobs?job=' || NEW.id::text);
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' AND OLD.helper_id IS NOT NULL
     AND COALESCE(current_setting('app.sanctioned_cancel', true), '') <> 'on' THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (OLD.helper_id, 'Job cancelled', '"' || OLD.title || '" has been cancelled by the poster.', 'warning', '/my-jobs?job=' || OLD.id::text);
  END IF;

  RETURN NEW;
END;
$function$;

-- Unchanged from prod (pg_proc.proacl: postgres, service_role, authenticated;
-- anon and PUBLIC already absent). Restated so the lint gate sees it.
REVOKE ALL ON FUNCTION public.notify_on_job_update() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_on_job_update() TO authenticated, service_role;
