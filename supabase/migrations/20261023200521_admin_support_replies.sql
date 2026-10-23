-- Admin replies to support tickets (owner 2026-10-23, via the lead): Admin Support
-- had only Resolve / Dismiss, so the owner had no way to answer a member who wrote
-- in. The admin-support-reply edge function now sends a reply to the member as an
-- in-app notification AND an email to their account address (queueEmail, so the
-- email_send_log row exists), and records it here so the ticket shows its thread.
--
-- LAYERS
--   write   : ONLY the admin-support-reply edge function, with the service role,
--             after has_role(caller, 'admin'). No client privilege on the table at
--             all: REVOKE ALL FROM PUBLIC, anon, authenticated.
--   read    : admin_support_replies(uuid[]), SECURITY DEFINER, rows only when the
--             caller is an admin (a member gets no rows, never an error). The member
--             reads their reply through their own notification row, never here, so
--             no member can reach another member's ticket or reply.
--   display : AdminSupport.tsx shows the thread under each ticket: who replied, when,
--             whether the in-app notice landed, and the email's latest
--             email_send_log status.
--
-- Replay-safe: every statement is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
-- Applied 3x by src/test/pglite/adminSupportReplies.pglite.mjs.

CREATE TABLE IF NOT EXISTS public.support_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  -- The admin who sent it, from the verified JWT (never the request body).
  -- SET NULL keeps the reply on the ticket if that admin's account is deleted.
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  -- The member's notifications row, NULL when the in-app notice did not land.
  notification_id uuid,
  -- email_send_log.message_id of the email; NULL when none was queued.
  email_message_id text,
  -- Why no email went: no address on file, the address is unconfirmed, or the
  -- enqueue itself failed (not_queued; final, the worker never sees it).
  email_skip_reason text,
  resolved_on_send boolean NOT NULL DEFAULT false,
  -- Each outcome above is written as soon as it is known; this turns true once
  -- the edge function has finished. Until then the reader says the delivery is
  -- NOT RECORDED (NULL / 'unknown'), never "not delivered", so a reply that did
  -- reach the member never invites a second send.
  outcome_recorded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_replies DROP CONSTRAINT IF EXISTS support_replies_body_length;
ALTER TABLE public.support_replies ADD CONSTRAINT support_replies_body_length
  CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000);

ALTER TABLE public.support_replies DROP CONSTRAINT IF EXISTS support_replies_email_skip_reason_valid;
ALTER TABLE public.support_replies ADD CONSTRAINT support_replies_email_skip_reason_valid
  CHECK (email_skip_reason IS NULL OR email_skip_reason IN ('no_address', 'unconfirmed', 'not_queued'));

CREATE INDEX IF NOT EXISTS support_replies_report_created_idx
  ON public.support_replies (report_id, created_at);

ALTER TABLE public.support_replies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_replies FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.support_replies TO service_role;

-- Q807: an account whose email is unconfirmed cannot write the new table.
DO $do$
BEGIN
  IF to_regprocedure('public.attach_unconfirmed_email_gate()') IS NOT NULL THEN
    PERFORM public.attach_unconfirmed_email_gate();
  END IF;
END
$do$;

-- The thread for the tickets on screen. Admin-only inside the function: a
-- non-admin caller gets zero rows.
--   notified     : true / false once known; NULL while the outcome is not recorded.
--   email_status : the NEWEST email_send_log row for the reply's message
--                  (pending / sent / failed = the worker is retrying / suppressed /
--                  dlq), 'not_queued' when queueEmail's own enqueue failed (final),
--                  'no_address' / 'unconfirmed' / 'not_queued' when no email
--                  went (stored on the reply, so it wins over the log), and
--                  'unknown' when nothing is recorded yet.
CREATE OR REPLACE FUNCTION public.admin_support_replies(p_report_ids uuid[])
RETURNS TABLE(
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
SET search_path TO 'public'
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
