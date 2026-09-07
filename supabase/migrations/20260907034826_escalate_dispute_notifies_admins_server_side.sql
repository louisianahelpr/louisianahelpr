-- Escalating a dispute told NOBODY, and said it had.
--
-- PostedJobActions escalated by writing `jobs.dispute_status = 'escalated'`
-- from the browser and then fanning out to admins with
-- `supabase.from("user_roles").select("user_id").eq("role","admin")`.
-- `user_roles` has no SELECT policy for an ordinary user — verified against
-- prod: the only readable policy is "Users can read their own roles"
-- (auth.uid() = user_id) — so a poster or helper gets `{ data: [], error:
-- null }`. The loop body never ran, no admin was notified, and the toast
-- still said "an admin will review this and decide."
--
-- This is the same refusal `rpc_open_dispute` documents at length for the
-- FILING path and already solves the same way: notify from a SECURITY DEFINER
-- function that can read `user_roles` and insert notifications.
--
-- It matters more than it did. Escalation is now offered to BOTH parties, and
-- it is the only thing that stops `auto-resolve-disputes` settling the escrow
-- at the 72-hour deadline. An escalation that silently reaches no admin is a
-- dispute that sits until the deadline with nobody watching it.
--
-- ── Two things this deliberately does NOT do ───────────────────────────────
--
-- 1. It does not mirror `disputes.status = 'escalated'`. That value is outside
--    `disputes_status_check`, which admits only open/decided/withdrawn, so the
--    write would raise. The escalation lives on `jobs.dispute_status`, which
--    has no CHECK constraint and is the column `auto-resolve-disputes` reads.
--
-- 2. It does not touch `jobs.status`. AdminDisputes builds its open queue from
--    `jobs WHERE status = 'disputed'`, so leaving that alone is what keeps an
--    escalated dispute visible in the queue that exists to action it.

CREATE OR REPLACE FUNCTION public.rpc_escalate_dispute(_job_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _customer uuid;
  _helper uuid;
  _title text;
  _status text;
  _dispute_status text;
  _other uuid;
  _admin uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- FOR UPDATE for the same reason rpc_open_dispute takes it: two parties can
  -- escalate the same dispute at the same instant, and the second one must
  -- read the first one's write rather than both fanning out to every admin.
  SELECT customer_id, helper_id, title, status::text, dispute_status
    INTO _customer, _helper, _title, _status, _dispute_status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  IF _status <> 'disputed' THEN
    RAISE EXCEPTION 'job is not disputed';
  END IF;

  -- Already escalated is a NO-OP, not an error. Both parties can now escalate
  -- and the control stays on screen; making the second tap fail would show an
  -- error for an action whose desired end state already holds. Returning early
  -- also means the admin fan-out happens exactly once per escalation.
  IF _dispute_status = 'escalated' THEN
    RETURN _job_id;
  END IF;

  -- The two pre-decision values of the mirror column. Anything else
  -- ('auto_resolved', 'resolved') means the dispute is over and there is
  -- nothing left to hand an admin.
  IF _dispute_status IS NOT NULL AND _dispute_status NOT IN ('open', 'helper_responded') THEN
    RAISE EXCEPTION 'dispute is no longer open';
  END IF;

  UPDATE public.jobs
     SET dispute_status = 'escalated'
   WHERE id = _job_id;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  -- The counterparty: the decision just moved to a human and the deadline they
  -- were watching will no longer fire.
  IF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'Dispute escalated to an admin',
      'The dispute on "' || COALESCE(_title, 'a job') ||
        '" was escalated. An admin will decide it — the payment stays on hold until they do.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/my-posts?job=' || _job_id::text
           ELSE '/my-jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- The admins, who are the ones who actually decide it. This is the half that
  -- could not be done from the client at all. `?view=` is what Admin.tsx reads.
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _admin,
      'Dispute escalated',
      '"' || COALESCE(_title, 'a job') || '" dispute has been escalated and needs an admin decision. Payment is on hold.',
      -- `admin_alert`, not `warning`: this is addressed to admins only, and
      -- typing it as a severity puts it in the same preference bucket as
      -- party-facing warnings (N-011).
      'admin_alert',
      '/admin?view=disputes&job=' || _job_id::text
    );
  END LOOP;

  RETURN _job_id;
END;
$function$;

-- Name the roles explicitly. `REVOKE ... FROM PUBLIC` alone does NOT revoke
-- anon: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on every new public
-- function to anon, authenticated and service_role individually, so revoking
-- PUBLIC drops only the implicit world grant and leaves anon's intact.
REVOKE ALL ON FUNCTION public.rpc_escalate_dispute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_escalate_dispute(uuid) TO authenticated;
