-- Notification copy written by SQL names the other party by what they did on
-- the job, never by a role.
--
-- CLAUDE.md: "copy addressing only Helprs or only posters is a defect". The
-- client and edge copy were reworded on 2026-09-15 (roleNeutralCopy.test.ts
-- guards them); the SQL producers were not, so a Helpr still read "has been
-- cancelled by the poster", "The poster viewed your application", "message the
-- customer if you're delayed", and a poster read "visible to all helpers".
-- The wording is the one the app already uses: "the person who posted it /
-- this job" (JobTracking, RPC_ERROR_COPY), "everyone" for the open market.
--
-- HOW: the 20260831232514 / 20260901021929 mechanism. Take
-- pg_get_functiondef() (what Postgres actually has), substitute the named
-- string literal, EXECUTE the result. Only the literals below can change, so
-- no function body is retyped (poster_cancel_job moves money; only its three
-- notification sentences change here). Replay-safe by construction: a function
-- that does not exist, or a pattern that no longer matches (already applied),
-- logs a WARNING and executes nothing.
--
-- NotificationPanel's quick-action pill already matches both "cancelled by the
-- poster" (rows already stored) and "cancelled by the person who posted"
-- (rows from now on), so the pill keeps working on old and new rows.
--
-- NOT here: notify_helper_on_tip ("A poster left you a $…") belongs to the tips
-- lane (ME-006) and stays on the exact known list in the guard.
--
-- Guard: src/test/sqlNotificationCopyRoleNeutral.test.ts (every string literal
-- in an SQL function that writes notifications, read from the EFFECTIVE
-- definitions including these rewrites; exact two-way known list) and
-- src/test/pglite/sqlNotificationCopyRoleNeutral.pglite.mjs (the effective
-- bodies loaded, this file applied 3x, prosrc checked).

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
      (10, 'notify_on_job_update',
           $p$'" has been cancelled by the poster\.'$p$,
           $q$'" was cancelled by the person who posted it.'$q$, ''),
      (20, 'poster_cancel_job',
           $p$was cancelled by the poster$p$,
           $q$was cancelled by the person who posted it$q$, 'g'),
      (30, 'notify_helper_application_viewed',
           $p$'The poster viewed your application for "' \|\| COALESCE\(v_job_title, 'a job'\) \|\| '"\.'$p$,
           $q$'The person who posted "' || COALESCE(v_job_title, 'a job') || '" viewed your application.'$q$, ''),
      (40, 'notify_helper_on_direct_offer',
           $p$COALESCE\(full_name, 'A poster'\)$p$,
           $q$COALESCE(full_name, 'Someone')$q$, ''),
      (50, 'track_revision_scope_creep',
           $p$'The poster has requested '$p$,
           $q$'The person who posted this job has requested '$q$, ''),
      (60, 'check_referral_bonus',
           $p$'You completed your first job as a helper and earned a \$5 referral credit!'$p$,
           $q$'You finished your first job and earned a $5 referral credit!'$q$, ''),
      (61, 'check_referral_bonus',
           $p$'Your referral completed their first job as a helper\. You earned a \$5 credit!'$p$,
           $q$'Your referral finished their first job. You earned a $5 credit!'$q$, ''),
      (70, 'expire_pending_direct_offers',
           $p$The job is now visible to all helpers\.$p$,
           $q$The job is now open to everyone.$q$, ''),
      (80, 'respond_to_direct_offer',
           $p$The job is open to all helpers again\.$p$,
           $q$The job is open to everyone again.$q$, ''),
      (90, 'sweep_no_show_alerts',
           $p$or message the customer if you''re delayed\.$p$,
           $q$or message the person who posted it if you''re delayed.$q$, 'g'),
      (100, 'helper_cancel_booking',
           $p$Message the poster or open a dispute\.$p$,
           $q$Message the person who posted it or open a dispute.$q$, ''),
      (101, 'helper_cancel_booking',
           $p$contact the poster or support\.$p$,
           $q$contact the person who posted it or support.$q$, ''),
      (110, 'helper_abort_job',
           $p$'Tell the poster why you can''t finish\.'$p$,
           $q$'Tell the person who posted it why you can''t finish.'$q$, '')
    ) AS t(ord, fn, pat, rep, flags)
    ORDER BY 1
  LOOP
    v_any := false;
    v_hit := false;

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
      RAISE WARNING 'role-neutral copy %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      RAISE WARNING 'role-neutral copy %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;
