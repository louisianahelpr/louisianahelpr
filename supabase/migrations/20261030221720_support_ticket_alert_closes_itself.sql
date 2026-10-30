-- The admin alert for a new support ticket closes itself (adminQueueAlertsClose, Q355).
--
-- 20261030212558 added the "New support message" fan-out. An admin with no push token gets it mirrored to #ops-alerts and
-- recorded as an 'ops-alert:custom' ledger item, which needs a close rule or stays open with nothing able to close it.
-- This item closes when no real ticket is pending, whichever way it was resolved (a reply with resolve, or the status
-- control). A reply that leaves the ticket pending keeps it open. It is one item per title, so it asks the whole queue,
-- as ban-settlement-review does. It does not mark any admin's bell notification read.
--
-- Restated from 20261023143240 (md5(prosrc) equal to prod on 2026-10-30: close rule a9719525dc4abe87da4e5bbe27a2a5dc,
-- still pending aa00a5745d48027d8e54e0058f016cc7) with one row and one branch; grants unchanged.
-- Proof: src/test/pglite/supportTicketAlertCloses.pglite.mjs.

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
      ('ownership proof waits for review',          'rentals-ownership-review'),
      -- Landlord ID (20261019051407): a landlord's photo ID waits for an admin.
      ('landlord id waits for review',              'rentals-landlord-id-review'),
      -- 20261023143240: a job whose poster did not approve in time waits for Helpr support.
      ('job waiting on approval',                   'approval-escalation'),
      -- 20261030221720: a support ticket waits for an answer.
      ('new support message',                       'support-ticket')
    ) AS r(prefix, rule)
   WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%'
   LIMIT 1
$function$;;
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

  -- 20261023143240: open while the job's approval escalation is open AND the job still waits on an approval
  -- (live, escrow held, no poster stamp); closes once an admin resolves it or the poster approves.
  ELSIF p_rule = 'approval-escalation' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.job_approval_escalations e
        JOIN public.jobs j ON j.id = e.job_id
       WHERE e.resolved_at IS NULL
         AND j.status::text IN ('in_progress', 'revision_requested', 'accepted')
         AND j.payment_status::text = 'escrow'
         AND j.poster_completed_at IS NULL
         AND (e.job_id = v_job OR j.is_seed IS NOT TRUE));

  -- 20261030221720: open while any real ticket is pending, the queue the Support tab's Pending filter shows; closes once
  -- every one is resolved. A guest has no account, so a nil reporter keeps it open; a seed or test reporter never does.
  ELSIF p_rule = 'support-ticket' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.reports r
        LEFT JOIN public.profiles p ON p.user_id = r.reporter_id
       WHERE r.reported_type = 'support'
         AND r.status = 'pending'
         AND p.is_seed IS NOT TRUE
         AND NOT public.is_test_subject(r.reporter_id));

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

  -- Landlord ID (20261019051407): open while any landlord's ID photo waits;
  -- test (seed) landlords never hold a real alert open, as the rule above.
  ELSIF p_rule = 'rentals-landlord-id-review' THEN
    RETURN EXISTS (SELECT 1 FROM public.landlord_id_reviews lr
                     LEFT JOIN public.profiles p ON p.user_id = lr.user_id
                    WHERE lr.status = 'pending_review' AND p.is_seed IS NOT TRUE);

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
$function$;;
REVOKE ALL ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) TO service_role;
