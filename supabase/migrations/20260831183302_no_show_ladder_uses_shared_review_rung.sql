-- The no-show ladder stops auto-banning. It now runs on the SAME shared core
-- as every other violation ladder, and its top rung is the same reversible
-- 7-day restriction pending a human decision.
--
-- THE PROBLEM. `report_helper_no_show` was the last bespoke ladder left. Its
-- live definition (20260826060000) hand-wrote its own two rungs:
--
--   v_action := CASE WHEN v_prior_count >= 1 THEN 'permanent_ban' ELSE 'warning' END;
--   ...
--   IF v_action = 'permanent_ban' THEN
--     INSERT INTO public.user_bans (... 'permanent', 'Repeated no-show violations' ...);
--     UPDATE public.profiles SET ban_status = 'permanently_banned' ...;
--
-- So a SECOND no-show permanently and irreversibly banned a Helpr —
-- automatically, with nobody in the loop — off one counterparty tapping a
-- button, on an event the platform never independently verifies. Every other
-- ladder had already been deliberately moved off that design:
-- `apply_message_violation_consequence`, `apply_cancellation_violation_consequence`
-- and `apply_job_denial_consequence` all end in a REVERSIBLE 7-day restriction
-- plus an admin "Ban review needed" notification, via `apply_consequence_ladder`
-- with `p_permanent_requires_review => true` (20260829030000). The comment at
-- 20260826040000:58-64 listed `report_helper_no_show` as one of six functions
-- still awaiting that retrofit. This file is that retrofit.
--
-- THE OWNER'S DECISION. One policy everywhere: a permanent ban always goes
-- through a person. An admin can still issue one from the ban-review queue —
-- it simply stops being automatic.
--
--   1st no-show  -> 'warning'             ban_status = 'final_warning'   (unchanged rung)
--   2nd no-show  -> 'pending_ban_review'  ban_status = 'temp_banned',
--                                         auto_suspended_until = now() + 7 days,
--                                         + admin "Ban review needed" fan-out
--
-- "2nd" still means the second no-show reported by a DIFFERENT poster — GUARD
-- 3b below is preserved verbatim, so one poster acting alone can warn but can
-- never reach the top rung.
--
-- WHAT IS PRESERVED, DELIBERATELY. Every guard survives byte-for-byte:
--   * the FOR UPDATE row lock and the poster-only authorization check;
--   * GUARD 1, the job must be FUNDED — this is what closes the throwaway-job
--     ban attack (post a junk job, assign a rival, report a no-show);
--   * GUARD 2, the clock gate: the scheduled start must have passed;
--   * GUARD 3a, one report per job; GUARD 3b, escalation on DISTINCT reporters;
--   * reopening the job (status = 'open', helper_id = NULL) so the poster can
--     pick another applicant;
--   * the admin notification (the client's own "🚫 No-show reported" fan-out is
--     untouched; the ladder ADDS the "Ban review needed" case that links into
--     /admin?view=banreview, which is what actually puts the case in the queue);
--   * the return shape — {action, prior_count, helper_id, job_title}.
--
-- THE AUDIT TRAIL. The old `user_bans` INSERT is gone because no ban is issued
-- any more; `user_bans` is the record of a BAN, not of a violation. The record
-- that the violation occurred is the `user_violations` row, which the shared
-- core still writes on BOTH rungs with the action it actually applied — and on
-- the top rung that row (`action_taken = 'pending_ban_review'`) IS the case
-- AdminBanReview lists. If the admin then bans, BanDialog writes the `user_bans`
-- row, so the ban ledger still records every ban that is ever issued. This is
-- exactly the posture the other three ladders have had since 20260829030000.
--
-- TWO SMALL BEHAVIOUR CHANGES THAT COME WITH THE SHARED CORE, both deliberate:
--
--   1. p_clamp_to_worse_status => true (matching the message and cancellation
--      wrappers). The old rung-1 write was an unconditional
--      `UPDATE profiles SET ban_status = 'final_warning'`, which meant a first
--      no-show reported against an ALREADY suspended or permanently banned
--      Helpr silently DOWNGRADED them to 'final_warning' — a report that
--      un-banned its subject. Clamping can only ever preserve the harsher
--      standing status; it never makes a consequence lighter than it is today.
--   2. The top rung uses GREATEST(existing, now() + 7 days), so a restriction
--      can never shorten a suspension the Helpr is already serving.
--
-- NO COPY IS PASSED TO THE LADDER (p_copy is [null, null]), which differs from
-- the other three wrappers on purpose: the Helpr-facing notification for a
-- no-show has always been written by the client (useLifecycleHandlers'
-- createNotification call), and having the core send one too would deliver the
-- same news twice. The client's strings move in this same commit, and are read
-- from NO_SHOW_LADDER_SENTENCE in src/lib/reliabilityLadder.ts so the copy
-- cannot drift from this SQL. The ADMIN review notification is server-side, as
-- it must be — it is what files the case.
--
-- MIGRATION OF EXISTING ROWS: none. Queried read-only against production before
-- writing this file: 0 rows in `user_violations` with violation_type='no_show',
-- 0 rows in `user_bans` whose reason matches the no-show text, 0 `user_bans`
-- rows with ban_type='permanent' at all, and 0 profiles with
-- ban_status='permanently_banned'. Nobody was ever banned by the old rule, so
-- there is nothing to reverse — and this migration deliberately does NOT touch
-- any existing ban row. Un-banning anyone is an admin decision, not a side
-- effect of a schema change.
--
-- NO NEW RPC, so no PGRST202 deploy-lag window: the signature
-- `report_helper_no_show(uuid)` is unchanged and the client keeps calling it
-- exactly as before. During the minutes between the frontend deploy and
-- db-deploy.yml applying this file, the RPC may still return the old
-- 'permanent_ban' action — so the client keeps a branch for that string and
-- describes it truthfully rather than mislabelling a real ban as a review.
--
-- REPLAY-SAFETY: a single CREATE OR REPLACE on a function that has existed
-- since 20260518140000, so this is a no-op to re-run and replaces cleanly on a
-- from-scratch rebuild. It creates no new object, drops nothing, and adds no
-- overload (the signature is reproduced exactly). CREATE OR REPLACE preserves
-- the existing ACL, so the GRANT EXECUTE ... TO authenticated from
-- 20260518140000:168 stands and is not restated. Its only new dependency,
-- `public.apply_consequence_ladder`, is created by 20260829030000 — an EARLIER
-- timestamp — so it is present in replay order; and a plpgsql body resolves its
-- calls at execution time, not at creation, so ordering could not break the
-- CREATE regardless.

