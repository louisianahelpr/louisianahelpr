-- A notification about a job carries the JOB, not a guess about where it lives.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS — three sweeps, three misses, one structural cause.
--
-- public.notifications has stored its destination as a URL STRING since
-- 20260311004406, and a URL string carries no reference to the job it concerns.
-- Everything downstream of that has been a guess about a live question:
--
--   * 20260831232514 converted ~40 producers off a bare '/my-posts' /
--     '/my-jobs' (which opens the "Needs you" bucket — essentially never where
--     the job is). Its verify block warned only on the BARE form.
--   * 20260901021929 found the producers the bare-only guard could not see:
--     the ones writing a FIXED '?filter='. It widened the guard to catch that
--     too. 84 prod rows carried a fixed filter; 66 of them named a legacy enum
--     key with NO CHIP on the strip at all.
--   * Neither guard can see a MISSING JOB REFERENCE, because there was no job
--     reference to miss. That is the miss this file closes.
--
-- Each sweep believed it was complete. Each was wrong for the same reason: a
-- link is an unvalidatable string. `regexp` over function bodies is the only
-- check a string admits, so every guard could only ever describe shapes it had
-- already seen fail. A foreign key describes a fact.
--
-- MEASURED IN PROD (fncmgoasalhdgfwzhsqa) 2026-08-31, 1617 rows:
--     716  rows carry a job uuid somewhere in the link
--     134  of those name a job that STILL EXISTS
--     582  name a job that has been DELETED  ← 36% of the whole table
--      84  carry a fixed '?filter='  (66 of them chip-less; see below)
--      36  are still a bare '/my-posts' (19) or '/my-jobs' (17)
--
-- The 582 is the number that matters. More than a third of this table already
-- deep-links to a job that is gone, and NOTHING could see it, because a URL
-- string cannot be joined against anything. That is the whole argument for a
-- real column in one line.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE FK ACTION — ON DELETE SET NULL, and why not the two live precedents.
--
-- The codebase has both other answers already, and both are wrong here:
--
--   * payout_transfers.job_id → ON DELETE RESTRICT
--     (20260504155115_payout_transfers_audit.sql:18). Deliberate there: money
--     that moved must stay attributable. Here it would be a disaster. A posted
--     job fans a 'job_match' notification out to every nearby helper — 474 of
--     the 582 dead-referencing rows in prod are exactly that. RESTRICT would
--     make a job undeletable the moment it is posted, for the life of the
--     product. This is the payout_transfers failure mode ("a paid user can
--     never be deleted") amplified by the fan-out factor.
--
--   * reviews.job_id → ON DELETE CASCADE
--     (20260311003245:5, and ~15 sibling tables). Wrong for the opposite
--     reason: it makes someone else's history collateral damage. Measured on
--     the 582 rows that reference an already-deleted job, CASCADE would have
--     silently destroyed:
--         474 job_match · 34 message · 26 work_status ·
--          26 financial_alerts · 11 transit_updates · 10 job_update · 1 review
--     including 10 rows titled "Payment secured in escrow". A notification is
--     a record of something that HAPPENED TO THE USER. "Your payment is in
--     escrow" is true forever; it does not stop being true because the job row
--     was later cleaned up. Deleting a job must not rewrite the other party's
--     history — that is precisely the reviews trap.
--
--   * ON DELETE SET NULL — chosen. The notification survives as history, the
--     reference drops, and the row degrades to EXACTLY the state every row in
--     this table is in today: a link, and nothing to validate it with. No
--     worse than the status quo, and the client's URL-fallback path (item 3 of
--     this change, src/pages/Activity.tsx) is already the code that handles it,
--     so the degraded case is the tested case rather than a special one.
--     NULL is additionally already the correct, common value here: admin,
--     profile, support and message notifications are not about a job at all.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The column ────────────────────────────────────────────────────────────
-- Split from the constraint so a re-run is a no-op on each half independently.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS job_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.notifications'::regclass
       AND conname  = 'notifications_job_id_fkey'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

COMMENT ON COLUMN public.notifications.job_id IS
  'The job this notification is about, or NULL when it is not about a job '
  '(admin, profile, support, membership) or when that job has since been '
  'deleted (ON DELETE SET NULL). Producers populate it; the client prefers it '
  'over parsing `link`. `link` is NOT redundant — it is the destination, and '
  'several notifications legitimately point somewhere that is not a job.';

