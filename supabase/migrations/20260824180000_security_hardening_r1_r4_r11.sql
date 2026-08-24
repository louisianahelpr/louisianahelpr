-- Security hardening: R1, R2, R3, R4, R11 from the 2026-08-23 audit.
-- Every function body below is the LIVE prod definition (pulled via
-- pg_get_functiondef 2026-08-24) plus the stated guard — nothing else drifts.

-- ─────────────────────────────────────────────────────────────────────────
-- R1 (RELEASE-BLOCKING) — any authenticated user could permanently ban any
-- other user.
--
-- report_helper_no_show checked only that the caller owned the job. A poster
-- fully controls jobs.helper_id while payment_status = 'unpaid' (the money
-- lock deliberately self-disarms before escrow exists), so the attack was:
-- post two throwaway UNPAID jobs, set helper_id = <victim>, call this RPC
-- twice → victim permanently_banned. Unprivileged, repeatable, irreversible
-- without an admin.
--
-- Three guards, each closing one leg of that attack:
--   1. FUNDED ONLY. An unpaid job cannot produce a no-show report. This is
--      the load-bearing one: it forces an attacker to actually move money
--      through Stripe, per fake job, traceably. Verified against live data —
--      all 20 assigned jobs are funded, so no legitimate report loses its
--      path. (An accepted-application check was considered and REJECTED:
--      only 6 of those 20 have an application row, because direct assignment
--      and offer flows legitimately produce none.)
--   2. THE JOB MUST HAVE STARTED. A no-show before the scheduled start is
--      not a no-show.
--   3. DISTINCT REPORTERS + ONE REPORT PER JOB. The escalation ladder counts
--      distinct posters, so one person can no longer stack strikes alone,
--      and the same job can't be reported twice.
CREATE OR REPLACE FUNCTION public.report_helper_no_show(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_payment_status text;
  v_date_needed date;
  v_start_time time;
  v_starts_at timestamptz;
  v_prior_count int;
  v_action text;
BEGIN
  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  -- GUARD 1 — the job must be funded. Closes the throwaway-job ban attack.
  IF v_payment_status IS NULL OR v_payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;

  -- GUARD 2 — the scheduled start must have passed.
  v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
  END IF;

  -- GUARD 3a — one report per job.
  IF EXISTS (
    SELECT 1 FROM public.user_violations
    WHERE job_id = p_job_id AND violation_type = 'no_show'
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'This job already has a no-show report.';
  END IF;

  -- GUARD 3b — escalate on DISTINCT reporters, so one poster acting alone
  -- can warn but never ban.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id
    AND violation_type = 'no_show'
    AND reported_by IS DISTINCT FROM auth.uid();

  v_action := CASE WHEN v_prior_count >= 1 THEN 'permanent_ban' ELSE 'warning' END;

  INSERT INTO public.user_violations (user_id, violation_type, description, job_id, reported_by, action_taken)
  VALUES (v_helper_id, 'no_show',
          'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
          p_job_id, auth.uid(), v_action);

  IF v_action = 'permanent_ban' THEN
    INSERT INTO public.user_bans (user_id, ban_type, reason, banned_by)
    VALUES (v_helper_id, 'permanent', 'Repeated no-show violations', auth.uid());
    UPDATE public.profiles SET ban_status = 'permanently_banned' WHERE user_id = v_helper_id;
  ELSE
    UPDATE public.profiles SET ban_status = 'final_warning' WHERE user_id = v_helper_id;
  END IF;

  UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'action', v_action,
    'prior_count', v_prior_count,
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- R2 — the pgmq email-queue wrappers were SECURITY DEFINER with zero
-- authorization, granted to `authenticated`. Any logged-in user could read
-- every pending outbound email (bulk PII + embedded auth tokens), inject a
-- message the worker would send FROM the platform's domain, or delete/timeout
-- messages (delivery DoS).
--
-- Revoked rather than role-gated: every caller is an edge function
-- (auth-email-hook, engagement-automations, send-notification-email,
-- process-email-queue), and those run as service_role, which bypasses these
-- grants entirely. No user-facing path loses anything.
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)              FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint)              FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)  FROM authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────
-- R4 — get_helper_distances_from_job deanonymized home addresses.
--
-- SECURITY DEFINER, executable by anon, no ownership check, and the CALLER
-- supplied both the job coordinates and the user_ids[]. Post three jobs at
-- chosen points, query one victim against each, trilaterate to ~100 m — on a
-- platform whose whole business is sending strangers to homes.
--
-- Now scoped to the job's own poster. That is exactly the real caller
-- (useApplicantSignals, rendering "3.2 km away" beside each applicant on the
-- poster's own applicants panel), so the feature is untouched.
CREATE OR REPLACE FUNCTION public.get_helper_distances_from_job(p_job_id uuid, p_user_ids uuid[])
 RETURNS TABLE(user_id uuid, distance_km numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.user_id,
    ROUND((
      6371 * acos(LEAST(1.0, GREATEST(-1.0,
        cos(radians(j.latitude)) * cos(radians(p.latitude)) *
        cos(radians(p.longitude) - radians(j.longitude)) +
        sin(radians(j.latitude)) * sin(radians(p.latitude))
      )))
    )::numeric, 1) AS distance_km
  FROM profiles p
  JOIN jobs j ON j.id = p_job_id
  WHERE p.user_id = ANY(p_user_ids)
    -- OWNERSHIP GATE (R4): only the job's poster may measure distances to it.
    AND j.customer_id = auth.uid()
    AND p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND j.latitude IS NOT NULL
    AND j.longitude IS NOT NULL;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- R3 — a poster could mark their own unpaid job "escrow funded".
--
-- The money lock only engaged once payment_status <> 'unpaid', so the FIRST
-- unpaid → escrow write was unguarded. That fired the real "payment secured"
-- notification to the helper and entered auto-release-payment. No funds move
-- (release-payout re-verifies the PaymentIntent), but it is a turnkey
-- do-the-work-never-get-paid lure.
--
-- Fix: a set of columns the poster's client never writes in ANY state, locked
-- regardless of funding. Verified against the client before locking:
-- payment_status, stripe_payment_intent_id and the boost/urgent columns have
-- ZERO poster-side write paths. helper_id deliberately stays funded-only —
-- useOfferHandlers legitimately writes it on an unpaid job (offer accept and
-- job reopen), and R1's own guards now cover the ban vector it enabled.
CREATE OR REPLACE FUNCTION public.enforce_poster_jobs_money_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  changed_col text;
  -- Never writable by the poster, funded or not (R3). Escrow state and the
  -- paid-placement columns are set by edge functions running as service_role
  -- (auth.uid() IS NULL), which returns early below.
  locked_always CONSTANT text[] := ARRAY[
    'payment_status',
    'stripe_payment_intent_id',
    'boosted_at',
    'boost_expires_at',
    'is_urgent'
  ];
  -- Money / fee / payment / assignment columns a poster must never mutate on a
  -- FUNDED job. Enumerated (not derived) so a new column defaults to lockable
  -- only when added here — safer than an allow-list that fails open.
  locked_when_funded CONSTANT text[] := ARRAY[
    'budget',
    'urgent_fee',
    'platform_fee_amount',
    'platform_fee_percent',
    'helper_fee_percent',
    'customer_fee_amount',
    'commission_tax_amount',
    'sales_tax_amount',
    'protection_fee',
    'payment_status',
    'stripe_payment_intent_id',
    'helper_id',
    'poster_completed_at'
    -- NOTE: cancellation_fee / cancellation_fee_status are deliberately NOT
    -- locked — CancellationDialog writes them client-side for BOTH parties when
    -- a funded job is cancelled (mirrors the helper whitelist which permits
    -- them). Locking them here would break the poster's cancel flow.
  ];
BEGIN
  -- Only constrain the poster acting on their own job. Everyone else
  -- (service role: uid NULL; assigned helper; admin) passes through — their
  -- access is governed by RLS / the helper whitelist as before.
  IF auth.uid() IS NULL
     OR auth.uid() IS DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- Ownership is immutable to the poster, funded or not.
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'Posters may not reassign jobs.customer_id'
      USING ERRCODE = '42501';
  END IF;

  -- ALWAYS-LOCKED set (R3) — checked before the funded gate.
  FOR changed_col IN
    SELECT n.key
    FROM jsonb_each(to_jsonb(NEW)) AS n
    JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
  LOOP
    IF changed_col = ANY (locked_always) THEN
      RAISE EXCEPTION 'Posters may not modify jobs.%', changed_col
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  -- The money lock only applies once escrow exists.
  IF OLD.payment_status IS DISTINCT FROM 'unpaid' THEN
    FOR changed_col IN
      SELECT n.key
      FROM jsonb_each(to_jsonb(NEW)) AS n
      JOIN jsonb_each(to_jsonb(OLD)) AS o ON o.key = n.key
      WHERE n.value IS DISTINCT FROM o.value
    LOOP
      IF changed_col = ANY (locked_when_funded) THEN
        RAISE EXCEPTION 'Posters may not modify jobs.% after escrow is funded', changed_col
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- R11 — a message recipient could rewrite the sender's messages.
--
-- The "mark as read" policy (USING/CHECK auth.uid() = receiver_id) granted
-- WHOLE-ROW update with no column lock, so the recipient could rewrite
-- `content`, swap `attachment_url`, clear `flagged_hidden`, or even set
-- `sender_id` — fabricated chat evidence in a dispute, and edited content is
-- never re-scanned (the content scan is INSERT-only).
--
-- RLS cannot express a column lock, so this uses column-level privileges,
-- which are enforced independently of (and in addition to) the policy above.
-- `read` is the only column any client writes — verified across
-- useNavUnreadCount, useMessagesRealtime and useMessagesData, all of which
-- write exactly { read: true }.
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT  UPDATE (read) ON public.messages TO authenticated;
