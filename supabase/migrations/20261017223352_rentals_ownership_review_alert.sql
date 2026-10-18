-- RENTALS slice 3: an admin is told when a landlord's ownership proof waits
-- for review ("no alert when ownership proof waits for review").
--
-- rentals_submit_ownership_proof (20261017205605) put the property in the
-- admin queue (Admin -> Settings -> Rentals: ownership proof) and told nobody.
-- It now sends the admin-queue alert the other queues send (an 'admin_alert'
-- notification to every admin, mirrored to #ops-alerts for an admin with no
-- push token), once per waiting spell, and the alert closes itself the way
-- every admin-queue alert must (src/test/adminQueueAlertsClose.test.ts, Q355):
-- admin_alert_close_rule maps its title to 'rentals-ownership-review', and
-- admin_queue_still_pending answers it from rental_properties (test owners'
-- properties excluded, as idv-review excludes test profiles). A test
-- landlord's upload never pages a real admin: the insert asks
-- notification_crosses_seed_boundary with the landlord as the actor, since
-- the link names none (lh-authz-rls review of e4a59d029 #2).
--
-- SHARED RESTATEMENTS, on the NEWEST bodies (20261006030849 for both, read
-- 2026-10-17 from origin/main and this branch): admin_alert_close_rule and
-- admin_queue_still_pending are copied VERBATIM plus one VALUES row / one
-- ELSIF branch. Any later restatement must start from THIS file's bodies.
-- Grants restated exactly: service_role only, revoked from PUBLIC, anon and
-- authenticated; admin_alert_close_rule also to supabase_read_only_user where
-- that role exists (20261012233929). rentals_submit_ownership_proof is S1's
-- body plus the alert block.
--
-- Replay-safe: CREATE OR REPLACE only; plpgsql resolves rental_properties at
-- run time (created by 20261017205605, an earlier version). Applied 3x in
-- PGlite by src/test/pglite/rentalsMaintenance.pglite.mjs.

CREATE OR REPLACE FUNCTION public.admin_alert_close_rule(p_title text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT r.rule
    FROM (VALUES
      ('ban review needed',                         'ban-review'),
      ('identity verification needs review',        'idv-review'),
      ('user flagged',                              'reported-user'),
      ('dispute escalated',                         'dispute-open'),
      ('escalated dispute overdue',                 'dispute-open'),
      ('dispute stuck — escrow cannot auto-settle', 'dispute-open'),
      ('dispute split did not settle',              'dispute-unsettled'),
      ('job stalled — nobody marked it done',       'stalled-job'),
      ('stuck payment — webhook may be failing',    'stuck-payment'),
      ('payout blocked — ',                          'money-held'),
      ('scheduled payout failed',                   'money-held'),
      ('transfer failed',                           'money-held'),
      ('arrival not confirmed in ',                 'arrival-unconfirmed'),
      ('arrival near a wrong pin not confirmed',    'arrival-unconfirmed'),
      ('auto-restricted (',                         'restriction-review'),
      ('repeat offender: ',                         'repeat-offender'),
      ('low rating alert',                          'low-rating'),
      ('new member joined',                         'notice'),
      ('dispute auto-resolved',                     'notice'),
      -- Q1324: an account banned on a card / bank match waits for an admin.
      ('ban settlement review',                     'ban-settlement-review'),
      -- Rentals slice 3: a landlord's ownership proof waits for an admin.
      ('ownership proof waits for review',          'rentals-ownership-review')
    ) AS r(prefix, rule)
   WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%'
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.admin_alert_close_rule(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO service_role;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN
    GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO supabase_read_only_user;
  END IF;
END
$grant$;

CREATE OR REPLACE FUNCTION public.admin_queue_still_pending(p_rule text, p_ref jsonb, p_since timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := (p_ref ->> 'user_id')::uuid;
  v_job  uuid := (p_ref ->> 'job_id')::uuid;
BEGIN
  IF p_rule = 'ban-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_violations v
       WHERE v.action_taken = 'pending_ban_review'
         AND (v.user_id = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = v.user_id AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'idv-review' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.idv_status = 'manual_review'
         AND (p.user_id = v_user OR p.is_seed IS NOT TRUE))
      OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.user_id = v_user
         AND p.idv_status = 'failed'
         AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target_id = v_user::text
                            AND a.action IN ('manual_verify_user', 'idv_reject', 'request_id_reupload')
                            AND a.created_at > p_since));

  ELSIF p_rule = 'reported-user' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.reports r
       CROSS JOIN LATERAL (
         SELECT CASE WHEN r.reported_type = 'user' THEN r.reported_id
                     ELSE (SELECT a.helper_id FROM public.applications a WHERE a.id = r.reported_id) END AS subject) s
       WHERE r.status IN ('pending', 'new', 'investigating')
         AND r.reported_type IN ('user', 'application')
         AND s.subject IS NOT NULL
         AND (s.subject = v_user
              OR NOT EXISTS (SELECT 1 FROM public.profiles p
                              WHERE p.user_id = s.subject AND p.is_seed IS TRUE)));

  ELSIF p_rule = 'dispute-open' THEN
    -- The whole /admin?view=disputes queue (AdminDisputes.tsx): a job still
    -- 'disputed', or a decided dispute whose settlement has not executed
    -- ("Dispute stuck" is also sent for split_pending, a decided split).
    RETURN EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.status = 'disputed'
         AND (j.id = v_job OR j.is_seed IS NOT TRUE))
      OR public.admin_queue_still_pending('dispute-unsettled', p_ref, p_since);

  ELSIF p_rule = 'dispute-unsettled' THEN
    -- AdminDisputes' unsettled read: decided, execution NULL or not 'executed'.
    RETURN EXISTS (
      SELECT 1 FROM public.disputes d
        LEFT JOIN public.jobs j ON j.id = d.job_id
       WHERE d.status = 'decided'
         AND coalesce(d.execution_status, '') <> 'executed'
         AND (d.job_id = v_job OR j.is_seed IS NOT TRUE));

  ELSIF p_rule = 'stalled-job' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.job_completion_nudges n
        LEFT JOIN public.jobs j ON j.id = n.job_id
       WHERE n.escalated_at IS NOT NULL
         AND n.resolved_at IS NULL
         AND (n.job_id = v_job OR j.is_seed IS NOT TRUE));

  -- Q1324 (20261006030849): still pending while any ban settlement review is
  -- open; closes once every review is confirmed or lifted.
  ELSIF p_rule = 'ban-settlement-review' THEN
    RETURN EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.review_state = 'open');

  -- Rentals slice 3: open while any property's ownership proof waits.
  ELSIF p_rule = 'rentals-ownership-review' THEN
    -- Test (seed) owners never hold a real alert open (as idv-review and the job
    -- rules); a LEFT JOIN, so an owner with no profile row keeps it open.
    RETURN EXISTS (SELECT 1 FROM public.rental_properties rp
                     LEFT JOIN public.profiles p ON p.user_id = rp.owner_id
                    WHERE rp.ownership_status = 'pending_review' AND p.is_seed IS NOT TRUE);

  ELSIF p_rule = 'stuck-payment' THEN
    RETURN public.ops_alert_condition('detect_stuck_payments', '{}'::jsonb, p_since, false);

  -- Q355 part 2 (20260926035647): the posts that name no queue. Each asks
  -- about every subject the item was raised for (admin_alert_subjects).
  ELSIF p_rule = 'notice' THEN
    -- Informational: nothing to act on.
    RETURN false;

  ELSIF p_rule IN ('money-held', 'arrival-unconfirmed') THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
                    WHERE s.job_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
        JOIN public.jobs j ON j.id = s.job_id
       WHERE j.is_seed IS NOT TRUE
         AND CASE p_rule
               WHEN 'money-held' THEN
                 j.payment_status IN ('escrow', 'payout_pending')
                 -- a group job released before every roster member was paid
                 OR (j.is_group_job IS TRUE AND j.payment_status = 'released'
                     AND EXISTS (SELECT 1 FROM public.group_job_helpers g
                                  WHERE g.job_id = j.id AND g.helper_id IS NOT NULL
                                    AND NOT EXISTS (SELECT 1 FROM public.payout_transfers pt
                                                     WHERE pt.job_id = j.id AND pt.helper_id = g.helper_id
                                                       AND pt.status IN ('pending', 'paid'))))
               ELSE j.status IN ('accepted', 'in_progress')
                    AND j.helper_arrived_at IS NOT NULL
                    AND j.poster_confirmed_arrival_at IS NULL
             END);

  ELSIF p_rule IN ('restriction-review', 'repeat-offender', 'low-rating') THEN
    IF NOT EXISTS (SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
                    WHERE s.user_id IS NOT NULL) THEN
      RETURN NULL;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.admin_alert_subjects(p_rule, p_ref, p_since) s
        JOIN public.profiles p ON p.user_id = s.user_id
       WHERE p.is_seed IS NOT TRUE
         -- a moderation DECISION on the person after the alert is the review
         AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a
                          WHERE a.target_id = s.user_id::text
                            AND a.action IN ('set_ban_status', 'ban_user', 'unban_user', 'reverse_auto_ban',
                                             'reverse_violation', 'restrict_applications', 'formal_warning',
                                             'final_warning', 'auto_suspend_3_strikes', 'confirm_message_ban',
                                             'dismiss_message_ban_review')
                            AND a.created_at > s.alerted_at)
         AND CASE p_rule
               WHEN 'restriction-review' THEN
                 p.ban_status = 'temp_banned'
                 AND (p.auto_suspended_until IS NULL OR p.auto_suspended_until > now())
               WHEN 'repeat-offender' THEN
                 coalesce(p.ban_status, '') NOT IN ('banned', 'permanently_banned')
               ELSE EXISTS (SELECT 1 FROM public.user_violations v
                             WHERE v.user_id = s.user_id AND v.violation_type = 'low_ratings')
             END);
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.rentals_submit_ownership_proof(p_property_id uuid, p_storage_path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_uid uuid;
  v_status text;
BEGIN
  PERFORM public.require_feature('rentals');
  IF public.is_caller_banned() THEN
    RAISE EXCEPTION 'account_restricted' USING ERRCODE = '42501';
  END IF;
  PERFORM public.rentals_assert_member();
  v_uid := (SELECT auth.uid());
  SELECT ownership_status INTO v_status FROM public.rental_properties
   WHERE id = p_property_id AND owner_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'already_approved' USING ERRCODE = '22023';
  END IF;
  -- The file must sit in the caller's own folder for THIS property.
  IF p_storage_path IS NULL
     OR p_storage_path !~ format('^%s/rentals/%s/[A-Za-z0-9._-]{1,100}$', v_uid, p_property_id) THEN
    RAISE EXCEPTION 'bad_proof_path' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rental_properties
     SET ownership_proof_path = p_storage_path, ownership_status = 'pending_review',
         ownership_submitted_at = now(), updated_at = now()
   WHERE id = p_property_id;
  -- Slice 3: tell every admin (the admin-queue alert path; it closes itself
  -- through admin_alert_close_rule 'rentals-ownership-review' once no proof
  -- waits). Once per property per waiting spell: a re-upload while it already
  -- waits does not page again. Best effort: a failed alert never refuses the
  -- landlord's upload.
  IF v_status IS DISTINCT FROM 'pending_review' THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      SELECT ur.user_id,
             'Ownership proof waits for review',
             'A landlord sent ownership proof for a property. Check it in Admin -> Settings -> Rentals: ownership proof.',
             'admin_alert',
             '/admin?view=settings'
        FROM public.user_roles ur
       WHERE ur.role = 'admin'
         -- The seed boundary judged with the landlord as the actor (the link
         -- names none): a test landlord never pages a real admin (Q137).
         AND NOT public.notification_crosses_seed_boundary(ur.user_id, NULL, NULL, v_uid);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rentals_submit_ownership_proof: admin alert failed: %', SQLERRM;
    END;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rentals_submit_ownership_proof(uuid, text) TO authenticated, service_role;
