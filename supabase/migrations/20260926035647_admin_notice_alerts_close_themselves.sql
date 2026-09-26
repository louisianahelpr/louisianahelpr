-- Q355, part 2 (docs/OPEN.md): the admin posts that name NO queue close too.
--
-- 20260925155922 gave every admin-QUEUE post (ban review, IDV review, reports,
-- disputes, stalled jobs, stuck payments) a close rule. The rest of the admin
-- fan-outs kept verify_kind 'companions', which can never close them (their
-- only error_logs rows are 'ops-alert' ones, which the companions rule skips).
-- This gives each of them a real question, or, where the database holds no
-- answer, labels it 'manual' so a person closes it with evidence.
--
-- ── SUBJECTS ───────────────────────────────────────────────────────────────
-- The ledger keeps ONE item per title and its sample_ref names only the newest
-- subject, so an earlier job still waiting would be forgotten. And the
-- notifications themselves do not last: a person may delete a read one
-- (20260312232850) and the TTL sweep removes read ones after 30 days. So:
--   * ops_alert_admin_subjects (rule, subject) -> latest alerted_at: written
--     by an AFTER INSERT trigger on public.notifications for every operator
--     notification (admin_alert / system_alert) addressed to an admin whose
--     title has a rule; backfilled once from the notifications still there.
--     No time limit: a job whose money is still held a year on still counts.
--   * admin_alert_subjects(rule, ref, since): that table's rows for the rule,
--     plus the one the item's sample_ref names (alerted at p_since).
--
-- ── RULES (admin_queue_still_pending, restated from 20260925155922 verbatim
--    plus these branches) ──────────────────────────────────────────────────
--   money-held          "Payout blocked — …" (x3), "Scheduled payout failed",
--                       "Transfer failed": still failing while any subject
--                       job's payment_status is 'escrow' or 'payout_pending'
--                       (money held, neither paid out nor refunded). Each
--                       producer leaves the job in exactly those states
--                       (release-payout / process-scheduled-payouts gate on
--                       payout_pending; create-payment's dispute release
--                       re-throws so the job stays disputed in escrow).
--                       A GROUP job reading 'released' also still fails while
--                       a roster member has no pending/paid payout_transfers
--                       row: process-scheduled-payouts' own roster test, and
--                       the stripe-webhook transfer.created handler can flip
--                       a group job to released after ONE member is paid
--                       (docs/OPEN.md Q411), which must not close the alert.
--   arrival-unconfirmed "Arrival not confirmed in 24h", "Arrival near a wrong
--                       pin not confirmed": arrival-confirm-reminder's own
--                       predicate: job accepted/in_progress, helper_arrived_at
--                       set, poster_confirmed_arrival_at NULL.
--   restriction-review  "Auto-restricted (7d|30d): <name>" ("review and
--                       reverse if mistaken"): still failing while the user
--                       is still temp_banned with the suspension running AND
--                       no moderation DECISION on them since the alert.
--   repeat-offender     "Repeat offender: <name>" ("consider a permanent
--                       ban"): still failing until a decision on the user
--                       after the alert, or the user is banned.
--   low-rating          "Low rating alert": still failing while the user
--                       still has a 'low_ratings' violation and no decision
--                       on them since the alert (reversing the violation
--                       deletes it and writes the audit row).
--   A DECISION is an admin_audit_log row targeting the user whose action is
--   one that decides a moderation case: set_ban_status, ban_user, unban_user,
--   reverse_auto_ban, reverse_violation, restrict_applications,
--   formal_warning, final_warning, auto_suspend_3_strikes, confirm_message_ban,
--   dismiss_message_ban_review. A note, a password reset or impersonation is
--   not a review and does not close anything.
--   notice              "New member joined", "Dispute auto-resolved": an
--                       informational notice (adminPushSeverity 'info'), with
--                       nothing to act on. It closes on the next verify.
-- No subject found (a post whose link names no job/user and no notification
-- row) -> NULL: cannot tell, never "cleared". Seed subjects never count.
--
-- ── MANUAL ─────────────────────────────────────────────────────────────────
-- "Cancellation fee transfer failed": the fee transfer lives only in Stripe
-- (void-cancelled-payments writes no payout_transfers row for it, and the
-- job settles to 'refunded' whether or not the Helpr was paid), so no table
-- can say it was fixed. admin_alert_manual_close(title) names it, and a
-- BEFORE INSERT trigger on ops_alert_ledger turns such an item's default
-- 'companions' into 'manual': closed only through ops_alert_close with
-- evidence of the transfer. ops_alert_apply is not changed.
--
-- ops_alert_condition is NOT restated: its 'ops-alert:custom' branch already
-- routes any title admin_alert_close_rule names to admin_queue_still_pending.
-- Existing 'companions' items are re-pointed (sql_condition, or manual).
--
-- Replay-safe: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS, the backfill upserts, the UPDATEs only touch 'companions' rows. Grants: FROM PUBLIC, anon, authenticated;
-- service_role only.

-- ── 1. every subject an item was raised about ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_alert_admin_subjects (
  rule        text        NOT NULL,
  subject_key text        NOT NULL,   -- '<user_id>|<job_id>', either may be empty
  -- a deleted account takes its remembered subjects with it
  user_id     uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  job_id      uuid,
  alerted_at  timestamptz NOT NULL,
  PRIMARY KEY (rule, subject_key)
);
ALTER TABLE public.ops_alert_admin_subjects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ops_alert_admin_subjects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ops_alert_admin_subjects TO service_role;

-- One operator notification to an admin -> one remembered subject.
CREATE OR REPLACE FUNCTION public.ops_alert_note_admin_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rule text;
  v_ref  jsonb;
  v_user uuid;
  v_job  uuid;
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = NEW.user_id AND ur.role = 'admin') THEN
      RETURN NULL;
    END IF;
    v_rule := public.admin_alert_close_rule(NEW.title);
    IF v_rule IS NULL THEN RETURN NULL; END IF;
    v_ref  := public.admin_alert_ref(jsonb_build_object('link', NEW.link));
    v_user := (v_ref ->> 'user_id')::uuid;
    v_job  := coalesce((v_ref ->> 'job_id')::uuid, NEW.job_id);
    IF v_user IS NULL AND v_job IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.ops_alert_admin_subjects AS s (rule, subject_key, user_id, job_id, alerted_at)
    VALUES (v_rule, coalesce(v_user::text, '') || '|' || coalesce(v_job::text, ''), v_user, v_job,
            coalesce(NEW.created_at, now()))
    ON CONFLICT (rule, subject_key) DO UPDATE
      SET alerted_at = greatest(s.alerted_at, EXCLUDED.alerted_at);
  EXCEPTION WHEN OTHERS THEN
    -- Never take down the notification write. Loud in the Postgres log.
    RAISE WARNING 'ops_alert_note_admin_subject: % (notifications.id=%)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_note_admin_subject() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_zz_admin_alert_subject ON public.notifications;
CREATE TRIGGER trg_notifications_zz_admin_alert_subject
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type IN ('admin_alert', 'system_alert'))
  EXECUTE FUNCTION public.ops_alert_note_admin_subject();

