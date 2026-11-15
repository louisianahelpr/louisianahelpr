-- Q2789 (ledger a0597e872e21, "job stalled — nobody marked it done"): a stuck job that the two sides finish
-- themselves after it was escalated stays "stuck" forever.
--
-- Measured on prod 2026-11-15 (read-only): job 7b1da54b ("Mow and Weed Eat", a real member job) was escalated on
-- 2026-11-10 13:46Z (job_completion_nudges.escalated_at), then the Helpr marked it done and the poster approved it on
-- 2026-11-14 03:20Z (status completed, payout_pending). Nobody pressed "Mark Reviewed", so resolved_at stayed NULL and:
--   * admin_queue_still_pending('stalled-job') still answered TRUE, so ops_alert_verify kept the Slack item open
--     ("still failing when re-asked at 2026-11-15 18:01Z");
--   * admin_stalled_job_queue(false) still listed it (and the rail badge counted it) on Admin -> Stuck jobs.
-- Nothing else marks the row: the sweep only stops nudging a job that left the trap.
--
-- The fix asks the job itself, with the sweep's own predicate (completionStalled in
-- supabase/functions/_shared/stalledCompletion.ts): in progress, neither done stamp on. Read-only: no row is written,
-- no money moves; a job that leaves the trap another way is in its own queue (approval escalation once the Helpr
-- marks it done, disputes once disputed). The "include resolved" history tab is unchanged.
--
-- Both functions are restated from their NEWEST definitions (admin_queue_still_pending: 20261030221720;
-- admin_stalled_job_queue: 20261108214605) with only the lines marked CHANGED 20261115185124.
-- Proof: src/test/pglite/stalledQueueDropsFinishedJobs.pglite.mjs. Guard: src/test/stalledQueueDropsFinishedJobs.test.ts.

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
         -- CHANGED 20261115185124 (Q2789): only while the job is STILL in the trap, the sweep's own predicate
         -- (completionStalled, supabase/functions/_shared/stalledCompletion.ts): in progress and neither side's
         -- done stamp on. A job the two sides finished themselves, or one that left in_progress any other way
         -- (cancelled, disputed: its own queue), no longer waits on an admin here.
         AND j.status::text = 'in_progress'
         AND j.helper_completed_at IS NULL
         AND j.poster_completed_at IS NULL
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

CREATE OR REPLACE FUNCTION public.admin_stalled_job_queue(p_include_resolved boolean DEFAULT false)
 RETURNS TABLE(job_id uuid, title text, customer_id uuid, helper_id uuid, budget numeric, date_needed date, start_time time without time zone, estimated_hours numeric, status text, payment_status text, first_sent_at timestamp with time zone, second_sent_at timestamp with time zone, escalated_at timestamp with time zone, resolved_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    n.job_id,
    j.title,
    j.customer_id,
    j.helper_id,
    j.budget,
    -- Owner bug 11-03: a job in progress with an open SET continue day is dated by that day.
    coalesce(c.new_date, j.date_needed),
    CASE WHEN c.new_date IS NOT NULL THEN c.new_start_time ELSE j.start_time END,
    j.estimated_hours,
    j.status::text,
    j.payment_status::text,
    n.first_sent_at,
    n.second_sent_at,
    n.escalated_at,
    n.resolved_at
  FROM public.job_completion_nudges n
  JOIN public.jobs j ON j.id = n.job_id
  LEFT JOIN LATERAL (
    SELECT d.new_date, d.new_start_time, d.status
      FROM public.job_continue_days d
     -- 20261108214605 (owner #4): a day closed as 'lapsed' by a missed-return report also dates the row.
     WHERE d.job_id = j.id AND j.status = 'in_progress'
       AND ((d.status = 'set' AND d.closed_at IS NULL) OR d.status = 'lapsed')
     ORDER BY d.created_at DESC
     LIMIT 1
  ) c ON true
  WHERE n.escalated_at IS NOT NULL
    -- Server-side authorization: non-admins get no rows, not an error.
    AND public.has_role(auth.uid(), 'admin')
    AND (coalesce(p_include_resolved, false) OR n.resolved_at IS NULL)
    -- CHANGED 20261115185124 (Q2789): the open list (and its rail badge) holds only jobs still in the trap: in
    -- progress and neither side's done stamp on. A job finished after it was escalated stays in the history tab.
    AND (coalesce(p_include_resolved, false)
         OR (j.status::text = 'in_progress' AND j.helper_completed_at IS NULL AND j.poster_completed_at IS NULL))
    -- Owner bug 11-03 (lead): a job whose open SET day is today or still ahead (Central) is not stalled. It is left
    -- out of the queue and its rail badge; it comes back once that day passes without the job finishing.
    -- 20261108214605: a LAPSED day (reported missed) is never "still ahead": its report is the queue item.
    AND NOT (c.status = 'set' AND c.new_date IS NOT NULL AND c.new_date >= (now() AT TIME ZONE 'America/Chicago')::date)
  ORDER BY n.escalated_at ASC, n.job_id ASC;
$function$;
REVOKE ALL ON FUNCTION public.admin_stalled_job_queue(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stalled_job_queue(boolean) TO authenticated, service_role;
