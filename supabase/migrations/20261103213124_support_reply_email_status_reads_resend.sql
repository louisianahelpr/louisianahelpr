-- Admin Support showed "Email failed" on 4 replies that DID reach the member (lead 11-03, B70; read-only SQL on
-- prod 2026-11-03). The 4 reply emails of 2026-10-27 dead-lettered ("TTL exceeded (60 minutes)", the backlog
-- 9bed3f4dcb fixed) and were sent again on 2026-10-30 02:06:27Z under NEW message_ids (email_send_log status
-- 'sent'), but support_replies.email_message_id still names the old message, and admin_support_replies read only
-- that message's rows. So the thread said "Email failed" for mail that was delivered.
--
-- Now: when a reply's own email is final-failed ('dlq'), a LATER 'sent' row of the same template to the same
-- recipient that is no other reply's own email counts as its resend, and the reader answers 'resent' ("Emailed
-- (resent)" in SupportReply.tsx). Everything else is unchanged. Read-only reader; same signature, grants and
-- admin-only filter as 20261023200521. No data is changed.
CREATE OR REPLACE FUNCTION public.admin_support_replies(p_report_ids uuid[])
RETURNS TABLE (
  id uuid,
  report_id uuid,
  body text,
  created_at timestamptz,
  admin_name text,
  notified boolean,
  email_status text,
  resolved_on_send boolean,
  outcome_recorded boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    r.id,
    r.report_id,
    r.body,
    r.created_at,
    p.full_name AS admin_name,
    CASE
      WHEN r.notification_id IS NOT NULL THEN true
      WHEN r.outcome_recorded THEN false
      ELSE NULL
    END AS notified,
    CASE
      -- The function's own record of a skipped or failed enqueue wins over the log.
      WHEN r.email_skip_reason IS NOT NULL THEN r.email_skip_reason
      WHEN r.email_message_id IS NOT NULL THEN coalesce((
        SELECT CASE
                 WHEN l.status = 'failed' AND l.error_message LIKE 'enqueue_email:%' THEN 'not_queued'
                 -- A dead-lettered reply sent again later under a new message id.
                 WHEN l.status = 'dlq' AND EXISTS (
                   SELECT 1
                   FROM public.email_send_log s
                   WHERE s.status = 'sent'
                     AND s.template_name = l.template_name
                     AND lower(s.recipient_email) = lower(l.recipient_email)
                     AND s.created_at > l.created_at
                     AND NOT EXISTS (
                       SELECT 1 FROM public.support_replies o WHERE o.email_message_id = s.message_id
                     )
                 ) THEN 'resent'
                 ELSE l.status
               END
        FROM public.email_send_log l
        WHERE l.message_id = r.email_message_id
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 1
      ), 'unknown')
      ELSE 'unknown'
    END AS email_status,
    r.resolved_on_send,
    r.outcome_recorded
  FROM public.support_replies r
  LEFT JOIN public.profiles p ON p.user_id = r.admin_id
  WHERE public.has_role(auth.uid(), 'admin')
    AND r.report_id = ANY (coalesce(p_report_ids, ARRAY[]::uuid[]))
  ORDER BY r.report_id, r.created_at, r.id;
$fn$;

REVOKE ALL ON FUNCTION public.admin_support_replies(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_support_replies(uuid[]) TO authenticated, service_role;
