-- The ops Slack alert for a filed dispute has never been delivered.
--
-- DisputeDialog.tsx:206 called `fireSlackAlert`, which invokes the
-- `slack-ops-alert` edge function from the BROWSER, carrying the filer's user
-- JWT. That function is internal-only: it accepts `Bearer <CRON_SECRET>` or
-- `Bearer <service-role key>` and nothing else (slack-ops-alert/index.ts:122-134),
-- so every call from the client returned 401. The call sat inside
-- `.catch(report)` — non-blocking by design — so the dialog reported success
-- and the channel stayed empty. This is the identical defect 20260831153813
-- found in the cancel survey; that one had the same helper, the same
-- credential mismatch and the same silence for the life of the product.
--
-- Severity note: 20260901032007 moved the in-app admin notification into
-- `rpc_open_dispute`, so admins are no longer blind — the dashboard bell does
-- fire. Only the Slack page-someone channel was dead, on the one alert that
-- says real money is frozen.
--
-- The fix is not a better client call — a browser can never hold either
-- accepted credential, and the only way to make one work would be to weaken
-- the gate that stops anyone on the internet posting phishing links into the
-- ops channel. It fires from the one place that already holds the
-- service-role key: this SECURITY DEFINER function, through pg_net, in the
-- same shape as the eight SQL cron watchers (20260828010000:113,
-- 20260901030926:308 and friends).
--
-- Replay-safe: CREATE OR REPLACE throughout.

-- ---------------------------------------------------------------------------
-- The alert itself, factored out so both dispute paths post the same shape.
-- ---------------------------------------------------------------------------
-- Non-fatal in every failure mode, and that is the whole design. A dispute
-- freezes escrow; a Slack outage, a missing vault secret or an uninstalled
-- pg_net must never be the reason a filing fails. The durable record is the
-- `disputes` row plus the notifications rpc_open_dispute writes — Slack is the
-- page, not the ledger.
CREATE OR REPLACE FUNCTION public.notify_ops_dispute_filed(
  _job_id    uuid,
  _job_title text,
  _reason    text,
  _opener_id uuid,
  _refiled   boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  v_url := public.get_supabase_url();
  v_key := public.get_service_role_key();

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'notify_ops_dispute_filed: vault secrets missing — Slack alert skipped for job %', _job_id;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/slack-ops-alert',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'kind',     'dispute_filed',
      'severity', 'critical',
      'title',    CASE WHEN _refiled THEN 'Job re-disputed — escrow re-frozen'
                       ELSE 'Job disputed' END,
      'message',  '*' || COALESCE(_job_title, 'a job') || '* — ' || COALESCE(_reason, 'no reason given')
                  || '. Payment is on hold pending admin review.',
      'fields',   jsonb_build_object(
        'Job ID',      _job_id::text,
        'Reason',      COALESCE(_reason, '—'),
        'Disputed by', _opener_id::text,
        'Re-filed',    CASE WHEN _refiled THEN 'yes' ELSE 'no' END
      ),
      -- `?view=`, not `?tab=`. Admin.tsx reads searchParams.get("view")
      -- (Admin.tsx:86) and falls back to "home" for anything else, so a
      -- `?tab=disputes` link drops the responder on the admin landing page
      -- with no idea which queue to open.
      'link',     'https://www.louisianahelpr.com/admin?view=disputes'
    )
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_net absent, http_post signature changed, vault unreadable — none of
  -- these are worth failing a dispute over.
  RAISE WARNING 'notify_ops_dispute_filed: alert not posted for job %: %', _job_id, SQLERRM;
END;
$function$;

COMMENT ON FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean) IS
  'Posts the ops Slack alert for a filed dispute via pg_net using the vaulted '
  'service-role key. Lives server-side because slack-ops-alert accepts only '
  'CRON_SECRET or the service-role key, so the browser call this replaces '
  '(DisputeDialog.tsx via src/lib/slackAlerts.ts) returned 401 every time. '
  'Never raises.';

