-- The saved-search fan-out must survive a NULL payment_status.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT — the OLD half of one WHEN clause, and it fails toward SILENCE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260901035245 correctly moved the saved-search fan-out off `AFTER INSERT
-- with no WHEN` and onto the transition into funded+open, split across an
-- INSERT trigger and an UPDATE trigger. Its UPDATE trigger writes the OLD half
-- as a bare comparison:
--
--     AND NOT (
--       OLD.status = 'open'::job_status
--       AND OLD.payment_status = ANY (ARRAY['escrow','payout_pending','released'])
--     )
--
-- `public.jobs.payment_status` is NULLABLE. It was added as
-- `TEXT DEFAULT 'unpaid'` with no NOT NULL (20260311001514), and the current
-- CHECK constraint (20260824210000) is a bare `= ANY (...)`, which a NULL
-- satisfies vacuously — a CHECK that evaluates to NULL passes. So a NULL is
-- insertable and updatable today.
--
-- 035245's own function body already says this out loud, in the comment above
-- its COALESCE guard: "payment_status is nullable, and a NULL would make the
-- whole condition NULL". That reasoning was applied to the function body and
-- not to the trigger's WHEN clause, and in the WHEN clause it fails the OTHER
-- way — not toward a spurious notification, but toward none at all:
--
--   OLD.status='open', OLD.payment_status IS NULL, NEW = open + 'escrow'
--     OLD.payment_status = ANY (...)  →  NULL
--     inner   = TRUE AND NULL         =  NULL
--     NOT inner                       =  NULL
--     whole WHEN = TRUE AND TRUE AND NULL = NULL
--
-- Postgres fires a row-level trigger only when its WHEN clause is TRUE. NULL
-- is not TRUE, so the row is skipped. A job that sat at a NULL payment_status
-- and then funded notifies NOBODY who had a saved search matching it — the
-- fan-out is lost silently, with no error and nothing in the logs to read.
--
-- That is strictly the worse direction. A premature notification (the defect
-- 035245 fixed) is a dead link the user can retry; a suppressed one is a job
-- the helper never learns exists.
--
-- The sibling lane hit the identical hazard on the parish fan-out and fixed it
-- there — 20260902015059 writes `COALESCE(OLD.payment_status, '')` in
-- trg_notify_helpers_funded_update and its header records, verbatim: "The same
-- latent hole in trg_notify_saved_searches_funded_update is reported to that
-- lane rather than edited here." This file is that lane. Same fix, same shape,
-- so the two producers cannot drift apart.
--
-- ── ONLY THE OLD SIDE GETS THE COALESCE, DELIBERATELY ───────────────────────
--
-- The NEW-side test (`NEW.payment_status = ANY (...)`) is left bare in both
-- triggers and must stay bare. There a NULL yielding NULL yields "do not fire",
-- which is the CORRECT answer: a job with no payment status is not funded and
-- must not be advertised. COALESCE-ing the NEW side would change nothing today
-- ('' is in no list either) but would state the wrong intent. The asymmetry is
-- the point: on the NEW row NULL means "not funded, stay quiet"; on the OLD row
-- NULL means "was not previously visible, so this IS the transition — fire".
--
-- ── LIVE OR LATENT: LATENT, TWICE OVER, MEASURED IN PROD ────────────────────
--
-- Read-only GETs against prod (fncmgoasalhdgfwzhsqa) on 2026-09-01:
--
--   jobs?payment_status=is.null          →  0 rows   (of 64 jobs)
--   saved_searches?select=id             →  0 rows
--
-- Two independent reasons this has never fired in anger: no job has ever held
-- a NULL payment_status, and no user has ever created a saved search, so the
-- producer's whole `FOR match_record IN SELECT ... FROM saved_searches` loop
-- has iterated zero times for the life of the product. Nothing is being lost
-- today. This guards the column's DECLARED shape rather than an observed row,
-- which — as the sibling migration puts it — is the only time it is cheap.
--
-- The root-cause alternative (`ALTER TABLE public.jobs ALTER COLUMN
-- payment_status SET NOT NULL`) would close this class permanently and would
-- succeed on prod's 0 NULL rows; nothing in `src/` or `supabase/` writes a NULL
-- payment_status. It is deliberately NOT done here: it is a schema tightening
-- on the busiest money table in the product, its blast radius is every writer
-- rather than this one trigger, and it belongs in a change that can be reasoned
-- about on its own. Recommended, not smuggled in.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT FIXED HERE, AND WHY — trg_notify_helper_on_direct_offer
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 20260902015059's verify block emits, on every deploy:
--
--   trigger trg_notify_helper_on_direct_offer (notify_helper_on_direct_offer)
--   is AFTER INSERT on public.jobs with NO WHEN clause — it fires while
--   payment_status is still its 'unpaid' default, so its notification links to
--   a job that returns 0 rows from open_jobs_browse AND get_ranked_open_jobs.
--
-- The premise is true and the conclusion does not follow. That check matches on
-- SHAPE (AFTER INSERT + no WHEN + `proname LIKE 'notify\_%'`), which is the
-- right instinct for an open-pool fan-out and cannot tell one apart from
-- addressed mail to a single named recipient. Three facts settle it:
--
--   1. The notification does not link to a browse surface. Its link is
--      '/my-jobs?filter=direct_offer' (20260831203052) — the offered helper's
--      own offer inbox, not '/dashboard?job=<uuid>'.
--   2. That inbox is served by `get_my_pending_direct_offers()`
--      (src/hooks/useActivityData.ts:314), whose WHERE clause is exactly
--      `offered_to_helper_id = auth.uid() AND direct_offer_status = 'pending'`
--      — no payment_status predicate and no early_access_cutoff predicate. The
--      link therefore RESOLVES at the instant it is sent, unpaid or not.
--   3. "0 rows from open_jobs_browse" is the DESIGNED state for this job and
--      always will be. Both 035245 and 015059 deliberately hide a job under a
--      live direct offer from all three browse surfaces, and their own producer
--      bodies re-assert it (`IF NEW.offered_to_helper_id IS NOT NULL ... RETURN
--      NEW`). Funding the job does not change that, so the measurement the
--      warning rests on would read 0 at every moment of the job's life.
--
-- So the saved-search hole and the direct-offer warning are TWO issues, not
-- one, and only the first is a defect. The direct-offer trigger is correct as
-- written and is left untouched; the warning is a false positive of a
-- deliberately conservative heuristic, and 20260902015059 is not edited to
-- silence it (it is already applied to prod, and a warning that occasionally
-- over-reports is the safe failure direction for a shape check).
--
-- One genuinely open question found next door and NOT addressed here, because
-- it is a product decision rather than a bug: `get_my_pending_direct_offers()`
-- does not exclude `payment_status IN ('abandoned','cancelled')`, so an offer
-- on a job whose poster abandoned checkout stays in the helper's inbox until
-- `direct_offer_status` changes. Prod holds exactly 1 job with a non-NULL
-- `offered_to_helper_id` and it is a seed fixture (5eed0827-…-000003,
-- cancelled/expired), so nothing is stuck today. Reported, not guessed at.

