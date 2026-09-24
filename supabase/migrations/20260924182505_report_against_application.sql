-- Q366 (owner MQ12, 2026-09-24; TS-006): a poster can report an APPLICATION
-- from the applicant card, typed against the application itself
-- (reported_type = 'application', reported_id = applications.id), so the admin
-- queue sees which pitch was the scam instead of a bare 'user' report.
--
-- Two layers change here:
--   1. reports_reported_type_check admits 'application' (the client insert is
--      refused with 23514 without it).
--   2. auto_escalate_reports counts an application report against the
--      APPLICANT'S account. A report filed from the applicant card must weigh
--      the same as one filed from their profile; otherwise the new, easier
--      path would be the weaker one and a scammer spamming applications would
--      never reach the 3-reporter admin alert.
-- Replay-safe: the constraint is dropped IF EXISTS and re-added; the function
-- is CREATE OR REPLACE.

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reported_type_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reported_type_check
  CHECK (reported_type = ANY (ARRAY['job'::text, 'message'::text, 'user'::text, 'support'::text, 'review'::text, 'application'::text]));

CREATE OR REPLACE FUNCTION public.auto_escalate_reports()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  open_count integer;
  user_label text;
  v_subject uuid;
BEGIN
  -- The account this report is about: the user itself, or the applicant
  -- behind an application (Q366).
  IF NEW.reported_type = 'user' THEN
    v_subject := NEW.reported_id;
  ELSIF NEW.reported_type = 'application' THEN
    SELECT a.helper_id INTO v_subject FROM public.applications a WHERE a.id = NEW.reported_id;
  END IF;
  IF v_subject IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT COUNT(DISTINCT r.reporter_id)
    INTO open_count
    FROM public.reports r
    WHERE r.created_at > NOW() - INTERVAL '90 days'
      AND COALESCE(r.status, 'open') NOT IN ('dismissed', 'invalid', 'resolved')
      AND (
        (r.reported_type = 'user' AND r.reported_id = v_subject)
        OR (r.reported_type = 'application'
            AND r.reported_id IN (SELECT a.id FROM public.applications a WHERE a.helper_id = v_subject))
      );

    IF open_count < 3 THEN
      RETURN NEW;
    END IF;

    -- Carpet-bomb prevention: if any admin already got an unread
    -- notification for this account in the last 7 days, skip the
    -- fan-out so we don't spam every admin every time a flagged user
    -- gets another report.
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.type = 'system_alert'
        AND n.created_at > NOW() - INTERVAL '7 days'
        AND n.link = format('/admin?view=people&user=%s', v_subject)
    ) THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(NULLIF(full_name, ''), email, 'unknown user')
    INTO user_label
    FROM public.profiles
    WHERE user_id = v_subject;

    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    SELECT
      ur.user_id,
      'system_alert',
      'User flagged — 3+ reports',
      format('%s has %s distinct reporters in the last 90 days. Review the account.', COALESCE(user_label, 'A user'), open_count),
      format('/admin?view=people&user=%s', v_subject),
      false
    FROM public.user_roles ur
    WHERE ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_escalate_reports failed for report %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;
