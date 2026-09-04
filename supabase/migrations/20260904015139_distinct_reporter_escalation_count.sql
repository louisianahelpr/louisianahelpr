-- auto_escalate_reports counted rows, not people. One account filing three
-- reports against the same target flagged them to every admin, with no
-- distinct-reporter requirement anywhere in the query. Proven live
-- 2026-09-03: a single non-banned account filing 3 reports produced 13
-- "User flagged — 3+ reports" admin notifications.
--
-- The tempting fix — ban-gate the reports table so a banned user can't pull
-- this lever — was deliberately rejected. 20260903030936 already made the
-- call that reports and disputes stay open to banned users on purpose: a
-- banned account can still be the victim of harassment, and cutting off
-- their only path to flag it is its own safety failure. Gating INSERT on
-- `reports` would also do nothing for the actual bug, since the lever works
-- identically for a non-banned account.
--
-- The real fix is one word: COUNT(DISTINCT reporter_id) instead of
-- COUNT(*). That closes the brigading lever for every account, banned or
-- not, while `reports` itself stays reachable to anyone who needs to use it.
-- reporter_id is nullable (ON DELETE SET NULL), and COUNT(DISTINCT) ignores
-- NULLs, so reports from since-deleted accounts stop counting toward
-- escalation — the right behavior, since there's no live agent to weight.
--
-- Folded in while touching this function: the notification link still wrote
-- the dead `/admin/users/%s` format. 20260831232514 corrected every existing
-- row to `/admin?view=people&user=%s` but never re-pointed the function that
-- generates new ones, so every escalation since then has kept writing a
-- broken link. Same fix, same file, no reason to leave it for a second pass.

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
    SELECT COUNT(DISTINCT r.reporter_id)
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
        AND n.link = format('/admin?view=people&user=%s', NEW.reported_id)
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
      format('%s has %s distinct reporters in the last 90 days. Review the account.', COALESCE(user_label, 'A user'), open_count),
      format('/admin?view=people&user=%s', NEW.reported_id),
      false
    FROM public.user_roles ur
    WHERE ur.role = 'admin';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'auto_escalate_reports failed for report %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;
