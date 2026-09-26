-- Q331 (found by Q282), 2026-09-26: every public *user_id / *_by column that
-- names a person gets a foreign key to auth.users, with the ON DELETE action
-- that matches what purge_user_data already does to it, so an account removed
-- by any path that skips the purge (admin API, fixture cleanup, a failed
-- purge RPC) cannot leave rows behind. Q282 did notification_preferences and
-- messages.sender_id the same way (20260924010547).
--
-- DECISIONS (purge_user_data = live prosrc read 2026-09-26):
--   CASCADE   - purge DELETES the row: admin_user_notes, email_tracking,
--               fraud_flags, job_checkins, login_history, notification_logs,
--               push_tokens, referral_credits.user_id, saved_jobs,
--               saved_searches, user_violations.user_id, referrals.referred_id.
--               notification_dedupe_suppressions is per-user dedupe state the
--               purge never touched (the Q331 purge gap); CASCADE closes it for
--               every path, the purge included (its auth delete cascades).
--   SET NULL  - purge ANONYMISES the row (nullable column): analytics_events,
--               error_logs, legal_acceptances, referral_codes,
--               referral_credits.referred_user_id, user_violations.reported_by,
--               referrals.referrer_id, jobs.cancelled_by / disputed_by,
--               profiles.license_reviewed_by / insurance_reviewed_by.
--               dispute_settlement_claims.claimed_by and
--               job_completion_nudges.resolved_by name the admin who acted;
--               the purge does not touch them, and they follow the existing
--               precedent for that exact case (disputes.decided_by,
--               user_strikes.issued_by, helper_verifications.changed_by are all
--               FK SET NULL).
--   NO FK     - deliberately, with the reason in
--               src/test/userIdForeignKeys.test.ts: user_bans.user_id and
--               .banned_by (a ban outlives the account by design: the purge
--               retains it, 20260903035008 4n, and retain_ban_on_deletion
--               carries it forward), jobs.removed_by (an admin enforcement
--               record the purge deliberately retains, 4p).
--
-- referrals is not a *user_id / *_by column, but it is here on purpose: the
-- new referral_credits.user_id FK means an orphaned referrals.referrer_id
-- would make check_referral_bonus (AFTER UPDATE on jobs) raise 23503 and roll
-- back the referee's job completion. Its FKs keep that pointer real or NULL,
-- matching the purge (4g: referrer anonymised, referred row deleted).
--
-- PURGE PARITY for SET NULL: the purge nulls more than the id on three tables
-- (legal_acceptances ip/user agent, error_logs user agent, referral_codes
-- code rewritten so an ownerless code is not a live coupon). A plain FK SET
-- NULL would not, so a BEFORE UPDATE OF <id> trigger does the same whenever the
-- id goes from a value to NULL, whoever does it (purge, FK action, cleanup).
--
-- ORPHANS measured on prod 2026-09-26 (rows whose id has no auth.users row;
-- none matched a profiles.id, so no writer is using the wrong key):
--   notification_logs 1939 (38 ids), analytics_events 820 (31),
--   login_history 482 (29), notification_dedupe_suppressions 185 (2),
--   error_logs 130 (6), referral_codes 42 (42), legal_acceptances 11 (10),
--   admin_user_notes 2 (2), user_bans 1 (kept: no FK). Every other column 0.
-- Each is cleaned exactly as the purge would have (DELETE for CASCADE
-- tables, the anonymise update for SET NULL tables) under a SHARE ROW
-- EXCLUSIVE lock taken first, so no concurrent insert can slip an orphan in
-- between the cleanup and the constraint; then ADD ... NOT VALID and VALIDATE.
--
-- CASCADE/SET NULL actions run the same DELETE/UPDATE the purge already runs
-- on these rows on every account deletion, as the table owner, so the BEFORE
-- UPDATE triggers on jobs and profiles see the same context they see today.
--
-- detect_suspicious_user_patterns pattern 2 grouped reports by reported_id,
-- which has no FK (reports survive a deleted subject by design, 4k). With
-- fraud_flags.user_id now an FK, a deleted user with 3+ reports would raise
-- 23503 in that loop every run and page ops via log_cron_defect. It now skips
-- subjects with no auth.users row; the body is otherwise byte-identical to the
-- live one (md5 29ef125da21524a52760065d295f14e2, 20260831193039).
--
-- Guard: src/test/userIdForeignKeys.test.ts (every *user_id / *_by uuid column
-- has an FK to auth.users/profiles or a reasoned exemption, both directions).

