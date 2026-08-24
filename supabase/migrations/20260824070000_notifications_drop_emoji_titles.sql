-- Emoji leaves the notification titles (settled rule: emoji banned from
-- system copy — and the panel already renders a leading icon per row, so an
-- emoji title doubled the glyph). Also 'Your helper' → 'Your Helpr': the
-- canonical brand noun reaches the one fallback that narrated the other
-- party in lowercase. Bodies are otherwise byte-identical to the live prod
-- definitions (pulled via pg_get_functiondef 2026-08-24 and transformed
-- server-side, so nothing else drifts). Eight functions carry user-facing
-- titles; the four trigger-notify functions are here, the remaining four
-- (job-post fan-out, saved-search fan-out, credential/business review)
-- follow below.

CREATE OR REPLACE FUNCTION public.notify_helper_on_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_poster_name text;
BEGIN
  IF NEW.offered_to_helper_id IS NOT NULL
     AND NEW.direct_offer_status = 'pending'
     AND (TG_OP = 'INSERT' OR OLD.offered_to_helper_id IS DISTINCT FROM NEW.offered_to_helper_id)
  THEN
    SELECT COALESCE(full_name, 'A poster') INTO v_poster_name
      FROM public.profiles WHERE user_id = NEW.customer_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      NEW.offered_to_helper_id,
      'You got a direct job offer!',
      v_poster_name || ' offered you a job: "' || NEW.title || '" for $' || NEW.budget,
      'new_offers',
      '/activity?tab=offers'
    );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_helper_on_tip()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
  v_job_title text;
BEGIN
  IF NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    SELECT title INTO v_job_title FROM public.jobs WHERE id = NEW.job_id;
    v_title := 'You got a $' || NEW.amount || ' tip!';
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
$function$
;

CREATE OR REPLACE FUNCTION public.notify_on_payment_escrowed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pref boolean;
  v_title text;
  v_msg text;
