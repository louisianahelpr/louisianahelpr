-- The rows every account deletion before 2026-09-01 left behind.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260901033011_account_deletion_retention_policy.sql and
-- 20260902014651_account_deletion_purges_the_no_fk_tables.sql together decide,
-- table by table, what an account deletion must erase, anonymise and retain.
-- Both govern only FUTURE deletions: the first works through FK ON DELETE
-- rules, the second through `purge_user_data()`, and neither looks backwards.
-- 20260902014651's own header says so outright (":30-38") — it declines to add
-- FOREIGN KEYs to the ten no-FK tables precisely BECAUSE prod already holds
-- orphan rows from deletions that happened before any of this existed, and the
-- `ALTER` would fail validation on deploy.
--
-- This file is that missing backwards pass. It applies the SAME buckets, to
-- the rows that are already there. Nothing here invents a second policy; every
-- statement below cites the clause of `purge_user_data()` it mirrors.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE CENSUS — measured against prod (fncmgoasalhdgfwzhsqa) 2026-09-02
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Method: `auth.admin.listUsers` for the live set (36 accounts), then every
-- uuid-typed column in the exposed schema (152 (table, column) pairs, plus the
-- 10 `*_by` columns a name filter misses) paginated in full through PostgREST
-- and diffed against it. Every candidate orphan uuid was then re-confirmed
-- individually with `GET /auth/v1/admin/users/{id}` → 404, because a bulk list
-- and a by-id lookup can disagree about soft-deleted users and a false positive
-- here deletes a live person's data.
--
--   table.column                orphan rows   departed users   bucket
--   ─────────────────────────── ───────────── ──────────────── ─────────
--   analytics_events.user_id             66                4   ANONYMISE
--   login_history.user_id                42                4   ERASE
--   notification_logs.user_id             6                4   ERASE
--   referral_codes.user_id                4                4   ANONYMISE
--   notifications.user_id                 4                3   ERASE
--   ─────────────────────────── ───────────── ──────────────── ─────────
--                                       122      9 distinct departed accounts
--   admin_audit_log.admin_id            109                1   RETAIN
--
-- Who those nine are matters for how the number should be read. EIGHT of them
-- have their entire footprint inside 2026-08-31 → 2026-09-02, the window in
-- which this repo's own lanes were proving the account-deletion work, and four
-- are named outright by the `recipient_email` that survived them:
-- `helpr-giftlane-…@mailinator.com`, `helpr-deletelane-…-victim@…`,
-- `helpr-deletelane-…-helper@…`, `helpr-seedlane-audit-0901@…`. Exactly ONE
-- (a single `notifications` row from 2026-08-18) predates the window.
--
-- So the live exposure is far smaller than 122 rows of real users' data. It
-- changes not one decision below. The residue is identical whoever left it,
-- the mechanism that produced it is precisely the one that will produce it for
-- a real user, and a cleanup that only runs once the first real person is in
-- the set is a cleanup that runs too late.
--
-- Every other user-shaped column came back clean: 51 columns hold only live
-- users, 77 are empty. `fraud_flags`, `saved_jobs`, `referral_credits`,
-- `referrals`, `group_job_helpers`, `error_logs`, `pif_credits`,
-- `push_tokens`, `notification_preferences` and `messages.sender_id` — all of
-- which purge_user_data() covers — hold zero orphans today. They are still
-- written to below, because a census is a photograph and this migration
-- deploys later than the moment it was taken; each statement simply matches
-- nothing if nothing is there.
--
-- ── Three corrections to the sweep this lane was handed ─────────────────────
--
--   1. `login_history.ip_address` does NOT hold anyone's IP. The column is
--      populated in exactly ZERO rows of the whole table (`ip_address=not.is.
--      null` → 0). `user_agent` IS populated on all 42 orphan rows, which is a
--      weaker identifier but still the departed person's own record, so the
--      ERASE decision stands on its own footing rather than on the IP claim.
--
--   2. `admin_audit_log.admin_id`'s 109 orphan rows are not a departed admin
--      at all. Every one of them holds the all-zeroes sentinel
--      `00000000-0000-0000-0000-000000000000`, written by the role-seeding
--      migrations — an id that was never a person. It is retained, which is
--      the same answer 20260902014651 reached for the compliance-trail reason,
--      but the reason here is stronger: there is no identity to sever.
--
--   3. `reports.reported_id` showed 2 uuids absent from auth.users and is NOT
--      in scope. That column is POLYMORPHIC on `reported_type`, and both rows
--      read `reported_type = 'job'` — they are dangling JOB pointers (the jobs
--      are gone too), not departed users. Anonymising them would have severed
--      a moderation record from its subject on a category error. Reported, not
--      touched. `reports.reporter_id` is clean.
--
-- ── And one defect the census found that no earlier pass did ────────────────
--
-- `analytics_events.properties` embeds the actor's uuid AGAIN, inside the
-- JSONB: 40 of the 66 orphan rows carry `{"user_id": "<the same uuid>"}`,
-- written by the `email_verified`, `job_posted`, `first_job_posted` and
-- `post_job_entry_choice` producers. purge_user_data()'s step 4g-bis nulls the
-- `user_id` COLUMN and stops there, so its anonymisation of this table is
-- cosmetic: the departed person's whole event stream is still re-assemblable
-- with `GROUP BY properties->>'user_id'`. Severing one copy of an identifier
-- and leaving the other is not anonymisation. Section 3 fixes it in both
-- directions — retroactively here, and for every future deletion via a
-- trigger.
--
-- ── Why a trigger and not a CREATE OR REPLACE of purge_user_data() ──────────
--
-- The obvious forward fix is to add the JSONB scrub to step 4g-bis. This file
-- deliberately does not, because doing so means restating that function's
-- entire 250-line body, and a sibling lane is actively working on account
-- deletion in this same tree (20260902014651 landed hours ago). A restatement
-- is asymmetrically dangerous: if their next version lands after mine, my
-- scrub is silently lost; if mine lands after theirs, THEIR work is silently
-- lost. A BEFORE UPDATE trigger on `analytics_events` achieves the same
-- guarantee, cannot be clobbered by anyone replacing that function, and holds
-- for any other caller that anonymises the column — including this migration.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SAFETY
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This file deletes real production rows, so every predicate is anchored on
-- `NOT EXISTS (SELECT 1 FROM auth.users …)` — the live owner set itself, read
-- inside the same transaction that does the deleting. Not an id list captured
-- during the census. Three consequences, all of them the point:
--
--   * A row whose owner still exists is untouchable by construction. There is
--     no uuid literal in this file that could go stale between writing it and
--     deploying it.
--   * It is complete at DEPLOY time, not at census time. Any account deleted
--     between now and the deploy is covered too.
--   * It is re-runnable. Every statement is a DELETE, or an UPDATE whose
--     predicate stops matching once applied, so a second and third application
--     are no-ops. Proven, not asserted: applied 3× consecutively against a
--     PGlite instance carrying a prod-shaped schema and seeded orphans.
--
-- One thing this file does NOT do: add the FOREIGN KEY constraints that
-- 20260902014651 had to skip. Those are unblocked by this migration and belong
-- in their own, with their own verification that the orphan count is zero
-- first. Landing them in the same file as the cleanup would mean a single
-- transaction that both deletes prod rows and takes an ACCESS EXCLUSIVE lock
-- on ten tables to validate constraints, with no chance to confirm the first
-- half worked before the second half runs.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. ERASE — the departing person's own artifacts, owned by nobody else.
--
--    Mirrors purge_user_data() steps 4c and 4f. Each block is guarded on the
--    table existing (several referenced tables were dropped in 2026-08, and
--    this file's replay-safety is proven on a plain Postgres instance that has
--    only the subset the harness builds).
-- ───────────────────────────────────────────────────────────────────────────
DO $erase$
DECLARE
  spec  record;
  n     bigint;
  total bigint := 0;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- 4f. Holds `recipient_email` — the departed person's literal address.
      --     The largest residual-PII surface in the census.
      ('notification_logs',        'user_id'),
      -- 4f. Holds `user_agent` (and a nullable `ip_address` that prod has
      --     never populated). Their own session log; nobody else's record.
      ('login_history',            'user_id'),
      -- 4f. Their bookmarks.
      ('saved_jobs',               'user_id'),
      -- 4f. A judgment about an identified individual, which can no longer
      --     gate anything once the account is gone — the same call
      --     20260901033011 made in keeping reviews.reviewee_id on CASCADE.
      ('fraud_flags',              'user_id'),
      -- 4c. Addressed to a person who cannot read them, and the message body
      --     quotes their job titles.
      ('notifications',            'user_id'),
      ('push_tokens',              'user_id'),
      ('notification_preferences', 'user_id'),
      -- 4g. Their own unspent promo balance — a marketing incentive, not a
      --     settled financial record, so it carries no retention weight.
      ('referral_credits',         'user_id'),
      -- 4c. Their own words. `receiver_id` is deliberately NOT here: those
      --     rows are what the COUNTERPARTY wrote, and 20260902014651's header
      --     spells out why the dangling receiver uuid stays.
      ('messages',                 'sender_id')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE NOTICE 'skip %.% — table absent', spec.tbl, spec.col;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = spec.col
    ) THEN
      RAISE NOTICE 'skip %.% — column absent', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    EXECUTE format(
      'DELETE FROM public.%I t WHERE t.%I IS NOT NULL'
      || ' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.%I)',
      spec.tbl, spec.col, spec.col
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN
      RAISE NOTICE 'erased % orphan row(s) from %.%', n, spec.tbl, spec.col;
    END IF;
  END LOOP;

  RAISE NOTICE 'backfill: % row(s) erased in total', total;
END $erase$;

-- `referrals` is split, so it does not fit the loop above. The row keyed on
-- `referred_id` is the departed person's own provenance and is erased (4g);
-- the `referrer_id` pointer on somebody ELSE's row is anonymised in section 2.
-- Order matters — `referrals` and `referral_credits` both carry a real FK to
-- `referral_codes(id)`, so the codes are touched last.
DO $refs$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.referrals') IS NULL THEN
    RAISE NOTICE 'skip referrals — table absent';
    RETURN;
  END IF;

  DELETE FROM public.referrals r
   WHERE r.referred_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.referred_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'erased % orphan referrals row(s) by referred_id', n; END IF;
END $refs$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. ANONYMISE — somebody else's record that merely points at the departed
--    user, and behavioural logs that exist to be counted in aggregate.
--
--    Mirrors purge_user_data() steps 4g, 4g-bis, 4g-ter and 4h.
-- ───────────────────────────────────────────────────────────────────────────
DO $anon$
DECLARE
  spec  record;
  n     bigint;
  total bigint := 0;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- 4g-bis. An event stream exists to be counted. Deleting rows would
      --   rewrite historical funnels every time somebody closed their account;
      --   severing the actor keeps the count honest and leaves nothing
      --   attributable. (Section 3 finishes the job inside `properties`.)
      ('analytics_events',   'user_id'),
      ('error_logs',         'user_id'),
      -- 4g. The row belongs to the REFERRER, who earned and possibly spent
      --   that credit. Sever the pointer, keep their credit.
      ('referral_credits',   'referred_user_id'),
      -- 4g. The row belongs to the person THEY referred; that person's
      --   provenance survives.
      ('referrals',          'referrer_id'),
      -- 4h. The roster of a group job is the POSTER's record of who worked a
      --   completed, paid job. Keep the row, forget the person.
      ('group_job_helpers',  'helper_id')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN
      RAISE NOTICE 'skip %.% — table absent', spec.tbl, spec.col;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = spec.col
    ) THEN
      RAISE NOTICE 'skip %.% — column absent', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    -- These columns were made nullable by 20260901033011 §1 and
    -- 20260902014651 §1. If one is still NOT NULL here the ALTER never ran,
    -- and nulling it would abort the whole transaction with 23502 — so say so
    -- and skip rather than take the deploy down.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.tbl
        AND column_name = spec.col AND is_nullable = 'NO'
    ) THEN
      RAISE WARNING 'skip %.% — column is still NOT NULL; the retention-policy migrations did not reach this database', spec.tbl, spec.col;
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE public.%I t SET %I = NULL WHERE t.%I IS NOT NULL'
      || ' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.%I)',
      spec.tbl, spec.col, spec.col, spec.col
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    IF n > 0 THEN
      RAISE NOTICE 'anonymised % orphan row(s) in %.%', n, spec.tbl, spec.col;
    END IF;
  END LOOP;

  RAISE NOTICE 'backfill: % row(s) anonymised in total', total;