-- ── Purge-parity triggers (before the cleanup, so it goes through them) ─────
CREATE OR REPLACE FUNCTION public.redact_referral_code_on_owner_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL THEN
    NEW.code := 'REDACTED-' || replace(NEW.id::text, '-', '');
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.redact_legal_acceptance_on_user_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL THEN
    NEW.ip_address := NULL;
    NEW.user_agent := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.redact_error_log_on_user_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.user_id IS NOT NULL AND NEW.user_id IS NULL THEN
    NEW.user_agent := NULL;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.redact_referral_code_on_owner_null()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_legal_acceptance_on_user_null() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.redact_error_log_on_user_null()        FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_redact_referral_code_on_owner_null ON public.referral_codes;
CREATE TRIGGER trg_redact_referral_code_on_owner_null
  BEFORE UPDATE OF user_id ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.redact_referral_code_on_owner_null();

DROP TRIGGER IF EXISTS trg_redact_legal_acceptance_on_user_null ON public.legal_acceptances;
CREATE TRIGGER trg_redact_legal_acceptance_on_user_null
  BEFORE UPDATE OF user_id ON public.legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.redact_legal_acceptance_on_user_null();

DROP TRIGGER IF EXISTS trg_redact_error_log_on_user_null ON public.error_logs;
CREATE TRIGGER trg_redact_error_log_on_user_null
  BEFORE UPDATE OF user_id ON public.error_logs
  FOR EACH ROW EXECUTE FUNCTION public.redact_error_log_on_user_null();

-- ── Foreign keys: lock, clean orphans as the purge would, add, validate ─────
-- admin_user_notes.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.admin_user_notes') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'admin_user_notes_user_id_fkey'
                        AND conrelid = 'public.admin_user_notes'::regclass) THEN
    LOCK TABLE public.admin_user_notes IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.admin_user_notes x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.admin_user_notes
      ADD CONSTRAINT admin_user_notes_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.admin_user_notes VALIDATE CONSTRAINT admin_user_notes_user_id_fkey;
  END IF;
END $q331$;

-- email_tracking.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.email_tracking') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'email_tracking_user_id_fkey'
                        AND conrelid = 'public.email_tracking'::regclass) THEN
    LOCK TABLE public.email_tracking IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.email_tracking x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.email_tracking
      ADD CONSTRAINT email_tracking_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.email_tracking VALIDATE CONSTRAINT email_tracking_user_id_fkey;
  END IF;
END $q331$;

-- fraud_flags.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.fraud_flags') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'fraud_flags_user_id_fkey'
                        AND conrelid = 'public.fraud_flags'::regclass) THEN
    LOCK TABLE public.fraud_flags IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.fraud_flags x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.fraud_flags
      ADD CONSTRAINT fraud_flags_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.fraud_flags VALIDATE CONSTRAINT fraud_flags_user_id_fkey;
  END IF;
END $q331$;

-- job_checkins.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.job_checkins') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'job_checkins_user_id_fkey'
                        AND conrelid = 'public.job_checkins'::regclass) THEN
    LOCK TABLE public.job_checkins IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.job_checkins x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.job_checkins
      ADD CONSTRAINT job_checkins_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.job_checkins VALIDATE CONSTRAINT job_checkins_user_id_fkey;
  END IF;
END $q331$;

-- login_history.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.login_history') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'login_history_user_id_fkey'
                        AND conrelid = 'public.login_history'::regclass) THEN
    LOCK TABLE public.login_history IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.login_history x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.login_history
      ADD CONSTRAINT login_history_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.login_history VALIDATE CONSTRAINT login_history_user_id_fkey;
  END IF;
END $q331$;

