-- Q1330 (docs/OPEN.md; owner 2026-10-07: option (a)): the Q1244 re-file
-- cooldown GROWS per repeat by the same person on the same job. The flat 10
-- minutes of 20261005062746 still let a determined loop file, page Slack
-- critical and notify both parties about 144 times a day per job.
--
-- Cooldown after the caller's own most recent withdrawal on this job:
--   1st withdrawal -> 10 minutes, 2nd -> 1 hour, 3rd and later -> 24 hours.
-- An append to a still-open dispute is not a new filing (unchanged). The
-- platform's own filings (open_dispute_as called by system paths) never come
-- through rpc_open_dispute, so they stay exempt.
--
-- Restated from its newest definition, 20261005062746 (md5(prosrc) live
-- df531587b1f7a75819faff70879d56d1 = that file), with only the cooldown
-- predicate changed. Grants restated as live: authenticated + service_role,
-- no PUBLIC / anon. Replay-safe: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.rpc_open_dispute(_job_id uuid, _reason text, _evidence_urls text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _withdrawn integer;
  _last_withdrawn timestamptz;
  _cooldown interval;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Q1244: no open/withdraw loop. Take the job lock first (the order
  -- open_dispute_as and rpc_withdraw_dispute use: jobs -> disputes), then
  -- refuse a NEW filing too soon after the caller's own withdrawal on this
  -- job. An append to a still-open dispute is not a new filing.
  -- Q1330: the wait grows with each withdrawal by this person on this job.
  PERFORM 1 FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT EXISTS (
       SELECT 1 FROM public.disputes d
        WHERE d.job_id = _job_id AND d.status = 'open'
     )
  THEN
    SELECT count(*), max(d.decided_at)
      INTO _withdrawn, _last_withdrawn
      FROM public.disputes d
     WHERE d.job_id = _job_id
       AND d.opener_id = _uid
       AND d.status = 'withdrawn';
    _cooldown := CASE
      WHEN _withdrawn >= 3 THEN interval '24 hours'
      WHEN _withdrawn = 2 THEN interval '1 hour'
      ELSE interval '10 minutes'
    END;
    IF _withdrawn > 0 AND _last_withdrawn > now() - _cooldown THEN
      RAISE EXCEPTION 'dispute_refile_cooldown'
        USING HINT = format(
          'You withdrew a dispute on this job recently. Wait %s after the last withdrawal before filing again, or message the other party.',
          CASE WHEN _withdrawn >= 3 THEN '24 hours' WHEN _withdrawn = 2 THEN '1 hour' ELSE '10 minutes' END
        );
    END IF;
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
