-- jobs.dispute_evidence_urls: append-only for the parties, and every element a
-- party adds must be their own upload for this job (Q398).
--
-- WHAT WAS OPEN. 20260925141905 made `<uid>/disputes/<job>/…` objects in
-- proof-photos immutable to the parties, and three writers already validate
-- what reaches `disputes.evidence_urls` with public.dispute_evidence_url_ok
-- (open_dispute_as, rpc_add_dispute_evidence, trg_dispute_evidence_append_only).
-- The legacy mirror `jobs.dispute_evidence_urls` had no such check:
--   * both parties can UPDATE it directly: authenticated holds TABLE-level
--     UPDATE on jobs, "Customers can update their own jobs" / "Helpers can
--     update their assigned jobs" cover the row, the helper whitelist lists the
--     column (newest enforce_helper_jobs_column_whitelist, 20260915101102), and
--     neither enforce_poster_jobs_money_lock nor enforce_dispute_markers_server_owned
--     (which left it client-writable on purpose, 20260915033734) locks it;
--   * the admin reads it (DisputeCard.tsx) whenever the disputes row has no
--     evidence, and the other party reads it (DisputeTimelineDialog legacy
--     fallback);
--   * so a party could list an object that is NOT under the immutable
--     `<uid>/disputes/<job>/` folder (an upper-case `DISPUTES` folder, any
--     other proof-photos path) and overwrite or delete it after the admin
--     looked, or remove / replace evidence already there, including the other
--     party's.
--   * INSERT too: enforce_jobs_insert_column_lock (20260924044812) does not
--     clear the column, and open_dispute_as APPENDS to whatever is there, so a
--     poster could create a job carrying pre-planted "evidence".
--
-- THE FIX, one BEFORE INSERT OR UPDATE trigger on jobs, same shape as the
-- sibling on disputes (enforce_dispute_evidence_append_only) and the same trust
-- test as the jobs-side precedents (enforce_dispute_markers_server_owned,
-- enforce_chargeback_due_server_owned). For a direct client write:
--   * INSERT: the column is cleared to '{}' (a new job has no dispute), the way
--     the markers and the chargeback deadline are cleared;
--   * UPDATE that changes it: nothing already there may be removed or replaced
--     (NEW must contain OLD), and every element added must pass
--     dispute_evidence_url_ok(e, auth.uid(), NEW.id), i.e. be the caller's own
--     `<uid>/disputes/<this job>/<file>` path (or the legacy signed URL of one).
--     dispute_evidence_url_ok is case-sensitive (`~`), so `DISPUTES` is refused.
--
-- WHY current_user, NOT is_server_context(), AND NOT AN RPC + COLUMN REVOKE.
--   * The trigger is deliberately NOT SECURITY DEFINER, so current_user is the
--     role the write runs as: `authenticated` / `anon` only for a direct
--     PostgREST write; `postgres` inside every SECURITY DEFINER RPC,
--     `service_role` for edge functions, `postgres` for cron and migrations.
--     The legitimate writers of this column are all in the trusted set and each
--     validates what it appends itself: open_dispute_as (both branches check
--     `_evidence_urls` against `_opener_id` with dispute_evidence_url_ok, and a
--     system filing must carry none; newest body 20260924220318), and
--     rpc_add_dispute_evidence's mirror (checks each URL against auth.uid(),
--     20260915071502). is_server_context() is false inside a user's SECURITY
--     DEFINER RPC (auth.uid() is the caller), so using it here would re-judge
--     every RPC write a second time against this trigger's idea of the
--     uploader, coupling a table lock to each RPC's rules; a future RPC that
--     mirrors on behalf of a different uploader would fail on the money path.
--     The jobs-side column locks all draw the line at current_user.
--   * An RPC + REVOKE UPDATE (dispute_evidence_urls) would not close anything:
--     authenticated holds TABLE-level UPDATE on jobs (measured live 2026-09-24,
--     20260924081103), which a column REVOKE does not remove, and every other
--     jobs column lock in this schema is a trigger for that reason. The trigger
--     also keeps the one client writer (DisputeTimelineDialog's legacy branch,
--     a party appending their own fresh upload) working unchanged.
--   * Admins are NOT exempt: no admin surface writes this column (AdminDisputes
--     only reads it), and an admin's other edits leave it unchanged, which this
--     trigger passes.
--
-- REPLAY-SAFE: CREATE OR REPLACE; the trigger is skipped when public.jobs does
-- not exist, and DROP TRIGGER IF EXISTS runs before CREATE. A jobs table
-- without the column fails loudly rather than shipping no lock.
--
-- Proof: src/test/pglite/jobsDisputeEvidenceAppendOnly.pglite.mjs (the live
-- jobs trigger chain from scripts/probes/fixtures/dispute-table-door.live.sql,
-- applied 3x; NEW_MIGRATION=skip is red). Class guard:
-- src/test/disputeEvidenceColumnsValidated.test.ts.

