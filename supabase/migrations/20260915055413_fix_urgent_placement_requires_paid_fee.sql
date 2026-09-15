-- Urgent placement was FREE at the DB layer: is_urgent=true with a NULL/0
-- urgent_fee slipped straight through PostgREST.
--
-- SYMPTOM (hole hunt silent-client H-001, 2026-09-15). The jobs INSERT
-- column-lock trigger (enforce_jobs_insert_column_lock,
-- 20260903065305) deliberately leaves is_urgent / urgent_fee writable,
-- because the post-job wizard legitimately sets them — and its own header
-- says so, filing the recompute as "STILL OPEN, deliberately ... it should
-- not stay open past launch." A poster POSTing /rest/v1/jobs directly with
-- { is_urgent: true, urgent_fee: null } (or 0) therefore got the urgent
-- BENEFIT — instant, un-batched push fan-out to every matching helper
-- (instant-job-match keys off is_urgent alone) — without paying the $5
-- floor the wizard charges. At scale this also degrades the "Urgent" signal
-- itself, which is the whole reason it costs money.
--
-- WHY THE EXISTING GUARD MISSED IT. The live jobs_urgent_fee_required CHECK
-- (authored directly against prod, present in NO migration file — see
-- 20260902213110_add_urgent_fee_ceiling.sql's header and
-- src/test/fixtureSchemaContract.test.ts's "exist in no migration" list)
-- enforces the $5 FLOOR, but a floor written the natural way
-- (NOT is_urgent OR urgent_fee >= 5) is VACUOUSLY TRUE when urgent_fee IS
-- NULL and is_urgent is true: `NULL >= 5` is NULL, `false OR NULL` is NULL,
-- and a CHECK constraint passes on NULL (only FALSE rejects). So NULL fees
-- on urgent jobs were never caught. jobs_urgent_fee_ceiling (the sibling
-- two-sided range check) is likewise NULL-permissive by design.
--
-- FIX (this file): re-author jobs_urgent_fee_required with the NULL hole
-- closed — an urgent job MUST carry a fee at or above the floor, and NULL is
-- rejected explicitly. This brings the constraint into the migration ledger
-- for the first time (previously prod-only), so a from-scratch rebuild now
-- reproduces it. The create-payment recompute (server never trusts
-- jobs.urgent_fee; charges >= floor whenever is_urgent, else nothing) ships
-- alongside in the same commit for defence-in-depth on rows already stored.
--
-- FLOOR = 5 mirrors URGENT_FEE_FLOOR_DOLLARS in src/lib/moneyLimits.ts.
-- Change both together (the form is not the enforcement point — the jobs
-- INSERT goes through PostgREST with the poster's own token).
--
-- LEGACY ROWS. Any existing is_urgent=true row with a NULL/sub-floor fee got
-- its urgent placement for free and never legitimately paid for it, so the
-- honest correction is to DEMOTE it to non-urgent rather than invent a fee
-- the poster never agreed to. We do that first, then add the constraint as
-- VALID so the deploy fails loudly if anything still violates (it must not,
-- after the demote). Both steps only ever touch rows that are already
-- invalid under the intended rule.
--
-- REPLAY-SAFETY: guarded on to_regclass('public.jobs') so a from-scratch
-- rebuild is a no-op until jobs exists (urgent_fee dates to 20260311214625,
-- well before this file); DROP CONSTRAINT IF EXISTS before ADD so a re-run
-- never fails on "already exists".
DO $$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    -- Demote legacy free-urgent rows (invalid under the new rule) so the
    -- constraint below can be added as VALID.
    UPDATE public.jobs
       SET is_urgent = false
     WHERE is_urgent IS TRUE
       AND (urgent_fee IS NULL OR urgent_fee < 5);

    ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_urgent_fee_required;
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_urgent_fee_required
      CHECK (
        is_urgent IS NOT TRUE
        OR (urgent_fee IS NOT NULL AND urgent_fee >= 5)
      );
  END IF;
END $$;
