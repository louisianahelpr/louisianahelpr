-- notification_preferences rows are created LAZILY — only when a user opens
-- Profile → Notifications and flips something. `handle_new_user` never made
-- one and nothing ever backfilled, so on 2026-09-02 prod had 6 rows for 40
-- accounts: 34 users (85%) had no preference row at all.
--
-- That single absence broke two things in OPPOSITE directions:
--
--   * EMAIL failed CLOSED. send-notification-email reads the row and treats a
--     missing one as opt-out, so no notification email had ever been sent to a
--     user without a row — 46 sent in notification_logs, every one to the
--     handful of users who had a row; 6 skipped `preference_off`, every one to
--     a user who did not. `notify_on_application` has the same bug twice, in
--     SQL: `IF v_email_enabled IS TRUE` is false for a NULL.
--
--   * PUSH failed OPEN, and worse than filed. fan_out_push_on_notification
--     wrapped its ENTIRE gate in `IF prefs.user_id IS NOT NULL`, so for a user
--     with no row not even the master `push_enabled` switch was consulted.
--
-- WHICH DEFAULT IS RIGHT: a missing row means the user's DEFAULT preference
-- set, not "opt out of everything". This is not a taste call — every column in
-- notification_preferences already carries a DEFAULT, and 5 of the 6 SQL
-- producers that read prefs already encode exactly this rule
-- (`IF COALESCE(v_pref, true)` in notify_helper_on_tip,
-- notify_on_payment_escrowed, notify_poster_on_status_change and
-- notify_user_on_review; `COALESCE(np.new_offers, true)` in
-- notify_helpers_on_job_post). The majority convention is default-on; the two
-- places that disagreed are the two that were broken.
--
-- Rather than restate those defaults in a second place, this migration makes
-- the row ALWAYS EXIST: backfilled here, created at signup, and materialised
-- on demand by the fan-out trigger if one ever goes missing again. The DB
-- column defaults stay the single definition of what "default" means.
--
-- REPLAY-SAFETY: every statement is INSERT .. ON CONFLICT or CREATE OR
-- REPLACE, so the file is idempotent. It depends only on objects created by
-- EARLIER migrations — notification_preferences (20260312023604),
-- notification_type_pref_map (20260506140000) and the vault helpers
-- (20260506150000) — so a from-scratch rebuild reaches this point with all of
-- them present.

-- ---------------------------------------------------------------------------
-- 1. Backfill: one row per existing account that has none.
--    The column list is deliberately just user_id — every other column takes
--    its DEFAULT, which is the whole point.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_preferences (user_id)
SELECT u.id FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Create the row at signup so the gap cannot reopen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );

  -- Always 'customer' — the universal "member" value. Helper-vs-customer
  -- distinction lives nowhere in the UI; capability gates (IDV, Stripe
  -- Connect) determine what each user can do, not their role.
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer'::app_role);

  -- Every column takes its DEFAULT. Without this row transactional email is
  -- silently dead for the account and the push gate is skipped entirely.
  -- ON CONFLICT because this trigger must never be the thing that fails a
  -- signup.
  INSERT INTO public.notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Map the three unmapped types.
--
--    The allowed type set is NOT hand-written: it is the enforced
--    `notifications_type_check` CHECK constraint (17 values), cross-checked
--    against the 16 distinct types prod has actually emitted and against the
--    TYPE_MAP in send-notification-email. All three sources agree the map was
--    missing exactly `info`, `success` and `warning` — 791 of 1802 rows
--    (43.9%), for which push consulted no category toggle at all.
--
--    These three are SEVERITY labels, not categories, which is the underlying
--    modelling error. The columns chosen are the ones
--    send-notification-email/index.ts:23-25 already uses for the same three
--    types, so push and email now agree instead of disagreeing. This silences
--    nothing today: all 6 pre-existing rows have system_alerts and work_status
--    true, and both columns DEFAULT true.
--
--    This closes the fail-open. It does NOT fix the mis-categorisation —
--    `info` still spans transit updates, new offers and admin mail. The real
--    fix is to retype those at their call sites (and add an `admin_alert`
--    type for the 616 operator-facing rows, 81% of the volume); that spans
--    other lanes' files and is filed separately.
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_type_pref_map (type, pref_column, description) VALUES
  ('info',    'work_status',   'Severity label (legacy) — spans several categories; matches send-notification-email TYPE_MAP.'),
  ('success', 'work_status',   'Severity label (legacy) — spans several categories; matches send-notification-email TYPE_MAP.'),
  ('warning', 'system_alerts', 'Severity label (legacy) — spans several categories; matches send-notification-email TYPE_MAP.')