-- ═══════════════════════════════════════════════════════════════════════════
-- THE FIX
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Only the UPDATE trigger changes. The INSERT trigger and the producer function
-- are untouched — 035245's versions are correct, and re-stating them here would
-- create a second place for them to drift.
--
-- Replay-safe: DROP TRIGGER IF EXISTS + CREATE TRIGGER, guarded on the table
-- existing. Applying this file 1×, 2× or 3× consecutively leaves exactly one
-- trigger with exactly this definition.

DO $fix$
BEGIN
  IF to_regclass('public.jobs') IS NULL
     OR to_regprocedure('public.notify_saved_searches_on_new_job()') IS NULL
  THEN
    RAISE WARNING 'public.jobs or notify_saved_searches_on_new_job() is missing — skipping the saved-search UPDATE trigger rebuild';
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_notify_saved_searches_funded_update ON public.jobs;

  -- Identical to 20260901035245 except for the COALESCE on the OLD row.
  -- COALESCE, not `IS DISTINCT FROM`: '' is in none of the funded states, so an
  -- absent value behaves like every other not-yet-funded value — the inner
  -- expression is FALSE, `NOT FALSE` is TRUE, and the transition fires.
  CREATE TRIGGER trg_notify_saved_searches_funded_update
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
    EXECUTE FUNCTION public.notify_saved_searches_on_new_job();
END
$fix$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFY — no funded-transition trigger on `jobs` may read OLD.payment_status
--          without a NULL guard
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Stated as a SHAPE, not a name, so it catches the next producer written with
-- the same reflex. WARNING rather than EXCEPTION, matching every sibling guard
-- in this tree: db-deploy naming the trigger is the useful outcome, not a
-- blocked deploy. Note db-deploy does not depend on migration-lint, so a hard
-- failure here would reach prod as an outage rather than as a review comment.
DO $verify$
DECLARE
  r record;
  v_src text;
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT t.tgname, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgrelid = 'public.jobs'::regclass
       AND NOT t.tgisinternal
       AND p.proname LIKE 'notify\_%'
       AND (t.tgtype & 16) <> 0          -- fires on UPDATE
       AND t.tgqual IS NOT NULL          -- has a WHEN clause to inspect
  LOOP
    v_src := r.def;
    IF position('old.payment_status' in lower(v_src)) > 0
       AND position('coalesce(old.payment_status' in lower(v_src)) = 0
    THEN
      RAISE WARNING
        'trigger % reads OLD.payment_status in its WHEN clause with no COALESCE. payment_status is NULLABLE, so a NULL makes the whole WHEN evaluate to NULL, Postgres declines to fire the row, and the fan-out for a job that funds out of a NULL state is lost SILENTLY. Wrap it: COALESCE(OLD.payment_status, ''''). See this migration.',
        r.tgname;
    END IF;
  END LOOP;

  -- Positive assertion: the trigger this file exists to rebuild is installed,
  -- and it carries the guard.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'public.jobs'::regclass
       AND tgname = 'trg_notify_saved_searches_funded_update'
       AND position('coalesce(old.payment_status' in lower(pg_get_triggerdef(oid))) > 0
  ) THEN
    RAISE WARNING 'trg_notify_saved_searches_funded_update is missing or lost its COALESCE(OLD.payment_status) guard — a job that funds out of a NULL payment_status will notify no saved-search subscriber';
  END IF;
END
$verify$;

-- No new function is created or replaced by this migration, so there is no new
-- GRANT/REVOKE surface. `public.notify_saved_searches_on_new_job()` keeps the
-- posture 20260505190000 / 20260901035245 gave it; re-asserted here so the
-- lint's "every function touched states its grants" reading is satisfied by
-- inspection rather than by absence.
DO $grants$
BEGIN
  IF to_regprocedure('public.notify_saved_searches_on_new_job()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.notify_saved_searches_on_new_job() FROM PUBLIC, anon, authenticated;
  END IF;
END
$grants$;