BEGIN
  IF NEW.payment_status = 'escrow' AND (OLD.payment_status IS DISTINCT FROM 'escrow') THEN
    v_title := 'Payment secured in escrow';
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
        VALUES (NEW.helper_id, 'Job funded', 'Payment for "' || NEW.title || '" is now in escrow. Get to work!', 'financial_alerts', '/my-jobs?job=' || NEW.id::text);
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
      VALUES (NEW.helper_id, 'Payout released', 'Your payout for "' || NEW.title || '" has been released to your account.', 'financial_alerts', '/earnings');
      PERFORM public.log_notification(NEW.helper_id, 'financial_alerts', 'in_app', 'sent', 'Payout released', NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_poster_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  SELECT COALESCE(full_name, 'Your Helpr') INTO v_helper_name
  FROM public.profiles WHERE user_id = NEW.helper_id;

  -- Helper on the way
  IF NEW.helper_on_the_way_at IS DISTINCT FROM OLD.helper_on_the_way_at AND NEW.helper_on_the_way_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' is on the way';
    v_msg := v_helper_name || ' is heading to your job: "' || NEW.title || '"';

  -- Helper arrived
  ELSIF NEW.helper_arrived_at IS DISTINCT FROM OLD.helper_arrived_at AND NEW.helper_arrived_at IS NOT NULL THEN
    v_category := 'transit_updates';
    v_title := v_helper_name || ' has arrived';
    v_msg := v_helper_name || ' has arrived for "' || NEW.title || '"';

  -- Helper started working (status -> in_progress)
  ELSIF NEW.status = 'in_progress'::job_status AND OLD.status IS DISTINCT FROM 'in_progress'::job_status THEN
    v_category := 'work_status';
    v_title := 'Work has started';
    v_msg := v_helper_name || ' has started working on "' || NEW.title || '"';

  -- Helper marked completed
  ELSIF NEW.helper_completed_at IS DISTINCT FROM OLD.helper_completed_at AND NEW.helper_completed_at IS NOT NULL THEN
    v_category := 'work_status';
    v_title := v_helper_name || ' marked the job complete';
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
$function$
;

CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  FOR helper_record IN
    SELECT DISTINCT hpp.helper_id
    FROM public.helper_preferred_parishes hpp
    JOIN public.profiles p ON p.user_id = hpp.helper_id
    WHERE hpp.parish = NEW.parish
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND hpp.helper_id <> NEW.customer_id
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', helper_record.helper_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_saved_searches_on_new_job()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  match_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
  v_is_urgent BOOLEAN;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  v_is_urgent := COALESCE(NEW.is_urgent, false);
  v_title := 'New job matches your saved search';
  v_link  := '/dashboard?job=' || NEW.id::text;

  -- One row per matching helper. matched_search_ids collects every saved
  -- search that fired for that helper so we can update their throttle
  -- timestamps, and search_name gives a concrete name for the message
  -- (the most recently created matching search wins the headline).
  --
  -- saved_searches is opt-in (the user explicitly created the search), so
  -- no role gate — just approved + not banned + not the poster.
  FOR match_record IN
    SELECT
      s.user_id,
      (ARRAY_AGG(s.name ORDER BY s.created_at DESC))[1] AS search_name,
      ARRAY_AGG(s.id)                                   AS matched_search_ids,
      COALESCE(BOOL_OR(np.match_digest_mode), false)    AS digest_mode
    FROM public.saved_searches s
    JOIN public.profiles p ON p.user_id = s.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = s.user_id
    WHERE s.notify_enabled = true
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND s.user_id <> NEW.customer_id
      AND (s.category IS NULL OR s.category = NEW.category::text)
      AND (s.parish IS NULL OR s.parish = NEW.parish)
      AND (s.max_budget IS NULL OR NEW.budget <= s.max_budget)
      AND (s.min_budget IS NULL OR NEW.budget >= s.min_budget)
      AND (
        s.location_keyword IS NULL
        OR NEW.location ILIKE '%' || s.location_keyword || '%'
      )
      -- Throttle: skip a search notified within the last hour. Applied
      -- per-search; a helper with one hot search and one cold one still
      -- gets pinged via the cold one.
      AND (s.last_notified_at IS NULL OR s.last_notified_at < now() - interval '1 hour')
    GROUP BY s.user_id
  LOOP
    -- Stamp every search that contributed to this match so each one's
    -- own 1-hour throttle window resets.
    UPDATE public.saved_searches
       SET last_notified_at = now()
     WHERE id = ANY(match_record.matched_search_ids);

    IF match_record.digest_mode AND NOT v_is_urgent THEN
      -- Digest-mode helper, non-urgent job: park the match in the queue
      -- the daily-match-digest function drains. Idempotent on
      -- (user_id, job_id) — a re-fire for the same job is a no-op.
      INSERT INTO public.match_digest_queue (user_id, job_id)
      VALUES (match_record.user_id, NEW.id)
      ON CONFLICT (user_id, job_id) DO NOTHING;
    ELSE
      -- Immediate path: one notification for the whole job. The
      -- notifications_fan_out_to_push trigger handles native push and
      -- honors the user's push_enabled + per-category preference, so we
      -- do not gate push here.
      v_message :=
        'A new job matches "' || match_record.search_name || '": '
        || NEW.title || ' ($' || NEW.budget || ')'
        || CASE WHEN v_is_urgent THEN ' · Urgent' ELSE '' END;

      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (match_record.user_id, v_title, v_message, 'job_match', v_link);

      -- Email fan-out — same vault-secret pattern as the other notify
      -- triggers. send-notification-email checks the user's email prefs.
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', match_record.user_id,
          'title', v_title,
          'message', v_message,
          'type', 'job_match',
          'link', v_link
        )
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.review_business_verification(_business_id uuid, _decision text, _rejection_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins may review business verifications';
  END IF;

  IF _decision NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be verified or rejected';
  END IF;

  UPDATE public.businesses
     SET verification_status = _decision,
         verification_reviewed_at = now(),
         verification_reviewed_by = auth.uid(),
         verification_rejection_reason = CASE WHEN _decision = 'rejected' THEN _rejection_reason ELSE NULL END
   WHERE id = _business_id;

  -- Log
  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    auth.uid(),
    'business_verification_' || _decision,
    _business_id::text,
    'business',
    jsonb_build_object('reason', _rejection_reason)
  );

  -- Notify owner
  INSERT INTO public.notifications (user_id, title, message, type, link)
  SELECT
    b.owner_id,
    CASE WHEN _decision = 'verified' THEN 'Business verified!' ELSE 'Business verification rejected' END,
    CASE WHEN _decision = 'verified'
         THEN 'Your business "' || b.name || '" is now verified. The Verified Business badge is live on your team profiles.'
         ELSE 'Your business "' || b.name || '" was not verified. Reason: ' || COALESCE(_rejection_reason, 'No reason provided') || '. Please re-upload a valid document.'
    END,
    'system_alert',
    '/business-team'
  FROM public.businesses b
  WHERE b.id = _business_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.review_credential(_user_id uuid, _credential text, _decision text, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins may review credentials';
  END IF;
  IF _credential NOT IN ('license','insurance') THEN
    RAISE EXCEPTION 'Invalid credential type';
  END IF;
  IF _decision NOT IN ('verified','rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  IF _credential = 'license' THEN
    UPDATE public.profiles
       SET license_status = _decision,
           license_reviewed_at = now(),
           license_reviewed_by = auth.uid(),
           license_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _user_id,
      CASE WHEN _decision = 'verified' THEN 'License verified' ELSE 'License needs attention' END,
      CASE WHEN _decision = 'verified'
        THEN 'Your professional license has been verified. The Licensed badge is now live on your profile.'
        ELSE 'Your license could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
      END,
      CASE WHEN _decision = 'verified' THEN 'success' ELSE 'warning' END,
      '/profile'
    );
  ELSE
    UPDATE public.profiles
       SET insurance_status = _decision,
           insurance_reviewed_at = now(),
           insurance_reviewed_by = auth.uid(),
           insurance_rejection_reason = CASE WHEN _decision = 'rejected' THEN _reason ELSE NULL END
     WHERE user_id = _user_id;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _user_id,
      CASE WHEN _decision = 'verified' THEN 'Insurance verified' ELSE 'Insurance needs attention' END,
      CASE WHEN _decision = 'verified'
        THEN 'Your Certificate of Insurance has been verified. The Insured badge is now live on your profile.'
        ELSE 'Your insurance document could not be verified' || COALESCE(': ' || _reason, '.') || ' Please re-upload a clearer document.'
      END,
      CASE WHEN _decision = 'verified' THEN 'success' ELSE 'warning' END,
      '/profile'
    );
  END IF;

  INSERT INTO public.admin_audit_log (admin_id, action, target_id, target_type, details)
  VALUES (
    auth.uid(),
    'credential_' || _decision,
    _user_id::text,
    'profile',
    jsonb_build_object('credential', _credential, 'reason', _reason)
  );
END;
$function$
;
