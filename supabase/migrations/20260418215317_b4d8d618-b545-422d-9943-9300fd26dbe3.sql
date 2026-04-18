-- 1. Expand notification_preferences with granular categories
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS new_offers boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_new_offers boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transit_updates boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_transit_updates boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS work_status boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_work_status boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS financial_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_financial_alerts boolean NOT NULL DEFAULT true;

-- Backfill new toggles from legacy fields so existing users keep their preferences
UPDATE public.notification_preferences
SET
  new_offers = COALESCE(job_applications, true),
  email_new_offers = COALESCE(email_job_applications, true),
  transit_updates = COALESCE(job_updates, true),
  email_transit_updates = COALESCE(email_job_updates, false),
  work_status = COALESCE(job_updates, true),
  email_work_status = COALESCE(email_job_updates, true),
  financial_alerts = COALESCE(payments, true),
  email_financial_alerts = COALESCE(email_payments, true)
WHERE TRUE;

-- 2. Notification logs table for unified admin observability
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recipient_email text,
  category text NOT NULL,            -- new_offers | transit_updates | work_status | financial_alerts | reviews | system
  channel text NOT NULL,             -- in_app | email
  status text NOT NULL DEFAULT 'sent', -- sent | failed | suppressed | skipped
  subject text,
  job_id uuid,
  error_message text,
  message_id text,                   -- correlates to email_send_log
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_logs_user_idx ON public.notification_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_logs_status_idx ON public.notification_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_logs_category_idx ON public.notification_logs(category, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_logs_email_idx ON public.notification_logs(recipient_email);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view all notification logs"
ON public.notification_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role inserts notification logs"
ON public.notification_logs FOR INSERT TO authenticated
WITH CHECK (false); -- only service role bypasses RLS; users never insert directly

-- 3. Helper function used by triggers + edge funcs to record + respect prefs
CREATE OR REPLACE FUNCTION public.log_notification(
  _user_id uuid,
  _category text,
  _channel text,
  _status text,
  _subject text DEFAULT NULL,
  _job_id uuid DEFAULT NULL,
  _error text DEFAULT NULL,
  _message_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE user_id = _user_id;
  INSERT INTO public.notification_logs (
    user_id, recipient_email, category, channel, status, subject, job_id, error_message, message_id
  ) VALUES (
    _user_id, v_email, _category, _channel, _status, _subject, _job_id, _error, _message_id
  );
END;
$$;

-- 4. Trigger: notify Poster when Helper updates status (transit + work_status)
CREATE OR REPLACE FUNCTION public.notify_poster_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_helper_name text;
  v_category text;
  v_title text;
  v_msg text;
  v_pref_in_app boolean;
  v_link text;
BEGIN
  IF NEW.helper_id IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_link := '/my-posts?job=' || NEW.id::text;
  SELECT COALESCE(full_name, 'Your helper') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := '🚗 ' || v_helper_name || ' is on the way';
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '"';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := '📍 ' || v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '"';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    v_title := '🛠️ Work has started';
    v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := '✅ ' || v_helper_name || ' marked the job complete';
    v_msg := v_helper_name || ' has finished "' || NEW.title || '". Please review and confirm.';

  ELSE
    RETURN NEW;
  END IF;

  -- Check in-app pref for poster
  SELECT
    CASE v_category
      WHEN 'transit_updates' THEN COALESCE(transit_updates, true)
      WHEN 'work_status' THEN COALESCE(work_status, true)
      ELSE true
    END INTO v_pref_in_app
  FROM public.notification_preferences WHERE user_id = NEW.customer_id;

  IF COALESCE(v_pref_in_app, true) THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (NEW.customer_id, v_title, v_msg, v_category, v_link);
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'sent', v_title, NEW.id);
  ELSE
    PERFORM public.log_notification(NEW.customer_id, v_category, 'in_app', 'skipped', v_title, NEW.id, 'preference_off');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_poster_status ON public.jobs;
CREATE TRIGGER trg_notify_poster_status
AFTER UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.notify_poster_on_status_change();

-- 5. Trigger: notify Poster when payment escrowed (escrow status reached)
CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow') THEN
    v_title := '🔒 Payment secured in escrow';
    v_msg := 'Your payment for "' || NEW.title || '" is safely held in escrow and will release after the job is completed.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.customer_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id, v_title, v_msg, 'financial_alerts', '/my-posts?job=' || NEW.id::text);
      PERFORM public.log_notification(NEW.customer_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.id);
    END IF;

    -- Also notify helper their job is funded
    IF NEW.helper_id IS NOT NULL THEN
      SELECT COALESCE(financial_alerts, true) INTO v_pref
      FROM public.notification_preferences WHERE user_id = NEW.helper_id;
      IF COALESCE(v_pref, true) THEN
        INSERT INTO public.notifications (user_id, title, message, type, link)
        VALUES (NEW.helper_id, '💰 Job funded', 'Payment for "' || NEW.title || '" is now in escrow. Get to work!', 'financial_alerts', '/my-jobs?job=' || NEW.id::text);
        PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Job funded', NEW.id);
      END IF;
    END IF;
  END IF;

  -- Payout released
  IF NEW.payment_status = 'released' AND OLD.payment_status IS DISTINCT FROM 'released' AND NEW.helper_id IS NOT NULL THEN
    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;
    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.helper_id, '💵 Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/earnings');
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_escrowed ON public.jobs;
CREATE TRIGGER trg_notify_payment_escrowed
AFTER UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_payment_escrowed();

-- 6. Trigger: notify helper when tip received
CREATE OR REPLACE FUNCTION public.notify_helper_on_tip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_job_title text;
BEGIN
  IF NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
    v_title := '🎁 You got a $' || NEW.amount || ' tip!';
    v_msg := 'A poster left you a $' || NEW.amount || ' tip for "' || COALESCE(v_job_title, 'your work') || '". Thanks for going above and beyond.';

    SELECT COALESCE(financial_alerts, true) INTO v_pref
    FROM public.notification_preferences WHERE user_id = NEW.helper_id;

    IF COALESCE(v_pref, true) THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.helper_id, v_title, v_msg, 'financial_alerts', '/earnings');
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', v_title, NEW.job_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_helper_tip ON public.tips;
CREATE TRIGGER trg_notify_helper_tip
AFTER INSERT OR UPDATE ON public.tips
FOR EACH ROW
EXECUTE FUNCTION public.notify_helper_on_tip();