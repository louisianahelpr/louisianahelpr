-- A notification link may never carry a FIXED ?filter=.
--
-- 20260831232514_notification_links_land_on_the_right_spot.sql established the
-- rule and converted every producer that wrote a BARE '/my-posts' / '/my-jobs'
-- to '?job=<id>'. It did not convert the producers that wrote a fixed
-- '?filter=', and its verify block only warns on the bare form — so none of
-- them tripped it and the defect survived two sweeps that each believed they
-- were complete.
--
-- MEASURED IN PROD, 2026-08-31 (1619 rows in public.notifications):
--   84 rows carry a fixed ?filter=.
--   18 of them name a filter that is still a CHIP.
--   66 name a key with NO CHIP AT ALL:
--       offered 33 · in_progress 17 · completed 8 · not_selected 4 ·
--       open 3 · revision 1
--   The chip strip is five buckets — needs_you / scheduled / waiting / done /
--   cancelled (src/pages/activity/activityFilters.ts). The legacy enum keys
--   still work as filter VALUES (deliberately: old links must not break), but
--   they have no chip, so the reader lands on a filtered list with nothing on
--   the strip showing as selected and no way to tell what they are looking at.
--
-- WHY A FIXED FILTER IS WRONG EVEN WHEN IT NAMES A LIVE CHIP. Which bucket a
-- job is in is a question about its LIVE state ("whose move is it?"), and the
-- answer changes while the notification sits unread:
--   * '?filter=scheduled' is wrong the moment the job's day passes — an
--     overdue job buckets to "Needs you" whatever its status (jobIsOverdue).
--   * '?filter=cancelled' on a declined application looks terminal, but
--     respond_to_direct_offer() promotes that same applications row back to
--     'accepted' (ON CONFLICT DO UPDATE), and the card leaves Cancelled.
--   * '?filter=needs_you' on a completion claim is wrong as soon as the poster
--     approves it.
-- So this migration keeps ZERO fixed filters. Every converted site had a job
-- id in scope; none needed one.
--
-- AND A STALE FILTER ACTIVELY DEFEATS THE FIX: Activity's deep-link effect
-- gives an explicit '?filter=' precedence over '?job=' resolution
-- (`deepLinkHadFilter`, src/pages/Activity.tsx), so passing both is worse than
-- passing neither.
--
-- The client and edge-function halves of this same sweep ship alongside:
-- create-payment (8 sites), auto-expire-jobs (2), auto-resolve-disputes (2),
-- auto-release-payment (2), payment-confirm-reminder (1), JobConfirmation,
-- useOfferHandlers (2), useLifecycleHandlers (2), CompletionChoiceSheet,
-- HelperRevisionCard, PostedJobActions, DisputedSection, JobTracking.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- HOW: identical mechanism to 20260831232514 — take pg_get_functiondef() (the
-- definition Postgres actually has, not the one a migration file claims it
-- has), substitute the named link expression, EXECUTE the result. Nothing but
-- that expression can change, and re-typing four function bodies to move six
-- string literals is how a transcription bug gets into a trigger that fires on
-- every job.
--
-- Replay-safe by construction: a function that does not exist is skipped with a
-- WARNING; a pattern that no longer matches (because the change is already in)
-- leaves regexp_replace's input unchanged and nothing is executed. Applying
-- this file N times is identical to applying it once.
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
      -- ── sweep_dayof_confirm_reminders — the 33 '?filter=offered' rows ─────
      -- Three inserts across two passes; every one of them loops over a
      -- `rec` selected from public.jobs with `j.id` first in the target list,
      -- so `rec.id` is the job on all three. 'g' covers pass 1 + pass 2 in one
      -- substitution.
      --
      -- 'offered' is the single biggest chip-less key in prod. It is also not
      -- a stable answer: this reminder fires on an ACCEPTED job the day before
      -- it runs, so the helper's card is "Needs you" while the offer is held
      -- for them and "Scheduled" the moment they confirm — which is the exact
      -- action the notification is asking for.
      (10, 'sweep_dayof_confirm_reminders',
           $p$'/my-jobs\?filter=offered'$p$,
           $q$'/my-jobs?job=' || rec.id::text$q$, 'g'),
      (11, 'sweep_dayof_confirm_reminders',
           $p$'/my-posts\?filter=offered'$p$,
           $q$'/my-posts?job=' || rec.id::text$q$, 'g'),

      -- ── notify_poster_on_status_change — the 18 "real chip" rows ──────────
      -- 20260829061546 moved this OFF '/my-posts?job=' || id and ONTO fixed
      -- filters, because at the time nothing on the page read `job`. Activity
      -- reads it now (20260831232514), so this reverts to the job — which is
      -- the shape that was right all along.
      --
      -- Both filters name live chips, and both are still wrong. 'scheduled'
      -- is a promise about the future: the same in-progress job is in "Needs
      -- you" once its day has gone (jobIsOverdue), and a transit notification
      -- easily sits unread across that boundary. 'needs_you' is right at the
      -- instant the helper claims completion and wrong as soon as the poster
      -- approves or sends it back.
      (20, 'notify_poster_on_status_change',
           $p$'/my-posts\?filter=scheduled'$p$,
           $q$'/my-posts?job=' || NEW.id::text$q$, 'g'),
      (21, 'notify_poster_on_status_change',
           $p$'/my-posts\?filter=needs_you'$p$,
           $q$'/my-posts?job=' || NEW.id::text$q$, 'g'),

      -- ── notify_helper_on_direct_offer ─────────────────────────────────────
      -- 'direct_offer' has no chip. `?job=` DOES resolve here even though a
      -- pending direct offer has no applications row: useActivityData
      -- fabricates an AppliedApp carrying `job_id` from
      -- get_my_pending_direct_offers(), and Activity's deep-link effect
      -- matches on `a.job_id`. It buckets to "Needs you" (needsHelperResponse
      -- → direct_offer_status = 'pending'). Once the offer lapses the
      -- synthetic row is gone and the link falls back to the default bucket —
      -- which is also "Needs you", so this link never degrades.
      (30, 'notify_helper_on_direct_offer',
           $p$'/my-jobs\?filter=direct_offer'$p$,
           $q$'/my-jobs?job=' || NEW.id::text$q$, 'g'),

      -- ── notify_on_application ─────────────────────────────────────────────
      -- The decline link. See the note at the top on why 'cancelled' is not
      -- terminal. Kept in lockstep with useOfferHandlers.declineApplication,
      -- its deploy-lag twin, which moves to the same shape in this change.
      (40, 'notify_on_application',
           $p$'/my-jobs\?filter=cancelled'$p$,
           $q$'/my-jobs?job=' || NEW.job_id::text$q$, 'g'),
      -- AND the bare '/my-posts' on the "New application" insert — a producer
      -- 20260831232514 simply did not list, even though its OWN verify block
      -- warns about exactly this shape. That is the miss this file exists to
      -- stop recurring. Anchored on the assignment so the substitution cannot
      -- touch anything else in the body.
      (41, 'notify_on_application',
           $p$v_link\s*:=\s*'/my-posts';$p$,
           $q$v_link := '/my-posts?job=' || NEW.job_id::text;$q$, 'g')
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
      RAISE WARNING 'fixed-filter link fix %: public.% does not exist — skipped', r.ord, r.fn;
    ELSIF NOT v_hit THEN
      -- Already applied (a re-run), or the body drifted from what this
      -- migration was written against. Both belong in the deploy log; neither
      -- is worth failing db-deploy over a link string.
      RAISE WARNING 'fixed-filter link fix %: pattern did not match in public.% — nothing changed', r.ord, r.fn;
    END IF;
  END LOOP;