-- Internal only. Nothing outside a SECURITY DEFINER function owned by the same
-- role has any business posting to the ops channel — that is precisely the
-- gate slack-ops-alert enforces at the HTTP layer, and handing `authenticated`
-- EXECUTE here would reopen it from the other side.
REVOKE ALL ON FUNCTION public.notify_ops_dispute_filed(uuid, text, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- rpc_open_dispute: same body as 20260901032007, plus the two alert calls.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_open_dispute(_job_id uuid, _reason text, _evidence_urls text[])
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
  _existing_id uuid;
  _new_id uuid;
  _other uuid;
  _admin uuid;
  _refroze boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- FOR UPDATE, restored. Without the lock two parties filing at the same
  -- instant each read "no open dispute" and both insert. The unique index
  -- added in 20260901032007 is the backstop; this is what makes the loser WAIT
  -- and then take the existing-dispute branch instead of erroring.
  SELECT customer_id, helper_id, title, status::text
    INTO _customer, _helper, _title, _status
    FROM public.jobs WHERE id = _job_id FOR UPDATE;

  IF _customer IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  IF _uid <> _customer AND _uid <> _helper THEN
    RAISE EXCEPTION 'not authorized for this job';
  END IF;

  _other := CASE WHEN _uid = _customer THEN _helper ELSE _customer END;

  SELECT id INTO _existing_id
  FROM public.disputes
  WHERE job_id = _job_id AND status = 'open'
  LIMIT 1;

  IF _existing_id IS NOT NULL THEN
    UPDATE public.disputes
    SET evidence_urls = evidence_urls || COALESCE(_evidence_urls, '{}'::text[])
    WHERE id = _existing_id;

    -- Mirror the appended evidence so the poster card and admin queue that
    -- read the legacy array don't diverge from the disputes row.
    UPDATE public.jobs
       SET dispute_evidence_urls =
             COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
     WHERE id = _job_id;

    -- RE-FREEZE. An open `disputes` row on a job that is NOT disputed is the
    -- shape auto-resolve-disputes leaves behind (it writes `jobs`, never this
    -- table), and this branch used to RETURN without touching the job — so a
    -- re-file inside the payout hold appended evidence, reported success, and
    -- left the escrow free to pay out. Only re-freeze from a state the
    -- transition matrix allows, so this can never raise on a job that has
    -- legitimately moved on.
    IF _status <> 'disputed' AND _status IN ('completed', 'in_progress', 'revision_requested', 'accepted') THEN
      UPDATE public.jobs
         SET status = 'disputed',
             disputed_by = COALESCE(disputed_by, _uid),
             disputed_at = COALESCE(disputed_at, now()),
             dispute_status = 'open'
       WHERE id = _job_id;
      _refroze := true;
    END IF;

    -- Page ops on a re-freeze but not on a bare evidence append. A re-freeze
    -- means money was one payout-hold away from leaving on a job somebody is
    -- still contesting; an extra photo on an already-frozen dispute is not
    -- news at 3am.
    IF _refroze THEN
      PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, true);
    END IF;

    RETURN _existing_id;
  END IF;

  INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)
  VALUES (_job_id, _uid, _reason, COALESCE(_evidence_urls, '{}'::text[]))
  RETURNING id INTO _new_id;

  -- ONE statement: status + the mirror columns together, so the
  -- set_dispute_deadline trigger (BEFORE UPDATE, keyed on the flip to
  -- 'disputed') sees a non-null disputed_at and can derive the 72h deadline.
  UPDATE public.jobs
     SET status = 'disputed',
         disputed_by = _uid,
         disputed_at = now(),
         dispute_reason = _reason,
         dispute_status = 'open',
         dispute_evidence_urls =
           COALESCE(dispute_evidence_urls, '{}'::text[]) || COALESCE(_evidence_urls, '{}'::text[])
   WHERE id = _job_id;

  -- ── Tell the people this affects ────────────────────────────────────────
  -- The counterparty first: their money or their payout just froze, and
  -- until now the only thing that told them was a chat system message that
  -- inserts nothing when the two have never messaged.
  --
  -- `?job=<id>`, never a fixed `?filter=`: `disputed` has no chip of its own,
  -- so the job sits in whichever bucket the receiving surface computes, and a
  -- hardcoded filter is wrong the moment that bucket changes.
  IF _other IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _other,
      'A dispute was opened',
      'A dispute was opened on "' || COALESCE(_title, 'a job') ||
        '". The payment is on hold while it is reviewed — add your side so an admin hears both.',
      'warning',
      CASE WHEN _other = _customer
           THEN '/my-posts?job=' || _job_id::text
           ELSE '/my-jobs?job=' || _job_id::text
      END
    );
  END IF;

  -- Then the admins, who are the ones who actually resolve it. Done here
  -- because it CANNOT be done from the client: `user_roles` is unreadable to
  -- a normal user and the notifications INSERT policy is admin/service-role
  -- only. `?view=` is what Admin.tsx reads (it falls back to "home" for
  -- anything else, which is where the old `?tab=disputes` link landed).
  FOR _admin IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      _admin,
      'Job disputed',
      '"' || COALESCE(_title, 'a job') || '" has been disputed. Payment is on hold pending review.',
      'warning',
      '/admin?view=disputes'
    );
  END LOOP;

  -- And page ops in Slack. This is the call DisputeDialog.tsx used to make
  -- from the browser, where it 401'd on every filing since launch.
  PERFORM public.notify_ops_dispute_filed(_job_id, _title, _reason, _uid, false);

  RETURN _new_id;
END;
$function$;

COMMENT ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) IS
  'Opens (or appends evidence to) the one open dispute on a job, freezes the '
  'job in ''disputed'', notifies the counterparty plus every admin, and pages '
  'ops in Slack. Both fan-outs live here because neither is possible from the '
  'client: user_roles is unreadable to a normal user, the notifications INSERT '
  'policy is admin/service-role only, and slack-ops-alert accepts only '
  'CRON_SECRET or the service-role key.';

REVOKE ALL ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated;
