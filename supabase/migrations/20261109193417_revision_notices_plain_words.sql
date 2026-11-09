-- F192 + F193 (owner UI audit 11-09, Part 3 message review; lead: wording only, no logic changes). After a 3rd change
-- request the person who posted read "⚠️ Scope creep detected" (jargon, an emoji, an accusing tone) and the Helpr
-- "⚠️ Multiple revisions on this job ... Admins have been notified." with no next step. Both now say what happened
-- and what they can do, and name the people who settle problems "our team" (F193's one phrase).
--
-- The body below is the LIVE definition (pg_get_functiondef on prod, 11-09, md5 9fc60f123cc2cd78679aa86b8f039100)
-- with ONLY the two member notices' titles and messages changed: the count, the 3+ threshold, the staff fraud flag,
-- the links and types are unchanged. Replay-safe: CREATE OR REPLACE; REVOKE/GRANT restated (live proacl
-- {postgres=X/postgres,service_role=X/postgres}).
-- Proof: src/test/pglite/revisionNoticeWording.pglite.mjs (3x replay; --before red).

CREATE OR REPLACE FUNCTION public.track_revision_scope_creep()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
      VALUES (
        NEW.customer_id,
        'Several changes asked on this job',
        'You''ve asked for ' || NEW.revision_count || ' changes on "' || NEW.title || '". If it still isn''t right, you can approve the work or ask our team to step in.',
        'warning',
        '/posts?job=' || NEW.id::text,
        NEW.id
      );

      IF NEW.helper_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.helper_id,
          'Several changes asked on your job',
          NEW.revision_count || ' changes were asked on "' || NEW.title || '". Our team can see this and will step in if needed. Keep messages in the app.',
          'warning',
          '/jobs?job=' || NEW.id::text,
          NEW.id
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

REVOKE ALL ON FUNCTION public.track_revision_scope_creep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_revision_scope_creep() TO service_role;