-- notification_dedupe_suppressions.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.notification_dedupe_suppressions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'notification_dedupe_suppressions_user_id_fkey'
                        AND conrelid = 'public.notification_dedupe_suppressions'::regclass) THEN
    LOCK TABLE public.notification_dedupe_suppressions IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.notification_dedupe_suppressions x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.notification_dedupe_suppressions
      ADD CONSTRAINT notification_dedupe_suppressions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.notification_dedupe_suppressions VALIDATE CONSTRAINT notification_dedupe_suppressions_user_id_fkey;
  END IF;
END $q331$;

-- notification_logs.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.notification_logs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'notification_logs_user_id_fkey'
                        AND conrelid = 'public.notification_logs'::regclass) THEN
    LOCK TABLE public.notification_logs IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.notification_logs x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.notification_logs
      ADD CONSTRAINT notification_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.notification_logs VALIDATE CONSTRAINT notification_logs_user_id_fkey;
  END IF;
END $q331$;

-- push_tokens.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.push_tokens') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'push_tokens_user_id_fkey'
                        AND conrelid = 'public.push_tokens'::regclass) THEN
    LOCK TABLE public.push_tokens IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.push_tokens x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.push_tokens
      ADD CONSTRAINT push_tokens_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.push_tokens VALIDATE CONSTRAINT push_tokens_user_id_fkey;
  END IF;
END $q331$;

-- referral_credits.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.referral_credits') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'referral_credits_user_id_fkey'
                        AND conrelid = 'public.referral_credits'::regclass) THEN
    LOCK TABLE public.referral_credits IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.referral_credits x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.referral_credits
      ADD CONSTRAINT referral_credits_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.referral_credits VALIDATE CONSTRAINT referral_credits_user_id_fkey;
  END IF;
END $q331$;

-- saved_jobs.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.saved_jobs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'saved_jobs_user_id_fkey'
                        AND conrelid = 'public.saved_jobs'::regclass) THEN
    LOCK TABLE public.saved_jobs IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.saved_jobs x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.saved_jobs
      ADD CONSTRAINT saved_jobs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.saved_jobs VALIDATE CONSTRAINT saved_jobs_user_id_fkey;
  END IF;
END $q331$;

-- saved_searches.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.saved_searches') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'saved_searches_user_id_fkey'
                        AND conrelid = 'public.saved_searches'::regclass) THEN
    LOCK TABLE public.saved_searches IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.saved_searches x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.saved_searches
      ADD CONSTRAINT saved_searches_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.saved_searches VALIDATE CONSTRAINT saved_searches_user_id_fkey;
  END IF;
END $q331$;

-- user_violations.user_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.user_violations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'user_violations_user_id_fkey'
                        AND conrelid = 'public.user_violations'::regclass) THEN
    LOCK TABLE public.user_violations IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.user_violations x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.user_violations
      ADD CONSTRAINT user_violations_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.user_violations VALIDATE CONSTRAINT user_violations_user_id_fkey;
  END IF;
END $q331$;

-- referrals.referred_id: ON DELETE CASCADE
DO $q331$
BEGIN
  IF to_regclass('public.referrals') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'referrals_referred_id_fkey'
                        AND conrelid = 'public.referrals'::regclass) THEN
    LOCK TABLE public.referrals IN SHARE ROW EXCLUSIVE MODE;
    DELETE FROM public.referrals x
     WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.referred_id);
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_referred_id_fkey
      FOREIGN KEY (referred_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    ALTER TABLE public.referrals VALIDATE CONSTRAINT referrals_referred_id_fkey;
  END IF;
END $q331$;

-- analytics_events.user_id: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.analytics_events') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'analytics_events_user_id_fkey'
                        AND conrelid = 'public.analytics_events'::regclass) THEN
    LOCK TABLE public.analytics_events IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.analytics_events x SET user_id = NULL
     WHERE x.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.analytics_events
      ADD CONSTRAINT analytics_events_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.analytics_events VALIDATE CONSTRAINT analytics_events_user_id_fkey;
  END IF;
END $q331$;

