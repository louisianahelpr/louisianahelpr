-- Q448 (docs/OPEN.md; found by Q331, 2026-09-26): person-id columns NOT
-- named *user_id / *_by were outside the Q331 FK guard, so nothing checked
-- them. Inventory measured on prod 2026-10-07: every public BASE TABLE uuid
-- column joined against auth.users (count(non-null) vs count(matching)), plus
-- the zero-row tables' person columns by role; the guard now lists every one
-- (src/test/userIdForeignKeys.test.ts NAMED_PERSON_COLS) and each has a FK or
-- a reasoned exemption, as Q331 did.
--
-- DECISIONS (purge_user_data = live prosrc read 2026-10-07), the Q331 rule:
--   CASCADE  - purge DELETES the row: helper_availability (4j), user_blocks
--              both sides, job_tracking (4i), helper_shadowbans.
--   SET NULL - purge ANONYMISES it (nullable): group_job_helpers.helper_id
--              (roster slot kept, 4c), jobs.offered_to_helper_id, and
--              reports.reporter_id (4k); recurring_visit_payments.payer_id /
--              .helper_id and crew_dispute_member_outcomes.helper_id are money
--              records the purge does not touch, kept with the person
--              anonymised, the precedent of payment_refunds.customer_id and
--              payout_transfers.helper_id (both FK SET NULL).
--   NO FK    - with the reason in the guard: admin_audit_log.admin_id and
--              admin_user_notes.admin_id (compliance trail, Q331),
--              reports.reported_id (kept by design, 4k), and the NOT NULL money
--              ledgers the purge leaves alone (tips.helper_id / .tipper_id,
--              tip_hold_redrives.helper_id, instant_payouts.helper_id,
--              helper_w9_records.helper_id: a SET NULL could not run and a
--              NO ACTION / CASCADE would block or erase money history).
--
-- ORPHANS on prod 2026-10-07 (ids with no auth.users row): helper_availability
-- 7, user_blocks.blocked_id 2, reports.reporter_id 3; every other column 0.
-- Each is cleaned exactly as the purge would have (DELETE for CASCADE, NULL for
-- SET NULL) under a SHARE ROW EXCLUSIVE lock taken first, then ADD ... NOT
-- VALID and VALIDATE (the 20260926034714 pattern). Replay-safe: each block
-- runs only while its table exists and its constraint does not.

-- group_job_helpers.helper_id: ON DELETE SET NULL
DO $q448$
BEGIN
  IF to_regclass('public.group_job_helpers') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'group_job_helpers_helper_id_fkey'
                        AND conrelid = 'public.group_job_helpers'::regclass) THEN
    LOCK TABLE public.group_job_helpers IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.group_job_helpers x SET helper_id = NULL
     WHERE x.helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.helper_id);
    ALTER TABLE public.group_job_helpers
      ADD CONSTRAINT group_job_helpers_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.group_job_helpers VALIDATE CONSTRAINT group_job_helpers_helper_id_fkey;
  END IF;
END $q448$;

-- helper_availability.helper_id: ON DELETE CASCADE
DO $q448$
BEGIN
  IF to_regclass('public.helper_availability') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'helper_availability_helper_id_fkey'
                        AND conrelid = 'public.helper_availability'::regclass) THEN
    LOCK TABLE public.helper_availability IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.helper_availability x
     WHERE x.helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.helper_id);
    ALTER TABLE public.helper_availability
      ADD CONSTRAINT helper_availability_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.helper_availability VALIDATE CONSTRAINT helper_availability_helper_id_fkey;
  END IF;
END $q448$;