-- Partial: the majority of rows are, correctly, NULL. The query this serves is
-- "notifications about job X", always with a job in hand.
CREATE INDEX IF NOT EXISTS idx_notifications_job_id
  ON public.notifications (job_id)
  WHERE job_id IS NOT NULL;

-- ── 2. Recovering a job id from a link ───────────────────────────────────────
-- Used by the backfill below AND by the fill trigger, so the two can never
-- disagree about what a link means.
--
-- ONLY these four carry a job id. The negative list is the load-bearing half:
--   '/admin?view=people&user=<uuid>'  (76 rows) is a USER
--   '/post-job?offerTo=<uuid>'         (2 rows) is a HELPER
-- Both are uuids in a link and neither is a job. A "grab the first uuid"
-- extractor would have mis-attributed 78 prod rows, and the FK would have
-- happily accepted any of them that collided with a real job id.
CREATE OR REPLACE FUNCTION public.notification_job_id_from_link(p_link text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT NULLIF(
           COALESCE(
             -- '?job=' / '&job=' — the canonical Activity deep link. Anchored
             -- on '=' so it cannot also match 'jobId='.
             (regexp_match(p_link, '[?&]job=([0-9a-fA-F-]{36})'))[1],
             -- '/messages?jobId=<job>&userId=<user>' — param-anchored so the
             -- trailing userId is never picked up.
             (regexp_match(p_link, '[?&]jobId=([0-9a-fA-F-]{36})'))[1],
             -- '/dashboard?quickApply=<job>' — the single most common link in
             -- the product (485 rows). src/pages/dashboard/QuickApplyHandler.tsx
             -- looks this id up with .eq("id", …) against jobs.
             (regexp_match(p_link, '[?&]quickApply=([0-9a-fA-F-]{36})'))[1],
             -- '/jobs/<job>' — the public job detail route (App.tsx:257).
             (regexp_match(p_link, '^/jobs/([0-9a-fA-F-]{36})'))[1]
           ),
           ''
         )::uuid
$$;

-- ── 3. Populating it — the fill trigger ──────────────────────────────────────
-- WHY A TRIGGER AND NOT ~40 EDITED INSERT STATEMENTS.
--
-- The stated root cause is that sweeps miss producers. A per-producer edit is
-- another sweep, and it would be the fourth. Worse, adding a column to the
-- INSERT list of N plpgsql bodies means regexp surgery on N statements whose
-- exact text nobody has read — and 20260901021929 says the quiet part out loud
-- about that risk: "re-typing four function bodies to move six string literals
-- is how a transcription bug gets into a trigger that fires on every job."
--
-- A BEFORE INSERT trigger cannot miss a producer, because it is downstream of
-- all of them: SQL trigger functions, every edge function, and every client
-- call through create-notification all end at this one INSERT. Producers that
-- have not been enumerated — including ones written next month — are covered
-- the moment they insert.
--
-- It fills ONLY when the producer left job_id NULL, so an explicit job_id
-- always wins. That is the path for the producers a link genuinely cannot
-- serve: a payout notification points at '/earnings', which is the right
-- destination and carries no job id, so create-notification passes job_id
-- directly (see the client half of this change).
--
-- THE EXISTENCE CHECK IS NOT OPTIONAL. Without it this trigger would turn a
-- link naming a deleted job into an FK violation, i.e. it would start FAILING
-- the producer's insert — a notification silently lost to a fix meant to make
-- notifications more reliable. 582 prod rows name a deleted job, so this is
-- the common case, not the edge case.
CREATE OR REPLACE FUNCTION public.notifications_fill_job_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job uuid;
BEGIN
  IF NEW.job_id IS NOT NULL OR NEW.link IS NULL THEN
    RETURN NEW;
  END IF;

  v_job := public.notification_job_id_from_link(NEW.link);
  IF v_job IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only adopt a job that exists. A dangling id stays NULL and the row falls
  -- back to its link, which is exactly what it does today.
  IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = v_job) THEN
    NEW.job_id := v_job;
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.notifications_fill_job_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_fill_job_id ON public.notifications;
CREATE TRIGGER trg_notifications_fill_job_id
  BEFORE INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.notifications_fill_job_id();