-- error_logs.user_id: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.error_logs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'error_logs_user_id_fkey'
                        AND conrelid = 'public.error_logs'::regclass) THEN
    LOCK TABLE public.error_logs IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.error_logs x SET user_id = NULL
     WHERE x.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.error_logs
      ADD CONSTRAINT error_logs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.error_logs VALIDATE CONSTRAINT error_logs_user_id_fkey;
  END IF;
END $q331$;

-- legal_acceptances.user_id: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.legal_acceptances') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'legal_acceptances_user_id_fkey'
                        AND conrelid = 'public.legal_acceptances'::regclass) THEN
    LOCK TABLE public.legal_acceptances IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.legal_acceptances x SET user_id = NULL
     WHERE x.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.legal_acceptances
      ADD CONSTRAINT legal_acceptances_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.legal_acceptances VALIDATE CONSTRAINT legal_acceptances_user_id_fkey;
  END IF;
END $q331$;

-- referral_codes.user_id: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.referral_codes') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'referral_codes_user_id_fkey'
                        AND conrelid = 'public.referral_codes'::regclass) THEN
    LOCK TABLE public.referral_codes IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.referral_codes x SET user_id = NULL
     WHERE x.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.user_id);
    ALTER TABLE public.referral_codes
      ADD CONSTRAINT referral_codes_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.referral_codes VALIDATE CONSTRAINT referral_codes_user_id_fkey;
  END IF;
END $q331$;

-- referral_credits.referred_user_id: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.referral_credits') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'referral_credits_referred_user_id_fkey'
                        AND conrelid = 'public.referral_credits'::regclass) THEN
    LOCK TABLE public.referral_credits IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.referral_credits x SET referred_user_id = NULL
     WHERE x.referred_user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.referred_user_id);
    ALTER TABLE public.referral_credits
      ADD CONSTRAINT referral_credits_referred_user_id_fkey
      FOREIGN KEY (referred_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.referral_credits VALIDATE CONSTRAINT referral_credits_referred_user_id_fkey;
  END IF;
END $q331$;

-- user_violations.reported_by: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.user_violations') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'user_violations_reported_by_fkey'
                        AND conrelid = 'public.user_violations'::regclass) THEN
    LOCK TABLE public.user_violations IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.user_violations x SET reported_by = NULL
     WHERE x.reported_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.reported_by);
    ALTER TABLE public.user_violations
      ADD CONSTRAINT user_violations_reported_by_fkey
      FOREIGN KEY (reported_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.user_violations VALIDATE CONSTRAINT user_violations_reported_by_fkey;
  END IF;
END $q331$;

-- referrals.referrer_id: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.referrals') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'referrals_referrer_id_fkey'
                        AND conrelid = 'public.referrals'::regclass) THEN
    LOCK TABLE public.referrals IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.referrals x SET referrer_id = NULL
     WHERE x.referrer_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.referrer_id);
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_referrer_id_fkey
      FOREIGN KEY (referrer_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.referrals VALIDATE CONSTRAINT referrals_referrer_id_fkey;
  END IF;
END $q331$;

-- jobs.cancelled_by: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'jobs_cancelled_by_fkey'
                        AND conrelid = 'public.jobs'::regclass) THEN
    LOCK TABLE public.jobs IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.jobs x SET cancelled_by = NULL
     WHERE x.cancelled_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.cancelled_by);
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_cancelled_by_fkey
      FOREIGN KEY (cancelled_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_cancelled_by_fkey;
  END IF;
END $q331$;

-- jobs.disputed_by: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'jobs_disputed_by_fkey'
                        AND conrelid = 'public.jobs'::regclass) THEN
    LOCK TABLE public.jobs IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.jobs x SET disputed_by = NULL
     WHERE x.disputed_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.disputed_by);
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_disputed_by_fkey
      FOREIGN KEY (disputed_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_disputed_by_fkey;
  END IF;
END $q331$;

-- profiles.license_reviewed_by: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'profiles_license_reviewed_by_fkey'
                        AND conrelid = 'public.profiles'::regclass) THEN
    LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.profiles x SET license_reviewed_by = NULL
     WHERE x.license_reviewed_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.license_reviewed_by);
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_license_reviewed_by_fkey
      FOREIGN KEY (license_reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_license_reviewed_by_fkey;
  END IF;
END $q331$;

-- profiles.insurance_reviewed_by: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'profiles_insurance_reviewed_by_fkey'
                        AND conrelid = 'public.profiles'::regclass) THEN
    LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.profiles x SET insurance_reviewed_by = NULL
     WHERE x.insurance_reviewed_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.insurance_reviewed_by);
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_insurance_reviewed_by_fkey
      FOREIGN KEY (insurance_reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_insurance_reviewed_by_fkey;
  END IF;
END $q331$;

-- dispute_settlement_claims.claimed_by: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.dispute_settlement_claims') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'dispute_settlement_claims_claimed_by_fkey'
                        AND conrelid = 'public.dispute_settlement_claims'::regclass) THEN
    LOCK TABLE public.dispute_settlement_claims IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.dispute_settlement_claims x SET claimed_by = NULL
     WHERE x.claimed_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.claimed_by);
    ALTER TABLE public.dispute_settlement_claims
      ADD CONSTRAINT dispute_settlement_claims_claimed_by_fkey
      FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.dispute_settlement_claims VALIDATE CONSTRAINT dispute_settlement_claims_claimed_by_fkey;
  END IF;