END $anon$;

-- `referral_codes` needs the `code` rewritten as well as `user_id` nulled, so
-- it does not fit the loop either. Both halves are load-bearing and both come
-- straight from 20260902014651 §4g: the row cannot be deleted because a third
-- party's `referrals` row points at it (and nulling THAT pointer would break
-- `check_referral_bonus`'s dedupe key and re-mint their $5 forever), and a
-- readable code with no owner is a live coupon — a new signup entering it would
-- mint credit toward an account that does not exist. The replacement satisfies
-- the UNIQUE constraint and is not guessable from the original.
DO $codes$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.referral_codes') IS NULL THEN
    RAISE NOTICE 'skip referral_codes — table absent';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'referral_codes'
      AND column_name = 'user_id' AND is_nullable = 'NO'
  ) THEN
    RAISE WARNING 'skip referral_codes.user_id — still NOT NULL';
    RETURN;
  END IF;

  UPDATE public.referral_codes rc
     SET user_id = NULL,
         code    = 'REDACTED-' || replace(rc.id::text, '-', '')
   WHERE rc.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = rc.user_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE 'anonymised % orphan referral_code(s)', n; END IF;
END $codes$;

-- `pif_credits.recipient_email` is DELIBERATELY not backfilled, and the reason
-- is worth recording because purge_user_data() §4g-ter does clear it.
--
-- Forward, that step keys off `recipient_id = p_user_id` — it runs while the
-- identity is still there. Backwards there is nothing to key off: the FK
-- conversion in 20260901033011 already nulled `recipient_id`, so an orphaned
-- claimed gift and a never-claimed gift are indistinguishable by identity, and
-- the only thing left to match on is state. Any state heuristic that is wrong
-- destroys a working, donor-funded gift belonging to somebody who is still
-- here, which is a strictly worse outcome than the leak it would close.
--
-- Measured instead: prod holds 4 `pif_credits` rows and `recipient_email` is
-- NULL on every one of them, so the re-claim hole has no instances to close.
-- If one ever appears it will have arrived through the forward path, which
-- already handles it. Reported, not guessed at.

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The second copy of the identifier — `analytics_events.properties`.
--
--    See the header. Nulling `user_id` while `properties->>'user_id'` still
--    holds the same uuid severs one of two copies and leaves the event stream
--    fully re-assemblable, which is not anonymisation. Fixed in both
--    directions: a trigger so it holds for every future anonymisation whoever
--    performs it, then a one-off pass over the rows already in that state.
--
--    The scrub is value-matched, not key-matched: it removes any top-level key
--    whose value equals the actor uuid being severed, so a producer that names
--    it `actor_id` or `uid` tomorrow is covered without editing this. Only the
--    identifier goes; every other property — the event's real payload — stays,
--    which is what keeps the aggregate counts this bucket exists to protect.
-- ───────────────────────────────────────────────────────────────────────────
DO $ae$
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RAISE NOTICE 'skip analytics_events — table absent';
    RETURN;
  END IF;

  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.scrub_analytics_actor_from_properties()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $body$
    DECLARE
      k text;
    BEGIN
      -- Only the anonymisation transition. An ordinary UPDATE that leaves
      -- user_id alone, and an INSERT, are both untouched.
      IF NEW.user_id IS NOT NULL
         OR OLD.user_id IS NULL
         OR NEW.properties IS NULL
         OR jsonb_typeof(NEW.properties) <> 'object'
      THEN
        RETURN NEW;
      END IF;

      FOR k IN
        SELECT key FROM jsonb_each_text(NEW.properties)
        WHERE value = OLD.user_id::text
      LOOP
        NEW.properties := NEW.properties - k;
      END LOOP;

      RETURN NEW;
    END;
    $body$;
  $fn$;

  DROP TRIGGER IF EXISTS trg_scrub_analytics_actor_from_properties ON public.analytics_events;
  CREATE TRIGGER trg_scrub_analytics_actor_from_properties
    BEFORE UPDATE OF user_id ON public.analytics_events
    FOR EACH ROW
    WHEN (NEW.user_id IS NULL AND OLD.user_id IS NOT NULL)
    EXECUTE FUNCTION public.scrub_analytics_actor_from_properties();

  EXECUTE $cmt$
    COMMENT ON FUNCTION public.scrub_analytics_actor_from_properties() IS
      'Removes the actor uuid from analytics_events.properties at the moment '
      'user_id is nulled. Without it, purge_user_data()''s ANONYMISE bucket '
      'severs only one of two copies of the identifier and the departed '
      'person''s whole event stream stays re-assemblable with '
      'GROUP BY properties->>''user_id''. Value-matched, not key-matched, so a '
      'producer that names the field differently is still covered.'
  $cmt$;