ON CONFLICT (type) DO UPDATE
  SET pref_column = EXCLUDED.pref_column,
      description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
-- 4. Fan-out: honour the gate even when the row is missing, and never let a
--    new type bypass it silently again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fan_out_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prefs public.notification_preferences;
  pref_col text;
  pref_value boolean;
  supabase_url text;
  service_role_key text;
BEGIN
  SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;

  -- Self-heal. The old code skipped the WHOLE gate when the row was absent,
  -- so `push_enabled = false` went unhonoured for the 85% of accounts that had
  -- none. Materialising the defaults keeps the DB column defaults as the one
  -- definition of "default" instead of restating them here. After the backfill
  -- in this migration this branch should effectively never run.
  IF prefs.user_id IS NULL THEN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO prefs FROM public.notification_preferences WHERE user_id = NEW.user_id;
  END IF;

  -- Master switch, now checked unconditionally.
  IF prefs.user_id IS NOT NULL AND prefs.push_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT pref_column INTO pref_col
    FROM public.notification_type_pref_map
    WHERE type = NEW.type;

  IF pref_col IS NULL THEN
    -- Every value permitted by notifications_type_check now has a map row, so
    -- reaching this means someone widened the CHECK without widening the map.
    -- Announce it rather than silently sending past the user's preferences —
    -- that silence is exactly how 43.9% of notifications came to ignore the
    -- gate. Still sends: failing closed here would mute admin operator alerts,
    -- which are 81% of the affected volume.
    RAISE WARNING 'fan_out_push_on_notification: notification type % has no notification_type_pref_map row — push sent WITHOUT a category check (notification %)', NEW.type, NEW.id;
  ELSE
    EXECUTE format('SELECT ($1).%I', pref_col) INTO pref_value USING prefs;
    IF pref_value IS NOT TRUE THEN
      RETURN NEW;
    END IF;
  END IF;

  -- STABLE helpers — Postgres caches result across rows within a single
  -- statement, so a 1000-row broadcast insert decrypts vault once, not 1000x.
  supabase_url := public.get_supabase_url();
  service_role_key := public.get_service_role_key();

  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'fan_out_push_on_notification: vault secrets missing — push skipped for notification %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/send-push-notification',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_role_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', NEW.title,
      'body', NEW.message,
      'link', NEW.link,
      'thread_id', NEW.type
    )
  );

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. notify_on_application carries the same fail-closed email gate as the
--    edge function, twice. `IF v_email_enabled IS TRUE` is FALSE for a NULL,
--    so the "New application" and "Application update" emails were never sent
--    to any account without a prefs row. COALESCE to the column's own DEFAULT
--    (email_job_applications DEFAULT true), matching every other producer.
--    The body is otherwise verbatim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_on_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  job_title TEXT;
  job_owner UUID;
  v_user_id UUID;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT;
  v_link TEXT;
  v_email_enabled BOOLEAN;
  v_profile RECORD;
BEGIN
  SELECT title, customer_id INTO job_title, job_owner FROM public.jobs WHERE id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    v_message := 'Someone applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/my-posts?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF COALESCE(v_email_enabled, true) THEN
      SELECT email, full_name INTO v_profile FROM public.profiles WHERE user_id = v_user_id;
      IF v_profile.email IS NOT NULL THEN
        PERFORM net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
          ),
          body := jsonb_build_object(
            'user_id', v_user_id,
            'title', v_title,
            'message', v_message,
            'type', v_type,
            'link', v_link
          )
        );
      END IF;
    END IF;
  END IF;

  -- NO 'accepted' branch. The client (useOfferHandlers) is the single
  -- producer for an accept: only it knows the response deadline the poster
  -- picked, and only its link ('/my-jobs?filter=offered') reaches the screen
  -- where the helper can actually accept before that deadline runs out.

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    v_message := 'Your application for "' || job_title || '" was not selected';
    -- The poster's own words, when they left any. This is the whole reason
    -- the client used to fire a SECOND notification.
    IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
      v_message := v_message || ': ' || btrim(NEW.decline_reason);
    END IF;
    v_type := 'info';
    -- A rejected application buckets to `cancelled` on the applied tab
    -- (appliedActivityBucket). '/dashboard' showed the job board instead.
    v_link := '/my-jobs?job=' || NEW.job_id::text;

    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (v_user_id, v_title, v_message, v_type, v_link);

    SELECT email_job_applications INTO v_email_enabled
    FROM public.notification_preferences WHERE user_id = v_user_id;

    IF COALESCE(v_email_enabled, true) THEN
      PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
        ),
        body := jsonb_build_object(
          'user_id', v_user_id, 'title', v_title, 'message', v_message, 'type', v_type, 'link', v_link
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