END $q331$;

-- job_completion_nudges.resolved_by: ON DELETE SET NULL
DO $q331$
BEGIN
  IF to_regclass('public.job_completion_nudges') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'job_completion_nudges_resolved_by_fkey'
                        AND conrelid = 'public.job_completion_nudges'::regclass) THEN
    LOCK TABLE public.job_completion_nudges IN SHARE ROW EXCLUSIVE MODE;
    UPDATE public.job_completion_nudges x SET resolved_by = NULL
     WHERE x.resolved_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.resolved_by);
    ALTER TABLE public.job_completion_nudges
      ADD CONSTRAINT job_completion_nudges_resolved_by_fkey
      FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.job_completion_nudges VALIDATE CONSTRAINT job_completion_nudges_resolved_by_fkey;
  END IF;
END $q331$;

-- ── Indexes: an FK action on account deletion looks rows up by the column ──
CREATE INDEX IF NOT EXISTS idx_fraud_flags_user_id ON public.fraud_flags (user_id);
CREATE INDEX IF NOT EXISTS idx_notification_dedupe_suppressions_user_id
  ON public.notification_dedupe_suppressions (user_id);
CREATE INDEX IF NOT EXISTS idx_referral_credits_referred_user_id
  ON public.referral_credits (referred_user_id) WHERE referred_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_violations_reported_by
  ON public.user_violations (reported_by) WHERE reported_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_cancelled_by ON public.jobs (cancelled_by) WHERE cancelled_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_disputed_by ON public.jobs (disputed_by) WHERE disputed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_license_reviewed_by
  ON public.profiles (license_reviewed_by) WHERE license_reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_insurance_reviewed_by
  ON public.profiles (insurance_reviewed_by) WHERE insurance_reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dispute_settlement_claims_claimed_by
  ON public.dispute_settlement_claims (claimed_by) WHERE claimed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_completion_nudges_resolved_by
  ON public.job_completion_nudges (resolved_by) WHERE resolved_by IS NOT NULL;

-- ── detect_suspicious_user_patterns: pattern 2 skips deleted subjects ──────
CREATE OR REPLACE FUNCTION public.detect_suspicious_user_patterns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  flagged integer := 0;
  rec RECORD;