CREATE OR REPLACE FUNCTION public.admin_alert_subjects(p_rule text, p_ref jsonb, p_since timestamptz)
RETURNS TABLE (user_id uuid, job_id uuid, alerted_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- The one the item's sample_ref names, alerted at the item's last_seen.
  SELECT (p_ref ->> 'user_id')::uuid, (p_ref ->> 'job_id')::uuid, p_since
   WHERE p_ref ->> 'user_id' IS NOT NULL OR p_ref ->> 'job_id' IS NOT NULL
  UNION
  -- Every subject an admin was ever alerted about under this rule.
  SELECT s.user_id, s.job_id, s.alerted_at
    FROM public.ops_alert_admin_subjects s
   WHERE s.rule = p_rule
$fn$;

REVOKE ALL ON FUNCTION public.admin_alert_subjects(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_subjects(text, jsonb, timestamptz) TO service_role;

-- ── 2. which queue / question a mirrored admin title is about (restated from
--       20260925155922 verbatim, plus the Q355 part 2 rows) ─────────────────
CREATE OR REPLACE FUNCTION public.admin_alert_close_rule(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
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
      ('dispute auto-resolved',                     'notice')
    ) AS r(prefix, rule)
   WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%'
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.admin_alert_close_rule(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_close_rule(text) TO service_role;

-- ── 3. re-ask (restated from 20260925155922 verbatim, plus the part 2 branches)
CREATE OR REPLACE FUNCTION public.admin_queue_still_pending(p_rule text, p_ref jsonb, p_since timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_queue_still_pending(text, jsonb, timestamptz) TO service_role;

-- ── 4. posts only a person can close ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_alert_manual_close(p_title text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM (VALUES
        ('cancellation fee transfer failed', 'manual')
      ) AS r(prefix, rule)
     WHERE public.ops_alert_normalise(p_title) LIKE r.prefix || '%')
$fn$;

REVOKE ALL ON FUNCTION public.admin_alert_manual_close(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alert_manual_close(text) TO service_role;

-- ops_alert_apply gives an edge_slack item with no condition 'companions',
-- which cannot close one of these. Label it 'manual' as it is inserted.
-- ON CONFLICT never rewrites verify_kind, so only the INSERT matters. Never
-- blocks a ledger write.
CREATE OR REPLACE FUNCTION public.ops_alert_ledger_admin_manual()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF NEW.source = 'ops-alert:custom' AND NEW.verify_kind = 'companions' THEN
    BEGIN
      IF public.admin_alert_manual_close(coalesce(public.admin_alert_ref(NEW.sample_ref) ->> 'title', NEW.title)) THEN
        NEW.verify_kind := 'manual';
        NEW.verify_ref  := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ops_alert_ledger_admin_manual: % (title=%)', SQLERRM, NEW.title;
    END;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ops_alert_ledger_admin_manual() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ops_alert_ledger_admin_manual ON public.ops_alert_ledger;
CREATE TRIGGER trg_ops_alert_ledger_admin_manual
  BEFORE INSERT ON public.ops_alert_ledger
  FOR EACH ROW EXECUTE FUNCTION public.ops_alert_ledger_admin_manual();

-- ── 5. remember the subjects already alerted (once; the trigger does the rest)
INSERT INTO public.ops_alert_admin_subjects AS s (rule, subject_key, user_id, job_id, alerted_at)
SELECT x.rule, coalesce(x.user_id::text, '') || '|' || coalesce(x.job_id::text, ''), x.user_id, x.job_id,
       max(x.created_at)
  FROM (SELECT public.admin_alert_close_rule(n.title) AS rule,
               (r.ref ->> 'user_id')::uuid AS user_id,
               coalesce((r.ref ->> 'job_id')::uuid, n.job_id) AS job_id,
               n.created_at
          FROM public.user_roles ur
          JOIN public.notifications n ON n.user_id = ur.user_id
         CROSS JOIN LATERAL (SELECT public.admin_alert_ref(jsonb_build_object('link', n.link)) AS ref) r
         WHERE ur.role = 'admin'
           AND n.type IN ('admin_alert', 'system_alert')) x
 WHERE x.rule IS NOT NULL
   AND (x.user_id IS NOT NULL OR x.job_id IS NOT NULL)
   -- an old link can name a since-deleted account: nothing to remember
   AND (x.user_id IS NULL OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id))
 GROUP BY x.rule, x.user_id, x.job_id
ON CONFLICT (rule, subject_key) DO UPDATE
  SET alerted_at = greatest(s.alerted_at, EXCLUDED.alerted_at);

-- ── 6. re-point the existing items ──────────────────────────────────────────
-- Same shape as 20260925155922 §5, now reaching the new rules.
UPDATE public.ops_alert_ledger l
   SET verify_kind = 'sql_condition',
       verify_ref  = 'ops-alert:custom',
       sample_ref  = l.sample_ref
                     || jsonb_build_object('admin_title', l.title)
                     || coalesce((SELECT jsonb_build_object('admin_link', e.context -> 'fields' ->> 'deep_link')
                                    FROM public.error_logs e
                                   WHERE e.id = CASE WHEN l.sample_ref ->> 'error_log_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                                 THEN (l.sample_ref ->> 'error_log_id')::uuid END
                                     AND jsonb_typeof(e.context -> 'fields') = 'object'
                                     AND e.context -> 'fields' ->> 'deep_link' LIKE '/%'), '{}'::jsonb),
       updated_at  = now()
 WHERE l.source_kind = 'edge_slack'
   AND l.source = 'ops-alert:custom'
   AND l.verify_kind = 'companions'
   AND public.admin_alert_close_rule(l.title) IS NOT NULL;

UPDATE public.ops_alert_ledger l
   SET verify_kind = 'manual', verify_ref = NULL, updated_at = now()
 WHERE l.source_kind = 'edge_slack'
   AND l.source = 'ops-alert:custom'
   AND l.verify_kind = 'companions'
   AND public.admin_alert_manual_close(l.title);
