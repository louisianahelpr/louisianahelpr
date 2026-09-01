-- Notification deep links that land where the notification is about.
--
-- Audited every producer that writes `notifications.link` (DB triggers, cron
-- sweeps, RPCs) against the router in src/App.tsx and the filter vocabulary in
-- src/pages/activity/activityFilters.ts, then against the DISTINCT link values
-- actually sitting in prod. Three defect classes came out of it.
--
-- 1. LINKS TO ROUTES THAT DO NOT EXIST. `/warnings`, `/admin/users/<id>` and
--    `/admin/jobs/<id>` have no `<Route>`; every one of them falls through to
--    `path="*"` and renders NotFound. Prod already holds `/warnings` rows.
--    The real screens are `/profile?tab=warnings` (Tab union in
--    src/pages/profile/types.ts) and `/admin?view=people&user=…` /
--    `/admin?view=jobs&job=…` (Admin reads `view`; AdminUsers reads `user`
--    at AdminUsers.tsx:201, AdminJobs reads `job` at AdminJobs.tsx:76).
--
-- 2. LINKS TO A TABBED SCREEN WITHOUT THE TAB. `/profile` opens the landing
--    tab, so "License verified", "Referral bonus earned!" and "Final warning"
--    all dropped the reader on a screen that says nothing about what they
--    were just told. resolveTab() ignores anything not in the valid set, so
--    the tab has to be named exactly.
--
-- 3. LINKS TO AN ACTIVITY SURFACE WITH NO IDEA WHICH BUCKET. This is the big
--    one, and it is why a bare `/my-posts` or `/my-jobs` is never a correct
--    notification link any more. Both routes open on the "Needs you" bucket
--    (defaultStatusFilterFor, activityConstants.ts). "Your Helpr cancelled",
--    "Job cancelled", "Offer expired — job reopened", "Job completed!" — none
--    of those jobs are in Needs You, so tapping the notification produced an
--    empty list. And no fixed `?filter=` can fix it from here: which bucket a
--    job is in is a question about its LIVE state ("whose move is it?"), not
--    about which event fired the notification, and the answer changes while
--    the notification sits unread.
--
--    So they all move to `?job=<id>`, and Activity resolves the bucket at open
--    time (see the deep-link effect in src/pages/Activity.tsx, added in the
--    same change). One link shape, always right, and it stays right.
--    `notify_on_payment_escrowed` and `notify_poster_on_status_change` already
--    linked `?job=` — the param simply had no reader until now.
--
-- Two links are knowingly left alone and reported instead:
--   * notify_business_approvers  → '/business/team?tab=approvals'
--   * review_business_verification → '/business-team'
--   Neither route exists AND neither has any screen behind it anywhere in
--   src/ — the business-team surface was never built. Pointing them at some
--   other page would be a guess, so they stay as-is pending a product call.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW: read the live definition, substitute the link expression, put it back.
--
-- Every change here is one string inside an otherwise-unchanged function body.
-- Re-typing fifteen function bodies to move fifteen string literals is how a
-- transcription bug gets into a trigger that runs on every job, so instead we
-- take `pg_get_functiondef()` — the definition Postgres actually has, not the
-- one a migration file claims it has — apply the substitution, and EXECUTE the
-- result. Nothing but the named expression can change.
--
-- Replay-safe and idempotent by construction: a function that doesn't exist
-- yet is skipped, and a pattern that no longer matches (because the change is
-- already in) is a no-op — `regexp_replace` returns the input unchanged and we
-- don't re-execute. A pattern that matches nothing raises a WARNING so the
-- db-deploy log names it rather than passing silently.
-- ─────────────────────────────────────────────────────────────────────────────