CREATE OR REPLACE FUNCTION public.report_helper_no_show(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
  v_helper_id uuid;
  v_job_title text;
  v_payment_status text;
  v_date_needed date;
  v_start_time time;
  v_starts_at timestamptz;
  v_prior_count int;
  v_result jsonb;
BEGIN
  -- Trusted ladder — see apply_job_denial_consequence for why this line exists.
  -- (Also releases the jobs field-lock for the server-owned unassign below.)
  PERFORM set_config('app.trusted_ladder_write', 'on', true);

  -- Lock the job row.
  SELECT j.customer_id, j.helper_id, j.title, j.payment_status, j.date_needed, j.start_time
    INTO v_customer_id, v_helper_id, v_job_title, v_payment_status, v_date_needed, v_start_time
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'job_not_found';
  END IF;

  -- Only the job's poster may report a no-show.
  IF v_customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_helper_id IS NULL THEN
    RAISE EXCEPTION 'no_helper_assigned';
  END IF;

  -- GUARD 1 — the job must be funded. Closes the throwaway-job ban attack.
  IF v_payment_status IS NULL OR v_payment_status = 'unpaid' THEN
    RAISE EXCEPTION 'job_not_funded'
      USING HINT = 'A no-show can only be reported on a funded job.';
  END IF;

  -- GUARD 2 — the scheduled start must have passed.
  v_starts_at := (v_date_needed + COALESCE(v_start_time, '00:00'::time))
                   AT TIME ZONE 'America/Chicago';
  IF v_starts_at IS NULL OR now() < v_starts_at THEN
    RAISE EXCEPTION 'job_not_started'
      USING HINT = 'Wait until the scheduled start time before reporting a no-show.';
  END IF;

  -- GUARD 3a — one report per job.
  IF EXISTS (
    SELECT 1 FROM public.user_violations
    WHERE job_id = p_job_id AND violation_type = 'no_show'
  ) THEN
    RAISE EXCEPTION 'already_reported'
      USING HINT = 'This job already has a no-show report.';
  END IF;

  -- GUARD 3b — escalate on DISTINCT reporters, so one poster acting alone
  -- can warn but never reach the top rung.
  SELECT count(DISTINCT reported_by) INTO v_prior_count
  FROM public.user_violations
  WHERE user_id = v_helper_id
    AND violation_type = 'no_show'
    AND reported_by IS DISTINCT FROM auth.uid();

  -- The ladder itself is no longer written here. Same core, same policy switch
  -- as the other three wrappers: 'permanent' + p_permanent_requires_review
  -- becomes 'review' — a reversible 7-day restriction plus an admin case.
  v_result := public.apply_consequence_ladder(
    p_user                      => v_helper_id,
    p_violation_type            => 'no_show',
    p_description               => 'No-show for job: ' || COALESCE(v_job_title, 'Unknown'),
    p_job_id                    => p_job_id,
    p_prior_count               => v_prior_count,
    p_rungs                     => ARRAY['warning', 'pending_ban_review'],
    p_effects                   => ARRAY['final_warning', 'permanent'],
    -- No Helpr-facing copy from the core: the client already sends exactly one
    -- notification for this event (see the header). Casts are required —
    -- jsonb_build_array is VARIADIC "any" and cannot resolve a bare NULL.
    p_copy                      => jsonb_build_array(null::jsonb, null::jsonb),
    p_permanent_requires_review => true,
    p_suspension_days           => 7,
    p_clamp_to_worse_status     => true,
    p_admin_message_format      => '%s has %s no-show reports on file from different posters and is restricted for 7 days pending your decision.',
    -- Unused while p_permanent_requires_review is true; kept verbatim from the
    -- old direct-ban path so that path stays fully specified if the policy is
    -- ever revisited.
    p_ban_reason                => 'Repeated no-show violations'
  );

  -- ATTRIBUTION. The shared core does not know about `reported_by` — it is a
  -- column only the no-show ladder uses, and it is load-bearing: GUARD 3b
  -- counts DISTINCT reporters, and count(DISTINCT reported_by) ignores NULLs,
  -- so an unstamped row would make every future no-show look like a first
  -- offence and the ladder would never escalate at all. GUARD 3a proved above
  -- that this job had NO no_show row before the core inserted one, so this
  -- matches exactly the row just written.
  UPDATE public.user_violations
     SET reported_by = auth.uid()
   WHERE job_id = p_job_id
     AND violation_type = 'no_show'
     AND reported_by IS NULL;

  -- Reopen the job so the poster can pick another applicant.
  UPDATE public.jobs SET status = 'open', helper_id = NULL WHERE id = p_job_id;

  -- Return shape unchanged: the core supplies {action, prior_count}, and the
  -- two fields the client reads for its own notifications are merged back on.
  RETURN v_result || jsonb_build_object(
    'helper_id', v_helper_id,
    'job_title', v_job_title
  );
END;
$function$;
