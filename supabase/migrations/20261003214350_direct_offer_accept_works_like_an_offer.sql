-- docs/OPEN.md Q1185. A direct offer's Accept works like a regular offer's
-- (owner, 2026-10-03, asked by pop-up: "Same as a regular offer").
--
-- Before: respond_to_direct_offer stamped helper_confirmed_at in the same
-- UPDATE that put the Helpr on the job, so jobs_award_gate (20261003193541,
-- Q1180) refused a Helpr whose payout setup or Stripe ID was unfinished: they
-- saw the setup pop-up, had to tap Accept again once done, and nothing
-- remembered their yes. The poster heard only a "Someone applied" notice for
-- the accept (notify_on_application on the accepted applications row).
--
-- After, layer by layer:
--   * respond_to_direct_offer: profile-then-job locks; an unready Helpr's
--     accept leaves the direct offer exactly as it is (open, pending, its own
--     clock, the poster told nothing) and records job_accept_pending; a ready
--     Helpr's accept completes now.
--   * complete_direct_offer_accept(job, helper): the one completion, shared
--     with the profiles trigger: the applications row, the job made the
--     Helpr's, complete_job_accept (confirmation, other applications closed,
--     the poster told "<name> accepted your offer"). Not client-callable.
--   * complete_pending_accepts_on_setup: also completes a pending direct
--     accept whose offer is still live and the Helpr's.
--   * clear_job_accept_pending: a pending row goes when it no longer
--     describes a live offer for its Helpr (a direct offer declined, expired,
--     withdrawn or re-offered included); it fires on those columns too.
--   * notify_on_application: "New application" only for a real application
--     (born 'pending'); an accepted row's own completion tells the poster.
--   * zzz_jobs_reopen_retires_direct_offer: a job reopened with nobody on it
--     no longer carries an accepted direct offer (the class fix for the
--     reopen paths that left it hidden from browse).
--
-- respond_to_direct_offer (md5(prosrc) f1fac99c32a5198584faa5dd80962589) and
-- notify_on_application (2b5882a4fcfe3552a5051f336a33e128) are their live
-- bodies with only the edits marked Q1185; the two Q1180 trigger functions are
-- 20261003193541's with the same marks. lh-authz-rls review 2026-10-03
-- (CHANGES REQUIRED on the first design, which made the job the Helpr's at
-- the pending tap): its must-fix 1-3 and should-fix 5 are this design.
--
-- REPLAY-SAFETY: CREATE OR REPLACE / DROP TRIGGER IF EXISTS; plpgsql bodies
-- are not resolved at creation. Proof:
-- src/test/pglite/acceptCompletesAfterStripeSetup.pglite.mjs (section 10, red
-- on prod's definitions). Guard: src/test/acceptCompletesAfterStripeSetup.test.ts.

-- Why this Helpr cannot take this direct offer right now, or NULL. The ONE
-- list of what a direct accept must pass, read by the RPC before it records
-- anything and by the deferred completion, which runs in a server context
-- where the applications BEFORE INSERT gates (credential tier, job state,
-- ban) return early (lh-authz-rls re-review of Q1185, must-fix A). It mirrors
-- those gates' refusals for this case, plus the offer itself and funding.
-- TimeZone is pinned as enforce_application_job_state's is: CURRENT_DATE is
-- the session's date, and prod sessions run in UTC, a day ahead of Louisiana
-- from 19:00 to 24:00 CDT (final review #1; scripts/ci/current-date-time-zone.sql).
CREATE OR REPLACE FUNCTION public.direct_accept_block_reason(p_job_id uuid, p_helper uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Chicago'
AS $fn$
DECLARE
  v_job record;
  v_profile record;
BEGIN
  SELECT j.status::text AS status, j.helper_id, j.customer_id, j.offered_to_helper_id,
         j.direct_offer_status, j.direct_offer_expires_at, j.parent_job_id, j.is_seed,
         j.date_needed, j.expires_at, j.payment_status, COALESCE(j.credential_tier, 0) AS credential_tier
    INTO v_job
    FROM public.jobs j
   WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RETURN 'job_not_found';
  END IF;
  -- the offer itself
  IF v_job.status IS DISTINCT FROM 'open' OR v_job.helper_id IS NOT NULL
     OR v_job.offered_to_helper_id IS DISTINCT FROM p_helper
     OR v_job.direct_offer_status IS DISTINCT FROM 'pending' THEN
    RETURN 'offer_not_active';
  END IF;
  IF v_job.direct_offer_expires_at IS NOT NULL AND v_job.direct_offer_expires_at < now() THEN
    RETURN 'offer_expired';
  END IF;
  -- enforce_application_job_state's refusals
  IF v_job.customer_id IS NULL OR v_job.customer_id = p_helper THEN
    RETURN 'offer_not_active';
  END IF;
  IF public.are_users_blocked(p_helper, v_job.customer_id) THEN
    RETURN 'applicant_blocked';
  END IF;
  IF v_job.parent_job_id IS NOT NULL
     OR (COALESCE(v_job.is_seed, false) AND public.seed_jobs_hidden_publicly()) THEN
    RETURN 'offer_not_active';
  END IF;
  IF v_job.date_needed IS NOT NULL AND v_job.date_needed < CURRENT_DATE THEN
    RETURN 'job_date_has_passed';
  END IF;
  IF v_job.expires_at IS NOT NULL AND v_job.expires_at <= now() THEN
    RETURN 'job_expired';
  END IF;
  -- funded (enforce_job_funded_before_award; the server path skips it)
  IF NOT public.job_payment_is_funded(v_job.payment_status::text) THEN
    RETURN 'job_not_funded';
  END IF;
  -- enforce_application_credential_tier
  IF v_job.credential_tier > 0
     AND COALESCE(public.get_user_credential_tier(p_helper), 0) < v_job.credential_tier THEN
    RETURN 'credential_tier_required';
  END IF;
  -- enforce_ban_gate (is_caller_banned's predicate, for this Helpr) and block_shadowbanned_applications
  SELECT p.ban_status, p.auto_suspended_until INTO v_profile FROM public.profiles p WHERE p.user_id = p_helper;
  IF v_profile.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (v_profile.ban_status <> 'temp_banned' OR v_profile.auto_suspended_until IS NULL
          OR v_profile.auto_suspended_until > now()) THEN
    RETURN 'account_restricted';
  END IF;
  IF public.is_helper_shadowbanned(p_helper) THEN
    RETURN 'account_restricted';
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.direct_accept_block_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.direct_accept_block_reason(uuid, uuid) TO service_role;

-- The one completion of a direct offer's accept, shared by the RPC's ready
-- path and the profiles trigger: the real applications row, the job made the
-- Helpr's, then complete_job_accept (confirmation, the poster told). The
-- caller holds the job's row lock. NULL when the offer is no longer live and
-- this Helpr's; applicant_blocked across a block (Q345's rule for every hire;
-- both callers check first, so this is the backstop).
CREATE OR REPLACE FUNCTION public.complete_direct_offer_accept(p_job_id uuid, p_helper uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  v_customer uuid;
  v_app_id   uuid;
BEGIN
  -- Locked here too (both callers already hold it; re-taking it is free), so
  -- this function is race-safe on its own reading (scripts/check-race-class.mjs).
  SELECT j.customer_id INTO v_customer FROM public.jobs j WHERE j.id = p_job_id FOR UPDATE;
  IF public.are_users_blocked(p_helper, v_customer) THEN
    RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
  END IF;
  -- Everything else the applications gates would have refused in a user
  -- session, checked here because this runs in a server context too.
  IF public.direct_accept_block_reason(p_job_id, p_helper) IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- The real applications row the synthetic 'direct-<id>' card stood in for.
  -- ON CONFLICT covers a Helpr who also applied before the offer landed.
  INSERT INTO public.applications (job_id, helper_id, message, status)
  VALUES (p_job_id, p_helper, NULL, 'accepted')
  ON CONFLICT (job_id, helper_id) DO UPDATE SET status = 'accepted'
  RETURNING id INTO v_app_id;

  UPDATE public.jobs
     SET status = 'accepted',
         helper_id = p_helper,
         direct_offer_status = 'accepted',
         response_deadline = NULL,
         direct_offer_expires_at = NULL
   WHERE id = p_job_id
     AND status = 'open'
     AND helper_id IS NULL
     AND offered_to_helper_id = p_helper
     AND direct_offer_status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_active';  -- undoes the applications row above
  END IF;

  IF NOT public.complete_job_accept(p_job_id) THEN
    RAISE EXCEPTION 'offer_not_active';
  END IF;
  RETURN jsonb_build_object('action', 'accepted', 'application_id', v_app_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_direct_offer_accept(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_direct_offer_accept(uuid, uuid) TO service_role;

-- Q1185: live body + the accept that waits on setup.
CREATE OR REPLACE FUNCTION public.respond_to_direct_offer(p_job_id uuid, p_accept boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_offered_to uuid;
  v_offer_status text;
  v_job_status text;
  v_expires_at timestamptz;
  v_customer uuid;
  v_now timestamptz := now();
  v_reason text;
  v_block text;
  v_done jsonb;
BEGIN
  -- Q1185: profile before job, the lock order of accept_job_offer and of the
  -- profiles trigger that completes pending accepts, so a Stripe status write
  -- landing mid-accept is either read fresh here or sees the pending row.
  PERFORM 1 FROM public.profiles WHERE user_id = auth.uid() FOR SHARE;

  -- Lock the job. Serializes against a concurrent poster cancel/reassign and
  -- against the expire_pending_direct_offers sweep.
  SELECT offered_to_helper_id, direct_offer_status, status, direct_offer_expires_at, customer_id
    INTO v_offered_to, v_offer_status, v_job_status, v_expires_at, v_customer
  FROM public.jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Authorize on the OFFER, not on job ownership: the caller must be the
  -- helper this job was handed to.
  IF v_offered_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_your_offer';
  END IF;

  IF v_offer_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'offer_not_pending';
  END IF;

  IF v_job_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'job_not_open';
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at < v_now THEN
    RAISE EXCEPTION 'offer_expired';
  END IF;

  IF p_accept THEN
    -- Q345: no hire across a block, in either direction. The applications
    -- trigger (C10) would refuse the INSERT below anyway; naming it here gives
    -- the caller a code this RPC owns, and copy for it. Accept branch only:
    -- declining an offer across a block is still allowed.
    IF public.are_users_blocked(auth.uid(), v_customer) THEN
      RAISE EXCEPTION 'applicant_blocked' USING ERRCODE = '42501';
    END IF;

    -- Q1185 (re-review must-fix A, should-fix B): everything the deferred
    -- completion will check is checked now, so nobody is told "thanks" for an
    -- accept that can never complete.
    IF public.is_caller_banned() THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    END IF;
    v_block := public.direct_accept_block_reason(p_job_id, auth.uid());
    IF v_block = 'credential_tier_required' THEN
      RAISE EXCEPTION 'credential_tier_required' USING ERRCODE = '42501';
    ELSIF v_block = 'job_date_has_passed' THEN
      RAISE EXCEPTION 'job_date_has_passed' USING ERRCODE = '42501';
    ELSIF v_block = 'job_expired' THEN
      RAISE EXCEPTION 'job_expired' USING ERRCODE = '42501';
    ELSIF v_block = 'job_not_funded' THEN
      RAISE EXCEPTION 'job_not_funded' USING ERRCODE = '42501';
    ELSIF v_block = 'account_restricted' THEN
      RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
    ELSIF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;

    -- Q1185 (owner, 2026-10-03: "Same as a regular offer"): the accept needs
    -- payout setup and Stripe ID, as accept_job_offer's does. Unready, the
    -- direct offer stays exactly as it is (open, pending, on its own clock,
    -- the poster told nothing) and the yes is remembered in job_accept_pending;
    -- trg_profiles_complete_pending_accepts completes it once both are done.
    v_reason := public.helper_accept_block_reason(auth.uid());
    IF v_reason = 'helper_unknown' THEN
      RAISE EXCEPTION 'helper_unknown';
    END IF;
    IF v_reason IS NOT NULL THEN
      INSERT INTO public.job_accept_pending (job_id, helper_id)
      VALUES (p_job_id, auth.uid())
      ON CONFLICT (job_id) DO UPDATE
        SET helper_id = EXCLUDED.helper_id, requested_at = now()
        WHERE public.job_accept_pending.helper_id IS DISTINCT FROM EXCLUDED.helper_id;
      RETURN jsonb_build_object('action', 'pending_setup',
                                'missing', to_jsonb(public.helper_accept_missing(auth.uid())));
    END IF;

    -- Ready: the accept completes now, through the one completion both doors
    -- share (the poster is told "<name> accepted your offer"). NULL means it
    -- did not (the offer moved on between the check and the write): an error,
    -- never an answer the app shows as "Job accepted" (final review #4).
    v_done := public.complete_direct_offer_accept(p_job_id, auth.uid());
    IF v_done IS NULL THEN
      RAISE EXCEPTION 'offer_not_active';
    END IF;
    RETURN v_done;
  END IF;

  -- Decline: the offer closes, the job reopens to everyone. `offered_to_helper_id`
  -- is retained so the poster's own card can say who declined
  -- (activityStateLabel reads direct_offer_status = 'declined').
  UPDATE public.jobs
     SET direct_offer_status = 'declined',
         direct_offer_expires_at = NULL
   WHERE id = p_job_id;

  INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
  SELECT customer_id,
         'Offer declined',
         'Your direct offer for "' || title || '" was declined. The job is open to everyone again.',
         'job_updates',
         '/posts?job=' || id::text,
         id
    FROM public.jobs
   WHERE id = p_job_id;

  RETURN jsonb_build_object('action', 'declined');
END;
$function$;

REVOKE ALL ON FUNCTION public.respond_to_direct_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_direct_offer(uuid, boolean) TO authenticated;

-- Q1185: 20261003193541's body + the direct-offer branch.
CREATE OR REPLACE FUNCTION public.complete_pending_accepts_on_setup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  r        record;
  v_poster text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.job_accept_pending p WHERE p.helper_id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  IF public.helper_accept_block_reason(NEW.user_id) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- A ban in force (is_caller_banned's predicate) completes nothing; the
  -- pending row waits and goes when the offer moves on (review #6: in server
  -- context enforce_ban_gate is skipped, so the poster would hear "accepted").
  IF NEW.ban_status IN ('banned', 'temp_banned', 'permanently_banned')
     AND (NEW.ban_status <> 'temp_banned'
          OR NEW.auto_suspended_until IS NULL
          OR NEW.auto_suspended_until > now()) THEN
    RETURN NULL;
  END IF;
  FOR r IN
    -- seed: a seed job, or a seed/test Helpr (detect_stuck_payments' rule)
    SELECT p.job_id, j.title, j.customer_id,
           coalesce(j.is_seed OR NEW.is_seed, false) AS seed,
           (j.status = 'open') AS direct
      FROM public.job_accept_pending p
      JOIN public.jobs j ON j.id = p.job_id
     WHERE p.helper_id = NEW.user_id
       AND (  -- a Hire's offer (Q1180)
              (j.status = 'accepted' AND j.helper_id = p.helper_id)
              -- a direct offer still live and still this Helpr's (Q1185)
           OR (j.status = 'open' AND j.helper_id IS NULL
               AND j.offered_to_helper_id = p.helper_id
               AND j.direct_offer_status = 'pending'
               AND (j.direct_offer_expires_at IS NULL OR j.direct_offer_expires_at >= now())
               -- anything that would refuse it now (a block, the date passing, a
               -- tier, a ban): completes nothing, logs nothing
               AND public.direct_accept_block_reason(p.job_id, p.helper_id) IS NULL))
     ORDER BY p.requested_at
       FOR UPDATE OF j
  LOOP
    -- One job that cannot complete never rolls back the Stripe status write
    -- this trigger runs inside (review #3; settle_one_off_jobs_for_banned_account's
    -- pattern): it is logged, and the rest still complete.
    BEGIN
      -- (parenthesised: plpgsql's IF reads its condition up to the first THEN)
      IF (CASE WHEN r.direct THEN public.complete_direct_offer_accept(r.job_id, NEW.user_id) IS NOT NULL
               ELSE public.complete_job_accept(r.job_id) END) THEN
        SELECT COALESCE(NULLIF(btrim(pp.full_name), ''), 'the person who posted it') INTO v_poster
          FROM public.profiles pp WHERE pp.user_id = r.customer_id;
        INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
        VALUES (
          NEW.user_id,
          'You''re all set',
          'Your payout setup and Stripe ID are done, so you''ve accepted "' || COALESCE(r.title, 'the job')
            || '", and ' || COALESCE(v_poster, 'the person who posted it') || ' has been told.',
          'job_updates',
          '/jobs?job=' || r.job_id::text,
          r.job_id
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A seed/E2E job logs under the '-seed' source, which
      -- error_log_is_seed() keeps out of Slack and the alert ledger.
      INSERT INTO public.error_logs (severity, message, tags, context)
      VALUES (
        CASE WHEN r.seed THEN 'info' ELSE 'error' END,
        'pending accept completion failed',
        jsonb_build_object('source', 'complete_pending_accepts_on_setup' || CASE WHEN r.seed THEN '-seed' ELSE '' END,
                           'seed', r.seed, 'job_id', r.job_id::text),
        jsonb_build_object('job_id', r.job_id, 'helper_id', NEW.user_id, 'err', SQLERRM, 'sqlstate', SQLSTATE)
      );
    END;
  END LOOP;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.complete_pending_accepts_on_setup() FROM PUBLIC, anon, authenticated;

-- Q1185: 20261003193541's body, judging the row instead of the columns.
CREATE OR REPLACE FUNCTION public.clear_job_accept_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  -- Q1185: a pending accept stays while the row still describes a live offer
  -- for its Helpr: a Hire's offer (accepted, theirs, unconfirmed) or a direct
  -- offer (open, offered to them, pending). Anything else ends it.
  DELETE FROM public.job_accept_pending p
   WHERE p.job_id = NEW.id
     AND NOT (
           (NEW.status::text = 'accepted' AND NEW.helper_id = p.helper_id AND NEW.helper_confirmed_at IS NULL)
        OR (NEW.status::text = 'open' AND NEW.helper_id IS NULL
            AND NEW.offered_to_helper_id = p.helper_id AND NEW.direct_offer_status = 'pending'));

  -- A direct offer's yes was given to the terms on screen at the tap: when,
  -- where, what, the pay and the series. If the poster changes them while it
  -- waits on setup, it is never completed on terms the Helpr did not see
  -- (final review #2: the poster moved a pending direct accept's date, start
  -- and place, and Stripe then booked the Helpr on them; Q423's schedule lock
  -- reads helper_id, NULL on a direct offer). The yes ends and the Helpr is
  -- told; the poster was never told of the yes, so their edit is neither
  -- refused nor reported. Direct offers only (the job is open): a Hire's
  -- schedule moves only through the agreed-change RPC, which both sides
  -- accept, and its yes protects the Helpr from the expiry strike (re-review
  -- of the final fixes, must-fix 2 and 3). Coordinates are not terms: only
  -- the geocoders write them, and the Helpr never sees them (must-fix 1).
  IF NEW.status::text = 'open'
     AND (OLD.date_needed, OLD.start_time, OLD.estimated_hours, OLD.is_flexible_schedule,
          OLD.location, OLD.parish, OLD.zip_code,
          OLD.title, OLD.description, OLD.category, OLD.special_requirements, OLD.photos,
          OLD.scope_video_url, OLD.require_photo_proof,
          OLD.budget, OLD.pricing_mode, OLD.is_urgent, OLD.urgent_fee,
          OLD.is_recurring, OLD.recurrence_interval, OLD.recurrence_days, OLD.recurrence_weeks,
          OLD.recurrence_end_date, OLD.series_split_ok)
         IS DISTINCT FROM
         (NEW.date_needed, NEW.start_time, NEW.estimated_hours, NEW.is_flexible_schedule,
          NEW.location, NEW.parish, NEW.zip_code,
          NEW.title, NEW.description, NEW.category, NEW.special_requirements, NEW.photos,
          NEW.scope_video_url, NEW.require_photo_proof,
          NEW.budget, NEW.pricing_mode, NEW.is_urgent, NEW.urgent_fee,
          NEW.is_recurring, NEW.recurrence_interval, NEW.recurrence_days, NEW.recurrence_weeks,
          NEW.recurrence_end_date, NEW.series_split_ok) THEN
    WITH gone AS (
      DELETE FROM public.job_accept_pending p WHERE p.job_id = NEW.id RETURNING p.helper_id
    )
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT g.helper_id,
           'The job changed',
           'The details of "' || COALESCE(NEW.title, 'the job')
             || '" changed after you tapped Accept, so your accept was not completed.'
             -- "still yours" only while it is (re-review should-fix 6)
             || CASE WHEN NEW.direct_offer_expires_at IS NULL OR NEW.direct_offer_expires_at > now()
                     THEN ' The offer is still yours: look at the new details and tap Accept again if they work for you.'
                     ELSE '' END,
           'job_updates',
           '/jobs?job=' || NEW.id::text,
           NEW.id
      FROM gone g;
  END IF;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.clear_job_accept_pending() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_jobs_clear_accept_pending ON public.jobs;
CREATE TRIGGER trg_jobs_clear_accept_pending
  AFTER UPDATE OF helper_id, helper_confirmed_at, status, offered_to_helper_id, direct_offer_status,
                  date_needed, start_time, estimated_hours, is_flexible_schedule,
                  location, parish, zip_code,
                  title, description, category, special_requirements, photos,
                  scope_video_url, require_photo_proof,
                  budget, pricing_mode, is_urgent, urgent_fee,
                  is_recurring, recurrence_interval, recurrence_days, recurrence_weeks,
                  recurrence_end_date, series_split_ok ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.clear_job_accept_pending();

-- Q1185: live body + "New application" only for a real application.
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

  -- Q1185: only a real application (born 'pending') is news to the poster. A
  -- row born 'accepted' is the record of an accept (respond_to_direct_offer's
  -- completion, claim_series_dates), whose own notice tells the poster; this
  -- one said "Someone applied" first, and at a direct offer's pending tap it
  -- reached the poster before the Helpr's setup was done.
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    v_user_id := job_owner;
    v_title := 'New application';
    v_message := 'Someone applied to "' || job_title || '"';
    v_type := 'application';
    v_link := '/posts?job=' || NEW.job_id::text;

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
  -- picked, and only its link ('/jobs?filter=offered') reaches the screen
  -- where the helper can actually accept before that deadline runs out.

  IF TG_OP = 'UPDATE' AND NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    -- ADDED 2026-09-23 (Q274): the backfill below closes applications on jobs
    -- that were cancelled long ago. Nobody is owed a notice for that.
    IF current_setting('app.q274_backfill', true) = 'on' THEN
      RETURN NEW;
    END IF;
    -- ADDED 2026-09-24 (Q345): closed because one of the two blocked the
    -- other. A notice would be contact the blocker asked not to have, and
    -- "not selected" would be false when the applicant is the one who blocked.
    IF NEW.closed_reason = 'party_blocked' THEN
      RETURN NEW;
    END IF;
    v_user_id := NEW.helper_id;
    v_title := 'Application update';
    -- ADDED 2026-09-23 (Q274): closed because the JOB was cancelled, not
    -- because anyone turned this applicant down. "Not selected" would be false.
    IF NEW.closed_reason = 'job_cancelled' THEN
      v_message := '"' || COALESCE(job_title, 'A job') || '" was cancelled, so your application is closed';
    ELSE
      v_message := 'Your application for "' || job_title || '" was not selected';
      -- The poster's own words, when they left any. This is the whole reason
      -- the client used to fire a SECOND notification.
      IF NEW.decline_reason IS NOT NULL AND btrim(NEW.decline_reason) <> '' THEN
        v_message := v_message || ': ' || btrim(NEW.decline_reason);
      END IF;
    END IF;
    v_type := 'info';
    -- A rejected application buckets to `cancelled` on the applied tab
    -- (appliedActivityBucket). '/home' showed the job board instead.
    v_link := '/jobs?job=' || NEW.job_id::text;

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

REVOKE ALL ON FUNCTION public.notify_on_application() FROM PUBLIC, anon, authenticated;

-- Q1185: live body + the lapse notice for a Helpr whose accept was pending.
CREATE OR REPLACE FUNCTION public.expire_pending_direct_offers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.jobs
       SET direct_offer_status = 'expired'
     WHERE direct_offer_status = 'pending'
       AND direct_offer_expires_at IS NOT NULL
       AND direct_offer_expires_at < now()
    RETURNING id, customer_id, title
  ), notified AS (
    INSERT INTO public.notifications (user_id, title, message, type, link)
    SELECT customer_id,
           'Direct offer expired',
           'Your offer for "' || title || '" was not accepted in time. The job is now open to everyone.',
           'job_updates',
           '/posts?job=' || id::text
      FROM expired
     WHERE customer_id IS NOT NULL
    RETURNING 1
  ), told AS (
    -- Q1185 (re-review should-fix C): a Helpr who said yes while their setup
    -- was unfinished hears the offer lapsed, with no strike, as a regular
    -- offer's Helpr does (expire_unanswered_offers). The statement's snapshot
    -- still holds the pending rows trg_jobs_clear_accept_pending removes.
    -- Setup can be done and the accept still not complete (the job's date
    -- passed, a block): the copy says which (final review #3).
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    SELECT p.helper_id,
           'You lost a job offer',
           CASE WHEN public.helper_accept_block_reason(p.helper_id) IS NOT NULL
                THEN 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your payout setup and Stripe ID were done, so it went back to everyone. No strike. Finish both so you can accept the next offer.'
                ELSE 'The direct offer for "' || COALESCE(e.title, 'a job')
                       || '" expired before your accept could be completed, so it went back to everyone. No strike.'
           END,
           'expired',
           '/jobs?job=' || e.id::text,
           e.id
      FROM expired e
      JOIN public.job_accept_pending p ON p.job_id = e.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_pending_direct_offers() FROM PUBLIC, anon, authenticated;

-- Q1201 (lh-authz-rls re-review of Q1185, 2026-10-03, reproduced in PGlite):
-- this UPDATE policy let the Helpr a job was offered to PATCH the job row
-- itself: credential_tier 2 -> 0, date_needed, title, direct_offer_expires_at
-- +10 years (authenticated holds UPDATE on jobs and
-- prevent_job_field_escalation's deny-list names none of those), then accept
-- and be booked. respond_to_direct_offer is SECURITY DEFINER and never needed
-- it; no client writes the job as the targeted Helpr.
DROP POLICY IF EXISTS "Targeted helper can respond to direct offer" ON public.jobs;

-- A job that goes back to open with nobody on it no longer has an accepted
-- direct offer. Every reopen path (report_helper_no_show, helper_cancel_booking,
-- helper_abort_job, the ban settlers, auto-expire-jobs, expire_unanswered_offers,
-- decline_job_offer) left direct_offer_status = 'accepted' with
-- offered_to_helper_id set, and open_jobs_browse / get_ranked_open_jobs show
-- such a job only when the offer is declined or expired: a funded, open job
-- nobody could find (lh-authz-rls review of Q1185, 2026-10-03; 0 such rows on
-- prod today). Named to run after every other BEFORE trigger on jobs, so none
-- of them judges this bookkeeping change as the caller's.
CREATE OR REPLACE FUNCTION public.jobs_reopen_retires_direct_offer()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status::text = 'open' AND NEW.helper_id IS NULL AND NEW.direct_offer_status = 'accepted' THEN
    NEW.direct_offer_status := 'expired';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_reopen_retires_direct_offer() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zzz_jobs_reopen_retires_direct_offer ON public.jobs;
CREATE TRIGGER zzz_jobs_reopen_retires_direct_offer
  BEFORE UPDATE OF status, helper_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_reopen_retires_direct_offer();

-- The rows the old code already stranded (0 on prod 2026-10-03).
UPDATE public.jobs
   SET direct_offer_status = 'expired'
 WHERE status = 'open' AND helper_id IS NULL AND direct_offer_status = 'accepted';