END $ae$;

-- An internal trigger function: reachable only through the trigger, never from
-- PostgREST. Explicit posture, because migration-lint requires every new public
-- function to declare one and the useful declaration here is a revocation.
-- `anon` and `authenticated` do not exist on a plain Postgres instance, and
-- this file's replay-safety is proven on one.
REVOKE ALL ON FUNCTION public.scrub_analytics_actor_from_properties() FROM PUBLIC;

DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.scrub_analytics_actor_from_properties() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- The retroactive half. `user_id` is already NULL on the rows section 2 just
-- anonymised, so the trigger cannot reach them — it fires on the transition,
-- and the transition has been and gone. This pass finds them by the residue
-- itself: a row with no actor whose properties still name one.
--
-- Bounded to uuids that are NOT live users, so an event belonging to somebody
-- who is still here can never be caught by it even if a producer wrote a NULL
-- user_id alongside a populated `properties.user_id`.
--
-- The liveness test compares `u.id::text = p.value` rather than casting the
-- JSONB text to uuid. A WHERE clause is a set of conditions, not a sequence:
-- Postgres is free to evaluate the NOT EXISTS before the shape check, so
-- `p.value::uuid` on a property that merely happens to be a non-uuid string
-- would raise 22P02 and abort the deploy. Comparing as text cannot. auth.users
-- has 36 rows, so the cost of not using the index is nil.
DO $scrub$
DECLARE
  n bigint := 0;
  r record;
  k text;
  props jsonb;