-- jobs.offered_to_helper_id: ON DELETE SET NULL
DO $q448$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'jobs_offered_to_helper_id_fkey'
                        AND conrelid = 'public.jobs'::regclass) THEN
    LOCK TABLE public.jobs IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.jobs x SET offered_to_helper_id = NULL
     WHERE x.offered_to_helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.offered_to_helper_id);
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_offered_to_helper_id_fkey
      FOREIGN KEY (offered_to_helper_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_offered_to_helper_id_fkey;
  END IF;
END $q448$;

-- user_blocks.blocked_id: ON DELETE CASCADE
DO $q448$
BEGIN
  IF to_regclass('public.user_blocks') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'user_blocks_blocked_id_fkey'
                        AND conrelid = 'public.user_blocks'::regclass) THEN
    LOCK TABLE public.user_blocks IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.user_blocks x
     WHERE x.blocked_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.blocked_id);
    ALTER TABLE public.user_blocks
      ADD CONSTRAINT user_blocks_blocked_id_fkey
      FOREIGN KEY (blocked_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.user_blocks VALIDATE CONSTRAINT user_blocks_blocked_id_fkey;
  END IF;
END $q448$;

-- user_blocks.blocker_id: ON DELETE CASCADE
DO $q448$
BEGIN
  IF to_regclass('public.user_blocks') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'user_blocks_blocker_id_fkey'
                        AND conrelid = 'public.user_blocks'::regclass) THEN
    LOCK TABLE public.user_blocks IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.user_blocks x
     WHERE x.blocker_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.blocker_id);
    ALTER TABLE public.user_blocks
      ADD CONSTRAINT user_blocks_blocker_id_fkey
      FOREIGN KEY (blocker_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.user_blocks VALIDATE CONSTRAINT user_blocks_blocker_id_fkey;
  END IF;
END $q448$;

-- reports.reporter_id: ON DELETE SET NULL
DO $q448$
BEGIN
  IF to_regclass('public.reports') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'reports_reporter_id_fkey'
                        AND conrelid = 'public.reports'::regclass) THEN
    LOCK TABLE public.reports IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.reports x SET reporter_id = NULL
     WHERE x.reporter_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.reporter_id);
    ALTER TABLE public.reports
      ADD CONSTRAINT reports_reporter_id_fkey
      FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.reports VALIDATE CONSTRAINT reports_reporter_id_fkey;
  END IF;
END $q448$;

-- recurring_visit_payments.payer_id: ON DELETE SET NULL
DO $q448$
BEGIN
  IF to_regclass('public.recurring_visit_payments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'recurring_visit_payments_payer_id_fkey'
                        AND conrelid = 'public.recurring_visit_payments'::regclass) THEN
    LOCK TABLE public.recurring_visit_payments IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.recurring_visit_payments x SET payer_id = NULL
     WHERE x.payer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.payer_id);
    ALTER TABLE public.recurring_visit_payments
      ADD CONSTRAINT recurring_visit_payments_payer_id_fkey
      FOREIGN KEY (payer_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.recurring_visit_payments VALIDATE CONSTRAINT recurring_visit_payments_payer_id_fkey;
  END IF;
END $q448$;

-- recurring_visit_payments.helper_id: ON DELETE SET NULL
DO $q448$
BEGIN
  IF to_regclass('public.recurring_visit_payments') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'recurring_visit_payments_helper_id_fkey'
                        AND conrelid = 'public.recurring_visit_payments'::regclass) THEN
    LOCK TABLE public.recurring_visit_payments IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.recurring_visit_payments x SET helper_id = NULL
     WHERE x.helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.helper_id);
    ALTER TABLE public.recurring_visit_payments
      ADD CONSTRAINT recurring_visit_payments_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.recurring_visit_payments VALIDATE CONSTRAINT recurring_visit_payments_helper_id_fkey;
  END IF;
END $q448$;

-- job_tracking.helper_id: ON DELETE CASCADE
DO $q448$
BEGIN
  IF to_regclass('public.job_tracking') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'job_tracking_helper_id_fkey'
                        AND conrelid = 'public.job_tracking'::regclass) THEN
    LOCK TABLE public.job_tracking IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.job_tracking x
     WHERE x.helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.helper_id);
    ALTER TABLE public.job_tracking
      ADD CONSTRAINT job_tracking_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.job_tracking VALIDATE CONSTRAINT job_tracking_helper_id_fkey;
  END IF;
END $q448$;