CREATE OR REPLACE FUNCTION public.enforce_jobs_dispute_evidence_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_added text;
BEGIN
  -- NOT SECURITY DEFINER, on purpose: current_user is the caller's role. A
  -- SECURITY DEFINER RPC sees its owner (postgres), the service key sees
  -- service_role, cron sees postgres. Only a direct client write sees
  -- authenticated / anon.
  IF current_user::text NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A new job has no dispute, so it has no dispute evidence.
  IF TG_OP = 'INSERT' THEN
    NEW.dispute_evidence_urls := '{}'::text[];
    RETURN NEW;
  END IF;

  IF NEW.dispute_evidence_urls IS NOT DISTINCT FROM OLD.dispute_evidence_urls THEN
    RETURN NEW;
  END IF;

  v_uid := auth.uid();
  -- No uid (anon) has no uploads of its own. Refused here rather than inside
  -- dispute_evidence_url_ok, which anon may not EXECUTE.
  IF v_uid IS NULL OR current_user::text = 'anon' THEN
    RAISE EXCEPTION 'dispute_evidence_invalid_url'
      USING ERRCODE = '42501',
            HINT = 'Only photos you uploaded to this dispute can be attached.';
  END IF;

  -- Nothing already filed may be removed or replaced by a party.
  IF NOT (COALESCE(NEW.dispute_evidence_urls, '{}'::text[])
            @> array_remove(COALESCE(OLD.dispute_evidence_urls, '{}'::text[]), NULL)) THEN
    RAISE EXCEPTION 'dispute_evidence_append_only'
      USING ERRCODE = '42501',
            HINT = 'Evidence already attached to a dispute cannot be removed or replaced.';
  END IF;

  -- Anything added is the caller's own upload for THIS job, in the folder
  -- 20260925141905 makes immutable to the parties.
  FOR v_added IN
    SELECT u FROM unnest(COALESCE(NEW.dispute_evidence_urls, '{}'::text[])) AS n(u)
    EXCEPT
    SELECT u FROM unnest(COALESCE(OLD.dispute_evidence_urls, '{}'::text[])) AS o(u)
  LOOP
    IF NOT COALESCE(public.dispute_evidence_url_ok(v_added, v_uid, NEW.id), false) THEN
      RAISE EXCEPTION 'dispute_evidence_invalid_url'
        USING ERRCODE = '42501',
              HINT = 'Only photos you uploaded to this dispute can be attached.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- A trigger function is run by the trigger machinery, never called by a role.
REVOKE ALL ON FUNCTION public.enforce_jobs_dispute_evidence_append_only() FROM PUBLIC, anon, authenticated;

DO $guard$
BEGIN
  IF to_regclass('public.jobs') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'jobs'
       AND column_name = 'dispute_evidence_urls'
  ) THEN
    RAISE EXCEPTION 'jobs_dispute_evidence_append_only: public.jobs.dispute_evidence_urls is missing';
  END IF;

  DROP TRIGGER IF EXISTS trg_jobs_dispute_evidence_append_only ON public.jobs;
  CREATE TRIGGER trg_jobs_dispute_evidence_append_only
    BEFORE INSERT OR UPDATE ON public.jobs
    FOR EACH ROW EXECUTE FUNCTION public.enforce_jobs_dispute_evidence_append_only();
END
$guard$;
