-- Q1945: a stranger can no longer take row locks on another member's Declutter order and delivery task.
--
-- What was broken: every member RPC on a Helpr delivery task (picked up, delivered, release, confirm, the
-- stuck-delivery steps, the seller's handover and move, the task chat, ...) calls helpr_task_lock FIRST, and
-- helpr_task_lock takes the Declutter order lock (declutter_lock_order) and the task row lock before the RPC
-- checks the caller is the task's Helpr, buyer or seller. So any signed-in member who knew a task id held
-- those locks until the refusal ('task_not_found'), stalling the real parties and the sweeps for that time.
--
-- The fix: helpr_task_lock checks the caller on its existing UNLOCKED read, before any lock. A member call
-- (auth.uid() set) from someone who is not the task's Helpr, customer (buyer) or pickup contact (seller), and
-- not an admin, is refused 'task_not_found' (P0002, the same answer each RPC gives a stranger) while the task
-- is not open. An OPEN task is still locked for any member: taking an open delivery (helpr_task_accept) is
-- how a Helpr becomes its party, and accept re-checks the status under the lock. Service-role callers (the
-- sweeps, the webhooks: public.is_server_context()) are unchanged. Each RPC still re-checks its own party rule on the
-- locked row, so a party that changed between the read and the lock is still refused there.
--
-- Restated from 20261017055505 (the newest definition), changes marked Q1945.
-- Replay-safe: CREATE OR REPLACE, REVOKE/GRANT as before (service role only).
-- Proof: src/test/pglite/helprTaskLockChecksCallerFirst.pglite.mjs.

CREATE OR REPLACE FUNCTION public.helpr_task_lock(p_task uuid)
RETURNS public.helpr_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  t public.helpr_tasks;
  v_uid uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Q1945: a member who is no party to a task that is not open takes no lock. is_server_context(), not
  -- v_uid IS NOT NULL: anon has a NULL uid too (20260915101102); only the service role skips the check.
  IF NOT public.is_server_context() AND t.status IS DISTINCT FROM 'open'
     AND v_uid IS DISTINCT FROM t.helpr_id AND v_uid IS DISTINCT FROM t.customer_id
     AND v_uid IS DISTINCT FROM t.pickup_contact_id
     AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF t.source_kind = 'declutter_delivery' THEN
    PERFORM public.declutter_lock_order(t.source_id);
  END IF;
  SELECT * INTO t FROM public.helpr_tasks WHERE id = p_task FOR UPDATE;
  RETURN t;
END;
$fn$;
REVOKE ALL ON FUNCTION public.helpr_task_lock(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.helpr_task_lock(uuid) TO service_role;
