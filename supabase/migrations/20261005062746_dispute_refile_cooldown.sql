-- Q1244 (docs/OPEN.md): a party could open and withdraw a dispute in a loop.
--
-- rpc_open_dispute and rpc_withdraw_dispute are EXECUTE-able by authenticated
-- and flip a job between disputed and its prior status as often as a party
-- likes. Every NEW filing inserts a disputes row, pages Slack as critical
-- (notify_ops_dispute_filed, called from open_dispute_as) and notifies the
-- other party and the admins; open_dispute_as had no cooldown (its only
-- interval is the 30-day velocity count, which flags and refuses nothing).
--
-- Now rpc_open_dispute, the people's door, refuses a NEW filing by the same
-- person on the same job within 10 minutes of a dispute THEY withdrew there
-- (disputes.status = 'withdrawn', decided_at stamped by rpc_withdraw_dispute),
-- with the code dispute_refile_cooldown. Not refused:
--   * the other party (their grievance is new, not a loop);
--   * an append to a dispute that is still open (open_dispute_as's re-file
--     branch: no new row, no new page);
--   * the platform's own filings (open_dispute_as called with a NULL opener by
--     auto-release-payment's undelivered-revision sweep), which do not pass
--     through this door.
-- helper_abort_job files through this door too, so a Helpr who withdrew their
-- own dispute in the last 10 minutes waits before Cancel Job files the next one
-- (rare; the same message says when to retry).
-- The check runs under the jobs row lock open_dispute_as also takes first, so
-- a withdraw and a re-file racing each other serialise on it.
--
-- Body otherwise verbatim from 20260912023326 (= live 2026-10-05, read with
-- pg_get_functiondef). Grants restated. Replay-safe: CREATE OR REPLACE.
-- Guard: src/test/disputeRefileCooldown.test.ts +
-- src/test/pglite/disputeRefileCooldown.pglite.mjs.
CREATE OR REPLACE FUNCTION public.rpc_open_dispute(_job_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Q1244: no open/withdraw loop. Take the job lock first (the order
  -- open_dispute_as and rpc_withdraw_dispute use: jobs -> disputes), then
  -- refuse a NEW filing within 10 minutes of the caller's own withdrawal on
  -- this job. An append to a still-open dispute is not a new filing.
  PERFORM 1 FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT EXISTS (
       SELECT 1 FROM public.disputes d
        WHERE d.job_id = _job_id AND d.status = 'open'
     )
     AND EXISTS (
       SELECT 1 FROM public.disputes d
        WHERE d.job_id = _job_id
          AND d.opener_id = _uid
          AND d.status = 'withdrawn'
          AND d.decided_at > now() - interval '10 minutes'
     )
  THEN
    RAISE EXCEPTION 'dispute_refile_cooldown'
      USING HINT = 'You withdrew a dispute on this job a few minutes ago. Wait 10 minutes before filing again, or message the other party.';
  END IF;

  -- One creation path. Everything this function used to do inline — the
  -- description guard, the FOR UPDATE, the party check, the existing-dispute
  -- re-freeze, the velocity flag, the notifications and the Slack page — now
  -- lives in open_dispute_as, so the platform's own filings cannot drift from
  -- the ones people make.
  RETURN public.open_dispute_as(_job_id, _uid, _reason, _evidence_urls);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated, service_role;