BEGIN
  -- Pattern 1: burst job posting (10+ jobs in 24h)
  FOR rec IN
    SELECT customer_id AS user_id, COUNT(*) AS job_count
    FROM public.jobs
    WHERE created_at > NOW() - INTERVAL '24 hours'
      AND customer_id IS NOT NULL
    GROUP BY customer_id
    HAVING COUNT(*) >= 10
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'burst_job_posting'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'burst_job_posting',
          format('Posted %s jobs in the last 24h (threshold 10). Possible bot or spam pattern.', rec.job_count),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'burst_job_posting', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns burst_job_posting: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  -- Pattern 2: multi-reporter pile-on (3+ distinct reporters in 30d)
  FOR rec IN
    SELECT
      r.reported_id AS user_id,
      COUNT(DISTINCT r.reporter_id) AS distinct_reporters
    FROM public.reports r
    WHERE r.reported_type = 'user'
      AND r.created_at > NOW() - INTERVAL '30 days'
      -- Q331: a deleted subject cannot be flagged (fraud_flags.user_id FK).
      AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = r.reported_id)
      AND COALESCE(r.status, 'open') NOT IN ('dismissed', 'invalid')
    GROUP BY r.reported_id
    HAVING COUNT(DISTINCT r.reporter_id) >= 3
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'multi_reporter_flag'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'multi_reporter_flag',
          format('Reported by %s distinct reporters in the last 30 days (threshold 3). Pile-on signal.', rec.distinct_reporters),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'multi_reporter_flag', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns multi_reporter_flag: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  -- Pattern 3: rapid cancellation (5+ jobs cancelled within 2h of post in 7d)
  FOR rec IN
    SELECT customer_id AS user_id, COUNT(*) AS rapid_cancel_count
    FROM public.jobs
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND customer_id IS NOT NULL
      AND status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancelled_at - created_at < INTERVAL '2 hours'
    GROUP BY customer_id
    HAVING COUNT(*) >= 5
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'rapid_cancellation_pattern'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'rapid_cancellation_pattern',
          format('Cancelled %s jobs within 2h of posting in the last 7 days (threshold 5). Possible platform churn/test pattern.', rec.rapid_cancel_count),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'rapid_cancellation_pattern', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns rapid_cancellation_pattern: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  -- Pattern 4: duplicate-content posting (3+ jobs with identical title
  -- OR identical description in last 7d). DISTINCT ON preserves the
  -- single highest-count row per customer so dup_value, dup_field, and
  -- dup_count always describe the same underlying record.
  FOR rec IN
    SELECT DISTINCT ON (customer_id)
      customer_id AS user_id,
      dup_count,
      dup_value,
      dup_field
    FROM (
      SELECT
        customer_id,
        title AS dup_value,
        'title' AS dup_field,
        COUNT(*) AS dup_count
      FROM public.jobs
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND customer_id IS NOT NULL
        AND parent_job_id IS NULL
        AND title IS NOT NULL
        AND length(trim(title)) > 0
      GROUP BY customer_id, title
      HAVING COUNT(*) >= 3
      UNION ALL
      SELECT
        customer_id,
        left(description, 80) AS dup_value,
        'description' AS dup_field,
        COUNT(*) AS dup_count
      FROM public.jobs
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND customer_id IS NOT NULL
        AND parent_job_id IS NULL
        AND description IS NOT NULL
        AND length(trim(description)) > 20
      GROUP BY customer_id, description
      HAVING COUNT(*) >= 3
    ) dups
    ORDER BY customer_id, dup_count DESC
  LOOP
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.fraud_flags ff
        WHERE ff.user_id = rec.user_id
          AND ff.flag_type = 'duplicate_content_posting'
          AND ff.resolved = false
      ) THEN
        INSERT INTO public.fraud_flags (user_id, flag_type, details, resolved)
        VALUES (
          rec.user_id,
          'duplicate_content_posting',
          format(
            'Posted %s jobs in the last 7 days with identical %s ("%s"...). Possible copy-paste spam.',
            rec.dup_count,
            rec.dup_field,
            left(rec.dup_value, 60)
          ),
          false
        );
        flagged := flagged + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.log_cron_defect(
        'detect_suspicious_user_patterns', rec.user_id::text, SQLERRM,
        jsonb_build_object('pattern', 'duplicate_content_posting', 'user_id', rec.user_id));
      RAISE NOTICE 'detect_suspicious_user_patterns duplicate_content_posting: user % failed: %', rec.user_id, SQLERRM;
    END;
  END LOOP;

  RETURN flagged;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_cron_defect(
    'detect_suspicious_user_patterns', 'run', SQLERRM,
    jsonb_build_object('phase', 'scan', 'flagged_before_failure', flagged));
  RETURN flagged;
END;
$$;


REVOKE ALL ON FUNCTION public.detect_suspicious_user_patterns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_suspicious_user_patterns() TO service_role;