-- ── 4. Backfill ──────────────────────────────────────────────────────────────
-- One statement, every row. (The 1000-row PostgREST cap that makes a REST
-- backfill silently do a fraction of the work does not apply to SQL; this is
-- also why the backfill lives here and not in a script.)
--
-- Idempotent by its WHERE clause: a second run sees job_id already set and
-- matches nothing. The EXISTS join is what keeps the FK satisfiable — the 582
-- rows naming a deleted job are deliberately left NULL.
WITH resolved AS (
  SELECT n.id,
         public.notification_job_id_from_link(n.link) AS job_id
    FROM public.notifications n
   WHERE n.job_id IS NULL
     AND n.link IS NOT NULL
)
UPDATE public.notifications n
   SET job_id = r.job_id
  FROM resolved r
 WHERE n.id = r.id
   AND r.job_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = r.job_id);

-- ── 5. Clearing the 66 ───────────────────────────────────────────────────────
-- 66 prod rows point at a legacy filter key that has no chip on the strip
-- (offered 33 · in_progress 17 · completed 8 · not_selected 4 · open 3 ·
-- revision 1). They open a filtered list with nothing on the strip selected
-- and no way to tell what you are looking at.
--
-- They cannot be repaired: their links carry no id, so job identity is only
-- recoverable from the title text, and only 24 of 66 resolve uniquely. A
-- title-text match is a guess, and a WRONG job_id is strictly worse than a
-- null one — it would deep-link a reader confidently to somebody else's job.
-- So none of the 66 is given a job_id here. They are cleared instead.
--
-- OWNERSHIP VERIFIED BEFORE WRITING (prod, 2026-08-31 — 7 distinct user_ids):
--     20  eli.test.helper@louisianahelpr.com     test
--     13  helpr-audit-web-0824@mailinator.com    test
--     12  helpr-audit2-20260824@mailinator.com   test
--      8  demo1@helpr.test                       test
--      3  demo4@helpr.test                       test   → 56 test
--      7  lexilombas05@gmail.com                 owner
--      3  admin@louisianahelpr.com               owner  → 10 owner
--   0 rows belong to any third-party user. Matches the brief exactly.
--
-- Two things happen, and both are idempotent:
--   read  → true, so they leave the unread bell.
--   link  → the bare Activity route, so the row that stays in history opens on
--           a coherent screen (the default "Needs you" bucket) instead of a
--           filtered list with no chip lit. The filter key it drops is the
--           defect itself; there is nothing in it worth keeping.
--
-- The key list is CLOSED and spelled out rather than "any filter with no chip":
-- the five live chips are needs_you / scheduled / waiting / done / cancelled
-- (src/pages/activity/activityFilters.ts), and 18 further prod rows name
-- needs_you or scheduled. Those 18 are NOT touched here — a fixed filter is
-- still wrong for them, but they are not the chip-less class this clears, and
-- widening the match on a guess is how a sweep overreaches.
UPDATE public.notifications
   SET read = true,
       link = regexp_replace(link, '[?&]filter=[a-z_]+', '')
 WHERE link ~ '^/my-(posts|jobs)[?&]filter=(offered|in_progress|completed|not_selected|open|revision)$'
   AND (read = false OR link ~ '[?&]filter=');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. VERIFY — a guard that can fail on a MISSING JOB REFERENCE.