END
$migrate$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify — WIDENED.
--
-- 20260831232514's guard only warned on a BARE '/my-posts' / '/my-jobs', so
-- every producer above passed it while writing a link to a chip that does not
-- exist. It now also catches a fixed '?filter=' on an Activity route, which is
-- the shape that actually shipped 66 bad rows.
--
-- Line comments are stripped before the test. Function bodies here quote link
-- strings in prose ("was '/activity?tab=offers'", "the client's link
-- ('/my-jobs?filter=offered')"), and a guard that fires on its own explanatory
-- comment is a guard everyone learns to ignore. `'gn'`: `n` makes `.` stop at
-- a newline and `$` match at line ends, so only the comment is removed.
--
-- WARNING, not an exception — the useful outcome is db-deploy naming the
-- function, not a blocked deploy over a query string.
-- ─────────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  r      record;
  v_body text;
BEGIN
  -- `prosrc`, not pg_get_functiondef: for a plpgsql function it IS the body,
  -- and unlike pg_get_functiondef it cannot raise on some unrelated extension
  -- function that happens to live in public.
  FOR r IN
    SELECT p.proname, p.prosrc AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND l.lanname = 'plpgsql'
       AND p.prosrc ~ 'INSERT INTO (public\.)?notifications'
  LOOP
    v_body := regexp_replace(r.body, '--.*$', '', 'gn');

    IF v_body ~ $dead$'/warnings'|'/admin/users/|'/admin/jobs/|'/activity'$dead$ THEN
      RAISE WARNING 'public.% still writes a notification link to a route that does not exist', r.proname;
    END IF;

    -- A bare Activity surface opens the "Needs you" bucket, which is the wrong
    -- bucket for most events.
    IF v_body ~ $bare$'/my-(posts|jobs)'$bare$ THEN
      RAISE WARNING 'public.% writes a BARE /my-posts or /my-jobs notification link (no ?job=) — it will open on the Needs You bucket', r.proname;
    END IF;

    -- THE WIDENING. A fixed '?filter=' pins a bucket at write time; the bucket
    -- is a live question, and most of the old keys have no chip at all.
    -- '?job=' is the shape — Activity resolves the bucket at open time.
    IF v_body ~ $fixed$'/my-(posts|jobs)[^']*[?&]filter=$fixed$ THEN
      RAISE WARNING 'public.% writes a notification link with a FIXED ?filter= — use ''?job='' || <job id> and let Activity resolve the live bucket (src/pages/Activity.tsx)', r.proname;
    END IF;
  END LOOP;
END
$verify$;