DO $migrate$
DECLARE
  r        record;
  v_oid    oid;
  v_def    text;
  v_new    text;
  v_any    boolean;
  v_hit    boolean;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- ── 1. Routes that do not exist ───────────────────────────────────────
      (10, 'apply_consequence_ladder',
           $p$'/warnings'$p$,
           $q$'/profile?tab=warnings'$q$, 'g'),
      (11, 'apply_job_denial_consequence',
           $p$'/warnings'$p$,
           $q$'/profile?tab=warnings'$q$, 'g'),
      (12, 'auto_escalate_reports',
           $p$'/admin/users/%s'$p$,
           $q$'/admin?view=people&user=%s'$q$, 'g'),
      (13, 'detect_stuck_payments',
           $p$'/admin/jobs/%s'$p$,
           $q$'/admin?view=jobs&job=%s'$q$, 'g'),

      -- ── 2. Tabbed screens, named ──────────────────────────────────────────
      -- Both inserts in review_credential are about a credential; all four in
      -- check_referral_bonus are about a referral credit; the single '/profile'
      -- left in auto_restrict_repeat_violators is the "Final warning" row.
      (20, 'review_credential',
           $p$'/profile'$p$,
           $q$'/profile?tab=credentials'$q$, 'g'),
      (21, 'check_referral_bonus',
           $p$'/profile'$p$,
           $q$'/profile?tab=referral'$q$, 'g'),
      (22, 'auto_restrict_repeat_violators',
           $p$'/profile'$p$,
           $q$'/profile?tab=warnings'$q$, 'g'),

      -- ── 3. Activity links carry the job ───────────────────────────────────
      -- rpc_decide_dispute wrote a bare '/activity' to BOTH parties. '/activity'
      -- is a legacy redirect that resolves to the POSTER surface, so the helper
      -- side of every resolved dispute landed on "My Posts" — someone else's
      -- screen. Each party now goes to their own surface, on the job.
      -- Anchored on the recipient column so the two inserts get different
      -- links; the lazy `.{0,600}?` stops at that insert's own link literal and
      -- is reproduced verbatim by the \1 backreference, so nothing between the
      -- anchor and the link can be disturbed. Plain `.` on purpose: Postgres
      -- regexes are newline-INsensitive by default (no `n` flag passed), so `.`
      -- already spans lines — and `[\s\S]` would be rejected outright, since a
      -- class-shorthand escape like \S is illegal inside a bracket expression.
      (30, 'rpc_decide_dispute',
           $p$(_customer_id,.{0,600}?)'/activity'$p$,
           $q$\1'/my-posts?job=' || _job_id::text$q$, ''),
      (31, 'rpc_decide_dispute',
           $p$(_helper_id,.{0,600}?)'/activity'$p$,
           $q$\1'/my-jobs?job=' || _job_id::text$q$, ''),

      -- Poster-side notifications: the insert is a SELECT over public.jobs, so
      -- the bare `id` column is the job.
      (32, 'expire_pending_direct_offers',
           $p$'/my-posts'$p$,
           $q$'/my-posts?job=' || id::text$q$, 'g'),
      (33, 'respond_to_direct_offer',
           $p$'/my-posts'$p$,
           $q$'/my-posts?job=' || id::text$q$, 'g'),

      -- expire_unanswered_offers notifies both sides off the same locked row.
      (34, 'expire_unanswered_offers',
           $p$'/my-posts'$p$,
           $q$'/my-posts?job=' || v_locked.id::text$q$, 'g'),
      (35, 'expire_unanswered_offers',
           $p$'/my-jobs'$p$,
           $q$'/my-jobs?job=' || v_locked.id::text$q$, 'g'),

      (36, 'helper_cancel_booking',
           $p$'/my-posts'$p$,
           $q$'/my-posts?job=' || v_job.id::text$q$, 'g'),
      -- helper_abort_job has two poster inserts (work had started / never
      -- started). Both want the same job on the same surface, so one
      -- substitution covers both.
      (37, 'helper_abort_job',
           $p$'/my-posts'$p$,
           $q$'/my-posts?job=' || v_job.id::text$q$, 'g'),
      (38, 'poster_cancel_job',
           $p$'/my-jobs'$p$,
           $q$'/my-jobs?job=' || v_job.id::text$q$, 'g'),

      -- block_user_and_settle notifies whichever party was blocked, which can
      -- be either side of the job — so the SURFACE has to be chosen at write
      -- time, not baked in. It was hard-coded to '/my-jobs', which sent a
      -- blocked POSTER to the helper surface.
      (39, 'block_user_and_settle',
           $p$'/my-jobs'$p$,
           $q$CASE WHEN v_job.helper_id = p_blocked THEN '/my-jobs?job=' ELSE '/my-posts?job=' END || v_job.id::text$q$, 'g'),

      -- notify_on_job_update: two helper inserts, distinguished by the `type`
      -- literal that immediately precedes the link. Completion reads NEW,
      -- cancellation reads OLD (the row is already cancelled by then).
      (40, 'notify_on_job_update',
           $p$'payment',\s*'/my-jobs'$p$,
           $q$'payment', '/my-jobs?job=' || NEW.id::text$q$, 'g'),
      (41, 'notify_on_job_update',
           $p$'warning',\s*'/my-jobs'$p$,
           $q$'warning', '/my-jobs?job=' || OLD.id::text$q$, 'g'),

      (42, 'track_revision_scope_creep',
           $p$'/my-posts'$p$,
           $q$'/my-posts?job=' || NEW.id::text$q$, 'g'),
      (43, 'track_revision_scope_creep',
           $p$'/my-jobs'$p$,
           $q$'/my-jobs?job=' || NEW.id::text$q$, 'g'),

      (44, 'sweep_release_last_chance',
           $p$'/my-posts'$p$,
           $q$'/my-posts?job=' || rec.id::text$q$, 'g')
    ) AS t(ord, fn, pat, rep, flags)
    ORDER BY 1
  LOOP
    v_any := false;
    v_hit := false;

    -- Overloads: apply to every function of that name. None of these are
    -- overloaded today, but a loop costs nothing and a LIMIT 1 would silently
    -- fix one of two.
    FOR v_oid IN
      SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = r.fn
         AND p.prokind IN ('f', 'p')
    LOOP
      v_any := true;
      v_def := pg_get_functiondef(v_oid);
      v_new := regexp_replace(v_def, r.pat, r.rep, r.flags);
      IF v_new IS DISTINCT FROM v_def THEN
        EXECUTE v_new;
        v_hit := true;
      END IF;
    END LOOP;

    IF NOT v_any THEN
      RAISE WARNING 'notification link fix %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      -- Either it is already applied (a re-run) or the body drifted from what
      -- this migration was written against. Both are worth seeing in the
      -- deploy log; neither is worth failing the deploy over.
      RAISE WARNING 'notification link fix %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify: nothing in public. still writes a notification link at a route that