BEGIN
  IF to_regclass('public.analytics_events') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT ae.id, ae.properties
    FROM public.analytics_events ae
    WHERE ae.user_id IS NULL
      AND ae.properties IS NOT NULL
      AND jsonb_typeof(ae.properties) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(ae.properties) p
        -- Only the actor's own id. A `job_id` or `code_id` in an event payload
        -- is not an identity and must survive — the key name is the narrowing
        -- here precisely because this pass, unlike the trigger, has no OLD row
        -- to value-match against.
        WHERE p.key IN ('user_id', 'actor_id', 'uid', 'helper_id', 'customer_id')
          AND p.value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = p.value)
      )
  LOOP
    props := r.properties;
    FOR k IN
      SELECT p.key FROM jsonb_each_text(r.properties) p
      WHERE p.key IN ('user_id', 'actor_id', 'uid', 'helper_id', 'customer_id')
        AND p.value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id::text = p.value)
    LOOP
      props := props - k;
    END LOOP;

    IF props IS DISTINCT FROM r.properties THEN
      UPDATE public.analytics_events SET properties = props WHERE id = r.id;
      n := n + 1;
    END IF;
  END LOOP;

  IF n > 0 THEN
    RAISE NOTICE 'scrubbed a departed actor uuid out of properties on % analytics row(s)', n;
  END IF;
