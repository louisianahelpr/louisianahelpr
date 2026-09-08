-- Every error_logs row posts to Slack — owner, 2026-09-07: "slack should
-- fire no matter how big or small the error is. any error."
--
-- Until now only the critical classes (disputes, fraud flags, payout
-- failures, webhook errors, dead crons) reached #ops-alerts; client errors
-- and warnings went to Sentry and error_logs only, and the owner learned
-- about an afternoon of them from Sentry's digest emails. This trigger
-- makes error_logs itself the alarm: an AFTER INSERT on every row, posted
-- through the same slack-ops-alert edge function and the same vault
-- secrets the eight cron watchers already use, so there is one Slack path
-- to keep alive rather than two.
--
-- One guard, because a burst is a real thing (ten "socket closed: 1006"
-- rows in a minute this afternoon): an IDENTICAL message within a 10-minute
-- window is not re-posted. Distinct messages always post. The suppressed
-- rows are still in error_logs — the dedupe reads that table, no new table,
-- nothing to sweep.
--
-- Fire-and-forget: net.http_post enqueues; the insert never waits on Slack
-- and never fails because of it (EXCEPTION WHEN OTHERS swallows a vault or
-- pg_net hiccup — the row is the record, the post is a courtesy).

CREATE OR REPLACE FUNCTION public.notify_slack_on_error_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent int;
  v_title  text;
  v_sev    text;
  v_source text;
BEGIN
  -- Identical message already posted in the last 10 minutes → count only.
  SELECT count(*) INTO v_recent
  FROM public.error_logs e
  WHERE e.message = NEW.message
    AND e.id <> NEW.id
    AND e.created_at > now() - interval '10 minutes';
  IF v_recent > 0 THEN
    RETURN NEW;
  END IF;

  v_sev    := CASE WHEN NEW.severity IN ('critical','error','warning','info') THEN NEW.severity ELSE 'error' END;
  v_source := COALESCE(NEW.tags ->> 'source', NEW.tags ->> 'area', 'app');
  v_title  := left(format('[%s] %s', v_source, NEW.message), 140);

  BEGIN
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
             || '/functions/v1/slack-ops-alert',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'kind', 'custom',
        'severity', v_sev,
        'title', v_title,
        'message', left(COALESCE(NEW.message, ''), 900),
        'fields', jsonb_build_object(
          'url', COALESCE(NEW.url, '—'),
          'user', COALESCE(NEW.user_id::text, 'anon'),
          'tags', COALESCE(NEW.tags::text, '{}'),
          'error_logs.id', NEW.id::text),
        'link', '/admin?view=health'));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_slack_on_error_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_error_logs_slack ON public.error_logs;
CREATE TRIGGER trg_error_logs_slack
  AFTER INSERT ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.notify_slack_on_error_log();

COMMENT ON TRIGGER trg_error_logs_slack ON public.error_logs IS
  'Owner 2026-09-07: every error posts to Slack. An identical message within 10 min posts once.';