-- has no <Route>. This is a WARNING, not a failed migration — the deploy log
-- naming the function is the useful outcome; blocking the whole db-deploy on a
-- link string is not.
-- ─────────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  r record;
BEGIN
  -- `prosrc` (not pg_get_functiondef) on purpose: for a plpgsql function it IS
  -- the body, and unlike pg_get_functiondef it cannot raise on some unrelated
  -- extension function that happens to live in public.
  FOR r IN
    SELECT p.proname, p.prosrc AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND l.lanname = 'plpgsql'
       AND p.prosrc ~ 'INSERT INTO (public\.)?notifications'
  LOOP
    IF r.body ~ $dead$'/warnings'|'/admin/users/|'/admin/jobs/|'/activity'$dead$ THEN
      RAISE WARNING 'public.% still writes a notification link to a route that does not exist', r.proname;
    END IF;
    -- A bare Activity surface with no job on it opens the "Needs you" bucket,
    -- which is the wrong bucket for most events. `?job=` is the shape.
    IF r.body ~ $bare$'/my-(posts|jobs)'$bare$ THEN
      RAISE WARNING 'public.% writes a bare /my-posts or /my-jobs notification link (no ?job= / ?filter=) — it will open on the Needs You bucket', r.proname;
    END IF;
  END LOOP;
END
$verify$;