--
-- What the two previous guards could and could not see:
--   20260831232514 — bare '/my-posts' / '/my-jobs' only. Every fixed-filter
--                    producer passed it.
--   20260901021929 — added the fixed '?filter=' shape. Neither can see a
--                    missing job_id, because until this migration there was no
--                    job_id to be missing.
--
-- THE NEW CHECK. For every plpgsql producer, every Activity-route link literal
-- in its body must either
--     (a) be immediately followed by '?job='  — which the fill trigger turns
--         into a real job_id, or
--     (b) sit in a function that writes job_id into the notifications INSERT
--         explicitly.
-- Anything else — a bare route, a fixed filter, a query string that forgot the
-- job — is a producer whose notification will arrive with no job reference,
-- and it is named in the deploy log.
--
-- This is the check that fails on the shape NOBODY HAS SEEN YET, which is the
-- point: the previous two could only describe failures that had already
-- shipped. "Does this producer attach the job?" is answerable about a producer
-- written next year.
--
-- WARNING, not an exception, matching the two guards it extends: the useful
-- outcome is db-deploy naming the function, not a blocked deploy over a query
-- string. (Proven to fire: a violating producer was planted, warned, reverted
-- — see the change report.)
--
-- Line comments are stripped first. These bodies quote link strings in prose
-- ("the client's link ('/my-jobs?filter=offered')"), and a guard that fires on
-- its own explanatory comment is a guard everyone learns to ignore.
-- ─────────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  r          record;
  v_body     text;
  v_has_col  boolean;
  v_bad      text;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosrc AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND l.lanname = 'plpgsql'
       AND p.prosrc ~ 'INSERT INTO (public\.)?notifications'
       -- The fill trigger itself and this file's own helpers are not producers.
       AND p.proname NOT IN ('notifications_fill_job_id')
  LOOP
    v_body := regexp_replace(r.body, '--.*$', '', 'gn');

    -- A dead route is dead whatever else the producer does, so this one is
    -- unconditional. Carried over from 20260831232514 unchanged.
    IF v_body ~ $dead$'/warnings'|'/admin/users/|'/admin/jobs/|'/activity'$dead$ THEN
      RAISE WARNING 'public.% still writes a notification link to a route that does not exist', r.proname;
    END IF;

    -- Does this function write job_id into the notifications INSERT itself?
    -- Everything below is gated on this, INCLUDING the two inherited checks,
    -- and that gating is a real behaviour change rather than tidying:
    -- 20260831232514 and 20260901021929 warned about a bare route / a fixed
    -- filter because the LINK was the only thing that decided the bucket. It
    -- is not any more. A producer that attaches the job has said which job it
    -- means, the client resolves the live bucket from that reference
    -- (src/pages/Activity.tsx), and the query string stops mattering. Leaving
    -- the old checks ungated would fire on producers that are now CORRECT —
    -- e.g. a payout notice pointing at '/earnings' with job_id set — and a
    -- guard that cries wolf on the fixed shape is a guard the next sweep
    -- learns to scroll past. That is exactly how three sweeps missed things.
    v_has_col := v_body ~* 'INSERT INTO (public\.)?notifications[^;]*\mjob_id\M';

    IF NOT v_has_col THEN
      -- ── inherited from 20260831232514 / 20260901021929 ───────────────────
      IF v_body ~ $bare$'/my-(posts|jobs)'$bare$ THEN
        RAISE WARNING 'public.% writes a BARE /my-posts or /my-jobs notification link (no ?job=) and no job_id — it will open on the Needs You bucket', r.proname;
      END IF;

      IF v_body ~ $fixed$'/my-(posts|jobs)[^']*[?&]filter=$fixed$ THEN
        RAISE WARNING 'public.% writes a notification link with a FIXED ?filter= — use ''?job='' || <job id> and let Activity resolve the live bucket (src/pages/Activity.tsx)', r.proname;
      END IF;

      -- ── THE NEW ONE: an Activity route with no job attached, in any shape.
      --    Subsumes both checks above and, unlike them, is stated as a
      --    REQUIREMENT ("must be ?job=") rather than as a list of known-bad
      --    spellings — so it fires on a shape nobody has seen yet.
      -- Every Activity-route literal that is NOT the compliant '?job=' shape.
      SELECT string_agg(DISTINCT m[1], ', ')
        INTO v_bad
        FROM regexp_matches(v_body, $lit$('/my-(?:posts|jobs)[^']*')$lit$, 'g') AS m
       WHERE m[1] !~ $ok$^'/my-(posts|jobs)\?job='$ok$;

      IF v_bad IS NOT NULL THEN
        RAISE WARNING
          'public.% writes the Activity link(s) % with NO job reference — the notification will arrive with job_id NULL. Either write ''/my-posts?job='' || <job id> (the fill trigger adopts it) or set job_id in the INSERT.',
          r.proname, v_bad;
      END IF;
    END IF;
  END LOOP;
END
$verify$;
