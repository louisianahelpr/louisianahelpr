-- The parish fan-out fires when the job becomes VISIBLE, exactly once.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT — the same shape 20260901035245 fixed for saved searches
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `notify_helpers_on_job_post_trigger` has been `AFTER INSERT ON public.jobs
-- FOR EACH ROW` with NO `WHEN` clause since 20260418081253. INSERT is the one
-- moment `jobs.payment_status` is guaranteed to be its column default
-- `'unpaid'` — the poster has not been through checkout yet — and all three
-- browse surfaces require `payment_status IN ('escrow','payout_pending',
-- 'released')` before a helper may see the row. So the alert has always been
-- sent at the exact instant its own link is guaranteed to open nothing.
--
-- MEASURED IN PROD (fncmgoasalhdgfwzhsqa) 2026-09-02, service-role write +
-- a GENUINE non-admin session for demo1@helpr.test (customer role only —
-- `scripts/test-signin-link.mjs helper` holds role='admin' and would have made
-- RLS look wide open). One job, one helper, two probes:
--
--   job a89234fb… posted status='open', payment_status='unpaid'
--     → notify_helpers_on_job_post fired 1 notification
--       title 'New job in your parish'  link '/dashboard?job=a89234fb…'
--     → open_jobs_browse?id=eq.a89234fb…      0 rows
--     → get_ranked_open_jobs()                0 rows  (11 open jobs returned)
--
--   the SAME job PATCHed to payment_status='escrow'
--     → open_jobs_browse?id=eq.a89234fb…      1 row
--     → get_ranked_open_jobs()                1 row
--     → notifications from this producer      still 1 — an AFTER INSERT
--                                             trigger cannot fire again
--
-- The link is dead at the only moment it is ever sent, and becomes live at a
-- moment nothing is listening. Every prod row created for that proof was
-- deleted and the deletion confirmed.
--
-- ── WHAT THE PROD NUMBERS ACTUALLY SAY (the brief's 518 is a misattribution) ─
--
-- The brief called this "the big one: 518 job_match notifications in prod".
-- prod holds 519 `job_match` rows, but NONE of them came from this producer:
--
--   producer                              title                       rows
--   ───────────────────────────────────── ─────────────────────────── ────
--   instant-job-match (edge fn)           '<emoji> Match for you…'     485
--   daily-job-digest cron (20260506202145) 'New jobs in <parish>'        33
--   daily-match-digest                    "Today's matches — 1 job…"     1
--   notify_helpers_on_job_post            'New job in your parish'       0
--
--   notifications?title=eq.New job in your parish   → 0 rows
--   notifications?link=like./dashboard?job=*        → 0 rows
--   (485 rows are '/dashboard?quickApply=<uuid>', 34 are bare '/dashboard'.)
--
-- The reason is one row count: `public.helper_preferred_parishes` is EMPTY in
-- prod — 0 rows, across all 32 accounts. This trigger's whole fan-out is
-- `SELECT … FROM helper_preferred_parishes WHERE parish = NEW.parish`, so it
-- has looped zero times for the life of the product.
--
-- That makes this a LATENT defect, not a live one, and it is the more
-- dangerous of the two: nothing is wrong today, and the first helper who ever
-- sets a preferred parish silently arms a dead-link fan-out to every helper in
-- that parish on every unpaid draft. Fixing it before the table has rows is
-- the cheap moment; the 519 rows the brief pointed at belong to two other
-- producers and are out of this lane's scope (reported, not touched).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE FIX — 20260901035245's pattern, not a second one
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Two triggers replace the one, because a `WHEN` clause may not reference OLD
-- on INSERT:
--
--   _funded_insert  AFTER INSERT   WHEN (open AND funded)
--                   — lands already funded: a service-role insert, or a
--                     recurring-job spawn that copies the escrow state.
--   _funded_update  AFTER UPDATE   WHEN (open AND funded AND NOT (OLD was
--                     open AND funded))
--                   — the normal path: checkout completes, payment_status
--                     moves to 'escrow'.
--
-- EXACTLY ONCE is the OLD-row half. It pins the TRANSITION into visible, not
-- the state, so the three funded states a job legitimately walks through
-- (escrow → payout_pending → released) fire once between them: only the first
-- write finds OLD not-yet-visible. An edit, a boost, a re-save, a second
-- escrow write and a status shuffle inside 'open' all leave OLD already
-- open+funded and fire nothing. Proven in PGlite — see the assertions below.
--
-- ── ONE DELIBERATE DIVERGENCE FROM THE SIBLING: `COALESCE` ON THE OLD ROW ────
--
-- 20260901035245's UPDATE trigger writes the OLD half as a bare
--     NOT (OLD.status = 'open' AND OLD.payment_status = ANY (ARRAY[…]))
-- and `jobs.payment_status` is NULLABLE (that migration's own function body
-- says so, in the comment above its COALESCE guard: "payment_status is
-- nullable, and a NULL would make the whole condition NULL"). The identical
-- hazard applies to a trigger's WHEN clause, and there it fails the OTHER
-- way — silently, and toward NOT notifying:
--
--     OLD.status='open', OLD.payment_status IS NULL, NEW = open+escrow
--       inner  = TRUE AND NULL        = NULL
--       NOT inner                     = NULL
--       whole WHEN                    = NULL  → Postgres does not fire the row
--
-- A job that sat at a NULL payment_status and then funded would notify NOBODY,
-- which is the failure mode the brief names as strictly worse than a dead
-- link. `COALESCE(OLD.payment_status, '')` makes the absent value behave like
-- every other not-yet-funded value: '' is not in the list, the inner is FALSE,
-- and the transition fires. Prod carries 0 NULL rows today (66 jobs:
-- escrow 31 · released 12 · cancelled 8 · unpaid 6 · abandoned 6 · refunded 2
-- · payout_pending 1), so this is guarding the column's declared shape rather
-- than an observed row — which is the only time it is cheap to guard.
-- The same latent hole in trg_notify_saved_searches_funded_update is reported
-- to that lane rather than edited here.
--
-- ── WHY THE BODY GAINS THE VISIBILITY GATES TOO ─────────────────────────────
--
-- The WHEN clauses cover open+funded. Two further conditions decide whether a
-- funded, open job is on a browse surface at all, and both are already the
-- shared authority the three surfaces use (20260901035245):
--
--   * a live DIRECT OFFER — addressed mail, hidden from the open pool by
--     open_jobs_browse, get_ranked_open_jobs and get_open_jobs_for_map alike.
--     Alerting the parish about it links every helper but one to a job they
--     cannot open. (It is not re-alerted when the offer later resolves: the
--     row is already open+funded, so the UPDATE trigger's WHEN is false —
--     matching the sibling's stated behaviour exactly.)
--   * a hidden FIXTURE — `is_seed` under `seed_jobs_hidden_publicly()`. Never
--     alert about a job the operator has hidden from the marketplace.
--
-- Without these the fix would still send openable-looking links that open
-- nothing, i.e. it would fix the timing and keep the defect.
--
-- ── AND WHY IT WRITES `job_id` EXPLICITLY ───────────────────────────────────
--
-- 20260901035600 added `notifications.job_id` because 582 of 716 job-shaped
-- links in prod already name a deleted job, and gave it a BEFORE INSERT fill
-- trigger that recovers an id from the link. This producer's link is
-- '/dashboard?job=<uuid>', which that trigger's `[?&]job=` branch does adopt —
-- so job_id would be populated even if this file said nothing.
--
-- It says it anyway. The fill trigger is a safety net whose correctness
-- depends on a regexp agreeing with a string literal two files away, and it
-- deliberately adopts a job only `IF EXISTS` — a real condition here, since
-- this fan-out runs inside the writing transaction. Naming the column in the
-- INSERT makes the reference a fact of the producer rather than a recovery,
-- and it is what 20260901035600's own verify block asks a producer to do
-- (`v_has_col`). The fill trigger stays: it only fills when job_id IS NULL.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- KNOWN RESIDUAL, MEASURED — Early Access still delays a free-tier helper
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A third predicate gates all three browse surfaces: `created_at <=
-- public.early_access_cutoff()` (20260901022522) — a 20-minute delay for a
-- free-tier viewer, reduced by 5/10/20 minutes for basic/pro/elite.
--
-- This is NOT hypothetical and it is why the prod proof above backdates
-- `created_at`. The first run of that proof used a live `created_at`, and the
-- funded probe still returned 0 rows from BOTH surfaces — the payment gate had
-- opened and Early Access had not:
--
--   created_at = now()        funded → open_jobs_browse 0 · ranked 0
--   created_at = now() - 1h   funded → open_jobs_browse 1 · ranked 1
--
-- So for a free-tier helper this alert can still arrive up to 20 minutes
-- before the job is openable, whenever checkout completes inside that window.
-- It is NOT fixed here, deliberately: the honest repair is either to delay the
-- notification per-recipient (this trigger emits one row per helper, so it
-- could) or to accept it as the free tier's shape — a product decision about a
-- paid perk, not a trigger bug, and it is identical for
-- notify_saved_searches_on_new_job, instant-job-match and the digest crons.
-- Filed rather than guessed at.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The producer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260824070000's body — the parish loop, the notification copy, the email
-- fan-out through the vault secrets — unchanged except for the three gates and
-- the job_id column.

CREATE OR REPLACE FUNCTION public.notify_helpers_on_job_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  helper_record RECORD;
  v_title TEXT;
  v_message TEXT;
  v_link TEXT;
BEGIN
  IF NEW.parish IS NULL OR NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  -- The triggers' WHEN clauses already guarantee funded, so this is a
  -- belt-and-braces re-assertion for any future direct call.
  -- COALESCE, not a bare `= ANY`: payment_status is nullable, and a NULL would
  -- make the whole condition NULL, which an IF treats as false — i.e. it would
  -- fall THROUGH the guard and alert about an unfunded job.
  IF COALESCE(NEW.payment_status, '') <> ALL (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text]) THEN
    RETURN NEW;
  END IF;

  -- A job under a LIVE direct offer is addressed mail, not open-pool work:
  -- every browse surface hides it, so alerting on it would link a helper to a
  -- job they cannot see. It reappears (and is not re-alerted — see the UPDATE
  -- trigger's WHEN) once the offer resolves.
  IF NEW.offered_to_helper_id IS NOT NULL
     AND COALESCE(NEW.direct_offer_status, 'pending') NOT IN ('declined', 'expired')
  THEN
    RETURN NEW;
  END IF;

  -- Fixtures, on the same authority the three browse surfaces use. Never alert
  -- about a job the operator has hidden from the marketplace.
  IF COALESCE(NEW.is_seed, false) AND public.seed_jobs_hidden_publicly() THEN
    RETURN NEW;
  END IF;

  v_title := 'New job in your parish';
  v_message := 'A new ' || COALESCE(NEW.category::text, 'job') || ' job just posted in ' || NEW.parish || ' Parish: "' || NEW.title || '"';
  v_link := '/dashboard?job=' || NEW.id::text;

  FOR helper_record IN
    SELECT DISTINCT hpp.helper_id
    FROM public.helper_preferred_parishes hpp
    JOIN public.profiles p ON p.user_id = hpp.helper_id
    WHERE hpp.parish = NEW.parish
      AND p.approval_status = 'approved'
      AND COALESCE(p.ban_status, 'active') = 'active'
      AND hpp.helper_id <> NEW.customer_id
  LOOP
    -- job_id explicitly: see the header. The BEFORE INSERT fill trigger
    -- (20260901035600) only fills when the producer left it NULL, so naming it
    -- here wins and the recovery path is never relied on.
    INSERT INTO public.notifications (user_id, title, message, type, link, job_id)
    VALUES (helper_record.helper_id, v_title, v_message, 'job_match', v_link, NEW.id);

    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/send-notification-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := jsonb_build_object(
        'user_id', helper_record.helper_id,
        'title', v_title,
        'message', v_message,
        'type', 'job_match',
        'link', v_link
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

-- Re-asserted from 20260505190000 — CREATE OR REPLACE preserves grants, but
-- restating the posture beside the body is how the sibling migrations keep an
-- internal trigger function un-callable from PostgREST.
REVOKE ALL ON FUNCTION public.notify_helpers_on_job_post() FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Fire it at the transition into visible
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS notify_helpers_on_job_post_trigger ON public.jobs;
DROP TRIGGER IF EXISTS trg_notify_helpers_funded_insert ON public.jobs;
DROP TRIGGER IF EXISTS trg_notify_helpers_funded_update ON public.jobs;

-- Lands already funded and open.
CREATE TRIGGER trg_notify_helpers_funded_insert
  AFTER INSERT ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
  )
  EXECUTE FUNCTION public.notify_helpers_on_job_post();

-- The normal path: checkout completes and `payment_status` moves to 'escrow'.
-- The OLD-row half makes this the TRANSITION into visible. COALESCE on the OLD
-- side — see the header: without it a NULL payment_status makes the whole WHEN
-- NULL and the fan-out is silently lost.
CREATE TRIGGER trg_notify_helpers_funded_update
  AFTER UPDATE ON public.jobs
  FOR EACH ROW
  WHEN (
    NEW.status = 'open'::job_status
    AND NEW.payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    AND NOT (
      OLD.status = 'open'::job_status
      AND COALESCE(OLD.payment_status, '') = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])
    )
  )
  EXECUTE FUNCTION public.notify_helpers_on_job_post();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. VERIFY — the AFTER-INSERT-with-no-WHEN shape must not come back
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WARNING, not an exception, matching every sibling guard in this tree: the
-- useful outcome is db-deploy naming the trigger, not a blocked deploy.
--
-- Two checks, and the second is the one that matters. Any AFTER INSERT trigger
-- on `jobs` bound to a notify_* function with NO `WHEN` clause is, by
-- construction, firing at the moment payment_status is 'unpaid' — that is the
-- whole defect, stated as a shape rather than as a name, so it fires on a
-- producer written next year as readily as on this one.
DO $verify$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.tgname,
           p.proname,
           t.tgqual IS NULL AS no_when,
           (t.tgtype & 4) <> 0 AS on_insert
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.jobs'::regclass
       AND NOT t.tgisinternal
       AND p.proname LIKE 'notify\_%'
  LOOP
    IF r.on_insert AND r.no_when THEN
      RAISE WARNING
        'trigger % (%) is AFTER INSERT on public.jobs with NO WHEN clause — it fires while payment_status is still its ''unpaid'' default, so its notification links to a job that returns 0 rows from open_jobs_browse AND get_ranked_open_jobs. Gate it on the transition into funded+open (see this migration).',
        r.tgname, r.proname;
    END IF;
  END LOOP;

  -- The positive assertion: both halves of the pattern are actually installed.
  IF to_regclass('public.jobs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.jobs'::regclass
         AND tgname = 'trg_notify_helpers_funded_insert'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.jobs'::regclass
         AND tgname = 'trg_notify_helpers_funded_update'
    ) THEN
      RAISE WARNING 'the parish fan-out is missing one of its two triggers — a job that funds by UPDATE (the normal checkout path) or lands already funded will notify nobody';
    END IF;
  END IF;
END
$verify$;
