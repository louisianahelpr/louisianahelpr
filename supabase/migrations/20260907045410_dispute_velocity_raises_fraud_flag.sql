-- ═══════════════════════════════════════════════════════════════════════════
-- The dispute-velocity threat becomes true
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two surfaces tell a user, in the moment they are about to freeze somebody's
-- money:
--
--     "3+ disputes in 30 days flags your account for review."
--       src/components/DisputeDialog.tsx  (both the helper and poster lists)
--       src/pages/legal/CommunitySection.tsx  (independently retyped)
--
-- Nothing delivered it. `public.check_dispute_velocity(uuid)` — added
-- 20260325045032 — computes exactly the right predicate (`count(*) < 3` over
-- `interval '30 days'`), and then 20260505225000 revoked EXECUTE from PUBLIC,
-- anon and authenticated on the correct reasoning that it had zero callsites.
-- It still has zero callsites. Verified against prod 2026-09-06:
--
--     proacl = {postgres=X/postgres,service_role=X/postgres}
--
-- So the numbers were right, the function was reachable by nobody, and no
-- account has ever been flagged for dispute velocity. The sentence was a
-- deterrent with nothing behind it.
--
-- ── WHY THIS IS WIRED SERVER-SIDE AND NOT EXPOSED ──────────────────────────
--
-- The obvious repair — grant EXECUTE on `check_dispute_velocity` to
-- `authenticated` — is the wrong one and is deliberately NOT done here. That
-- function takes an ARBITRARY `p_user_id`, so granting it hands every signed-in
-- account a probe for any other account's dispute history. It is SECURITY
-- DEFINER, so RLS would not save us. A whole sweep of this codebase has been
-- spent revoking functions from `anon` for precisely that shape; reintroducing
-- one to make a warning honest would be a bad trade.
--
-- Nor does the copy need a client-callable path at all. It does not promise
-- the user a live counter — it promises that crossing the threshold FLAGS THE
-- ACCOUNT FOR REVIEW. That is a server-side consequence, and the place that
-- knows a dispute was just opened is `rpc_open_dispute`. It is SECURITY
-- DEFINER owned by `postgres`, which already holds EXECUTE, so it can call
-- `check_dispute_velocity` with no grant change whatsoever. The ACL stays
-- exactly as narrow as 20260505225000 left it, and is re-asserted below so a
-- later reader does not "fix" the dead-looking function by opening it up.
--
-- The review queue on the other end is real and already built:
-- `fraud_flags` → `AdminFraudDashboard.tsx` (the unresolved list, and the
-- unresolved count on the admin health card). `high_dispute_rate` is the
-- flag_type that dashboard has ALWAYS had a severity tone for ("danger") and
-- has never had a writer for. This is that writer.
--
-- ── WHY THE COUNT IS A COUNT OF JOBS ───────────────────────────────────────
--
-- `check_dispute_velocity` counts `jobs` rows by `disputed_by` / `disputed_at`,
-- not `disputes` rows. That is the correct denominator and it is not an
-- accident of the older schema: `rpc_open_dispute` stamps `disputed_by`
-- and `disputed_at` on the job in the same statement that flips it to
-- 'disputed', and a re-file on an already-open dispute COALESCEs both rather
-- than restamping. So the number counts DISTINCT JOBS this account opened a
-- dispute on, and appending evidence to your own open dispute cannot inflate
-- it. That is the thing the copy is actually threatening.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Pin the ACL. Replay-safe, and it names the roles.
-- ───────────────────────────────────────────────────────────────────────────
-- `REVOKE ... FROM PUBLIC` does NOT revoke anon: Supabase's ALTER DEFAULT
-- PRIVILEGES grants EXECUTE on every new public function to anon,
-- authenticated and service_role INDIVIDUALLY, so dropping the implicit world
-- grant leaves all three explicit ones standing. Named explicitly here. This
-- is a no-op against today's prod ACL and exists to keep it that way.
-- Guarded on existence, so a later migration that drops the function does not
-- make this file un-replayable.
DO $$
BEGIN
  IF to_regprocedure('public.check_dispute_velocity(uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.check_dispute_velocity(uuid) FROM PUBLIC, anon, authenticated;

    COMMENT ON FUNCTION public.check_dispute_velocity(uuid) IS
      'Dispute-velocity threshold: TRUE while the user is UNDER the limit. Owns the '
      'two numbers the app quotes to users ("3+ disputes in 30 days"). Deliberately '
      'NOT granted to authenticated — it takes an arbitrary user id, so granting it '
      'would let any account probe any other account''s dispute history. Its only '
      'caller is rpc_open_dispute, which is SECURITY DEFINER owned by postgres and '
      'therefore already holds EXECUTE.';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. rpc_open_dispute raises the flag.
-- ───────────────────────────────────────────────────────────────────────────
-- Body is the live 2026-09-06 definition with ONE block added, marked
-- ── DISPUTE VELOCITY ──, after the fresh-dispute UPDATE (which is what stamps
-- disputed_by/disputed_at, so the just-filed dispute is inside the count).
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
  _reason_trimmed text;
  _velocity_count integer;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- A dispute with no explanation freezes someone's money for 72 hours and
  -- hands an admin nothing to decide on. See the header for the three rules.
  _reason_trimmed := btrim(COALESCE(_reason, ''));
  IF _reason_trimmed = ''
     OR right(_reason_trimmed, 1) = ':'
     OR length(_reason_trimmed) < 15
  THEN
    RAISE EXCEPTION 'dispute_needs_description'
      USING HINT = 'Describe what happened — an admin decides this from your words.';
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

    -- NO velocity check on this branch, deliberately. This is a re-file on a
    -- dispute that already exists, and both mirror columns are COALESCEd above
    -- precisely so it does not restamp. The job was already counted the first
    -- time; counting it again here would flag people for uploading a second
    -- photo.
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

  -- ── DISPUTE VELOCITY ────────────────────────────────────────────────────
  -- Delivers "3+ disputes in 30 days flags your account for review."
  --
  -- Runs AFTER the UPDATE above on purpose: that statement is what stamps
  -- disputed_by/disputed_at, so the dispute being filed right now is inside
  -- the window the check counts. check_dispute_velocity returns TRUE while
  -- UNDER the limit, so `NOT ...` is "this filing put them at or past it" —
  -- i.e. the 3rd job in 30 days trips it, which is what "3+" says.
  --
  -- The THRESHOLD and the WINDOW live in check_dispute_velocity and nowhere
  -- else; the count re-derived below is for the admin's eyes only and must
  -- never become the gate, or the two will drift and the copy will be wrong
  -- again.
  --
  -- Wrapped, and this is the one place in this function where swallowing is
  -- correct: the purpose of this RPC is to FREEZE THE MONEY on a contested
  -- job. Failing to file a risk signal must never be the reason a real
  -- dispute does not freeze. The WARNING lands in the Postgres log rather
  -- than vanishing.
  BEGIN
    IF NOT public.check_dispute_velocity(_uid) THEN
      -- One open flag per account at a time. Every further dispute past the
      -- threshold is more of the same signal, and an admin resolving the flag
      -- is what re-arms it — without this, a single bad actor buries the
      -- queue under one row per filing.
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags
        WHERE user_id = _uid AND flag_type = 'high_dispute_rate' AND resolved = false
      ) THEN
        SELECT count(*) INTO _velocity_count
          FROM public.jobs
         WHERE disputed_by = _uid
           AND disputed_at > now() - interval '30 days';

        INSERT INTO public.fraud_flags (user_id, job_id, flag_type, details)
        VALUES (
          _uid,
          _job_id,
          'high_dispute_rate',
          'Opened ' || _velocity_count || ' disputes in the last 30 days, at or over the '
            || 'review threshold. Most recent: "' || COALESCE(_title, 'a job') || '".'
        );
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_open_dispute: dispute-velocity flag failed for % on job %: %',
      _uid, _job_id, SQLERRM;
  END;

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

-- Grants: unchanged from the live ACL (postgres, authenticated, service_role).
-- CREATE OR REPLACE preserves the existing ACL, but naming it makes the
-- intended surface explicit and survives someone recreating the function with
-- DROP + CREATE, where the ACL would be lost and Supabase's default privileges
-- would silently hand anon EXECUTE.
REVOKE EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.rpc_open_dispute(uuid, text, text[]) IS
  'Opens (or re-files onto) a dispute: writes the disputes row, mirrors onto the '
  'legacy jobs.dispute_* columns, freezes the job, notifies the counterparty, the '
  'admins and Slack — and, since 20260907045410, raises a high_dispute_rate '
  'fraud_flag when check_dispute_velocity says this filing put the opener at or '
  'over the threshold the app warns them about.';
