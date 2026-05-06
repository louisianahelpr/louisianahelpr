-- Auto-escalate reports against users (notification fan-out to admins).
-- The companion auto-restrict trigger (3 upheld violations →
-- final_warning, 5 → 7-day temp_ban) lives in
-- docs/proposed/auto_restrict_repeat_violators.sql — applying it touches
-- real ban_status and needs owner sign-off on the thresholds first.

CREATE OR REPLACE FUNCTION public.auto_escalate_reports()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  open_count integer;
  user_label text;
BEGIN
  IF NEW.reported_type IS DISTINCT FROM 'user' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT COUNT(*)
    INTO open_count
    FROM public.reports r
    WHERE r.reported_type = 'user'
      AND r.reported_id = NEW.reported_id
      AND r.created_at > NOW() - INTERVAL '90 days'
      AND COALESCE(r.status, 'open') NOT IN ('dismissed', 'invalid', 'resolved');

    IF open_count < 3 THEN
      RETURN NEW;
    END IF;

    -- Carpet-bomb prevention: if any admin already got an unread
    -- notification for this reported_id in the last 7 days, skip the
    -- fan-out so we don't spam every admin every time a flagged user
    -- gets another report.
    IF EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.type = 'system_alert'
        AND n.created_at > NOW() - INTERVAL '7 days'
        AND n.link = format('/admin/users/%s', NEW.reported_id)
    ) THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(NULLIF(full_name, ''), email, 'unknown user')
    INTO user_label
    FROM public.profiles
    WHERE user_id = NEW.reported_id;

    INSERT INTO public.notifications (user_id, type, title, message, link, read)
    SELECT
      ur.user_id,
      'system_alert',
      'User flagged — 3+ reports',
      format('%s has %s open reports in the last 90 days. Review the account.', COALESCE(user_label, 'A user'), open_count),
      format('/admin/users/%s', NEW.reported_id),
      false
    FROM public.user_roles ur
    WHERE ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_escalate_reports failed for report %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_escalate_reports_tg ON public.reports;
CREATE TRIGGER auto_escalate_reports_tg
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.auto_escalate_reports();