-- helper_shadowbans.helper_id: ON DELETE CASCADE
DO $q448$
BEGIN
  IF to_regclass('public.helper_shadowbans') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'helper_shadowbans_helper_id_fkey'
                        AND conrelid = 'public.helper_shadowbans'::regclass) THEN
    LOCK TABLE public.helper_shadowbans IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.helper_shadowbans x
     WHERE x.helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.helper_id);
    ALTER TABLE public.helper_shadowbans
      ADD CONSTRAINT helper_shadowbans_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.helper_shadowbans VALIDATE CONSTRAINT helper_shadowbans_helper_id_fkey;
  END IF;
END $q448$;

-- crew_dispute_member_outcomes.helper_id: ON DELETE SET NULL
DO $q448$
BEGIN
  IF to_regclass('public.crew_dispute_member_outcomes') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'crew_dispute_member_outcomes_helper_id_fkey'
                        AND conrelid = 'public.crew_dispute_member_outcomes'::regclass) THEN
    LOCK TABLE public.crew_dispute_member_outcomes IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.crew_dispute_member_outcomes x SET helper_id = NULL
     WHERE x.helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.helper_id);
    ALTER TABLE public.crew_dispute_member_outcomes
      ADD CONSTRAINT crew_dispute_member_outcomes_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.crew_dispute_member_outcomes VALIDATE CONSTRAINT crew_dispute_member_outcomes_helper_id_fkey;
  END IF;
END $q448$;

-- crew_confirm_pending.helper_id: ON DELETE CASCADE (added on landing: the
-- table arrived with #2523, 20261007011530, after this guard was widened). A
-- pending crew confirmation for an account that no longer exists has nobody
-- to confirm; the roster slot itself is handled by group_job_helpers' FK.
-- Live 2026-10-07: 0 rows.
DO $q448$
BEGIN
  IF to_regclass('public.crew_confirm_pending') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'crew_confirm_pending_helper_id_fkey'
                        AND conrelid = 'public.crew_confirm_pending'::regclass) THEN
    LOCK TABLE public.crew_confirm_pending IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.crew_confirm_pending x
     WHERE x.helper_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.helper_id);
    ALTER TABLE public.crew_confirm_pending
      ADD CONSTRAINT crew_confirm_pending_helper_id_fkey
      FOREIGN KEY (helper_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.crew_confirm_pending VALIDATE CONSTRAINT crew_confirm_pending_helper_id_fkey;
  END IF;
END $q448$;

-- A direct offer whose target account is gone is retired (lh-authz-rls review
-- of Q448, finding 3). purge_user_data step 4p NULLs offered_to_helper_id and
-- leaves direct_offer_status 'pending'; the new FK does the same. That row is
-- public in open_jobs_browse (offered_to_helper_id IS NULL) while the poster's
-- card still says the offer is out, and expire_pending_direct_offers later
-- tells them it "was not accepted" (the Q1325 state). Clients cannot reach
-- this: enforce_hire_columns_rpc_only refuses any client change to the column.
-- Measured 2026-10-07: 0 jobs in that state on prod (3 pending offers, each
-- with a live target).
CREATE OR REPLACE FUNCTION public.jobs_offer_target_gone_retires_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.offered_to_helper_id IS NOT NULL
     AND NEW.offered_to_helper_id IS NULL
     AND NEW.direct_offer_status = 'pending' THEN
    NEW.direct_offer_status := 'expired';
    IF NEW.customer_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, link)
      VALUES (NEW.customer_id,
              'Direct offer closed',
              'The Helpr you offered "' || COALESCE(NEW.title, 'your job')
                || '" to is no longer on Helpr. The job is now open to everyone.',
              'job_updates',
              '/posts?job=' || NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.jobs_offer_target_gone_retires_offer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zzz_jobs_offer_target_gone_retires_offer ON public.jobs;
CREATE TRIGGER zzz_jobs_offer_target_gone_retires_offer
  BEFORE UPDATE OF offered_to_helper_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_offer_target_gone_retires_offer();