END $scrub$;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. VERIFY — say what is left, and name what is deliberately left.
--
--    WARNING, never EXCEPTION, matching every sibling guard in this tree: a
--    residual orphan should be visible in the db-deploy log, not a blocked
--    deploy that leaves the cleanup half-applied.
-- ───────────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  spec      record;
  n         bigint;
  remaining bigint := 0;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('notification_logs',        'user_id'),
      ('login_history',            'user_id'),
      ('saved_jobs',               'user_id'),
      ('fraud_flags',              'user_id'),
      ('notifications',            'user_id'),
      ('push_tokens',              'user_id'),
      ('notification_preferences', 'user_id'),
      ('messages',                 'sender_id'),
      ('referral_credits',         'user_id'),
      ('referral_credits',         'referred_user_id'),
      ('referrals',                'referred_id'),
      ('referrals',                'referrer_id'),
      ('referral_codes',           'user_id'),
      ('analytics_events',         'user_id'),
      ('error_logs',               'user_id'),
      ('group_job_helpers',        'helper_id')
    ) AS t(tbl, col)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = spec.col
    ) THEN CONTINUE; END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I t WHERE t.%I IS NOT NULL'
      || ' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.%I)',
      spec.tbl, spec.col, spec.col
    ) INTO n;

    IF n > 0 THEN
      remaining := remaining + n;
      RAISE WARNING 'backfill INCOMPLETE: %.% still holds % orphan row(s)', spec.tbl, spec.col, n;
    END IF;
  END LOOP;

  IF remaining = 0 THEN
    RAISE NOTICE 'backfill verified: 0 orphan rows across the 16 no-FK / anonymisable user columns';
  END IF;

  -- Deliberately excluded from the sweep above, and named here so a future
  -- reader does not have to re-derive why the counts do not add up:
  --
  --   admin_audit_log.admin_id — the compliance trail, which is supposed to
  --     outlive the admin, and whose 109 orphan rows are in any case the
  --     all-zeroes seeding sentinel rather than a person.
  --   messages.receiver_id     — the counterparty's own message; the dangling
  --     uuid is the honest representation of "the other person left".
  --   reports.reported_id      — polymorphic on `reported_type`; its two
  --     non-user values are dangling JOB pointers, not departed users.
  IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.admin_audit_log t WHERE t.admin_id IS NOT NULL'
         || ' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.admin_id)'
      INTO n;
    RAISE NOTICE 'admin_audit_log: % row(s) name a non-existent admin — RETAINED by policy', n;
  END IF;
END $verify$;
